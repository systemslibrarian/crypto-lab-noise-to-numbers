/** Exact first-order binary Markov parity via the signed kernel P diag(1,-1).
 * Skorski & Mittmann, ePrint 2026/2417, Theorem III.1 / Corollary III.7.
 * Inputs are integer percentages; all probability arithmetic uses BigInt.
 */
export function markovParity(hold0: number, hold1: number, n: number, initial: 'fair' | 'zero' | 'one') {
  for (const p of [hold0, hold1]) if (!Number.isInteger(p) || p < 0 || p > 100) throw new Error('holding probabilities must be integer percentages');
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error('block length must be 1–16');
  if (!['fair', 'zero', 'one'].includes(initial)) throw new Error('unknown initial law');
  const a = BigInt(hold0), b = BigInt(hold1);
  let signed = initial === 'fair' ? [1n, 1n] : initial === 'zero' ? [2n, 0n] : [0n, 2n];
  let marginal = [...signed];
  let denominator = 2n, independentNumerator = 1n, independentDenominator = 1n;
  const rows = [];
  const beta = BigInt(Math.max(Math.abs(2 * hold0 - 100), Math.abs(100 - 2 * hold1)));
  for (let step = 1; step <= n; step++) {
    signed = [signed[0] * a + signed[1] * (100n - b), -(signed[0] * (100n - a) + signed[1] * b)];
    marginal = [marginal[0] * a + marginal[1] * (100n - b), marginal[0] * (100n - a) + marginal[1] * b];
    denominator *= 100n;
    const numerator = signed[0] + signed[1];
    independentNumerator *= marginal[0] - marginal[1];
    independentDenominator *= denominator;
    rows.push({ n: step, numerator, denominator,
      bias: Number(numerator) / Number(denominator),
      independent: Number(independentNumerator) / Number(independentDenominator),
      zeroNumerator: denominator + numerator, probabilityDenominator: 2n * denominator,
      boundNumerator: beta ** BigInt(Math.ceil(step / 2)), boundDenominator: 100n ** BigInt(Math.ceil(step / 2)),
    });
  }
  return { rows, beta: Number(beta) / 100 };
}
