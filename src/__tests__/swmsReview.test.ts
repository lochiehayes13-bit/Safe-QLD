import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { SWMS_TEMPLATES } from '@/seed/swms';
import type { SwmsTemplate } from '@/domain/swms';

/**
 * The seed's review blocks against the reviews they were built from.
 *
 * `src/seed/swms/templates.json` carries a short `review` per statement, and
 * that is what the app reads: uncleared means the statement cannot be signed.
 * The reviewer's full text — every finding, with the field it is against and
 * what would fix it — lives in `data/swms-review/`, so the corrections can
 * actually be made rather than remembered.
 *
 * Two files, one truth, and nothing keeping them together except this. The
 * failure mode is not somebody being dishonest: it is somebody hitting the
 * banner on a Friday, flipping `cleared` to true to get the signature through,
 * and the file that says why it was refused sitting there unread.
 */

const REVIEWS = join(__dirname, '..', '..', 'data', 'swms-review');

interface Filed {
  id: string;
  title: string;
  signable: boolean;
  verdict: string;
  blocking: { field: string; problem: string; fix: string; severity: string }[];
}

const filed = new Map<string, Filed>(
  readdirSync(REVIEWS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const row = JSON.parse(readFileSync(join(REVIEWS, f), 'utf8')) as Filed;
      return [row.id, row] as const;
    }),
);

const templates = SWMS_TEMPLATES as readonly SwmsTemplate[];

describe('the filed reviews', () => {
  it('are all for statements that ship', () => {
    // A review for a statement that no longer exists is a rename nobody
    // finished — and it leaves the renamed statement with no review at all.
    const shipped = new Set(templates.map((t) => t.id));
    expect([...filed.keys()].filter((id) => !shipped.has(id))).toEqual([]);
  });

  it('refuse every statement they reached', () => {
    expect([...filed.values()].filter((r) => r.signable).map((r) => r.id)).toEqual([]);
  });

  it('name a field and a fix for every finding', () => {
    // A finding with no fix is a complaint. The correction round works from
    // the fix field, so a blank one is a finding that never gets addressed.
    for (const r of filed.values()) {
      expect(r.blocking.length).toBeGreaterThan(0);
      for (const b of r.blocking) {
        expect(b.field.length).toBeGreaterThan(0);
        expect(b.problem.length).toBeGreaterThan(40);
        expect(b.fix.length).toBeGreaterThan(40);
        expect(['fatal', 'serious', 'minor']).toContain(b.severity);
      }
    }
  });
});

describe('the seed against the filed reviews', () => {
  it('does not clear a statement a filed review refused', () => {
    // The one that matters. Everything else here is hygiene; this is the check
    // that stops the banner being silenced without the document being fixed.
    const wrong = templates
      .filter((t) => t.review?.cleared && filed.get(t.id)?.signable === false)
      .map((t) => t.id);
    expect(wrong).toEqual([]);
  });

  it('either lists what is still unanswered, or records that it was all answered', () => {
    /*
     * The banner mirrors the filed review only while the filed review is still
     * outstanding. Once a correction round has answered every finding, listing
     * them would tell a technician the document in their hand has faults it no
     * longer has — and a crew that learns the banner is stale stops reading it,
     * which costs the next one that is true.
     *
     * So: findings must match the filed review's fatal and serious count, OR
     * the statement records a correction against every finding filed and lists
     * none. Never both, and never neither.
     */
    for (const [id, r] of filed) {
      const t = templates.find((x) => x.id === id);
      expect(t).toBeDefined();
      const corrected = t!.review?.correctedAgainst;
      if (corrected) {
        expect(t!.review!.findings).toEqual([]);
        // Counted against every finding filed, not only the fatal ones: a
        // round that answered the fatals and left the minors is not this.
        expect(corrected.findings).toBe(r.blocking.length);
      } else {
        const fatalOrSerious = r.blocking.filter((b) => b.severity !== 'minor');
        expect(t!.review?.findings.length).toBe(fatalOrSerious.length);
      }
    }
  });

  it('never lets a correction round clear its own work', () => {
    // The correction and the clearance are never the same person's. Recording
    // a correction must not open the signature gate — only a cold read does.
    for (const t of templates) {
      if (t.review?.correctedAgainst) expect(t.review.cleared).toBe(false);
    }
  });

  it('says nobody read the ones with no filed review', () => {
    // Uncleared for two different reasons, and the crew is owed the difference:
    // "a reviewer refused this" is not "the run stopped before reaching it".
    for (const t of templates) {
      if (filed.has(t.id)) continue;
      expect(t.review?.cleared).toBe(false);
      expect(t.review?.findings).toEqual([]);
      expect(t.review?.reason).toMatch(/never ran|Nobody has checked/i);
    }
  });

  it('shows findings that end where a sentence ends', () => {
    /*
     * These print on the record screen, one per line. A finding clipped
     * mid-word reads like the app lost the rest of it, and a technician who
     * thinks the app is broken stops reading the banner.
     */
    for (const t of templates) {
      for (const f of t.review?.findings ?? []) {
        expect(f).toMatch(/^\[(fatal|serious)\] /);
        expect(f).toMatch(/(?:[.!?]["')’”]?|…)$/);
        expect(f.length).toBeLessThanOrEqual(250);
      }
    }
  });
});
