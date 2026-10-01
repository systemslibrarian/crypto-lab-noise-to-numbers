/**
 * Run the pinned NIST SP 800-90B tool over every fixture and record EXACTLY
 * what it measured.
 *
 *   node scripts/assess-fixtures.ts [--tool <path to ea_non_iid>]
 *
 * Nothing in the output of this script is typed by a person. Every figure the
 * lab displays is read out of the tool's own JSON report for the file it was
 * run on, which is what invariant I1 requires. If a figure is not in a report,
 * the lab has no figure to show and says so.
 *
 * THE RESULT IS NOT PREDICTED. This script is the measurement; the manifest is
 * its record. Where the lab needs a threshold (the headline experiment's
 * "high" estimate), that threshold is chosen AFTER reading these numbers and
 * then pinned in `e2e/claims.spec.ts` — never fixed in advance and then
 * confirmed.
 *
 * SP 800-90B 6.2 lists TEN non-IID estimators and takes the minimum across
 * them. The tool omits a value both when an estimator does not apply to a
 * branch and when it could not produce one, so this script counts coverage
 * per branch and marks any shortfall `partial` (invariant I2).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './gen-fixtures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const DEFAULT_TOOL = resolve(ROOT, '..', 'SP800-90B_EntropyAssessment', 'cpp', 'ea_non_iid');

/** The ten estimators SP 800-90B 6.2 takes the minimum over, in report order. */
const ESTIMATORS = [
  { desc: 'Most Common Value', short: 'Most Common Value', literal: 'hOriginal', bitstring: 'hBitstring', bitstringOnly: false },
  { desc: 'Collision Test (for bit strings only)', short: 'Collision', literal: null, bitstring: 'hBitstring', bitstringOnly: true },
  { desc: 'Markov Test (for bit strings only)', short: 'Markov', literal: null, bitstring: 'hBitstring', bitstringOnly: true },
  { desc: 'Compression Test (for bit strings only)', short: 'Compression', literal: null, bitstring: 'hBitstring', bitstringOnly: true },
  { desc: 'T-Tuple Test', short: 'T-Tuple', literal: 'tTupleRes', bitstring: 'binTTupleRes', bitstringOnly: false },
  { desc: 'LRS Test', short: 'LRS', literal: 'lrsRes', bitstring: 'binLrsRes', bitstringOnly: false },
  { desc: 'Multi Most Common in Window Test', short: 'MultiMCW Prediction', literal: 'hOriginal', bitstring: 'hBitstring', bitstringOnly: false },
  { desc: 'Lag Prediction Test', short: 'Lag Prediction', literal: 'hOriginal', bitstring: 'hBitstring', bitstringOnly: false },
  { desc: 'Multi Markov Model with Counting Test (MultiMMC)', short: 'MultiMMC Prediction', literal: 'hOriginal', bitstring: 'hBitstring', bitstringOnly: false },
  { desc: 'LZ78Y Test', short: 'LZ78Y Prediction', literal: 'hOriginal', bitstring: 'hBitstring', bitstringOnly: false },
] as const;

/**
 * Each estimator's modelling assumption, in one sentence, for Act 3.
 *
 * These are READINGS OF THE STANDARD, not outputs of the tool, so they live
 * here as prose and the lab labels them as such. They are what makes a number
 * mean something: an estimate is only as good as the assumption behind it.
 */
const ASSUMPTIONS: Record<string, string> = {
  'Most Common Value':
    'Assumes the samples are independent and identically distributed, and bounds the probability of the single most likely value with a 99% upper confidence limit. Any structure across samples is invisible to it.',
  Collision:
    'Assumes an i.i.d. source and infers the collision probability from how many samples pass before a repeat. Only defined for binary inputs.',
  Markov:
    'Assumes a first-order Markov chain and bounds the most likely path of 128 samples. Dependence reaching further back than one sample is outside the model.',
  Compression:
    'Assumes nothing about the distribution, and bounds entropy from how well a Maurer-style compression of the bit string does. Sensitive to repetition, blind to arithmetic structure.',
  'T-Tuple':
    'Assumes nothing about independence, and bounds entropy from the frequency of the most common short tuple. Only sees patterns up to the longest repeated tuple it finds.',
  LRS: 'Assumes nothing about independence, and bounds entropy using the longest repeated substring. Complements T-Tuple at longer lengths.',
  'MultiMCW Prediction':
    'Runs four sliding-window majority predictors and bounds entropy from how well the best one guesses the next sample. Catches local bias; cannot catch structure no window sees.',
  'Lag Prediction':
    'Predicts each sample from the one that occurred a fixed number of samples earlier, across many lags. Catches periodicity; blind to aperiodic dependence.',
  'MultiMMC Prediction':
    'Maintains Markov models of orders 1 through 16 with counting and bounds entropy from the best predictor. Catches finite-order dependence up to order 16.',
  'LZ78Y Prediction':
    'Builds an LZ78Y dictionary of observed strings and predicts the next sample from it. Catches dictionary-compressible structure.',
};

export interface EstimatorRecord {
  name: string;
  /** bits per sample in the declared symbol width, or null if not reported. */
  bitsPerSample: number | null;
  /** bits per bit from the bitstring branch, or null if not reported. */
  bitsPerBit: number | null;
  /** True where the standard defines the estimator for binary inputs only. */
  bitstringOnly: boolean;
  /** True where a branch that should have reported a value did not. */
  declined: boolean;
  assumption: string;
}

export interface AssessmentRecord {
  tool: {
    program: string;
    toolVersion: string;
    forkRepo: string;
    forkCommit: string;
    upstreamBaseline: string;
    patched: true;
    patchedBuildNote: string;
  };
  platform: string;
  /** The command, exactly as run, with paths relative to the repo root. */
  command: string;
  exitCode: number;
  errorLevel: number;
  errorMessage: string | null;
  /** The SHA-256 the tool itself hashed, which must be the converted file's. */
  toolSha256: string;
  bitsPerSymbol: number;
  bitsPerSymbolInferred: boolean;
  estimators: EstimatorRecord[];
  /** The tool's overall figures. null where no assessment was performed. */
  overall: {
    hOriginal: number | null;
    hBitstring: number | null;
    hAssessed: number | null;
    dataWordSize: number | null;
    /** hAssessed / dataWordSize. DERIVED here, labelled as derived. */
    assessedBitsPerBit: number | null;
  } | null;
  /** Fewer than ten estimators produced a value in a branch that needs one. */
  partial: boolean;
  /** Below SP 800-90B 3.1.1's 1,000,000-sample minimum. */
  belowMinimum: boolean;
}

function gitShow(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** The upstream baseline commit, read out of the fork's NOTICE rather than assumed. */
function upstreamBaseline(repo: string): string {
  const notice = readFileSync(join(repo, 'NOTICE'), 'utf8');
  const m = notice.match(/Upstream baseline for this fork: commit\s+([0-9a-f]{40})/);
  if (!m) throw new Error('could not read the upstream baseline commit out of the fork NOTICE');
  return m[1];
}

function assess(
  toolPath: string,
  toolRepo: string,
  convertedPath: string,
  relConverted: string,
  bitsPerSymbol: number,
  reportPath: string
): AssessmentRecord {
  const args = ['-i', '-a', '-vv', '-o', reportPath, convertedPath, String(bitsPerSymbol)];
  let exitCode = 0;
  try {
    execFileSync(toolPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as { status?: number };
    exitCode = typeof err.status === 'number' ? err.status : 1;
  }
  if (!existsSync(reportPath)) {
    throw new Error(`the tool wrote no report for ${relConverted}; refusing to record a figure`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
  const cases = (report.testCases ?? null) as Array<Record<string, number | string>> | null;
  const byDesc = new Map<string, Record<string, number | string>>();
  for (const c of cases ?? []) byDesc.set(String(c.testCaseDesc), c);

  const num = (c: Record<string, number | string> | undefined, k: string | null): number | null => {
    if (!c || !k) return null;
    const v = c[k];
    return typeof v === 'number' ? v : null;
  };

  const estimators: EstimatorRecord[] = ESTIMATORS.map((e) => {
    const c = byDesc.get(e.desc);
    // At width 1 the original sequence IS the bit string: the tool reports one
    // value, under the literal field name, and there is no second branch.
    const literalKey = bitsPerSymbol === 1 && e.bitstringOnly ? 'hOriginal' : e.literal;
    const bitsPerSample = num(c, literalKey);
    const bitsPerBit = bitsPerSymbol === 1 ? bitsPerSample : num(c, e.bitstring);
    // A branch that the standard says should report, and did not.
    const literalExpected = bitsPerSymbol === 1 || !e.bitstringOnly;
    const declined =
      cases !== null &&
      ((literalExpected && bitsPerSample === null) ||
        (bitsPerSymbol > 1 && bitsPerBit === null));
    return {
      name: e.short,
      bitsPerSample,
      bitsPerBit,
      bitstringOnly: e.bitstringOnly,
      declined,
      assumption: ASSUMPTIONS[e.short],
    };
  });

  const overallCase = byDesc.get('Overall');
  const hAssessed = num(overallCase, 'hAssessed');
  const dataWordSize = num(overallCase, 'dataWordSize');
  const overall =
    overallCase === undefined
      ? null
      : {
          hOriginal: num(overallCase, 'hOriginal'),
          hBitstring: num(overallCase, 'hBitstring'),
          hAssessed,
          dataWordSize,
          assessedBitsPerBit:
            hAssessed !== null && dataWordSize !== null && dataWordSize > 0
              ? hAssessed / dataWordSize
              : null,
        };

  const errorLevel = typeof report.errorLevel === 'number' ? report.errorLevel : 0;
  const errorMessage =
    typeof report.errorMessage === 'string' && report.errorMessage.length > 0
      ? report.errorMessage
      : null;

  return {
    tool: {
      program: 'ea_non_iid',
      toolVersion: String(report.toolVersion ?? 'unknown'),
      forkRepo: 'https://github.com/systemslibrarian/SP800-90B_EntropyAssessment',
      forkCommit: gitShow(toolRepo, ['rev-parse', 'HEAD']),
      upstreamBaseline: upstreamBaseline(toolRepo),
      patched: true,
      patchedBuildNote:
        'This is a PATCHED build, not NIST’s unmodified reference implementation. Every ' +
        'divergence from the upstream baseline is listed with its date, reason and upstream ' +
        'issue number in the fork’s NOTICE file. Two changes (F09 and N-01) alter results ' +
        'deliberately. See SPIKE.md.',
    },
    platform: `${process.platform} ${process.arch}`,
    command: `./ea_non_iid -i -a -vv -o report.json ${relConverted} ${bitsPerSymbol}`,
    exitCode,
    errorLevel,
    errorMessage,
    toolSha256: String(report.sha256 ?? ''),
    bitsPerSymbol: typeof report.bitsPerSymbol === 'number' ? report.bitsPerSymbol : bitsPerSymbol,
    bitsPerSymbolInferred: report.bitsPerSymbolInferred === true,
    estimators,
    overall,
    partial: cases !== null && estimators.some((e) => e.declined),
    belowMinimum: false, // set by the caller, which knows the spec's sample count
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const i = process.argv.indexOf('--tool');
  const toolPath = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : DEFAULT_TOOL);
  if (!existsSync(toolPath)) {
    process.stderr.write(
      `the pinned assessment tool is not at ${toolPath}\n` +
        'Build it first (see SPIKE.md), or pass --tool <path to ea_non_iid>.\n'
    );
    process.exit(2);
  }
  const toolRepo = resolve(dirname(toolPath), '..');

  const outDir = resolve(ROOT, 'public/fixtures');
  const workDir = resolve(ROOT, '.tool-cache/converted');
  const reportDir = resolve(ROOT, '.tool-cache/reports');
  mkdirSync(reportDir, { recursive: true });

  process.stdout.write('building fixtures\n');
  const built = await buildAll(outDir, workDir);

  process.stdout.write(`\nassessing with ${toolPath}\n`);
  const entries = [];
  for (const b of built) {
    const rec = assess(
      toolPath,
      toolRepo,
      b.convertedPath,
      `${b.spec.id}.samples.bin`,
      b.spec.bitsPerSymbol,
      join(reportDir, `${b.spec.id}.json`)
    );
    rec.belowMinimum = b.spec.sampleCount < 1_000_000;

    // Invariant I1, enforced rather than described: the figure recorded for a
    // fixture must come from a run on THAT fixture's bytes. The tool hashes
    // its own input, so the two hashes can be compared directly.
    if (rec.toolSha256 !== b.convertedSha256) {
      throw new Error(
        `${b.spec.id}: the tool hashed ${rec.toolSha256} but the converted file is ` +
          `${b.convertedSha256}. Refusing to record a figure against the wrong file.`
      );
    }

    entries.push({
      id: b.spec.id,
      title: b.spec.title,
      blurb: b.spec.blurb,
      act: b.spec.act,
      provenance: b.spec.provenance,
      neverASecret: true,
      variantOf: b.spec.variantOf ?? null,
      seed: b.spec.seed ?? null,
      generator: 'scripts/gen-fixtures.ts',
      procedure: b.spec.procedure,
      encoding: {
        bitsPerSymbol: b.spec.bitsPerSymbol,
        sampleCount: b.spec.sampleCount,
        shippedForm: b.spec.shippedForm,
        bitOrder: b.spec.shippedForm === 'packed-bits' ? 'msb-first' : 'n/a',
        conversion:
          b.spec.shippedForm === 'packed-bits'
            ? `node scripts/unpack-bits.ts fixtures/${b.spec.id}.bin ${b.spec.sampleCount} msb-first ${b.spec.id}.samples.bin`
            : 'none: the shipped file is already one sample per byte',
        incompleteFinalSample:
          b.spec.sampleCount % 8 === 0
            ? 'n/a: the sample count is a multiple of 8, so no partial byte exists'
            : 'rejected: the generator refuses to pack a stream that does not fill whole bytes',
        originalBytes: b.originalBytes,
        originalSha256: b.originalSha256,
        convertedBytes: b.convertedBytes,
        convertedSha256: b.convertedSha256,
      },
      download: `fixtures/${b.spec.id}.bin`,
      assessment: rec,
    });

    const o = rec.overall;
    process.stdout.write(
      `${b.spec.id.padEnd(24)} exit ${String(rec.exitCode).padStart(3)}  ` +
        (o?.hAssessed === null || o === null
          ? `NO ASSESSMENT (errorLevel ${rec.errorLevel})`
          : `assessed ${o.hAssessed!.toFixed(6)} bits/sample of ${o.dataWordSize}  ` +
            `= ${o.assessedBitsPerBit!.toFixed(6)} bits/bit${rec.partial ? '  [PARTIAL]' : ''}`) +
        '\n'
    );
  }

  const manifest = {
    $comment:
      'GENERATED by scripts/assess-fixtures.ts. Do not edit by hand. Every figure here was ' +
      'read out of the pinned tool’s own JSON report for the file it was run on.',
    generatedBy: 'scripts/assess-fixtures.ts',
    schemaVersion: 1,
    sampleMinimum: 1_000_000,
    fixtures: entries,
  };
  const path = resolve(ROOT, 'fixtures/manifest.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const size = statSync(path).size;
  process.stdout.write(
    `\nmanifest -> ${path} (${size} B, sha256 ${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)}...)\n`
  );
}
