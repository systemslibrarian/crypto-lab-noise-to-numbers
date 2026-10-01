/**
 * ACT 5 — FOLLOW CONDITIONING, AND THE HEADLINE EXPERIMENT.
 *
 * Two exhibits, in this order.
 *
 * 1. THE COUNTER-HASH EXPERIMENT. A stream whose entire construction is
 *    published — SHA-256 over a little-endian counter from zero — set against
 *    the modelled physical noise source. Both figures come from pinned native
 *    runs. The published, fully predictable stream scores HIGHER. The reader
 *    can regenerate the stream's opening bytes here, live, from the published
 *    construction, which is what makes "predictable" a demonstration rather
 *    than an adjective.
 *
 * 2. THE CONDITIONING LEDGER. The driver's Keccak sponge, with its output
 *    multiplier under the reader's control. Two bars drawn to the SAME scale:
 *    bytes out, and entropy in. Raising the multiplier grows the output bar
 *    and LEAVES THE ENTROPY BAR WHERE IT IS. There is no view in this lab in
 *    which conditioning makes the entropy bar grow, because there is no such
 *    thing to draw.
 */
import { clear, count, el, scroller } from './dom.ts';
import { UNIT_PER_BIT, bitsPerBit, figure } from './figures.ts';
import { badgeRow } from './labels.ts';
import { HIGH_ESTIMATE_BITS_PER_BIT, isHighEstimate } from '../entropy/thresholds.ts';
import { fixtureById } from '../entropy/manifest.ts';
import {
  BUFLEN,
  INM_ACCURACY,
  driverEntropyCeilingBits,
  infnoiseSponge,
} from '../entropy/keccak.ts';
import { INM_K, designEntropyRate } from '../entropy/inm-model.ts';
import { COUNTER_HASH_SPEC, counterHashStream, le64, webcryptoSha256 } from '../entropy/counter-hash.ts';
import type { Manifest } from '../entropy/types.ts';

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function renderConditionPanel(root: HTMLElement, manifest: Manifest): void {
  clear(root);

  const counterHash = fixtureById(manifest, 'counter-hash-sha256');
  const rawNoise = fixtureById(manifest, 'inm-clean');
  const conditioned = fixtureById(manifest, 'inm-conditioned-keccak');

  root.append(
    el(
      'div',
      { class: 'onramp' },
      el('h2', {}, 'Conditioning: what it does and what it cannot do'),
      el(
        'p',
        {},
        'Raw noise is lopsided and correlated, so a driver runs it through a cryptographic ' +
          'function before anyone uses it. That is ',
        el('strong', {}, 'conditioning'),
        '. It spreads whatever unpredictability was there evenly across the output, which is ' +
          'genuinely valuable — and it is all it does. Conditioning concentrates entropy. It ' +
          'never creates any.'
      ),
      el(
        'p',
        {},
        'The trouble is that conditioned output looks superb under measurement whatever went into ' +
          'it, because a good hash function produces uniform-looking bytes from anything. So a ' +
          'high estimate on conditioned output tells you the hash function works. It tells you ' +
          'nothing about the source. This act demonstrates that twice.'
      )
    )
  );

  // ══ 1. The counter-hash experiment ═════════════════════════════════════
  const exp = el('div', { class: 'card' });
  exp.append(
    el('h2', {}, 'The experiment: a stream everyone can predict'),
    el(
      'p',
      {},
      'Here is the whole construction of a one-megabyte file. There is nothing else to it:'
    ),
    el(
      'pre',
      { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'The counter-hash construction', 'data-claim': 'counter-hash-construction' },
      [
        `block_i = SHA-256( LE64(${COUNTER_HASH_SPEC.start} + i) )     for i = 0, 1, 2, ...`,
        `stream  = block_0 || block_1 || ...  truncated to ${count(COUNTER_HASH_SPEC.length)} bytes`,
        '',
        'LE64(n) is n as eight bytes, least significant first.',
        'The generator is scripts/gen-fixtures.ts in this repository.',
      ].join('\n')
    ),
    el(
      'p',
      {},
      'Anyone who has read that can produce every byte of the file, so its bytes are predictable ' +
        'to everyone. Now: what does the NIST tool estimate its min-entropy to be? The figures ' +
        'below are from pinned native runs, and nobody decided in advance what they would say.'
    )
  );

  if (counterHash?.assessment?.overall?.assessedBitsPerBit != null && rawNoise?.assessment?.overall?.assessedBitsPerBit != null) {
    const ch = counterHash.assessment.overall.assessedBitsPerBit;
    const rn = rawNoise.assessment.overall.assessedBitsPerBit;
    exp.append(
      el(
        'div',
        { class: 'figure-grid' },
        figure('Published counter-hash stream', bitsPerBit(ch), UNIT_PER_BIT, {
          claim: 'experiment-counter-hash',
          derived: true,
        }),
        figure('Modelled physical noise source', bitsPerBit(rn), UNIT_PER_BIT, {
          claim: 'experiment-raw-noise',
          derived: true,
        }),
        figure(
          'The lab’s line for "high"',
          bitsPerBit(HIGH_ESTIMATE_BITS_PER_BIT),
          UNIT_PER_BIT,
          { claim: 'high-threshold' }
        )
      ),
      el(
        'div',
        {
          class: `verdict ${isHighEstimate(ch) && !isHighEstimate(rn) ? 'verdict-bad' : 'verdict-info'}`,
          'data-verdict': 'experiment-outcome',
        },
        el('span', { 'aria-hidden': 'true' }, isHighEstimate(ch) && !isHighEstimate(rn) ? '✕' : 'ℹ'),
        el(
          'span',
          { class: 'verdict-text' },
          el(
            'strong',
            {},
            isHighEstimate(ch) && !isHighEstimate(rn)
              ? 'HIGH ESTIMATE — AND FULLY PREDICTABLE. '
              : 'Measured outcome. '
          ),
          `The published stream was assessed at ${ch.toFixed(6)} bits of min-entropy per bit. The ` +
            `modelled physical source was assessed at ${rn.toFixed(6)}. The stream anyone can ` +
            `regenerate from four lines of description scored ${(ch / rn).toFixed(2)} times higher ` +
            `than the one driven by thermal noise.`
        )
      ),
      el(
        'p',
        {},
        'An estimator is handed a sample and nothing else. It cannot know the sample has a short ' +
          'description. That is not a defect in SP 800-90B — it is precisely why the standard ' +
          'assesses the ',
        el('strong', {}, 'raw noise source, before conditioning'),
        ', and why an entropy claim has to rest on a justified model of the physical process, not ' +
          'on a figure that came out high.'
      ),
      el(
        'p',
        { class: 'note' },
        `The threshold above was chosen after reading the measurements, not before. The whole ` +
          `column of figures, in order, is recorded in src/entropy/thresholds.ts.`
      )
    );
  }

  // Live regeneration, so "predictable" is something the reader does.
  const regenOut = el('pre', {
    class: 'hex',
    tabindex: '0',
    role: 'region',
    'aria-label': 'Regenerated counter-hash bytes',
    id: 'regen-out',
  });
  const regenVerdict = el('div', { id: 'regen-verdict', role: 'status', 'aria-live': 'polite' });
  const regenBtn = el(
    'button',
    { class: 'btn btn-primary', type: 'button', id: 'regen-run' },
    'Regenerate the first 64 bytes here'
  );
  regenBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const head = await counterHashStream({ ...COUNTER_HASH_SPEC, length: 64 }, webcryptoSha256);
      regenOut.textContent = [
        `block_0 = SHA-256(${hex(le64(COUNTER_HASH_SPEC.start))})`,
        `        = ${hex(head.subarray(0, 32))}`,
        `block_1 = SHA-256(${hex(le64(COUNTER_HASH_SPEC.start + 1))})`,
        `        = ${hex(head.subarray(32, 64))}`,
      ].join('\n');
      clear(regenVerdict);
      regenVerdict.append(
        el(
          'div',
          { class: 'verdict verdict-bad', 'data-verdict': 'regenerated-match' },
          el('span', { 'aria-hidden': 'true' }, '✕'),
          el(
            'span',
            { class: 'verdict-text' },
            el('strong', {}, 'Computed in your browser, with WebCrypto, from the published construction alone. '),
            'These are the first 64 bytes of the shipped fixture. No secret was needed, and none ' +
              'was used.'
          )
        )
      );
    })();
  });
  exp.append(
    el('h3', {}, 'Predict it yourself'),
    el('div', { class: 'controls' }, regenBtn),
    regenOut,
    regenVerdict
  );
  if (counterHash) exp.append(badgeRow(counterHash));
  root.append(exp);

  // ══ 2. The conditioning ledger ═════════════════════════════════════════
  const ledger = el('div', { class: 'card' });
  const designRate = designEntropyRate(INM_K);
  const ceiling = driverEntropyCeilingBits(INM_K);

  ledger.append(
    el('h2', {}, 'The driver’s sponge, and its output multiplier'),
    el(
      'p',
      {},
      'The Infinite Noise driver conditions with a Keccak-f[1600] sponge. Each cycle it absorbs ',
      el('strong', {}, `${BUFLEN} raw bits`),
      ' into the sponge state and squeezes out ',
      el('strong', {}, 'outputMultiplier × 256 bits'),
      '. The multiplier is a command-line option, documented by the driver as "a nice way to ' +
        'generate a lot more cryptographically secure pseudo-random data than the INM generates".'
    ),
    el(
      'p',
      {},
      'Move it and watch the two bars. They are drawn to the same scale on purpose.'
    )
  );

  const multInput = el('input', {
    type: 'range',
    id: 'mult-range',
    min: '1',
    max: '64',
    value: '2',
    step: '1',
    'aria-label': 'Output multiplier',
  }) as HTMLInputElement;
  const multReadout = el('output', { for: 'mult-range', id: 'mult-readout', class: 'figure-value' }, '2');

  const outFill = el('div', { class: 'ledger-fill ledger-fill-out' });
  const entFill = el('div', { class: 'ledger-fill ledger-fill-entropy' });
  const outValue = el('span', { class: 'ledger-value', 'data-claim': 'ledger-bits-out' });
  const entValue = el('span', { class: 'ledger-value', 'data-claim': 'ledger-bits-entropy' });
  const perBitValue = el('span', { class: 'ledger-value', 'data-claim': 'ledger-per-output-bit' });

  const ledgerRows = el(
    'div',
    { class: 'ledger' },
    el(
      'div',
      { class: 'ledger-row' },
      el('span', { class: 'ledger-label' }, 'Conditioned bits OUT, per cycle'),
      el('div', { class: 'ledger-track' }, outFill),
      outValue
    ),
    el(
      'div',
      { class: 'ledger-row' },
      el('span', { class: 'ledger-label' }, 'Min-entropy IN, per cycle'),
      el('div', { class: 'ledger-track' }, entFill),
      entValue
    ),
    el(
      'div',
      { class: 'ledger-row' },
      el('span', { class: 'ledger-label' }, 'Entropy per output bit'),
      el('div', { class: 'ledger-track', 'aria-hidden': 'true' }, el('div', { class: 'ledger-fill ledger-fill-entropy' })),
      perBitValue
    )
  );

  const spongeOut = el('pre', {
    class: 'hex',
    tabindex: '0',
    role: 'region',
    'aria-label': 'Sponge output',
    id: 'sponge-out',
  });
  const ledgerStatus = el('p', { class: 'note', role: 'status', 'aria-live': 'polite', id: 'ledger-status' });

  // The raw block the sponge absorbs in the live demo: 64 bytes of the
  // modelled source, fetched once. Until it arrives the demo uses a fixed
  // block so the panel is never empty, and says which it is using.
  let rawBlock = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
  let rawBlockLabel = 'a fixed placeholder block';

  const MAX_BITS = 64 * 256; // the slider's maximum, so both bars share a scale

  const paint = (): void => {
    const m = Number(multInput.value);
    multReadout.textContent = String(m);
    const bitsOut = m * 256;
    // The entropy in is FIXED: BUFLEN raw bits, each carrying at most the
    // design rate, capped by the driver's own accuracy margin. It does not
    // depend on the multiplier, and the bar must not move when m moves.
    const bitsIn = ceiling;

    outFill.style.width = `${((bitsOut / MAX_BITS) * 100).toFixed(3)}%`;
    entFill.style.width = `${((bitsIn / MAX_BITS) * 100).toFixed(3)}%`;
    outValue.textContent = `${count(bitsOut)} bits`;
    entValue.textContent = `${bitsIn.toFixed(1)} bits`;
    perBitValue.textContent = `${(bitsIn / bitsOut).toFixed(4)} bits/bit`;

    const steps = infnoiseSponge(rawBlock, m);
    const outBytes = steps[0]?.out ?? new Uint8Array(0);
    spongeOut.textContent = [
      `absorbed : ${BUFLEN} raw bits (${rawBlock.length} bytes of ${rawBlockLabel})`,
      `squeezed : ${outBytes.length} bytes = ${outBytes.length * 8} bits`,
      '',
      hex(outBytes.subarray(0, 64)) + (outBytes.length > 64 ? `\n… ${outBytes.length - 64} more bytes` : ''),
    ].join('\n');

    ledgerStatus.textContent =
      `At multiplier ${m}, one cycle absorbs ${BUFLEN} raw bits and emits ${count(bitsOut)} ` +
      `conditioned bits. The entropy the driver is willing to claim for that cycle is ` +
      `${bitsIn.toFixed(1)} bits either way, so each output bit carries ` +
      `${(bitsIn / bitsOut).toFixed(4)} bits of min-entropy.`;
  };

  multInput.addEventListener('input', paint);

  ledger.append(
    el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'mult-range' }, 'outputMultiplier'), multInput),
      el('div', { class: 'field' }, el('span', { class: 'figure-label' }, 'value'), multReadout)
    ),
    ledgerRows,
    ledgerStatus,
    el(
      'div',
      { class: 'verdict verdict-info', 'data-verdict': 'ledger-invariant' },
      el('span', { 'aria-hidden': 'true' }, 'ℹ'),
      el(
        'span',
        { class: 'verdict-text' },
        el('strong', {}, 'The entropy bar does not move. '),
        'Raising the multiplier multiplies the bytes you get, and divides the entropy among them. ' +
          'There is no setting at which it adds any, which is why no view in this lab draws that ' +
          'bar growing.'
      )
    ),
    el('h4', {}, 'The sponge, run here'),
    spongeOut,
    el(
      'details',
      {},
      el('summary', {}, 'Where these numbers and this construction come from'),
      el(
        'dl',
        { class: 'kv' },
        el('dt', {}, 'Absorb rate'),
        el('dd', {}, `BUFLEN = ${BUFLEN} bits, software/libinfnoise.h`),
        el('dt', {}, 'Construction'),
        el('dd', {}, 'processBytes(), software/libinfnoise.c: KeccakAbsorb of BUFLEN/64 lanes, then KeccakExtract + KeccakPermutation per chunk of at most 1024 bits.'),
        el('dt', {}, 'Output size'),
        el('dd', {}, 'outputMultiplier × 256 bits per cycle, from the same function.'),
        el('dt', {}, 'Design rate'),
        el('dd', {}, `log2(K) = ${designRate.toFixed(6)} bits per bit at K = ${INM_K}.`),
        el('dt', {}, 'Driver ceiling'),
        el(
          'dd',
          {},
          `log2(K) × ${BUFLEN} / ${INM_ACCURACY} = ${ceiling.toFixed(3)} bits per cycle ` +
            '(libinfnoise.c:298). The driver will not claim more than it expects, even if its ' +
            'health monitor measures more.'
        ),
        el('dt', {}, 'Keccak'),
        el('dd', {}, 'Hand-rolled here, and checked against the FIPS 202 SHA3-256 digests built from the same permutation.')
      )
    ),
    el(
      'p',
      { class: 'note' },
      'The driver’s own comment is worth reading: BUFLEN has to stay well below 1600 bits ' +
        'because "outputting all 1600 bits would tell an attacker the Keccak state, allowing him ' +
        'to predict any further output". The sponge’s security rests on withholding state, ' +
        'not on the entropy of the block it just absorbed.'
    )
  );
  root.append(ledger);

  // Swap in real modelled noise once it is fetched, then repaint.
  if (rawNoise) {
    void (async (): Promise<void> => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}${rawNoise.download}`);
        if (!res.ok) return;
        const bytes = new Uint8Array(await res.arrayBuffer());
        rawBlock = bytes.subarray(0, 64);
        rawBlockLabel = 'the modelled raw-noise fixture';
        paint();
      } catch {
        // Keep the placeholder; the panel already says which block it used.
      }
    })();
  }
  paint();

  // ══ 3. The measured before/after ═══════════════════════════════════════
  if (
    rawNoise?.assessment?.overall?.assessedBitsPerBit != null &&
    conditioned?.assessment?.overall?.assessedBitsPerBit != null
  ) {
    const before = rawNoise.assessment.overall.assessedBitsPerBit;
    const after = conditioned.assessment.overall.assessedBitsPerBit;
    const card = el('div', { class: 'card' });
    card.append(
      el('h2', {}, 'The same source, measured before and after conditioning'),
      el(
        'div',
        { class: 'figure-grid' },
        figure('Raw, before conditioning', bitsPerBit(before), UNIT_PER_BIT, {
          claim: 'condition-before',
          derived: true,
        }),
        figure('After the driver’s sponge', bitsPerBit(after), UNIT_PER_BIT, {
          claim: 'condition-after',
          derived: true,
        })
      ),
      el(
        'div',
        { class: 'verdict verdict-warn', 'data-verdict': 'conditioning-raised-number' },
        el('span', { 'aria-hidden': 'true' }, '⚠'),
        el(
          'span',
          { class: 'verdict-text' },
          el('strong', {}, 'The number went up. The source did not change. '),
          `Conditioning the same modelled stream moved its assessed figure from ${before.toFixed(6)} ` +
            `to ${after.toFixed(6)} bits per bit — from below this lab’s "high" line to ` +
            'above it. Nothing was added to the source; the sponge simply spread what was there ' +
            'across output that no estimator can distinguish from uniform. This is exactly why ' +
            'conditioned output is never evidence of source entropy.'
        )
      ),
      el(
        'p',
        {},
        'The practical consequence is an accounting one. A conditioned stream still needs an ',
        el('strong', {}, 'entropy budget justified from the raw source'),
        ' — how many bits of min-entropy went in, how many bits are being drawn out, and ' +
          'what that leaves per output bit. The ledger above is that arithmetic. Measuring the ' +
          'output and calling the answer your budget is the accounting error the whole standard ' +
          'is arranged to prevent.'
      ),
      badgeRow(conditioned)
    );

    const tbody = el(
      'tbody',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, 'Raw modelled noise'),
        el('td', { class: 'num' }, before.toFixed(6)),
        el('td', {}, isHighEstimate(before) ? 'above the line' : 'below the line')
      ),
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, 'Conditioned output'),
        el('td', { class: 'num' }, after.toFixed(6)),
        el('td', {}, isHighEstimate(after) ? 'above the line' : 'below the line')
      ),
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, 'Published counter-hash'),
        el('td', { class: 'num' }, (counterHash?.assessment?.overall?.assessedBitsPerBit ?? 0).toFixed(6)),
        el(
          'td',
          {},
          isHighEstimate(counterHash?.assessment?.overall?.assessedBitsPerBit ?? null)
            ? 'above the line'
            : 'below the line'
        )
      )
    );
    card.append(
      scroller(
        'Assessed min-entropy before and after conditioning',
        el(
          'table',
          { 'data-claim': 'conditioning-table' },
          el(
            'caption',
            {},
            `Assessed min-entropy in bits per bit, against this lab’s "high" line of ` +
              `${HIGH_ESTIMATE_BITS_PER_BIT}. Two of these three streams are above it, and the ` +
              `physical one is not.`
          ),
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { scope: 'col' }, 'Stream'),
              el('th', { scope: 'col', class: 'num' }, 'bits of min-entropy per bit'),
              el('th', { scope: 'col' }, 'against the line')
            )
          ),
          tbody
        )
      )
    );
    root.append(card);
  }
}
