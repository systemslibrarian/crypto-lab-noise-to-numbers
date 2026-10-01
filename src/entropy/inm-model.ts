/**
 * A SOFTWARE MODEL of the modular entropy multiplier loop. Not hardware, and
 * not a capture from hardware.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS IS A MODEL. Every fixture built from it carries the `simulated`
 * provenance class, and the lab labels it as a model everywhere it appears.
 * A model can only ever tell you about itself; it is here so the assessment
 * pipeline has something honest to chew on before hardware arrives.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The loop is transcribed from the vendor's own simulation, `updateA()` in
 * `software/healthcheck.c` of 13-37-org/infnoise at commit
 * 40ecf21d2318cfe213f56d72296653e6439860e9:
 *
 *     static inline bool updateA(double *A, double K, double noise) {
 *         if(*A > 1.0)      { *A = 1.0; }
 *         else if (*A < 0.0){ *A = 0.0; }
 *         *A += noise;
 *         if(*A > 0.5) { *A = K**A - (K-1); return true; }
 *         *A += noise;
 *         *A = K**A;
 *         return false;
 *     }
 *
 * Two properties of that transcription are worth stating because they are
 * easy to "tidy" into something that is no longer the vendor's circuit:
 *
 *  1. THE NOISE IS ADDED TWICE ON THE ZERO BRANCH. The `else` path applies
 *     `noise` a second time before multiplying. That asymmetry is in the
 *     vendor's source, it is not a typo here, and smoothing it out changes the
 *     bias of the output.
 *  2. THE STATE IS CLAMPED AT THE TOP OF THE CALL, not the bottom, so a value
 *     driven out of [0,1] by the multiply is carried into the next call and
 *     clamped there.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE VENDOR'S SIMULATION, AND ONE CONSTRAINT
 * ON HOW IT IS DRAWN.
 *
 * The vendor injects UNIFORM noise, `noiseAmplitude*((rand()/RAND_MAX) - 0.5)`.
 * This model injects BELL-SHAPED noise instead, which is the right shape for
 * the thermal (Johnson-Nyquist) noise the physical circuit actually amplifies.
 * The divergence is recorded in each fixture manifest. It changes the output
 * distribution; it is not a neutral substitution.
 *
 * The draw itself is Irwin-Hall rather than Box-Muller, and that is a
 * REPRODUCIBILITY constraint rather than a modelling choice -- see `prng.ts`.
 * ECMAScript does not require `Math.log`, `Math.sin` or `Math.cos` to be
 * correctly rounded, this map is chaotic, and one differing ulp therefore
 * diverges every sample after it. That is not hypothetical: it broke the
 * eight-million-sample fixture between two engine versions, and the
 * independent fixture check caught it.
 *
 * Measured, the substitution does not disturb what this lab reports: lag-1
 * autocorrelation is -0.256 under Irwin-Hall and -0.262 under the vendor's own
 * uniform noise, so the correlation is a property of the MAP rather than of
 * the noise shape.
 *
 * THE DESIGN ENTROPY RATE IS log2(K) BITS PER BIT, and that is a THEORETICAL
 * DESIGN RATE, not a measurement. The vendor's README (same commit) states it
 * twice: "a provable and easily measured level of entropy based on thermal
 * noise, approximately equal to log2(K) per clock", and "All three boards
 * should produce log2(1.82) = 0.864 bits of entropy per bit by design."
 * Whether a given stream achieves it is the question SP 800-90B exists to
 * answer, and this lab never reports a design rate as if it were an estimate.
 */
import type { Rng } from './prng.ts';

/** The loop gain of the shipped Infinite Noise boards, per the vendor README. */
export const INM_K = 1.82;

/** log2(K): the vendor's theoretical design rate in bits of entropy per bit. */
export function designEntropyRate(k: number): number {
  return Math.log2(k);
}

export interface InmParams {
  /** Loop gain. The vendor's boards are K = 1.82. */
  k: number;
  /** Standard deviation of the injected noise, in units of the state. */
  noiseSigma: number;
  /**
   * Comparator threshold. The circuit's is 0.5. Moving it is how the `bias`
   * fault fixture is built, so it is a parameter rather than a constant.
   */
  threshold: number;
  /** Initial state, clamped into [0,1] on the first call like any other value. */
  initialA: number;
  /**
   * Samples generated and discarded before the first emitted bit, so the
   * output does not depend on where `initialA` happened to start. The vendor's
   * simulation throws away 32; this follows it.
   */
  warmup: number;
}

export const INM_DEFAULTS: InmParams = {
  k: INM_K,
  noiseSigma: 1 / (1 << 10),
  threshold: 0.5,
  initialA: 0.3141592653589793,
  warmup: 32,
};

/**
 * One step of the loop. Returns the emitted bit and leaves the new state in
 * `state[0]`, which keeps the hot path allocation-free for a million samples.
 */
export function inmStep(state: Float64Array, p: InmParams, noise: number): 0 | 1 {
  let a = state[0];
  if (a > 1) a = 1;
  else if (a < 0) a = 0;
  a += noise;
  if (a > p.threshold) {
    a = p.k * a - (p.k - 1);
    state[0] = a;
    return 1;
  }
  // Second noise application: the vendor's zero branch, kept as written.
  a += noise;
  a = p.k * a;
  state[0] = a;
  return 0;
}

/**
 * `count` samples of the model, one sample per byte, each 0x00 or 0x01.
 *
 * One sample per byte is the form the NIST tool reads (it `fread`s straight
 * into a `uint8_t` symbol array), so this is the shape an assessment consumes.
 * The packed-bit form the device would actually emit over the wire is a
 * separate encoding — see `encoding.ts`, and the manifest's encoding block.
 */
export function generateInmSamples(count: number, rng: Rng, p: InmParams = INM_DEFAULTS): Uint8Array {
  const out = new Uint8Array(count);
  const state = new Float64Array(1);
  state[0] = p.initialA;
  for (let i = 0; i < p.warmup; i++) inmStep(state, p, rng.normal() * p.noiseSigma);
  for (let i = 0; i < count; i++) out[i] = inmStep(state, p, rng.normal() * p.noiseSigma);
  return out;
}
