import type { OccupierStatement } from '@/db/occupierRepo';
import { occupierStatementIssues } from '@/domain/qldCompliance';
import {
  COMMISSIONER_COPY_BUSINESS_DAYS, commissionerCopyDeadline,
} from '@/domain/occupierForm';
import { brand } from '@/theme/brand';
import { letterheaded } from './letterhead';
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

/*
 * The statement's own stylesheet, with no `@page` rule of its own.
 *
 * It used to open with `@page { size: A4; margin: 14mm 12mm }`, and that rule
 * never once reached a printer: the letterhead's stylesheet was appended after
 * the caller's, so its own page box won the cascade. Now that `letterheaded`
 * emits the page box first a rule here would take effect, and it should not —
 * the masthead artwork is drawn to the width of the 8mm/10mm box, and a wider
 * page margin leaves the band floating inside the sheet instead of sitting
 * where the printed stock has it.
 *
 * The navy stays. It is this document's structural colour — table heads, the
 * declaration border, the Commissioner deadline — and it is the one thing
 * distinguishing the statement the occupier signs from the defect notice
 * handed over with it. It is not a second red competing with the masthead, so
 * it does not have the problem the notices' #C00000 had. The two reds on the
 * page do: `.bad` and the not-ready-to-sign box are now `brand.red`, because a
 * warning in a red a shade off the red across the top of the sheet reads as a
 * printing fault rather than as a warning.
 */
const CSS = `
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 10.5px; line-height: 1.45; margin: 0; }
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
  .bad { color: ${brand.red}; }
  .declare { border: 2px solid #1F4E79; background: #F2F7FC; padding: 10px 12px; margin: 14px 0; border-radius: 4px; }
  .warn { border: 2px solid ${brand.red}; background: #FDF2F2; padding: 9px 11px; margin: 12px 0; border-radius: 4px; }
  .clock { font-weight: 700; color: #1F4E79; }
  .note { margin-top: 18px; padding: 9px 11px; background: #F4F6F8; border-left: 3px solid #888;
          color: #444; font-size: 9px; line-height: 1.5; }
  /*
   * The occupier signs this one, so the block carrying the signature is the
   * point of the document. It is 40px of white space above a rule, about 25mm
   * with the name under it, and a break through that leaves the rule on one
   * sheet and the occupier's name and position on the next — a signature block
   * nobody can sign, on the one document that exists to be signed. It was never
   * guarded, which did not show while the page had 14mm margins and nothing
   * above the heading; the masthead is 36mm of the first sheet and moves every
   * later element down the document.
   */
  .sig { margin-top: 22px; display: flex; gap: 28px; page-break-inside: avoid; }
  .sigbox { flex: 1; }
  .sigline { border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; margin-top: 40px; }
  .sigimg { height: 46px; margin-bottom: -6px; }
  .footer { margin-top: 18px; padding-top: 7px; border-top: 1px solid #D5D8DC; color: #888; font-size: 8.5px;
            display: flex; justify-content: space-between; }
`;

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

  return letterheaded({
    title: `Occupier's Statement — ${s.premisesName}`,
    css: CSS,
    body: `
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
  <span>${esc(s.premisesName)} &middot; Occupier's statement</span>
  <span>Generated ${esc(formatAuDate(generatedAt))}</span>
</div>
`,
  });
}
