import type { Defect, Site } from '@/domain/types';
import { formatAuDate } from './sheets';

/**
 * Critical defect notice.
 *
 * Queensland requires the occupier to be given a notice, in the approved form,
 * within 24 hours of the maintenance. The official form comes from the
 * regulator and should be used where it is available — this generates the same
 * content so a technician can hand something over on site immediately and
 * attach it to the occupier statement, rather than the notice waiting until
 * someone is back at a desk.
 *
 * It states plainly that it is not a substitute for the approved form, because
 * quietly presenting a lookalike as the statutory document would be worse than
 * not generating one at all.
 */

export interface NoticeInput {
  site: Site;
  defect: Defect & {
    qldLimbInoperable?: boolean;
    qldLimbAdverseImpact?: boolean;
    extentOfImpairment?: string;
    interimMeasures?: string;
    rectificationDueAt?: string;
  };
  technicianName: string;
  technicianLicence?: string;
  companyName: string;
  /** Who the notice is being given to. */
  occupierName?: string;
  /** ISO timestamp the maintenance was carried out — the 24 hour clock start. */
  maintenanceAt: string;
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

export function criticalDefectNoticeHtml(input: NoticeInput): string {
  const { site, defect, generatedAt } = input;
  const address = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 11px; line-height: 1.5; margin: 0; }
  .bar { height: 5px; background: #C00000; margin-bottom: 14px; }
  h1 { font-size: 19px; margin: 0 0 2px; color: #C00000; letter-spacing: -0.2px; }
  h2 { font-size: 12px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #333;
       text-transform: uppercase; letter-spacing: 0.6px; }
  .sub { color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  td { border: 1px solid #D5D8DC; padding: 5px 7px; vertical-align: top; }
  td.k { width: 32%; background: #F4F6F8; font-weight: 600; }
  .warn { border: 2px solid #C00000; background: #FDF2F2; padding: 10px 12px; margin: 12px 0; border-radius: 4px; }
  .warn strong { color: #C00000; }
  .clock { font-size: 15px; font-weight: 700; color: #C00000; }
  .note { margin-top: 20px; padding: 9px 11px; background: #F4F6F8; border-left: 3px solid #888;
          color: #444; font-size: 9.5px; line-height: 1.5; }
  .sig { margin-top: 26px; display: flex; gap: 28px; }
  .sigbox { flex: 1; }
  .sigline { border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; margin-top: 44px; }
  .footer { margin-top: 20px; padding-top: 7px; border-top: 1px solid #D5D8DC; color: #888; font-size: 8.5px;
            display: flex; justify-content: space-between; }
  </style></head><body>
<div class="bar"></div>
<h1>Critical Defect Notice</h1>
<div class="sub">Prescribed fire safety installation — notice to the occupier</div>

<div class="warn">
  <strong>A critical defect has been identified at this building.</strong><br/>
  The affected installation is not able to perform its intended function. Interim measures should be in place until it is
  rectified.
  ${input.defect.rectificationDueAt
    ? `<div class="clock" style="margin-top:6px">Rectification due by ${esc(formatAuDate(input.defect.rectificationDueAt))}</div>`
    : ''}
</div>

<h2>Building</h2>
<table>
  <tr><td class="k">Premises</td><td>${esc(site.name)}</td></tr>
  <tr><td class="k">Address</td><td>${esc(address)}</td></tr>
  <tr><td class="k">Occupier</td><td>${esc(input.occupierName)}</td></tr>
  <tr><td class="k">Notice given</td><td>${esc(formatAuDate(generatedAt))}</td></tr>
  <tr><td class="k">Maintenance carried out</td><td>${esc(formatAuDate(input.maintenanceAt))}</td></tr>
</table>

<h2>The defect</h2>
<table>
  <tr><td class="k">Installation</td><td>${esc(defect.location)}</td></tr>
  <tr><td class="k">Defect</td><td>${esc(defect.description)}</td></tr>
  <tr><td class="k">Extent of impairment</td><td>${esc(defect.extentOfImpairment) || 'See defect description'}</td></tr>
  <tr><td class="k">Renders the installation inoperable</td><td>${defect.qldLimbInoperable ? 'Yes' : 'No'}</td></tr>
  <tr>
    <td class="k">Reasonably likely to have a significant adverse impact on occupant safety in a fire or hazardous materials emergency</td>
    <td>${defect.qldLimbAdverseImpact ? 'Yes' : 'No'}</td>
  </tr>
  <tr><td class="k">Identified</td><td>${esc(formatAuDate(defect.raisedAt))}</td></tr>
</table>

${defect.interimMeasures ? `<h2>Interim measures recommended</h2>
<table><tr><td>${esc(defect.interimMeasures).replace(/\n/g, '<br/>')}</td></tr></table>` : ''}

<h2>Carried out by</h2>
<table>
  <tr><td class="k">Company</td><td>${esc(input.companyName)}</td></tr>
  <tr><td class="k">Technician</td><td>${esc(input.technicianName)}</td></tr>
  <tr><td class="k">Licence number</td><td>${esc(input.technicianLicence)}</td></tr>
</table>

<div class="sig">
  <div class="sigbox"><div class="sigline"><strong>Technician</strong><br/>${esc(input.technicianName)}</div></div>
  <div class="sigbox"><div class="sigline"><strong>Received by (occupier)</strong><br/>${esc(input.occupierName)}</div></div>
</div>

<div class="note">
  <strong>About this document.</strong> Queensland requires a critical defect notice to be given to the occupier in the
  approved form, and the occupier to rectify the defect within one month of the maintenance. This document carries the
  same information so it can be handed over on site immediately, and attached to the annual occupier statement together
  with evidence of rectification. It is not itself the regulator's approved form — obtain that from the Queensland Fire
  Department and lodge it as required.
</div>

<div class="footer">
  <span>${esc(site.name)} &middot; Critical defect notice</span>
  <span>Generated by Safe QLD &middot; ${esc(formatAuDate(generatedAt))}</span>
</div>
</body></html>`;
}
