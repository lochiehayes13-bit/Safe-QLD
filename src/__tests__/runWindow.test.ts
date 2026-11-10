import {
  RUN_WINDOW_HOURS, belongsToRun, instant, latestPerSubject, runWindow,
} from '@/domain/runWindow';

/**
 * Which recorded work belongs to which attendance.
 *
 * Nothing joins an asset event to the routine run that produced it, so the join
 * is by time and the width of the window is the whole decision. The failure
 * this guards is quiet and expensive: a call-out at eight in the morning and an
 * annual that afternoon are the same site on the same day, and sweeping the
 * call-out's results into the annual reports a service that covered assets it
 * never touched — which is the count the office invoices on.
 */

const RUN = '2026-07-03T06:00:00.000Z';
const hoursFrom = (iso: string, h: number): string =>
  new Date(Date.parse(iso) + h * 3_600_000).toISOString();

describe('instant', () => {
  it('refuses what it cannot read rather than returning zero', () => {
    // Zero is 1970, and a window around 1970 matches nothing while looking
    // like an answer.
    expect(instant('not a date')).toBeUndefined();
    expect(instant(undefined)).toBeUndefined();
    expect(instant('  ')).toBeUndefined();
  });

  it('reads an ISO instant', () => {
    expect(instant(RUN)).toBe(Date.parse(RUN));
  });
});

describe('runWindow', () => {
  it('spans the same distance either side of the run', () => {
    const w = runWindow(RUN)!;
    expect(w.from).toBe(hoursFrom(RUN, -RUN_WINDOW_HOURS));
    expect(w.to).toBe(hoursFrom(RUN, RUN_WINDOW_HOURS));
  });

  it('comes back undefined for a run with no readable time', () => {
    /*
     * Not a window around the epoch. That matches no events, and the mapping
     * then declines with "nothing recorded" — a true statement about the wrong
     * problem, and one nobody can act on.
     */
    expect(runWindow(undefined)).toBeUndefined();
    expect(runWindow('sometime tuesday')).toBeUndefined();
  });
});

describe('belongsToRun', () => {
  it('keeps work recorded minutes before the run was closed off', () => {
    expect(belongsToRun(hoursFrom(RUN, -0.5), RUN)).toBe(true);
  });

  it('keeps a full day of routine either side, because the run is closed at the end', () => {
    // A technician who starts at eight and records the run at four has events
    // hours before it, not around it.
    expect(belongsToRun(hoursFrom(RUN, -5), RUN)).toBe(true);
    expect(belongsToRun(hoursFrom(RUN, 5), RUN)).toBe(true);
  });

  it('leaves a separate attendance the same day out of it', () => {
    // The whole point. Eight hours away is a different visit.
    expect(belongsToRun(hoursFrom(RUN, -8), RUN)).toBe(false);
    expect(belongsToRun(hoursFrom(RUN, 8), RUN)).toBe(false);
  });

  it('keeps an event exactly on the boundary', () => {
    /*
     * The two errors do not cost the same. An asset wrongly included is on the
     * note and gets queried; an asset wrongly dropped is a coverage gap nobody
     * sees.
     */
    expect(belongsToRun(hoursFrom(RUN, -RUN_WINDOW_HOURS), RUN)).toBe(true);
    expect(belongsToRun(hoursFrom(RUN, RUN_WINDOW_HOURS), RUN)).toBe(true);
  });

  it('excludes an event just outside it', () => {
    expect(belongsToRun(hoursFrom(RUN, -RUN_WINDOW_HOURS - 0.01), RUN)).toBe(false);
  });

  it('claims nothing when either time is unreadable', () => {
    expect(belongsToRun(undefined, RUN)).toBe(false);
    expect(belongsToRun(RUN, undefined)).toBe(false);
    expect(belongsToRun('yesterday', RUN)).toBe(false);
  });

  it('honours a caller that asks for a different width', () => {
    expect(belongsToRun(hoursFrom(RUN, -8), RUN, 12)).toBe(true);
  });
});

describe('latestPerSubject', () => {
  const row = (assetId: string, at: string, outcome: string) => ({ assetId, at, outcome });

  it('reports a check re-run after a repair as it finished, not as it first failed', () => {
    const out = latestPerSubject(
      [row('a1', hoursFrom(RUN, -3), 'fail'), row('a1', hoursFrom(RUN, -1), 'pass')],
      (r) => r.assetId,
      (r) => r.at,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.outcome).toBe('pass');
  });

  it('does not depend on the order the rows arrived in', () => {
    // A query ordered by a text timestamp and a list built in memory do not
    // always agree, and the answer must not change when they disagree.
    const early = row('a1', hoursFrom(RUN, -3), 'fail');
    const late = row('a1', hoursFrom(RUN, -1), 'pass');
    expect(latestPerSubject([early, late], (r) => r.assetId, (r) => r.at)[0]!.outcome).toBe('pass');
    expect(latestPerSubject([late, early], (r) => r.assetId, (r) => r.at)[0]!.outcome).toBe('pass');
  });

  it('keeps one entry per subject and leaves the others alone', () => {
    const out = latestPerSubject(
      [row('a1', RUN, 'pass'), row('a2', RUN, 'fail'), row('a1', hoursFrom(RUN, 1), 'fail')],
      (r) => r.assetId,
      (r) => r.at,
    );
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.assetId === 'a1')!.outcome).toBe('fail');
  });

  it('drops a row with no readable time rather than letting it win', () => {
    // An unreadable timestamp sorting as the latest would hide the real result.
    const out = latestPerSubject(
      [row('a1', RUN, 'pass'), row('a1', 'whenever', 'fail')],
      (r) => r.assetId,
      (r) => r.at,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.outcome).toBe('pass');
  });

  it('returns nothing for nothing', () => {
    expect(latestPerSubject([], (r: { assetId: string }) => r.assetId, () => RUN)).toEqual([]);
  });
});
