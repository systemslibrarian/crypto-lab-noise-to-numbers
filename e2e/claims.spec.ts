import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectMarkerText, expectMarkerVisible } from './sink';
import { MUTATIONS } from './mutations';

/**
 * THE CLAIMS SUITE (§4.1b) AND THE NEGATIVE CLAIMS (§4.1d).
 *
 * The rule that makes these worth anything: compare two values the page itself
 * printed, or RE-DERIVE a claim from the page's raw inputs by a different
 * route than the source takes — never assert against a hardcoded string that
 * merely repeats what the source already computes. A test that re-runs the
 * same expression the source does will happily agree with a bug.
 *
 * Internal consistency alone is not enough either: a page can be consistently
 * wrong. So this suite mixes three shapes deliberately.
 *
 *   CROSS-CHECKS — two surfaces that must agree. The assessed figure in Act 3
 *   against the same fixture's figure in Act 4's table and Act 5's comparison;
 *   the combination-rule block against the estimator table it summarises; the
 *   fault table's movement arithmetic against its own two endpoints.
 *
 *   INDEPENDENT RE-DERIVATIONS — the manifest is read FROM DISK here, by this
 *   test, and the figures on screen are checked against it; the descriptive
 *   statistics are recomputed from the fixture's own bytes, fetched and
 *   unpacked by the test rather than by the page; the counter-hash stream's
 *   bytes are regenerated with Node's crypto and compared with what the page
 *   printed from WebCrypto.
 *
 *   PARTS-SUM-TO-WHOLE — the assessed figure must be the minimum its own
 *   combination rule produces, and the per-bit figure must be the per-sample
 *   figure over the word size.
 *
 * Plus the states the brief calls first-class: the tool's refusal, the
 * "assessment not run" retirement, partial coverage, and the `[hidden]` probe.
 */

const ROOT = resolve(import.meta.dirname, '..');

interface ManifestFixture {
  id: string;
  title: string;
  provenance: string;
  neverASecret: boolean;
  variantOf: string | null;
  encoding: {
    bitsPerSymbol: number;
    sampleCount: number;
    shippedForm: string;
    originalBytes: number;
    originalSha256: string;
    convertedSha256: string;
  };
  download: string;
  assessment: {
    exitCode: number;
    errorLevel: number;
    errorMessage: string | null;
    toolSha256: string;
    partial: boolean;
    belowMinimum: boolean;
    tool: { forkCommit: string; patched: boolean };
    estimators: Array<{
      name: string;
      bitsPerSample: number | null;
      bitsPerBit: number | null;
      declined: boolean;
    }>;
    overall: {
      hOriginal: number | null;
      hBitstring: number | null;
      hAssessed: number | null;
      dataWordSize: number | null;
      assessedBitsPerBit: number | null;
    } | null;
  } | null;
}

const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, 'fixtures/manifest.json'), 'utf8')
) as { sampleMinimum: number; fixtures: ManifestFixture[] };

const byId = (id: string): ManifestFixture => {
  const f = MANIFEST.fixtures.find((x) => x.id === id);
  if (!f) throw new Error(`no fixture "${id}" in the manifest`);
  return f;
};

/** The threshold the page pins, read from source so the test cannot drift. */
const THRESHOLD = (() => {
  const src = readFileSync(resolve(ROOT, 'src/entropy/thresholds.ts'), 'utf8');
  const m = src.match(/HIGH_ESTIMATE_BITS_PER_BIT\s*=\s*([\d.]+)/);
  if (!m) throw new Error('could not read the pinned threshold out of thresholds.ts');
  return Number(m[1]);
})();

async function boot(page: Page): Promise<void> {
  page.setDefaultTimeout(30_000);
  await page.goto('.');
  await expect(page.locator('h1')).toHaveText('Noise to Numbers');
  await expect(page.locator('[data-verdict="manifest-invalid"]')).toHaveCount(0);
}

async function openAct(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

async function selectFixture(page: Page, id: string): Promise<void> {
  await openAct(page, /Inspect Raw Samples/);
  await page.selectOption('#sample-select', id);
  await expect(page.locator('[data-claim="descriptive-table"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#analyse-progress')).toBeHidden();
}

/** Parse a "0.372519 / 1" figure value into its number. */
function parseFigure(text: string): number {
  const m = text.trim().match(/^([\d.]+)\s*\/\s*(\d+)$/);
  if (!m) throw new Error(`not a figure with a unit: ${JSON.stringify(text)}`);
  return Number(m[1]);
}

// ══════════════════════════════════════════════════════════════════════════
// The manifest, and the page's agreement with it
// ══════════════════════════════════════════════════════════════════════════

test('the manifest the page renders is the manifest on disk, and it validates', async ({ page }) => {
  const title = test.info().title;
  await boot(page);

  // The page fails CLOSED on an invalid manifest, so the absence of that card
  // IS the assertion that validation passed in the browser.
  await expectMarkerVisible(title, 'manifest-validates', page.locator('#panel-source'));
  await expect(page.locator('.tab-btn:disabled')).toHaveCount(0);

  // INDEPENDENT RE-DERIVATION of the tool's combination rule, done here from
  // the per-estimator values rather than by reading hAssessed. The naive
  // reading — the minimum of the per-bit column — agrees on every 1-bit
  // fixture and DISAGREES on both 8-bit ones, so this is checked against a
  // fixture where the two readings genuinely differ.
  let sawMultiBit = false;
  for (const f of MANIFEST.fixtures) {
    const a = f.assessment;
    if (!a || !a.overall || a.overall.hAssessed === null) continue;
    const width = a.overall.dataWordSize!;
    const literal = a.estimators.map((e) => e.bitsPerSample).filter((v): v is number => v !== null);
    const bits = a.estimators.map((e) => e.bitsPerBit).filter((v): v is number => v !== null);
    const minLit = Math.min(...literal);
    const minBits = Math.min(...bits);
    const expected = width === 1 ? minLit : Math.min(minLit, width * minBits);
    expect(a.overall.hAssessed, `${f.id} assessed figure`).toBeCloseTo(expected, 9);
    expect(a.overall.hOriginal, `${f.id} H_original`).toBeCloseTo(minLit, 9);
    // PARTS-SUM-TO-WHOLE: the per-bit figure is the per-sample figure over the width.
    expect(a.overall.assessedBitsPerBit, `${f.id} per-bit`).toBeCloseTo(
      a.overall.hAssessed / width,
      12
    );
    if (width > 1) {
      sawMultiBit = true;
      expect(a.overall.hBitstring, `${f.id} H_bitstring`).toBeCloseTo(minBits, 9);
      expect(
        Math.abs(a.overall.assessedBitsPerBit! - minBits),
        `${f.id}: the naive per-bit minimum must differ here, or this check proves nothing`
      ).toBeGreaterThan(1e-6);
    }
  }
  expect(sawMultiBit, 'at least one multi-bit fixture must exercise the combination rule').toBe(true);
});

test('every displayed figure belongs to the file being viewed (invariant I1)', async ({ page }) => {
  await boot(page);
  for (const f of MANIFEST.fixtures) {
    if (!f.assessment) continue;
    // The tool hashes its own input. That hash must be the converted form of
    // THIS fixture, or the figures describe some other file.
    expect(f.assessment.toolSha256, f.id).toBe(f.encoding.convertedSha256);
  }

  // And the shipped bytes really do hash to what the manifest records — read
  // here from disk, not from the page.
  const { createHash } = await import('node:crypto');
  for (const f of MANIFEST.fixtures) {
    const bytes = readFileSync(resolve(ROOT, 'public', f.download));
    expect(createHash('sha256').update(bytes).digest('hex'), f.id).toBe(
      f.encoding.originalSha256
    );
  }

  // The page prints the same checksums it was built from.
  await selectFixture(page, 'inm-clean');
  await page.locator('#panel-inspect details > summary').first().click();
  const clean = byId('inm-clean');
  await expect(page.locator('[data-claim="sha-original-inm-clean"]')).toHaveText(
    clean.encoding.originalSha256
  );
  await expect(page.locator('[data-claim="sha-converted-inm-clean"]')).toHaveText(
    clean.encoding.convertedSha256
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Act 3 — the assessment, cross-checked
// ══════════════════════════════════════════════════════════════════════════

test('Act 3 prints the recorded figures, with units, and the estimator table agrees with them', async ({
  page,
}) => {
  await boot(page);
  await selectFixture(page, 'inm-clean');
  await openAct(page, /Assess Min-Entropy/);

  const f = byId('inm-clean');
  const o = f.assessment!.overall!;
  const width = o.dataWordSize!;

  const perSample = parseFigure(
    (await page.locator('[data-claim="assessed-per-sample"] .figure-value').innerText())
  );
  const perBit = parseFigure(
    (await page.locator('[data-claim="assessed-per-bit"] .figure-value').innerText())
  );
  expect(perSample).toBeCloseTo(o.hAssessed!, 6);
  expect(perBit).toBeCloseTo(o.assessedBitsPerBit!, 6);
  // CROSS-CHECK between two surfaces the page printed: per-bit is per-sample
  // over the width, and the width is printed in the unit string itself.
  expect(perBit).toBeCloseTo(perSample / width, 6);
  await expect(page.locator('[data-claim="assessed-per-sample"] .figure-unit')).toContainText(
    'bits of min-entropy per sample'
  );
  await expect(page.locator('[data-claim="assessed-per-bit"] .figure-unit')).toContainText(
    'derived'
  );

  // RE-DERIVATION from the page's own estimator table: the binding figure must
  // be the minimum of the column the page itself rendered.
  const cells = await page.locator('[data-claim^="est-sample-"]').allInnerTexts();
  const values = cells.map((c) => Number(c)).filter((v) => Number.isFinite(v));
  expect(values.length).toBe(10);
  expect(Math.min(...values)).toBeCloseTo(perSample, 6);

  // The table has exactly the ten estimators SP 800-90B 6.2 names.
  await expect(page.locator('[data-claim="estimator-table"] tbody tr')).toHaveCount(10);
  // Exactly one row is marked binding.
  await expect(page.locator('[data-claim="estimator-table"] tr.binding')).toHaveCount(1);

  // The combination-rule block quotes the same number it is explaining.
  await expect(page.locator('[data-claim="combination-rule"]')).toContainText(
    o.hAssessed!.toFixed(9)
  );
});

test('the page never says bare "entropy" where it means min-entropy', async ({ page }) => {
  await boot(page);
  await selectFixture(page, 'inm-clean');
  await openAct(page, /Assess Min-Entropy/);
  for (const unit of await page.locator('.figure-unit').allInnerTexts()) {
    if (!/entropy/i.test(unit)) continue;
    expect(unit, `every entropy unit must say min-entropy: ${unit}`).toMatch(/min-entropy/);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// The first-class failure and warning states
// ══════════════════════════════════════════════════════════════════════════

test('a below-minimum file shows the tool’s own refusal and NO figure (I6)', async ({
  page,
}) => {
  const title = test.info().title;
  await boot(page);
  await selectFixture(page, 'exploratory-short');

  const f = byId('exploratory-short');
  expect(f.encoding.sampleCount).toBeLessThan(MANIFEST.sampleMinimum);
  expect(f.assessment!.exitCode).not.toBe(0);

  await expectMarkerVisible(
    title,
    'exploratory',
    page.locator('#panel-inspect [data-claim="exploratory"]').first()
  );

  await openAct(page, /Assess Min-Entropy/);
  await expectMarkerVisible(title, 'tool-refused', page.locator('[data-verdict="tool-refused"]'));

  // The refusal shown is the tool's own message, verbatim from the manifest.
  await expect(page.locator('[data-claim="tool-error-message"]')).toHaveText(
    f.assessment!.errorMessage!
  );
  await expect(page.locator('[data-claim="exploratory-sentence"]')).toContainText('1,000,000');

  // AND NO FIGURE. This is the invariant: not a smaller number, not a
  // caveated one — none at all.
  await expect(page.locator('[data-claim="assessed-per-sample"]')).toHaveCount(0);
  await expect(page.locator('[data-claim="assessed-per-bit"]')).toHaveCount(0);
  await expect(page.locator('[data-claim="estimator-table"]')).toHaveCount(0);
});

test('a modified file retires the recorded figure and says so (I1)', async ({ page }) => {
  const title = test.info().title;
  await boot(page);

  // Start from a state that HAS a figure, so the retirement is a change.
  await selectFixture(page, 'inm-clean');
  await openAct(page, /Assess Min-Entropy/);
  await expect(page.locator('[data-claim="assessed-per-sample"]')).toBeVisible();
  const before = await page
    .locator('[data-claim="assessed-per-sample"] .figure-value')
    .innerText();

  // Change the input: the same bytes, re-read at a different symbol width.
  await openAct(page, /Inspect Raw Samples/);
  await page.selectOption('#sample-width', '8');
  await expect(page.locator('[data-claim="descriptive-table"]')).toBeVisible({ timeout: 90_000 });
  await openAct(page, /Assess Min-Entropy/);

  // The stale verdict is GONE, and the page says why rather than going blank.
  await expect(page.locator('[data-claim="assessed-per-sample"]')).toHaveCount(0);
  await expectMarkerText(
    title,
    'assessment-not-run',
    page.locator('[data-verdict="assessment-not-run"]'),
    'SP 800-90B assessment not run on this modified file.'
  );
  await expect(page.locator('#panel-assess [data-claim="provenance-modified"]').first()).toBeVisible();

  // THE NO-OP GUARD. Re-selecting the SAME width must not retire a fresh
  // verdict: returning to 1 restores the fixture's own reading and its figure.
  await openAct(page, /Inspect Raw Samples/);
  await page.selectOption('#sample-select', 'inm-clean');
  await expect(page.locator('[data-claim="descriptive-table"]')).toBeVisible({ timeout: 90_000 });
  await openAct(page, /Assess Min-Entropy/);
  await expect(page.locator('[data-claim="assessed-per-sample"] .figure-value')).toHaveText(before);
  await expect(page.locator('[data-verdict="assessment-not-run"]')).toHaveCount(0);
});

test('partial coverage tracks the assessment’s own flag (I2)', async ({ page }) => {
  const title = test.info().title;
  await boot(page);

  // Every shipped fixture currently has full coverage, and the honest way to
  // test the label is therefore BOTH directions: it must be absent wherever
  // the manifest says the run was complete, and the renderer must be wired to
  // the flag rather than to a constant. The first half is asserted on every
  // fixture; the second is what the `partial-label-dropped` mutation proves.
  for (const f of MANIFEST.fixtures) {
    const a = f.assessment;
    if (!a) continue;
    const declined = a.estimators.some((e) => e.declined);
    expect(a.partial, `${f.id}: partial must track its estimators`).toBe(declined);
  }

  await selectFixture(page, 'inm-clean');
  const f = byId('inm-clean');
  expect(f.assessment!.partial).toBe(false);
  await expect(page.locator('#panel-inspect [data-claim="partial"]')).toHaveCount(0);
  await openAct(page, /Assess Min-Entropy/);
  await expect(page.locator('[data-verdict="partial-coverage"]')).toHaveCount(0);
  await expectMarkerVisible(
    title,
    'partial-tracks-the-flag',
    page.locator('[data-claim="estimator-table"]')
  );
  // Every estimator reported, which is why no label is shown.
  const declinedCells = await page.locator('[data-claim^="est-sample-"]').allInnerTexts();
  expect(declinedCells.filter((c) => c.includes('declined'))).toHaveLength(0);
});

test('the empty file is refused, and is not reported as zero entropy', async ({ page }) => {
  await boot(page);
  // Wait for Act 2's OWN arrival load to finish first. It fetches inm-clean
  // asynchronously at mount, so setting a file immediately races it and the
  // fixture's analysis lands on top of the empty-file state.
  await selectFixture(page, 'inm-clean');
  await page.setInputFiles('#sample-file', {
    name: 'empty.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(0),
  });
  await expect(page.locator('[data-verdict="analyse-error-empty"]')).toBeVisible();
  await expect(page.locator('[data-verdict="analyse-error-empty"]')).toContainText(
    'not a source with zero entropy'
  );
  await expect(page.locator('[data-claim="descriptive-table"]')).toHaveCount(0);
});

// ══════════════════════════════════════════════════════════════════════════
// The badges (I3, I4)
// ══════════════════════════════════════════════════════════════════════════

test('provenance is badged on every fixture, and never by colour alone (I3)', async ({ page }) => {
  const title = test.info().title;
  await boot(page);
  await selectFixture(page, 'inm-clean');
  // Scoped to the panel on screen. Act 1 also renders this badge for the same
  // fixture, and an unscoped `.first()` resolves into that hidden panel.
  await expectMarkerVisible(
    title,
    'provenance-simulated',
    page.locator('#panel-inspect [data-claim="provenance-simulated"]').first()
  );

  // Colour is the third channel, never the only one: each badge carries a
  // GLYPH and a WORD. Strip the glyph (it is aria-hidden) and the word must
  // still name the class.
  const badge = page.locator('#panel-inspect [data-claim="provenance-simulated"]').first();
  await expect(badge).toContainText('Simulated');
  await expect(badge.locator('[aria-hidden="true"]')).toHaveCount(1);
  // Read the text NOW. A locator is lazy, and after the fixture switch below
  // this badge no longer exists — which is itself the point: the badge tracks
  // the file on screen rather than persisting from the previous one.
  const simulatedText = await badge.innerText();

  await selectFixture(page, 'counter-hash-sha256');
  const det = page.locator('#panel-inspect [data-claim="provenance-deterministic"]').first();
  await expect(det).toBeVisible();
  await expect(det).toContainText('Deterministic');
  // The simulated badge is gone, not merely recoloured.
  await expect(page.locator('#panel-inspect [data-claim="provenance-simulated"]')).toHaveCount(0);

  // The two classes are distinguishable WITHOUT colour: different words.
  expect(await det.innerText()).not.toBe(simulatedText);
});

test('public fixtures are marked never a secret (I4)', async ({ page }) => {
  const title = test.info().title;
  await boot(page);
  for (const f of MANIFEST.fixtures) {
    expect(f.neverASecret, `${f.id}`).toBe(true);
  }
  await selectFixture(page, 'inm-clean');
  await expectMarkerText(
    title,
    'never-a-secret',
    page.locator('#panel-inspect [data-claim="never-a-secret"]').first(),
    'Never a secret'
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Act 2 — descriptive statistics, recomputed independently
// ══════════════════════════════════════════════════════════════════════════

test('descriptive statistics are labelled as such and match an independent recomputation', async ({
  page,
}) => {
  const title = test.info().title;
  await boot(page);
  await selectFixture(page, 'inm-clean');

  await expectMarkerText(
    title,
    'descriptive-disclaimer',
    page.locator('[data-claim="descriptive-disclaimer"]'),
    'not an SP 800-90B estimator'
  );

  // INDEPENDENT RE-DERIVATION. The test reads the fixture's own bytes from
  // disk, unpacks them itself, and recomputes the figures by a different route
  // than the worker takes — a plain loop here against the module's packed
  // arithmetic there.
  const f = byId('inm-clean');
  const packed = new Uint8Array(readFileSync(resolve(ROOT, 'public', f.download)));
  const n = f.encoding.sampleCount;
  const samples = new Uint8Array(n);
  for (let i = 0; i < n; i++) samples[i] = (packed[i >> 3] >> (7 - (i % 8))) & 1;

  let ones = 0;
  for (let i = 0; i < n; i++) ones += samples[i];
  const balance = ones / n;

  const printed = await page
    .locator('[data-claim="descriptive-table"] tbody tr', {
      hasText: 'Bit balance',
    })
    .locator('td')
    .innerText();
  expect(Number(printed.replace('%', '')) / 100).toBeCloseTo(balance, 5);

  // Lag-1 autocorrelation, recomputed here by the textbook formula.
  const mean = balance;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n - 1; i++) num += (samples[i] - mean) * (samples[i + 1] - mean);
  for (let i = 0; i < n; i++) den += (samples[i] - mean) ** 2;
  // The page normalises over the two overlapping windows; this is the same
  // quantity to within the one-sample edge effect at n = 1,000,000.
  const r1 = num / den;
  const shown = Number(await page.locator('[data-claim="autocorr-1"]').innerText());
  expect(shown).toBeCloseTo(r1, 4);

  // And the measured sign is the one the lab TEACHES: this map's adjacent
  // samples are anti-correlated, which is why the non-IID track applies.
  expect(shown).toBeLessThan(0);
});

// ══════════════════════════════════════════════════════════════════════════
// Act 4 — the fault table
// ══════════════════════════════════════════════════════════════════════════

test('the fault table’s movements are the arithmetic of its own two endpoints', async ({
  page,
}) => {
  const title = test.info().title;
  await boot(page);
  await openAct(page, /Break the Stream/);

  const clean = byId('inm-clean').assessment!.overall!.assessedBitsPerBit!;
  const faults = MANIFEST.fixtures.filter((f) => f.variantOf === 'inm-clean');
  expect(faults.length).toBeGreaterThanOrEqual(5);

  for (const f of faults) {
    const cell = page.locator(`[data-claim="assessed-${f.id}"]`);
    const v = f.assessment!.overall!.assessedBitsPerBit!;
    const text = await cell.innerText();
    // The cell prints the figure and its signed movement. RE-DERIVE both.
    expect(text).toContain(v.toFixed(6));
    expect(text).toContain(Math.abs(v - clean).toFixed(6));
    const dir = Math.abs(v - clean) < 1e-6 ? 'flat' : v < clean ? 'down' : 'up';
    await expect(cell).toHaveAttribute('data-direction', dir);
    // Direction is a WORD, not only a colour (WCAG 1.4.1).
    expect(text).toContain(dir);
  }

  // THE FINDING, as measured: the counts the page prints are the counts in the
  // manifest, and at least one fault RAISED the figure.
  const raised = faults.filter((f) => f.assessment!.overall!.assessedBitsPerBit! > clean);
  const lowered = faults.length - raised.length;
  expect(raised.length).toBeGreaterThan(0);
  await expect(page.locator('[data-claim="break-raised-count"] .figure-value')).toHaveText(
    String(raised.length)
  );
  await expect(page.locator('[data-claim="break-lowered-count"] .figure-value')).toHaveText(
    String(lowered)
  );
  await expect(page.locator('[data-verdict="faults-raised-estimate"]')).toBeVisible();

  await expectMarkerVisible(
    title,
    'assessed-fault-stuck-bit',
    page.locator('[data-claim="assessed-fault-stuck-bit"]')
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Act 5 — the headline experiment and the ledger
// ══════════════════════════════════════════════════════════════════════════

test('the headline experiment reports the measured figures against the pinned threshold', async ({
  page,
}) => {
  const title = test.info().title;
  await boot(page);
  await openAct(page, /Follow Conditioning/);

  const ch = byId('counter-hash-sha256').assessment!.overall!.assessedBitsPerBit!;
  const rn = byId('inm-clean').assessment!.overall!.assessedBitsPerBit!;

  const shownCh = parseFigure(
    await page.locator('[data-claim="experiment-counter-hash"] .figure-value').innerText()
  );
  const shownRn = parseFigure(
    await page.locator('[data-claim="experiment-raw-noise"] .figure-value').innerText()
  );
  expect(shownCh).toBeCloseTo(ch, 6);
  expect(shownRn).toBeCloseTo(rn, 6);

  // THE PINNED THRESHOLD, read from source. Changing it changes this.
  await expectMarkerText(
    title,
    'high-threshold',
    page.locator('[data-claim="high-threshold"] .figure-value'),
    THRESHOLD.toFixed(6)
  );

  // THE RESULT, as a relation rather than a remembered number: the published,
  // fully predictable stream is above the line and the physical source is not.
  expect(shownCh).toBeGreaterThanOrEqual(THRESHOLD);
  expect(shownRn).toBeLessThan(THRESHOLD);
  expect(shownCh).toBeGreaterThan(shownRn);

  // And the page's verdict says so in words, with the ratio it printed.
  const verdict = page.locator('[data-verdict="experiment-outcome"]');
  await expect(verdict).toContainText('FULLY PREDICTABLE');
  await expect(verdict).toContainText((shownCh / shownRn).toFixed(2));
});

test('the published stream regenerates byte-for-byte in the browser', async ({ page }) => {
  await boot(page);
  await openAct(page, /Follow Conditioning/);
  await page.locator('#regen-run').click();
  await expect(page.locator('[data-verdict="regenerated-match"]')).toBeVisible();

  // INDEPENDENT RE-DERIVATION: Node's crypto here against the page's
  // WebCrypto there, both from the published construction, both compared with
  // the shipped fixture's actual bytes.
  const { createHash } = await import('node:crypto');
  const le64 = (n: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const block0 = createHash('sha256').update(le64(0)).digest('hex');
  const block1 = createHash('sha256').update(le64(1)).digest('hex');

  const printed = await page.locator('#regen-out').innerText();
  expect(printed).toContain(block0);
  expect(printed).toContain(block1);

  const shipped = readFileSync(resolve(ROOT, 'public/fixtures/counter-hash-sha256.bin'));
  expect(shipped.subarray(0, 32).toString('hex')).toBe(block0);
  expect(shipped.subarray(32, 64).toString('hex')).toBe(block1);
});

test('the conditioning ledger multiplies the bytes and never the entropy (I5)', async ({
  page,
}) => {
  const title = test.info().title;
  await boot(page);
  await openAct(page, /Follow Conditioning/);

  const readLedger = async (): Promise<{ out: number; ent: number; per: number }> => ({
    out: Number((await page.locator('[data-claim="ledger-bits-out"]').innerText()).replace(/[^\d]/g, '')),
    ent: Number((await page.locator('[data-claim="ledger-bits-entropy"]').innerText()).replace(/[^\d.]/g, '')),
    per: Number((await page.locator('[data-claim="ledger-per-output-bit"]').innerText()).replace(/[^\d.]/g, '')),
  });

  const setMult = async (m: number): Promise<void> => {
    await page.locator('#mult-range').fill(String(m));
    await page.locator('#mult-range').dispatchEvent('input');
    await expect(page.locator('#mult-readout')).toHaveText(String(m));
  };

  await setMult(1);
  const a = await readLedger();
  await setMult(64);
  const b = await readLedger();

  await expectMarkerVisible(
    title,
    'ledger-bits-entropy',
    page.locator('[data-claim="ledger-bits-entropy"]')
  );

  // The output grows by exactly the multiplier's ratio...
  expect(b.out).toBe(a.out * 64);
  expect(a.out).toBe(256);
  // ...and the entropy does NOT move. This is the invariant the whole act
  // exists to make visible, and the one the page must never draw growing.
  expect(b.ent).toBeCloseTo(a.ent, 1);
  // So the entropy per output bit falls by the same ratio.
  expect(a.per / b.per).toBeCloseTo(64, 0);
  expect(await page.locator('[data-verdict="ledger-invariant"]').innerText()).toContain(
    'does not move'
  );
});

test('conditioning raises the reported figure without changing the source', async ({ page }) => {
  await boot(page);
  await openAct(page, /Follow Conditioning/);

  const before = byId('inm-clean').assessment!.overall!.assessedBitsPerBit!;
  const after = byId('inm-conditioned-keccak').assessment!.overall!.assessedBitsPerBit!;

  expect(
    parseFigure(await page.locator('[data-claim="condition-before"] .figure-value').innerText())
  ).toBeCloseTo(before, 6);
  expect(
    parseFigure(await page.locator('[data-claim="condition-after"] .figure-value').innerText())
  ).toBeCloseTo(after, 6);

  // The measured relation the act teaches: the number crosses the line while
  // the source is untouched.
  expect(after).toBeGreaterThan(before);
  expect(before).toBeLessThan(THRESHOLD);
  expect(after).toBeGreaterThanOrEqual(THRESHOLD);
  await expect(page.locator('[data-verdict="conditioning-raised-number"]')).toContainText(
    'The source did not change'
  );
});

// ══════════════════════════════════════════════════════════════════════════
// The patched-build disclosure
// ══════════════════════════════════════════════════════════════════════════

test('the lab names the patched build rather than claiming NIST’s reference implementation', async ({
  page,
}) => {
  await boot(page);
  await selectFixture(page, 'inm-clean');
  await page.locator('#panel-inspect details > summary').nth(1).click();

  const f = byId('inm-clean');
  await expect(page.locator('[data-claim="tool-commit"]')).toHaveText(
    f.assessment!.tool.forkCommit
  );
  await expect(page.locator('[data-claim="patched-build"]')).toContainText(
    'patched build, not NIST'
  );
  expect(f.assessment!.tool.patched).toBe(true);
});

// ══════════════════════════════════════════════════════════════════════════
// §4.1d — NEGATIVE CLAIMS
// ══════════════════════════════════════════════════════════════════════════

/**
 * Each negative claim needs an EVIDENCE FIXTURE: a reachable state in which
 * every check the page performs reports success AND the named property is
 * violated anyway. Three things are asserted for each: the fixture is reached
 * through the UI; everything the page renders in that state reads as success;
 * and the limitation is ON SCREEN in that state, visible, not in the README
 * and not behind a disclosure the reader has to open.
 */

test('negative claim: passing statistical tests does not prove unpredictability', async ({
  page,
}) => {
  const title = test.info().title;
  await boot(page);

  // 1. REACH THE FIXTURE. The counter-hash stream, through the real controls.
  await selectFixture(page, 'counter-hash-sha256');

  // 2. EVERYTHING IS GREEN — asserted against the rendered state, not a flag
  //    the test sets. This file passes every check the page performs on it:
  //    its descriptive statistics look impeccable, and its assessed figure is
  //    above the line the lab calls high.
  const balanceCell = await page
    .locator('[data-claim="descriptive-table"] tbody tr', { hasText: 'Bit balance' })
    .locator('td')
    .innerText();
  const balance = Number(balanceCell.replace('%', '')) / 100;
  expect(Math.abs(balance - 0.5)).toBeLessThan(0.001);
  expect(Math.abs(Number(await page.locator('[data-claim="autocorr-1"]').innerText()))).toBeLessThan(
    0.01
  );
  await expect(
    page
      .locator('[data-claim="descriptive-table"] tbody tr', { hasText: 'Repeated block' })
      .locator('td')
  ).toContainText('none found');

  await openAct(page, /Assess Min-Entropy/);
  const assessed = parseFigure(
    await page.locator('[data-claim="assessed-per-bit"] .figure-value').innerText()
  );
  expect(assessed).toBeGreaterThanOrEqual(THRESHOLD);
  // No warning state anywhere: not partial, not exploratory, not a refusal.
  await expect(page.locator('[data-verdict="partial-coverage"]')).toHaveCount(0);
  await expect(page.locator('[data-verdict="tool-refused"]')).toHaveCount(0);
  await expect(page.locator('#panel-assess [data-claim="exploratory"]')).toHaveCount(0);

  // 3. AND THE PROPERTY IS VIOLATED ANYWAY, on screen, in this state. The
  //    stream is fully predictable and the page demonstrates it rather than
  //    asserting it.
  await openAct(page, /Follow Conditioning/);
  await page.locator('#regen-run').click();
  await expect(page.locator('[data-verdict="regenerated-match"]')).toContainText(
    'No secret was needed'
  );
  await expect(page.locator('[data-verdict="experiment-outcome"]')).toContainText(
    'HIGH ESTIMATE — AND FULLY PREDICTABLE'
  );

  // The claim itself is on screen, verbatim.
  await expectMarkerText(
    title,
    'negative-claim-statistics-not-unpredictability',
    page.locator('[data-negative-claim="statistics-not-unpredictability"]'),
    'Passing statistical tests does not prove unpredictability.'
  );
});

test('negative claim: every honesty line is on screen, scoped as written', async ({ page }) => {
  await boot(page);
  const expected = [
    'statistics-not-unpredictability',
    'estimate-depends-on-assumptions',
    'conditioned-not-source-evidence',
    'health-tests-are-evidence-not-proof',
    'not-certification',
    'conditioned-needs-a-budget',
    'public-randomness-is-never-a-pad',
  ];
  await expect(page.locator('[data-negative-claim]')).toHaveCount(expected.length);
  for (const id of expected) {
    const li = page.locator(`[data-negative-claim="${id}"]`);
    await expect(li).toBeVisible();
    // Each line names BOTH the limitation and where it is demonstrated.
    expect((await li.innerText()).length).toBeGreaterThan(80);
  }

  // The honesty panel is visible without opening anything — §4.1d requires the
  // limitation on screen, not behind a disclosure.
  await expect(page.locator('#honesty-list')).toBeVisible();
  expect(await page.locator('#honesty-list').evaluate((el) => el.closest('details') !== null)).toBe(
    false
  );
});

test('negative claim: conditioned output is not evidence about the source', async ({ page }) => {
  await boot(page);
  await selectFixture(page, 'inm-conditioned-keccak');

  // Reach the fixture, and confirm every check reads as success on it.
  const balance = Number(
    (
      await page
        .locator('[data-claim="descriptive-table"] tbody tr', { hasText: 'Bit balance' })
        .locator('td')
        .innerText()
    ).replace('%', '')
  ) / 100;
  expect(Math.abs(balance - 0.5)).toBeLessThan(0.001);

  await openAct(page, /Assess Min-Entropy/);
  const assessed = parseFigure(
    await page.locator('[data-claim="assessed-per-bit"] .figure-value').innerText()
  );
  expect(assessed).toBeGreaterThanOrEqual(THRESHOLD);
  await expect(page.locator('[data-verdict="tool-refused"]')).toHaveCount(0);

  // The limitation, on screen in the state that demonstrates it.
  await openAct(page, /Follow Conditioning/);
  await expect(page.locator('[data-verdict="conditioning-raised-number"]')).toBeVisible();
  await expect(
    page.locator('[data-negative-claim="conditioned-not-source-evidence"]')
  ).toContainText(
    'High entropy estimates on conditioned output do not establish the raw source'
  );
});

test('negative claim: a public pad gives zero secrecy', async ({ page }) => {
  await boot(page);
  await openAct(page, /One-Time Pad/);
  await page.locator('#pad-run').click();

  // Everything the page checks reports success: the XOR round-trips exactly.
  const verdict = page.locator('[data-verdict="public-pad-zero-secrecy"]');
  await expect(verdict).toContainText('DECRYPTED');
  await expect(page.locator('[data-claim="pad-recovered"]')).toContainText(
    'meet at the bridge at noon'
  );

  // And the property is violated anyway, in that same state.
  await expect(verdict).toContainText('NO SECRET WAS USED');
  await expect(
    page.locator('[data-negative-claim="public-randomness-is-never-a-pad"]')
  ).toContainText('It can never be a secret pad.');
});

// ══════════════════════════════════════════════════════════════════════════
// The §4.1 [hidden] probe, and the ledger's own integrity
// ══════════════════════════════════════════════════════════════════════════

test('nothing the page believes is hidden is actually painting', async ({ page }) => {
  await boot(page);
  // The `[hidden]` cascade trap: a class rule that sets `display` outranks the
  // UA's `[hidden]` rule, so an element the code hid keeps painting. This lab
  // shipped exactly that on `#analyse-progress` before `[hidden]{display:none
  // !important}` was added, so the probe is load-bearing rather than
  // defensive.
  await openAct(page, /Inspect Raw Samples/);
  await expect(page.locator('[data-claim="descriptive-table"]')).toBeVisible({ timeout: 90_000 });
  const painting = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[hidden]'))
      .filter((el) => (el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true }))
      .map((el) => el.tagName.toLowerCase() + '#' + el.id)
  );
  expect(painting, 'elements marked [hidden] that still paint').toEqual([]);
});

test('every mutation in the ledger names a real anchor that occurs exactly once', async () => {
  // §4.1c rule 1: a mutation is a concrete patch, never a sentence. This test
  // keeps the ledger honest between mutation runs — an anchor that a refactor
  // moved, duplicated or deleted would otherwise be discovered only when
  // someone next replayed the suite, and a patch that silently matched twice
  // would mutate a site nobody chose.
  expect(MUTATIONS.length).toBeGreaterThanOrEqual(10);
  for (const m of MUTATIONS) {
    const src = readFileSync(resolve(ROOT, m.file), 'utf8');
    const occurrences = src.split(m.anchor).length - 1;
    expect(occurrences, `${m.id}: anchor must occur exactly once in ${m.file}`).toBe(1);
    expect(src.includes(m.replacement), `${m.id}: replacement must not already be present`).toBe(
      false
    );
  }
  // Ids and (test, marker) pairs are unique, so the teardown's bookkeeping
  // cannot be satisfied by an unrelated entry.
  expect(new Set(MUTATIONS.map((m) => m.id)).size).toBe(MUTATIONS.length);
});
