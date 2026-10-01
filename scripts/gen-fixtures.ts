/**
 * Build every fixture this lab ships, byte-for-byte reproducibly.
 *
 *   node scripts/gen-fixtures.ts [--out public/fixtures] [--work .tool-cache]
 *
 * Two files come out of each fixture:
 *
 *   - THE SHIPPED ORIGINAL, in `out`. For the 1-bit fixtures that is the
 *     PACKED form, eight samples to a byte, which is what the device streams.
 *   - THE CONVERTED FORM, in `work`. One sample per byte, which is what the
 *     NIST tool reads. These are not committed: they are regenerable from the
 *     originals by `scripts/unpack-bits.ts`, and the manifest records the
 *     SHA-256 a correct conversion must produce.
 *
 * It imports the SAME modules the browser does — `src/entropy/*.ts` run under
 * Node's native type stripping — so there is no second implementation of the
 * circuit model, the packing, or the sponge to drift out of agreement with
 * what the page shows.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { xoshiro128ss } from '../src/entropy/prng.ts';
import { INM_DEFAULTS, generateInmSamples } from '../src/entropy/inm-model.ts';
import { packBits, unpackBits } from '../src/entropy/encoding.ts';
import { infnoiseSponge } from '../src/entropy/keccak.ts';
import { COUNTER_HASH_SPEC, counterHashStream } from '../src/entropy/counter-hash.ts';
import { FIXTURES, type FixtureSpec } from './fixture-specs.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const nodeSha256 = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(createHash('sha256').update(b).digest());

/** The 13-sample pattern the periodic fault injects. Published, not random. */
const PERIODIC_PATTERN = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0];

/**
 * A 32-bit Fibonacci LFSR, taps 32/22/2/1 (x^32 + x^22 + x^2 + x + 1).
 *
 * Maximal length, so its output passes most statistical tests comfortably —
 * and every bit of it follows from any 32 consecutive bits. That gap is the
 * reason this fixture is in the lab.
 */
function lfsrSamples(count: number, seed: number): Uint8Array {
  let state = seed >>> 0;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const bit = state & 1;
    out[i] = bit;
    // Taps at positions 32, 22, 2, 1 -> bit indices 31, 21, 1, 0.
    const feedback = ((state >>> 0) ^ (state >>> 10) ^ (state >>> 30) ^ (state >>> 31)) & 1;
    state = ((state >>> 1) | (feedback << 31)) >>> 0;
  }
  return out;
}

/** The one-sample-per-byte stream for a fixture, before any packing. */
async function samplesFor(spec: FixtureSpec): Promise<Uint8Array> {
  switch (spec.id) {
    case 'inm-clean':
    case 'exploratory-short':
      return generateInmSamples(spec.sampleCount, xoshiro128ss(spec.seed!), INM_DEFAULTS);

    case 'fault-bias':
      return generateInmSamples(spec.sampleCount, xoshiro128ss(spec.seed!), {
        ...INM_DEFAULTS,
        threshold: 0.58,
      });

    case 'fault-stuck-bit': {
      const s = generateInmSamples(spec.sampleCount, xoshiro128ss(spec.seed!), INM_DEFAULTS);
      for (let i = 3; i < s.length; i += 8) s[i] = 1;
      return s;
    }

    case 'fault-periodic': {
      const s = generateInmSamples(spec.sampleCount, xoshiro128ss(spec.seed!), INM_DEFAULTS);
      for (let i = 0; i < s.length; i += 4) {
        s[i] = PERIODIC_PATTERN[(i / 4) % PERIODIC_PATTERN.length] as 0 | 1;
      }
      return s;
    }

    case 'fault-repeated-block': {
      const block = generateInmSamples(65_536, xoshiro128ss(spec.seed!), INM_DEFAULTS);
      const s = new Uint8Array(spec.sampleCount);
      for (let o = 0; o < s.length; o += block.length) {
        s.set(block.subarray(0, Math.min(block.length, s.length - o)), o);
      }
      return s;
    }

    case 'fault-predictable':
      return lfsrSamples(spec.sampleCount, spec.seed!);

    // The degenerate case the brief names: a full-size file whose alphabet has
    // one symbol. It is not a fault variant of the model -- it is the boundary
    // the tool is asked about.
    case 'all-zero':
      return new Uint8Array(spec.sampleCount);

    case 'counter-hash-sha256':
      return counterHashStream({ ...COUNTER_HASH_SPEC, length: spec.sampleCount }, nodeSha256);

    case 'inm-conditioned-keccak': {
      // 8 raw bits per conditioned byte at multiplier 2: the sponge absorbs 512
      // raw bits and squeezes 512 conditioned bits per call, so the raw stream
      // must be eight times the sample count in BITS.
      const rawSamples = generateInmSamples(
        spec.sampleCount * 8,
        xoshiro128ss(spec.seed!),
        INM_DEFAULTS
      );
      const rawPacked = packBits(rawSamples, 'msb-first', 'rejected');
      const out = new Uint8Array(spec.sampleCount);
      let o = 0;
      for (const step of infnoiseSponge(rawPacked, 2)) {
        const take = Math.min(step.out.length, out.length - o);
        if (take <= 0) break;
        out.set(step.out.subarray(0, take), o);
        o += take;
      }
      if (o !== spec.sampleCount) {
        throw new Error(`conditioned stream short: produced ${o} of ${spec.sampleCount} bytes`);
      }
      return out;
    }

    default:
      throw new Error(`no generator for fixture "${spec.id}"`);
  }
}

export interface BuiltFixture {
  spec: FixtureSpec;
  originalPath: string;
  convertedPath: string;
  originalBytes: number;
  originalSha256: string;
  convertedBytes: number;
  convertedSha256: string;
}

export async function buildAll(outDir: string, workDir: string): Promise<BuiltFixture[]> {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const built: BuiltFixture[] = [];

  for (const spec of FIXTURES) {
    const samples = await samplesFor(spec);
    if (samples.length !== spec.sampleCount) {
      throw new Error(
        `${spec.id}: generator produced ${samples.length} samples, spec says ${spec.sampleCount}`
      );
    }
    if (spec.bitsPerSymbol === 1) {
      for (let i = 0; i < samples.length; i++) {
        if (samples[i] > 1) throw new Error(`${spec.id}: sample ${i} is ${samples[i]} in a 1-bit stream`);
      }
    }

    // The shipped original.
    const original =
      spec.shippedForm === 'packed-bits' ? packBits(samples, 'msb-first', 'rejected') : samples;
    const originalPath = join(outDir, `${spec.id}.bin`);
    writeFileSync(originalPath, original);

    // The converted form the tool reads. For an already-unpacked fixture this
    // is the same bytes; it is still written out and hashed separately so the
    // manifest's two checksum fields mean the same thing for every fixture.
    const converted =
      spec.shippedForm === 'packed-bits'
        ? unpackBits(original, spec.sampleCount, 'msb-first')
        : samples;
    const convertedPath = join(workDir, `${spec.id}.samples.bin`);
    writeFileSync(convertedPath, converted);

    // The round trip is checked here, not assumed: a packing bug that lost the
    // last byte would otherwise show up as a mysterious estimator shift.
    if (spec.shippedForm === 'packed-bits') {
      for (let i = 0; i < samples.length; i++) {
        if (converted[i] !== samples[i]) {
          throw new Error(`${spec.id}: pack/unpack round trip differs at sample ${i}`);
        }
      }
    }

    built.push({
      spec,
      originalPath,
      convertedPath,
      originalBytes: original.length,
      originalSha256: sha256(original),
      convertedBytes: converted.length,
      convertedSha256: sha256(converted),
    });
    process.stdout.write(
      `${spec.id.padEnd(24)} original ${String(original.length).padStart(8)} B  ` +
        `${sha256(original).slice(0, 16)}...  converted ${String(converted.length).padStart(8)} B  ` +
        `${sha256(converted).slice(0, 16)}...\n`
    );
  }
  return built;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const arg = (name: string, fallback: string): string => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const outDir = resolve(ROOT, arg('--out', 'public/fixtures'));
  const workDir = resolve(ROOT, arg('--work', '.tool-cache/converted'));
  await buildAll(outDir, workDir);
  process.stdout.write(`\noriginals -> ${outDir}\nconverted -> ${workDir}\n`);
}
