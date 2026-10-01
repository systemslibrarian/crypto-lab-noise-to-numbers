import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ManifestError, fixtureById, fixturesForAct, validateManifest } from './manifest.ts';
import { HIGH_ESTIMATE_BITS_PER_BIT, SAMPLE_MINIMUM, isHighEstimate } from './thresholds.ts';
import type { Manifest } from './types.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const raw = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/manifest.json'), 'utf8')) as unknown;

/** A deep clone, so a mutation test cannot leak into the next case. */
const clone = (): Manifest => JSON.parse(JSON.stringify(raw)) as Manifest;

describe('the shipped manifest', () => {
  it('validates', () => {
    expect(() => validateManifest(raw)).not.toThrow();
  });

  const m = validateManifest(raw);

  /**
   * INVARIANT I1, CHECKED AGAINST THE BYTES ON DISK. The manifest's recorded
   * checksum for each shipped file is compared with a hash taken here, and the
   * tool's own recorded input hash is compared with the converted form's. A
   * figure displayed for a file the tool never saw cannot survive this.
   */
  it('records the SHA-256 of each shipped fixture correctly', () => {
    for (const f of m.fixtures) {
      const bytes = readFileSync(resolve(ROOT, 'public', f.download));
      expect(createHash('sha256').update(bytes).digest('hex'), f.id).toBe(
        f.encoding.originalSha256
      );
      expect(bytes.length, `${f.id} byte count`).toBe(f.encoding.originalBytes);
    }
  });

  it('ties every assessment to the hash the tool itself reported', () => {
    for (const f of m.fixtures) {
      if (f.assessment === null) continue;
      expect(f.assessment.toolSha256, f.id).toBe(f.encoding.convertedSha256);
    }
  });

  it('names the patched build rather than claiming NIST’s unmodified reference', () => {
    for (const f of m.fixtures) {
      if (f.assessment === null) continue;
      expect(f.assessment.tool.patched).toBe(true);
      expect(f.assessment.tool.forkCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(f.assessment.tool.upstreamBaseline).toMatch(/^[0-9a-f]{40}$/);
      expect(f.assessment.tool.forkCommit).not.toBe(f.assessment.tool.upstreamBaseline);
    }
  });

  it('ships only simulated or deterministic data in v1 — no captures', () => {
    for (const f of m.fixtures) {
      expect(['simulated', 'deterministic'], f.id).toContain(f.provenance);
      expect(f.neverASecret, f.id).toBe(true);
    }
  });

  it('gives every fault variant a clean fixture to be compared against', () => {
    const faults = m.fixtures.filter((f) => f.id.startsWith('fault-'));
    expect(faults.length).toBeGreaterThanOrEqual(5);
    for (const f of faults) expect(fixtureById(m, f.variantOf!), f.id).toBeDefined();
  });

  it('has a fixture for each act the lab walks through', () => {
    for (const act of [2, 3, 4, 5]) expect(fixturesForAct(m, act).length, `act ${act}`).toBeGreaterThan(0);
  });
});

describe('the sub-minimum fixture is a measured refusal, not a disclaimer', () => {
  const m = validateManifest(raw);
  const short = fixtureById(m, 'exploratory-short')!;

  it('is genuinely below the standard’s minimum', () => {
    expect(short.encoding.sampleCount).toBeLessThan(SAMPLE_MINIMUM);
    expect(short.assessment!.belowMinimum).toBe(true);
  });

  it('carries NO assessed figure, and the tool’s own refusal instead', () => {
    const a = short.assessment!;
    expect(a.overall?.hAssessed ?? null).toBeNull();
    expect(a.exitCode).not.toBe(0);
    expect(a.errorLevel).toBeLessThan(0);
    expect(a.errorMessage).toContain('1000000');
  });
});

describe('the headline experiment, as measured', () => {
  const m = validateManifest(raw);
  const counterHash = fixtureById(m, 'counter-hash-sha256')!;
  const rawNoise = fixtureById(m, 'inm-clean')!;
  const conditioned = fixtureById(m, 'inm-conditioned-keccak')!;

  /**
   * THE RESULT. A stream whose construction is published in full — SHA-256
   * over a little-endian counter from zero — receives a HIGHER assessed
   * min-entropy per bit than the modelled physical noise source does. The
   * threshold was drawn after this measurement, not before it; see
   * `thresholds.ts` for the whole column of figures.
   */
  it('scores the published deterministic stream above the lab’s "high" line', () => {
    const v = counterHash.assessment!.overall!.assessedBitsPerBit!;
    expect(v).toBeGreaterThanOrEqual(HIGH_ESTIMATE_BITS_PER_BIT);
    expect(isHighEstimate(v)).toBe(true);
  });

  it('scores the modelled physical source BELOW that same line', () => {
    const v = rawNoise.assessment!.overall!.assessedBitsPerBit!;
    expect(v).toBeLessThan(HIGH_ESTIMATE_BITS_PER_BIT);
    expect(isHighEstimate(v)).toBe(false);
  });

  it('puts the deterministic stream strictly above the physical one', () => {
    expect(counterHash.assessment!.overall!.assessedBitsPerBit!).toBeGreaterThan(
      rawNoise.assessment!.overall!.assessedBitsPerBit!
    );
  });

  /**
   * INVARIANT I5. Conditioning the modelled source raises the number reported
   * for it from below the line to above it. The entropy of the source did not
   * change; only the bytes being measured did.
   */
  it('shows conditioning raising the reported figure without touching the source', () => {
    const before = rawNoise.assessment!.overall!.assessedBitsPerBit!;
    const after = conditioned.assessment!.overall!.assessedBitsPerBit!;
    expect(after).toBeGreaterThan(before);
    expect(isHighEstimate(before)).toBe(false);
    expect(isHighEstimate(after)).toBe(true);
  });

  it('states units for every figure it reports', () => {
    for (const f of [counterHash, rawNoise, conditioned]) {
      const o = f.assessment!.overall!;
      expect(o.dataWordSize).toBe(f.encoding.bitsPerSymbol);
      // bits per sample and bits per bit are different numbers unless the
      // width is 1, which is exactly why both are recorded.
      expect(o.assessedBitsPerBit).toBeCloseTo(o.hAssessed! / o.dataWordSize!, 12);
    }
  });
});

describe('the validator fails closed', () => {
  it('rejects a figure attributed to the wrong file', () => {
    const m = clone();
    m.fixtures[0].assessment!.toolSha256 = 'f'.repeat(64);
    expect(() => validateManifest(m)).toThrow(ManifestError);
    expect(() => validateManifest(m)).toThrow(/belong to a different file/);
  });

  it('rejects an assessed figure that is not the combination of its own estimators', () => {
    const m = clone();
    const a = m.fixtures[0].assessment!;
    a.overall!.hAssessed = 0.99;
    a.overall!.assessedBitsPerBit = 0.99;
    expect(() => validateManifest(m)).toThrow(/is not min\(H_original/);
  });

  /**
   * The naive check this replaced — "the minimum of the per-bit column" —
   * agreed with the tool on every 1-bit fixture and disagreed on both 8-bit
   * ones, because H_original binds there. So the rule is pinned against a
   * real 8-bit fixture, where the two readings genuinely differ.
   */
  it('uses the real combination rule, not the minimum of the per-bit column', () => {
    const m = validateManifest(raw);
    const f = m.fixtures.find((x) => x.encoding.bitsPerSymbol === 8)!;
    const a = f.assessment!;
    const perBitMin = Math.min(
      ...a.estimators.map((e) => e.bitsPerBit).filter((v): v is number => v !== null)
    );
    // The two readings differ here, which is the point.
    expect(a.overall!.assessedBitsPerBit).not.toBeCloseTo(perBitMin, 6);
    expect(a.overall!.hAssessed).toBeCloseTo(
      Math.min(
        ...a.estimators.map((e) => e.bitsPerSample).filter((v): v is number => v !== null)
      ),
      9
    );
  });

  it('rejects a corrupted H_original or H_bitstring, not only the headline figure', () => {
    const a = clone();
    const f8 = a.fixtures.find((x) => x.encoding.bitsPerSymbol === 8)!;
    f8.assessment!.overall!.hBitstring = 0.123;
    expect(() => validateManifest(a)).toThrow(/H_bitstring .* is not the minimum/);
    const b = clone();
    b.fixtures[0].assessment!.overall!.hOriginal = 0.123;
    expect(() => validateManifest(b)).toThrow(/H_original .* is not the minimum/);
  });

  it('rejects a full assessment on a below-minimum file', () => {
    const m = clone();
    const short = m.fixtures.find((f) => f.id === 'exploratory-short')!;
    short.assessment!.overall = {
      hOriginal: 0.5,
      hBitstring: null,
      hAssessed: 0.5,
      dataWordSize: 1,
      assessedBitsPerBit: 0.5,
    };
    expect(() => validateManifest(m)).toThrow(/below the 1000000-sample minimum/);
  });

  it('rejects a partial run that is not flagged partial', () => {
    const m = clone();
    m.fixtures[0].assessment!.estimators[3].declined = true;
    expect(() => validateManifest(m)).toThrow(/partial is false but an estimator declined/);
  });

  it('rejects a packed fixture whose byte count is not the packing of its samples', () => {
    const m = clone();
    const packed = m.fixtures.find((f) => f.encoding.shippedForm === 'packed-bits')!;
    packed.encoding.originalBytes = packed.encoding.sampleCount;
    expect(() => validateManifest(m)).toThrow(/packed samples should be/);
  });

  it('rejects a converted form that is not one sample per byte', () => {
    const m = clone();
    m.fixtures[0].encoding.convertedBytes = 12;
    expect(() => validateManifest(m)).toThrow(/one sample per byte/);
  });

  it('rejects a fixture not marked never-a-secret', () => {
    const m = clone();
    m.fixtures[0].neverASecret = false;
    expect(() => validateManifest(m)).toThrow(/never a secret|neverASecret/);
  });

  it('rejects a nonzero exit that still carries a figure', () => {
    const m = clone();
    m.fixtures[0].assessment!.exitCode = 255;
    expect(() => validateManifest(m)).toThrow(/carries an assessed figure/);
  });

  it('rejects a variantOf naming a fixture that is not present', () => {
    const m = clone();
    m.fixtures.find((f) => f.id.startsWith('fault-'))!.variantOf = 'no-such-fixture';
    expect(() => validateManifest(m)).toThrow(/not a fixture here/);
  });

  it('reports every problem at once rather than only the first', () => {
    const m = clone();
    m.fixtures[0].neverASecret = false;
    m.fixtures[0].encoding.convertedBytes = 3;
    try {
      validateManifest(m);
      expect.unreachable();
    } catch (e) {
      expect((e as ManifestError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });
});
