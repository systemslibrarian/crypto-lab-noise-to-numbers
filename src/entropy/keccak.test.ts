import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  BUFLEN,
  INM_ACCURACY,
  KeccakState,
  driverEntropyCeilingBits,
  infnoiseSponge,
  sha3_256,
} from './keccak.ts';
import { INM_K } from './inm-model.ts';

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * THE PERMUTATION'S KNOWN-ANSWER TESTS.
 *
 * SHA3-256 is built from this module's permutation in `sha3_256()`, so these
 * digests exercise theta, rho, pi, chi and iota together. Two independent
 * oracles, deliberately:
 *
 *   - the digests published in FIPS 202 / NIST's CAVP examples, as constants;
 *   - Node's own `crypto.createHash('sha3-256')`, a separate implementation.
 *
 * Either alone would be weaker. A memorized constant could be mis-remembered;
 * an agreement with Node alone proves only that two things agree. Together,
 * a pass means the permutation matches the standard.
 */
describe('Keccak-f[1600] via SHA3-256 known-answer tests', () => {
  const vectors: Array<[string, string]> = [
    ['', 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'],
    ['abc', '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '41c0dba2a9d6240849100376a8235e2c82e1b9998a999e21db32dd97496d3376',
    ],
  ];

  for (const [msg, want] of vectors) {
    it(`matches the published digest for ${msg === '' ? 'the empty string' : `"${msg.slice(0, 16)}${msg.length > 16 ? '...' : ''}"`}`, () => {
      const got = hex(sha3_256(new TextEncoder().encode(msg)));
      expect(got).toBe(want);
      // The second, independent oracle.
      expect(got).toBe(createHash('sha3-256').update(msg).digest('hex'));
    });
  }

  it('agrees with Node across message lengths spanning the rate boundary', () => {
    // Rate is 136 bytes. Lengths either side of 135/136/137 and 271/272/273
    // are where a padding or block-count error shows up and nowhere else.
    for (const n of [1, 134, 135, 136, 137, 200, 271, 272, 273, 400]) {
      const msg = randomBytes(n);
      expect(hex(sha3_256(msg)), `length ${n}`).toBe(
        createHash('sha3-256').update(msg).digest('hex')
      );
    }
  });
});

describe('the designers’ absorb/extract interface', () => {
  it('starts from an all-zero state', () => {
    expect(KeccakState.initialize().toBytes().every((b) => b === 0)).toBe(true);
  });

  it('absorb permutes, so the state is not the XORed input', () => {
    const s = KeccakState.initialize();
    const data = new Uint8Array(64).fill(0xab);
    s.absorb(data, 8);
    // If absorb forgot its permutation the first 64 bytes would be 0xab.
    expect(s.toBytes().slice(0, 64).every((b) => b === 0xab)).toBe(false);
  });

  it('extract does NOT permute, so two extracts without a permute agree', () => {
    const s = KeccakState.initialize();
    s.absorb(new Uint8Array(64).fill(1), 8);
    const first = hex(s.extract(8));
    expect(hex(s.extract(8))).toBe(first);
    // ...and a permute in between is what makes the next squeeze differ. This
    // is the pair of facts the driver's squeeze loop depends on.
    s.permute();
    expect(hex(s.extract(8))).not.toBe(first);
  });

  it('refuses an absorb shorter than the lane count it was asked for', () => {
    expect(() => KeccakState.initialize().absorb(new Uint8Array(8), 8)).toThrow(RangeError);
  });
});

describe('the driver’s sponge construction', () => {
  const raw = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 37) & 0xff);

  it('absorbs exactly BUFLEN bits per call whatever the multiplier', () => {
    for (const m of [1, 2, 3, 8, 20]) {
      for (const step of infnoiseSponge(raw(256), m)) {
        expect(step.bitsAbsorbed).toBe(BUFLEN);
      }
    }
  });

  /**
   * THE ACT 5 CLAIM, AS A TEST. Bits out scale with the multiplier; bits in do
   * not move at all. If a future edit ever made the absorb rate depend on the
   * multiplier, this is what would catch it.
   */
  it('squeezes outputMultiplier * 256 bits per call while the absorb stays fixed', () => {
    for (const m of [1, 2, 3, 4, 8, 20]) {
      const steps = infnoiseSponge(raw(64), m);
      expect(steps).toHaveLength(1);
      expect(steps[0].bitsSqueezed).toBe(m * 256);
      expect(steps[0].bitsAbsorbed).toBe(BUFLEN);
    }
  });

  it('is deterministic for a given raw input and multiplier', () => {
    expect(hex(infnoiseSponge(raw(128), 2)[0].out)).toBe(hex(infnoiseSponge(raw(128), 2)[0].out));
  });

  it('produces different output per chunk, which is what the permute between extracts buys', () => {
    // multiplier 8 => 2048 bits = 256 bytes => two 128-byte chunks.
    const out = infnoiseSponge(raw(64), 8)[0].out;
    expect(out).toHaveLength(256);
    expect(hex(out.slice(0, 128))).not.toBe(hex(out.slice(128)));
  });

  it('rejects a non-positive multiplier rather than silently emitting nothing', () => {
    expect(() => infnoiseSponge(raw(64), 0)).toThrow(RangeError);
    expect(() => infnoiseSponge(raw(64), -1)).toThrow(RangeError);
    expect(() => infnoiseSponge(raw(64), 1.5)).toThrow(RangeError);
  });

  it('drops a trailing partial block rather than absorbing padding as if it were noise', () => {
    expect(infnoiseSponge(raw(63), 2)).toHaveLength(0);
    expect(infnoiseSponge(raw(127), 2)).toHaveLength(1);
  });
});

describe('the driver’s own entropy ceiling', () => {
  it('sits below the design rate by the accuracy margin', () => {
    const designBits = Math.log2(INM_K) * BUFLEN;
    const ceiling = driverEntropyCeilingBits(INM_K);
    expect(ceiling).toBeLessThan(designBits);
    expect(ceiling).toBeCloseTo(designBits / INM_ACCURACY, 10);
  });

  /**
   * The headline arithmetic of Act 5, re-derived here rather than restated:
   * at the driver's DEFAULT multiplier of 2 it already emits more bits than it
   * claims entropy for. Nothing is wrong with that — a sponge is allowed to
   * stretch — but it is why conditioned output cannot be read as evidence of
   * source entropy.
   */
  it('is already exceeded by the output at the driver default multiplier of 2', () => {
    expect(2 * 256).toBeGreaterThan(driverEntropyCeilingBits(INM_K));
  });
});
