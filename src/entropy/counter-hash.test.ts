import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COUNTER_HASH_SPEC, counterHashStream, le64 } from './counter-hash.ts';

const nodeSha256 = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(createHash('sha256').update(b).digest());
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('the counter encoding is part of the construction', () => {
  it('encodes little-endian over eight bytes', () => {
    expect(hex(le64(0))).toBe('0000000000000000');
    expect(hex(le64(1))).toBe('0100000000000000');
    expect(hex(le64(255))).toBe('ff00000000000000');
    expect(hex(le64(256))).toBe('0001000000000000');
  });

  it('is NOT big-endian, which would be a different published stream', () => {
    expect(hex(le64(1))).not.toBe('0000000000000001');
  });

  it('refuses a counter it cannot represent rather than wrapping silently', () => {
    expect(() => le64(-1)).toThrow(RangeError);
    expect(() => le64(2n ** 64n)).toThrow(RangeError);
    expect(hex(le64(2n ** 64n - 1n))).toBe('ffffffffffffffff');
  });
});

describe('the published stream', () => {
  it('is the concatenation of SHA-256 over the counter, block by block', async () => {
    const s = await counterHashStream({ ...COUNTER_HASH_SPEC, length: 96 }, nodeSha256);
    for (let i = 0; i < 3; i++) {
      const want = createHash('sha256').update(le64(i)).digest('hex');
      expect(hex(s.subarray(i * 32, i * 32 + 32)), `block ${i}`).toBe(want);
    }
  });

  it('truncates the final block rather than overrunning the requested length', async () => {
    const s = await counterHashStream({ ...COUNTER_HASH_SPEC, length: 40 }, nodeSha256);
    expect(s).toHaveLength(40);
    expect(hex(s.subarray(32))).toBe(
      createHash('sha256').update(le64(1)).digest('hex').slice(0, 16)
    );
  });

  it('honours the start value', async () => {
    const a = await counterHashStream({ ...COUNTER_HASH_SPEC, start: 5, length: 32 }, nodeSha256);
    expect(hex(a)).toBe(createHash('sha256').update(le64(5)).digest('hex'));
  });

  /**
   * THE POINT OF THE EXHIBIT, AS A TEST. The shipped fixture's first bytes are
   * reproducible here from the published construction alone. Anyone who can
   * read `counter-hash.ts` can regenerate the whole file; that is the premise
   * the measured min-entropy estimate is then set against.
   */
  it('reproduces the shipped fixture from the published construction alone', async () => {
    const path = resolve(import.meta.dirname, '../../public/fixtures/counter-hash-sha256.bin');
    const shipped = new Uint8Array(readFileSync(path));
    expect(shipped).toHaveLength(COUNTER_HASH_SPEC.length);
    const head = await counterHashStream({ ...COUNTER_HASH_SPEC, length: 4096 }, nodeSha256);
    expect(hex(shipped.subarray(0, 4096))).toBe(hex(head));
  });

  it('matches the manifest’s recorded SHA-256 for the whole file', async () => {
    const root = resolve(import.meta.dirname, '../..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/manifest.json'), 'utf8')) as {
      fixtures: Array<{ id: string; encoding: { originalSha256: string } }>;
    };
    const recorded = manifest.fixtures.find((f) => f.id === 'counter-hash-sha256')!;
    const regenerated = await counterHashStream(COUNTER_HASH_SPEC, nodeSha256);
    expect(createHash('sha256').update(regenerated).digest('hex')).toBe(
      recorded.encoding.originalSha256
    );
  });
});
