import { serviceReportHtml, type StatutoryRecord } from '@/export/pdf';
import type { ReportBundle } from '@/export/sheets';
import type { Defect, ServiceReport, Site, TestResult, TestRow } from '@/domain/types';

/**
 * The PDF a client is given.
 *
 * This file had no tests. It is the document that records the service, it
 * carries the Queensland record of maintenance an inspector checks, and every
 * fault below is a statement about that service rather than a crash.
 */

const site: Site = {
  id: 's1', name: 'An Example Building', address: '12 Example Street', suburb: 'Ipswich',
  state: 'QLD', postcode: '4305', clientName: 'Example Body Corporate',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const report: ServiceReport = {
  id: 'r1', siteId: 's1', title: 'Annual service', frequency: 'annual',
  serviceDate: '2026-07-03', technicianName: 'A Technician', technicianLicence: 'QLD-12345',
  status: 'draft', createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z',
};

const testRow = (result: TestResult, over: Partial<TestRow> = {}): TestRow => ({
  id: `t-${result}-${over.sortIndex ?? 0}`, reportId: 'r1', deviceText: 'PLANT ROOM',
  deviceType: 'smoke-photo', result, sortIndex: 0, ...over,
});

const bundle = (rows: TestRow[], defects: Defect[] = []): ReportBundle => ({
  site, report, testRows: rows, checkRows: [], defects,
});

const AT = '2026-07-03T06:00:00.000Z';

describe('a device that was not tested', () => {
  const html = () => serviceReportHtml(
    bundle([testRow('pass', { sortIndex: 1 }), testRow('untested', { sortIndex: 2, comment: 'Locked, no key held' })]),
    AT,
  );

  it('says so on the page rather than printing a dash', () => {
    /*
     * It printed an em dash, which reads as nothing to report. "Not tested" is
     * a stated outcome in this app with a required reason — an inaccessible
     * device is the commonest real result on an annual, and recording it apart
     * from a pass is the whole point.
     */
    expect(html()).toContain('NOT TESTED');
    expect(html()).not.toContain('>—<');
  });

  it('is marked to be looked at rather than greyed out', () => {
    /*
     * The style was grey text on a grey ground — the least visible cell on the
     * page, for the outcome that most needs looking at, while N/A beside it was
     * amber. So a device that was not applicable stood out and a device nobody
     * could get to did not.
     */
    const css = html().slice(0, html().indexOf('</style>'));
    const rule = css.slice(css.indexOf('.untested'), css.indexOf('}', css.indexOf('.untested')));
    expect(rule).toContain('#FFF3CD');
    expect(rule).toContain('font-weight: 700');
    expect(rule).not.toContain('#888');
  });

  it('carries the reason through to the page', () => {
    // A coverage gap with no reason beside it is one nobody can act on.
    expect(html()).toContain('Locked, no key held');
  });

  it('counts what was tested beside how many were on the sheet', () => {
    // The two are the same number only on a job where nothing was locked, and
    // a reader with only the first will take it for the second.
    const out = html();
    expect(out).toMatch(/Devices<\/div><div class="v">2</);
    expect(out).toMatch(/Tested<\/div><div class="v">1</);
    expect(out).toMatch(/Not tested<\/div><div class="v">1</);
  });
});

describe('the Queensland record of maintenance', () => {
  const statutory = (over: Partial<StatutoryRecord> = {}): StatutoryRecord => ({
    qdcCompliance: false, inProperWorkingOrder: null, hardcopyLeftOnSite: false, ...over,
  });

  it('does not turn an untouched checkbox into a No', () => {
    /*
     * Both of these come off an unticked box on the report screen — the
     * technician's action is to tick and affirm, and no control anywhere
     * records an explicit "No". Printing one made an untouched box into a
     * positive assertion of non-compliance with QDC MP 6.1, on a record an
     * inspector reads, that nobody made.
     *
     * The row between them already got this right, and its own comment says
     * why: not yet answered is different from no.
     */
    const out = serviceReportHtml(bundle([testRow('pass')]), AT, statutory());
    expect(out).toMatch(/Complied with QDC MP 6\.1<\/td><td>Not stated/);
    expect(out).toMatch(/Hardcopy left on site<\/td><td>Not stated/);
    expect(out).toMatch(/In proper working order<\/td>\s*<td>Not stated/);
  });

  it('says Yes where the technician did affirm it', () => {
    const out = serviceReportHtml(bundle([testRow('pass')]), AT,
      statutory({ qdcCompliance: true, inProperWorkingOrder: true, hardcopyLeftOnSite: true }));
    expect(out).toMatch(/Complied with QDC MP 6\.1<\/td><td>Yes/);
    expect(out).toMatch(/In proper working order<\/td>\s*<td>Yes/);
    expect(out).toMatch(/Hardcopy left on site<\/td><td>Yes/);
  });

  it('still prints an explicit No where one was actually given', () => {
    // The three-state row is the one that can carry a real refusal, and it has
    // to keep carrying it.
    const out = serviceReportHtml(bundle([testRow('pass')]), AT,
      statutory({ inProperWorkingOrder: false }));
    expect(out).toMatch(/In proper working order<\/td>\s*<td>No/);
  });

  it('is left off entirely where no statutory record was asked for', () => {
    expect(serviceReportHtml(bundle([testRow('pass')]), AT)).not.toContain('Record of maintenance');
  });
});

describe('what the page says about the site and the work', () => {
  it('prints the job number, the job\'s customer and the site contact', () => {
    /*
     * All three were stored on the report and shown on the screen and never
     * on the page: the office got a document with no number to file it by,
     * printing the site's client rather than the customer the technician had
     * just accepted from the job. The job's customer outranks the site's, and
     * it is printed once, so the document does not show two names.
     */
    const numbered: ServiceReport = {
      ...report, jobNumber: '43747', customerName: 'Example Managing Agent',
      siteContactName: 'A Manager', siteContactPhone: '0400 000 000',
    };
    const out = serviceReportHtml({ ...bundle([testRow('pass')]), report: numbered }, AT);
    expect(out).toMatch(/Customer job no\.<\/td><td>43747/);
    expect(out).toContain('Customer Job No. 43747');
    expect(out).toMatch(/Client<\/td><td>Example Managing Agent/);
    expect(out).not.toContain('Example Body Corporate');
    expect(out).toMatch(/Site contact<\/td><td>A Manager · 0400 000 000/);
  });

  it('leaves the job number off rather than printing it blank, and falls back to the site\'s client', () => {
    const out = serviceReportHtml(bundle([testRow('pass')]), AT);
    expect(out).not.toContain('Customer job no.');
    expect(out).not.toContain('Site contact');
    expect(out).toMatch(/Client<\/td><td>Example Body Corporate/);
  });

  it('dates the service in Australian order', () => {
    expect(serviceReportHtml(bundle([testRow('pass')]), AT)).toContain('03/07/2026');
  });

  it('escapes what somebody typed rather than rendering it', () => {
    // A device text is free text off a panel, and a panel can hold anything.
    const out = serviceReportHtml(bundle([testRow('pass', { deviceText: '<script>x</script>' })]), AT);
    expect(out).not.toContain('<script>x');
    expect(out).toContain('&lt;script&gt;');
  });

  it('says the sheet is empty rather than printing an empty table', () => {
    const out = serviceReportHtml(bundle([]), AT);
    expect(out).toContain('No devices were added to this test sheet');
  });

  it('shouts about a critical defect and dates it by the Queensland day', () => {
    const defect: Defect = {
      id: 'd1', siteId: 's1', location: 'Level 2 lift lobby', description: 'Detector missing',
      severity: 'critical', status: 'open', raisedAt: '2026-07-02T22:30:00.000Z', photos: [],
    };
    const out = serviceReportHtml(bundle([testRow('pass')], [defect]), AT);
    expect(out).toContain('CRITICAL');
    // 22:30 UTC is half past eight the next morning in Brisbane, and both
    // statutory clocks run from the day on this row.
    expect(out).toContain('03/07/2026');
  });
});
