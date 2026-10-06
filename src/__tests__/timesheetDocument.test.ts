/**
 * The timesheet as a page, for reading on a phone.
 *
 * The owner's words: "Looks good on excel, but a little bit shitty to look at
 * via mobile. Fit it all." The workbook is fifteen columns, which is right for
 * payroll and unreadable on the handset it arrives on — and the timesheet was
 * the only document in this app with no page form at all, so the one document
 * everybody checks every week was the one nobody could read.
 *
 * What matters here is that it is a reading copy and not a second source of
 * truth. Every figure has to be the figure the workbook sends, added up by the
 * same domain function, or the two documents in one email disagree about
 * somebody's pay. So the assertions below compare it against
 * `timesheetTotals`, `weekSummary` and `entryHours` rather than against
 * numbers typed into this file.
 */
import { timesheetDocumentHtml } from '@/export/timesheetDocument';
import { timesheetGeometry, timesheetSheet } from '@/export/safeqldForms';
import type { FormulaCell } from '@/export/xlsx';
import {
  setLeave, timesheetTotals, weekSummary, type Timesheet, type TimesheetEntry,
} from '@/domain/timesheet';

const entry = (over: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  id: 'a', date: '2026-08-12', jobNumber: '43747', siteName: 'Kingaroy Fire Station',
  serviceReportNumber: '', startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
  sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: '', ...over,
});

const sheet = (entries: TimesheetEntry[], over: Partial<Timesheet> = {}): Timesheet => ({
  id: 't1', employeeName: 'L. Hayes', vehicleRego: 'ABC123', kilometerReading: '120450',
  weekStarting: '2026-08-10', entries, managerName: '', checkedBy: '', status: 'draft',
  createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', ...over,
});

/** The page's words with its markup taken out, which is what a reader sees. */
const text = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x2013;|&ndash;/g, '–')
    .replace(/\s+/g, ' ').trim();

describe('the week on a page', () => {
  const week = sheet([
    entry({ date: '2026-08-10', siteName: 'Kingaroy Fire Station', startTime: '06:30', finishTime: '14:30' }),
    entry({ id: 'b', date: '2026-08-11', siteName: 'Baldwin Living', startTime: '07:00', finishTime: '15:30', jobNumber: '43801' }),
    entry({ id: 'c', date: '2026-08-11', siteName: 'Wynnum Depot', startTime: '15:30', finishTime: '17:30', hourKind: 'ot', jobNumber: '43802' }),
  ]);
  const html = timesheetDocumentHtml(week);

  it('prints all seven days, including the ones nobody filled in', () => {
    /*
     * The reason weekSummary gives for seven rows applies twice over here: it
     * is the Thursday nobody filled in that costs somebody a day's pay, and a
     * page that showed only the days with work on them would hide it.
     */
    for (const day of weekSummary(week)) {
      expect({ day: day.day, shown: text(html).includes(day.day) })
        .toEqual({ day: day.day, shown: true });
    }
  });

  it('says what an empty weekday is, rather than leaving a gap', () => {
    expect(text(html)).toContain('Nothing recorded');
  });

  it('says a weekend was not worked, in its own words', () => {
    expect(text(html)).toContain('Not worked');
  });

  it('names every job on the week', () => {
    for (const e of week.entries) expect(text(html)).toContain(e.siteName);
  });

  it('carries each job’s own hours, start and finish', () => {
    expect(text(html)).toContain('06:30');
    expect(text(html)).toContain('14:30');
    expect(text(html)).toContain('Job 43747');
  });

  it('marks overtime on the line it belongs to, not on the day', () => {
    expect(html).toContain('<span class="kind">Overtime</span>');
    // Ordinary time is the default and no job line says it, or every line
    // would. The totals block names it, which is a different statement.
    const jobs = html.match(/<div class="job">[\s\S]*?<\/div>\s*<\/div>/g) ?? [];
    expect(jobs.length).toBe(3);
    for (const job of jobs) expect(job).not.toContain('class="kind">Ordinary');
  });
});

describe('the figures, which must be the workbook’s figures', () => {
  const week = sheet([
    entry({ date: '2026-08-10', startTime: '06:30', finishTime: '14:30' }),
    entry({ id: 'b', date: '2026-08-11', startTime: '07:00', finishTime: '17:00', hourKind: 'ot' }),
    setLeave(entry({ id: 'c', date: '2026-08-12', startTime: '', finishTime: '' }), 'annual', 8),
    setLeave(entry({ id: 'd', date: '2026-08-13', startTime: '', finishTime: '' }), 'publicHoliday', 8),
  ]);
  const html = timesheetDocumentHtml(week);
  const totals = timesheetTotals(week);

  it('leads with the grand total, because that is what somebody opens it for', () => {
    expect(html).toContain(`<div class="grand">${totals.grand} hours for the week</div>`);
  });

  it('breaks the week into the same buckets the workbook does', () => {
    const shown = text(html);
    for (const [label, value] of [
      ['Ordinary', totals.ord], ['Overtime', totals.ot],
      ['Annual leave', totals.annual], ['Public holiday', totals.publicHoliday],
    ] as [string, number][]) {
      expect({ label, shown: shown.includes(`${label} ${value}`) })
        .toEqual({ label, shown: true });
    }
  });

  it('leaves out a bucket with nothing in it', () => {
    // Eight categories printed as zeroes is eight things to read past.
    expect(totals.dt).toBe(0);
    expect(text(html)).not.toContain('Double time');
  });

  it('totals each day as weekSummary totals it', () => {
    for (const day of weekSummary(week)) {
      if (!day.total) continue;
      expect({ day: day.day, shown: text(html).includes(`${day.total} h`) })
        .toEqual({ day: day.day, shown: true });
    }
  });

  it('names a leave day by its kind and its hours', () => {
    expect(text(html)).toContain('Annual leave — 8 h');
    expect(text(html)).toContain('Public holiday — 8 h');
  });

  it('agrees with the workbook it is emailed beside', () => {
    /*
     * The one thing that must never drift: two documents in one email
     * disagreeing about a week's pay is worse than having only the unreadable
     * one.
     *
     * They cannot be compared figure to figure, and deliberately — the
     * workbook's totals row is live =SUM() formulas over its own entry rows,
     * so payroll can audit the addition rather than take ours. What is
     * checkable is that both are adding up the same week: the formulas span
     * exactly the rows timesheetGeometry says hold the entries, and the page's
     * buckets come from timesheetTotals over the same entries.
     */
    const { first, last, totals: totalsRow } = timesheetGeometry(week);
    const row = timesheetSheet(week).rows[totalsRow - 1]!;
    const formulas = row
      .filter((c): c is FormulaCell => !!c && typeof c === 'object' && 'f' in c)
      .map((c) => c.f);
    expect(formulas.length).toBeGreaterThan(0);
    for (const f of formulas) {
      expect({ f, spansTheWeek: f.includes(`${first}:`) && f.includes(`${last})`) })
        .toEqual({ f, spansTheWeek: true });
    }

    // And the page's own total is the domain's, not a second addition.
    expect(html).toContain(`${totals.grand} hours for the week`);
    expect(totals.grand).toBe(totals.worked + totals.annual + totals.sick
      + totals.rdo + totals.publicHoliday + totals.lwop);
  });
});

describe('what it says about itself', () => {
  it('says the spreadsheet is the one payroll works from', () => {
    // It is a reading copy. Presenting it as the record payroll acts on would
    // invite somebody to correct the wrong document.
    expect(text(timesheetDocumentHtml(sheet([entry()]))))
      .toContain('the one payroll works from');
  });

  it('says a week is submitted, and says nothing about one that is not', () => {
    /*
     * It used to print "Draft" under the title of every sheet that was not yet
     * submitted — which is the copy that lands in payroll's inbox, because the
     * sheet is marked submitted only after the mail app reports the email
     * went, and the attachment was built before that. So the one document the
     * office reads announced itself as not to be acted on, every time, while
     * the workbook beside it carried no status at all.
     *
     * It cannot be rendered as submitted instead: on the web the send is
     * handed to a mail app that cannot report back, the sheet stays a draft on
     * purpose, and a page claiming otherwise would be worse. So the positive
     * fact prints and the other says nothing — a sheet still being filled in
     * says so by what is on it.
     */
    expect(text(timesheetDocumentHtml(sheet([entry()])))).not.toContain('Draft');
    expect(text(timesheetDocumentHtml(sheet([entry()], { status: 'submitted' }))))
      .toContain('Submitted');
  });

  it('still shows the blank days and the unsigned rule, which is what says it is unfinished', () => {
    const html = timesheetDocumentHtml(sheet([entry()]));
    expect(text(html)).toContain('Nothing recorded');
    expect(html).toContain('class="rule"');
  });

  it('names the week by its first day, in the only date format this app prints', () => {
    // formatAuDate pads, so the tenth of August is 10/08/2026.
    expect(text(timesheetDocumentHtml(sheet([entry()])))).toContain('week beginning 10/08/2026');
  });
});

describe('fitting a phone', () => {
  const html = timesheetDocumentHtml(sheet([
    entry({ comments: 'Booster valve seized, parts ordered. Returning Thursday to refit.' }),
  ]));

  it('lays nothing out across the page', () => {
    /*
     * This is the whole point. The workbook is fifteen columns because payroll
     * reads it on a monitor; a page with a wide table in it would be the same
     * sideways scroll in a different file. So: no table, and no flex row that
     * cannot wrap.
     */
    expect(html).not.toContain('<table');
    const rows = html.match(/display:\s*flex[^;}]*/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const style of ['.who', '.totals ul', '.sign']) {
      const block = html.slice(html.indexOf(style));
      expect({ style, wraps: block.slice(0, 200).includes('flex-wrap: wrap') })
        .toEqual({ style, wraps: true });
    }
  });

  it('keeps a day from breaking across a page', () => {
    expect(html).toContain('.day { break-inside: avoid');
  });

  it('prints a comment in full rather than truncating it', () => {
    // The column every payroll query is about, and the one the workbook pushes
    // onto page two.
    expect(text(html)).toContain('Booster valve seized, parts ordered. Returning Thursday to refit.');
  });

  it('is one page of HTML with the company letterhead, like every other document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('@page');
  });
});

describe('a sheet with nothing on it', () => {
  const html = timesheetDocumentHtml(sheet([]));

  it('still prints the week, so an empty sheet reads as empty rather than broken', () => {
    expect(text(html)).toContain('week beginning');
    expect(text(html)).toContain('0 hours for the week');
    for (const day of weekSummary(sheet([]))) {
      expect(text(html)).toContain(day.day);
    }
  });

  it('leaves the signature lines blank rather than omitting them', () => {
    expect((html.match(/class="rule"/g) ?? []).length).toBe(3);
  });
});
