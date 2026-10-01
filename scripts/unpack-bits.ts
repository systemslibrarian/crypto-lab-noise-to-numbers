/**
 * Convert a packed-bit fixture into the one-sample-per-byte form the NIST tool
 * reads. THIS IS THE CONVERSION STEP IN THE REPRODUCTION INSTRUCTIONS.
 *
 *   node scripts/unpack-bits.ts <packed.bin> <sampleCount> [msb-first|lsb-first] <out.bin>
 *
 * Why the step exists at all: the Infinite Noise device streams bits packed
 * eight to a byte, and `ea_non_iid` reads ONE SAMPLE PER BYTE. Handing it the
 * packed file with `1` as the symbol width does not assess the bits — it
 * assesses the BYTES, one eighth as many samples, and reports a figure that
 * means something else entirely. The lab shows that as an edge case.
 *
 * `sampleCount` is required because a packed file does not record how many of
 * its final byte's bits were real samples. Inferring `bytes * 8` would invent
 * up to seven samples at the end of the file.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { unpackBits, type BitOrder } from '../src/entropy/encoding.ts';

const [, , inPath, countArg, orderArg, outPath] = process.argv;
if (!inPath || !countArg || !orderArg || !outPath) {
  process.stderr.write(
    'usage: node scripts/unpack-bits.ts <packed.bin> <sampleCount> <msb-first|lsb-first> <out.bin>\n'
  );
  process.exit(2);
}
if (orderArg !== 'msb-first' && orderArg !== 'lsb-first') {
  process.stderr.write(`bit order must be msb-first or lsb-first, got "${orderArg}"\n`);
  process.exit(2);
}

const count = Number(countArg);
if (!Number.isInteger(count) || count < 0) {
  process.stderr.write(`sampleCount must be a non-negative integer, got "${countArg}"\n`);
  process.exit(2);
}

const packed = new Uint8Array(readFileSync(inPath));
const samples = unpackBits(packed, count, orderArg as BitOrder);
writeFileSync(outPath, samples);
process.stdout.write(
  `${inPath} (${packed.length} B, sha256 ${createHash('sha256').update(packed).digest('hex')})\n` +
    `  -> ${outPath} (${samples.length} samples, one per byte, ${orderArg})\n` +
    `     sha256 ${createHash('sha256').update(samples).digest('hex')}\n`
);
