/**
 * ACT 1 — MEET THE SOURCE.
 *
 * The headline mechanism of this act is STEPPED, not described: the reader
 * presses Step and watches the state A move along [0,1], cross the threshold,
 * get folded back down by the multiply, and emit a bit. That is the modular
 * entropy multiplier, and it is the thing every later number is about.
 *
 * The motion is a 0.18s transition on a marker whose position is set from the
 * state the reader's own click produced. There is no idle animation, nothing
 * loops, and the marker is positioned by inline `left` rather than parked at
 * an animation's start state, so a reduced-motion reader sees exactly the same
 * positions with no transition.
 *
 * The act also sets the two numbers side by side that the rest of the lab
 * exists to keep apart: the vendor's THEORETICAL DESIGN RATE, and the MEASURED
 * min-entropy estimate for the modelled stream. They are not close, and the
 * lab says which is which every time either appears.
 */
import { clear, count, el, frag } from './dom.ts';
import { UNIT_PER_BIT, figure } from './figures.ts';
import { badgeRow, provenanceBadge } from './labels.ts';
import { INM_DEFAULTS, INM_K, designEntropyRate, inmStep } from '../entropy/inm-model.ts';
import { xoshiro128ss } from '../entropy/prng.ts';
import { BUFLEN, driverEntropyCeilingBits } from '../entropy/keccak.ts';
import { fixtureById } from '../entropy/manifest.ts';
import type { Manifest } from '../entropy/types.ts';

const INFNOISE_COMMIT = '40ecf21d2318cfe213f56d72296653e6439860e9';
const INFNOISE_REPO = 'https://github.com/13-37-org/infnoise';

export function renderSourcePanel(root: HTMLElement, manifest: Manifest): void {
  clear(root);

  root.append(
    el(
      'div',
      { class: 'onramp' },
      el('h2', {}, 'What is an entropy source, and why does it need assessing?'),
      el(
        'p',
        {},
        'A cryptographic key has to be a number nobody can guess. Software alone cannot make one: ' +
          'a program that starts from the same state takes the same steps, so what comes out is ' +
          'only as unguessable as what went in. So the unguessability has to come from somewhere ' +
          'physical — in this lab, from thermal noise, the tiny random jostling of electrons ' +
          'that every resistor produces and nobody can predict.'
      ),
      el(
        'p',
        {},
        'The catch is that physical noise arrives small, lopsided and repetitive, so a circuit ' +
          'amplifies it and a program tidies it up. Both steps can hide a problem rather than fix ' +
          'it. ',
        el('strong', {}, 'Entropy assessment'),
        ' is the business of working out how much unguessability was really there to begin with. ' +
          'NIST’s SP 800-90B is the standard that says how.'
      ),
      el(
        'p',
        { class: 'note' },
        'Two words this lab is strict about. ',
        el('span', { class: 'jargon', title: 'H-infinity: -log2 of the probability of the single most likely outcome.' }, 'Min-entropy'),
        ' measures the most likely outcome of a source, not the average over its outcomes — ' +
          'it is the pessimistic measure, the one an attacker’s best single guess cares ' +
          'about. And ',
        el('span', { class: 'jargon', title: 'A property of a source model, not of a byte string.' }, 'a source'),
        ' is not a file. Entropy is a property of the process that produced the bytes; the bytes ' +
          'themselves are just evidence about it.'
      )
    )
  );

  // ── The circuit, stepped ────────────────────────────────────────────────
  const card = el('div', { class: 'card' });
  card.append(
    el('h2', {}, 'The modular entropy multiplier, one step at a time'),
    el(
      'p',
      {},
      'The Infinite Noise device holds an analogue value A between 0 and 1. Each clock it adds a ' +
        'little thermal noise, compares A with a threshold, and multiplies: above the threshold ' +
        'it emits a 1 and folds A back down, below it emits a 0 and stretches A upward. ' +
        'Multiplying by a gain K > 1 is what amplifies a microvolt of noise into a decision — ' +
        'and it is why the design’s entropy rate is log₂(K) bits per bit.'
    ),
    el('div', { class: 'badge-row' }, provenanceBadge('simulated')),
    el(
      'p',
      { class: 'note' },
      'This is the model, running in your browser — the same code that generated this ' +
        'lab’s fixtures, transcribed from the vendor’s own simulation ',
      el('code', {}, 'updateA()'),
      '. It is not a connected device.'
    )
  );

  const bar = el('div', { class: 'loop-bar' });
  const marker = el('div', { class: 'loop-marker', 'aria-hidden': 'true' });
  const threshold = el('div', { class: 'loop-threshold', 'aria-hidden': 'true' });
  threshold.style.left = `${INM_DEFAULTS.threshold * 100}%`;
  bar.append(threshold, marker);

  const axis = el(
    'div',
    { class: 'loop-axis' },
    el('span', {}, 'A = 0'),
    el('span', {}, `threshold ${INM_DEFAULTS.threshold}`),
    el('span', {}, 'A = 1')
  );

  // `role="status"` so each step is announced; the text says the state and the
  // branch taken, which is the whole mechanism in one line.
  const readout = el('p', {
    class: 'loop-bits',
    role: 'status',
    'aria-live': 'polite',
    id: 'loop-readout',
  });
  // No `aria-label` here: a <p> has no role, so aria-label on it is a
  // PROHIBITED attribute (axe reports it only in the `incomplete` bucket,
  // which is why a gate that reads `violations` alone never sees it). The
  // visible <h4> immediately above names this element for everyone.
  const bitsOut = el('p', { class: 'loop-bits', id: 'loop-bits' });

  const state = new Float64Array([INM_DEFAULTS.initialA]);
  let rng = xoshiro128ss(20261001);
  let bits = '';
  let steps = 0;

  const paint = (branch: string): void => {
    const a = Math.min(1, Math.max(0, state[0]));
    marker.style.left = `calc(${(a * 100).toFixed(3)}% - 0.35rem)`;
    readout.textContent = `${branch} A is now ${state[0].toFixed(6)} after ${count(steps)} step${steps === 1 ? '' : 's'}.`;
    bitsOut.textContent = bits === '' ? '—' : bits;
  };

  const step = (): void => {
    const before = state[0];
    const noise = rng.normal() * INM_DEFAULTS.noiseSigma;
    const bit = inmStep(state, INM_DEFAULTS, noise);
    steps++;
    bits = (bits + String(bit)).slice(-96);
    paint(
      bit === 1
        ? `A was ${before.toFixed(6)}, above the threshold, so the circuit emitted 1 and folded A down by K·A − (K−1).`
        : `A was ${before.toFixed(6)}, below the threshold, so the circuit emitted 0 and stretched A up by K·A.`
    );
  };

  const stepBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'loop-step' }, 'Step the circuit');
  stepBtn.addEventListener('click', step);
  const step8Btn = el('button', { class: 'btn', type: 'button', id: 'loop-step-8' }, 'Step 8 times');
  step8Btn.addEventListener('click', () => {
    for (let i = 0; i < 8; i++) step();
  });
  const resetBtn = el('button', { class: 'btn', type: 'button', id: 'loop-reset' }, 'Reset');
  resetBtn.addEventListener('click', () => {
    state[0] = INM_DEFAULTS.initialA;
    rng = xoshiro128ss(20261001);
    bits = '';
    steps = 0;
    paint('Reset.');
  });

  // Paint the ARRIVAL state. Without this the marker is never positioned at
  // all (it sits at the CSS default rather than at the initial A) and the bit
  // strip is an empty element rather than a visible "nothing yet" — so the
  // first thing a reader sees would misrepresent the state the circuit is in.
  paint('The circuit is at its starting value.');

  card.append(
    el('div', { class: 'loop-stage' }, bar, axis),
    readout,
    el('h4', {}, 'Bits emitted (most recent last)'),
    bitsOut,
    el('div', { class: 'controls' }, stepBtn, step8Btn, resetBtn),
    el(
      'p',
      { class: 'note' },
      'Notice what the fold does to the next bit. A value only just above the threshold lands far ' +
        'below it, so a 1 is often followed by a 0. That is the correlation the vendor warns ' +
        'about, and the reason this source is assessed on the non-IID track rather than the IID ' +
        'one.'
    )
  );
  root.append(card);

  // ── Design rate against measured estimate ───────────────────────────────
  const clean = fixtureById(manifest, 'inm-clean');
  const rateCard = el('div', { class: 'card' });
  const designRate = designEntropyRate(INM_K);
  rateCard.append(
    el('h2', {}, 'A design rate is not a measurement'),
    el(
      'p',
      {},
      'The vendor states the device’s entropy rate as log₂(K) bits per bit, and for the ' +
        'shipped boards K = 1.82. That is a ',
      el('strong', {}, 'theoretical design rate'),
      ': what the circuit should deliver if it behaves as designed. It is not an SP 800-90B ' +
        'estimate, and this lab never prints one in place of the other.'
    )
  );

  const grid = el('div', { class: 'figure-grid' });
  grid.append(
    figure('Theoretical design rate', `${designRate.toFixed(6)} / 1`, UNIT_PER_BIT, {
      claim: 'design-rate',
    })
  );
  if (clean?.assessment?.overall?.assessedBitsPerBit != null) {
    grid.append(
      figure(
        'Measured on the modelled stream',
        `${clean.assessment.overall.assessedBitsPerBit.toFixed(6)} / 1`,
        UNIT_PER_BIT,
        { claim: 'measured-clean-per-bit', derived: true }
      )
    );
  }
  grid.append(
    figure(
      'The driver’s own ceiling',
      `${driverEntropyCeilingBits(INM_K).toFixed(3)}`,
      `bits of min-entropy claimed per ${BUFLEN}-bit block`,
      { claim: 'driver-ceiling' }
    )
  );
  rateCard.append(grid);

  rateCard.append(
    el(
      'p',
      {},
      'The gap between those first two figures is the whole subject of this lab. The design rate ' +
        'describes a circuit; the measured figure describes what ten estimators could establish ' +
        'from one million samples of a model of that circuit, under their own assumptions. ' +
        'Neither number makes the other wrong, and reading either as the other is the mistake.'
    ),
    el(
      'details',
      {},
      el('summary', {}, 'Where these numbers come from, and the one place the model diverges'),
      el(
        'dl',
        { class: 'kv' },
        el('dt', {}, 'Vendor source'),
        el(
          'dd',
          {},
          el('a', { href: `${INFNOISE_REPO}/tree/${INFNOISE_COMMIT}`, target: '_blank', rel: 'noopener' }, `13-37-org/infnoise @ ${INFNOISE_COMMIT.slice(0, 12)}`)
        ),
        el('dt', {}, 'Design-rate claim'),
        el('dd', {}, 'README: "All three boards should produce log2(1.82) = 0.864 bits of entropy per bit by design."'),
        el('dt', {}, 'Correlation warning'),
        el('dd', {}, 'README: "Adjacent bits from a modular entropy multiplier are correlated, so whitening is required."'),
        el('dt', {}, 'The loop'),
        el('dd', {}, 'software/healthcheck.c, updateA(): transcribed exactly, including the second noise application on the zero branch.'),
        el('dt', {}, 'Driver ceiling'),
        el('dd', {}, 'libinfnoise.c:298 caps the claimed entropy at log2(K) × 512 / 1.03, where INM_ACCURACY = 1.03.'),
        el('dt', {}, 'The divergence'),
        el(
          'dd',
          {},
          'The vendor’s simulation injects UNIFORM noise; this model injects GAUSSIAN noise, ' +
            'which is the right shape for thermal noise. Measured side by side, the lag-1 ' +
            'correlation is the same to one decimal under either, so the divergence is documented ' +
            'but is not what produces this lab’s findings.'
        )
      )
    )
  );
  root.append(rateCard);

  // ── The fixture this act introduces ─────────────────────────────────────
  if (clean) {
    root.append(
      el(
        'div',
        { class: 'card' },
        el('h3', {}, `The fixture: ${clean.title}`),
        badgeRow(clean),
        el('p', {}, clean.blurb),
        frag(
          el(
            'p',
            { class: 'note' },
            `${count(clean.encoding.sampleCount)} samples at ${clean.encoding.bitsPerSymbol} bit per sample, ` +
              `shipped ${clean.encoding.shippedForm === 'packed-bits' ? 'packed eight bits to a byte' : 'one sample per byte'}.`
          )
        )
      )
    );
  }
}
