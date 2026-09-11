import type { OccupierStatement } from '@/db/occupierRepo';
import { occupierStatementIssues } from '@/domain/qldCompliance';
import {
  COMMISSIONER_COPY_BUSINESS_DAYS, commissionerCopyDeadline,
} from '@/domain/occupierForm';
import { formatAuDate } from './sheets';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * The annual occupier statement, as something that can be printed and signed.
 *
 * Queensland requires the occupier to give this statement each year and to copy
 * it to the Commissioner within ten working days. The approved form comes from
 * the regulator; this produces the same content so the occupier can read, check
 * and sign it while we are still on site, instead of the statement waiting on
 * someone finding the form.
 *
 * Like the critical defect notice, it says plainly that it is not the approved
 * form. Presenting a lookalike as the statutory document would be worse than
 * not producing one.
 */

function esc(s: string | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface OccupierStatementInput {
  statement: OccupierStatement;
  companyName: string;
  /** Who prepared it, so the occupier knows who to ask about a row. */
  preparedBy?: string;
  generatedAt: string;
}

export function occupierStatementHtml(input: OccupierStatementInput): string {
  const { statement: s, generatedAt } = input;
  const present = s.rows.filter((r) => r.present);
  const issues = occupierStatementIssues(s.rows);
  /*
   * Section 55A(3) counts from the day the occupier is *required to prepare*
   * the statement, not from the day they sign. Those are the same date only for
   * an occupier who signs exactly on their anniversary — sign a month late and
   * the ten business days have long since run, and a document telling them
   * otherwise is worse than one that says nothing.
   *
   * So the period end is the anchor, and the signature goes in only as the
   * fallback the domain labels as one. The count uses Queensland's real public
   * holidays rather than skipping weekends alone.
   */
  const deadline = commissionerCopyDeadline({
    requiredPreparationDate: s.periodEnd || undefined,
    signedDate: qldIsoDay(s.signedAt ?? undefined),
  });

  const period = [s.periodStart, s.periodEnd].filter(Boolean).map(formatAuDate).join(' to ');

  // Every prescribed installation is listed, including the ones this building
  // does not have. A statement that silently omits them reads as an oversight;
  // one that says "not installed" is a positive answer.
  const rows = s.rows
    .map((r) => {
      if (!r.present) {
        return `<tr class="absent">
  <td>${esc(r.installation)}</td>
  <td colspan="3" class="na">Not installed at these premises</td>
</tr>`;
      }
      const notice = r.criticalDefectNoticeGiven
        ? `Yes${r.rectifiedDate ? ` — rectified ${esc(formatAuDate(r.rectifiedDate))}` : ' — <strong class="bad">no rectification date recorded</strong>'}`
        : 'No';
      return `<tr>
  <td>${esc(r.installation)}</td>
  <td class="tick">Yes</td>
  <td>${esc(r.nominatedStandard) || '<strong class="bad">not nominated</strong>'}</td>
  <td>${notice}</td>
</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 10.5px; line-height: 1.45; margin: 0; }
  .bar { height: 5px; background: #1F4E79; margin-bottom: 14px; }
  h1 { font-size: 19px; margin: 0 0 2px; color: #1F4E79; letter-spacing: -0.2px; }
  h2 { font-size: 11.5px; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #333;
       text-transform: uppercase; letter-spacing: 0.6px; }
  .sub { color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  td, th { border: 1px solid #D5D8DC; padding: 4px 7px; vertical-align: top; text-align: left; }
  th { background: #1F4E79; color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; }
  td.k { width: 26%; background: #F4F6F8; font-weight: 600; }
  tr.absent td { color: #999; }
  td.na { font-style: italic; }
  td.tick { font-weight: 700; color: #1F6F3D; width: 9%; }
  .bad { color: #C00000; }
  .declare { border: 2px solid #1F4E79; background: #F2F7FC; padding: 10px 12px; margin: 14px 0; border-radius: 4px; }
  .warn { border: 2px solid #C00000; background: #FDF2F2; padding: 9px 11px; margin: 12px 0; border-radius: 4px; }
  .clock { font-weight: 700; color: #1F4E79; }
  .note { margin-top: 18px; padding: 9px 11px; background: #F4F6F8; border-left: 3px solid #888;
          color: #444; font-size: 9px; line-height: 1.5; }
  .sig { margin-top: 22px; display: flex; gap: 28px; }
  .sigbox { flex: 1; }
  .sigline { border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; margin-top: 40px; }
  .sigimg { height: 46px; margin-bottom: -6px; }
  .footer { margin-top: 18px; padding-top: 7px; border-top: 1px solid #D5D8DC; color: #888; font-size: 8.5px;
            display: flex; justify-content: space-between; }
  </style></head><body>
<div class="bar"></div>
<h1>Occupier's Statement</h1>
<div class="sub">Annual statement about prescribed fire safety installations</div>

<h2>Premises</h2>
<table>
  <tr><td class="k">Premises</td><td>${esc(s.premisesName)}</td></tr>
  <tr><td class="k">Address</td><td>${esc(s.premisesAddress)}</td></tr>
  <tr><td class="k">Occupier</td><td>${esc(s.occupierName)}${s.occupierPhone ? ` — ${esc(s.occupierPhone)}` : ''}</td></tr>
  <tr><td class="k">Period covered</td><td>${esc(period) || 'Not stated'}</td></tr>
  <tr><td class="k">Prepared by</td><td>${esc(input.preparedBy)}${input.preparedBy ? ', ' : ''}${esc(input.companyName)}</td></tr>
</table>

<h2>Prescribed installations</h2>
<table>
  <tr>
    <th>Installation</th>
    <th>Installed</th>
    <th>Maintained to</th>
    <th>Critical defect notice given</th>
  </tr>
${rows}
</table>
<div class="sub">${present.length} of ${s.rows.length} prescribed installations are installed at these premises.</div>

${issues.length ? `<div class="warn">
  <strong class="bad">This statement is not ready to sign.</strong>
  <ul style="margin:6px 0 0 16px; padding:0">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
</div>` : ''}

<div class="declare">
  I declare that each prescribed fire safety installation listed above as installed at these premises has been
  maintained in the period stated, in the way required, and that where a critical defect notice was given the defect
  has been rectified as recorded.
</div>

<div class="sig">
  <div class="sigbox">
    ${s.signature ? `<img class="sigimg" src="${esc(s.signature)}" alt="" />` : ''}
    <div class="sigline">${esc(s.signedBy) || 'Occupier'}${s.signedPosition ? ` — ${esc(s.signedPosition)}` : ''}</div>
  </div>
  <div class="sigbox">
    <div class="sigline">Date${s.signedAt ? `: ${esc(formatAuDate(s.signedAt))}` : ''}</div>
  </div>
</div>

${deadline.due ? `<p class="clock" style="margin-top:14px">
  A copy of this statement is to reach the Commissioner by ${esc(formatAuDate(deadline.due))},
  being ${COMMISSIONER_COPY_BUSINESS_DAYS} business days from ${deadline.basis === 'signature-fallback'
    ? 'the date it was signed. That is not the date the Regulation counts from — it counts from the day '
      + 'the statement was required to be prepared, so this date may be later than the real one'
    : 'the day the statement was required to be prepared'}.${s.sentToCommissionerAt
    ? ` Recorded as sent ${esc(formatAuDate(s.sentToCommissionerAt))}.`
    : ''}
</p>` : ''}

<div class="note">
  This document was prepared from the maintenance records held for these premises so that it can be checked and signed
  on site. It is not the regulator's approved form and does not replace it. Where an approved form is required, use the
  form published by the regulator; the content above is intended to transfer to it directly. The business-day count
  applies Queensland's appointed public holidays as well as weekends; district show holidays are not known to this
  app, so the real deadline can only be later than the date shown, never earlier.
</div>

<div class="footer">
  <span>${esc(input.companyName)}</span>
  <span>Generated ${esc(formatAuDate(generatedAt))}</span>
</div>
</body></html>`;
}
