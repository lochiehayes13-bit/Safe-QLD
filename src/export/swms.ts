import {
  CONTROL_LEVEL_LABEL, RISK_LABEL, SWMS_REVIEW_TRIGGERS, mergeSwms, orderedControls, validateSwms,
  type MergedSwms, type RiskLevel, type SwmsRecord, type SwmsTemplate,
} from '@/domain/swms';
import { qldIsoDay } from '@/domain/qldTime';
import { letterheaded } from './letterhead';
import { formatAuDate } from './sheets';

/**
 * The safe work method statement as the page a principal contractor asks for.
 *
 * What that person is checking, in this order: which high-risk construction
 * work it covers, whether the controls are real, who signed it, and when. So
 * the document leads with those rather than with a company logo and a mission
 * statement — the crew, the site, the date and the categories are on the first
 * screen of the first page.
 *
 * The risk columns print the level in words, not a number out of twenty-five.
 * A matrix score is a house convention: "12" means nothing to a builder from
 * another company, and two firms using different matrices produce different
 * numbers for the same job. "High, then Low after these controls" travels.
 *
 * A statement that is not yet signed prints stamped DRAFT with what is
 * outstanding on its face. The one thing worse than no statement is a clean
 * looking one that nobody has signed, because it is the copy that gets filed
 * and produced later as evidence of something that never happened.
 */

export interface SwmsDocumentInput {
  record: SwmsRecord;
  templates: SwmsTemplate[];
  /** Who generated it, for the footer. */
  preparedBy?: string;
  generatedAt: string;
}

function esc(s: string | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RISK_CLASS: Record<RiskLevel, string> = {
  extreme: 'r-extreme', high: 'r-high', medium: 'r-medium', low: 'r-low',
};

const CSS = `
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1A1A1A; font-size: 10px; }
  h1 { font-size: 16px; margin: 0 0 2mm; }
  h2 { font-size: 11px; margin: 5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 1px solid #DDD; }
  .sub { color: #555; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
  th, td { border: 1px solid #CCC; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #F2F2F2; font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }
  .facts td:first-child { width: 32mm; color: #555; }
  .steps th:nth-child(1) { width: 8mm; }
  .steps th:nth-child(2) { width: 42mm; }
  .steps th:nth-child(4) { width: 16mm; }
  .steps th:nth-child(6) { width: 16mm; }
  ul { margin: 0; padding-left: 4mm; }
  li { margin-bottom: 0.6mm; }
  .lvl { display: inline-block; min-width: 17mm; color: #555; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.3px; }
  .r-extreme { background: #7B1E1E; color: #FFF; }
  .r-high { background: #C0392B; color: #FFF; }
  .r-medium { background: #E0A800; color: #1A1A1A; }
  .r-low { background: #2E7D32; color: #FFF; }
  .risk { text-align: center; font-weight: 700; font-size: 9px; }
  /*
    A step the crew took off. Struck through and greyed rather than removed:
    "we considered this and it did not apply" and "this was never in the
    document" are different claims, and only one of them is true.
  */
  tr.na td { opacity: 0.55; text-decoration: line-through; }
  tr.na td:nth-child(2) { text-decoration: none; }
  .hrcw { border: 1.5px solid #7B1E1E; padding: 2mm; margin-bottom: 3mm; }
  .hrcw .t { color: #7B1E1E; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; font-size: 9px; }
  .draft { border: 2px solid #C0392B; padding: 2.5mm; margin-bottom: 3mm; }
  .draft .t { color: #C0392B; font-weight: 700; font-size: 12px; letter-spacing: 1px; }
  .sig { height: 16mm; }
  .sig img { height: 14mm; }
  .note { color: #555; font-size: 9px; }
  .avoid { page-break-inside: avoid; }
`;

function factsTable(input: SwmsDocumentInput, merged: MergedSwms): string {
  const r = input.record;
  const rows: [string, string][] = [
    ['Site', r.siteName ?? 'Not stated'],
    ['Date of work', r.date ? formatAuDate(r.date) : 'Not stated'],
    ['Work covered', merged.templates.map((t) => t.activity).join('; ') || 'Not stated'],
    ['Simpro job', r.jobExternalId ? `${r.jobExternalId}${r.jobTitle ? ` — ${r.jobTitle}` : ''}` : 'Not linked'],
    ['Supervisor', r.supervisor ? `${r.supervisor}${r.supervisorPhone ? ` · ${r.supervisorPhone}` : ''}` : 'Not stated'],
    ['Highest risk after controls', merged.residualRisk ? RISK_LABEL[merged.residualRisk] : 'Not assessed'],
    ['Prepared by', input.preparedBy ?? 'Safe QLD Fire Protection'],
  ];
  return `<table class="facts">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

function hrcwBlock(merged: MergedSwms): string {
  if (!merged.hrcw.length) {
    return `<p class="note">This work is not high-risk construction work under the Work Health and Safety `
      + `Regulation 2011 (Qld). The statement is used because the work carries risk worth controlling, not `
      + `because the regulation compels one.</p>`;
  }
  return `<div class="hrcw"><div class="t">High-risk construction work</div>`
    + `<ul>${merged.hrcw.map((h) => `<li><strong>${esc(h.clause)}</strong> — ${esc(h.text)}</li>`).join('')}</ul></div>`;
}

/**
 * The steps, with what the crew decided about each.
 *
 * Three things the crew can say and all three print, because a document that
 * only shows what the office wrote is a document that cannot be checked
 * against what happened.
 *
 * A step read on site is marked as read. A step taken off is printed struck
 * through and labelled — not removed, because "we considered this and it did
 * not apply" and "this was never in the document" are completely different
 * claims and only one of them is true. And where the crew rated a step
 * differently from the reviewer, both ratings appear: theirs beside the
 * reviewed one, so a disagreement is visible rather than overwritten.
 */
function stepsTable(input: SwmsDocumentInput, merged: MergedSwms): string {
  const ticked = new Set(input.record.ticked);
  const off = new Set(input.record.notApplicable);
  const crewRisk = input.record.crewRisk;
  const rows = merged.steps.map((s, i) => {
    const controls = orderedControls(s.controls)
      .map((c) => `<li><span class="lvl">${esc(CONTROL_LEVEL_LABEL[c.level])}</span> ${esc(c.control)}</li>`)
      .join('');
    const skipped = off.has(s.key);
    const note = skipped
      ? 'not applicable to this job'
      : ticked.has(s.key) ? 'read on site' : '';
    const crew = crewRisk[s.key];
    const after = skipped
      ? '<em>n/a</em>'
      : crew
        ? `<span class="risk ${RISK_CLASS[crew]}">${esc(RISK_LABEL[crew])}</span>`
          + `<br /><span class="note">crew · as written ${esc(RISK_LABEL[s.residualRisk])}</span>`
        : `<span class="risk ${RISK_CLASS[s.residualRisk]}">${esc(RISK_LABEL[s.residualRisk])}</span>`;
    return `<tr class="avoid${skipped ? ' na' : ''}">`
      + `<td>${i + 1}</td>`
      + `<td>${esc(s.step)}<br /><span class="note">${esc(s.templateTitle)}${note ? ` · ${note}` : ''}</span></td>`
      + `<td><ul>${s.hazards.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></td>`
      + `<td class="risk ${RISK_CLASS[s.initialRisk]}">${esc(RISK_LABEL[s.initialRisk])}</td>`
      + `<td><ul>${controls}</ul></td>`
      + `<td>${after}</td>`
      + `<td>${esc(s.responsible)}</td>`
      + `</tr>`;
  }).join('');
  return `<table class="steps"><thead><tr>`
    + `<th>#</th><th>Job step</th><th>Hazards</th><th>Risk</th><th>Controls, most effective first</th><th>After</th><th>Who</th>`
    + `</tr></thead><tbody>${rows}</tbody></table>`;
}

function listBlock(title: string, items: readonly string[], empty: string): string {
  if (!items.length) return `<h2>${esc(title)}</h2><p class="note">${esc(empty)}</p>`;
  return `<h2>${esc(title)}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function answersBlock(input: SwmsDocumentInput, merged: MergedSwms): string {
  if (!merged.prompts.length) return '';
  const rows = merged.prompts.map((p) => {
    const a = input.record.answers[p]?.trim();
    return `<tr><td>${esc(p)}</td><td>${a ? esc(a) : '<em>Not answered</em>'}</td></tr>`;
  }).join('');
  return `<h2>This site, on the day</h2><table class="facts">${rows}</table>`;
}

function addedBlock(input: SwmsDocumentInput): string {
  const added = input.record.addedHazards.filter((h) => h.hazard.trim());
  if (!added.length) return '';
  return `<h2>Found on arrival</h2>`
    + `<table><thead><tr><th>Hazard</th><th>What was done about it</th><th>Risk</th></tr></thead>`
    + `<tbody>${added.map((h) => `<tr><td>${esc(h.hazard)}</td>`
      + `<td>${esc(h.control) || '<em>Not stated</em>'}</td>`
      // The crew's own rating, and said plainly where they did not give one:
      // a blank cell reads as low risk to anybody scanning the page.
      + `<td class="risk${h.risk ? ` ${RISK_CLASS[h.risk]}` : ''}">${h.risk ? esc(RISK_LABEL[h.risk]) : '<em>Not rated</em>'}</td>`
      + `</tr>`).join('')}</tbody></table>`;
}

function permitsBlock(input: SwmsDocumentInput, merged: MergedSwms): string {
  if (!merged.permits.length) return '';
  const rows = merged.permits.map((p) => {
    const held = input.record.permits.find((h) => h.permit === p);
    return `<tr><td>${esc(p)}</td><td>${held?.held ? `Held${held.reference ? ` · ${esc(held.reference)}` : ''}` : '<em>Not held</em>'}</td></tr>`;
  }).join('');
  return `<h2>Permits and authorities</h2><table class="facts">${rows}</table>`;
}

function signaturesBlock(input: SwmsDocumentInput): string {
  const workers = input.record.workers.filter((w) => w.name.trim());
  const rows = workers.length
    ? workers.map((w) => `<tr class="avoid"><td>${esc(w.name)}</td><td>${esc(w.licence) || '—'}</td>`
      + `<td class="sig">${w.signature ? `<img src="${w.signature}" alt="" />` : '<em>Not signed</em>'}</td>`
      + `<td>${w.signedAt ? esc(formatAuDate(qldIsoDay(w.signedAt) ?? w.signedAt)) : '—'}</td></tr>`).join('')
    : `<tr><td colspan="4"><em>Nobody has signed this statement.</em></td></tr>`;
  return `<h2>Everybody doing this work has read it</h2>`
    + `<p class="note">A signature here is a statement that this person was taken through every step above, `
    + `on the day named, at the site named.</p>`
    + `<table><thead><tr><th>Name</th><th>Licence or ticket</th><th>Signature</th><th>Date</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`;
}

function draftStamp(input: SwmsDocumentInput, merged: MergedSwms): string {
  if (input.record.status === 'signed') return '';
  const blocking = validateSwms(input.record, merged).filter((i) => i.blocking);
  return `<div class="draft"><div class="t">DRAFT — NOT SIGNED</div>`
    + `<p class="note">Work does not start under this statement until it is signed by everybody doing it.`
    + (blocking.length ? ` Outstanding: ${esc(blocking.map((b) => b.what).join('; '))}.` : '')
    + `</p></div>`;
}

export function swmsHtml(input: SwmsDocumentInput): string {
  const merged = mergeSwms(input.templates);
  const r = input.record;

  const body = `
    <h1>${esc(r.title || 'Safe work method statement')}</h1>
    <p class="sub">Safe work method statement and job safety analysis · ${esc(r.siteName ?? 'Site not stated')} · ${esc(r.date ? formatAuDate(r.date) : 'Date not stated')}</p>
    ${draftStamp(input, merged)}
    ${hrcwBlock(merged)}
    ${factsTable(input, merged)}
    ${answersBlock(input, merged)}
    <h2>The work, step by step</h2>
    ${stepsTable(input, merged)}
    ${addedBlock(input)}
    ${permitsBlock(input, merged)}
    ${listBlock('Personal protective equipment', merged.ppe, 'None listed.')}
    ${listBlock('Licences, tickets and training', merged.training, 'None listed.')}
    <h2>If it goes wrong</h2>
    <ul>${merged.templates.map((t) => `<li><strong>${esc(t.title)}</strong> — ${esc(t.emergency)}</li>`).join('')}</ul>
    ${signaturesBlock(input)}
    <h2>When this statement stops covering the work</h2>
    <ul>${SWMS_REVIEW_TRIGGERS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    ${listBlock('Legislation, codes and standards this is written to', merged.references, 'None listed.')}
    ${r.notes?.trim() ? `<h2>Notes</h2><p>${esc(r.notes)}</p>` : ''}
    <p class="note">Generated ${esc(formatAuDate(qldIsoDay(input.generatedAt) ?? input.generatedAt))}. Keep this on site while the work is being done.</p>
  `;

  return letterheaded({ title: r.title || 'Safe work method statement', css: CSS, body });
}
