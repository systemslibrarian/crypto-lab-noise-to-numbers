/**
 * THE LABELS THE INVARIANTS REQUIRE, IMPLEMENTED ONCE.
 *
 * Every one of these is a rule from the brief's invariant list, and they live
 * here together rather than at each call site so that "everywhere results
 * appear" is a property of the code rather than a promise:
 *
 *   I2  a partial estimator run is labelled "partial" everywhere
 *   I3  simulated / modified / real data each carry a persistent provenance
 *       badge, distinct and NOT colour-only
 *   I4  public fixtures and everything derived from them are "never a secret"
 *   I6  a below-minimum sample is labelled "exploratory", and only a fixture
 *       meeting the minimum is presented as a full run
 *
 * Plus the state invariant I1 implies: when there is no assessment for the
 * bytes on screen, the page says SO, rather than showing a figure from
 * somewhere else.
 *
 * EVERY BADGE IS GLYPH + WORD + COLOUR. The glyph is `aria-hidden` because the
 * word next to it already carries the meaning; the colour is the third
 * channel, never the only one (WCAG 1.4.1). Each `data-claim` is what
 * `e2e/claims.spec.ts` and the mutation ledger address.
 */
import { el } from './dom.ts';
import type { Assessment, Fixture, Provenance } from '../entropy/types.ts';
import { NON_IID_ESTIMATOR_COUNT, SAMPLE_MINIMUM } from '../entropy/thresholds.ts';
import { count } from './dom.ts';

interface BadgeSpec {
  glyph: string;
  word: string;
  cls: string;
  title: string;
}

const PROVENANCE: Record<Provenance, BadgeSpec> = {
  simulated: {
    glyph: '◌', // dotted circle: an outline of a thing, not the thing
    word: 'Simulated',
    cls: 'badge-simulated',
    title:
      'A software model of the circuit, not hardware and not a capture from hardware. A model can only tell you about itself.',
  },
  deterministic: {
    glyph: '↻', // clockwise arrow: reproducible
    word: 'Deterministic',
    cls: 'badge-deterministic',
    title:
      'Defined by a published construction. Every byte is reproducible by anyone who reads it, and therefore predictable to them.',
  },
  captured: {
    glyph: '◉', // filled target: the real thing
    word: 'Real capture',
    cls: 'badge-captured',
    title: 'Captured from physical hardware.',
  },
  modified: {
    glyph: '✎', // pencil
    word: 'Modified',
    cls: 'badge-modified',
    title:
      'Changed in the browser, or supplied by you. No SP 800-90B assessment exists for these exact bytes.',
  },
};

function badge(spec: BadgeSpec, claim: string): HTMLElement {
  return el(
    'span',
    { class: `badge ${spec.cls}`, title: spec.title, 'data-claim': claim },
    el('span', { 'aria-hidden': 'true' }, spec.glyph),
    spec.word
  );
}

/** I3. The provenance badge. Shown wherever the file is. */
export function provenanceBadge(p: Provenance): HTMLElement {
  return badge(PROVENANCE[p], `provenance-${p}`);
}

/** I4. Public fixtures, and anything derived from them, are never a secret. */
export function neverASecretBadge(): HTMLElement {
  return badge(
    {
      glyph: '⚿', // open padlock
      word: 'Never a secret',
      cls: 'badge-public',
      title:
        'This data is published in this repository. It is useful for research and demonstration and can never be a key or a pad.',
    },
    'never-a-secret'
  );
}

/** I2. Fewer than ten estimators produced a value in a branch that needed one. */
export function partialBadge(): HTMLElement {
  return badge(
    {
      glyph: '◒', // half-filled circle
      word: 'Partial',
      cls: 'badge-partial',
      title:
        `Fewer than the ${NON_IID_ESTIMATOR_COUNT} estimators SP 800-90B 6.2 takes the minimum over produced a value. ` +
        'The reported figure is a minimum over those that did.',
    },
    'partial'
  );
}

/** I6. Below the sample minimum, so not a full assessment. */
export function exploratoryBadge(samples: number): HTMLElement {
  return badge(
    {
      glyph: '⚠', // warning triangle
      word: 'Exploratory',
      cls: 'badge-exploratory',
      title:
        `${count(samples)} samples is below the ${count(SAMPLE_MINIMUM)}-sample minimum ` +
        'SP 800-90B Section 3.1.1 requires for a full assessment.',
    },
    'exploratory'
  );
}

/** The no-assessment state. The page says so instead of borrowing a figure. */
export function notRunBadge(): HTMLElement {
  return badge(
    {
      glyph: '—',
      word: 'Assessment not run',
      cls: 'badge-notrun',
      title:
        'No SP 800-90B assessment has been run on these exact bytes, so this lab has no ' +
        'min-entropy figure to show for them.',
    },
    'assessment-not-run'
  );
}

/** The full sentence the lab shows for the no-assessment state. */
export const NOT_RUN_SENTENCE = 'SP 800-90B assessment not run on this modified file.';

/**
 * Every badge a fixture carries, in one row. Used by each act, so a fixture
 * cannot appear in one panel with its provenance and in another without it.
 */
export function badgeRow(f: Fixture): HTMLElement {
  const row = el('div', { class: 'badge-row' }, provenanceBadge(f.provenance));
  if (f.neverASecret) row.append(neverASecretBadge());
  const a = f.assessment;
  if (a === null) {
    row.append(notRunBadge());
  } else {
    if (a.belowMinimum) row.append(exploratoryBadge(f.encoding.sampleCount));
    if (a.partial) row.append(partialBadge());
    if (a.overall === null || a.overall.hAssessed === null) row.append(notRunBadge());
  }
  return row;
}

/**
 * The exploratory sentence, scoped exactly as the brief words it.
 *
 * Used verbatim rather than paraphrased per panel, because §4.1d's negative
 * claims are scoped to the sentence that is tested and a reworded copy is an
 * untested claim.
 */
export function exploratorySentence(samples: number): string {
  return (
    `Exploratory — below the ${count(SAMPLE_MINIMUM)}-sample minimum for a full assessment ` +
    `(this file has ${count(samples)}).`
  );
}

/** Does this assessment stand as a full SP 800-90B run? */
export function isFullRun(a: Assessment | null): boolean {
  return (
    a !== null &&
    !a.belowMinimum &&
    !a.partial &&
    a.exitCode === 0 &&
    a.overall !== null &&
    a.overall.hAssessed !== null
  );
}
