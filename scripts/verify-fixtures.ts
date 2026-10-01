/**
 * THE INDEPENDENT FIXTURE CHECK.
 *
 *   node scripts/verify-fixtures.ts --tool <path to ea_non_iid>
 *
 * This checks FIXTURE GENERATION, not just table-vs-fixture agreement. It:
 *
 *   1. REGENERATES every fixture from `scripts/gen-fixtures.ts` into a scratch
 *      directory and compares the bytes with what the repository ships. A
 *      generator that drifted from the file it supposedly produced fails here.
 *   2. RERUNS the recorded command for every fixture with the pinned tool, and
 *      compares every figure with the manifest — each estimator, both branch
 *      minima, the assessed figure, the exit status, the error message, and
 *      the partial flag.
 *   3. CHECKS THE TOOL ITSELF is the commit the manifest names.
 *
 * Why all three. A manifest is a record of a measurement, and a record nobody
 * re-takes is a record that quietly becomes wrong: a regenerated fixture that
 * no longer matches its checksum, or an estimator whose value moved after a
 * tool bump, would otherwise be invisible until someone tried to reproduce a
 * figure and could not. The lab's whole claim is that its numbers are
 * checkable, so something has to check them.
 *
 * It needs the native tool, so it runs as its own CI job that builds the
 * pinned fork from source — see `.github/workflows/fixtures.yml`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './gen-fixtures.ts';
import type { Manifest } from '../src/entropy/types.ts';
import { validateManifest } from '../src/entropy/manifest.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TOOL = resolve(ROOT, '..', 'SP800-90B_EntropyAssessment', 'cpp', 'ea_non_iid');

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const toolPath = resolve(arg('--tool', DEFAULT_TOOL));
if (!existsSync(toolPath)) {
  process.stderr.write(`the pinned assessment tool is not at ${toolPath}\n`);
  process.exit(2);
}
const toolRepo = resolve(dirname(toolPath), '..');

const problems: string[] = [];
const note = (s: string): void => {
  problems.push(s);
  process.stdout.write(`  MISMATCH  ${s}\n`);
};

const manifest: Manifest = validateManifest(
  JSON.parse(readFileSync(resolve(ROOT, 'fixtures/manifest.json'), 'utf8'))
);

// ── 1. The tool is the commit the manifest names ───────────────────────────
const headCommit = execFileSync('git', ['-C', toolRepo, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
process.stdout.write(`tool at ${toolPath}\n  commit ${headCommit}\n\n`);
for (const f of manifest.fixtures) {
  if (f.assessment && f.assessment.tool.forkCommit !== headCommit) {
    note(
      `${f.id}: manifest records tool commit ${f.assessment.tool.forkCommit.slice(0, 12)}, ` +
        `the built tool is ${headCommit.slice(0, 12)}`
    );
  }
}

// ── 2. The generator still produces the shipped bytes ──────────────────────
process.stdout.write('regenerating every fixture from the generator\n');
const scratch = mkdtempSync(join(tmpdir(), 'ntn-verify-'));
const regenerated = await buildAll(join(scratch, 'out'), join(scratch, 'work'));
process.stdout.write('\n');

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

for (const b of regenerated) {
  const entry = manifest.fixtures.find((f) => f.id === b.spec.id);
  if (!entry) {
    note(`${b.spec.id}: the generator produces a fixture the manifest does not list`);
    continue;
  }
  const shipped = resolve(ROOT, 'public', entry.download);
  if (!existsSync(shipped)) {
    note(`${b.spec.id}: ${entry.download} is not in the repository`);
    continue;
  }
  if (sha(shipped) !== b.originalSha256) {
    note(
      `${b.spec.id}: the shipped file does not match what the generator produces ` +
        `(shipped ${sha(shipped).slice(0, 12)}, regenerated ${b.originalSha256.slice(0, 12)})`
    );
  }
  if (entry.encoding.originalSha256 !== b.originalSha256) {
    note(`${b.spec.id}: manifest originalSha256 does not match the regenerated file`);
  }
  if (entry.encoding.convertedSha256 !== b.convertedSha256) {
    note(`${b.spec.id}: manifest convertedSha256 does not match the regenerated conversion`);
  }
}
for (const f of manifest.fixtures) {
  if (!regenerated.some((b) => b.spec.id === f.id)) {
    note(`${f.id}: the manifest lists a fixture the generator does not produce`);
  }
}

// ── 3. Every recorded figure re-measures to the same value ─────────────────
process.stdout.write('rerunning the pinned tool on every fixture\n');
const CLOSE = 1e-9;

for (const f of manifest.fixtures) {
  const a = f.assessment;
  if (!a) continue;
  const built = regenerated.find((b) => b.spec.id === f.id);
  if (!built) continue;

  const reportPath = join(scratch, `${f.id}.json`);
  let exitCode = 0;
  try {
    execFileSync(
      toolPath,
      ['-i', '-a', '-vv', '-o', reportPath, built.convertedPath, String(f.encoding.bitsPerSymbol)],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (e) {
    const err = e as { status?: number };
    exitCode = typeof err.status === 'number' ? err.status : 1;
  }

  if (!existsSync(reportPath)) {
    note(`${f.id}: the rerun wrote no report`);
    continue;
  }
  const rep = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;

  if (exitCode !== a.exitCode) note(`${f.id}: exit ${exitCode}, manifest records ${a.exitCode}`);
  if (rep.errorLevel !== a.errorLevel) {
    note(`${f.id}: errorLevel ${String(rep.errorLevel)}, manifest records ${a.errorLevel}`);
  }
  if (String(rep.sha256) !== a.toolSha256) {
    note(`${f.id}: the tool hashed a different file than the manifest records`);
  }
  const msg = typeof rep.errorMessage === 'string' && rep.errorMessage ? rep.errorMessage : null;
  if (msg !== a.errorMessage) {
    note(`${f.id}: errorMessage differs\n      now:      ${msg}\n      manifest: ${a.errorMessage}`);
  }

  const cases = (rep.testCases ?? null) as Array<Record<string, number | string>> | null;
  const overall = cases?.find((c) => c.testCaseDesc === 'Overall');
  const num = (k: string): number | null => {
    const v = overall?.[k];
    return typeof v === 'number' ? v : null;
  };

  const expectClose = (label: string, now: number | null, was: number | null): void => {
    if (now === null && was === null) return;
    if (now === null || was === null || Math.abs(now - was) > CLOSE) {
      note(`${f.id}: ${label} is ${now}, manifest records ${was}`);
    }
  };
  expectClose('hAssessed', num('hAssessed'), a.overall?.hAssessed ?? null);
  expectClose('hOriginal', num('hOriginal'), a.overall?.hOriginal ?? null);
  expectClose('hBitstring', num('hBitstring'), a.overall?.hBitstring ?? null);

  // Each estimator individually, because the assessed figure is a minimum and
  // two estimators could move in opposite directions without shifting it.
  const byDesc = new Map<string, Record<string, number | string>>();
  for (const c of cases ?? []) byDesc.set(String(c.testCaseDesc), c);
  const DESCS: Array<[string, string, string | null, string]> = [
    ['Most Common Value', 'Most Common Value', 'hOriginal', 'hBitstring'],
    ['Collision Test (for bit strings only)', 'Collision', null, 'hBitstring'],
    ['Markov Test (for bit strings only)', 'Markov', null, 'hBitstring'],
    ['Compression Test (for bit strings only)', 'Compression', null, 'hBitstring'],
    ['T-Tuple Test', 'T-Tuple', 'tTupleRes', 'binTTupleRes'],
    ['LRS Test', 'LRS', 'lrsRes', 'binLrsRes'],
    ['Multi Most Common in Window Test', 'MultiMCW Prediction', 'hOriginal', 'hBitstring'],
    ['Lag Prediction Test', 'Lag Prediction', 'hOriginal', 'hBitstring'],
    ['Multi Markov Model with Counting Test (MultiMMC)', 'MultiMMC Prediction', 'hOriginal', 'hBitstring'],
    ['LZ78Y Test', 'LZ78Y Prediction', 'hOriginal', 'hBitstring'],
  ];
  const width = f.encoding.bitsPerSymbol;
  for (const [desc, short, litKey, bitKey] of DESCS) {
    const c = byDesc.get(desc);
    const rec = a.estimators.find((e) => e.name === short);
    if (!rec) {
      note(`${f.id}: the manifest has no estimator "${short}"`);
      continue;
    }
    const pick = (k: string | null): number | null => {
      if (!c || !k) return null;
      const v = c[k];
      return typeof v === 'number' ? v : null;
    };
    const litNow = pick(width === 1 && litKey === null ? 'hOriginal' : litKey);
    const bitNow = width === 1 ? litNow : pick(bitKey);
    expectClose(`${short} bits/sample`, litNow, rec.bitsPerSample);
    expectClose(`${short} bits/bit`, bitNow, rec.bitsPerBit);
  }
  process.stdout.write(`  ${f.id.padEnd(24)} rechecked\n`);
}

process.stdout.write('\n');
if (problems.length === 0) {
  process.stdout.write(
    `every fixture regenerated byte-for-byte and every recorded figure re-measured to the ` +
      `same value (${manifest.fixtures.length} fixtures).\n`
  );
  process.exit(0);
}
process.stderr.write(
  `${problems.length} mismatch${problems.length === 1 ? '' : 'es'} between the repository and a ` +
    `fresh run. The manifest is a record of a measurement; if the measurement no longer ` +
    `reproduces, the record is wrong and the lab is showing figures nobody can check.\n`
);
process.exit(1);
