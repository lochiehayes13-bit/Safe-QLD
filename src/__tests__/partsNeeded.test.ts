import {
  UNCOVERED_REASON, isMaterial, partsNeededFor, uncoveredDefects,
} from '@/domain/partsNeeded';
import { DEFECT_LIBRARY, defectByCode } from '@/seed/defectLibrary';
import type { Defect } from '@/domain/types';

/**
 * Turning a site's defects into a parts order.
 *
 * The arithmetic is trivial; what matters is what it refuses to do. Ordering
 * labour produces a request no supplier can fill, and quietly covering eleven
 * of fourteen defects produces a return visit.
 */

let n = 0;
function defect(defectCode?: string, over: Partial<Defect> = {}): Defect {
  n += 1;
  return {
    id: `d${n}`,
    siteId: 'site-1',
    location: 'L1',
    description: 'x',
    severity: 'non-critical',
    status: 'open',
    raisedAt: '2026-08-31T00:00:00.000Z',
    photos: [],
    defectCode,
    ...over,
  } as Defect;
}

/** A code from the real library that carries at least one material line. */
const withMaterial = DEFECT_LIBRARY.find((d) => (d.quoteItems ?? []).some(isMaterial))!;
/** A code from the real library whose quote is labour only, if one exists. */
const labourOnly = DEFECT_LIBRARY.find(
  (d) => (d.quoteItems ?? []).length > 0 && !(d.quoteItems ?? []).some(isMaterial),
);

describe('what counts as a material', () => {
  it('treats hours as labour and everything else as orderable', () => {
    expect(isMaterial({ description: 'Attend', unit: 'hr', qtyPerDefect: 2 })).toBe(false);
    expect(isMaterial({ description: 'Head', unit: 'ea', qtyPerDefect: 1 })).toBe(true);
    expect(isMaterial({ description: 'Cable', unit: 'm', qtyPerDefect: 30 })).toBe(true);
    expect(isMaterial({ description: 'Sundries', unit: 'lot', qtyPerDefect: 1 })).toBe(true);
  });

  it('leaves labour out of the parts list entirely', () => {
    // DET-DET-001 is a failed detector: one head plus two labour lines.
    const parts = partsNeededFor([defect('DET-DET-001')]);
    const code = defectByCode('DET-DET-001')!;
    expect((code.quoteItems ?? []).filter((q) => q.unit === 'hr').length).toBeGreaterThan(0);
    expect(parts.every((p) => p.unit !== 'hr')).toBe(true);
    expect(parts).toHaveLength((code.quoteItems ?? []).filter(isMaterial).length);
  });
});

describe('aggregating across defects', () => {
  it('adds quantities rather than repeating a line', () => {
    const parts = partsNeededFor([defect('DET-DET-001'), defect('DET-DET-001'), defect('DET-DET-001')]);
    const head = parts.find((p) => /detector head/i.test(p.description))!;
    expect(head.quantity).toBe(3);
    expect(head.defectCount).toBe(3);
    expect(parts.filter((p) => /detector head/i.test(p.description))).toHaveLength(1);
  });

  it('records every code that contributed, so a quantity can be traced back', () => {
    const parts = partsNeededFor([defect(withMaterial.code), defect(withMaterial.code)]);
    expect(parts[0]!.fromCodes).toEqual([withMaterial.code]);
    expect(parts[0]!.defectCount).toBe(2);
  });

  it('puts the largest quantity first', () => {
    const parts = partsNeededFor([
      defect('DET-DET-001'),
      defect('DET-DET-001'),
      defect('DET-DET-002'),
    ]);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i - 1]!.quantity).toBeGreaterThanOrEqual(parts[i]!.quantity);
    }
  });

  it('returns nothing for an empty list rather than throwing', () => {
    expect(partsNeededFor([])).toEqual([]);
  });
});

describe('defects that contribute no part', () => {
  it('reports a free-text defect rather than dropping it', () => {
    const d = defect(undefined);
    expect(uncoveredDefects([d])).toEqual([{ defectId: d.id, reason: 'no-code' }]);
  });

  it('reports a code this build does not know', () => {
    const d = defect('XXX-YYY-999');
    expect(uncoveredDefects([d])).toEqual([{ defectId: d.id, reason: 'unknown-code' }]);
    // And contributes nothing, rather than a line with no description.
    expect(partsNeededFor([d])).toEqual([]);
  });

  it('reports a labour-only defect, where the library has one', () => {
    if (!labourOnly) return;
    const d = defect(labourOnly.code);
    expect(uncoveredDefects([d])).toEqual([{ defectId: d.id, reason: 'labour-only' }]);
  });

  it('says nothing about a defect that did contribute', () => {
    expect(uncoveredDefects([defect(withMaterial.code)])).toEqual([]);
  });

  it('has wording for every reason it can give', () => {
    for (const reason of ['no-code', 'unknown-code', 'labour-only'] as const) {
      expect(UNCOVERED_REASON[reason]).toBeTruthy();
    }
  });
});

describe('against the real defect library', () => {
  it('produces a parts list for every coded defect that has materials', () => {
    // Guards the join in both directions: a library entry whose material lines
    // never reach a purchase request would be a silent gap.
    for (const code of DEFECT_LIBRARY) {
      const parts = partsNeededFor([defect(code.code)]);
      const expected = (code.quoteItems ?? []).filter(isMaterial).length;
      expect({ code: code.code, lines: parts.length }).toEqual({ code: code.code, lines: expected });
    }
  });

  it('never emits a line with no description or a non-positive quantity', () => {
    const all = partsNeededFor(DEFECT_LIBRARY.map((c) => defect(c.code)));
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.description.trim().length).toBeGreaterThan(0);
      expect(p.quantity).toBeGreaterThan(0);
    }
  });
});
