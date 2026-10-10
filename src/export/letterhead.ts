import { company } from '@/theme/brand';
import { LETTERHEAD_HEADER_DATA_URI } from './letterheadArt';

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
 * The masthead is the office's own artwork: the full logo on its band. The
 * entity line at the foot is real text drawn from the shared `company`
 * constants, so the ABN and phone number stay correct and selectable even
 * though the artwork cannot be edited. There is no artwork at the foot. The
 * orange swoosh that used to close every page went at the owner's ask: on its
 * own, without the logo, it was decoration nobody wanted on their paperwork.
 */

/**
 * The page box, kept separate from the furniture so a caller can have its own.
 *
 * This rule used to be the first line of LETTERHEAD_CSS, and because that block
 * is appended after the caller's stylesheet it won the cascade against every
 * caller that set its own page margins. `routineServiceReport`'s
 * `@page { size: A4; margin: 12mm 10mm 16mm }` has been in that file since the
 * report was written and has never once reached the printer: the letterhead's
 * 8mm/10mm/10mm came later in the stylesheet, and for @page the later
 * declaration wins the same way it does anywhere else. Nothing looked broken
 * enough to chase — the report still printed, just with the wrong bottom
 * margin and the signature block sitting further down the sheet than intended.
 *
 * Two things follow from that. The default page box is emitted *before* the
 * caller's CSS now, so a document that declares its own @page wins on ordering
 * the way its author assumed it did. And a document that only knows its page
 * box at runtime passes it in as the `page` option instead of declaring a rule
 * — the zone chart flips to landscape when a panel has more zones than fit down
 * a portrait column, and a hardcoded `size: A4` in here would quietly flip it
 * back to portrait and cut the right-hand column off the paper.
 */
export const LETTERHEAD_PAGE = 'size: A4; margin: 8mm 10mm 10mm;';

/**
 * The default page box as a complete rule, for a caller that wants to place it
 * itself (a document assembling its own `<style>` without `letterheaded`).
 */
export const LETTERHEAD_PAGE_CSS = `@page { ${LETTERHEAD_PAGE} }`;

/**
 * Page furniture, in normal flow rather than fixed to each page.
 *
 * `position: fixed` is the obvious way to repeat a letterhead on every sheet,
 * and it was tried first. It does not work here, for two measured reasons.
 * Chrome clips a fixed element to the page's content box, so artwork nudged
 * into the margin to bleed off the paper edge is simply cut off — at a -16mm
 * offset only a two-millimetre sliver survived. And a fixed footer inside the
 * content box does not push text aside: the last table on a full page runs
 * straight underneath it.
 *
 * So the masthead opens the document and the entity line closes it. A
 * dozen-page asset register does not spend an eighth of every sheet on a logo
 * the reader saw on page one, and no page can collide with its own furniture.
 *
 * The masthead's height is the artwork's own proportion, never a chosen
 * number: the source page is 2480px wide and the masthead crop 470px tall, so
 * across a 190mm column it comes to 36.0mm. `height: auto` keeps that true at
 * any page size — a fixed height is what makes a logo look stretched on
 * someone's letterhead.
 *
 * The `body { margin: 0 }` is here, after the caller's own stylesheet, on
 * purpose: the paper inset is the job of the @page margin, and a body margin on
 * top of it insets the masthead again so the band no longer lines up with the
 * printed stock. Every document but the SWMS already set `margin: 0` on body,
 * and the SWMS did not, which is why those two were the only letterheaded
 * documents in the app and their mastheads sat at different heights. A document
 * that wants breathing room inside the page box should pad a wrapper element or
 * set `body { padding }`, both of which this rule leaves alone.
 */
export const LETTERHEAD_CSS = `
  body { margin: 0; }
  .lh-header { display: block; width: 100%; margin: 0 0 6mm; }
  .lh-header img { display: block; width: 100%; height: auto; }
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
 * The foot: the entity line, as text.
 *
 * The legal name and ABN are text rather than artwork because they are the
 * parts that must be right, and pixels cannot be corrected without new artwork
 * from the office.
 */
export function letterheadFooterHtml(): string {
  const line = [
    company.legalName,
    `ABN ${company.abn}`,
    company.address,
    `P ${company.phone}`,
    company.email,
  ].join(' · ');
  return `<div class="lh-entity">${escapeHtml(line)}</div>`;
}

/**
 * Wraps a document body in the letterhead.
 *
 * Takes the caller's own CSS so each document keeps its own layout. The pieces
 * go into the stylesheet in a deliberate order, and the order is the whole
 * subtlety of this function:
 *
 *  1. the page box, first, so a caller that declares its own `@page` overrides
 *     it just by being later in the stylesheet;
 *  2. the caller's stylesheet;
 *  3. the letterhead furniture, last, so a document with a broad rule of its
 *     own — an `img { width: 50% }` in a photo report, a `div { border }` in a
 *     table-heavy form — cannot shrink the masthead or box the entity line.
 *
 * The docstring that used to be here said the furniture came last so that the
 * letterhead's body padding beat a caller's `body { margin: 0 }`. That was
 * wrong twice over: LETTERHEAD_CSS had no body rule at all, and what appending
 * last actually did was override the caller's `@page`. Correcting it here
 * because the next person to read this file would otherwise reach the same
 * wrong conclusion and move the block back.
 *
 * `page` holds the body of the @page rule — `size: A4 landscape; margin: 10mm`
 * — for a document that works its page box out at runtime. Omit it and the
 * standard A4 letterhead page is used.
 *
 * `masthead: false` prints the document without the top band. Form 72 needs
 * that: it is an approved form with its own full-width statutory head, and
 * stacking the Safe QLD band above it gives the reader two mastheads and pushes
 * the signature part onto a second page. Such a document still gets the foot,
 * because the entity line carries the legal name and ABN, and a document
 * leaving this company without its ABN on it is a different problem.
 */
export function letterheaded(options: {
  title?: string;
  css: string;
  body: string;
  page?: string;
  masthead?: boolean;
}): string {
  const page = `@page { ${options.page ?? LETTERHEAD_PAGE} }`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />`
    + (options.title ? `<title>${escapeHtml(options.title)}</title>` : '')
    + `<style>${page}${options.css}${LETTERHEAD_CSS}</style></head><body>`
    + (options.masthead === false ? '' : letterheadHeaderHtml())
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
