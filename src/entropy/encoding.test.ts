import { describe, expect, it } from 'vitest';
import {
  IncompleteSampleError,
  distinctSymbols,
  narrowestWidth,
  packBits,
  unpackBits,
} from './encoding.ts';

const bits = (s: string): Uint8Array => Uint8Array.from(s, (c) => (c === '1' ? 1 : 0));

describe('packed bits and one-sample-per-byte are different inputs', () => {
  it('packs msb-first so the first sample is the high bit', () => {
    expect(packBits(bits('10000000'))[0]).toBe(0x80);
    expect(packBits(bits('00000001'))[0]).toBe(0x01);
    expect(packBits(bits('10110001'))[0]).toBe(0xb1);
  });

  it('packs lsb-first the other way, which is a DIFFERENT file', () => {
    expect(packBits(bits('10000000'), 'lsb-first')[0]).toBe(0x01);
    expect(packBits(bits('10110001'), 'lsb-first')[0]).toBe(0x8d);
    // The two orders are not the same bytes. This is why bit order is recorded
    // in every manifest instead of being left to a convention.
    expect(packBits(bits('10110001'))[0]).not.toBe(packBits(bits('10110001'), 'lsb-first')[0]);
  });

  it('round-trips for both orders across a range of lengths', () => {
    for (const order of ['msb-first', 'lsb-first'] as const) {
      for (const n of [8, 16, 64, 1000, 4096]) {
        const s = Uint8Array.from({ length: n }, (_, i) => ((i * 7 + (i >> 3)) & 1) as 0 | 1);
        expect(Array.from(unpackBits(packBits(s, order), n, order)), `${order} n=${n}`).toEqual(
          Array.from(s)
        );
      }
    }
  });

  /**
   * THE EDGE CASE THAT MOTIVATES THE WHOLE MODULE. A 1,000,000-sample packed
   * file is 125,000 bytes. Read as byte samples it is 125,000 samples — one
   * eighth as many, and below the assessment minimum — not 1,000,000.
   */
  it('shows the sample-count collapse that reading packed bytes as samples causes', () => {
    const samples = 1_000_000;
    const packed = packBits(new Uint8Array(samples));
    expect(packed.length).toBe(125_000);
    expect(unpackBits(packed, samples).length).toBe(samples);
    expect(packed.length).toBe(samples / 8);
  });
});

describe('the incomplete final sample is never handled silently', () => {
  it('rejects by default, naming the remainder', () => {
    let caught: unknown;
    try {
      packBits(bits('1011'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IncompleteSampleError);
    expect((caught as IncompleteSampleError).remainder).toBe(4);
    expect((caught as Error).message).toContain('4 leftover bits');
  });

  it('drops the partial group when asked, producing only whole bytes', () => {
    expect(packBits(bits('101100011'), 'msb-first', 'dropped')).toHaveLength(1);
    expect(packBits(bits('101100011'), 'msb-first', 'dropped')[0]).toBe(0xb1);
  });

  it('pads the partial group with zeros when asked, and says so by its length', () => {
    const out = packBits(bits('101100011'), 'msb-first', 'padded');
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(0xb1);
    expect(out[1]).toBe(0x80); // the stray 1, then zero padding
  });

  it('refuses to invent samples that a packed file does not record', () => {
    // One byte holds at most 8 samples. Asking for 9 must fail rather than
    // reading past the end and reporting a 9-sample assessment.
    expect(() => unpackBits(new Uint8Array(1), 9)).toThrow(RangeError);
    expect(() => unpackBits(new Uint8Array(1), -1)).toThrow(RangeError);
  });
});

describe('symbol width', () => {
  it('counts the distinct values actually present', () => {
    expect(distinctSymbols(Uint8Array.from([0, 0, 1, 1]))).toBe(2);
    expect(distinctSymbols(Uint8Array.from([5]))).toBe(1);
    expect(distinctSymbols(new Uint8Array(0))).toBe(0);
    expect(distinctSymbols(Uint8Array.from({ length: 256 }, (_, i) => i))).toBe(256);
  });

  it('reports the narrowest width that represents the data', () => {
    expect(narrowestWidth(Uint8Array.from([0, 1]))).toBe(1);
    expect(narrowestWidth(Uint8Array.from([0, 0]))).toBe(1);
    expect(narrowestWidth(Uint8Array.from([3]))).toBe(2);
    expect(narrowestWidth(Uint8Array.from([4]))).toBe(3);
    expect(narrowestWidth(Uint8Array.from([255]))).toBe(8);
  });
});
