/**
 * DESCRIPTIVE STATISTICS. NOT SP 800-90B ESTIMATORS.
 *
 * Every function here is a plain summary of a byte string. None of them is an
 * entropy estimator, none produces a min-entropy figure, and the lab labels
 * their output "descriptive — not an SP 800-90B estimator" wherever it
 * appears. They exist so a visitor can look at a sample and build intuition
 * before any estimator is mentioned, and so the claims suite has something it
 * can recompute independently of what the page printed.
 *
 * WHY THIS SEPARATION IS THE WHOLE POINT. The temptation in a lab like this is
 * to compute a Shannon entropy in the browser, call it "entropy", and let a
 * visitor read it as an assessment. Shannon entropy over observed frequencies
 * is an average over a distribution you fitted to your own sample; min-entropy
 * is a bound on the most likely outcome of a SOURCE. They answer different
 * questions and one is not a conservative version of the other. So no function
 * in this module returns anything named "entropy" at all.
 */

export interface RunLengthHistogram {
  /** `ones[k]` is the number of runs of exactly k ones. Index 0 is unused. */
  ones: number[];
  /** `zeros[k]` is the number of runs of exactly k zeros. Index 0 is unused. */
  zeros: number[];
  longestOnes: number;
  longestZeros: number;
  totalRuns: number;
}

export interface RepeatedBlock {
  /** Block length in samples. */
  blockLength: number;
  /** Offset of the first occurrence. */
  firstOffset: number;
  /** Offset of the second occurrence. */
  secondOffset: number;
}

export interface DescriptiveStats {
  sampleCount: number;
  bitsPerSymbol: number;
  /** Count of each symbol value actually present, sparse by value. */
  symbolCounts: Array<{ value: number; count: number }>;
  distinctSymbols: number;
  /** Most common value and its observed proportion. Descriptive only. */
  mostCommon: { value: number; count: number; proportion: number };
  /**
   * Proportion of 1 bits in the bit string the samples form, taking
   * `bitsPerSymbol` bits from each sample. For a 1-bit fixture this is the
   * proportion of 1-samples; for an 8-bit fixture it is over all eight bits.
   */
  bitBalance: number;
  /** Present only for binary (1-bit) samples, where runs of samples mean runs of bits. */
  runs: RunLengthHistogram | null;
  /** Pearson autocorrelation at each requested lag, over the sample sequence. */
  autocorrelation: Array<{ lag: number; r: number }>;
  /** The longest repeated block found, or null. */
  repeatedBlock: RepeatedBlock | null;
}

/** The hard cap on what the browser will analyse, in bytes. */
export const INPUT_SIZE_CAP = 16 * 1024 * 1024;

export class InputTooLargeError extends Error {
  readonly size: number;
  constructor(size: number) {
    super(
      `input is ${size} bytes, over the ${INPUT_SIZE_CAP}-byte cap for in-browser analysis`
    );
    this.name = 'InputTooLargeError';
    this.size = size;
  }
}

/**
 * Proportion of set bits in the BIT STRING the samples form.
 *
 * `bitsPerSymbol` is required, and getting it wrong is the trap this signature
 * exists to close. The NIST tool forms its bit-string branch by taking the low
 * `bits_per_symbol` bits of each sample, so that is the bit string a reader is
 * looking at — and for a one-sample-per-byte binary file it is ONE bit per
 * byte, not eight. Counting all eight divides the true balance by eight and
 * reports a perfectly fair source as 6% ones.
 */
export function bitBalance(data: Uint8Array, bitsPerSymbol: number): number {
  if (!Number.isInteger(bitsPerSymbol) || bitsPerSymbol < 1 || bitsPerSymbol > 8) {
    throw new RangeError(`bitsPerSymbol must be an integer in 1..8, got ${bitsPerSymbol}`);
  }
  if (data.length === 0) return 0;
  const mask = bitsPerSymbol === 8 ? 0xff : (1 << bitsPerSymbol) - 1;
  let ones = 0;
  for (let i = 0; i < data.length; i++) {
    let b = data[i] & mask;
    while (b) {
      ones += b & 1;
      b >>= 1;
    }
  }
  return ones / (data.length * bitsPerSymbol);
}

/**
 * Run lengths over a binary sample stream (one sample per byte, 0 or 1).
 *
 * `cap` bounds the histogram's length; runs longer than it are counted in the
 * last bucket. Without a cap a stuck-bit file would allocate an array as long
 * as itself.
 */
export function runLengths(samples: Uint8Array, cap = 64): RunLengthHistogram {
  const ones = new Array<number>(cap + 1).fill(0);
  const zeros = new Array<number>(cap + 1).fill(0);
  let longestOnes = 0;
  let longestZeros = 0;
  let totalRuns = 0;
  let i = 0;
  while (i < samples.length) {
    const v = samples[i] !== 0 ? 1 : 0;
    let n = 0;
    while (i < samples.length && (samples[i] !== 0 ? 1 : 0) === v) {
      n++;
      i++;
    }
    totalRuns++;
    const bucket = Math.min(n, cap);
    if (v === 1) {
      ones[bucket]++;
      if (n > longestOnes) longestOnes = n;
    } else {
      zeros[bucket]++;
      if (n > longestZeros) longestZeros = n;
    }
  }
  return { ones, zeros, longestOnes, longestZeros, totalRuns };
}

/**
 * Pearson autocorrelation of the sample sequence at lag k.
 *
 * Returns 0 when the sample variance is 0, which is the all-identical case —
 * correlation is undefined there and the alternative is a NaN that would
 * render as "NaN" on the page. The lab says "undefined (constant input)"
 * rather than printing a zero that looks like independence.
 */
export function autocorrelation(samples: Uint8Array, lag: number): number {
  const n = samples.length - lag;
  if (lag <= 0 || n <= 1) return 0;
  let sx = 0;
  for (let i = 0; i < samples.length; i++) sx += samples[i];
  const mean = sx / samples.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const a = samples[i] - mean;
    const b = samples[i + lag] - mean;
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/** True when every sample is identical, so correlation is undefined. */
export function isConstant(samples: Uint8Array): boolean {
  if (samples.length === 0) return true;
  const first = samples[0];
  for (let i = 1; i < samples.length; i++) if (samples[i] !== first) return false;
  return true;
}

/**
 * Search for a repeated block of `blockLength` samples by hashing every
 * window into a map keyed on its content.
 *
 * Rolling-hash candidates are confirmed by a full byte comparison, so a hash
 * collision cannot produce a false report — a false "repeated block" finding
 * in a lab about evidence would be the worst possible defect.
 */
export function findRepeatedBlock(
  samples: Uint8Array,
  blockLength: number
): RepeatedBlock | null {
  if (blockLength <= 0 || samples.length < blockLength * 2) return null;
  const seen = new Map<string, number>();
  // A 32-bit FNV-1a over the window, recomputed per window. Windows are short
  // (the UI offers 16-4096) and this stays well inside the worker's budget.
  for (let o = 0; o + blockLength <= samples.length; o++) {
    let h = 0x811c9dc5;
    for (let i = 0; i < blockLength; i++) {
      h ^= samples[o + i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const key = String(h);
    const prev = seen.get(key);
    if (prev !== undefined) {
      let same = true;
      for (let i = 0; i < blockLength; i++) {
        if (samples[prev + i] !== samples[o + i]) {
          same = false;
          break;
        }
      }
      if (same) return { blockLength, firstOffset: prev, secondOffset: o };
    } else {
      seen.set(key, o);
    }
  }
  return null;
}

export interface DescriptiveOptions {
  bitsPerSymbol: number;
  lags: number[];
  repeatedBlockLength: number;
  /** Called with 0..1 as the analysis proceeds. */
  onProgress?: (fraction: number) => void;
  /** Checked between stages; throwing from it cancels the run. */
  checkCancelled?: () => void;
}

export const DESCRIPTIVE_DEFAULTS: Omit<DescriptiveOptions, 'bitsPerSymbol'> = {
  lags: [1, 2, 3, 4, 8, 16, 32],
  repeatedBlockLength: 256,
};

/** Every descriptive statistic the lab shows, computed in one pass per stage. */
export function describe(samples: Uint8Array, opts: DescriptiveOptions): DescriptiveStats {
  if (samples.length > INPUT_SIZE_CAP) throw new InputTooLargeError(samples.length);
  const step = (f: number): void => {
    opts.checkCancelled?.();
    opts.onProgress?.(f);
  };

  step(0);
  const counts = new Float64Array(256);
  for (let i = 0; i < samples.length; i++) counts[samples[i]]++;
  const symbolCounts: Array<{ value: number; count: number }> = [];
  let mode = 0;
  let modeCount = -1;
  for (let v = 0; v < 256; v++) {
    if (counts[v] === 0) continue;
    symbolCounts.push({ value: v, count: counts[v] });
    if (counts[v] > modeCount) {
      modeCount = counts[v];
      mode = v;
    }
  }
  step(0.3);

  const balance = bitBalance(samples, opts.bitsPerSymbol);
  step(0.45);

  const binary = opts.bitsPerSymbol === 1;
  const runs = binary ? runLengths(samples) : null;
  step(0.6);

  const constant = isConstant(samples);
  const autocorr = opts.lags.map((lag) => ({
    lag,
    r: constant ? Number.NaN : autocorrelation(samples, lag),
  }));
  step(0.8);

  const repeatedBlock = findRepeatedBlock(samples, opts.repeatedBlockLength);
  step(1);

  return {
    sampleCount: samples.length,
    bitsPerSymbol: opts.bitsPerSymbol,
    symbolCounts,
    distinctSymbols: symbolCounts.length,
    mostCommon: {
      value: mode,
      count: samples.length === 0 ? 0 : modeCount,
      proportion: samples.length === 0 ? 0 : modeCount / samples.length,
    },
    bitBalance: balance,
    runs,
    autocorrelation: autocorr,
    repeatedBlock,
  };
}
