/**
 * Load and VALIDATE the generated fixture manifest.
 *
 * Validation is not ceremony here. The manifest is the only thing standing
 * between the page and a displayed min-entropy figure, so invariant I1 — every
 * displayed number belongs to the exact file being viewed — has to be checked
 * at load rather than assumed from the fact that a generator wrote the file.
 * A manifest that fails these checks makes the page refuse to show figures at
 * all, which is the fail-closed direction.
 */
import type { Assessment, Fixture, Manifest } from './types.ts';
import { NON_IID_ESTIMATOR_COUNT, SAMPLE_MINIMUM } from './thresholds.ts';

export class ManifestError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`fixture manifest is not usable:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ManifestError';
    this.problems = problems;
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

function checkAssessment(f: Fixture, a: Assessment, problems: string[]): void {
  const at = `${f.id}.assessment`;

  // I1: the tool hashed its own input. That hash must be the hash of the
  // converted form of THIS fixture, or the figures describe another file.
  if (!SHA256.test(a.toolSha256)) {
    problems.push(`${at}.toolSha256 is not a SHA-256`);
  } else if (a.toolSha256 !== f.encoding.convertedSha256) {
    problems.push(
      `${at} was run on ${a.toolSha256.slice(0, 12)} but ${f.id}'s converted file is ` +
        `${f.encoding.convertedSha256.slice(0, 12)}: the figures belong to a different file`
    );
  }

  if (a.bitsPerSymbol !== f.encoding.bitsPerSymbol) {
    problems.push(
      `${at} assessed at ${a.bitsPerSymbol} bits per symbol but the encoding declares ` +
        `${f.encoding.bitsPerSymbol}`
    );
  }

  if (a.estimators.length !== NON_IID_ESTIMATOR_COUNT) {
    problems.push(
      `${at} lists ${a.estimators.length} estimators; SP 800-90B 6.2 takes the minimum over ` +
        `${NON_IID_ESTIMATOR_COUNT}`
    );
  }

  // ── The three figures, RE-DERIVED from the per-estimator values ────────
  //
  // SP 800-90B 6.2 takes a minimum, but not the one it is easy to assume.
  // For a multi-bit symbol width the tool computes TWO minima and combines
  // them:
  //
  //     H_original  = min over the LITERAL branch,   in bits per sample
  //     H_bitstring = min over the BIT-STRING branch, in bits per bit
  //     assessed    = min(H_original, wordSize * H_bitstring)
  //
  // At width 1 the two branches are the same sequence and the second term is
  // the first. Getting this wrong is how a plausible-looking check passes a
  // corrupted figure: the naive "minimum of the per-bit column" gives
  // 0.9256 for the counter-hash fixture where the tool reports 0.9192,
  // because H_original binds there and 8 x H_bitstring does not.
  //
  // This is an INDEPENDENT re-derivation, by a different route than the
  // source takes, which is what §4.1b asks for. It cross-checks all three
  // recorded figures, not just the headline one.
  const o = a.overall;
  if (o !== null && o.hAssessed !== null) {
    const literal = a.estimators.map((e) => e.bitsPerSample).filter((v): v is number => v !== null);
    const bitstring = a.estimators.map((e) => e.bitsPerBit).filter((v): v is number => v !== null);
    const width = o.dataWordSize;
    if (literal.length === 0 || bitstring.length === 0) {
      problems.push(`${at} reports an assessed figure with no estimator values behind it`);
    } else if (width === null || width < 1) {
      problems.push(`${at} reports hAssessed with no usable word size to normalise it`);
    } else if (o.assessedBitsPerBit === null) {
      problems.push(`${at} reports hAssessed with no normalised bits-per-bit figure`);
    } else {
      const minLiteral = Math.min(...literal);
      const minBitstring = Math.min(...bitstring);
      const expected = width === 1 ? minLiteral : Math.min(minLiteral, width * minBitstring);
      // A tolerance, because these are the same doubles reached by a
      // different order of operations, not because the figures are fuzzy.
      const EPS = 1e-9;
      if (Math.abs(expected - o.hAssessed) > EPS) {
        problems.push(
          `${at}: assessed ${o.hAssessed} is not min(H_original ${minLiteral}, ` +
            `${width} x H_bitstring ${minBitstring}) = ${expected}`
        );
      }
      if (o.hOriginal !== null && Math.abs(o.hOriginal - minLiteral) > EPS) {
        problems.push(
          `${at}: H_original ${o.hOriginal} is not the minimum ${minLiteral} over the literal branch`
        );
      }
      if (o.hBitstring !== null && Math.abs(o.hBitstring - minBitstring) > EPS) {
        problems.push(
          `${at}: H_bitstring ${o.hBitstring} is not the minimum ${minBitstring} over the ` +
            'bit-string branch'
        );
      }
      if (Math.abs(o.hAssessed / width - o.assessedBitsPerBit) > EPS) {
        problems.push(
          `${at}: assessedBitsPerBit ${o.assessedBitsPerBit} is not hAssessed ${o.hAssessed} ` +
            `over the word size ${width}`
        );
      }
    }
  }

  // I6: a below-minimum file must not carry a full assessment.
  const below = f.encoding.sampleCount < SAMPLE_MINIMUM;
  if (below !== a.belowMinimum) {
    problems.push(
      `${at}.belowMinimum is ${a.belowMinimum} but the fixture has ${f.encoding.sampleCount} samples`
    );
  }
  if (below && o !== null && o.hAssessed !== null) {
    problems.push(
      `${at} carries an assessed figure for a ${f.encoding.sampleCount}-sample file, which is ` +
        `below the ${SAMPLE_MINIMUM}-sample minimum`
    );
  }

  // I2: a partial run must be flagged, and the flag must match the estimators.
  const anyDeclined = a.estimators.some((e) => e.declined);
  if (anyDeclined !== a.partial) {
    problems.push(`${at}.partial is ${a.partial} but ${anyDeclined ? 'an' : 'no'} estimator declined`);
  }

  // A nonzero exit must come with a reason, and must not come with figures.
  if (a.exitCode !== 0) {
    if (a.errorMessage === null) {
      problems.push(`${at} exited ${a.exitCode} with no errorMessage`);
    }
    if (o !== null && o.hAssessed !== null) {
      problems.push(`${at} exited ${a.exitCode} yet carries an assessed figure`);
    }
  }
}

/** Validate a parsed manifest, throwing with every problem found at once. */
export function validateManifest(raw: unknown): Manifest {
  const problems: string[] = [];
  const m = raw as Manifest;
  if (!m || typeof m !== 'object' || !Array.isArray(m.fixtures)) {
    throw new ManifestError(['manifest has no fixtures array']);
  }
  if (m.sampleMinimum !== SAMPLE_MINIMUM) {
    problems.push(`manifest sampleMinimum ${m.sampleMinimum} differs from the lab's ${SAMPLE_MINIMUM}`);
  }

  const ids = new Set<string>();
  for (const f of m.fixtures) {
    if (ids.has(f.id)) problems.push(`duplicate fixture id "${f.id}"`);
    ids.add(f.id);

    if (!SHA256.test(f.encoding.originalSha256)) problems.push(`${f.id}.originalSha256 is not a SHA-256`);
    if (!SHA256.test(f.encoding.convertedSha256)) problems.push(`${f.id}.convertedSha256 is not a SHA-256`);

    // The packed and the converted form are different inputs, so for a packed
    // fixture their byte counts must differ by the packing factor exactly.
    if (f.encoding.shippedForm === 'packed-bits') {
      const expected = Math.ceil(f.encoding.sampleCount / 8);
      if (f.encoding.originalBytes !== expected) {
        problems.push(
          `${f.id}: ${f.encoding.sampleCount} packed samples should be ${expected} bytes, ` +
            `manifest says ${f.encoding.originalBytes}`
        );
      }
      if (f.encoding.bitOrder === 'n/a') problems.push(`${f.id}: a packed fixture needs a bit order`);
    }
    if (f.encoding.convertedBytes !== f.encoding.sampleCount) {
      problems.push(
        `${f.id}: the converted form must be one sample per byte, so ${f.encoding.sampleCount} ` +
          `samples is ${f.encoding.sampleCount} bytes, not ${f.encoding.convertedBytes}`
      );
    }

    // I4: public fixtures are never a secret, and the manifest must say so.
    if (f.neverASecret !== true) problems.push(`${f.id} is a public fixture and must be marked neverASecret`);

    if (f.variantOf !== null && !m.fixtures.some((o) => o.id === f.variantOf)) {
      problems.push(`${f.id}.variantOf names "${f.variantOf}", which is not a fixture here`);
    }

    if (f.assessment !== null) checkAssessment(f, f.assessment, problems);
  }

  if (problems.length > 0) throw new ManifestError(problems);
  return m;
}

/** The fixture a given id names, or undefined. */
export function fixtureById(m: Manifest, id: string): Fixture | undefined {
  return m.fixtures.find((f) => f.id === id);
}

/** Fixtures belonging to one act, in manifest order. */
export function fixturesForAct(m: Manifest, act: number): Fixture[] {
  return m.fixtures.filter((f) => f.act === act);
}
