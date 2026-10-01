/**
 * THE HEADLINE EXPERIMENT'S STREAM.
 *
 * A fully documented, fully deterministic byte stream: SHA-256 of a counter,
 * concatenated. Everything an attacker needs to reproduce every byte of it is
 * written down here and in the fixture manifest — the hash function, the
 * counter encoding, the start value, the length, and the generator script.
 *
 *     block_i = SHA-256( LE64(START + i) )            i = 0, 1, 2, ...
 *     stream  = block_0 || block_1 || ... truncated to `length` bytes
 *
 * LE64 is the 8-byte little-endian encoding of the counter. The encoding is
 * named because it is part of the construction: big-endian would be a
 * different stream with a different checksum and different estimator results.
 *
 * WHAT THE EXPERIMENT IS FOR. This stream is predictable to anyone reading
 * this file, and the lab publishes the whole construction on purpose. The
 * question the lab then puts to the NIST tool is what min-entropy it estimates
 * for it. The point is not the specific number — the measured figures are
 * recorded in the manifest after the fact, never fixed in advance — but that a
 * stream whose every byte is published can receive estimates that look like
 * evidence of unpredictability.
 *
 * The lesson that follows: that is why SP 800-90B assesses the RAW NOISE
 * SOURCE, before conditioning, and why a statistical estimate run on output
 * bytes is not a statement about a source. An estimator is given a sample and
 * nothing else; it cannot know that the sample has a short description.
 *
 * NEVER A SECRET. This stream and everything derived from it are public by
 * construction.
 */

export interface CounterHashSpec {
  /** Named explicitly; the lab never says "a hash" where it means a hash. */
  hash: 'SHA-256';
  /** The counter's byte encoding. Part of the construction. */
  counterEncoding: 'LE64';
  /** First counter value. */
  start: number;
  /** Output length in bytes. */
  length: number;
}

export const COUNTER_HASH_SPEC: CounterHashSpec = {
  hash: 'SHA-256',
  counterEncoding: 'LE64',
  start: 0,
  length: 1_000_000,
};

/** The 8-byte little-endian encoding of a counter value. */
export function le64(n: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  if (v < 0n) throw new RangeError('counter must not be negative');
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new RangeError('counter does not fit in 64 bits');
  return out;
}

/**
 * Generate the stream. `sha256` is injected so the same construction runs
 * under Node's `crypto` in the generator and under WebCrypto in the browser,
 * with no second implementation of SHA-256 anywhere in this repo to drift.
 */
export async function counterHashStream(
  spec: CounterHashSpec,
  sha256: (input: Uint8Array) => Promise<Uint8Array>
): Promise<Uint8Array> {
  const out = new Uint8Array(spec.length);
  let o = 0;
  for (let i = 0; o < spec.length; i++) {
    const block = await sha256(le64(spec.start + i));
    const take = Math.min(block.length, spec.length - o);
    out.set(block.subarray(0, take), o);
    o += take;
  }
  return out;
}

/** WebCrypto SHA-256, for the browser side of the same construction. */
export async function webcryptoSha256(input: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(input.byteLength);
  new Uint8Array(buf).set(input);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}
