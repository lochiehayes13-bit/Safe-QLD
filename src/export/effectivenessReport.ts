import {
  KIND_MEANING, NOT_A_DESIGN_REVIEW, NOT_A_SERVICE_RECORD, NO_TESTING_CONDUCTED,
  PRIORITY_LABEL, findingRef, recommendationClosing, summariseFindings, type Finding,
} from '@/domain/findings';
import { letterheaded } from './letterhead';
import { formatAuDate } from './sheets';

/**
 * The fire system effectiveness report.
 *
 * Modelled on the report Safe QLD issues, section for section, because the
 * client has already accepted that format and reads it by habit. What it is not
 * is a routine service report with different words: it records a visual,
 * non-intrusive attendance where nothing was tested and nothing found is a
 * defect, and it says all three of those things in its own text rather than
 * relying on a reader to know.
 *
 * The closing statement's numbered list of recommendations is built from the
 * findings register above it rather than typed, so a report cannot recommend
 * five things and then list three.
 */

function esc(s: string | number | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Paragraph breaks survive; everything else is escaped. */
function paras(s: string | undefined): string {
  if (!s?.trim()) return '';
  return s.trim().split(/\n{2,}|\r\n\r\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br />')}</p>`).join('');
}

/**
 * One numbered entry in the photographic register.
 *
 * Already grouped and numbered by the caller, using groupForRegister and
 * numberRegister — the report renders what it is given rather than counting
 * again. A second counter here would be a second answer to "which photo is
 * Photo 7", and the register is cited by number from the findings.
 */
export interface ReportPhoto {
  /** "Photo 7", from numberRegister. */
  ref: string;
  /** A resolved URI the renderer can load, or a data URI. */
  uri: string;
  caption: string;
  /** The heading it prints under: "Fire Indicator Panel — External, Controls & Status". */
  group?: string;
}

export interface EffectivenessReportInput {
  reportReference: string;
  jobReference?: string;
  assessmentType: string;
  clientName: string;
  siteName: string;
  siteAddress?: string;
  scopeLabel?: string;
  attendanceDate?: string;
  issueDate?: string;
  assessedBy: string;
  preparedBy: string;
  /**
   * Who prepared the report, named in the limitations paragraph under the
   * details table.
   *
   * There is no fallback any more. It used to default to the trading name
   * 'Safe QLD Fire Protection' spelled out in this file, and the letterhead foot
   * now prints the registered entity and its ABN from the shared company
   * constants — so a report with no company name supplied was stating the
   * company twice, under two different names, one of them a literal nobody would
   * think to update. Left unset the sentence simply does not claim a preparer,
   * and the foot still says whose document it is.
   */
  companyName?: string;
  /** Section 1. */
  summary?: string;
  /** What was walked and reviewed, one activity per line. */
  activities?: string[];
  /** What was deliberately outside the assessment. */
  boundary?: string;
  /** Section 4. */
  systemDescription?: string;
  /** Section 5. */
  panelStatus?: string;
  findings: Finding[];
  photos?: ReportPhoto[];
  /** Section 10, in the assessor's own words. The recommendation list is appended. */
  statement?: string;
  /**
   * Surfaced above the findings register when the site has defects open in the
   * app. A client reading "no defects were identified" will not draw the
   * distinction the scope note draws.
   */
  openDefectCaution?: string;
}

/*
 * The report's own stylesheet.
 *
 * No `@page` rule here, and none wanted: the letterhead's 8mm/10mm/10mm page box
 * applies, and that is the box the masthead artwork is drawn to the width of. A
 * margin declared here would leave the band floating inside the sheet rather
 * than sitting where the printed stock has it.
 *
 * `.sub` is the document's own subtitle — "Site Fire System Effectiveness
 * Report" under the systems heading — not an entity line, so it stays. The
 * photographic register is the thing to watch on this document: `.photo` is 47%
 * of the column and a pair of photos can be most of a page's height, so a break
 * lands between rows of the flex wrap rather than through a caption.
 */
const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #1b1b1b; margin: 0; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 2px; letter-spacing: 0.4px; }
  h2 { font-size: 12px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: 0.5px;
       border-bottom: 1.5px solid #1b1b1b; padding-bottom: 3px; }
  h3 { font-size: 11px; margin: 16px 0 6px; }
  p { margin: 0 0 8px; line-height: 1.5; }
  .sub { text-align: center; font-size: 11px; margin: 0 0 4px; letter-spacing: 0.3px; }
  .caveat { text-align: center; font-size: 8px; font-style: italic; color: #444; margin: 0 0 14px; }
  .who { text-align: center; font-size: 12px; font-weight: bold; margin: 14px 0 2px; }
  .where { text-align: center; font-size: 11px; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; }
  .meta td { border: 1px solid #999; padding: 5px 7px; }
  .meta td:first-child { width: 32%; background: #f2f2f2; font-weight: bold; }
  .note { border: 1px solid #999; background: #f7f7f7; padding: 8px 10px; margin: 10px 0;
          font-size: 9.5px; line-height: 1.5; }
  .note b { display: block; margin-bottom: 3px; }
  .reg th { background: #1b1b1b; color: #fff; font-size: 8.5px; text-transform: uppercase;
            letter-spacing: 0.4px; padding: 5px 6px; text-align: left; }
  .reg td { border: 1px solid #bbb; padding: 5px 6px; vertical-align: top; font-size: 9.5px;
            line-height: 1.45; }
  .reg .id { width: 52px; font-weight: bold; }
  .reg .cls { width: 88px; }
  .action td { background: #f7f7f7; font-size: 9.5px; }
  .action .id { font-weight: bold; }
  .pri { font-weight: bold; }
  .photos { display: flex; flex-wrap: wrap; gap: 10px; }
  /*
   * A photograph and the caption that says what it shows are one thing. Split
   * across a page break the caption becomes the first line of the next sheet
   * with no image above it, which in a register of a dozen similar detector
   * photographs is unreadable rather than merely untidy.
   */
  .photo { width: 47%; page-break-inside: avoid; }
  .photo img { width: 100%; border: 1px solid #999; }
  .photo .cap { font-size: 8.5px; line-height: 1.4; margin-top: 3px; color: #333; }
  /*
   * Four rows naming who assessed, who wrote it, the client and the dates. It is
   * the block a reader checks the report against, and split across a break it
   * reads as two half-tables neither of which answers the question. Small enough
   * to always fit, so the guard can always be honoured.
   */
  .signoff { page-break-inside: avoid; }
  .signoff td { border: 1px solid #999; padding: 7px; }
  .signoff td:first-child { width: 36%; background: #f2f2f2; font-weight: bold;
                            text-transform: uppercase; font-size: 9px; letter-spacing: 0.4px; }
  .foot { margin-top: 18px; font-size: 8.5px; color: #444; line-height: 1.5; font-style: italic; }
  .confidential { text-align: center; font-size: 8.5px; letter-spacing: 1px; margin: 12px 0;
                  text-transform: uppercase; }
`;

function metaTable(input: EffectivenessReportInput): string {
  const rows: [string, string | undefined][] = [
    ['Attendance Date', formatAuDate(input.attendanceDate)],
    // Both, when they differ. The issued report names the plant and the
    // building, and a report headed only "Administration Building" does not say
    // which site's.
    ['Site', input.scopeLabel && input.scopeLabel !== input.siteName
      ? `${input.siteName} — ${input.scopeLabel}`
      : input.siteName],
    ['Report Reference', input.reportReference],
    ['Job Reference', input.jobReference],
    ['Assessment Type', input.assessmentType],
    ['Assessed By', input.assessedBy],
    ['Prepared By', input.preparedBy],
    ['Client', input.clientName],
    ['Issue Date', formatAuDate(input.issueDate)],
  ];
  return `<table class="meta">${rows
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

function registerRows(findings: Finding[], kind: Finding['kind']): string {
  const of = findings.filter((f) => f.kind === kind);
  if (!of.length) {
    return `<tr><td colspan="5">None identified within the scope of this assessment.</td></tr>`;
  }
  return of.map((f) => {
    const ref = findingRef(f.kind, f.seq);
    const related = f.relatedRefs.length ? ` — programmed with ${esc(f.relatedRefs.join(', '))}.` : '';
    const priority = f.priority ? ` <span class="pri">Priority: ${esc(PRIORITY_LABEL[f.priority])}.</span>` : '';
    const lead = kind === 'recommendation' ? 'Action' : 'Note';
    return `
      <tr>
        <td class="id">${esc(ref)}</td>
        <td class="cls">${esc(kind === 'recommendation' ? 'Recommendation' : 'Observation')}</td>
        <td>${esc(f.item)}</td>
        <td>${esc(f.location)}</td>
        <td>${esc(f.detail)}${f.reference ? `<br /><i>${esc(f.reference)}</i>` : ''}</td>
      </tr>
      <tr class="action">
        <td class="id">${esc(ref)}</td>
        <td colspan="4">↳ ${lead}: ${esc(f.action)}${priority}${related}</td>
      </tr>`;
  }).join('');
}

function registerTable(findings: Finding[], kind: Finding['kind']): string {
  return `<table class="reg">
    <tr><th>ID</th><th>Classification</th><th>Item</th><th>Location</th><th>Detail</th></tr>
    ${registerRows(findings, kind)}
  </table>`;
}

function photoRegister(photos: ReportPhoto[]): string {
  if (!photos.length) return '';
  // Headings in the order the register was numbered, so the numbers run down
  // the page rather than jumping between sections.
  const groups: { label: string; photos: ReportPhoto[] }[] = [];
  for (const p of photos) {
    const label = p.group?.trim() || 'General';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.photos.push(p);
    else groups.push({ label, photos: [p] });
  }
  return groups.map((g) => `
    <h3>${esc(g.label)}</h3>
    <div class="photos">${g.photos.map((p) => `
      <div class="photo"><img src="${esc(p.uri)}" alt="" />
      <div class="cap">${esc(p.ref)} — ${esc(p.caption)}</div></div>`).join('')}</div>`).join('');
}

export function effectivenessReportHtml(input: EffectivenessReportInput): string {
  const tally = summariseFindings(input.findings);
  const company = input.companyName?.trim();

  const activities = input.activities?.filter((a) => a.trim()) ?? [];

  const closing = [
    input.statement?.trim(),
    recommendationClosing(input.findings),
  ].filter(Boolean).join(' ');

  return letterheaded({
    title: `Fire System Effectiveness Report — ${input.siteName}`,
    css: CSS,
    body: `
    <h1>Fire Detection, Alarm &amp; Occupant Warning Systems</h1>
    <div class="sub">Site Fire System Effectiveness Report</div>
    <div class="caveat">Assessed against original design intent as installed — not an engineered
      design investigation — no AS 1851:2012 testing conducted</div>

    <div class="who">${esc(input.clientName)}</div>
    <div class="where">${esc(input.siteName)}${
  input.scopeLabel && input.scopeLabel !== input.siteName ? ` — ${esc(input.scopeLabel)}` : ''
}${input.siteAddress ? `<br />${esc(input.siteAddress)}` : ''}</div>

    ${metaTable(input)}

    <p class="foot">${company ? `Prepared by ${esc(company)}. ` : ''}This report records a visual
      fire system effectiveness and readiness assessment. It does not constitute a routine service,
      inspection or test record under AS 1851:2012, and no certificate of compliance is issued with
      it.</p>

    <div class="confidential">Commercial in Confidence</div>

    <h2>1. Executive Summary</h2>
    ${paras(input.summary) || '<p>Not yet written.</p>'}

    <h2>2. Purpose, Scope &amp; Limitations</h2>
    ${activities.length ? `<p>The following activities were undertaken:</p><ul>${
    activities.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="note"><b>Scope Note — No Testing Conducted</b>${esc(NO_TESTING_CONDUCTED)}</div>
    <div class="note"><b>Assessment Basis — Not an Engineered Design Investigation</b>${esc(NOT_A_DESIGN_REVIEW)}</div>
    ${input.boundary?.trim() ? `<div class="note"><b>Assessment Boundary</b>${esc(input.boundary)}</div>` : ''}

    ${input.systemDescription?.trim() ? `<h2>3. Site &amp; System Description</h2>${paras(input.systemDescription)}` : ''}
    ${input.panelStatus?.trim() ? `<h2>4. Fire Indicator Panel — Condition &amp; Status</h2>${paras(input.panelStatus)}` : ''}

    <h2>5. Findings Register</h2>
    <p>All findings from this assessment are classified as Recommendations or Observations.
      ${tally.none
    ? 'None were identified within the scope of this visual assessment.'
    : `${tally.recommendations} recommendation${tally.recommendations === 1 ? '' : 's'} and
       ${tally.observations} observation${tally.observations === 1 ? '' : 's'} are recorded.`}
      No Critical Defects, Non-Critical Defects or Non-Conformances were identified, because no
      testing was conducted.</p>
    <div class="note">
      <b>Classification Key</b>
      <b>Recommendation</b>${esc(KIND_MEANING.recommendation)}
      <b>Observation</b>${esc(KIND_MEANING.observation)}
    </div>
    ${input.openDefectCaution ? `<div class="note"><b>Note on defects already recorded</b>${esc(input.openDefectCaution)}</div>` : ''}

    <h3>5.1 Recommendations</h3>
    ${registerTable(input.findings, 'recommendation')}

    <h3>5.2 Observations (Note Only)</h3>
    ${registerTable(input.findings, 'observation')}

    ${input.photos?.length ? `<h2>6. Photographic Register</h2>
      <p>The following photographs record representative equipment and conditions observed during
        the attendance${input.attendanceDate ? ` on ${esc(formatAuDate(input.attendanceDate))}` : ''}.
        Photographs are grouped by subject.</p>
      ${photoRegister(input.photos)}` : ''}

    <h2>${input.photos?.length ? '7' : '6'}. Assessment Summary &amp; Sign-off</h2>
    ${closing ? `<div class="note"><b>Assessment Statement</b>${esc(closing)}</div>` : ''}
    <p class="foot">${esc(NOT_A_SERVICE_RECORD)}</p>
    <table class="signoff">
      <tr><td>Assessed by</td><td>${esc(input.assessedBy)}</td></tr>
      <tr><td>Report prepared by</td><td>${esc(input.preparedBy)}</td></tr>
      <tr><td>Client</td><td>${esc(input.clientName)}</td></tr>
      <tr><td>Attendance / issue date</td><td>${
  esc([formatAuDate(input.attendanceDate), formatAuDate(input.issueDate)].filter(Boolean).join(' / '))
}</td></tr>
    </table>
`,
  });
}
