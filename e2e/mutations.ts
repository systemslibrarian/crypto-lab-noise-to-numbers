/**
 * THE MUTATION LEDGER.
 *
 * This lab renders `data-verdict` and `data-claim` markers, so §4.1c requires
 * its mutations to be recorded as CONCRETE PATCHES rather than as sentences
 * describing an edit — a sentence cannot be replayed, and a paragraph
 * describing a run is the author's side of the claim rather than the run's.
 *
 * Each entry names:
 *   - the FILE to patch;
 *   - an ANCHOR that must occur EXACTLY ONCE in it, so a patch cannot land
 *     somewhere unintended and a refactor that duplicates the anchor fails
 *     loudly instead of silently mutating the wrong site;
 *   - its REPLACEMENT;
 *   - the TEST that owns it, and the MARKER that test asserts on.
 *
 * `scripts/mutate.mjs` replays them. A kill requires all four of §4.1c's
 * rules: the owning test PASSED unmutated in the same run, the patch actually
 * CHANGED the file, the run served the MUTATED code (proved by the built
 * bundle's hash moving), and a patch that does not compile is DOES NOT BUILD
 * and is never a kill.
 */
export interface Mutation {
  id: string;
  file: string;
  anchor: string;
  replacement: string;
  /** Substring of the owning test's title. */
  test: string;
  /** The marker the owning test asserts on, as recorded in the sink. */
  marker: string;
  /** What this mutation proves the suite can see. */
  proves: string;
}

export const MUTATIONS: Mutation[] = [
  {
    id: 'threshold-lowered',
    file: 'src/entropy/thresholds.ts',
    anchor: 'export const HIGH_ESTIMATE_BITS_PER_BIT = 0.75;',
    replacement: 'export const HIGH_ESTIMATE_BITS_PER_BIT = 0.2;',
    test: 'headline experiment',
    marker: 'high-threshold',
    proves:
      'the pinned "high" line is the one the page prints, so it cannot be re-tuned quietly.',
  },
  {
    id: 'combination-rule-inverted',
    file: 'src/entropy/manifest.ts',
    anchor:
      'const expected = width === 1 ? minLiteral : Math.min(minLiteral, width * minBitstring);',
    replacement:
      'const expected = width === 1 ? minLiteral : Math.max(minLiteral, width * minBitstring);',
    test: 'manifest',
    marker: 'manifest-validates',
    proves:
      "the validator re-derives the tool's combination rule rather than agreeing with whatever is recorded.",
  },
  {
    id: 'not-run-becomes-a-figure',
    file: 'src/ui/assessPanel.ts',
    anchor: '  if (s.fixture === null || s.modified) {',
    replacement: '  if (false as boolean) {',
    test: 'modified file',
    marker: 'assessment-not-run',
    proves:
      'the "assessment not run" state is rendered for a modified file rather than a figure for different bytes (invariant I1).',
  },
  {
    id: 'exploratory-label-dropped',
    file: 'src/ui/labels.ts',
    anchor: '    if (a.belowMinimum) row.append(exploratoryBadge(f.encoding.sampleCount));',
    replacement: '    if (false as boolean) row.append(exploratoryBadge(f.encoding.sampleCount));',
    test: 'below-minimum',
    marker: 'exploratory',
    proves: 'the exploratory label is rendered for a sub-minimum file (invariant I6).',
  },
  {
    id: 'partial-label-dropped',
    file: 'src/ui/labels.ts',
    anchor: '    if (a.partial) row.append(partialBadge());',
    replacement: '    if (false as boolean) row.append(partialBadge());',
    test: 'partial coverage',
    marker: 'partial-tracks-the-flag',
    proves: "the partial label tracks the assessment's own partial flag (invariant I2).",
  },
  {
    id: 'provenance-badge-dropped',
    file: 'src/ui/labels.ts',
    anchor: "  const row = el('div', { class: 'badge-row' }, provenanceBadge(f.provenance));",
    replacement: "  const row = el('div', { class: 'badge-row' });",
    test: 'provenance',
    marker: 'provenance-simulated',
    proves: 'every fixture carries a persistent provenance badge (invariant I3).',
  },
  {
    id: 'never-a-secret-dropped',
    file: 'src/ui/labels.ts',
    anchor: '  if (f.neverASecret) row.append(neverASecretBadge());',
    replacement: '  if (false as boolean) row.append(neverASecretBadge());',
    test: 'never a secret',
    marker: 'never-a-secret',
    proves: 'public fixtures are marked never-a-secret (invariant I4).',
  },
  {
    id: 'ledger-entropy-follows-multiplier',
    file: 'src/ui/conditionPanel.ts',
    anchor: '    const bitsIn = ceiling;',
    replacement: '    const bitsIn = ceiling * m;',
    test: 'conditioning ledger',
    marker: 'ledger-bits-entropy',
    proves:
      'the ledger’s entropy figure does NOT move with the output multiplier (invariant I5). This is the one mutation that would have the lab draw entropy increasing through conditioning.',
  },
  {
    id: 'negative-claim-reworded',
    file: 'src/ui/honesty.ts',
    anchor: "    text: 'Passing statistical tests does not prove unpredictability.',",
    replacement: "    text: 'Everything measured here checks out.',",
    test: 'negative claim',
    marker: 'negative-claim-statistics-not-unpredictability',
    proves:
      '§4.1d: changing the negative-claim text fails the assertion that it is on screen in its evidence state.',
  },
  {
    id: 'tool-refusal-suppressed',
    file: 'src/ui/assessPanel.ts',
    anchor: '  if (a.exitCode !== 0 || overall === null || hAssessed === null) {',
    replacement: '  if (overall === null || hAssessed === null) {',
    test: 'below-minimum',
    marker: 'tool-refused',
    proves:
      'a nonzero exit from the assessment tool is rendered as a refusal rather than passed over.',
  },
  {
    id: 'fault-direction-flipped',
    file: 'src/ui/breakPanel.ts',
    anchor:
      "    const dir = Math.abs(delta) < 1e-6 ? 'flat' : delta < 0 ? 'down' : 'up';\n    const cls = dir === 'down' ? 'moved-down' : dir === 'up' ? 'moved-up' : 'moved-flat';\n    assessedRow.append(",
    replacement:
      "    const dir = Math.abs(delta) < 1e-6 ? 'flat' : delta < 0 ? 'up' : 'down';\n    const cls = dir === 'down' ? 'moved-down' : dir === 'up' ? 'moved-up' : 'moved-flat';\n    assessedRow.append(",
    test: 'fault table',
    marker: 'assessed-fault-stuck-bit',
    proves:
      'the movement direction printed for each fault is re-derived from the two figures rather than taken on trust.',
  },
  {
    id: 'descriptive-disclaimer-dropped',
    file: 'src/ui/inspectPanel.ts',
    anchor:
      "        'Descriptive — not an SP 800-90B estimator. Nothing on this card is a min-entropy figure.'",
    replacement: "        'Statistical analysis complete.'",
    test: 'descriptive statistics',
    marker: 'descriptive-disclaimer',
    proves: 'the descriptive panel labels itself as not an SP 800-90B estimator.',
  },
];
