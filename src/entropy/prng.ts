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

export interface Rng {
  /** Next 32-bit word. */
  u32(): number;
  /** Uniform in [0, 1). 24 bits of mantissa, so the value is exactly representable. */
  unit(): number;
  /** Standard normal, Box-Muller. Both of each pair are used; none is discarded. */
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

  let spare: number | null = null;

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
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      // Box-Muller needs u1 strictly greater than 0 for the logarithm. `unit()`
      // can return exactly 0, so it is resampled rather than nudged: nudging
      // would put a spike at one extreme of the distribution.
      let u1 = 0;
      while (u1 === 0) u1 = this.unit();
      const u2 = this.unit();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      spare = r * Math.sin(theta);
      return r * Math.cos(theta);
    },
  };
}
