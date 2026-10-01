/**
 * Keccak-f[1600], hand-rolled, plus the Infinite Noise driver's sponge
 * construction built on top of it.
 *
 * WHY HAND-ROLLED. The conditioning step is the teaching subject of Act 5, so
 * hiding it behind a library would hide the one thing the act exists to show.
 * It is also the only way to reproduce the DRIVER'S construction, which is not
 * SHA3 and not SHAKE: it is the raw permutation driven through the designers'
 * `KeccakAbsorb`/`KeccakExtract` interface with a 512-bit absorb rate, no
 * domain-separation padding, and no fixed output length.
 *
 * HOW IT IS KNOWN TO BE CORRECT. `keccak.test.ts` builds SHA3-256 out of this
 * exact permutation and checks it against the FIPS 202 digests AND against
 * Node's own `crypto.createHash('sha3-256')`. A permutation with any defect in
 * theta, rho, pi, chi or iota cannot produce matching SHA3 digests, so a green
 * test is evidence about the permutation rather than about the test.
 *
 * Lane layout is little-endian, matching `KeccakF-1600-reference.c`.
 */

const ROUNDS = 24;

/** Iota round constants, FIPS 202 Table 1. */
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rho rotation offsets, indexed x + 5y. FIPS 202 Table 2. */
const RHO: number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const MASK = (1n << 64n) - 1n;
const rotl64 = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

const idx = (x: number, y: number): number => (x % 5) + 5 * (y % 5);

/** The 24-round permutation, in place on 25 lanes. */
export function keccakF1600(a: bigint[]): void {
  for (let round = 0; round < ROUNDS; round++) {
    // theta
    const c = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) {
      c[x] = a[idx(x, 0)] ^ a[idx(x, 1)] ^ a[idx(x, 2)] ^ a[idx(x, 3)] ^ a[idx(x, 4)];
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) a[idx(x, y)] = (a[idx(x, y)] ^ d) & MASK;
    }
    // rho
    for (let i = 0; i < 25; i++) a[i] = rotl64(a[i], RHO[i]);
    // pi: A'[x][y] = A[(x + 3y) mod 5][x]
    const b = a.slice();
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) a[idx(x, y)] = b[idx(x + 3 * y, x)];
    }
    // chi
    const t = a.slice();
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        a[idx(x, y)] = (t[idx(x, y)] ^ (~t[idx(x + 1, y)] & t[idx(x + 2, y)])) & MASK;
      }
    }
    // iota
    a[0] = (a[0] ^ RC[round]) & MASK;
  }
}

/** A 200-byte Keccak state held as 25 little-endian lanes. */
export class KeccakState {
  readonly lanes: bigint[] = new Array<bigint>(25).fill(0n);

  /** `KeccakInitializeState`: all zeros. */
  static initialize(): KeccakState {
    return new KeccakState();
  }

  /** The state as its 200 bytes, little-endian per lane. */
  toBytes(): Uint8Array {
    const out = new Uint8Array(200);
    for (let i = 0; i < 25; i++) {
      let v = this.lanes[i];
      for (let b = 0; b < 8; b++) {
        out[i * 8 + b] = Number(v & 0xffn);
        v >>= 8n;
      }
    }
    return out;
  }

  /**
   * `KeccakAbsorb(state, data, laneCount)` from the designers' interface:
   * XOR `laneCount * 8` bytes into the front of the state, THEN permute.
   * The permutation is part of absorb; forgetting it is the classic error.
   */
  absorb(data: Uint8Array, laneCount: number): void {
    if (data.length < laneCount * 8) {
      throw new RangeError(`absorb needs ${laneCount * 8} bytes, got ${data.length}`);
    }
    for (let i = 0; i < laneCount; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(data[i * 8 + b]);
      this.lanes[i] = (this.lanes[i] ^ lane) & MASK;
    }
    keccakF1600(this.lanes);
  }

  /**
   * `KeccakExtract(state, data, laneCount)`: a plain copy of the first
   * `laneCount * 8` bytes. It does NOT permute — the driver permutes
   * separately afterwards, and the distinction is what makes repeated squeezes
   * produce different bytes instead of the same ones.
   */
  extract(laneCount: number): Uint8Array {
    return this.toBytes().slice(0, laneCount * 8);
  }

  /** `KeccakPermutation(state)`. */
  permute(): void {
    keccakF1600(this.lanes);
  }
}

// ── The driver's construction ───────────────────────────────────────────────

/** Bits absorbed per call. `#define BUFLEN 512u` in `software/libinfnoise.h`. */
export const BUFLEN = 512;

/** `#define INM_ACCURACY 1.03` in `software/libinfnoise_private.h`. */
export const INM_ACCURACY = 1.03;

/**
 * The entropy the DRIVER is willing to claim for one 512-bit absorb, in bits.
 *
 * `libinfnoise.c:298` caps the health monitor's measured figure at
 * `inmExpectedEntropyPerBit * BUFLEN / INM_ACCURACY`, where
 * `inmExpectedEntropyPerBit = log(K)/log(2)` (`healthcheck.c:108`). So the
 * driver's own ceiling is BELOW the design rate by the accuracy margin — it
 * will not claim more entropy than it expects, even if it measures more.
 *
 * This is the driver's claim, not an SP 800-90B estimate. The lab never
 * substitutes one for the other.
 */
export function driverEntropyCeilingBits(k: number): number {
  return (Math.log2(k) * BUFLEN) / INM_ACCURACY;
}

export interface SpongeStep {
  /** 1-based call index. */
  call: number;
  /** Raw bits absorbed on this call. Always BUFLEN. */
  bitsAbsorbed: number;
  /** Conditioned bits squeezed out on this call. */
  bitsSqueezed: number;
  /** The squeezed bytes. */
  out: Uint8Array;
}

/**
 * A model of `processBytes()` in `software/libinfnoise.c` (commit
 * 40ecf21d2318cfe213f56d72296653e6439860e9) for `outputMultiplier > 0`:
 *
 *   - absorb all BUFLEN raw bits, which permutes;
 *   - squeeze `outputMultiplier * 256` bits in chunks of at most 1024,
 *     permuting after each extract.
 *
 * It is a model of the CONSTRUCTION, not of the daemon: the driver's chunking
 * is spread across successive calls through a `bytesGiven` counter and a USB
 * read loop, and none of that changes the byte sequence this produces for a
 * given raw input and multiplier.
 *
 * WHAT THIS DOES NOT DO: it does not add entropy. `outputMultiplier` changes
 * only `bitsSqueezed`. Every step records both numbers precisely so the
 * accounting is visible rather than asserted.
 */
export function infnoiseSponge(
  rawBits: Uint8Array,
  outputMultiplier: number,
  state: KeccakState = KeccakState.initialize()
): SpongeStep[] {
  if (!Number.isInteger(outputMultiplier) || outputMultiplier < 1) {
    throw new RangeError('outputMultiplier must be a positive integer in this model');
  }
  const bytesPerAbsorb = BUFLEN / 8; // 64
  const calls = Math.floor(rawBits.length / bytesPerAbsorb);
  const steps: SpongeStep[] = [];
  for (let c = 0; c < calls; c++) {
    const block = rawBits.subarray(c * bytesPerAbsorb, (c + 1) * bytesPerAbsorb);
    state.absorb(block, BUFLEN / 64);
    let remaining = (outputMultiplier * 256) / 8; // bytes
    const chunks: Uint8Array[] = [];
    while (remaining > 0) {
      const bytesToWrite = Math.min(1024 / 8, remaining);
      chunks.push(state.extract(bytesToWrite / 8));
      state.permute();
      remaining -= bytesToWrite;
    }
    const total = chunks.reduce((n, ch) => n + ch.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const ch of chunks) {
      out.set(ch, o);
      o += ch.length;
    }
    steps.push({ call: c + 1, bitsAbsorbed: BUFLEN, bitsSqueezed: total * 8, out });
  }
  return steps;
}

/**
 * SHA3-256 over this same permutation.
 *
 * It exists ONLY so the permutation can be checked against FIPS 202's
 * published digests — it is the KAT's instrument, not part of the lab's
 * conditioning story. Rate 1088 bits, domain padding 0x06, pad10*1.
 */
export function sha3_256(msg: Uint8Array): Uint8Array {
  const rate = 136; // 1088 bits
  const state = KeccakState.initialize();
  const padded = new Uint8Array(Math.ceil((msg.length + 1) / rate) * rate);
  padded.set(msg);
  padded[msg.length] = 0x06;
  padded[padded.length - 1] |= 0x80;
  for (let o = 0; o < padded.length; o += rate) {
    // absorb() XORs then permutes, which is exactly a sponge absorb step.
    state.absorb(padded.subarray(o, o + rate), rate / 8);
  }
  return state.extract(4); // 32 bytes
}
