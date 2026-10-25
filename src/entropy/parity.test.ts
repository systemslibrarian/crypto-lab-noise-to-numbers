import { expect, test } from 'vitest';
import { markovParity } from './parity';

// Independent path enumeration on the augmented (last bit, parity) space.
for (const [a, b] of [[75, 25], [90, 90], [10, 10], [60, 15], [100, 100], [0, 0]]) {
  test(`signed-kernel probabilities equal exhaustive paths for ${a}/${b}`, () => {
    for (const initial of ['fair', 'zero', 'one'] as const) {
      const rows = markovParity(a, b, 8, initial).rows;
      for (const row of rows) {
        let even = 0n, odd = 0n;
        for (const x0 of [0, 1]) {
          const weight = initial === 'fair' ? 1n : initial === (x0 === 0 ? 'zero' : 'one') ? 2n : 0n;
          for (let path = 0; path < 2 ** row.n; path++) {
            let last = x0, parity = 0, probability = weight;
            for (let i = 0; i < row.n; i++) {
              const next = (path >> i) & 1;
              probability *= BigInt(last === 0 ? (next === 0 ? a : 100 - a) : (next === 1 ? b : 100 - b));
              last = next; parity ^= next;
            }
            if (parity === 0) even += probability; else odd += probability;
          }
        }
        expect(even + odd).toBe(row.denominator);
        expect(even - odd).toBe(row.numerator);
        expect(even * 2n).toBe(row.zeroNumerator);
        const absolute = row.numerator < 0n ? -row.numerator : row.numerator;
        expect(absolute * row.boundDenominator <= row.boundNumerator * row.denominator).toBe(true);
      }
    }
  });
}
test('balanced memory gives zero odd bias and an even-length rebound', () => {
  expect(markovParity(90, 90, 4, 'fair').rows.map(x => x.bias)).toEqual([0, 0.8, 0, 0.64]);
  expect(markovParity(10, 10, 4, 'fair').rows.map(x => x.bias)).toEqual([0, -0.8, 0, 0.64]);
  for (const row of markovParity(75, 25, 16, 'fair').rows) expect(row.bias).toBe(0.5 ** row.n);
});
test('rejects an unbounded block or malformed probability', () => {
  expect(() => markovParity(101, 0, 4, 'fair')).toThrow();
  expect(() => markovParity(50, 50, 17, 'fair')).toThrow();
  expect(() => markovParity(NaN, 50, 4, 'fair')).toThrow();
});
