import {
  form72FromJob, looksLikeHydrantWork, maintenanceTestFromJobWords, rankJobsForNewForm,
  testDateFromJob, testDateSource,
  type JobForForm, type OwnDetails,
} from '@/domain/form72FromJob';
import type { Site } from '@/domain/types';

/**
 * Starting a Form 72 from the job it was done under.
 *
 * The point of this mapping is that a technician at a booster does not retype
 * what the job already knows. The point of these tests is the other half: a
 * Form 72 is signed, and a field filled from a plausible inference reads
 * exactly like a field somebody checked. So most of what follows is about what
 * the mapping refuses to fill in.
 */

const TODAY = '2026-10-06';

const job = (over: Partial<JobForForm> = {}): JobForForm => ({
  externalId: '41820',
  siteId: 's1',
  siteName: 'Baldwin Living',
  title: 'Annual Fire Hydrant Service',
  address: '12 Example Street, Ipswich',
  customerName: 'Baldwin Living Pty Ltd',
  jobType: 'Service',
  technician: 'C. Whitmore',
  status: 'scheduled',
  issuedOn: `${TODAY}T07:30:00.000Z`,
  ...over,
});

const own: OwnDetails = {
  companyName: 'Safe QLD Pty Ltd',
  technicianName: 'D. McKee',
  technicianLicence: '1310717',
};

const site = (over: Partial<Site> = {}): Site => ({
  id: 's1',
  name: 'Baldwin Living',
  address: '12 Example Street',
  suburb: 'Ipswich',
  state: 'QLD',
  postcode: '4305',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('what the job fills in', () => {
  it('takes the site, the address, the date and the job reference', () => {
    const out = form72FromJob(job(), own, TODAY, site());
    expect(out).toMatchObject({
      jobExternalId: '41820',
      jobTitle: 'Annual Fire Hydrant Service',
      siteId: 's1',
      siteName: 'Baldwin Living',
      siteAddress: '12 Example Street Ipswich QLD 4305',
      testDate: TODAY,
    });
  });

  it('prefers the site record’s address, because it holds the suburb and the postcode', () => {
    // A Form 72 printed with the street alone has left the suburb off a
    // statutory document.
    const fromSite = form72FromJob(job(), own, TODAY, site());
    expect(fromSite.siteAddress).toContain('QLD 4305');
    const fromJob = form72FromJob(job(), own, TODAY, null);
    expect(fromJob.siteAddress).toBe('12 Example Street, Ipswich');
    expect(fromJob.filled.some((l) => l.includes('from the job'))).toBe(true);
  });

  it('says the address is missing rather than leaving it quietly blank', () => {
    const out = form72FromJob(job({ address: undefined }), own, TODAY, null);
    expect(out.siteAddress).toBeUndefined();
    expect(out.notFilled.join(' ')).toContain('Site address');
  });

  it('puts the job’s technician on the attachment, not in the licensee box', () => {
    // The licensee signs; the rostered technician did the work. They are two
    // different claims and only one of them the job row supports.
    const out = form72FromJob(job(), own, TODAY, site());
    expect(out.technician).toBe('C. Whitmore');
    expect(out.licenseeName).toBe('D. McKee');
  });

  it('makes us the contractor, never the customer we did the work for', () => {
    const out = form72FromJob(job({ customerName: 'Baldwin Living Pty Ltd' }), own, TODAY, site());
    expect(out.contractor).toBe('Safe QLD Pty Ltd');
    expect(out.contractor).not.toBe('Baldwin Living Pty Ltd');
  });

  it('leaves the system descriptor blank and says why', () => {
    // It is the one field that tells two forms for the same site apart, and a
    // job title is not one. A wrong descriptor is worse than none.
    const out = form72FromJob(job(), own, TODAY, site());
    expect(out).not.toHaveProperty('systemLabel');
    expect(out.notFilled.join(' ')).toContain('system descriptor');
  });

  it('names a missing licence number as the blocker it is', () => {
    const out = form72FromJob(job(), { ...own, technicianLicence: '' }, TODAY, site());
    expect(out.notFilled.join(' ')).toContain('not valid without it');
  });

  it('lists everything it filled, so the technician reads it rather than trusting it', () => {
    const out = form72FromJob(job(), own, TODAY, site());
    expect(out.filled.length).toBeGreaterThan(4);
    for (const line of out.filled) expect(line).toMatch(/from|read from/);
  });
});

describe('the date a test is recorded under', () => {
  it('is the completion date of a job the office has closed', () => {
    const done = job({ status: 'complete', issuedOn: '2026-09-28T07:00:00.000Z', completedDate: '2026-09-29' });
    expect(testDateFromJob(done, TODAY)).toBe('2026-09-29');
    expect(testDateSource(done, TODAY)).toContain('completion date');
  });

  it('falls back to the completion instant where the office gave no day', () => {
    const done = job({ status: 'complete', completedDate: undefined, completedAt: '2026-09-29T04:00:00.000Z' });
    expect(testDateFromJob(done, TODAY)).toBe('2026-09-29');
  });

  it('is today for a job that is not finished, whatever date the job carries', () => {
    /*
     * This used to take the job's `scheduledFor` where that was not in the
     * future — and that field holds the job's ISSUE date, filled from Simpro's
     * `issuedAt` (src/db/mirrorRepo.ts). So a job raised in August and tested
     * in October produced a Form 72 dated August: the day somebody in the
     * office typed the job up, on a document whose ten-business-day notice to
     * the occupier and five-year retention both run from the test date.
     */
    expect(testDateFromJob(job(), TODAY)).toBe(TODAY);
    expect(testDateFromJob(job({ issuedOn: '2026-08-11T07:00:00.000Z' }), TODAY)).toBe(TODAY);
  });

  it('never dates a test forward to a job that has not happened', () => {
    const future = job({ issuedOn: '2026-10-30T07:00:00.000Z' });
    expect(testDateFromJob(future, TODAY)).toBe(TODAY);
  });

  it('says today is today, and that it is the technician’s to change', () => {
    // It used to report the source as "the day the job was scheduled", which
    // is a claim about a field that has never held a schedule.
    expect(testDateSource(job({ issuedOn: '2026-08-11T07:00:00.000Z' }), TODAY)).toBe(
      'today — change it if the test was done on another day',
    );
  });

  it('falls back to today where the job has no dates at all', () => {
    expect(testDateFromJob(job({ issuedOn: undefined }), TODAY)).toBe(TODAY);
  });
});

describe('reading the maintenance test out of the job’s own words', () => {
  it('ticks both axes on an unambiguous title', () => {
    const { maintenanceTest, evidence } = maintenanceTestFromJobWords('Annual Fire Hydrant Service');
    expect(maintenanceTest).toMatchObject({ hydrantAnnual: true, hydrantFiveYear: false });
    expect(evidence).toBe('Annual Fire Hydrant Service');
  });

  it('reads five-yearly in the several ways the office writes it', () => {
    for (const text of ['5 Year Sprinkler Test', 'Five-year sprinkler service', '5-yearly sprinkler']) {
      expect({ text, got: maintenanceTestFromJobWords(text).maintenanceTest?.sprinklerFiveYear })
        .toEqual({ text, got: true });
    }
  });

  it('reads annual the several ways the office writes it', () => {
    for (const text of ['Annual hydrant', 'Yearly hydrant service', '12 month hydrant check']) {
      expect({ text, got: maintenanceTestFromJobWords(text).maintenanceTest?.hydrantAnnual })
        .toEqual({ text, got: true });
    }
  });

  it('treats a combined system as the one answer it is', () => {
    const { maintenanceTest } = maintenanceTestFromJobWords('Annual combined hydrant and sprinkler service');
    expect(maintenanceTest).toMatchObject({ combinedAnnual: true, hydrantAnnual: false, sprinklerAnnual: false });
  });

  it('treats a five-yearly that also names the annual as a five-yearly', () => {
    const { maintenanceTest } = maintenanceTestFromJobWords('5 year and annual hydrant service');
    expect(maintenanceTest).toMatchObject({ hydrantFiveYear: true, hydrantAnnual: false });
  });

  it('ticks nothing where the job names two systems and no combined', () => {
    // "Hydrant and sprinkler" is two systems, not the combined box, and
    // ticking both would be a claim about which standard's test was done.
    expect(maintenanceTestFromJobWords('Annual hydrant and sprinkler service').maintenanceTest)
      .toBeUndefined();
  });

  it('ticks nothing where the job names an interval and no system', () => {
    expect(maintenanceTestFromJobWords('Annual fire service maintenance').maintenanceTest).toBeUndefined();
  });

  it('ticks nothing where the job names a system and no interval', () => {
    // Half a grid is not an answer Part A has a box for.
    expect(maintenanceTestFromJobWords('Hydrant repairs').maintenanceTest).toBeUndefined();
  });

  it('ticks nothing on a job named for nothing in particular', () => {
    for (const text of ['Service call', 'Fire Service Maintenance', 'Callout', '']) {
      expect({ text, got: maintenanceTestFromJobWords(text).maintenanceTest })
        .toEqual({ text, got: undefined });
    }
  });

  it('reads the job type as well as the title, because the office uses either', () => {
    const out = form72FromJob(
      job({ title: 'PO 44812', jobTypeRaw: 'Annual Sprinkler Inspection' }),
      own, TODAY, site(),
    );
    expect(out.maintenanceTest).toMatchObject({ sprinklerAnnual: true });
    expect(out.filled.join(' ')).toContain('Annual Sprinkler Inspection');
  });

  it('says it could not tell rather than ticking a guess', () => {
    const out = form72FromJob(job({ title: 'Service call', jobType: 'Service' }), own, TODAY, site());
    expect(out.maintenanceTest).toBeUndefined();
    expect(out.notFilled.join(' ')).toContain('does not say unambiguously');
  });
});

describe('which job to put in front of somebody raising a form', () => {
  const j = (id: string, issuedOn?: string, siteName = `Site ${id}`): JobForForm =>
    job({ externalId: id, siteName, issuedOn });

  it('puts today first, then the recent past, then the undated, then the future', () => {
    const ranked = rankJobsForNewForm([
      j('future', '2026-11-01T07:00:00.000Z'),
      j('undated', undefined),
      j('lastweek', '2026-09-29T07:00:00.000Z'),
      j('today', `${TODAY}T07:00:00.000Z`),
    ], TODAY);
    expect(ranked.map((x) => x.externalId)).toEqual(['today', 'lastweek', 'undated', 'future']);
  });

  it('puts the most recent of the past jobs first, because that is the write-up', () => {
    const ranked = rankJobsForNewForm([
      j('older', '2026-09-01T07:00:00.000Z'),
      j('newer', '2026-10-05T07:00:00.000Z'),
    ], TODAY);
    expect(ranked.map((x) => x.externalId)).toEqual(['newer', 'older']);
  });

  it('puts the soonest of the future jobs first', () => {
    const ranked = rankJobsForNewForm([
      j('far', '2026-12-01T07:00:00.000Z'),
      j('soon', '2026-10-09T07:00:00.000Z'),
    ], TODAY);
    expect(ranked.map((x) => x.externalId)).toEqual(['soon', 'far']);
  });

  it('keeps a job with no office id, because the alternative is work nobody can find', () => {
    const ranked = rankJobsForNewForm([j('a'), { ...j('b'), externalId: undefined }], TODAY);
    expect(ranked).toHaveLength(2);
  });

  it('shortlists the jobs that look like water-based fire work', () => {
    expect(looksLikeHydrantWork(job({ title: 'Annual Fire Hydrant Service' }))).toBe(true);
    expect(looksLikeHydrantWork(job({ title: 'Sprinkler flow test' }))).toBe(true);
    expect(looksLikeHydrantWork(job({ title: 'Booster service', jobType: undefined }))).toBe(true);
    expect(looksLikeHydrantWork(job({ title: 'Extinguisher service', jobType: 'Service', jobTypeRaw: undefined })))
      .toBe(false);
    expect(looksLikeHydrantWork(job({ title: 'Exit light test', jobType: 'Service', jobTypeRaw: undefined })))
      .toBe(false);
  });
});
