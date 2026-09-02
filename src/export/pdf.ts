import type { CauseEffectRule, Panel, TestRow } from '@/domain/types';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { formatAuDate, matrixColumns, type ReportBundle } from './sheets';

/**
 * HTML report templates rendered to PDF by expo-print.
 *
 * Styling is deliberately print-first: white background, black text, no
 * dependence on the app's dark theme, and page-break rules so a 400-device test
 * sheet prints with repeating table headers rather than orphaned rows.
 */

function esc(s: string | number | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BASE_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111; font-size: 10.5px; line-height: 1.45; margin: 0;
  }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.2px; }
  h2 { font-size: 13px; margin: 20px 0 6px; padding-bottom: 4px;
       border-bottom: 1.5px solid #C92A2A; text-transform: uppercase; letter-spacing: 0.6px; }
  .sub { color: #666; font-size: 11px; margin-bottom: 14px; }
  .brandbar { height: 4px; background: #C92A2A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th, td { border: 1px solid #D5D8DC; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #333F50; color: #fff; font-weight: 600; font-size: 9.5px;
       text-transform: uppercase; letter-spacing: 0.4px; }
  /* Repeat headers when a long table breaks across pages. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .meta td:first-child { width: 30%; background: #F4F6F8; font-weight: 600; }
  .num { text-align: right; }
  .pass { background: #D4EDDA; font-weight: 700; text-align: center; }
  .fail { background: #F8D7DA; font-weight: 700; text-align: center; }
  .na   { background: #FFF3CD; text-align: center; }
  /*
   * Not tested is the cell that most needs looking at, and it was the least
   * visible thing on the page: grey text on a grey ground, holding an em dash.
   * N/A beside it was amber. So a device that was not applicable stood out and
   * a device nobody could get to did not.
   *
   * Amber and bold now. It is not a failure and it is not a pass; it is the
   * row somebody has to go back to, and it is louder than N/A because N/A is a
   * finished answer and this one is not.
   */
  .untested { background: #FFF3CD; text-align: center; font-weight: 700; color: #664D03; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 9px;
          font-weight: 700; letter-spacing: 0.3px; }
  .pill.crit { background: #F8D7DA; color: #842029; }
  .pill.non  { background: #FFF3CD; color: #664D03; }
  .stats { display: flex; gap: 8px; margin: 10px 0 4px; }
  .stat { flex: 1; border: 1px solid #D5D8DC; border-radius: 5px; padding: 7px 9px; }
  .stat .k { font-size: 8.5px; text-transform: uppercase; color: #666; letter-spacing: 0.5px; }
  .stat .v { font-size: 17px; font-weight: 700; }
  .sig { margin-top: 26px; page-break-inside: avoid; }
  .sigrow { display: flex; gap: 26px; }
  .sigbox { flex: 1; }
  .sigbox img { max-height: 62px; max-width: 100%; display: block; margin-bottom: 2px; }
  .sigline { border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .photos img { width: 30%; border: 1px solid #D5D8DC; border-radius: 3px; }
  .footer { margin-top: 22px; padding-top: 7px; border-top: 1px solid #D5D8DC;
            color: #888; font-size: 8.5px; display: flex; justify-content: space-between; }
  .empty { color: #888; font-style: italic; padding: 6px 0; }
`;

function resultClass(r: TestRow['result']): string {
  return r === 'pass' ? 'pass' : r === 'fail' ? 'fail' : r === 'na' ? 'na' : 'untested';
}

function resultText(r: TestRow['result']): string {
  /*
   * "NOT TESTED", not a dash.
   *
   * A dash reads as nothing to report. This is a stated outcome with a required
   * reason — an inaccessible device is the commonest real result on an annual,
   * and the whole point of recording it apart from a pass is that the coverage
   * gap stays visible on the document the client is given.
   */
  return r === 'pass' ? 'PASS' : r === 'fail' ? 'FAIL' : r === 'na' ? 'N/A' : 'NOT TESTED';
}

function addressLabel(p: { loopNumber?: number; address?: number; subAddress?: number; pointRef?: string }): string {
  if (p.loopNumber !== undefined && p.address !== undefined) {
    const base = `L${p.loopNumber}.${String(p.address).padStart(3, '0')}`;
    return p.subAddress !== undefined ? `${base}.${p.subAddress}` : base;
  }
  return p.pointRef ?? (p.address !== undefined ? String(p.address) : '');
}

/**
 * Renders a full service report.
 *
 * `generatedAt` is passed in rather than read from the clock so the same report
 * renders identically in tests.
 */
export interface StatutoryRecord {
  /** Explicit affirmation that the maintenance complied with QDC MP 6.1. */
  qdcCompliance: boolean;
  /** Whether the installation was considered to be in proper working order. */
  inProperWorkingOrder: boolean | null;
  hardcopyLeftOnSite: boolean;
  /** The standard the installation is maintained to. */
  appliedStandard?: string;
  supervisorName?: string;
  supervisorLicenceNumber?: string;
}

/**
 * Turns a stored photo path into something the renderer can load.
 *
 * Photographs are recorded as a path relative to the app's document directory
 * rather than as an absolute URI, because on iOS the container path contains a
 * identifier that changes when the app is updated — absolute URIs saved today
 * stop resolving after the next release, silently. So the report is handed a
 * resolver, and defaults to leaving the string alone so the templates stay
 * testable without the file system.
 */
export type PhotoResolver = (storedPath: string) => string;

export function serviceReportHtml(
  b: ReportBundle,
  generatedAt: string,
  statutory?: StatutoryRecord,
  resolvePhoto: PhotoResolver = (p) => p,
): string {
  const { site, report, panel, testRows, checkRows, defects } = b;

  const pass = testRows.filter((r) => r.result === 'pass').length;
  const fail = testRows.filter((r) => r.result === 'fail').length;
  const na = testRows.filter((r) => r.result === 'na').length;
  const untested = testRows.filter((r) => r.result === 'untested').length;

  const siteAddress = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ');

  const checksBySection = new Map<string, typeof checkRows>();
  for (const c of checkRows) {
    const arr = checksBySection.get(c.section) ?? [];
    arr.push(c);
    checksBySection.set(c.section, arr);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
<div class="brandbar"></div>
<h1>${esc(report.title)}</h1>
<div class="sub">${esc(site.name)}${siteAddress ? ` &middot; ${esc(siteAddress)}` : ''}</div>

<table class="meta">
  <tr><td>Service type</td><td>${esc(report.frequency)}</td></tr>
  <tr><td>Service date</td><td>${esc(formatAuDate(report.serviceDate))}</td></tr>
  <tr><td>Panel</td><td>${esc(panel ? `${panel.name}${panel.model ? ` (${panel.model})` : ''}` : 'All panels on site')}</td></tr>
  <tr><td>Client</td><td>${esc(site.clientName)}</td></tr>
  <tr><td>Site reference</td><td>${esc(site.siteRef)}</td></tr>
  <tr><td>Technician</td><td>${esc(report.technicianName)}${report.technicianLicence ? ` &middot; Licence ${esc(report.technicianLicence)}` : ''}</td></tr>
  <tr><td>Company</td><td>${esc(report.companyName)}</td></tr>
</table>

<div class="stats">
  <div class="stat"><div class="k">Devices</div><div class="v">${testRows.length}</div></div>
  <!--
    What was actually tested, beside how many were on the sheet. The two are
    the same number only on a job where nothing was locked, and a reader who
    has only the first will take it for the second.
  -->
  <div class="stat"><div class="k">Tested</div><div class="v">${pass + fail}</div></div>
  <div class="stat"><div class="k">Pass</div><div class="v">${pass}</div></div>
  <div class="stat"><div class="k">Fail</div><div class="v">${fail}</div></div>
  <div class="stat"><div class="k">N/A</div><div class="v">${na}</div></div>
  <div class="stat"><div class="k">Not tested</div><div class="v">${untested}</div></div>
  <div class="stat"><div class="k">Defects</div><div class="v">${defects.length}</div></div>
</div>

${checkRows.length ? `<h2>Panel &amp; system checks</h2>
${[...checksBySection.entries()].map(([section, rows]) => `
<table>
  <thead><tr><th colspan="4">${esc(section)}</th></tr>
  <tr><th style="width:46%">Check</th><th style="width:12%">Result</th><th style="width:16%">Value</th><th>Comment</th></tr></thead>
  <tbody>${rows.map((c) => `<tr>
    <td>${esc(c.label)}</td>
    <td class="${resultClass(c.result as TestRow['result'])}">${resultText(c.result as TestRow['result'])}</td>
    <td>${esc(c.value)}${c.unit ? ` ${esc(c.unit)}` : ''}</td>
    <td>${esc(c.comment)}</td></tr>`).join('')}</tbody>
</table>`).join('')}` : ''}

<h2>Device test results</h2>
${testRows.length ? `<table>
  <thead><tr>
    <th style="width:4%">#</th><th style="width:9%">Address</th><th style="width:5%">Zone</th>
    <th style="width:20%">Zone text</th><th style="width:24%">Device text</th>
    <th style="width:10%">Type</th><th style="width:8%">Result</th><th>Comment</th>
  </tr></thead>
  <tbody>${testRows.map((r, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td>${esc(addressLabel(r))}</td>
    <td class="num">${esc(r.zoneNumber)}</td>
    <td>${esc(r.zoneText)}</td>
    <td>${esc(r.deviceText)}</td>
    <td>${esc(r.assetType ?? DEVICE_TYPE_LABEL[r.deviceType])}</td>
    <td class="${resultClass(r.result)}">${resultText(r.result)}</td>
    <td>${esc(r.comment)}</td>
  </tr>`).join('')}</tbody>
</table>` : '<div class="empty">No devices were added to this test sheet.</div>'}

${defects.length ? `<h2>Defects</h2>
<table>
  <thead><tr><th style="width:11%">Severity</th><th style="width:10%">Status</th>
  <th style="width:22%">Location</th><th>Description</th><th style="width:10%">Raised</th></tr></thead>
  <tbody>${defects.map((d) => `<tr>
    <td><span class="pill ${d.severity === 'critical' ? 'crit' : 'non'}">${d.severity === 'critical' ? 'CRITICAL' : 'NON-CRITICAL'}</span></td>
    <td>${esc(d.status)}</td>
    <td>${esc(d.location)}</td>
    <td>${esc(d.description)}${d.photos.length ? `<div class="photos">${d.photos.map((p) => `<img src="${esc(resolvePhoto(p))}"/>`).join('')}</div>` : ''}</td>
    <td>${esc(formatAuDate(d.raisedAt))}</td>
  </tr>`).join('')}</tbody>
</table>` : ''}

${report.notes ? `<h2>Notes</h2><div>${esc(report.notes).replace(/\n/g, '<br/>')}</div>` : ''}

${statutory ? `<h2>Record of maintenance</h2>
<table class="meta">
  <tr><td>Installation</td><td>${esc(panel ? `${panel.brand} ${panel.model ?? ''} — ${panel.name}`.trim() : site.name)}</td></tr>
  <tr><td>Maintenance carried out</td><td>${esc(formatAuDate(report.serviceDate))}</td></tr>
  <tr><td>Maintenance description</td><td>${esc(report.title)}</td></tr>
  ${statutory.appliedStandard ? `<tr><td>Maintained to</td><td>${esc(statutory.appliedStandard)}</td></tr>` : ''}
  <tr><td>Carried out by</td><td>${esc(report.technicianName)}${report.technicianLicence ? ` &middot; Licence ${esc(report.technicianLicence)}` : ''}</td></tr>
  ${statutory.supervisorName ? `<tr><td>Under supervision of</td><td>${esc(statutory.supervisorName)}${statutory.supervisorLicenceNumber ? ` &middot; Licence ${esc(statutory.supervisorLicenceNumber)}` : ''}</td></tr>` : ''}
  <!--
    "Not stated", never "No".

    Both of these come off an unticked checkbox on the report screen — the
    technician's action is to tick and affirm, and there is no control anywhere
    that records an explicit "No". So printing one turns an untouched box into
    a positive assertion of non-compliance with QDC MP 6.1, on a record of
    maintenance an inspector reads, that nobody made.

    The row immediately below already got this right and says so in its own
    comment: not yet answered is different from no. It is the same distinction
    the department's Form 72 keeps in Part H, for the same reason.
  -->
  <tr><td>Complied with QDC MP 6.1</td><td>${statutory.qdcCompliance ? 'Yes' : 'Not stated'}</td></tr>
  <tr><td>In proper working order</td>
      <td>${statutory.inProperWorkingOrder === null ? 'Not stated' : statutory.inProperWorkingOrder ? 'Yes' : 'No'}</td></tr>
  ${defects.filter((d) => d.status === 'open').length
    ? `<tr><td>Corrective action required</td><td>${defects.filter((d) => d.status === 'open').map((d) => `${esc(d.location)}: ${esc(d.description)}`).join('<br/>')}</td></tr>`
    : ''}
  ${defects.filter((d) => d.status === 'rectified').length
    ? `<tr><td>Repairs made</td><td>${defects.filter((d) => d.status === 'rectified').map((d) => `${esc(formatAuDate(d.rectifiedAt))} — ${esc(d.location)}: ${esc(d.description)}`).join('<br/>')}</td></tr>`
    : ''}
  <tr><td>Hardcopy left on site</td><td>${statutory.hardcopyLeftOnSite ? 'Yes' : 'Not stated'}</td></tr>
</table>

<div style="margin-top:10px;padding:9px 11px;background:#F4F6F8;border-left:3px solid #C92A2A;font-size:10px;line-height:1.5">
  <strong>Certification.</strong> I certify that the matters stated in this record of maintenance are correct.
</div>` : ''}

<div class="sig">
  <div class="sigrow">
    <div class="sigbox">
      ${report.signatureTechnician ? `<img src="${esc(report.signatureTechnician)}"/>` : '<div style="height:62px"></div>'}
      <div class="sigline"><strong>Technician</strong><br/>${esc(report.technicianName)}${report.technicianLicence ? `<br/>Licence ${esc(report.technicianLicence)}` : ''}</div>
    </div>
    <div class="sigbox">
      ${report.signatureWitness ? `<img src="${esc(report.signatureWitness)}"/>` : '<div style="height:62px"></div>'}
      <div class="sigline"><strong>Site representative</strong><br/>${esc(report.witnessName)}</div>
    </div>
  </div>
</div>

<div class="footer">
  <span>${esc(site.name)} &middot; ${esc(report.title)}</span>
  <span>Generated by Safe QLD &middot; ${esc(formatAuDate(generatedAt))}</span>
</div>
</body></html>`;
}

/** Renders a cause-and-effect matrix as a landscape PDF. */
export function causeEffectHtml(panel: Panel, rules: CauseEffectRule[], siteName: string, generatedAt: string): string {
  // The same columns the workbook's matrix uses, from the same function. The
  // two are issued together and describe one panel.
  const columns = matrixColumns(rules);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  @page { size: A4 landscape; margin: 10mm; }
  /* Vertical effect headers keep a wide matrix on one page. */
  th.rot { height: 118px; white-space: nowrap; vertical-align: bottom; padding: 4px 2px; width: 26px; }
  th.rot > div { transform: rotate(-90deg); transform-origin: left top; width: 26px;
                 margin-left: 50%; font-size: 8.5px; text-transform: none; letter-spacing: 0; }
  td.mark { text-align: center; font-weight: 700; background: #D4EDDA; }
  td.cond { text-align: center; font-weight: 700; background: #FFF3CD; }
  td.blank { background: #FAFAFA; }
  </style></head><body>
<div class="brandbar"></div>
<h1>Cause &amp; Effect Matrix</h1>
<div class="sub">${esc(siteName)} &middot; ${esc(panel.name)}${panel.model ? ` (${esc(panel.model)})` : ''}</div>

${rules.length ? `<table>
  <thead><tr>
    <th style="width:210px">Cause</th><th style="width:46px">Zone</th>
    ${columns.map((c) => `<th class="rot"><div>${esc(c.label)}</div></th>`).join('')}
  </tr></thead>
  <tbody>${rules.map((r) => {
    const byKey = new Map(r.effects.map((e) => [`${e.effectKind}|${e.effectLabel}`, e]));
    return `<tr><td>${esc(r.causeLabel)}</td><td class="num">${esc(r.causeZoneNumber)}</td>${columns.map((c) => {
      const e = byKey.get(c.key);
      if (!e || e.state === 'not-linked') return '<td class="blank"></td>';
      const mark = e.state === 'conditional' ? 'C' : 'X';
      const cls = e.state === 'conditional' ? 'cond' : 'mark';
      return `<td class="${cls}">${mark}${e.delaySeconds ? `<br/><span style="font-size:7.5px;font-weight:400">${e.delaySeconds}s</span>` : ''}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody>
</table>
<div style="margin-top:8px;font-size:9px;color:#666">
  <strong>X</strong> = effect operates &nbsp;&nbsp; <strong>C</strong> = conditional, see notes &nbsp;&nbsp; <em>ns</em> = delay in seconds
</div>` : '<div class="empty">No cause and effect rules have been recorded for this panel.</div>'}

<div class="footer">
  <span>${esc(siteName)} &middot; Cause &amp; Effect</span>
  <span>Generated by Safe QLD &middot; ${esc(formatAuDate(generatedAt))}</span>
</div>
</body></html>`;
}
