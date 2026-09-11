import { company } from '@/theme/brand';
import { LETTERHEAD_FOOTER_DATA_URI, LETTERHEAD_HEADER_DATA_URI } from './letterheadArt';

/**
 * The Safe QLD letterhead, for anything the app prints or emails.
 *
 * A report leaving this app lands in a building manager's inbox next to the
 * ones the office sends, and until now it arrived on blank white paper with no
 * mark on it at all. That is the difference between a document that looks like
 * the company's and one that looks like a printout.
 *
 * Deliberately free of any React Native import so it can be unit-tested and so
 * every document builder can use it without dragging a view layer in.
 *
 * The band and swoosh are the office's own artwork. The entity line underneath
 * is real text drawn from the shared `company` constants, so the ABN and phone
 * number stay correct and selectable even though the artwork above them cannot
 * be edited.
 */

/**
 * Page furniture, in normal flow rather than fixed to each page.
 *
 * `position: fixed` is the obvious way to repeat a letterhead on every sheet,
 * and it was tried first. It does not work here, for two measured reasons.
 * Chrome clips a fixed element to the page's content box, so a swoosh nudged
 * into the bottom margin to bleed off the paper edge is simply cut off — at a
 * -16mm offset only a two-millimetre sliver survived. And a fixed footer inside
 * the content box does not push text aside: the last table on a full page runs
 * straight underneath it.
 *
 * So the masthead opens the document and the swoosh closes it, which is how the
 * printed stock reads anyway. A dozen-page asset register does not spend an
 * eighth of every sheet on a logo the reader saw on page one, and no page can
 * collide with its own furniture.
 *
 * Heights are the artwork's own proportions, never a chosen number: the source
 * page is 2480px wide, the masthead crop 470px tall and the swoosh 267px, so
 * across a 190mm column they come to 36.0mm and 20.5mm. `height: auto` keeps
 * that true at any page size — a fixed height is what makes a logo look
 * stretched on someone's letterhead.
 */
export const LETTERHEAD_CSS = `
  @page { size: A4; margin: 8mm 10mm 10mm; }
  .lh-header { display: block; width: 100%; margin: 0 0 6mm; }
  .lh-footer { display: block; width: 100%; margin: 8mm 0 0; page-break-inside: avoid; }
  .lh-header img, .lh-footer img { display: block; width: 100%; height: auto; }
  .lh-entity {
    text-align: center; font-size: 6.5px; color: #6B6B6B; letter-spacing: 0.2px;
    margin-top: 10mm; page-break-inside: avoid;
  }
`;

/** The repeating top band. Place once, immediately inside `<body>`. */
export function letterheadHeaderHtml(): string {
  return `<div class="lh-header"><img src="${LETTERHEAD_HEADER_DATA_URI}" alt="Safe QLD Fire Protection" /></div>`;
}

/**
 * The repeating foot: the swoosh, and the entity line above it.
 *
 * The legal name and ABN are here rather than in the artwork because they are
 * the parts that must be right, and pixels cannot be corrected without new
 * artwork from the office.
 */
export function letterheadFooterHtml(): string {
  const line = [
    company.legalName,
    `ABN ${company.abn}`,
    company.address,
    `P ${company.phone}`,
    company.email,
  ].join(' · ');
  return `<div class="lh-entity">${escapeHtml(line)}</div>`
    + `<div class="lh-footer"><img src="${LETTERHEAD_FOOTER_DATA_URI}" alt="" /></div>`;
}

/**
 * Wraps a document body in the letterhead.
 *
 * Takes the caller's own CSS so each document keeps its own layout; only the
 * letterhead rules are added, and they come last so the body padding here wins
 * over a `body { margin: 0 }` in the document's own stylesheet.
 */
export function letterheaded(options: { title?: string; css: string; body: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />`
    + (options.title ? `<title>${escapeHtml(options.title)}</title>` : '')
    + `<style>${options.css}${LETTERHEAD_CSS}</style></head><body>`
    + letterheadHeaderHtml()
    + options.body
    + letterheadFooterHtml()
    + `</body></html>`;
}

/** Minimal escape for the few plain strings this module writes into markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
