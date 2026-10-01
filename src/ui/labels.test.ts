import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { badgesFor, type BadgeKind } from './labels.ts';
import { validateManifest } from '../entropy/manifest.ts';
import type { Assessment, Fixture } from '../entropy/types.ts';

/**
 * The badge DECISION, which is where invariants I2, I3, I4 and I6 live.
 *
 * These run against both the shipped manifest and against synthetic fixtures,
 * and the synthetic half is not padding. The `partial` branch cannot be reached
 * by any fixture this lab ships — SP 800-90B's 1,000,000-sample minimum means a
 * file big enough to assess is big enough for all ten estimators to report, and
 * a file small enough for one to decline is refused before any estimator runs.
 * A mutation that deleted the partial label therefore survived every end-to-end
 * test, which is evidence about the DATA rather than about the tests. Handing
 * the decision a partial assessment directly is the honest way to exercise it.
 */

const manifest = validateManifest(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../fixtures/manifest.json'), 'utf8'))
);

const base = (): Fixture => JSON.parse(JSON.stringify(manifest.fixtures[0])) as Fixture;

describe('the badges a shipped fixture carries', () => {
  it('always names the provenance first, and marks it never a secret (I3, I4)', () => {
    for (const f of manifest.fixtures) {
      const badges = badgesFor(f);
      expect(badges[0], f.id).toBe(`provenance:${f.provenance}`);
      expect(badges, f.id).toContain('never-a-secret');
    }
  });

  it('marks the below-minimum fixture exploratory and no other (I6)', () => {
    for (const f of manifest.fixtures) {
      const below = f.encoding.sampleCount < manifest.sampleMinimum;
      expect(badgesFor(f).includes('exploratory'), f.id).toBe(below);
    }
    expect(badgesFor(manifest.fixtures.find((f) => f.id === 'exploratory-short')!)).toContain(
      'exploratory'
    );
  });

  it('marks a fixture with no assessed figure as not run, and only those', () => {
    for (const f of manifest.fixtures) {
      const hasFigure = f.assessment?.overall?.hAssessed != null;
      expect(badgesFor(f).includes('assessment-not-run'), f.id).toBe(!hasFigure);
    }
  });

  it('marks none of the shipped fixtures partial, because none of them is', () => {
    for (const f of manifest.fixtures) {
      expect(f.assessment?.partial ?? false, `${f.id} manifest`).toBe(false);
      expect(badgesFor(f).includes('partial'), `${f.id} badge`).toBe(false);
    }
  });
});

describe('the branches no shipped fixture reaches', () => {
  /**
   * INVARIANT I2, exercised directly. A v3 in-browser engine run on a
   * visitor's file can genuinely have an estimator decline, and this is what
   * says the label appears when it does.
   */
  it('marks a partial run partial (I2)', () => {
    const f = base();
    const a = f.assessment as Assessment;
    a.partial = true;
    a.estimators[3].declined = true;
    a.estimators[3].bitsPerSample = null;
    a.estimators[3].bitsPerBit = null;
    expect(badgesFor(f)).toContain('partial');
  });

  it('does not mark a complete run partial', () => {
    const f = base();
    (f.assessment as Assessment).partial = false;
    expect(badgesFor(f)).not.toContain('partial');
  });

  it('marks a fixture with no assessment at all as not run (I1, and the v3 seam)', () => {
    const f = base();
    f.assessment = null;
    expect(badgesFor(f)).toEqual(['provenance:simulated', 'never-a-secret', 'assessment-not-run']);
  });

  it('badges a real capture distinctly from a simulated one (I3, and the v2 seam)', () => {
    const f = base();
    f.provenance = 'captured';
    expect(badgesFor(f)[0]).toBe('provenance:captured');
    const g = base();
    g.provenance = 'modified';
    expect(badgesFor(g)[0]).toBe('provenance:modified');
    // The four provenance classes are four distinct badges, not one badge with
    // four colours.
    const kinds = new Set<BadgeKind>();
    for (const p of ['simulated', 'deterministic', 'captured', 'modified'] as const) {
      const h = base();
      h.provenance = p;
      kinds.add(badgesFor(h)[0]);
    }
    expect(kinds.size).toBe(4);
  });

  it('can carry exploratory AND partial AND not-run at once', () => {
    const f = base();
    const a = f.assessment as Assessment;
    a.belowMinimum = true;
    a.partial = true;
    a.overall = null;
    expect(badgesFor(f)).toEqual([
      'provenance:simulated',
      'never-a-secret',
      'exploratory',
      'partial',
      'assessment-not-run',
    ]);
  });

  it('drops the never-a-secret badge only if a fixture is not public', () => {
    const f = base();
    f.neverASecret = false;
    expect(badgesFor(f)).not.toContain('never-a-secret');
    // ...and the manifest validator refuses that state for a shipped fixture,
    // so the two halves of I4 are enforced at both levels.
    expect(manifest.fixtures.every((x) => x.neverASecret)).toBe(true);
  });
});
