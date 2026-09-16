import {
  FORM72_INBOX, autoLinkJob, form72AttachmentName, form72AttachmentSubject, form72EmailBody,
  hasHydrantInputs, hydrantInputsFrom, rankJobsForForm,
} from '@/domain/form72Link';
import { emptyForm72 } from '@/domain/form72';

/**
 * A finished Form 72 carried into the hydrant tool and onto the job.
 *
 * The numbers used to be typed twice, and the second typing is where the
 * two disagree. So the tool reads the form's own parts, each figure says
 * which part it came from, and a form with nothing in the relevant parts
 * fills nothing rather than a zero.
 */

const blank = () => emptyForm72({ id: 'f', siteId: 's', siteName: 'Tower', now: '2026-09-10T00:00:00.000Z' });

describe('what the hydrant tool reads out of the form', () => {
  it('takes the flowing reading from Part D and the duty from Part E', () => {
    const form = blank();
    form.flowTest.staticPressureKpa = 620;
    form.flowTest.hydrantLocations = ['H3 level 2'];
    form.flowTest.rows = [{ rateLps: 10, devices: 'orifice', hydrant1Kpa: 410 }];
    form.booster.requiredLps = 10;
    form.booster.requiredKpa = 350;
    form.booster.highestHydrantAboveBoosterM = 24;
    const inputs = hydrantInputsFrom(form);
    expect(inputs).toMatchObject({ staticKpa: 620, residualKpa: 410, flowLpm: 600, requiredLps: 10, requiredKpa: 350, riseM: 24, hydrantRef: 'H3 level 2' });
    expect(inputs.sources.some((s) => s.startsWith('Part D: 10 L/s'))).toBe(true);
    expect(inputs.sources.some((s) => s.startsWith('Part E: required 10 L/s at 350 kPa'))).toBe(true);
    expect(hasHydrantInputs(inputs)).toBe(true);
  });

  it('falls back to Part E when Part D has no flowing row', () => {
    const form = blank();
    form.booster.staticPressureKpa = 600;
    form.booster.hydrantResidualKpa = 380;
    form.booster.requiredLps = 20;
    const inputs = hydrantInputsFrom(form);
    expect(inputs.staticKpa).toBe(600);
    expect(inputs.residualKpa).toBe(380);
    // Read at the required flow, and said so.
    expect(inputs.flowLpm).toBe(1200);
    expect(inputs.sources.join(' ')).toContain('since Part D gave no row');
  });

  it('skips a row with no pressure rather than reading it as zero', () => {
    const form = blank();
    form.flowTest.rows = [{ rateLps: 10, devices: '' }, { rateLps: 20, devices: '', hydrant1Kpa: 300 }];
    expect(hydrantInputsFrom(form).flowLpm).toBe(1200);
  });

  it('fills nothing from an empty form, and says so', () => {
    const inputs = hydrantInputsFrom(blank());
    expect(hasHydrantInputs(inputs)).toBe(false);
    expect(inputs.sources).toEqual([]);
  });
});

describe('which job the form belongs to', () => {
  const jobs = [
    { externalId: '41000', title: 'Annual hydrant', status: 'complete', completedAt: '2025-09-01T00:00:00Z' },
    { externalId: '41900', title: 'Hydrant test', status: 'scheduled', scheduledFor: '2026-09-12T00:00:00Z' },
    { externalId: '41850', title: 'Pump service', status: 'in-progress', scheduledFor: '2026-09-09T00:00:00Z' },
  ];

  it('offers open work first, newest first, then finished work', () => {
    expect(rankJobsForForm(jobs).map((j) => j.externalId)).toEqual(['41900', '41850', '41000']);
  });

  it('links on its own only where there is exactly one open job', () => {
    expect(autoLinkJob(jobs)).toBeUndefined();
    expect(autoLinkJob(jobs.filter((j) => j.externalId !== '41850'))?.externalId).toBe('41900');
    expect(autoLinkJob(jobs.filter((j) => j.status === 'complete'))).toBeUndefined();
  });
});

describe('the PDF on the job', () => {
  it('is named for the site, the system and the day, with nothing a file system refuses', () => {
    expect(form72AttachmentName({ siteName: 'Tower / Annex', systemLabel: 'Boosted Hydrant System', testDate: '2026-09-10' }))
      .toBe('Form 72 - Tower Annex - Boosted Hydrant System - 2026-09-10.pdf');
    expect(form72AttachmentName({ siteName: 'Shed' })).toBe('Form 72 - Shed.pdf');
  });

  it('says what it is in the subject and the email', () => {
    expect(form72AttachmentSubject({ siteName: 'Tower', systemLabel: 'Towns Main', testDate: '2026-09-10' }))
      .toBe('Form 72 — Tower, Towns Main, tested 2026-09-10');
    const body = form72EmailBody({ siteName: 'Tower', testDate: '2026-09-10', licenseeName: 'D. Smith' }, '41900');
    expect(body).toContain('Simpro job 41900.');
    expect(body).toContain('Licensee: D. Smith.');
    expect(form72EmailBody({ siteName: 'Tower', licenseeName: '' })).toContain('Not yet linked');
    expect(FORM72_INBOX).toBe('lachlan@safeqld.com.au');
  });
});
