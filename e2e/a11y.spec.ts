import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, with Act 1
 * active and the other five tabpanels hidden and UNRENDERED; the shared skip
 * link focused; the modular-multiplication stepper stepped once, nine times
 * and reset; Act 2's worker analysing a 1-bit fixture, an 8-bit fixture, the
 * below-minimum fixture, a fixture re-read at the wrong symbol width, a
 * visitor's own file and an empty one; Act 3's estimator table, the tool's
 * own refusal on a sub-minimum file, and the "assessment not run" state a
 * modified file produces; Act 4's fault table and its warning that three of
 * the five broken streams score HIGHER than the clean one; Act 5's headline
 * experiment, a live regeneration of the published stream, and the
 * conditioning ledger at both ends of its range; Act 6's public-pad
 * decryption, its pad-too-short failure and its two-time-pad leak; four
 * disclosures opened through their own summaries; three hover states; and two
 * focus rings. Every one of those states is scanned, at desktop and phone
 * width.
 *
 * The warning and failure states are not an afterthought here. This is a lab
 * about what evidence does and does not support, so its `verdict-warn` and
 * `verdict-bad` fills carry its most important sentences — and those are
 * precisely the tones a drive that only walks the happy path never measures.
 *
 * See `gate.ts` for why nothing is injected into the page, why no panel is
 * revealed from script, why the lab's defaults are asserted rather than
 * assumed, and why `violations` is not the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
