/**
 * THE HONESTY PANEL.
 *
 * Each line here is a NEGATIVE CLAIM in the §4.1d sense: a sentence naming
 * something this construction does not provide, scoped to what is on this page
 * rather than to the field. Each has a `data-negative-claim` id, and
 * `e2e/claims.spec.ts` asserts every one of them appears, reaches its evidence
 * fixture, and that the fixture is a state where the page's own checks all
 * report success while the named property is violated anyway.
 *
 * The scoping discipline matters. "Passing statistical tests does not prove
 * unpredictability" is a claim about what this lab measured and can be shown
 * on this page. "Statistical tests are useless" would be false, and a lab that
 * overclaims in the direction of modesty is still overclaiming.
 */
import { el } from './dom.ts';
import { HIGH_ESTIMATE_BITS_PER_BIT } from '../entropy/thresholds.ts';

export interface NegativeClaim {
  /** The id the claims suite addresses. */
  id: string;
  /** The sentence, shown verbatim. */
  text: string;
  /** Where on this page the claim is demonstrated. */
  evidence: string;
}

export const NEGATIVE_CLAIMS: NegativeClaim[] = [
  {
    id: 'statistics-not-unpredictability',
    text: 'Passing statistical tests does not prove unpredictability.',
    evidence:
      'Act 5: the counter-hash stream, whose construction is published here in full, was assessed ' +
      `at ${HIGH_ESTIMATE_BITS_PER_BIT} bits of min-entropy per bit or better — higher than ` +
      'the modelled physical source — and you can regenerate its bytes on that page.',
  },
  {
    id: 'estimate-depends-on-assumptions',
    text:
      'A min-entropy estimate depends on its assumptions and on how the input is interpreted.',
    evidence:
      'Act 3 prints each estimator’s assumption beside its figure, and Act 2 lets you re-read ' +
      'the same bytes at a different symbol width, which produces different samples and therefore ' +
      'a different assessment — so the lab withdraws the recorded figure when you do.',
  },
  {
    id: 'conditioned-not-source-evidence',
    text:
      'High entropy estimates on conditioned output do not establish the raw source’s entropy or unpredictability.',
    evidence:
      'Act 5: the same modelled source measured before and after the driver’s Keccak sponge. ' +
      'The figure rises from below this lab’s "high" line to above it, and nothing was added ' +
      'to the source.',
  },
  {
    id: 'health-tests-are-evidence-not-proof',
    text:
      'Health tests detect gross failures. They are evidence, not proof against every attack.',
    evidence:
      'Act 4: several of the fault fixtures report a HIGHER assessed figure than the clean one, ' +
      'because the reported figure is a minimum and the binding estimator improved on the broken ' +
      'file. A fault can be visible to half the battery and still leave the headline number ' +
      'looking healthier. The panel counts them from the measurements rather than from this ' +
      'sentence, so the count cannot drift away from what was measured.',
  },
  {
    id: 'not-certification',
    text: 'This lab is not NIST certification, validation, or approval.',
    evidence:
      'It is not ESV and not CMVP. The figures come from a PATCHED build of the assessment tool, ' +
      'documented in SPIKE.md, run on simulated data by one person on one machine. No device is ' +
      'claimed fit for production key generation.',
  },
  {
    id: 'conditioned-needs-a-budget',
    text: 'Conditioned output still needs a justified entropy budget from the raw source.',
    evidence:
      'Act 5’s ledger: raising the driver’s output multiplier multiplies the bytes and ' +
      'divides the entropy among them. The entropy bar does not move, at any setting.',
  },
  {
    id: 'public-randomness-is-never-a-pad',
    text: 'Public randomness supports research and demos. It can never be a secret pad.',
    evidence:
      'Act 6: a message encrypted with a pad published in this repository, then decrypted on the ' +
      'same page without any secret. Every fixture here is badged "never a secret".',
  },
];

export function renderHonesty(list: HTMLElement): void {
  list.replaceChildren();
  for (const c of NEGATIVE_CLAIMS) {
    list.append(
      el(
        'li',
        { role: 'listitem', 'data-negative-claim': c.id },
        el('strong', {}, c.text),
        ' ',
        el('span', { class: 'note' }, c.evidence)
      )
    );
  }
}
