import type { Site } from '@/domain/types';
import type { ImpairmentRecord } from '@/db/opsRepo';
import { qldMoment } from '@/domain/qldTime';
import { brand } from '@/theme/brand';
import { letterheaded } from './letterhead';

/**
 * Impairment notice — the piece of paper the building gets.
 *
 * An impairment is the one record in this app that somebody outside this
 * company is carrying the consequences of. A sprinkler valve is shut, a panel
 * is isolated, a pump is off: the building's responsible person now holds a
 * risk they did not have this morning, and the only thing standing between
 * that and a coroner's court is that somebody told them, in writing, what is
 * off, what is being done instead, and when it goes back on.
 *
 * The screen tracked all of that and could produce none of it. Ticking
 * "responsible person notified" is a record that a conversation happened. It
 * is not the notice, and six months later, when the question is what the
 * building was told, a tick box is not an answer.
 *
 * So this is the notice, and it is written to be read by a building manager
 * rather than a fire technician: what is off, in plain words, at the top; what
 * they have to do while it is off, in a box they cannot miss; and the
 * restoration line left blank until it is actually back, because a notice that
 * pre-fills its own closure is a notice nobody checks.
 *
 * It does not claim to be a statutory form, and says so.
 */

export interface ImpairmentNoticeInput {
  record: ImpairmentRecord;
  site: Site;
  companyName: string;
  technicianName?: string;
  technicianLicence?: string;
  /** Who the notice is being handed to, where the record does not name them. */
  responsibleName?: string;
  /**
   * The number to ring about this impairment, on the face of the notice.
   *
   * It stays even though the letterhead foot now prints the office number too.
   * That line is 6.5px grey legal furniture; this row is the number a building
   * manager rings at nine at night to ask when the sprinklers go back on, and it
   * has to be readable at arm's length. The duplication is deliberate.
   */
  companyPhone?: string;
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

const lines = (s: string | undefined) => esc(s).replace(/\n/g, '<br/>');

/**
 * How long it has been out, in the words a person would use.
 *
 * Not "39,720,000 ms" and not "11.03 hours". A building manager reading
 * "11 hours 2 minutes" understands immediately that this has been running
 * since before they got in.
 */
export function impairmentDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Less than a minute';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  // Minutes are dropped once it has been running for days: nobody cares, and
  // printing them suggests a precision the start time does not have.
  if (minutes && !days) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' ') : 'Less than a minute';
}

/**
 * What the building has been told, as a list of statements rather than ticks.
 *
 * A tick that is off has to read as a statement too — "the monitoring provider
 * has not been notified" is exactly the sort of thing a responsible person
 * needs to see on the page in front of them, and a form that only prints its
 * yeses is a form that hides its noes.
 */
export function noticeUndertakings(rec: ImpairmentRecord): { label: string; done: boolean }[] {
  return [
    { label: 'Responsible person notified', done: rec.responsibleNotified },
    { label: 'Monitoring provider notified', done: rec.monitoringNotified },
    { label: 'Fire brigade notified (where required)', done: rec.brigadeNotified },
    { label: 'Fire watch or alternative measures in place', done: rec.fireWatchInPlace },
    { label: 'Signage placed at the panel', done: rec.signagePlaced },
  ];
}

/**
 * The notice's own stylesheet.
 *
 * A function rather than a constant because the accent colour is the state of
 * the impairment: red while the installation is out of service, green once it
 * is back. That is the one thing a building manager takes in from across a
 * desk, and it has to be the same colour in the heading, the border of the box
 * they must not miss and the elapsed-time line.
 *
 * The red is now `brand.red` rather than the #C00000 that was here before. The
 * masthead puts the company's red across the top of the sheet, and a heading in
 * a second, nearly-but-not-quite-identical red an inch below it reads as a
 * printing fault. The green is left alone: it is not competing with anything on
 * the letterhead, and a green that matched a brand red would defeat the point.
 *
 * There is deliberately no `@page` rule. This file used to carry
 * `@page { size: A4; margin: 16mm 14mm }`, which never reached the printer
 * because the letterhead stylesheet was appended after it and its own page box
 * won on ordering. Now that `letterheaded` emits the page box first, a rule here
 * would win — and it should not, because the masthead artwork is drawn to the
 * width of the 8mm/10mm box and a wider margin leaves the band floating inside
 * the sheet rather than sitting where the printed stock has it.
 */
function noticeCss(accent: string, restored: boolean): string {
  return `
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 11px; line-height: 1.5; margin: 0; }
  h1 { font-size: 19px; margin: 0 0 2px; color: ${accent}; letter-spacing: -0.2px; }
  h2 { font-size: 12px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #333;
       text-transform: uppercase; letter-spacing: 0.6px; }
  .sub { color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  td { border: 1px solid #D5D8DC; padding: 5px 7px; vertical-align: top; }
  td.k { width: 32%; background: #F4F6F8; font-weight: 600; }
  .warn { border: 2px solid ${accent}; background: ${restored ? '#F1F9F3' : '#FDF2F2'}; padding: 10px 12px;
          margin: 12px 0; border-radius: 4px; }
  .warn strong { color: ${accent}; }
  .clock { font-size: 15px; font-weight: 700; color: ${accent}; margin-top: 6px; }
  .yes { color: #1E7B3C; font-weight: 600; }
  .no { color: ${brand.red}; font-weight: 600; }
  ul { margin: 4px 0 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .note { margin-top: 20px; padding: 9px 11px; background: #F4F6F8; border-left: 3px solid #888;
          color: #444; font-size: 9.5px; line-height: 1.5; }
  /*
   * The signature block is 44px of white space above a rule with the name under
   * it, about 26mm all told, and a break through that hands the building manager
   * a rule on one sheet and the words "Received by" on the next. It was
   * unguarded, which was survivable while the page had 16mm margins and nothing
   * above the heading; the masthead is 36mm of the first sheet and moves every
   * later element down the document, so where the break lands has changed.
   */
  .sig { margin-top: 26px; display: flex; gap: 28px; page-break-inside: avoid; }
  .sigbox { flex: 1; }
  .sigline { border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; margin-top: 44px; }
  .footer { margin-top: 20px; padding-top: 7px; border-top: 1px solid #D5D8DC; color: #888; font-size: 8.5px;
            display: flex; justify-content: space-between; }
`;
}

export function impairmentNoticeHtml(input: ImpairmentNoticeInput): string {
  const { record: r, site, generatedAt } = input;
  const restored = !!r.restoredAt;
  const address = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ');
  const accent = restored ? '#1E7B3C' : brand.red;
  const elapsed = impairmentDuration(
    (r.restoredAt ? Date.parse(r.restoredAt) : Date.parse(generatedAt)) - Date.parse(r.startedAt),
  );
  const who = r.responsibleName || input.responsibleName || '';
  const heading = restored ? 'Impairment Closed' : 'Fire Safety Impairment Notice';

  return letterheaded({
    title: `${heading} — ${site.name}`,
    css: noticeCss(accent, restored),
    body: `
<h1>${heading}</h1>
<div class="sub">${esc(site.name)}${address ? ` — ${esc(address)}` : ''}</div>

<div class="warn">
  ${restored
    ? `<strong>The installation named below has been returned to service.</strong><br/>
       It was out of service for ${esc(elapsed)}. No further interim measures are required on account of this
       impairment.`
    : `<strong>${esc(r.system)} at this building is not in service.</strong><br/>
       ${esc(r.scope) || 'The affected equipment is listed below.'} It will not operate as intended until it is
       restored, and the interim measures set out below need to stay in place until then.`}
  <div class="clock">${restored ? `Out of service for ${esc(elapsed)}` : `Running for ${esc(elapsed)}`}</div>
</div>

<h2>The impairment</h2>
<table>
  <tr><td class="k">Installation affected</td><td>${esc(r.system)}</td></tr>
  <tr><td class="k">Extent</td><td>${lines(r.scope) || 'Not stated'}</td></tr>
  <tr><td class="k">Reason</td><td>${lines(r.reason) || 'Not stated'}</td></tr>
  <tr><td class="k">Declared</td><td>${esc(qldMoment(r.startedAt) ?? r.startedAt)}</td></tr>
  <tr><td class="k">Expected back in service</td><td>${
    r.expectedRestoreAt ? esc(qldMoment(r.expectedRestoreAt) ?? r.expectedRestoreAt) : 'Not yet known'
  }</td></tr>
  <tr><td class="k">Returned to service</td><td>${
    r.restoredAt ? esc(qldMoment(r.restoredAt) ?? r.restoredAt) : '<em>Still out of service</em>'
  }</td></tr>
</table>

${r.isolatedAssets.length ? `<h2>Equipment isolated</h2>
<table><tr><td><ul>${r.isolatedAssets.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></td></tr></table>` : ''}

${restored ? '' : `<h2>While it is out of service</h2>
<div class="warn">
  ${r.alternativeMeasures
    ? lines(r.alternativeMeasures)
    : 'No alternative measures have been recorded. The responsible person should put interim measures in place before this notice is accepted.'}
</div>`}

<h2>What has been done</h2>
<table>
  ${noticeUndertakings(r).map((u) => `<tr><td class="k">${esc(u.label)}</td><td class="${u.done ? 'yes' : 'no'}">${
    u.done ? 'Yes' : 'No'
  }</td></tr>`).join('')}
</table>

${r.notes ? `<h2>Notes</h2><table><tr><td>${lines(r.notes)}</td></tr></table>` : ''}

<h2>Declared by</h2>
<table>
  <tr><td class="k">Company</td><td>${esc(input.companyName)}</td></tr>
  <tr><td class="k">Technician</td><td>${esc(input.technicianName ?? r.technician)}</td></tr>
  <tr><td class="k">Licence number</td><td>${esc(input.technicianLicence)}</td></tr>
  <tr><td class="k">Contact</td><td>${esc(input.companyPhone)}</td></tr>
  <tr><td class="k">Notice issued</td><td>${esc(qldMoment(generatedAt) ?? generatedAt)}</td></tr>
</table>

<div class="sig">
  <div class="sigbox"><div class="sigline"><strong>Technician</strong><br/>${esc(input.technicianName ?? r.technician)}</div></div>
  <div class="sigbox"><div class="sigline"><strong>Received by (responsible person)</strong><br/>${esc(who)}</div></div>
</div>

<div class="note">
  This notice records an impairment to a fire safety installation and the interim measures that were put in place. It
  is issued by ${esc(input.companyName) || 'the maintenance contractor'} and is not an approved statutory form. It does
  not remove any obligation the owner or occupier has under the Building Fire Safety Regulation or under the terms of
  the building&rsquo;s insurance, and where an insurer or a regulator requires notice in a particular form, that form
  still has to be given.
</div>

<div class="footer">
  <span>${esc(site.name)} &middot; ${restored ? 'Impairment closed' : 'Impairment notice'}</span>
  <span>Issued ${esc(qldMoment(generatedAt) ?? generatedAt)}</span>
</div>
`,
  });
}
