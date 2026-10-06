/**
 * An issued Form 72 reprints as the issued form, from every path.
 *
 * form72Html decides three things from the record's status: whether to stamp
 * "DRAFT — NOT FOR ISSUE", whether to print the "Check before issue" cautions,
 * and whether to print "Issued dd/mm/yyyy, and held unaltered since". It
 * treats a caller that does not say as a draft, which is the cautious default
 * and is deliberate.
 *
 * Four paths produce this document — Produce PDF, Email to the office, the
 * attachment queued onto the Simpro job, and the occupier's copy — and three
 * of them built the call by hand and left the status off. So every issued form
 * reprinted as a draft except the occupier's: the cautions printed as advice
 * about a decision already taken, the "held unaltered since" line was missing,
 * and a clean draft from Produce PDF was indistinguishable from the statutory
 * record. The attachment is the one that runs automatically on issue, so the
 * copy filed against the Simpro job disagreed with the copy in the occupier's
 * hand.
 *
 * And it reached backwards. A rule added to validateForm72 after a form was
 * issued stamps that form's reprint DRAFT — which is what happened the morning
 * the Part C date reader learned to read a slashed date, turning a stale
 * certificate from an unreadable-date caution into an out-of-calibration
 * blocker.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { form72Html } from '@/export/form72';
import { emptyForm72, PART_D_ROWS, type Form72 } from '@/domain/form72';

const SCREEN = readFileSync(join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8');

describe('the screen renders through one path', () => {
  it('has exactly one call to form72Html', () => {
    expect([...SCREEN.matchAll(/\bform72Html\(/g)]).toHaveLength(1);
  });

  it('and that one takes its status and issue date off the record', () => {
    const at = SCREEN.indexOf('form72Html(');
    const call = SCREEN.slice(at, at + 320);
    expect(call).toContain('status: form.status');
    expect(call).toContain('issuedAt: form.issuedAt');
  });

  it('every path that produces the PDF goes through it', () => {
    // Produce PDF, Email to the office, the Simpro attachment, the occupier's
    // copy. Four, and none of them builds the call itself.
    expect([...SCREEN.matchAll(/renderForm72\(/g)].length).toBeGreaterThanOrEqual(5);
  });
});

/** A form good enough to issue, with one non-blocking caution on it. */
const issuable = (): Form72 => {
  const form = emptyForm72({ id: 'f1', siteId: 's1', siteName: 'Fictional Tower', now: '2026-10-06T00:00:00.000Z' });
  form.testDate = '2026-10-06';
  form.contractor = 'A Contractor';
  form.licenseeName = 'A Licensee';
  form.licenceNumber = 'QBCC 1234567';
  form.maintenanceTest = { ...form.maintenanceTest, hydrantAnnual: true };
  form.devices = [{ slot: 'Device/gauge 1', serialNumber: 'SQF-001', dateCalibrated: '2026-09-02' }];
  form.flowTest = {
    result: 'pass', hydrantLocations: ['Front fence'], requiredLps: 10, requiredKpa: 700,
    // Cites a gauge that is not in Part C: a caution, not a blocker.
    rows: PART_D_ROWS.map((r) => (r.rateLps === 10 ? { ...r, devices: 'DG9', hydrant1Kpa: 620 } : r)),
    achievedLps: 10, achievedKpa: 620,
  };
  form.booster = { result: 'na' };
  form.systemResult = 'pass';
  return form;
};

const render = (over: Parameters<typeof form72Html>[0] extends infer T ? Partial<T> : never) => form72Html({
  form: issuable(), systemLabel: 'Towns Main System', companyName: 'A Contractor',
  generatedAt: '2026-10-06T00:00:00.000Z', ...over,
});

describe('what the status decides', () => {
  it('an issued form says it was issued and held unaltered', () => {
    expect(render({ status: 'issued', issuedAt: '2026-10-06T01:00:00.000Z' }))
      .toContain('held unaltered since');
  });

  it('an issued form does not carry "Check before issue" advice', () => {
    // A decision already taken. The cautions are for the person about to sign.
    expect(render({ status: 'issued', issuedAt: '2026-10-06T01:00:00.000Z' }))
      .not.toContain('Check before issue');
  });

  it('a caller that says nothing gets the draft rendering, which is the fault', () => {
    /*
     * This is the renderer behaving correctly and cautiously. It is asserted
     * here so the reason the screen must always pass the status is on the
     * record beside the screen's own test, rather than only in the renderer's.
     */
    const silent = render({});
    expect(silent).toContain('Check before issue');
    expect(silent).not.toContain('held unaltered since');
  });

  it('so the two renderings of one issued form differ, which is what went wrong', () => {
    const asIssued = render({ status: 'issued', issuedAt: '2026-10-06T01:00:00.000Z' });
    expect(render({})).not.toEqual(asIssued);
  });

  it('a clean draft says it is a draft, which it could not when nobody passed the status', () => {
    // "Draft copy — this form has not been issued" is the only thing telling a
    // clean draft from the statutory record.
    expect(render({ status: 'draft' })).toContain('this form has not been issued');
    expect(render({})).not.toContain('this form has not been issued');
  });
});

describe('a rule added after a form was issued', () => {
  it('cannot stamp DRAFT on the reprint of a form that was signed', () => {
    /*
     * The concrete case: a Part C calibration date typed with slashes used to
     * read as an unreadable-date caution and now reads as out-of-calibration,
     * which blocks. A form issued before that change still reprints as issued.
     */
    const form = issuable();
    form.devices = [{ slot: 'Device/gauge 1', serialNumber: 'SQF-001', dateCalibrated: '2024-01-15' }];
    const html = form72Html({
      form, systemLabel: 'Towns Main System', companyName: 'A Contractor',
      generatedAt: '2026-10-06T00:00:00.000Z',
      status: 'issued', issuedAt: '2026-10-06T01:00:00.000Z',
    });
    expect(html).not.toContain('DRAFT — NOT FOR ISSUE');
    expect(html).toContain('held unaltered since');
  });

  it('and the same form as a draft is stamped, because then it is true', () => {
    const form = issuable();
    form.devices = [{ slot: 'Device/gauge 1', serialNumber: 'SQF-001', dateCalibrated: '2024-01-15' }];
    expect(form72Html({
      form, systemLabel: 'Towns Main System', companyName: 'A Contractor',
      generatedAt: '2026-10-06T00:00:00.000Z', status: 'draft',
    })).toContain('DRAFT — NOT FOR ISSUE');
  });
});
