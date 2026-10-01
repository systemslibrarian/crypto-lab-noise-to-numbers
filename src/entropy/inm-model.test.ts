import { describe, expect, it } from 'vitest';
import { xoshiro128ss } from './prng.ts';
import { INM_DEFAULTS, INM_K, designEntropyRate, generateInmSamples, inmStep } from './inm-model.ts';
import { autocorrelation, bitBalance } from './descriptive.ts';

describe('the vendor’s theoretical design rate', () => {
  /**
   * The infnoise README (13-37-org/infnoise @ 40ecf21) states it twice: entropy
   * "approximately equal to log2(K) per clock", and "All three boards should
   * produce log2(1.82) = 0.864 bits of entropy per bit by design."
   */
  it('is log2(K), and log2(1.82) is the 0.864 the vendor quotes', () => {
    expect(INM_K).toBe(1.82);
    expect(designEntropyRate(INM_K)).toBeCloseTo(0.864, 3);
  });

  it('is a DESIGN rate, so it is strictly below 1 bit per bit', () => {
    // A design rate of 1 would mean the loop needed no whitening at all, which
    // is the opposite of what the vendor documents.
    expect(designEntropyRate(INM_K)).toBeLessThan(1);
    expect(designEntropyRate(2)).toBe(1);
  });
});

describe('the modular-multiplication loop', () => {
  it('emits 1 when the noisy state exceeds the threshold, and folds it back down', () => {
    const s = new Float64Array([0.9]);
    expect(inmStep(s, INM_DEFAULTS, 0)).toBe(1);
    // A = K*0.9 - (K-1) = 1.638 - 0.82 = 0.818
    expect(s[0]).toBeCloseTo(0.818, 12);
  });

  /**
   * The zero branch applies the noise a SECOND time before multiplying. That
   * asymmetry is in the vendor's `updateA()` and is load-bearing: this test is
   * what catches a future "cleanup" that removes it.
   */
  it('applies the noise twice on the zero branch, as the vendor’s source does', () => {
    const s = new Float64Array([0.1]);
    expect(inmStep(s, INM_DEFAULTS, 0.01)).toBe(0);
    // A = K * (0.1 + 0.01 + 0.01) = 1.82 * 0.12
    expect(s[0]).toBeCloseTo(1.82 * 0.12, 12);
    // Had the noise been applied once it would be 1.82 * 0.11.
    expect(s[0]).not.toBeCloseTo(1.82 * 0.11, 6);
  });

  it('clamps the state into [0,1] at the top of the call, not the bottom', () => {
    const high = new Float64Array([5]);
    inmStep(high, INM_DEFAULTS, 0);
    // Clamped to 1, then 1 > 0.5, so A = K*1 - (K-1) = 1.
    expect(high[0]).toBeCloseTo(1, 12);
    const low = new Float64Array([-5]);
    expect(inmStep(low, INM_DEFAULTS, 0)).toBe(0);
    expect(low[0]).toBeCloseTo(0, 12);
  });

  it('is reproducible for a given seed, which is what makes a fixture a fixture', () => {
    const a = generateInmSamples(5000, xoshiro128ss(42));
    const b = generateInmSamples(5000, xoshiro128ss(42));
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = generateInmSamples(5000, xoshiro128ss(43));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('emits only 0 and 1', () => {
    const s = generateInmSamples(20_000, xoshiro128ss(7));
    expect(new Set(s)).toEqual(new Set([0, 1]));
  });

  it('is roughly balanced at the circuit threshold and skewed away from it', () => {
    const fair = generateInmSamples(200_000, xoshiro128ss(11), INM_DEFAULTS);
    // Measured p(1) across seeds 5/11/42: 0.50052, 0.49888, 0.49985.
    expect(bitBalance(fair, 1)).toBeGreaterThan(0.49);
    expect(bitBalance(fair, 1)).toBeLessThan(0.51);
    // Moving the threshold UP biases the output toward ONE, which is the
    // opposite of the obvious guess and worth having a test say out loud.
    // The zero branch multiplies by K without the fold-down the one branch
    // applies, so widening it pushes the state back above the threshold
    // faster than it holds it below. Measured p(1) at threshold 0.58: 0.763.
    const skewed = generateInmSamples(200_000, xoshiro128ss(11), { ...INM_DEFAULTS, threshold: 0.58 });
    expect(bitBalance(skewed, 1)).toBeGreaterThan(0.7);
    // The claim the fault fixture actually rests on: the output is further
    // from balanced than the clean model's, whichever way it leans.
    expect(Math.abs(bitBalance(skewed, 1) - 0.5)).toBeGreaterThan(
      Math.abs(bitBalance(fair, 1) - 0.5)
    );
  });

  /**
   * The width argument is not decoration. A 1-bit sample stream carries ONE
   * bit per byte; counting all eight reports a fair source as 6% ones, which
   * is the shape of a real reporting bug rather than a rounding difference.
   */
  it('reads as fair at width 1 and as one-eighth of that if the width is wrong', () => {
    const s = generateInmSamples(50_000, xoshiro128ss(3));
    expect(bitBalance(s, 1)).toBeCloseTo(8 * bitBalance(s, 8), 12);
    expect(bitBalance(s, 8)).toBeLessThan(0.1);
  });

  /**
   * The vendor says so in as many words: "Adjacent bits from a modular entropy
   * multiplier are correlated, so whitening is required." That correlation is
   * why this design is assessed on the NON-IID track, and it should be visible
   * in the model's own output rather than merely asserted in the prose.
   */
  it('produces correlated adjacent samples, which is why the non-IID track applies', () => {
    const s = generateInmSamples(200_000, xoshiro128ss(5));
    // MEASURED, and the direction is worth stating because it is not the one
    // most readers assume: this map's adjacent samples are ANTI-correlated.
    // lag-1 r is -0.256 / -0.256 / -0.256 across seeds 5/11/42, and lag-2 is
    // about -0.131. Negative correlation is still correlation, and it is still
    // enough to disqualify the IID track. The magnitude is asserted, not the
    // sign-free hope that "adjacent bits agree more often".
    const r1 = autocorrelation(s, 1);
    expect(r1).toBeLessThan(-0.2);
    expect(Math.abs(r1)).toBeGreaterThan(0.2);
    expect(Math.abs(autocorrelation(s, 2))).toBeGreaterThan(0.1);
  });

  /**
   * The one deliberate divergence from the vendor's own simulation is the
   * noise SHAPE: bell-shaped here, uniform there. Measured side by side, the
   * correlation structure is the map's property and not the noise's: uniform
   * gives lag-1 -0.262 against the model's -0.256. So the divergence is
   * documented, and it is also shown not to be what produces the lab's
   * central observation.
   */
  it('shows the correlation comes from the map, not from the noise shape', () => {
    const gaussian = generateInmSamples(200_000, xoshiro128ss(5), INM_DEFAULTS);
    const uniform = ((): Uint8Array => {
      const rng = xoshiro128ss(5);
      const out = new Uint8Array(200_000);
      const st = new Float64Array([INM_DEFAULTS.initialA]);
      const draw = (): number => (rng.unit() - 0.5) * INM_DEFAULTS.noiseSigma * 2;
      for (let i = 0; i < INM_DEFAULTS.warmup; i++) inmStep(st, INM_DEFAULTS, draw());
      for (let i = 0; i < out.length; i++) out[i] = inmStep(st, INM_DEFAULTS, draw());
      return out;
    })();
    expect(autocorrelation(uniform, 1)).toBeCloseTo(autocorrelation(gaussian, 1), 1);
  });
});
