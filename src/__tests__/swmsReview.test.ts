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

  it('records findings for every statement a reviewer refused', () => {
    for (const [id, r] of filed) {
      const t = templates.find((x) => x.id === id);
      expect(t).toBeDefined();
      const fatalOrSerious = r.blocking.filter((b) => b.severity !== 'minor');
      expect(t!.review?.findings.length).toBe(fatalOrSerious.length);
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
