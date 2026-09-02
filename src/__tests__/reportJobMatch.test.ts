import { jobNumberForReport, type ReportJobCandidate } from '@/domain/reportJobMatch';

/**
 * The customer job number on a service report.
 *
 * Their own report leads with it — "CUSTOMER JOB NO. 42823" across the top of
 * page one — and it is what the office files the document by. The app syncs
 * jobs from Simpro carrying those numbers, the report type has had a
 * `jobNumber` field from the start and the renderer prints it, and the one
 * thing that builds a report never passed one. Every report this app has
 * produced went out without it.
 *
 * The interesting half is the refusal. A site has several jobs in a month, and
 * putting the wrong number on a service report files it against somebody else's
 * work — the same failure the Simpro push already refuses to risk when no job
 * is linked.
 */

const job = (over: Partial<ReportJobCandidate> = {}): ReportJobCandidate => ({
  externalId: '42823',
  siteId: 's1',
  scheduledFor: '2026-05-20T00:00:00.000Z',
  ...over,
});

/*
 * The first of May to the thirty-first, in Queensland.
 *
 * The ends are instants and they are resolved the same way the jobs are, so
 * "23:59:59Z on the 31st" would be the first of June here — a window that
 * quietly runs a day long at each end. Written as an hour that means what it
 * says in Brisbane.
 */
const WINDOW = { siteId: 's1', from: '2026-04-30T14:00:00.000Z', to: '2026-05-31T13:00:00.000Z' };

describe('the job number a report carries', () => {
  it('takes it where exactly one job at the site falls in the period', () => {
    expect(jobNumberForReport([job()], WINDOW)).toEqual({ jobNumber: '42823' });
  });

  it('takes it once where the same job appears more than once', () => {
    // A re-sync writes the job again; two rows for one job is one job.
    expect(jobNumberForReport([job(), job()], WINDOW)).toEqual({ jobNumber: '42823' });
  });

  it('prints none, and says why, where the site had more than one', () => {
    /*
     * The refusal. A wrong number files this service against somebody else's
     * job, and there is no undo for that in the office system — so the report
     * goes out without one and the technician is told before it leaves the
     * phone, rather than the document quietly claiming a job it may not be.
     */
    const out = jobNumberForReport([job(), job({ externalId: '42999' })], WINDOW);
    expect(out.jobNumber).toBeUndefined();
    expect(out.reason).toContain('2 jobs');
    expect(out.reason).toContain('42823, 42999');
    expect(out.reason).toContain('rather than guessing');
  });

  it('says nothing at all where the site simply had no job', () => {
    // An ordinary state, not a problem. A sentence explaining it would read as
    // a fault on a report that is perfectly fine.
    expect(jobNumberForReport([], WINDOW)).toEqual({});
    expect(jobNumberForReport([job({ siteId: 'other' })], WINDOW)).toEqual({});
  });

  it('ignores a job belonging to a different site', () => {
    expect(jobNumberForReport([job({ siteId: 's2' })], WINDOW)).toEqual({});
  });

  it('ignores a job outside the period', () => {
    // Otherwise a job from two years ago puts its number on this month's work.
    expect(jobNumberForReport([job({ scheduledFor: '2024-05-20T00:00:00.000Z' })], WINDOW)).toEqual({});
    // The first of June in Brisbane, against a window that closes on the 31st.
    expect(jobNumberForReport([job({ scheduledFor: '2026-06-01T05:00:00.000Z' })], WINDOW)).toEqual({});
  });

  it('reads the ends of the period as Queensland days too', () => {
    // Both ends and the job go through the same reading, so a window and a job
    // stamped in the same hour cannot end up on different sides of a boundary.
    // 2026-04-30T14:00Z is midnight on the first of May in Brisbane.
    expect(jobNumberForReport([job({ scheduledFor: '2026-04-30T14:00:00.000Z' })], WINDOW))
      .toEqual({ jobNumber: '42823' });
    expect(jobNumberForReport([job({ scheduledFor: '2026-04-30T13:00:00.000Z' })], WINDOW)).toEqual({});
  });

  it('places a job by the Queensland day it was worked, not the UTC stamp', () => {
    /*
     * Simpro issues an instant. A job scheduled at half past seven on the
     * morning of the first of May is stamped 21:30 on 30 April in UTC, which is
     * outside a window that starts on the first — so the number would be
     * dropped for the one month it belongs to.
     */
    const window = { siteId: 's1', from: '2026-05-01', to: '2026-05-31' };
    expect(jobNumberForReport([job({ scheduledFor: '2026-04-30T21:30:00.000Z' })], window))
      .toEqual({ jobNumber: '42823' });
    // And the day before it really is outside.
    expect(jobNumberForReport([job({ scheduledFor: '2026-04-29T21:30:00.000Z' })], window)).toEqual({});
  });

  it('prefers the day the job was finished over the day it was scheduled', () => {
    // A job booked for April and done in May belongs to May's report.
    expect(jobNumberForReport([job({
      scheduledFor: '2026-04-02T00:00:00.000Z', completedAt: '2026-05-20T04:00:00.000Z',
    })], WINDOW)).toEqual({ jobNumber: '42823' });
  });

  it('ignores a job with no number and one with no date', () => {
    expect(jobNumberForReport([job({ externalId: undefined })], WINDOW)).toEqual({});
    expect(jobNumberForReport([job({ externalId: '  ' })], WINDOW)).toEqual({});
    // No date at all cannot be placed, and counting it would let any job in.
    expect(jobNumberForReport([job({ scheduledFor: undefined })], WINDOW)).toEqual({});
  });

  it('answers nothing rather than guessing when the period itself is unreadable', () => {
    expect(jobNumberForReport([job()], { siteId: 's1', from: '1/5/2026', to: '31/5/2026' })).toEqual({});
  });
});

/**
 * The job offered to a test sheet being filled in today.
 *
 * A sheet is written on site, now. The question is whether there is one open
 * job here today; a job the office has completed is not the one being worked,
 * however recently it was scheduled. The number is offered rather than
 * applied, and where the app would have to guess it says so instead.
 */
import { jobToOffer, type OpenJobCandidate } from '@/domain/reportJobMatch';

const open = (over: Partial<OpenJobCandidate> = {}): OpenJobCandidate => ({
  id: 'j1',
  externalId: '43747',
  siteId: 's1',
  status: 'scheduled',
  // Nine in the morning in Brisbane on the second of September, which is
  // still the first in UTC — the day has to be resolved in Queensland.
  scheduledFor: '2026-09-01T23:00:00.000Z',
  ...over,
});

const TODAY = { siteId: 's1', today: '2026-09-02' };

describe('the job offered to a test sheet', () => {
  it('is the one open job scheduled at the site today', () => {
    expect(jobToOffer([open()], TODAY)).toMatchObject({ jobNumber: '43747', basis: 'today' });
  });

  it('ignores a job the office has already completed, and one at another site', () => {
    expect(jobToOffer([open({ status: 'complete' })], TODAY)).toEqual({});
    expect(jobToOffer([open({ siteId: 's2' })], TODAY)).toEqual({});
  });

  it('falls back to the only open job at the site when nothing is booked today', () => {
    const out = jobToOffer([open({ scheduledFor: '2026-08-20T00:00:00.000Z' })], TODAY);
    expect(out).toMatchObject({ jobNumber: '43747', basis: 'only-open' });
  });

  it('refuses to choose between two jobs today, and says which', () => {
    const out = jobToOffer([open(), open({ id: 'j2', externalId: '43999' })], TODAY);
    expect(out.jobNumber).toBeUndefined();
    expect(out.reason).toContain('2 jobs are scheduled at this site today');
    expect(out.reason).toContain('43747, 43999');
  });

  it('refuses to choose between two open jobs when nothing is booked today', () => {
    const out = jobToOffer([
      open({ scheduledFor: '2026-08-20T00:00:00.000Z' }),
      open({ id: 'j2', externalId: '43999', scheduledFor: undefined }),
    ], TODAY);
    expect(out.jobNumber).toBeUndefined();
    expect(out.reason).toContain('2 jobs are open at this site');
  });

  it('counts a job re-synced twice as one job', () => {
    expect(jobToOffer([open(), open()], TODAY)).toMatchObject({ jobNumber: '43747' });
  });

  it('offers nothing where today cannot be read', () => {
    expect(jobToOffer([open()], { siteId: 's1', today: 'yesterday' })).toEqual({});
  });
});
