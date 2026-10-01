/**
 * THE ONE THRESHOLD THIS LAB PINS, AND THE MEASUREMENTS BEHIND IT.
 *
 * The headline experiment asks whether a stream whose every byte is published
 * can receive a min-entropy estimate that looks like evidence of
 * unpredictability. Answering it needs a line to call "high" — and the honest
 * order of operations is to measure first and draw the line afterwards, which
 * is what happened.
 *
 * THE MEASUREMENTS. Taken on 2026-10-01 by `scripts/assess-fixtures.ts`,
 * reading `ea_non_iid`'s own JSON report for each file. Assessed min-entropy,
 * normalised to BITS PER BIT (the tool's `hAssessed / dataWordSize`, so a
 * 1-bit and an 8-bit fixture can be set side by side):
 *
 *     counter-hash-sha256       0.919220   published construction, predictable
 *     inm-conditioned-keccak    0.912799   the modelled source, conditioned
 *     fault-predictable (LFSR)  0.833849   32 bits of state, no physical noise
 *     fault-periodic            0.618747
 *     fault-stuck-bit           0.403581
 *     inm-clean                 0.372625   the modelled physical source
 *     fault-bias                0.208012
 *     fault-repeated-block      0.000006
 *     exploratory-short         no assessment: below the sample minimum
 *     all-zero                  no assessment: a one-symbol alphabet
 *
 * THE LINE, DRAWN AFTER READING THAT COLUMN: 0.75 bits per bit, three
 * quarters of the per-bit maximum. It separates the three streams a reader
 * would call "scores well" — the published counter-hash, the LFSR, and the
 * conditioned output — from the modelled physical source itself, which does
 * not reach it. That separation is the finding, and it runs the opposite way
 * to the intuition the lab exists to correct.
 *
 * `e2e/claims.spec.ts` pins this constant, so moving it is a visible edit to a
 * tested claim rather than a quiet re-tuning.
 */

/** "High" for the headline experiment, in bits of min-entropy per bit. */
export const HIGH_ESTIMATE_BITS_PER_BIT = 0.75;

/** SP 800-90B Section 3.1.1's minimum sample count for a full assessment. */
export const SAMPLE_MINIMUM = 1_000_000;

/**
 * The number of estimators SP 800-90B 6.2 takes the minimum across. A run
 * reporting fewer than this in a branch that needs them is labelled "partial"
 * everywhere it appears (invariant I2).
 */
export const NON_IID_ESTIMATOR_COUNT = 10;

/** Does this assessed figure clear the line the lab calls "high"? */
export function isHighEstimate(assessedBitsPerBit: number | null): boolean {
  return assessedBitsPerBit !== null && assessedBitsPerBit >= HIGH_ESTIMATE_BITS_PER_BIT;
}
