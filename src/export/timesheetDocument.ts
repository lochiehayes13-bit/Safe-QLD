import {
  LEAVE_LABEL, entryHours, groupByDate, leaveOf, timesheetTotals, weekSummary,
  type Timesheet, type TimesheetEntry,
} from '@/domain/timesheet';
import { letterheaded } from './letterhead';
import { formatAuDate } from './sheets';

/**
 * The week's timesheet as something a person can read on a phone.
 *
 * The workbook is the document payroll works from and it is the right shape
 * for that: fifteen columns, one row per job, formulas the office can audit.
 * It is the wrong shape for everything else. Opened on a handset — which is
 * where it is read, because it arrives by email and the person who filled it
 * in has no desk — fifteen columns are a grid of cells too small to read,
 * scrolled sideways, with the headings off the left edge.
 *
 * Thirteen other documents in this app are produced as a page. The timesheet
 * was the only one that existed solely as a spreadsheet, so the one document
 * everybody checks every week was the one nobody could read.
 *
 * This is the same week, laid out down the page instead of across it: a day is
 * a block, a job is a line inside it, and the totals that payroll acts on are
 * at the top where somebody checking their pay looks first. Every figure comes
 * from the same domain functions the workbook uses — timesheetTotals,
 * weekSummary, entryHours — so the two cannot disagree. It is a reading copy,
 * not a second source of truth, and it says so.
 */

function esc(s: string | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Hours as payroll writes them: 8, 7.5, never 8.00 and never 7.4999. */
function hrs(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/**
 * The page's own stylesheet.
 *
 * One column, sized for a 360 point handset and still right on A4 — which is
 * what a page laid out down rather than across gets for free. No table wider
 * than the text, because a table that needs sideways scrolling is the problem
 * this document exists to solve.
 */
const CSS = `
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.45; color: #1b1b1b; }
  h1 { font-size: 15pt; margin: 0 0 2px; letter-spacing: -0.2px; }
  .sub { color: #555; font-size: 10pt; margin-bottom: 10px; }
  .who { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 10pt;
    margin: 0 0 12px; padding-bottom: 10px; border-bottom: 1px solid #d8d8d8; }
  .who b { font-weight: 700; }

  /* The figures payroll acts on, at the top, because that is what somebody
     checking their own pay opens this for. */
  .totals { border: 1px solid #c9d3e4; border-radius: 4px; padding: 8px 10px;
    margin-bottom: 14px; background: #f6f8fc; break-inside: avoid; }
  .totals .grand { font-size: 13pt; font-weight: 800; color: #1F3864; }
  .totals ul { list-style: none; margin: 6px 0 0; padding: 0;
    display: flex; flex-wrap: wrap; gap: 2px 16px; font-size: 10pt; }
  .totals li span { color: #555; }

  .day { break-inside: avoid; margin-bottom: 10px; padding-bottom: 8px;
    border-bottom: 1px solid #e8e8e8; }
  .day:last-of-type { border-bottom: 0; }
  .dayhead { display: flex; align-items: baseline; gap: 8px; }
  .dayhead .name { font-weight: 800; }
  .dayhead .date { color: #666; font-size: 9.5pt; flex: 1; }
  .dayhead .tot { font-weight: 800; font-variant-numeric: tabular-nums; }
  .weekend .name, .weekend .date { color: #888; }

  .job { margin: 5px 0 0 0; padding-left: 10px; border-left: 2px solid #e2e6ee; }
  .job .line1 { display: flex; align-items: baseline; gap: 8px; }
  .job .site { font-weight: 700; flex: 1; }
  .job .h { font-variant-numeric: tabular-nums; font-weight: 700; }
  .job .line2 { color: #555; font-size: 9.5pt; }
  .job .note { color: #333; font-size: 9.5pt; margin-top: 2px; }
  .kind { font-size: 8.5pt; font-weight: 700; color: #8a4b00; }
  .leave { font-size: 9.5pt; font-weight: 700; color: #8a4b00; padding-left: 10px; }
  .nothing { color: #999; font-size: 9.5pt; padding-left: 10px; font-style: italic; }

  .sign { margin-top: 16px; padding-top: 10px; border-top: 1px solid #d8d8d8;
    display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 10pt; break-inside: avoid; }
  .sign div { min-width: 150px; }
  .sign .rule { border-bottom: 1px solid #999; height: 22px; margin-top: 2px; }
  .sig { max-height: 44px; max-width: 150px; display: block; margin-top: 2px; }
  .note { margin-top: 12px; color: #666; font-size: 8.5pt; line-height: 1.4; }
`;

/** What a job line says about the hours on it, where it is not ordinary time. */
const KIND_LABEL: Record<string, string> = { ot: 'Overtime', dt: 'Double time' };

function jobLine(entry: TimesheetEntry): string {
  const hours = entryHours(entry);
  const detail: string[] = [];
  if (entry.jobNumber.trim()) detail.push(`Job ${esc(entry.jobNumber.trim())}`);
  if (entry.startTime.trim() && entry.finishTime.trim()) {
    detail.push(`${esc(entry.startTime.trim())}–${esc(entry.finishTime.trim())}`);
  }
  if (entry.serviceReportNumber.trim()) detail.push(`Report ${esc(entry.serviceReportNumber.trim())}`);
  for (const extra of entry.extras ?? []) if (extra.trim()) detail.push(esc(extra.trim()));

  const kind = KIND_LABEL[entry.hourKind];
  return `<div class="job">
    <div class="line1">
      <span class="site">${entry.siteName.trim() ? esc(entry.siteName.trim()) : 'Untitled job'}</span>
      ${kind ? `<span class="kind">${esc(kind)}</span>` : ''}
      <span class="h">${hrs(hours)} h</span>
    </div>
    ${detail.length ? `<div class="line2">${detail.join(' · ')}</div>` : ''}
    ${entry.comments.trim() ? `<div class="note">${esc(entry.comments.trim())}</div>` : ''}
  </div>`;
}

/**
 * A day, whether or not anything is on it.
 *
 * Seven days always, for the reason weekSummary gives: a week drawn from only
 * the days with entries hides the Thursday nobody filled in, and it is the
 * missing day rather than the recorded ones that costs somebody a day's pay.
 */
function dayBlock(
  summary: ReturnType<typeof weekSummary>[number],
  entries: TimesheetEntry[],
): string {
  const jobs = entries.filter((e) => !leaveOf(e));
  const leave = summary.leave;
  return `<div class="day${summary.weekend ? ' weekend' : ''}">
    <div class="dayhead">
      <span class="name">${esc(summary.day)}</span>
      <span class="date">${esc(formatAuDate(summary.date))}</span>
      <span class="tot">${summary.total ? `${hrs(summary.total)} h` : '—'}</span>
    </div>
    ${leave ? `<div class="leave">${esc(LEAVE_LABEL[leave.kind])} — ${hrs(leave.hours)} h</div>` : ''}
    ${jobs.map(jobLine).join('')}
    ${!jobs.length && !leave
    ? `<div class="nothing">${summary.weekend ? 'Not worked.' : 'Nothing recorded.'}</div>`
    : ''}
  </div>`;
}

/** The week's figures, as the sheet that goes to payroll adds them up. */
function totalsBlock(sheet: Timesheet): string {
  const t = timesheetTotals(sheet);
  const parts: [string, number][] = [
    ['Ordinary', t.ord],
    ['Overtime', t.ot],
    ['Double time', t.dt],
    ['Annual leave', t.annual],
    ['Sick', t.sick],
    ['RDO', t.rdo],
    ['Public holiday', t.publicHoliday],
    ['Unpaid leave', t.lwop],
  ];
  return `<div class="totals">
    <div class="grand">${hrs(t.grand)} hours for the week</div>
    <ul>${parts
    .filter(([, v]) => v > 0)
    .map(([label, v]) => `<li><span>${esc(label)}</span> <b>${hrs(v)}</b></li>`)
    .join('')}</ul>
  </div>`;
}

/**
 * The timesheet as a page.
 *
 * A leave day is named by its own line from LEAVE_LABEL and a worked line by
 * its site, so a day holding both appears as both — which is the mistake it is
 * and worth seeing rather than resolving away.
 */
export function timesheetDocumentHtml(sheet: Timesheet): string {
  const week = weekSummary(sheet);
  const byDate = new Map(groupByDate(sheet.entries).map((g) => [g.date, g.entries]));

  const who: string[] = [];
  if (sheet.employeeName.trim()) who.push(`<span><b>${esc(sheet.employeeName.trim())}</b></span>`);
  if (sheet.vehicleRego.trim()) who.push(`<span>Vehicle ${esc(sheet.vehicleRego.trim())}</span>`);
  if (sheet.kilometerReading.trim()) who.push(`<span>${esc(sheet.kilometerReading.trim())} km</span>`);

  const body = `
  <h1>Timesheet — week beginning ${esc(formatAuDate(sheet.weekStarting))}</h1>
  <div class="sub">${sheet.status === 'submitted' ? 'Submitted' : 'Draft'}</div>
  ${who.length ? `<div class="who">${who.join('')}</div>` : ''}
  ${totalsBlock(sheet)}
  ${week.map((d) => dayBlock(d, byDate.get(d.date) ?? [])).join('')}
  <div class="sign">
    <div>
      Employee
      ${sheet.employeeSignature
    ? `<img class="sig" src="${esc(sheet.employeeSignature)}" alt="" />`
    : '<div class="rule"></div>'}
    </div>
    <div>Checked by${sheet.checkedBy.trim()
    ? `<div><b>${esc(sheet.checkedBy.trim())}</b></div>`
    : '<div class="rule"></div>'}</div>
    <div>Manager${sheet.managerName.trim()
    ? `<div><b>${esc(sheet.managerName.trim())}</b></div>`
    : '<div class="rule"></div>'}</div>
  </div>
  <div class="note">
    A reading copy of the week, for checking on a phone. The spreadsheet emailed with it is the
    one payroll works from; every figure here is the same figure, added up the same way.
  </div>`;

  return letterheaded({
    title: `Timesheet ${sheet.weekStarting}`,
    css: CSS,
    body,
  });
}
