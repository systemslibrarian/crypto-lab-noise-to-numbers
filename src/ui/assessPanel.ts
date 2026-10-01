/**
 * ACT 3 — ASSESS MIN-ENTROPY.
 *
 * Every estimator gets its own row, its own figure, its own UNIT and its own
 * stated assumption. The minimum across them is marked as the binding one, and
 * the combination rule is shown rather than asserted, because for a multi-bit
 * width it is not the rule most readers assume:
 *
 *     assessed = min( H_original , wordSize x H_bitstring )
 *
 * Warnings and failures are FIRST-CLASS STATES here, not footnotes:
 *
 *   - a file below the sample minimum gets the tool's own refusal, verbatim,
 *     and no figure at all (invariants I1 and I6);
 *   - a run where an estimator declined is labelled "partial" (I2);
 *   - a modified file gets "SP 800-90B assessment not run on this modified
 *     file." and, again, no figure (I1).
 *
 * The panel follows Act 2's selection, so the figures on screen always belong
 * to the bytes on screen.
 */
import { clear, count, el, scroller } from './dom.ts';
import {
  UNIT_PER_BIT,
  UNIT_PER_SAMPLE,
  bitsPerBit,
  bitsPerSample,
  figure,
  noFigure,
} from './figures.ts';
import {
  NOT_RUN_SENTENCE,
  badgeRow,
  exploratorySentence,
  notRunBadge,
  partialBadge,
  provenanceBadge,
} from './labels.ts';
import { NON_IID_ESTIMATOR_COUNT, SAMPLE_MINIMUM } from '../entropy/thresholds.ts';
import { currentSample, onSampleChange, type LoadedSample } from './inspectPanel.ts';
import type { Manifest } from '../entropy/types.ts';

export function renderAssessPanel(root: HTMLElement, _manifest: Manifest): void {
  clear(root);

  root.append(
    el(
      'div',
      { class: 'onramp' },
      el('h2', {}, 'What an estimate actually claims'),
      el(
        'p',
        {},
        'SP 800-90B’s non-IID track runs ten estimators over the same samples and takes the ',
        el('strong', {}, 'smallest'),
        ' answer. Each one models the source differently — one assumes independence, one ' +
          'assumes a Markov chain, one looks for repeated tuples, four try to predict the next ' +
          'sample — and each is an upper bound on min-entropy ',
        el('em', {}, 'under its own assumptions'),
        '. Taking the minimum is a hedge: if any model can predict your source, you do not get ' +
          'to claim the others could not.'
      ),
      el(
        'p',
        {},
        'So an estimate is never just a number. It is a number plus the assumptions that produced ' +
          'it, plus the unit it is in. This panel shows all three for every estimator, and says ' +
          'which one bound the result.'
      ),
      el(
        'p',
        { class: 'note' },
        'Units matter more than they look. A figure of 7.35 "bits per sample" on an 8-bit stream ' +
          'and 0.37 "bits per sample" on a 1-bit stream are not comparable until both are read ' +
          'per bit — 0.919 against 0.373. The lab shows both and marks the per-bit figure as ' +
          'derived.'
      )
    )
  );

  const box = el('div', { id: 'assess-body', role: 'status', 'aria-live': 'polite' });
  root.append(box);

  const paint = (s: LoadedSample | null): void => {
    clear(box);
    if (s === null) {
      box.append(el('p', { class: 'note' }, 'Choose a sample in Act 2 to see its assessment.'));
      return;
    }
    box.append(renderAssessmentFor(s));
  };

  onSampleChange(paint);
  paint(currentSample());
}

function renderAssessmentFor(s: LoadedSample): HTMLElement {
  const card = el('div', { class: 'card' });
  card.append(el('h2', {}, `Assessment: ${s.label}`));

  // ── The no-assessment states, which come first because they are states ──
  if (s.fixture === null || s.modified) {
    card.append(
      el('div', { class: 'badge-row' }, provenanceBadge('modified'), notRunBadge()),
      el(
        'div',
        { class: 'verdict verdict-warn', 'data-verdict': 'assessment-not-run' },
        el('span', { 'aria-hidden': 'true' }, '⚠'),
        el(
          'span',
          { class: 'verdict-text' },
          el('strong', {}, NOT_RUN_SENTENCE),
          ' These bytes are not a shipped fixture, so no pinned native run exists for them. ' +
            'Descriptive statistics in Act 2 still apply — they describe whatever bytes are ' +
            'in front of them — but this lab will not show a min-entropy figure measured on ' +
            'a different file.'
        )
      ),
      el(
        'p',
        { class: 'note' },
        'In a later version an assessment engine running here in the browser would replace this ' +
          'state with a live run. Until it exists and has been validated against the native tool, ' +
          'the honest answer is that there is no figure.'
      )
    );
    return card;
  }

  const f = s.fixture;
  const a = f.assessment;
  card.append(badgeRow(f));

  if (a === null) {
    card.append(
      el(
        'div',
        { class: 'verdict verdict-warn', 'data-verdict': 'assessment-missing' },
        el('span', { 'aria-hidden': 'true' }, '⚠'),
        el('span', { class: 'verdict-text' }, 'No assessment is recorded for this fixture.')
      )
    );
    return card;
  }

  // ── The tool's refusal, verbatim ────────────────────────────────────────
  // Narrowed through locals so the figures below cannot be reached with a null
  // `hAssessed` -- the compiler enforces the "no figure without a run" rule
  // rather than this function remembering to.
  const overall = a.overall;
  const hAssessed = overall?.hAssessed ?? null;
  if (a.exitCode !== 0 || overall === null || hAssessed === null) {
    card.append(
      el(
        'div',
        { class: 'verdict verdict-bad', 'data-verdict': 'tool-refused' },
        el('span', { 'aria-hidden': 'true' }, '✕'),
        el(
          'span',
          { class: 'verdict-text' },
          el('strong', {}, 'The tool refused to assess this file, and that is the result. '),
          'It exited ',
          el('code', {}, String(a.exitCode)),
          ' and wrote no figures.'
        )
      ),
      el('h4', {}, 'What the tool reported'),
      el(
        'pre',
        { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Tool error message', 'data-claim': 'tool-error-message' },
        a.errorMessage ?? '(no message recorded)'
      )
    );
    if (a.belowMinimum) {
      card.append(
        el(
          'p',
          { 'data-claim': 'exploratory-sentence' },
          exploratorySentence(f.encoding.sampleCount)
        ),
        el(
          'p',
          {},
          'This is worth sitting with. The file is a perfectly good sample of the same model that ' +
            'produced the clean fixture — it is just too short. SP 800-90B Section 3.1.1 asks ' +
            `for ${count(SAMPLE_MINIMUM)} samples because several of the estimators have no ` +
            'meaningful sampling distribution below it. A tool that produced a number anyway ' +
            'would be giving you a figure with no standing, and a lab that displayed one would be ' +
            'teaching you to trust it.'
        )
      );
    }
    card.append(
      el('details', {}, el('summary', {}, 'The command that produced this refusal'), el('pre', { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Command' }, a.command))
    );
    return card;
  }

  // ── The headline figures ────────────────────────────────────────────────
  const o = overall;
  const width = o.dataWordSize ?? f.encoding.bitsPerSymbol;
  const grid = el('div', { class: 'figure-grid' });
  grid.append(
    figure('Assessed min-entropy', bitsPerSample(hAssessed, width), UNIT_PER_SAMPLE, {
      claim: 'assessed-per-sample',
    }),
    o.assessedBitsPerBit === null
      ? noFigure('Assessed, per bit', 'no word size recorded', 'assessed-per-bit')
      : figure('Assessed, per bit', bitsPerBit(o.assessedBitsPerBit), UNIT_PER_BIT, {
          claim: 'assessed-per-bit',
          derived: true,
        }),
    o.hOriginal === null
      ? noFigure('H_original', 'not reported', 'h-original')
      : figure('H_original (literal branch)', bitsPerSample(o.hOriginal, width), UNIT_PER_SAMPLE, {
          claim: 'h-original',
        }),
    o.hBitstring === null
      ? noFigure('H_bitstring', 'not reported at this width', 'h-bitstring')
      : figure('H_bitstring (bit-string branch)', bitsPerBit(o.hBitstring), UNIT_PER_BIT, {
          claim: 'h-bitstring',
        })
  );
  card.append(grid);

  if (a.partial) {
    card.append(
      el('div', { class: 'badge-row' }, partialBadge()),
      el(
        'div',
        { class: 'verdict verdict-warn', 'data-verdict': 'partial-coverage' },
        el('span', { 'aria-hidden': 'true' }, '◒'),
        el(
          'span',
          { class: 'verdict-text' },
          el('strong', {}, 'Partial estimator coverage. '),
          `Fewer than the ${NON_IID_ESTIMATOR_COUNT} estimators SP 800-90B 6.2 takes the minimum ` +
            'over produced a value, so the figure above is a minimum over those that did.'
        )
      )
    );
  }

  // ── The combination rule, shown ─────────────────────────────────────────
  const literal = a.estimators.map((e) => e.bitsPerSample).filter((v): v is number => v !== null);
  const bitstring = a.estimators.map((e) => e.bitsPerBit).filter((v): v is number => v !== null);
  const minLiteral = Math.min(...literal);
  const minBitstring = Math.min(...bitstring);
  card.append(
    el('h3', {}, 'How the minimum was taken'),
    el(
      'pre',
      { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Combination rule', 'data-claim': 'combination-rule' },
      width === 1
        ? [
            `H_original  = min over the ten estimators      = ${minLiteral.toFixed(9)} bits/sample`,
            '',
            'At a symbol width of 1 the sample sequence IS the bit string, so there is',
            'only one branch and the assessed figure is that minimum directly.',
            '',
            `assessed    = ${hAssessed.toFixed(9)} bits per sample (of ${width})`,
          ].join('\n')
        : [
            `H_original  = min over the LITERAL branch      = ${minLiteral.toFixed(9)} bits/sample`,
            `H_bitstring = min over the BIT-STRING branch   = ${minBitstring.toFixed(9)} bits/bit`,
            '',
            `assessed    = min( H_original , ${width} x H_bitstring )`,
            `            = min( ${minLiteral.toFixed(9)} , ${(width * minBitstring).toFixed(9)} )`,
            `            = ${hAssessed.toFixed(9)} bits per sample (of ${width})`,
            '',
            width === 1
              ? ''
              : `Note which term bound it: ${
                  minLiteral <= width * minBitstring ? 'H_original' : `${width} x H_bitstring`
                }.`,
          ]
            .filter((l) => l !== '')
            .join('\n')
    )
  );

  // ── The ten estimators ──────────────────────────────────────────────────
  const binding = width === 1 ? minLiteral : Math.min(minLiteral, width * minBitstring);
  const tbody = el('tbody', {});
  for (const e of a.estimators) {
    const own = width === 1 ? e.bitsPerSample : e.bitsPerSample;
    const isBinding =
      own !== null && Math.abs(own - binding) < 1e-12 && Math.abs(minLiteral - binding) < 1e-12;
    const isBindingBits =
      e.bitsPerBit !== null &&
      width > 1 &&
      Math.abs(width * e.bitsPerBit - binding) < 1e-9 &&
      Math.abs(width * minBitstring - binding) < 1e-9;
    const row = el('tr', isBinding || isBindingBits ? { class: 'binding' } : {});
    row.append(
      el('th', { scope: 'row' }, e.name),
      el(
        'td',
        { class: 'num', 'data-claim': `est-sample-${e.name.replace(/\s+/g, '-').toLowerCase()}` },
        e.bitsPerSample === null
          ? e.bitstringOnly && width > 1
            ? 'bit string only'
            : 'declined'
          : e.bitsPerSample.toFixed(6)
      ),
      el(
        'td',
        { class: 'num', 'data-claim': `est-bit-${e.name.replace(/\s+/g, '-').toLowerCase()}` },
        e.bitsPerBit === null ? 'declined' : e.bitsPerBit.toFixed(6)
      ),
      el('td', {}, e.assumption)
    );
    tbody.append(row);
  }
  card.append(
    el('h3', {}, `The ${NON_IID_ESTIMATOR_COUNT} non-IID estimators, individually`),
    scroller(
      'Per-estimator min-entropy figures and assumptions',
      el(
        'table',
        { 'data-claim': 'estimator-table' },
        el(
          'caption',
          {},
          `Each estimator’s own figure. The highlighted row is the one that bound the result. ` +
            `"Bit string only" marks an estimator SP 800-90B defines for binary inputs; "declined" ` +
            `marks one that could not produce a value.`
        ),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, 'Estimator'),
            el('th', { scope: 'col', class: 'num' }, `bits / sample (of ${width})`),
            el('th', { scope: 'col', class: 'num' }, 'bits / bit'),
            el('th', { scope: 'col' }, 'What it assumes')
          )
        ),
        tbody
      )
    ),
    el(
      'p',
      { class: 'note' },
      'This is the non-IID track. The vendor’s own documentation says adjacent bits from ' +
        'this design are correlated, which rules out the IID track: its permutation tests assume ' +
        'the samples could be reordered without changing the distribution, and here they could ' +
        'not.'
    )
  );

  return card;
}
