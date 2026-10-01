#!/usr/bin/env node
/**
 * REPLAY THE MUTATION LEDGER (§4.1c).
 *
 *   node scripts/mutate.mjs            # every mutation
 *   node scripts/mutate.mjs <id> ...   # just these
 *
 * A green suite is not evidence until you have watched it fail. This script
 * does the watching, and it writes down what it saw — because a sentence
 * describing a mutation cannot be replayed, and a paragraph describing a run
 * is the author's side of the claim rather than the run's.
 *
 * A KILL REQUIRES ALL FOUR OF §4.1c'S RULES, and this script enforces every
 * one of them rather than trusting a red run:
 *
 *   1. THE OWNING TEST PASSED UNMUTATED IN THE SAME RUN. Checked first, as the
 *      baseline. A test that was already failing proves nothing when it fails
 *      again.
 *   2. THE PATCH ACTUALLY CHANGED THE FILE. The anchor must occur exactly once
 *      and the bytes must differ afterwards.
 *   3. THE RUN SERVED THE MUTATED CODE. Proved two ways, because a red run is
 *      worthless if you cannot say WHY it was red: the built bundle's hash must
 *      MOVE, and the failure is classified — a build error, a server that never
 *      started, or a connection refused is NOT a kill. `CI=1` is set so
 *      `reuseExistingServer` is false and no stale preview can answer.
 *   4. A PATCH THAT DOES NOT COMPILE IS "DOES NOT BUILD", NEVER A KILL. The
 *      suite would otherwise run against the last good bundle and pass, which
 *      is the exact false-verified result this discipline exists to prevent.
 *
 * Nothing is written back into the ledger. `e2e/global-teardown.ts` already
 * fails any run in which a ledger entry's check did not execute, so an
 * archived `observed` string would be a second copy of an answer that is
 * already enforced — free to drift from it, and believed over it.
 *
 * COMMIT THE REAL WORK BEFORE RUNNING THIS. A session that dies mid-check
 * otherwise strands an inverted condition in the tree; the script refuses to
 * start if a file it is about to patch has uncommitted changes, and restores
 * every patch in a `finally`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read the ledger through Node's type stripping, so there is one copy of it. */
const { MUTATIONS } = await import(resolve(ROOT, 'e2e/mutations.ts'));

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = only.length > 0 ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;
if (selected.length === 0) {
  console.error(`no mutation matched ${JSON.stringify(only)}`);
  process.exit(2);
}

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

/** A hash over every emitted JS bundle. This is what must move. */
function bundleHash() {
  const dir = join(ROOT, 'dist', 'assets');
  if (!existsSync(dir)) return null;
  const h = createHash('sha256');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
    h.update(f);
    h.update(readFileSync(join(dir, f)));
  }
  return h.digest('hex');
}

function build() {
  const r = sh('npm', ['run', 'build']);
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Run only the owning test, with CI=1 so no reused server can answer. */
function runTest(titleSubstring) {
  const r = sh(
    'npx',
    ['playwright', 'test', '--project=claims', '--grep', titleSubstring],
    { env: { ...process.env, CI: '1' } }
  );
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * Why was this run red? A red run that is red for the wrong reason is not a
 * kill, and refusing to ask is how a false "verified" gets recorded.
 */
function classify(output) {
  if (/was not able to start|Process from config\.webServer/i.test(output)) return 'server-never-started';
  if (/ERR_CONNECTION_REFUSED|net::ERR_/i.test(output)) return 'connection-refused';
  if (/error TS\d+|Build failed|Transform failed/i.test(output)) return 'build-error';
  if (/\d+ failed/.test(output)) return 'assertion-failed';
  if (/No tests found/i.test(output)) return 'no-tests-selected';
  return 'unknown';
}

// ── Refuse to start on a dirty tree ────────────────────────────────────────
const files = [...new Set(selected.map((m) => m.file))];
const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...files], {
  encoding: 'utf8',
}).trim();
if (dirty && !process.argv.includes('--allow-dirty')) {
  console.error(
    'Refusing to mutate: these files have uncommitted changes, and a session that dies\n' +
      'mid-check would strand an inverted condition in the tree.\n\n' +
      dirty +
      '\n\nCommit the real work first, or pass --allow-dirty if you know what you are doing.'
  );
  process.exit(2);
}

// ── Rule 1: the baseline ───────────────────────────────────────────────────
console.log('── baseline ───────────────────────────────────────────────────');
const baseBuild = build();
if (!baseBuild.ok) {
  console.error('the UNMUTATED tree does not build; nothing below would mean anything.');
  console.error(baseBuild.output.slice(-2000));
  process.exit(2);
}
const baseHash = bundleHash();
console.log(`bundle ${baseHash.slice(0, 16)}`);

const baseline = runTest('.');
if (baseline.status !== 0) {
  console.error('the UNMUTATED claims suite does not pass; a mutation cannot prove anything here.');
  console.error(baseline.output.slice(-3000));
  process.exit(2);
}
console.log('unmutated claims suite: PASSED\n');

// ── Rules 2-4: each mutation ───────────────────────────────────────────────
const results = [];

for (const m of selected) {
  const path = resolve(ROOT, m.file);
  const original = readFileSync(path, 'utf8');
  let verdict = 'UNKNOWN';
  let detail = '';

  try {
    // Rule 2: the anchor is unambiguous and the patch really changes the file.
    const occurrences = original.split(m.anchor).length - 1;
    if (occurrences !== 1) {
      results.push({ m, verdict: 'ANCHOR NOT UNIQUE', detail: `found ${occurrences} occurrences` });
      continue;
    }
    const mutated = original.replace(m.anchor, m.replacement);
    if (mutated === original) {
      results.push({ m, verdict: 'PATCH IS A NO-OP', detail: 'replacement equals anchor' });
      continue;
    }
    writeFileSync(path, mutated);

    // Rule 4: a patch that does not compile is never a kill.
    const b = build();
    if (!b.ok) {
      verdict = 'DOES NOT BUILD';
      detail = (b.output.match(/error TS\d+[^\n]*/) ?? ['see build output'])[0];
      continue;
    }

    // Rule 3, first proof: the bundle the browser gets actually moved.
    const mutHash = bundleHash();
    if (mutHash === baseHash) {
      verdict = 'BUNDLE UNCHANGED';
      detail = 'the mutation never reached the browser; the branch may be unreachable';
      continue;
    }

    const run = runTest(m.test);
    const why = classify(run.output);

    if (run.status === 0) {
      // Rule 3's corollary from the other side: a mutation that leaves every
      // test green is evidence about the SOURCE, not about the tests.
      verdict = 'SURVIVED';
      detail = 'the owning test still passed; the branch may be unreachable or the check toothless';
    } else if (why !== 'assertion-failed') {
      // Rule 3, second proof: a red run for the wrong reason is not a kill.
      verdict = 'RED FOR THE WRONG REASON';
      detail = why;
    } else {
      verdict = 'KILLED';
      const line = run.output.match(/\n\s+\d+\) .*\n/);
      detail = (line ? line[0] : '').trim().slice(0, 140) || 'owning test failed';
    }
  } finally {
    writeFileSync(path, original);
    results.push({ m, verdict, detail });
  }
}

// ── Restore and prove it ───────────────────────────────────────────────────
const after = build();
const afterHash = bundleHash();
console.log('\n── restored ───────────────────────────────────────────────────');
console.log(`build ${after.ok ? 'ok' : 'FAILED'}, bundle ${String(afterHash).slice(0, 16)}`);
if (!after.ok || afterHash !== baseHash) {
  console.error('THE TREE DID NOT RETURN TO ITS PRE-MUTATION STATE. Check `git status` now.');
  process.exit(2);
}
console.log('bundle hash returned to its pre-mutation value.');

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n── results ────────────────────────────────────────────────────');
let bad = 0;
for (const { m, verdict, detail } of results) {
  if (verdict !== 'KILLED') bad++;
  console.log(`${verdict === 'KILLED' ? '  KILLED' : '> ' + verdict.padEnd(24)}  ${m.id}`);
  if (verdict !== 'KILLED') console.log(`            ${detail}`);
}
console.log(`\n${results.length - bad}/${results.length} mutations killed.`);
process.exit(bad === 0 ? 0 : 1);
