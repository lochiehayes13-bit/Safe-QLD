import { outstandingBefore, raisedOnVisit } from '@/export/sheets';
import type { Defect, ServiceReport } from '@/domain/types';

/**
 * What a service report says this visit found.
 *
 * The report used to print every defect the site had ever had as though the
 * technician had raised them that morning: eleven on the front page of a
 * two-defect service, on the statutory record of what was done on the day.
 * A customer who counts them once stops believing the document.
 */

const report = { id: 'r1', serviceDate: '2026-09-10' } as ServiceReport;

function defect(over: Partial<Defect>): Defect {
  return {
    id: 'd', siteId: 's1', location: 'Level 1', description: 'Something', severity: 'non-critical',
    status: 'open', raisedAt: '2026-09-10T00:30:00.000Z', photos: [], ...over,
  } as Defect;
}

describe('which defects belong to a visit', () => {
  it('counts the ones raised on this report', () => {
    const defects = [
      defect({ id: 'a', reportId: 'r1' }),
      defect({ id: 'b', reportId: 'r-other', raisedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(raisedOnVisit({ report, defects }).map((d) => d.id)).toEqual(['a']);
  });

  it('counts one raised the same day by another path, because that is the same visit', () => {
    // 2026-09-09T21:00Z is the 10th in Queensland — the morning of the visit.
    const defects = [defect({ id: 'a', raisedAt: '2026-09-09T21:00:00.000Z' })];
    expect(raisedOnVisit({ report, defects }).map((d) => d.id)).toEqual(['a']);
  });

  it('does not count one raised on a different day with no report', () => {
    const defects = [defect({ id: 'a', raisedAt: '2026-08-01T00:00:00.000Z' })];
    expect(raisedOnVisit({ report, defects })).toEqual([]);
  });

  it('lists what was already open as outstanding, and never twice', () => {
    const defects = [
      defect({ id: 'a', reportId: 'r1' }),
      defect({ id: 'b', raisedAt: '2026-07-01T00:00:00.000Z' }),
      defect({ id: 'c', raisedAt: '2026-06-01T00:00:00.000Z', status: 'rectified' }),
    ];
    expect(outstandingBefore({ report, defects }).map((d) => d.id)).toEqual(['b']);
    const raised = raisedOnVisit({ report, defects }).map((d) => d.id);
    expect(raised.filter((id) => outstandingBefore({ report, defects }).some((o) => o.id === id))).toEqual([]);
  });

  it('says nothing rather than everything when the site has no defects', () => {
    expect(raisedOnVisit({ report, defects: [] })).toEqual([]);
    expect(outstandingBefore({ report, defects: [] })).toEqual([]);
  });
});
