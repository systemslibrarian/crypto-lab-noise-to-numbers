/**
 * The run-scoped record of which (test, marker) pairs ACTUALLY EXECUTED.
 *
 * §4.1c's third requirement is that every `observed` record is written by the
 * thing that ran it, never typed. This is the mechanism. `mutations.ts` names,
 * for each mutation, the test that owns it and the marker that test asserts
 * on; `assertMarker()` below writes that pair here as it runs; and
 * `global-teardown.ts` fails the whole run if any ledger entry names a pair
 * that never appeared.
 *
 * That turns an unperformed check into a RED RUN rather than a line of prose
 * claiming it happened. Rename a marker, delete an assertion, or let a test be
 * skipped, and the mutation ledger's claim about it stops being true and the
 * run says so.
 *
 * Nothing is archived. The enforcement IS the record — an archived string
 * would be a second copy of an answer already enforced, free to drift from it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Locator } from '@playwright/test';

export const SINK_PATH = resolve(import.meta.dirname, '..', '.tool-cache', 'executed-markers.txt');

/** The field separator. Neither a test title nor a marker may contain it. */
export const SEP = ' >> ';

export function resetSink(): void {
  mkdirSync(dirname(SINK_PATH), { recursive: true });
  rmSync(SINK_PATH, { force: true });
}

function record(testTitle: string, marker: string): void {
  mkdirSync(dirname(SINK_PATH), { recursive: true });
  appendFileSync(SINK_PATH, `${testTitle}${SEP}${marker}\n`);
}

export function executedPairs(): Set<string> {
  if (!existsSync(SINK_PATH)) return new Set();
  return new Set(
    readFileSync(SINK_PATH, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
  );
}

/**
 * Assert on a marked element AND record that this test really did so.
 *
 * Every assertion the mutation ledger relies on goes through here. A plain
 * `expect(page.locator(...))` elsewhere in the suite is fine for anything the
 * ledger does not claim to have killed.
 */
export async function assertMarker(
  testTitle: string,
  marker: string,
  locator: Locator,
  assertion: (l: Locator) => Promise<void>
): Promise<void> {
  await assertion(locator);
  record(testTitle, marker);
}

/** Shorthand: the marked element exists and contains `text`. */
export async function expectMarkerText(
  testTitle: string,
  marker: string,
  locator: Locator,
  text: string | RegExp
): Promise<void> {
  await assertMarker(testTitle, marker, locator, async (l) => {
    await expect(l).toContainText(text);
  });
}

/** Shorthand: the marked element is visible. */
export async function expectMarkerVisible(
  testTitle: string,
  marker: string,
  locator: Locator
): Promise<void> {
  await assertMarker(testTitle, marker, locator, async (l) => {
    await expect(l).toBeVisible();
  });
}
