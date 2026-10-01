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
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { MUTATIONS } from './mutations';
import { SEP, executedPairs, resetSink } from './sink';

class MutationLedgerReporter implements Reporter {
  private filtered = false;
  private claimsRan = false;

  onBegin(config: FullConfig, suite: Suite): void {
    resetSink();
    // A grep, or a run that selected only some projects, is a partial run.
    this.filtered =
      config.grep.toString() !== '/.*/' ||
      (config.grepInvert !== null && config.grepInvert !== undefined) ||
      !config.projects.some((p) => p.name === 'claims');
    this.claimsRan = suite
      .allTests()
      .some((t: TestCase) => t.titlePath().some((p) => p.includes('claims.spec.ts')));
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
    const missing = MUTATIONS.filter(
      (m) => !Array.from(executed).some((pair) => {
        const [title, marker] = pair.split(SEP);
        return marker === m.marker && title.includes(m.test);
      })
    );

    if (missing.length === 0) {
      process.stdout.write(
        `\nmutation ledger: all ${MUTATIONS.length} entries were backed by a check that actually ran.\n`
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
