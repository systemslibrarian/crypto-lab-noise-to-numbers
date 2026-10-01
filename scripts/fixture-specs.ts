/**
 * THE FIXTURE SPECIFICATIONS — the single source of truth for what this lab
 * ships and how each file was made.
 *
 * `gen-fixtures.ts` builds every file from this list, `assess-fixtures.ts`
 * runs the pinned NIST tool over them and records what it measured, and
 * `verify-fixtures.ts` (the CI job) rebuilds and re-measures and fails on any
 * disagreement with the manifest. Nothing about a fixture is written by hand.
 *
 * EVERY FIXTURE IN v1 IS SIMULATED OR DETERMINISTIC. None is a capture from
 * hardware. The `provenance` field says which, and the lab badges it.
 */

/** Samples in a full fixture. SP 800-90B 3.1.1's minimum for an assessment. */
export const FULL_SAMPLES = 1_000_000;

export type Provenance = 'simulated' | 'deterministic';

export interface FixtureSpec {
  id: string;
  title: string;
  /** One sentence, mechanism-first, for the UI. */
  blurb: string;
  provenance: Provenance;
  bitsPerSymbol: number;
  sampleCount: number;
  /** How the shipped file is laid out. */
  shippedForm: 'packed-bits' | 'one-sample-per-byte';
  /** Which act of the lab this fixture belongs to. */
  act: number;
  /** Set for the five fault variants, naming the clean fixture they vary. */
  variantOf?: string;
  /** The seed, where one applies. Published so the stream is a known fact. */
  seed?: number;
  /** Prose the manifest carries describing exactly how it was built. */
  procedure: string;
}

export const FIXTURES: FixtureSpec[] = [
  {
    id: 'inm-clean',
    title: 'Modelled raw noise',
    blurb:
      'The modular-multiplication loop at the vendor’s design gain, with bell-shaped noise injected at each step.',
    provenance: 'simulated',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 2,
    seed: 20261001,
    procedure:
      'generateInmSamples(1000000, xoshiro128ss(20261001), {k: 1.82, noiseSigma: 1/1024, ' +
      'threshold: 0.5, initialA: 0.3141592653589793, warmup: 32}), then packBits(msb-first).',
  },
  {
    id: 'fault-stuck-bit',
    title: 'Fault: stuck bit',
    blurb:
      'The same loop, then every eighth sample forced high — the 0x10 bit of each packed byte shorted.',
    provenance: 'simulated',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 4,
    variantOf: 'inm-clean',
    seed: 20261001,
    procedure:
      'inm-clean’s sample stream, then every sample whose index is congruent to 3 mod 8 ' +
      'is set to 1. Under msb-first packing that is the 0x10 bit of every byte stuck high.',
  },
  {
    id: 'fault-bias',
    title: 'Fault: biased comparator',
    blurb: 'The comparator threshold drifted from 0.5 to 0.58, so ones and zeros stop being equally likely.',
    provenance: 'simulated',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 4,
    variantOf: 'inm-clean',
    seed: 20261001,
    procedure:
      'generateInmSamples with the same seed and gain as inm-clean but threshold 0.58, then packBits(msb-first).',
  },
  {
    id: 'fault-periodic',
    title: 'Fault: periodic contamination',
    blurb: 'A fixed 13-sample pattern overwrites every fourth sample, the shape of a coupled clock.',
    provenance: 'simulated',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 4,
    variantOf: 'inm-clean',
    seed: 20261001,
    procedure:
      'inm-clean’s sample stream, then for every index i divisible by 4 the sample is replaced ' +
      'by PATTERN[(i/4) mod 13] where PATTERN = 1011010011100.',
  },
  {
    id: 'fault-repeated-block',
    title: 'Fault: repeated block',
    blurb: 'The first 65,536 samples repeated to fill the file, the shape of a source that reset.',
    provenance: 'simulated',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 4,
    variantOf: 'inm-clean',
    seed: 20261001,
    procedure:
      'the first 65536 samples of inm-clean, tiled to 1000000 samples (the final tile is truncated), ' +
      'then packBits(msb-first).',
  },
  {
    id: 'fault-predictable',
    title: 'Fault: predictable sequence',
    blurb:
      'A 32-bit maximal-length LFSR: no physical noise at all, and every bit computable from 32 of its predecessors.',
    provenance: 'deterministic',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 4,
    variantOf: 'inm-clean',
    seed: 0x1337c0de,
    procedure:
      'a Fibonacci LFSR over 32 bits with taps 32, 22, 2, 1 (x^32 + x^22 + x^2 + x + 1), state ' +
      'initialised to 0x1337c0de, emitting the low bit of the state each step, then packBits(msb-first).',
  },
  {
    id: 'exploratory-short',
    title: 'Below the minimum',
    blurb:
      'Fifty thousand samples — a twentieth of what SP 800-90B 3.1.1 requires, kept to show what the tool does about it.',
    provenance: 'simulated',
    bitsPerSymbol: 1,
    sampleCount: 50_000,
    shippedForm: 'packed-bits',
    act: 3,
    seed: 777,
    procedure:
      'generateInmSamples(50000, xoshiro128ss(777), inm-clean’s parameters), then packBits(msb-first).',
  },
  {
    id: 'all-zero',
    title: 'Every sample the same',
    blurb:
      'A million zero samples — a full-size file with a one-symbol alphabet, which the tool refuses for a different reason than a short one.',
    provenance: 'deterministic',
    bitsPerSymbol: 1,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'packed-bits',
    act: 3,
    procedure:
      'one million zero samples, then packBits(msb-first). There is no generator state and no ' +
      'seed: the file is 125000 zero bytes. It meets the sample minimum and is still refused, ' +
      'because an alphabet of one symbol carries no entropy to estimate.',
  },
  {
    id: 'counter-hash-sha256',
    title: 'Counter-hash stream',
    blurb:
      'SHA-256 over an incrementing counter. Published in full, reproducible by anyone, and predictable to all of them.',
    provenance: 'deterministic',
    bitsPerSymbol: 8,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'one-sample-per-byte',
    act: 5,
    procedure:
      'the concatenation of SHA-256(LE64(i)) for i = 0, 1, 2, ... truncated to 1000000 bytes. ' +
      'LE64 is the 8-byte little-endian encoding of the counter.',
  },
  {
    id: 'inm-conditioned-keccak',
    title: 'Conditioned output',
    blurb:
      'The modelled raw noise pushed through the driver’s Keccak sponge at the default output multiplier of 2.',
    provenance: 'simulated',
    bitsPerSymbol: 8,
    sampleCount: FULL_SAMPLES,
    shippedForm: 'one-sample-per-byte',
    act: 5,
    seed: 20261001,
    procedure:
      '8000000 samples of inm-clean’s model (same seed and parameters), packed msb-first to ' +
      '1000000 bytes, then pushed through infnoiseSponge(outputMultiplier = 2): each call absorbs ' +
      '512 raw bits into a zero-initialised Keccak-f[1600] state and squeezes 512 conditioned bits.',
  },
];

export const BY_ID: Map<string, FixtureSpec> = new Map(FIXTURES.map((f) => [f.id, f]));
