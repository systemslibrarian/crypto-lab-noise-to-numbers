/**
 * ACT 2 — INSPECT RAW SAMPLES.
 *
 * Everything this panel computes is DESCRIPTIVE and says so. Bit balance, run
 * lengths, lag-k autocorrelation and a repeated-block search are summaries of
 * a byte string; not one of them is an SP 800-90B estimator, and the panel
 * labels them so wherever they appear.
 *
 * THE MODIFIED-FILE RULE (v1). A visitor can load their own file or edit a
 * fixture's bytes. When they do, the descriptive statistics update and the
 * assessment panel shows "SP 800-90B assessment not run on this modified
 * file." No figure from the clean fixture is carried over, because it would be
 * a figure for different bytes (invariant I1).
 *
 * The analysis runs in a Web Worker with progress, cancellation and a size
 * cap. Cancelling discards the run rather than reporting a partial summary.
 */
import { bitStrip, clear, count, el, hexDump, scroller } from './dom.ts';
import { corr, pct } from './figures.ts';
import { badgeRow, provenanceBadge } from './labels.ts';
import { fixtureById } from '../entropy/manifest.ts';
import { INPUT_SIZE_CAP, type DescriptiveStats } from '../entropy/descriptive.ts';
import { unpackBits } from '../entropy/encoding.ts';
import { fixtureDossier } from './fixtureCard.ts';
import type { Fixture, Manifest } from '../entropy/types.ts';
import type { AnalyseRequest, WorkerResponse } from '../worker/descriptive.worker.ts';

/** The bytes currently under inspection, and where they came from. */
export interface LoadedSample {
  /** The fixture these bytes came from, or null for a visitor's own file. */
  fixture: Fixture | null;
  label: string;
  /** True when the bytes differ from any shipped fixture's. */
  modified: boolean;
  bytes: Uint8Array;
  form: 'packed-bits' | 'one-sample-per-byte';
  bitsPerSymbol: number;
  sampleCount: number;
}

type Listener = (s: LoadedSample) => void;

const listeners: Listener[] = [];
/** Act 3 subscribes so it always describes the bytes Act 2 is showing. */
export function onSampleChange(fn: Listener): void {
  listeners.push(fn);
}

let current: LoadedSample | null = null;
export function currentSample(): LoadedSample | null {
  return current;
}

const BASE = import.meta.env.BASE_URL;

export function renderInspectPanel(root: HTMLElement, manifest: Manifest): void {
  clear(root);

  root.append(
    el(
      'div',
      { class: 'onramp' },
      el('h2', {}, 'Looking at the bytes'),
      el(
        'p',
        {},
        'Before any estimator, look at the sample. Are ones and zeros equally common? How long do ' +
          'runs of the same value get? Does a sample tell you anything about the one k positions ' +
          'later? Does any block of the file appear twice?'
      ),
      el(
        'p',
        {},
        'These are ',
        el('strong', {}, 'descriptive statistics'),
        ': summaries of the bytes in front of you. They are useful for noticing that something is ' +
          'wrong, and they are ',
        el('strong', {}, 'not'),
        ' entropy estimates. A stream can pass every one of them and still be completely ' +
          'predictable — Act 5 shows exactly that happening.'
      )
    )
  );

  // ── Picker ──────────────────────────────────────────────────────────────
  const options = manifest.fixtures.map((f) =>
    el('option', { value: f.id }, `${f.title} — ${f.id}`)
  );
  const select = el('select', { id: 'sample-select', 'aria-label': 'Fixture to inspect' }, ...options);

  const fileInput = el('input', {
    type: 'file',
    id: 'sample-file',
    'aria-label': 'Load your own sample file',
    accept: '.bin,application/octet-stream',
  }) as HTMLInputElement;

  const widthSelect = el(
    'select',
    { id: 'sample-width', 'aria-label': 'Bits per symbol to read the file as' },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((w) => el('option', { value: String(w) }, `${w} bit${w === 1 ? '' : 's'} per sample`))
  ) as HTMLSelectElement;

  const formSelect = el(
    'select',
    { id: 'sample-form', 'aria-label': 'How to read the file’s layout' },
    el('option', { value: 'one-sample-per-byte' }, 'one sample per byte'),
    el('option', { value: 'packed-bits' }, 'packed bits, eight per byte')
  ) as HTMLSelectElement;

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'analyse-run' }, 'Analyse');
  const cancelBtn = el('button', { class: 'btn', type: 'button', id: 'analyse-cancel', disabled: '' }, 'Cancel');

  root.append(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Choose a sample'),
      el(
        'div',
        { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'sample-select' }, 'Shipped fixture'), select),
        el('div', { class: 'field' }, el('label', { for: 'sample-file' }, 'Or your own file'), fileInput),
        el('div', { class: 'field' }, el('label', { for: 'sample-form' }, 'Read the bytes as'), formSelect),
        el('div', { class: 'field' }, el('label', { for: 'sample-width' }, 'Symbol width'), widthSelect),
        runBtn,
        cancelBtn
      ),
      el(
        'p',
        { class: 'note' },
        `Your file never leaves the browser — there is no server here. Analysis is capped at ` +
          `${count(INPUT_SIZE_CAP)} bytes.`
      )
    )
  );

  const statusBox = el('div', { id: 'sample-status' });
  const progressFill = el('div', { class: 'progress-fill' });
  const progressPct = el('span', { class: 'progress-pct' }, '');
  const progressRow = el(
    'div',
    { class: 'progress-row', id: 'analyse-progress', hidden: '' },
    el('div', { class: 'progress-track', role: 'progressbar', 'aria-label': 'Analysis progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, progressFill),
    progressPct
  );
  const liveBox = el('div', { id: 'analyse-live', role: 'status', 'aria-live': 'polite' });
  const statsBox = el('div', { id: 'sample-stats' });
  const dossierBox = el('div', { id: 'sample-dossier' });
  root.append(statusBox, progressRow, liveBox, statsBox, dossierBox);

  // ── Worker plumbing ─────────────────────────────────────────────────────
  const worker = new Worker(new URL('../worker/descriptive.worker.ts', import.meta.url), {
    type: 'module',
  });
  let runId = 0;
  let activeRun: number | null = null;

  const setBusy = (busy: boolean): void => {
    runBtn.disabled = busy;
    (cancelBtn as HTMLButtonElement).disabled = !busy;
    progressRow.hidden = !busy;
    if (!busy) {
      progressFill.style.width = '0';
      progressPct.textContent = '';
    }
  };

  worker.onmessage = (ev: MessageEvent<WorkerResponse>): void => {
    const m = ev.data;
    if (m.runId !== activeRun) return; // a stale run's message
    if (m.kind === 'progress') {
      const p = Math.round(m.fraction * 100);
      progressFill.style.width = `${p}%`;
      progressPct.textContent = `${p}%`;
      progressRow.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(p));
      return;
    }
    if (m.kind === 'done') {
      setBusy(false);
      activeRun = null;
      liveBox.textContent = 'Descriptive analysis complete.';
      renderStats(statsBox, m.stats, current);
      return;
    }
    if (m.kind === 'cancelled') {
      setBusy(false);
      activeRun = null;
      clear(statsBox);
      liveBox.textContent =
        'Analysis cancelled. No statistics are shown, because a half-finished summary is not a summary.';
      return;
    }
    setBusy(false);
    activeRun = null;
    clear(statsBox);
    liveBox.textContent = '';
    statsBox.append(
      el(
        'div',
        { class: 'verdict verdict-bad', 'data-verdict': `analyse-error-${m.code}` },
        el('span', { 'aria-hidden': 'true' }, '✕'),
        el('span', { class: 'verdict-text' }, el('strong', {}, 'Cannot analyse. '), m.message)
      )
    );
  };

  const analyse = (): void => {
    if (current === null) return;
    const s = current;
    if (s.bytes.length === 0) {
      clear(statsBox);
      liveBox.textContent = '';
      statsBox.append(
        el(
          'div',
          { class: 'verdict verdict-bad', 'data-verdict': 'analyse-error-empty' },
          el('span', { 'aria-hidden': 'true' }, '✕'),
          el(
            'span',
            { class: 'verdict-text' },
            el('strong', {}, 'Empty file. '),
            'There are no samples to describe, and an empty input is not a source with zero entropy — it is no evidence at all.'
          )
        )
      );
      return;
    }
    runId++;
    activeRun = runId;
    setBusy(true);
    liveBox.textContent = 'Analysing…';
    const copy = s.bytes.slice();
    const req: AnalyseRequest = {
      kind: 'analyse',
      runId,
      bytes: copy.buffer as ArrayBuffer,
      form: s.form,
      bitsPerSymbol: s.bitsPerSymbol,
      sampleCount: s.form === 'packed-bits' ? s.sampleCount : null,
    };
    worker.postMessage(req, [copy.buffer as ArrayBuffer]);
  };

  runBtn.addEventListener('click', analyse);
  cancelBtn.addEventListener('click', () => {
    if (activeRun !== null) worker.postMessage({ kind: 'cancel', runId: activeRun });
  });

  // ── Loading ─────────────────────────────────────────────────────────────
  const publish = (s: LoadedSample): void => {
    current = s;
    clear(statusBox);
    clear(statsBox);
    clear(dossierBox);
    liveBox.textContent = '';
    statusBox.append(
      el('h3', {}, s.label),
      s.fixture ? badgeRow(s.fixture) : el('div', { class: 'badge-row' }, provenanceBadge('modified')),
      el(
        'p',
        { class: 'note' },
        `${count(s.sampleCount)} samples at ${s.bitsPerSymbol} bit${s.bitsPerSymbol === 1 ? '' : 's'} per sample, ` +
          `read as ${s.form === 'packed-bits' ? 'packed bits' : 'one sample per byte'}.`
      )
    );
    if (s.fixture) dossierBox.append(fixtureDossier(s.fixture));
    for (const fn of listeners) fn(s);
    analyse();
  };

  const loadFixture = async (id: string): Promise<void> => {
    const f = fixtureById(manifest, id);
    if (!f) return;
    const res = await fetch(`${BASE}${f.download}`);
    if (!res.ok) {
      clear(statusBox);
      statusBox.append(
        el(
          'div',
          { class: 'verdict verdict-bad', 'data-verdict': 'fixture-fetch-failed' },
          el('span', { 'aria-hidden': 'true' }, '✕'),
          el('span', { class: 'verdict-text' }, `Could not load ${f.download} (HTTP ${res.status}).`)
        )
      );
      return;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    formSelect.value = f.encoding.shippedForm;
    widthSelect.value = String(f.encoding.bitsPerSymbol);
    publish({
      fixture: f,
      label: f.title,
      modified: false,
      bytes,
      form: f.encoding.shippedForm,
      bitsPerSymbol: f.encoding.bitsPerSymbol,
      sampleCount: f.encoding.sampleCount,
    });
  };

  select.addEventListener('change', () => {
    fileInput.value = '';
    void loadFixture((select as HTMLSelectElement).value);
  });

  const reread = (): void => {
    if (current === null) return;
    const form = formSelect.value as 'packed-bits' | 'one-sample-per-byte';
    const width = Number(widthSelect.value);
    const sampleCount = form === 'packed-bits' ? current.bytes.length * 8 : current.bytes.length;
    // Re-reading the SAME bytes under a different declared encoding produces a
    // different set of samples, so it is a modification as far as any recorded
    // assessment is concerned: the figures on file were measured for one
    // reading of these bytes, not for this one.
    const changed =
      current.fixture !== null &&
      (form !== current.fixture.encoding.shippedForm || width !== current.fixture.encoding.bitsPerSymbol);
    publish({
      ...current,
      modified: current.modified || changed,
      fixture: changed ? null : current.fixture,
      label: changed ? `${current.label} — re-read as ${width}-bit ${form}` : current.label,
      form,
      bitsPerSymbol: width,
      sampleCount,
    });
  };
  formSelect.addEventListener('change', reread);
  widthSelect.addEventListener('change', reread);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void (async (): Promise<void> => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const form = formSelect.value as 'packed-bits' | 'one-sample-per-byte';
      const width = Number(widthSelect.value);
      publish({
        fixture: null,
        label: `Your file: ${file.name}`,
        modified: true,
        bytes,
        form,
        bitsPerSymbol: width,
        sampleCount: form === 'packed-bits' ? bytes.length * 8 : bytes.length,
      });
    })();
  });

  void loadFixture('inm-clean');
}

/** The descriptive statistics table. Every heading says "descriptive". */
function renderStats(box: HTMLElement, s: DescriptiveStats, loaded: LoadedSample | null): void {
  clear(box);
  const card = el('div', { class: 'card' });
  card.append(
    el('h3', {}, 'Descriptive statistics'),
    el(
      'div',
      { class: 'verdict verdict-info', 'data-claim': 'descriptive-disclaimer' },
      el('span', { 'aria-hidden': 'true' }, 'ℹ'),
      el(
        'span',
        { class: 'verdict-text' },
        'Descriptive — not an SP 800-90B estimator. Nothing on this card is a min-entropy figure.'
      )
    )
  );

  const rows: Array<[string, string]> = [
    ['Samples', count(s.sampleCount)],
    ['Symbol width', `${s.bitsPerSymbol} bit${s.bitsPerSymbol === 1 ? '' : 's'} per sample`],
    ['Distinct symbol values', count(s.distinctSymbols)],
    [
      'Most common value',
      `0x${s.mostCommon.value.toString(16).padStart(2, '0')} appears ${count(s.mostCommon.count)} times (${pct(s.mostCommon.proportion)})`,
    ],
    ['Bit balance (proportion of ones)', pct(s.bitBalance)],
  ];
  if (s.runs) {
    rows.push(
      ['Longest run of ones', count(s.runs.longestOnes)],
      ['Longest run of zeros', count(s.runs.longestZeros)],
      ['Total runs', count(s.runs.totalRuns)]
    );
  }
  rows.push([
    `Repeated block (256 samples)`,
    s.repeatedBlock
      ? `found at offsets ${count(s.repeatedBlock.firstOffset)} and ${count(s.repeatedBlock.secondOffset)}`
      : 'none found',
  ]);

  const tbody = el('tbody', {});
  for (const [k, v] of rows) {
    tbody.append(el('tr', {}, el('th', { scope: 'row' }, k), el('td', { class: 'num' }, v)));
  }
  card.append(
    scroller(
      'Descriptive statistics',
      el(
        'table',
        { 'data-claim': 'descriptive-table' },
        el('caption', {}, 'Summaries of the bytes on screen. Descriptive — not SP 800-90B estimators.'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Statistic'), el('th', { scope: 'col', class: 'num' }, 'Value'))),
        tbody
      )
    )
  );

  // Autocorrelation.
  const acBody = el('tbody', {});
  for (const a of s.autocorrelation) {
    acBody.append(
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, `lag ${a.lag}`),
        el('td', { class: 'num', 'data-claim': `autocorr-${a.lag}` }, corr(a.r))
      )
    );
  }
  card.append(
    el('h4', {}, 'Lag-k autocorrelation'),
    scroller(
      'Lag-k autocorrelation',
      el(
        'table',
        {},
        el(
          'caption',
          {},
          'Pearson correlation between each sample and the one k positions later. Independent samples sit near zero; "undefined" means every sample is identical, so correlation has no value.'
        ),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Lag'), el('th', { scope: 'col', class: 'num' }, 'r'))),
        acBody
      )
    )
  );

  // The bytes themselves.
  if (loaded) {
    const samples =
      loaded.form === 'packed-bits'
        ? unpackBits(loaded.bytes, Math.min(loaded.sampleCount, 1024), 'msb-first')
        : loaded.bytes.subarray(0, 1024);
    card.append(
      el('h4', {}, 'The first bytes, as shipped'),
      el('pre', { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Hex dump of the first bytes' }, hexDump(loaded.bytes, 256))
    );
    if (loaded.bitsPerSymbol === 1) {
      card.append(
        el('h4', {}, 'The first samples, as bits'),
        el('pre', { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'First samples as bits' }, bitStrip(samples, 256))
      );
    }
  }

  box.append(card);
}
