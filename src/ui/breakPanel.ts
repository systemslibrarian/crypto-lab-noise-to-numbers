/**
 * ACT 4 — BREAK THE STREAM.
 *
 * Five predefined faults against the clean fixture, each with its own pinned
 * native run. The table records WHICH ESTIMATORS MOVED AND WHICH DID NOT, as
 * measured, and it is not arranged to flatter the estimators.
 *
 * THE RESULT THE BRIEF WARNED NOT TO ASSUME. Two of the five faults — the
 * stuck bit and the periodic contamination — RAISE the reported figure above
 * the clean fixture's. Several estimators do detect them and drop sharply; but
 * the reported figure is a MINIMUM, and the estimator that happened to be
 * binding got a better score on the broken file than on the clean one. A fault
 * can be visible to half the battery and still leave the headline number
 * looking healthier.
 *
 * That is why SP 800-90B separates continuous health tests (Section 4.4) from
 * estimation, and why an entropy claim is about a source model with a
 * justification, not about a number that came out high once.
 */
import { clear, el, scroller } from './dom.ts';
import { UNIT_PER_BIT, bitsPerBit, figure } from './figures.ts';
import { badgeRow } from './labels.ts';
import { fixtureById } from '../entropy/manifest.ts';
import type { Fixture, Manifest } from '../entropy/types.ts';

/** Per-bit figure for a fixture, or null when it has none. */
function perBit(f: Fixture | undefined): number | null {
  return f?.assessment?.overall?.assessedBitsPerBit ?? null;
}

export function renderBreakPanel(root: HTMLElement, manifest: Manifest): void {
  clear(root);

  const clean = fixtureById(manifest, 'inm-clean');
  const faults = manifest.fixtures.filter((f) => f.variantOf === 'inm-clean');

  root.append(
    el(
      'div',
      { class: 'onramp' },
      el('h2', {}, 'Breaking it on purpose'),
      el(
        'p',
        {},
        'Each fault below is the same modelled circuit with one thing wrong: a data line shorted ' +
          'high, a comparator drifted off centre, a clock coupling in, a source that reset and ' +
          'repeated itself, and — the control — a stream with no physical noise in it ' +
          'at all. Each is a shipped fixture with its own pinned native run.'
      ),
      el(
        'p',
        {},
        'The obvious expectation is that breaking the source lowers the number. Read the table ' +
          'before deciding whether that happened.'
      )
    )
  );

  if (!clean || perBit(clean) === null) {
    root.append(el('p', { class: 'note' }, 'The clean fixture has no recorded figure to compare against.'));
    return;
  }
  const cleanPerBit = perBit(clean)!;

  // ── The headline comparison ─────────────────────────────────────────────
  const raised = faults.filter((f) => {
    const v = perBit(f);
    return v !== null && v > cleanPerBit;
  });
  const summary = el('div', { class: 'card' });
  summary.append(
    el('h2', {}, 'What the faults did to the reported figure'),
    el(
      'div',
      { class: 'figure-grid' },
      figure('Clean fixture', bitsPerBit(cleanPerBit), UNIT_PER_BIT, {
        claim: 'break-clean-per-bit',
        derived: true,
      }),
      figure(
        'Faults that LOWERED it',
        String(faults.length - raised.length),
        `of ${faults.length} fault fixtures`,
        { claim: 'break-lowered-count' }
      ),
      figure('Faults that RAISED it', String(raised.length), `of ${faults.length} fault fixtures`, {
        claim: 'break-raised-count',
      })
    )
  );
  if (raised.length > 0) {
    summary.append(
      el(
        'div',
        { class: 'verdict verdict-warn', 'data-verdict': 'faults-raised-estimate' },
        el('span', { 'aria-hidden': 'true' }, '⚠'),
        el(
          'span',
          { class: 'verdict-text' },
          el(
            'strong',
            {},
            `${raised.length} of these ${faults.length} broken streams ` +
              `${raised.length === 1 ? 'reports' : 'report'} a HIGHER min-entropy figure than the clean one. `
          ),
          'Not because the faults went unnoticed — look down the columns and you will find ' +
            'estimators that dropped sharply on exactly those files. But the reported figure is ' +
            'the minimum across the battery, and on these files the estimator that was binding ' +
            'scored better broken than intact. A rising number is not evidence that nothing is ' +
            'wrong.'
        )
      )
    );
  }
  root.append(summary);

  // ── The per-estimator movement table ────────────────────────────────────
  const names = clean.assessment!.estimators.map((e) => e.name);
  const cleanByName = new Map(clean.assessment!.estimators.map((e) => [e.name, e]));

  const head = el(
    'tr',
    {},
    el('th', { scope: 'col' }, 'Estimator'),
    el('th', { scope: 'col', class: 'num' }, 'clean')
  );
  for (const f of faults) {
    head.append(el('th', { scope: 'col', class: 'num' }, f.id.replace(/^fault-/, '')));
  }

  const tbody = el('tbody', {});
  for (const name of names) {
    const base = cleanByName.get(name)?.bitsPerBit ?? null;
    const row = el(
      'tr',
      {},
      el('th', { scope: 'row' }, name),
      el('td', { class: 'num' }, base === null ? 'declined' : base.toFixed(6))
    );
    for (const f of faults) {
      const e = f.assessment?.estimators.find((x) => x.name === name);
      const v = e?.bitsPerBit ?? null;
      if (v === null || base === null) {
        row.append(el('td', { class: 'num moved-flat' }, 'declined'));
        continue;
      }
      const delta = v - base;
      // Direction is carried by a WORD (down/up/flat) as well as a colour and
      // a signed number, so the table does not rely on hue (WCAG 1.4.1).
      const dir = Math.abs(delta) < 1e-6 ? 'flat' : delta < 0 ? 'down' : 'up';
      const cls = dir === 'down' ? 'moved-down' : dir === 'up' ? 'moved-up' : 'moved-flat';
      row.append(
        el(
          'td',
          {
            class: `num ${cls}`,
            'data-claim': `move-${f.id}-${name.replace(/\s+/g, '-').toLowerCase()}`,
            'data-direction': dir,
          },
          `${v.toFixed(6)} (${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(6)} ${dir})`
        )
      );
    }
    tbody.append(row);
  }

  // The assessed row, which is the one a reader would quote.
  const assessedRow = el(
    'tr',
    { class: 'binding' },
    el('th', { scope: 'row' }, 'ASSESSED (the minimum)'),
    el('td', { class: 'num' }, cleanPerBit.toFixed(6))
  );
  for (const f of faults) {
    const v = perBit(f);
    if (v === null) {
      assessedRow.append(el('td', { class: 'num moved-flat' }, 'no figure'));
      continue;
    }
    const delta = v - cleanPerBit;
    const dir = Math.abs(delta) < 1e-6 ? 'flat' : delta < 0 ? 'down' : 'up';
    const cls = dir === 'down' ? 'moved-down' : dir === 'up' ? 'moved-up' : 'moved-flat';
    assessedRow.append(
      el(
        'td',
        { class: `num ${cls}`, 'data-claim': `assessed-${f.id}`, 'data-direction': dir },
        `${v.toFixed(6)} (${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(6)} ${dir})`
      )
    );
  }
  tbody.append(assessedRow);

  root.append(
    el(
      'div',
      { class: 'card' },
      el('h3', {}, 'Which estimators moved'),
      scroller(
        'Per-estimator movement from the clean fixture to each fault',
        el(
          'table',
          { 'data-claim': 'fault-table' },
          el(
            'caption',
            {},
            'Min-entropy in bits per bit, measured. Each cell shows the fault’s figure and ' +
              'its signed movement from the clean fixture, with the direction spelled out. The ' +
              'final row is the assessed minimum — the figure anyone would actually quote.'
          ),
          el('thead', {}, head),
          tbody
        )
      ),
      el(
        'p',
        { class: 'note' },
        'Read the repeated-block column. LRS collapses to effectively zero there, because the ' +
          'longest repeated substring in that file is enormous — and because LRS becomes the ' +
          'binding estimator, the assessed figure collapses with it. That is the battery working ' +
          'exactly as designed, on the one fault it is unambiguously built to catch.'
      )
    )
  );

  // ── The fixtures themselves ─────────────────────────────────────────────
  const list = el('div', { class: 'card' });
  list.append(el('h3', {}, 'The fault fixtures'));
  for (const f of faults) {
    list.append(
      el(
        'div',
        { 'data-fixture-summary': f.id },
        el('h4', {}, f.title),
        badgeRow(f),
        el('p', {}, f.blurb),
        el('p', { class: 'note' }, f.procedure)
      )
    );
  }
  list.append(
    el(
      'p',
      { class: 'note' },
      'Full encoding, checksums and reproduction commands for each of these are in Act 2 — ' +
        'select the fixture there.'
    )
  );
  root.append(list);

  // ── The modified-file rule, restated where it applies ───────────────────
  root.append(
    el(
      'div',
      { class: 'card' },
      el('h3', {}, 'Why you cannot break it yourself here — yet'),
      el(
        'p',
        {},
        'Act 2 will happily let you edit bytes or load your own file, and the descriptive ' +
          'statistics will follow along. What it will not do is show you a min-entropy figure for ' +
          'those bytes, because no assessment has been run on them. Every figure in this lab comes ' +
          'from a pinned run of the native tool on one exact file.'
      ),
      el(
        'p',
        {},
        'The alternative would be to run the estimators in your browser. That is a real ' +
          'possibility — the feasibility work is written up in SPIKE.md — and until an ' +
          'engine exists and has been validated against the native tool, inventing a number here ' +
          'would undo the point of the lab.'
      )
    )
  );
}
