import { markovParity } from '../entropy/parity';
import { el, scroller } from './dom';

export function parityPanel(): HTMLElement {
  const preset = el('select', { id: 'parity-source' },
    el('option', { value: 'iid' }, 'Independent: P(0)=0.75'),
    el('option', { value: 'sticky' }, 'Memory: repeat the previous bit with probability 0.90'),
    el('option', { value: 'alternate' }, 'Memory: flip the previous bit with probability 0.90'));
  const initial = el('select', { id: 'parity-initial' },
    el('option', { value: 'fair' }, 'X₀ equally likely to be 0 or 1'),
    el('option', { value: 'zero' }, 'X₀ fixed to 0'), el('option', { value: 'one' }, 'X₀ fixed to 1'));
  const length = el('select', { id: 'parity-length' }, ...[2, 3, 4, 8, 16].map(n => el('option', { value: String(n) }, String(n))));
  const result = el('div', { id: 'parity-result', hidden: '' });
  const status = el('p', { id: 'parity-status', role: 'status', 'aria-live': 'polite' }, 'Choose a source, then compute.');
  let previous = `${preset.value}/${initial.value}/${length.value}`;
  for (const input of [preset, initial, length]) input.addEventListener('change', () => {
    const next = `${preset.value}/${initial.value}/${length.value}`;
    if (next === previous) return;
    previous = next; result.hidden = true;
    status.textContent = 'Inputs changed. Previous result retired; compute again.';
  });
  const run = el('button', { id: 'parity-run', type: 'button', class: 'btn btn-primary' }, 'Compute exact parity probabilities');
  run.addEventListener('click', () => {
    const [a, b] = preset.value === 'iid' ? [75, 25] : preset.value === 'sticky' ? [90, 90] : [10, 10];
    const r = markovParity(a, b, Number(length.value), initial.value as 'fair' | 'zero' | 'one');
    const last = r.rows.at(-1)!;
    const tbody = el('tbody', {}, ...r.rows.map(row => el('tr', {},
      el('th', { scope: 'row' }, String(row.n)), el('td', {}, row.bias.toFixed(8)),
      el('td', {}, row.independent.toFixed(8)), el('td', {}, ((1 + row.bias) / 2).toFixed(8)),
      el('td', {}, (Number(row.boundNumerator) / Number(row.boundDenominator)).toFixed(8)))));
    const table = el('table', {}, el('caption', {}, 'Exact model results, rounded to eight decimals for display'),
      el('thead', {}, el('tr', {}, ...['Bits XORed', 'Signed bias', 'Product of marginal biases (independence assumed)', 'P(parity = 0)', 'First-order |bias| bound'].map(t => el('th', { scope: 'col' }, t)))), tbody);
    result.replaceChildren(
      el('p', {}, `P = [[${a}/100, ${100-a}/100], [${100-b}/100, ${b}/100]]. Conditional next-bit bias bound β = ${r.beta}.`),
      scroller('Parity probability table', table),
      el('p', { id: 'parity-exact', class: 'parity-exact' }, `Exact P(parity = 0): ${last.zeroNumerator}/${last.probabilityDenominator}. Signed bias: ${last.numerator}/${last.denominator}.`),
      el('p', { id: 'parity-distance' }, `Distance from a fair output bit: ${(Math.abs(last.bias) / 2).toFixed(8)}. Best single-bit guessing probability: ${((1 + Math.abs(last.bias)) / 2).toFixed(8)}.`),
      el('p', {}, 'Calculation: start with the chosen distribution of X₀; multiply its row vector by P·diag(1,−1) once per emitted bit, then sum its two entries. X₀ is not included in the XOR. Every probability above uses exact integer fractions, not sampled bits.'),
    );
    result.hidden = false;
    status.textContent = Math.abs(last.bias - last.independent) > 1e-12
      ? 'DEPENDENCE MATTERS — multiplying marginal biases gives the wrong parity prediction here.'
      : 'The two predictions agree at this length. Agreement at one length does not establish independence.';
  });
  return el('section', { class: 'card', id: 'parity-panel' },
    el('h2', {}, 'Does XOR remove bias when the source remembers?'),
    el('p', {}, 'For independent bits, XOR multiplies their biases. With memory, that shortcut can fail even when each bit individually looks fair. Predict what happens when two consecutive bits usually repeat, then compare odd and even block lengths.'),
    el('p', { class: 'note' }, 'Analytic model — not a hardware capture, a source assessment, or a replacement for the fixture measurements above.'),
    el('label', { for: 'parity-source' }, 'Source model'), preset,
    el('label', { for: 'parity-initial' }, 'Initial bit (before the block)'), initial,
    el('label', { for: 'parity-length' }, 'Bits in the XOR block'), length, run, status, result,
    el('p', {}, 'Scope: homogeneous first-order binary chains with declared transition probabilities. A balanced marginal or a zero-bias block does not certify independent output blocks, physical entropy, or security against an observer with extra side information. These conclusions do not transfer to arbitrary hidden or unbounded-memory sources.'),
    el('p', {}, 'Source: ', el('a', { href: 'https://eprint.iacr.org/2026/2417' }, 'Skorski and Mittmann, Unpredictability from Parity'), ', Theorem III.1, Corollary III.7 and Theorem III.11 (PDF pages 3–4).'));
}
