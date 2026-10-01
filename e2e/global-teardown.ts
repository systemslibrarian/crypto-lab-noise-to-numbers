/**
 * Fail the run if the mutation ledger claims a check that never executed.
 *
 * §4.1c's third requirement: every `observed` record is written by the thing
 * that ran it, never typed. `sink.ts` writes the (test, marker) pairs the
 * suite ACTUALLY asserted on; `mutations.ts` names, for each mutation, the
 * pair that is supposed to catch it. If a ledger entry names a pair that never
 * appeared in the sink, the ledger is making a claim about a check that did
 * not happen — so the run goes red here rather than passing with a stale
 * promise in a file.
 *
 * This is what makes the ledger enforceable rather than archival. Rename a
 * marker, delete an assertion, or let a test be filtered out, and this fails.
 *
 * It is SKIPPED when the run was filtered (`--grep`, a single file, a single
 * project), because then an absent pair means "not selected" rather than "not
 * performed", and failing on that would train people to ignore it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { MUTATIONS } from './mutations';
import { SEP, executedPairs, resetSink } from './sink';

/**
 * How many `test(...)` declarations `claims.spec.ts` contains.
 *
 * This is how a PARTIAL run is detected, and it is deliberately not
 * `config.grep`: a CLI `--grep` does NOT reach the reporter — `config.grep` is
 * `/.*` + `/` whatever was passed, because it reflects the config file rather
 * than the command line. Trusting it meant every `--grep` run was treated as a
 * full one, so a single-test run failed on all eleven entries it had not
 * selected. Counting the declarations needs no cooperation from the caller and
 * maintains itself as tests are added.
 */
function declaredClaimsTests(): number {
  const src = readFileSync(resolve(import.meta.dirname, 'claims.spec.ts'), 'utf8');
  return (src.match(/^test\(/gm) ?? []).length;
}

class MutationLedgerReporter implements Reporter {
  private filtered = false;
  private claimsRan = false;

  onBegin(config: FullConfig, suite: Suite): void {
    resetSink();
    const claimsTests = suite
      .allTests()
      .filter((t: TestCase) => t.titlePath().some((p) => p.includes('claims.spec.ts')));
    this.claimsRan = claimsTests.length > 0;
    // Fewer tests selected than the file declares means a filtered run, and an
    // absent pair then means "not selected" rather than "not performed".
    this.filtered =
      !config.projects.some((p) => p.name === 'claims') ||
      claimsTests.length < declaredClaimsTests();
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | void> {
    if (result.status !== 'passed') return;
    if (this.filtered || !this.claimsRan) {
      process.stdout.write(
        '\nmutation ledger: not checked (partial run — the claims project was filtered out).\n'
      );
      return;
    }

    const executed = executedPairs();
    // Only entries owned by the browser suite are checked here. A mutation
    // whose owning check is a unit test (`runner: 'unit'`) cannot appear in
    // this sink by construction, and failing on its absence would be the same
    // false alarm this reporter exists to prevent.
    const missing = MUTATIONS.filter(
      (m) =>
        (m.runner ?? 'claims') === 'claims' &&
        !Array.from(executed).some((pair) => {
          const [title, marker] = pair.split(SEP);
          return marker === m.marker && title.includes(m.test);
        })
    );

    if (missing.length === 0) {
      const browserOwned = MUTATIONS.filter((m) => (m.runner ?? 'claims') === 'claims').length;
      const unitOwned = MUTATIONS.length - browserOwned;
      process.stdout.write(
        `\nmutation ledger: all ${browserOwned} browser-owned entries were backed by a check that ` +
          `actually ran (${unitOwned} ${unitOwned === 1 ? 'is' : 'are'} owned by unit tests).\n`
      );
      return;
    }

    process.stderr.write(
      '\nMUTATION LEDGER FAILURE — these entries claim a check that never executed:\n' +
        missing
          .map(
            (m) =>
              `  - ${m.id}: expected test matching "${m.test}" to assert on marker "${m.marker}"`
          )
          .join('\n') +
        '\n\nEither the assertion was removed, the marker was renamed, or the owning test did not\n' +
        'run. A ledger entry is a claim that a specific check catches a specific defect; an\n' +
        'unperformed check must not read as a performed one.\n'
    );
    return { status: 'failed' };
  }
}

export default MutationLedgerReporter;
