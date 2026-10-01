/**
 * A deterministic PRNG for FIXTURE GENERATION ONLY.
 *
 * Nothing here is a source of cryptographic randomness and nothing in this lab
 * pretends otherwise. Its one job is reproducibility: every fixture this repo
 * ships must regenerate byte-for-byte from `scripts/gen-fixtures.mjs` on any
 * machine, because CI reruns the generator and compares SHA-256 against the
 * manifest. A fixture seeded from `crypto.getRandomValues()` could never be
 * checked that way.
 *
 * xoshiro128** (Blackman & Vigna) over 32-bit words, seeded through splitmix32.
 * Both are written out in full rather than imported so the generator has no
 * dependency a reader has to go and audit elsewhere.
 */

/** splitmix32 — used only to expand a single seed word into xoshiro's state. */
export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Uniforms summed per normal draw. 12 makes the variance exactly 1. */
export const IRWIN_HALL_N = 12;

export interface Rng {
  /** Next 32-bit word. */
  u32(): number;
  /** Uniform in [0, 1). 24 bits of mantissa, so the value is exactly representable. */
  unit(): number;
  /**
   * An approximately standard normal variate, mean 0 and variance exactly 1.
   *
   * IRWIN-HALL, NOT BOX-MULLER, AND THE REASON IS REPRODUCIBILITY RATHER THAN
   * TASTE. Box-Muller needs `Math.log`, `Math.sin` and `Math.cos`, and
   * ECMAScript does NOT require those to be correctly rounded: the spec calls
   * them implementation-approximated, so two conforming engines may return
   * results differing in the last bit, and two versions of the same engine may
   * too. Only `+ - * /` and `Math.sqrt` are exactly specified.
   *
   * That is not a theoretical concern here, it is a bug this repository
   * actually shipped. The modular-multiplication map is CHAOTIC by design --
   * amplifying a tiny perturbation into a decided bit is the whole point of
   * the circuit -- so a single differing ulp anywhere in the stream diverges
   * every sample after it. The `inm-conditioned-keccak` fixture, which draws
   * eight million samples, regenerated to completely different bytes on the
   * Linux CI runner than on the machine that first measured it, and the
   * independent fixture check caught it. `inm-clean` survived only because its
   * first million samples happened to fall inside the agreeing prefix, which
   * is luck rather than safety.
   *
   * Summing `IRWIN_HALL_N` uniforms and subtracting N/2 uses only addition and
   * subtraction of exactly-representable values, so it is bit-identical on
   * every conforming engine. The cost is the tails: this distribution is
   * supported on [-6, 6] rather than all of R, and is a 12-fold convolution of
   * uniforms rather than a true Gaussian. For noise injected at a standard
   * deviation of 1/1024 into a chaotic map that is immaterial -- and it is a
   * far smaller divergence from the hardware than the one this lab already
   * documents, since the vendor's own simulation injects UNIFORM noise.
   */
  normal(): number;
}

/**
 * xoshiro128** seeded from `seed`.
 *
 * The seed is a plain integer and appears verbatim in the fixture manifest, so
 * the stream behind every shipped fixture is a published fact rather than a
 * detail of whichever machine happened to run the generator.
 */
export function xoshiro128ss(seed: number): Rng {
  const sm = splitmix32(seed);
  let s0 = sm();
  let s1 = sm();
  let s2 = sm();
  let s3 = sm();
  // An all-zero state is a fixed point of xoshiro; splitmix32 makes that
  // astronomically unlikely rather than impossible, so it is ruled out here.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const u32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  const unit = (): number => (u32() >>> 8) / 16777216;

  return {
    u32,
    unit,
    normal(): number {
      // Only `+` and `-`, on values that are exact multiples of 2^-24. Every
      // intermediate is exactly representable in a double, so this returns
      // bit-identical results on any conforming engine.
      let sum = 0;
      for (let i = 0; i < IRWIN_HALL_N; i++) sum += unit();
      return sum - IRWIN_HALL_N / 2;
    },
  };
}
