import { assetsLine, buildSiteFacts, lastServiceLine, techniciansOf, type SiteFactsInput } from '@/domain/siteHistory';

/**
 * What a technician wants to know about a site before they go.
 *
 * The rule under test is that an absence is said, not zeroed. The phone
 * often cannot know how long the last visit took — the office's hours are
 * outside what it mirrors — and a card that printed "0 h" there would be
 * read as "nobody clocked on", which is an accusation.
 */

const base: SiteFactsInput = {
  siteId: 's1', siteName: 'Tower', suburb: 'Milton', today: '2026-09-10',
  hours: [], assetCounts: [], due: [],
};

describe('the last job', () => {
  it('names who did it, when, and how long, where the phone holds all three', () => {
    const f = buildSiteFacts({
      ...base,
      lastJob: { externalId: '41000', title: 'Annual', status: 'complete', statusName: 'Completed', completedDate: '2026-09-01', techniciansJson: '[{"id":5,"name":"Dan"},{"id":6,"name":"Mike"}]' },
      hours: [
        { staffName: 'Dan', date: '2026-09-01', hours: 3.5, source: 'schedule' },
        { staffName: 'Mike', date: '2026-09-01', hours: 3.5, source: 'schedule' },
      ],
    });
    expect(f.lastJob).toMatchObject({ jobNo: '41000', who: ['Dan', 'Mike'], finished: '2026-09-01', daysAgo: 9 });
    expect(f.hours).toEqual({ total: 7, byPerson: [{ name: 'Dan', hours: 3.5 }, { name: 'Mike', hours: 3.5 }], source: 'schedule' });
    expect(f.clockedOn).toBe('yes');
    expect(lastServiceLine(f)).toBe('Last job 41000 — Dan, Mike, 9 days ago, 7 h');
  });

  it('says hours are not held rather than that nobody clocked on', () => {
    const f = buildSiteFacts({
      ...base,
      lastJob: { externalId: '41000', title: 'Annual', status: 'complete', completedDate: '2026-03-01' },
    });
    expect(f.clockedOn).toBe('unknown');
    expect(f.clockedOnNote).toContain('No hours for job 41000 are held on this phone');
    expect(f.hours).toBeUndefined();
    expect(lastServiceLine(f)).toContain('nobody named');
  });

  it('prefers the office\'s hours over the phone\'s own clock when both are there', () => {
    const f = buildSiteFacts({
      ...base,
      lastJob: { externalId: '41000', title: 'Annual', status: 'complete', completedDate: '2026-09-08' },
      hours: [
        { date: '2026-09-08', hours: 2, source: 'phone-clock' },
        { staffName: 'Dan', date: '2026-09-08', hours: 2.25, source: 'office-timesheet' },
      ],
    });
    expect(f.hours?.source).toBe('office-timesheet');
    expect(f.hours?.total).toBe(4.25);
    expect(f.hours?.byPerson.map((p) => p.name)).toEqual(['This phone', 'Dan']);
  });

  it('reads the names off the JSON, or the plain column, or says nobody', () => {
    expect(techniciansOf({ techniciansJson: '[{"id":1,"name":" Dan "}]' })).toEqual(['Dan']);
    expect(techniciansOf({ techniciansJson: 'not json', technician: 'Mike' })).toEqual(['Mike']);
    expect(techniciansOf({})).toEqual([]);
  });

  it('falls back to the phone\'s own routine run where there is no job', () => {
    const f = buildSiteFacts({
      ...base,
      lastRun: { completedAt: '2026-08-31T01:00:00.000Z', technician: 'Dan', routineLabel: 'Annual detection', checksPassed: 40, checksFailed: 2, checksNotTested: 1, defectsRaised: 2 },
    });
    expect(f.lastJob).toBeUndefined();
    expect(f.lastRun?.daysAgo).toBe(10);
    expect(lastServiceLine(f)).toBe('Last service 10 days ago by Dan — Annual detection');
    expect(f.clockedOnNote).toContain('No Simpro job');
  });

  it('says so when there is nothing at all', () => {
    expect(lastServiceLine(buildSiteFacts(base))).toBe('No service recorded on this phone');
  });
});

describe('what is at the site', () => {
  it('counts by system with the label, biggest first', () => {
    const f = buildSiteFacts({ ...base, assetCounts: [{ system: 'detection', count: 40 }, { system: 'extinguisher', count: 12 }, { system: 'unknown', count: 1 }, { system: 'pump', count: 0 }] });
    expect(f.assetsTotal).toBe(53);
    expect(f.assets[0]).toMatchObject({ system: 'detection', count: 40 });
    expect(assetsLine(f)).toContain('40 fire detection');
    expect(assetsLine(f)).toContain('1 unclassified');
    expect(assetsLine(buildSiteFacts(base))).toBe('No assets registered');
  });

  it('puts overdue first, then due, then the nearest upcoming', () => {
    const f = buildSiteFacts({
      ...base,
      due: [
        { routineId: 'a', routineLabel: 'Six-monthly', frequency: 'six-monthly', state: 'upcoming', daysUntilDue: 40 },
        { routineId: 'b', routineLabel: 'Annual', frequency: 'annual', state: 'overdue', daysUntilDue: -12 },
        { routineId: 'c', routineLabel: 'Monthly', frequency: 'monthly', state: 'due', daysUntilDue: 3 },
        { routineId: 'd', routineLabel: 'Quarterly', frequency: 'quarterly', state: 'not-scheduled' },
      ],
    });
    expect(f.due.map((d) => d.routineId)).toEqual(['b', 'c', 'a']);
    expect(f.overdue).toBe(1);
  });
});

describe('locked in with the client', () => {
  it('is booked when the office has a block for the next job', () => {
    const f = buildSiteFacts({ ...base, nextJob: { externalId: '41900', title: 'Annual', scheduled: { date: '2026-09-15', staffName: 'Dan', startTime: '07:00', endTime: '11:00' } } });
    expect(f.lockedIn).toBe('booked');
    expect(f.lockedInNote).toContain('on the calendar for 2026-09-15 (Dan), 07:00–11:00');
  });

  it('is job-only when the job exists and nothing is on the calendar', () => {
    const f = buildSiteFacts({ ...base, nextJob: { externalId: '41900', title: 'Annual', statusName: 'Pending' } });
    expect(f.lockedIn).toBe('job-only');
    expect(f.lockedInNote).toContain('nothing is on the calendar');
  });

  it('is none — with the reason — when there is no job to book', () => {
    const f = buildSiteFacts(base);
    expect(f.lockedIn).toBe('none');
    expect(f.lockedInNote).toContain('office raises one');
  });
});
