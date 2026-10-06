import {
  FORM72_INBOX, autoLinkJob, form72AttachmentName, form72AttachmentSubject, form72EmailBody,
  hasHydrantInputs, hydrantInputsFrom, occupierCopyBody, occupierCopyRecipient,
  occupierCopySubject, rankJobsForForm,
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

describe('the occupier’s copy, and where it goes', () => {
  /*
   * MP 6.1 A4(b) obliges a copy within ten business days. The app counted those
   * days, printed the deadline on the form and asked afterwards whether the
   * copy was handed over — and had no way to send one. The obligation was
   * measured and not served.
   */
  it('prefers the owner contact typed on this form, which somebody wrote on the day', () => {
    expect(occupierCopyRecipient(
      { ownerContact: 'manager@baldwinliving.com.au' },
      { contactEmail: 'office@example.com' },
    )).toEqual({ email: 'manager@baldwinliving.com.au', source: 'form' });
  });

  it('falls back to the site’s contact email as the office holds it', () => {
    expect(occupierCopyRecipient({ ownerContact: undefined }, { contactEmail: 'office@example.com' }))
      .toEqual({ email: 'office@example.com', source: 'site' });
  });

  it('rejects a phone number typed into the owner contact box, and says so', () => {
    // That box takes free text and usually holds a phone number. A statutory
    // document sent to an address that does not exist is the cheap failure;
    // one sent to an address that does and is not theirs is the expensive one.
    const out = occupierCopyRecipient({ ownerContact: '07 3000 0000' }, null);
    expect(out.email).toBeUndefined();
    expect(out.reason).toContain('is not an email address');
    expect(out.reason).toContain('07 3000 0000');
  });

  it('rejects the near-misses too, rather than being clever about them', () => {
    for (const typed of ['manager@baldwinliving', 'manager at example.com', 'a@b', '@example.com', 'a@@b.com']) {
      expect({ typed, email: occupierCopyRecipient({ ownerContact: typed }, null).email })
        .toEqual({ typed, email: undefined });
    }
  });

  it('never falls back to our own inbox, which would make the deadline a fiction', () => {
    // A copy sent to ourselves is not a copy given to an occupier, and
    // recording it as one would turn the date the app tracks into a lie.
    const out = occupierCopyRecipient({ ownerContact: undefined }, null);
    expect(out.email).toBeUndefined();
    expect(out.reason).toContain('hand the copy over another way');
    expect(JSON.stringify(out)).not.toContain(FORM72_INBOX);
  });

  it('subjects the occupier’s copy as theirs, not as the office’s filing', () => {
    const subject = occupierCopySubject({
      siteName: 'Baldwin Living', testDate: '2026-10-02', systemLabel: 'Towns Main System',
    });
    expect(subject).toBe('Your Form 72 — Baldwin Living, Towns Main System, tested 2026-10-02');
  });

  it('writes the body for the occupier, naming the obligation it discharges', () => {
    const body = occupierCopyBody({
      siteName: 'Baldwin Living', testDate: '2026-10-02', licenseeName: 'D. McKee',
      criticalDefectsIdentified: false, systemLabel: 'Towns Main System',
    }, 'Safe QLD Fire Protection');
    expect(body).toContain('Baldwin Living');
    expect(body).toContain('Queensland Development Code Mandatory Part 6.1');
    expect(body).toContain("keep it with the building's fire safety records");
    expect(body).toContain('D. McKee');
    expect(body).toContain('Safe QLD Fire Protection');
  });

  it('tells the occupier a critical defect notice is coming, because that is the part to act on', () => {
    const withDefect = occupierCopyBody({
      siteName: 'Baldwin Living', licenseeName: 'D. McKee', criticalDefectsIdentified: true,
    }, 'Safe QLD');
    expect(withDefect).toContain('critical defect notice will follow separately');
    expect(withDefect).toContain('different document');

    const without = occupierCopyBody({
      siteName: 'Baldwin Living', licenseeName: 'D. McKee', criticalDefectsIdentified: false,
    }, 'Safe QLD');
    expect(without).not.toContain('critical defect notice');
  });
});
