import { describe, expect, it } from 'vitest';
import {
  DESCRIPTIVE_DEFAULTS,
  INPUT_SIZE_CAP,
  InputTooLargeError,
  autocorrelation,
  bitBalance,
  describe as describeSamples,
  findRepeatedBlock,
  isConstant,
  runLengths,
} from './descriptive.ts';

const bits = (s: string): Uint8Array => Uint8Array.from(s, (c) => (c === '1' ? 1 : 0));

describe('bit balance', () => {
  it('is the proportion of ones in the bit string the samples form', () => {
    expect(bitBalance(bits('11110000'), 1)).toBe(0.5);
    expect(bitBalance(bits('11111111'), 1)).toBe(1);
    expect(bitBalance(bits('00000000'), 1)).toBe(0);
    expect(bitBalance(Uint8Array.from([0xff]), 8)).toBe(1);
    expect(bitBalance(Uint8Array.from([0x0f]), 8)).toBe(0.5);
  });

  it('refuses a width outside 1..8 rather than reporting a fraction of nothing', () => {
    for (const w of [0, -1, 9, 1.5]) expect(() => bitBalance(bits('10'), w)).toThrow(RangeError);
  });

  it('is 0 for an empty input, not NaN', () => {
    expect(bitBalance(new Uint8Array(0), 1)).toBe(0);
  });
});

describe('run lengths', () => {
  it('counts runs of each value', () => {
    // 0,0 | 1,1,1 | 0,0  -> two zero-runs of length 2 and one one-run of 3.
    const r = runLengths(bits('0011100'));
    expect(r.zeros[2]).toBe(2);
    expect(r.zeros[1]).toBe(0);
    expect(r.ones[3]).toBe(1);
    expect(r.longestOnes).toBe(3);
    expect(r.longestZeros).toBe(2);
    expect(r.totalRuns).toBe(3);
  });

  it('buckets runs longer than the cap instead of allocating an array as long as the file', () => {
    const r = runLengths(new Uint8Array(1000).fill(1), 8);
    expect(r.ones).toHaveLength(9);
    expect(r.ones[8]).toBe(1);
    expect(r.longestOnes).toBe(1000); // the true length is still reported
  });

  it('is empty for an empty input', () => {
    expect(runLengths(new Uint8Array(0)).totalRuns).toBe(0);
  });
});

describe('autocorrelation', () => {
  it('is +1 for a sequence correlated with itself at its own period', () => {
    const s = Uint8Array.from({ length: 1000 }, (_, i) => (i % 4 < 2 ? 1 : 0));
    expect(autocorrelation(s, 4)).toBeCloseTo(1, 10);
  });

  it('is -1 for an alternating sequence at lag 1', () => {
    const s = Uint8Array.from({ length: 1000 }, (_, i) => (i % 2) as 0 | 1);
    expect(autocorrelation(s, 1)).toBeCloseTo(-1, 10);
  });

  it('returns 0 rather than NaN where it is undefined', () => {
    expect(autocorrelation(new Uint8Array(10).fill(1), 1)).toBe(0); // zero variance
    expect(autocorrelation(bits('101'), 0)).toBe(0); // no lag
    expect(autocorrelation(bits('10'), 5)).toBe(0); // lag past the end
  });

  /**
   * A constant input has undefined correlation. The page must say so rather
   * than print the 0 this function returns, which would read as independence.
   * `isConstant` is how the UI knows which of the two it is looking at.
   */
  it('is distinguished from genuine independence by isConstant', () => {
    expect(isConstant(new Uint8Array(10).fill(1))).toBe(true);
    expect(isConstant(new Uint8Array(0))).toBe(true);
    expect(isConstant(bits('10'))).toBe(false);
  });
});

describe('repeated-block search', () => {
  it('finds a planted repeat and reports both offsets', () => {
    const s = new Uint8Array(2000);
    for (let i = 0; i < s.length; i++) s[i] = (i * 31 + (i >> 5)) & 1;
    s.set(s.subarray(100, 356), 1200); // plant a 256-sample repeat
    const hit = findRepeatedBlock(s, 256);
    expect(hit).not.toBeNull();
    // Whatever pair it reports, the two blocks must genuinely be equal: a
    // false repeat finding in a lab about evidence is the worst defect here.
    const { firstOffset, secondOffset, blockLength } = hit!;
    expect(firstOffset).not.toBe(secondOffset);
    expect(Array.from(s.subarray(firstOffset, firstOffset + blockLength))).toEqual(
      Array.from(s.subarray(secondOffset, secondOffset + blockLength))
    );
  });

  it('reports nothing for a block length no repeat reaches', () => {
    // NOT a `i & 0xff` counter: that has period 256, so its 512-sample blocks
    // at offsets 0 and 256 are genuinely identical and the search is right to
    // say so. An LCG with a period far longer than the file is what actually
    // has no repeat at this length.
    let x = 1;
    const s = Uint8Array.from({ length: 1024 }, () => {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      return (x >>> 16) & 0xff;
    });
    expect(findRepeatedBlock(s, 512)).toBeNull();
    // ...and the periodic counter it is being contrasted with DOES repeat,
    // which is what makes the negative result above mean something.
    expect(findRepeatedBlock(Uint8Array.from({ length: 1024 }, (_, i) => i & 0xff), 512)).toEqual({
      blockLength: 512,
      firstOffset: 0,
      secondOffset: 256,
    });
  });

  it('declines the degenerate cases instead of reporting a self-match', () => {
    expect(findRepeatedBlock(new Uint8Array(10), 0)).toBeNull();
    expect(findRepeatedBlock(new Uint8Array(10), 20)).toBeNull();
    // A file exactly one block long cannot contain two of them.
    expect(findRepeatedBlock(new Uint8Array(8), 8)).toBeNull();
  });

  it('finds the all-zero file’s repeat, which is the all-zero edge case', () => {
    expect(findRepeatedBlock(new Uint8Array(1000), 256)).toEqual({
      blockLength: 256,
      firstOffset: 0,
      secondOffset: 1,
    });
  });
});

describe('the full descriptive pass', () => {
  const s = Uint8Array.from({ length: 5000 }, (_, i) => ((i * 7919) >> 3) & 1);

  it('reports progress monotonically and finishes at 1', () => {
    const seen: number[] = [];
    describeSamples(s, { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 1, onProgress: (f) => seen.push(f) });
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('can be cancelled mid-run, and the exception reaches the caller', () => {
    let calls = 0;
    expect(() =>
      describeSamples(s, {
        ...DESCRIPTIVE_DEFAULTS,
        bitsPerSymbol: 1,
        checkCancelled: () => {
          if (++calls >= 2) throw new Error('cancelled');
        },
      })
    ).toThrow('cancelled');
  });

  it('refuses an input over the cap rather than locking up the worker', () => {
    const big = { length: INPUT_SIZE_CAP + 1 } as unknown as Uint8Array;
    expect(() => describeSamples(big, { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 1 })).toThrow(
      InputTooLargeError
    );
  });

  it('omits run lengths for multi-bit samples, where a sample is not a bit', () => {
    expect(describeSamples(s, { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 1 }).runs).not.toBeNull();
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
    expect(describeSamples(bytes, { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 8 }).runs).toBeNull();
  });

  it('marks correlation NaN for a constant input instead of printing zero', () => {
    const flat = describeSamples(new Uint8Array(2000), { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 1 });
    expect(flat.autocorrelation.every((a) => Number.isNaN(a.r))).toBe(true);
    expect(flat.distinctSymbols).toBe(1);
    expect(flat.mostCommon.proportion).toBe(1);
  });

  it('handles the empty file without inventing a mode', () => {
    const none = describeSamples(new Uint8Array(0), { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 1 });
    expect(none.sampleCount).toBe(0);
    expect(none.distinctSymbols).toBe(0);
    expect(none.mostCommon.count).toBe(0);
    expect(none.mostCommon.proportion).toBe(0);
  });

  /**
   * NOTHING IN THIS MODULE IS NAMED "ENTROPY". Shannon entropy over observed
   * frequencies is an average over a distribution fitted to your own sample;
   * min-entropy is a bound on a SOURCE. The lab keeps them apart by not having
   * the word available here at all, and this test is what keeps it that way.
   */
  it('exposes no field that could be read as an entropy estimate', () => {
    const d = describeSamples(s, { ...DESCRIPTIVE_DEFAULTS, bitsPerSymbol: 1 });
    expect(Object.keys(d).join(' ')).not.toMatch(/entropy/i);
  });
});
