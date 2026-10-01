/**
 * Packed bits and one-sample-per-byte are DIFFERENT INPUTS to the same tool.
 *
 * This is the quietest way to get a wrong entropy number, so it gets its own
 * module and its own tests. The Infinite Noise device streams bits packed eight
 * to a byte. The NIST assessment tool reads ONE SAMPLE PER BYTE — verified in
 * `cpp/shared/utils.h` of the pinned build, where `read_file()` does
 * `fread(dp->symbols, sizeof(uint8_t), dp->len, file)` and `dp->len` is the
 * sample count. NIST's own `bin/truerand_1bit.bin` confirms it: 1,000,000 bytes
 * holding only the values 0 and 1.
 *
 * So handing the tool a packed file and declaring `1` bit per symbol does not
 * assess 8x as many samples at 1 bit each. It assesses one EIGHTH as many
 * samples, reads each whole byte as a single symbol, and — because the tool
 * treats a two-symbol alphabet as binary regardless of the declared width —
 * can report a figure that looks plausible and means nothing about the bits.
 * The lab demonstrates that as an edge case rather than describing it.
 *
 * BIT ORDER IS PART OF THE ENCODING, not an implementation detail. MSB-first
 * is used throughout this lab and recorded in every manifest, because the
 * opposite choice produces a different file with a different SHA-256 and
 * different estimator results from the same samples.
 */

export type BitOrder = 'msb-first' | 'lsb-first';

/** What to do with a trailing group of fewer than 8 samples. Never silent. */
export type IncompleteFinalSample = 'dropped' | 'padded' | 'rejected';

export class IncompleteSampleError extends Error {
  readonly remainder: number;
  constructor(remainder: number) {
    super(
      `input ends with ${remainder} leftover bit${remainder === 1 ? '' : 's'}: ` +
        'not a whole number of packed bytes, and the policy for this input is "rejected"'
    );
    this.name = 'IncompleteSampleError';
    this.remainder = remainder;
  }
}

/**
 * Pack one-sample-per-byte binary samples into bits, 8 per byte.
 *
 * Any non-zero sample packs as a 1. That is deliberate rather than lax: it
 * means a caller cannot silently pack a multi-bit stream as though it were
 * binary and get a file whose checksum looks fine.
 */
export function packBits(
  samples: Uint8Array,
  order: BitOrder = 'msb-first',
  incomplete: IncompleteFinalSample = 'rejected'
): Uint8Array {
  const remainder = samples.length % 8;
  if (remainder !== 0) {
    if (incomplete === 'rejected') throw new IncompleteSampleError(remainder);
  }
  const whole = Math.floor(samples.length / 8);
  const bytes = incomplete === 'padded' && remainder !== 0 ? whole + 1 : whole;
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes * 8; i++) {
    const bit = i < samples.length && samples[i] !== 0 ? 1 : 0;
    if (bit === 0) continue;
    const shift = order === 'msb-first' ? 7 - (i % 8) : i % 8;
    out[i >> 3] |= 1 << shift;
  }
  return out;
}

/**
 * Expand packed bits back to one sample per byte, each 0x00 or 0x01.
 *
 * `sampleCount` is required rather than inferred. A packed file carries no
 * record of how many of its last byte's bits were real samples, so inferring
 * `bytes * 8` would silently invent up to seven samples — and inventing
 * samples at the end of a file is exactly the kind of thing that moves a
 * marginal estimator.
 */
export function unpackBits(
  packed: Uint8Array,
  sampleCount: number,
  order: BitOrder = 'msb-first'
): Uint8Array {
  if (sampleCount < 0) throw new RangeError('sampleCount must not be negative');
  if (sampleCount > packed.length * 8) {
    throw new RangeError(
      `asked for ${sampleCount} samples from ${packed.length} packed bytes, which hold at most ${packed.length * 8}`
    );
  }
  const out = new Uint8Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const shift = order === 'msb-first' ? 7 - (i % 8) : i % 8;
    out[i] = (packed[i >> 3] >> shift) & 1;
  }
  return out;
}

/**
 * The number of distinct symbol values present, which is what the tool's own
 * "N distinct B-bit-wide symbols" line reports. Used by the lab to show when a
 * declared `bits_per_symbol` does not match the data.
 */
export function distinctSymbols(samples: Uint8Array): number {
  const seen = new Uint8Array(256);
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    if (seen[samples[i]] === 0) {
      seen[samples[i]] = 1;
      n++;
    }
  }
  return n;
}

/**
 * The narrowest `bits_per_symbol` that can represent every value present.
 *
 * This is what the tool infers when the width is omitted from the command
 * line, and the lab shows the inference alongside the declared width so a
 * mismatch is visible rather than inferred away. The tool's own inference is
 * not re-implemented as authoritative: the manifest records
 * `bitsPerSymbolInferred` from the tool's JSON report.
 */
export function narrowestWidth(samples: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i] > max) max = samples[i];
  if (max === 0) return 1;
  return Math.floor(Math.log2(max)) + 1;
}
