import { SYSTEM_COLUMNS, SYSTEM_LABEL, type RegisterSystem } from '@/parsers/assetRegister';
import { letterheaded } from './letterhead';
import { formatAuDate } from './sheets';

/**
 * The routine service report, in the format Safe QLD already issues.
 *
 * This is the document the client actually sees — they never see the app — so
 * it is modelled on a real issued report rather than designed fresh. The column
 * headings come from the same table the register importer uses, so a report
 * cannot disagree with the register it was built from: a client who has to
 * reconcile the two by hand has been given work, not a record.
 *
 * Deliberately not improved. The issued report has no summary and no failure
 * count, which means a ninety-nine page document can carry forty-nine failures
 * without saying so anywhere. That is a real weakness and it belongs in the app,
 * where a technician can act on it — not in a document whose format the client
 * has already accepted and reads by habit.
 */

function esc(s: string | number | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type RoutineResult = 'pass' | 'fail' | 'na' | 'not-tested';

export interface ReportParty {
  name?: string;
  address?: string;
  contact?: string;
  mobile?: string;
  email?: string;
}

export interface RoutineReportAsset {
  /** The number written on the asset's own tag. */
  assetNumber?: string;
  location?: string;
  /** Type and size, as the register records it. */
  descriptor?: string;
  /** Last overhaul or pressure test, verbatim — the source is often imprecise. */
  overhaul?: string;
  /** ISO date the work was done. */
  date?: string;
  result: RoutineResult;
  /** Required when the result is not-tested; there is no column for it. */
  notTestedReason?: string;
  testNotes?: string;
  notes?: string;
}

export interface RoutineReportSection {
  system: RegisterSystem;
  assets: RoutineReportAsset[];
}

export interface RoutineReportInput {
  jobNumber?: string;
  customer: ReportParty;
  site: ReportParty;
  workRequested?: string;
  /** ISO date. */
  datePerformed?: string;
  sections: RoutineReportSection[];
  technicianName?: string;
  /** Data URI of a captured signature. */
  technicianSignature?: string;
  declaration?: string;
}

/** The wording on the issued report, above the technician's signature. */
export const DEFAULT_DECLARATION =
  'The above works have been supplied and installed as per relevant standards.';

/**
 * How a result reads on the report.
 *
 * The issued document has three values. The app carries a fourth — an asset
 * that could not be tested, with a reason — because an inaccessible device is
 * the commonest real outcome on an annual and calling it a pass hides a
 * coverage gap. On this document it reads as N/A, which is the honest match,
 * and the reason goes into the notes rather than being dropped.
 */
export function resultText(result: RoutineResult): string {
  switch (result) {
    case 'pass': return 'Pass';
    case 'fail': return 'Fail';
    default: return 'N/A';
  }
}

function resultClass(result: RoutineResult): string {
  return result === 'pass' ? 'pass' : result === 'fail' ? 'fail' : 'na';
}

/** Test notes, with the not-tested reason folded in where there is one. */
export function notesFor(asset: RoutineReportAsset): string {
  const reason = asset.result === 'not-tested' && asset.notTestedReason
    ? `Not tested: ${asset.notTestedReason}`
    : undefined;
  return [reason, asset.testNotes].filter(Boolean).join(' — ');
}

const CSS = `
  @page { size: A4; margin: 12mm 10mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
         color: #111; font-size: 10px; line-height: 1.35; margin: 0; }
  .jobno { text-align: right; font-weight: 700; font-size: 11px; letter-spacing: 0.4px;
           text-transform: uppercase; margin-bottom: 8px; }
  .parties { display: flex; gap: 10px; margin-bottom: 10px; }
  .party { flex: 1; }
  .party h3 { font-size: 10.5px; margin: 0 0 3px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #BFC5CB; padding: 3px 5px; text-align: left; vertical-align: top; }
  .party td:first-child { width: 62px; font-weight: 600; background: #F2F4F6; }
  .work { margin-bottom: 12px; }
  .work td:first-child { width: 62px; font-weight: 600; background: #F2F4F6; }
  .work .when { width: 130px; font-weight: 600; background: #F2F4F6; text-align: right; }
  h2 { font-size: 11px; margin: 14px 0 4px; font-weight: 700; }
  /* A long system runs over pages; the headings have to come with it. */
  thead { display: table-header-group; }
  .assets th { background: #E8EBEE; font-weight: 700; font-size: 9px; }
  .assets .n { width: 58px; }
  .assets .d { width: 74px; }
  .assets .r { width: 52px; text-align: center; font-weight: 700; }
  /* An asset and its notes must never be split across a page. */
  .asset { page-break-inside: avoid; }
  .notes td { background: #FAFBFC; font-size: 9px; }
  .notes .k { width: 74px; font-weight: 600; }
  .pass { background: #D9EAD9; }
  .fail { background: #F5D5D5; }
  .na   { background: #FBF0D0; }
  .signoff { margin-top: 22px; page-break-inside: avoid; }
  .signoff .decl { margin-bottom: 14px; }
  .sigrow { display: flex; gap: 30px; max-width: 460px; }
  .sigbox { flex: 1; }
  .sigbox img { max-height: 54px; max-width: 100%; display: block; }
  .sigline { border-top: 1px solid #333; padding-top: 3px; font-size: 9px; color: #555; }
  .empty { color: #777; font-style: italic; }
`;

function partyTable(title: string, p: ReportParty): string {
  const row = (k: string, v?: string) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`;
  return `
    <div class="party">
      <h3>${esc(title)}</h3>
      <table>
        ${row('Name', p.name)}
        ${row('Address', p.address)}
        ${row('Contact', p.contact)}
        ${row('Mobile', p.mobile)}
        ${row('Email', p.email)}
      </table>
    </div>`;
}

function sectionHtml(section: RoutineReportSection): string {
  const columns = SYSTEM_COLUMNS[section.system] ?? SYSTEM_COLUMNS.unknown;
  const label = SYSTEM_LABEL[section.system] ?? SYSTEM_LABEL.unknown;
  const hasOverhaul = Boolean(columns.overhaul);
  const span = hasOverhaul ? 6 : 5;

  if (!section.assets.length) {
    return `<h2>${esc(label)}</h2><p class="empty">No assets recorded for this system.</p>`;
  }

  const rows = section.assets.map((a) => {
    const testNotes = notesFor(a);
    return `
      <tbody class="asset">
        <tr>
          <td class="n">${esc(a.assetNumber)}</td>
          <td>${esc(a.location)}</td>
          <td>${esc(a.descriptor)}</td>
          ${hasOverhaul ? `<td>${esc(a.overhaul)}</td>` : ''}
          <td class="d">${esc(formatAuDate(a.date))}</td>
          <td class="r ${resultClass(a.result)}">${esc(resultText(a.result))}</td>
        </tr>
        <tr class="notes">
          <td class="k">Test Notes</td>
          <td colspan="${span - 1}">${esc(testNotes)}</td>
        </tr>
        <tr class="notes">
          <td class="k">Notes:</td>
          <td colspan="${span - 1}">${esc(a.notes)}</td>
        </tr>
      </tbody>`;
  }).join('');

  return `
    <h2>${esc(label)}</h2>
    <table class="assets">
      <thead>
        <tr>
          <th class="n">${esc(columns.assetNumber)}</th>
          <th>Location</th>
          <th>${esc(columns.descriptor)}</th>
          ${hasOverhaul ? `<th>${esc(columns.overhaul)}</th>` : ''}
          <th class="d">Date</th>
          <th class="r">Result</th>
        </tr>
      </thead>
      ${rows}
    </table>`;
}

export function routineServiceReportHtml(input: RoutineReportInput): string {
  const sections = input.sections.map(sectionHtml).join('');
  const signature = input.technicianSignature
    ? `<img src="${esc(input.technicianSignature)}" alt="" />`
    : '';

  return letterheaded({
    title: `Routine Service Report — ${input.site.name ?? 'Safe QLD'}`,
    css: CSS,
    body: `
    ${input.jobNumber ? `<div class="jobno">Customer Job No. ${esc(input.jobNumber)}</div>` : ''}
    <div class="parties">
      ${partyTable('Customer Details', input.customer)}
      ${partyTable('Site Details', input.site)}
    </div>
    <table class="work">
      <tr>
        <td>Work Requested</td>
        <td>${esc(input.workRequested)}</td>
        <td class="when">Date Performed</td>
        <td style="width:90px">${esc(formatAuDate(input.datePerformed))}</td>
      </tr>
    </table>
    ${sections}
    <div class="signoff">
      <div class="decl">${esc(input.declaration ?? DEFAULT_DECLARATION)}</div>
      <div class="sigrow">
        <div class="sigbox">
          <div style="height:54px">${esc(input.technicianName)}</div>
          <div class="sigline">Print Name</div>
        </div>
        <div class="sigbox">
          <div style="height:54px">${signature}</div>
          <div class="sigline">Signature</div>
        </div>
      </div>
    </div>`,
  });
}

/**
 * What the report does not say.
 *
 * The issued format carries no summary, so this is offered alongside for the
 * app to show. A ninety-nine page report with forty-nine failures in it looks
 * the same as one with none until somebody reads every page.
 */
export interface RoutineReportTally {
  total: number;
  pass: number;
  fail: number;
  na: number;
  notTested: number;
  /** Assets recorded as not tested without a reason, which is an incomplete record. */
  missingReason: number;
}

export function tallyReport(input: RoutineReportInput): RoutineReportTally {
  const assets = input.sections.flatMap((s) => s.assets);
  return {
    total: assets.length,
    pass: assets.filter((a) => a.result === 'pass').length,
    fail: assets.filter((a) => a.result === 'fail').length,
    na: assets.filter((a) => a.result === 'na').length,
    notTested: assets.filter((a) => a.result === 'not-tested').length,
    missingReason: assets.filter((a) => a.result === 'not-tested' && !a.notTestedReason).length,
  };
}
