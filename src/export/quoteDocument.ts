import {
  GST_RATE_SOURCE, GST_ROUNDING_SOURCE, QUOTE_STATUS_LABEL, lineAmountCents, quoteTotals,
  scopeForReprint, type Quote, type QuoteLine, type QuoteSection, type QuoteTotals, type ScopeLine,
} from '@/domain/quote';
import { formatCents } from '@/domain/rates';
import { letterheaded } from './letterhead';
import { formatAuDate } from './sheets';

/**
 * The quote a client actually receives.
 *
 * Written to be signed. Everything on it exists because leaving it off has cost
 * somebody money:
 *
 *  - Materials and labour are separate sections with their own subtotals,
 *    because that is the first thing a facilities manager asks about.
 *  - A line nobody has priced prints as "not priced" and is stated to be
 *    outside the total. It never prints as $0.00, which reads as included.
 *  - Defects on the job that produced no priced work are listed by name under
 *    the total, so a quote covering eleven of fourteen defects cannot be
 *    mistaken for the whole job.
 *  - GST is shown once, on its own line, worked on the subtotal.
 *  - The exclusions are printed. An unstated exclusion is an argument on the
 *    day, and the technician is the one standing there having it.
 *  - The acceptance block asks for a name, a position, a signature and a date.
 *    An emailed "yes please" is not something anyone can point to later.
 *
 * What it leaves off is where each figure came from. The rate card, the
 * catalogue and a price typed on site are the company's business, and a line
 * like "Price entered on this quote by <technician>" on the client's copy
 * invites the client to argue with the technician rather than the quote. The
 * sources stay on the stored lines for the office.
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

/** Quantities print as written: 3, or 1.75 hours. Trailing zeros are noise. */
function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export interface QuoteDocumentInput {
  quote: Quote;
  /**
   * Who the quotation is from, as a row in the details table.
   *
   * It used to be a centred line under the title with the ABN, phone and email
   * stacked beneath it. The letterhead foot prints all of that now, from the
   * shared company constants, so the head was the entity a second time — and in
   * a different form, because this value comes from the office's preferences
   * while the foot carries the registered name. A quotation that names the
   * quoting party two different ways is a quotation somebody queries.
   */
  companyName?: string;
  /**
   * No longer printed. The letterhead foot carries the ABN, the phone number and
   * the email address for every document the app produces, so a quotation that
   * also printed them under the title printed them twice and could disagree with
   * itself. These three are kept on the interface only because the two screens
   * that build a quotation still pass them; they can go once those call sites do.
   */
  companyAbn?: string;
  companyPhone?: string;
  companyEmail?: string;
  /**
   * The work in plain English, from scopeLinesFor. Left out, the scope stored
   * with the quote is printed (scopeForReprint), which is what a reprint wants.
   */
  scopeItems?: ScopeLine[];
  /** Payment and access terms, one per line. Defaults below. */
  terms?: string[];
  /** The date the document is produced, for the lapse warning. */
  asAt?: string;
}

/**
 * What the client is agreeing to beyond the price.
 *
 * Deliberately short and readable. A page of small print is not read, and a
 * term nobody read is a term nobody agreed to.
 */
export const DEFAULT_TERMS: string[] = [
  'This quotation is an offer to carry out the work described. It becomes a contract when it is '
  + 'accepted in writing.',
  'The price holds good until the date shown above. After that date the work is re-quoted at the '
  + 'rates current at the time.',
  'Quantities are taken from the defects recorded at the last attendance. Faults that were not '
  + 'visible then, and work found necessary once panels or fittings are opened, are quoted '
  + 'separately before being carried out.',
  'The work is carried out during normal business hours by arrangement with the site. Isolations '
  + 'and any required fire watch remain the responsibility of the site occupier unless stated here.',
  'Prices exclude GST unless a line says otherwise. GST is shown separately below.',
];

/*
 * The quotation's own stylesheet.
 *
 * There is no `@page` rule here and there never was, so the letterhead's
 * 8mm/10mm/10mm page box applies. That is the right box rather than merely the
 * inherited one: the masthead artwork is drawn to the width of that box, and a
 * margin set here would leave the band floating inside the sheet instead of
 * sitting where the printed stock has it.
 *
 * `.sub` still exists because the status line ("Draft — not a final issued
 * quotation") uses it. What it no longer styles is the company name, ABN, phone
 * and email that used to sit centred under the title; the letterhead foot prints
 * those now.
 */
const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #1b1b1b; margin: 0; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 2px; letter-spacing: 0.4px; }
  h2 { font-size: 12px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: 0.5px;
       border-bottom: 1.5px solid #1b1b1b; padding-bottom: 3px; }
  h3 { font-size: 11px; margin: 16px 0 6px; }
  p { margin: 0 0 8px; line-height: 1.5; }
  ul { margin: 0 0 8px; padding-left: 18px; }
  li { margin-bottom: 4px; line-height: 1.5; }
  .sub { text-align: center; font-size: 11px; margin: 0 0 4px; letter-spacing: 0.3px; }
  .who { text-align: center; font-size: 12px; font-weight: bold; margin: 14px 0 2px; }
  .where { text-align: center; font-size: 11px; margin: 0 0 14px; }
  .status { text-align: center; font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase;
            margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  .meta td { border: 1px solid #999; padding: 5px 7px; }
  .meta td:first-child { width: 32%; background: #f2f2f2; font-weight: bold; }
  .note { border: 1px solid #999; background: #f7f7f7; padding: 8px 10px; margin: 10px 0;
          font-size: 9.5px; line-height: 1.5; }
  .note b { display: block; margin-bottom: 3px; }
  .warn { border: 1.5px solid #8a1c1c; background: #fbf2f2; }
  .items th { background: #1b1b1b; color: #fff; font-size: 8.5px; text-transform: uppercase;
              letter-spacing: 0.4px; padding: 5px 6px; text-align: left; }
  .items td { border: 1px solid #bbb; padding: 5px 6px; vertical-align: top; font-size: 9.5px;
              line-height: 1.45; }
  .items .num { text-align: right; white-space: nowrap; width: 76px; }
  .items .q { text-align: right; white-space: nowrap; width: 62px; }
  .items .src { font-size: 8.5px; color: #444; }
  .items .none { color: #8a1c1c; font-weight: bold; }
  .sect td { background: #f2f2f2; font-weight: bold; }
  .totals { margin-top: 10px; }
  .totals td { padding: 4px 7px; font-size: 10.5px; }
  .totals td:first-child { text-align: right; }
  .totals td:last-child { text-align: right; width: 120px; white-space: nowrap; }
  .totals .grand td { border-top: 1.5px solid #1b1b1b; border-bottom: 3px double #1b1b1b;
                      font-weight: bold; font-size: 12px; }
  /*
   * The acceptance block is what the client signs and sends back, and it is
   * seven rows of about 34px each — roughly 65mm, comfortably inside a page. Let
   * it split and the client gets "Accepted for the client by" and "Position
   * held" at the foot of one sheet and the signature and date lines at the top of
   * the next, which is how a quotation comes back signed in one place with the
   * date blank. It was never guarded; the letterhead changing the page box from
   * no rule at all to 8mm/10mm/10mm and adding 36mm of masthead to the first
   * sheet moves every break in the document, so it is guarded now.
   */
  .accept { page-break-inside: avoid; }
  .accept td { border: 1px solid #999; padding: 9px 7px; height: 34px; vertical-align: bottom; }
  .accept td:first-child { width: 30%; background: #f2f2f2; font-weight: bold;
                           text-transform: uppercase; font-size: 9px; letter-spacing: 0.4px; }
  .sig { border-bottom: 1px solid #1b1b1b; height: 26px; }
  .foot { margin-top: 18px; font-size: 8.5px; color: #444; line-height: 1.5; font-style: italic; }
  .confidential { text-align: center; font-size: 8.5px; letter-spacing: 1px; margin: 12px 0;
                  text-transform: uppercase; }
`;

function metaTable(input: QuoteDocumentInput): string {
  const q = input.quote;
  const rows: [string, string | undefined][] = [
    ['Quotation From', input.companyName],
    ['Quotation Number', q.reference],
    ['Date of Issue', q.issuedAt ? formatAuDate(q.issuedAt) : 'Not yet issued'],
    ['Valid Until', q.expiresAt ? formatAuDate(q.expiresAt) : `${q.validityDays} days from issue`],
    ['Client', q.clientName],
    ['Site', q.siteName],
    ['Site Address', q.siteAddress],
    ['Attention', q.contactName],
    ['Job Reference', q.jobReference],
    ['Prepared By', q.preparedBy],
  ];
  return `<table class="meta">${rows
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

/**
 * One priced section.
 *
 * An unpriced line keeps its row. Dropping it would hide work the client asked
 * about; printing it at $0.00 would give it away.
 */
function sectionRows(lines: QuoteLine[], section: QuoteSection): string {
  const of = lines.filter((l) => l.section === section);
  if (!of.length) {
    return `<tr><td colspan="4">Nothing under this heading.</td></tr>`;
  }
  return of.map((l) => {
    const amount = lineAmountCents(l);
    const traced = l.fromCodes.length
      ? `<div class="src">${esc(l.defectCount)} defect${l.defectCount === 1 ? '' : 's'} — ${esc(l.fromCodes.join(', '))}</div>`
      : '';
    return `<tr>
      <td>${esc(l.description)}${traced}</td>
      <td class="q">${esc(qty(l.quantity))} ${esc(l.unit)}</td>
      <td class="num">${l.unitCents === undefined ? '<span class="none">—</span>' : esc(formatCents(l.unitCents))}</td>
      <td class="num">${amount === undefined
    ? '<span class="none">Not priced</span>'
    : esc(formatCents(amount))}</td>
    </tr>`;
  }).join('');
}

function itemsTable(quote: Quote, totals: QuoteTotals): string {
  return `<table class="items">
    <tr><th>Description</th><th class="q">Qty</th><th class="num">Unit (ex GST)</th><th class="num">Amount (ex GST)</th></tr>
    <tr class="sect"><td colspan="4">Materials</td></tr>
    ${sectionRows(quote.lines, 'materials')}
    <tr class="sect"><td colspan="3">Materials subtotal</td><td class="num">${esc(formatCents(totals.materialsCents))}</td></tr>
    <tr class="sect"><td colspan="4">Labour</td></tr>
    ${sectionRows(quote.lines, 'labour')}
    <tr class="sect"><td colspan="3">Labour subtotal</td><td class="num">${esc(formatCents(totals.labourCents))}</td></tr>
  </table>`;
}

function totalsTable(quote: Quote, totals: QuoteTotals): string {
  const rows: string[] = [
    `<tr><td>Materials</td><td>${esc(formatCents(totals.materialsCents))}</td></tr>`,
    `<tr><td>Labour</td><td>${esc(formatCents(totals.labourCents))}</td></tr>`,
  ];
  if (totals.discountCents !== 0) {
    // A negative discount adds to the price. Printed as "Discount $50.00" it
    // reads to the client as fifty dollars off while the subtotal has gone
    // fifty dollars up, and the column no longer adds up in front of them. It
    // is named for what it does instead.
    const adding = totals.discountCents < 0;
    const label = adding ? 'Additional amount' : 'Discount';
    rows.push(`<tr><td>${label}${quote.discountReason ? ` — ${esc(quote.discountReason)}` : ''}</td>`
      + `<td>${esc(formatCents(-totals.discountCents))}</td></tr>`);
  }
  rows.push(`<tr><td>Subtotal (ex GST)</td><td>${esc(formatCents(totals.subtotalCents))}</td></tr>`);
  // GST on its own line, always, even at nil. A total that merely "includes
  // GST" makes the client work it out, and they work it out differently.
  rows.push(`<tr><td>GST at ${esc((quote.taxRate * 100).toFixed(0))}%</td><td>${esc(formatCents(totals.gstCents))}</td></tr>`);
  rows.push(`<tr class="grand"><td>Total payable (inc GST)</td><td>${esc(formatCents(totals.totalCents))}</td></tr>`);
  return `<table class="totals">${rows.join('')}</table>`;
}

function notPricedNote(totals: QuoteTotals, quote: Quote): string {
  const bits: string[] = [];
  if (totals.unpricedLines.length) {
    bits.push(
      'Shown above without a price and not included in the total: '
      + `${totals.unpricedLines.map((l) => l.description).join('; ')}. `
      + 'We will price these before any work on them is carried out.',
    );
  }
  if (quote.unpriceable.length) {
    bits.push(
      'Recorded at this site but not covered by this quotation: '
      + `${quote.unpriceable.map((u) => `${u.location ? `${u.location} — ` : ''}${u.description || u.defectCode || 'unspecified defect'}`).join('; ')}. `
      + 'Please contact us to have these scoped.',
    );
  }
  if (!bits.length) return '';
  return `<div class="note warn"><b>Not included in the total above</b>${bits.map((b) => esc(b)).join('<br /><br />')}</div>`;
}

export function quoteDocumentHtml(input: QuoteDocumentInput): string {
  const q = input.quote;
  const totals = quoteTotals(q, input.asAt);
  const terms = (input.terms ?? DEFAULT_TERMS).filter((t) => t.trim());
  const scope = (input.scopeItems ?? scopeForReprint(q)).filter((s) => s.text.trim());

  return letterheaded({
    title: `Quotation ${q.reference} — ${q.siteName}`,
    css: CSS,
    body: `
    <h1>Quotation — Fire Protection Rectification Works</h1>

    <div class="who">${esc(q.clientName)}</div>
    <div class="where">${esc(q.siteName)}${q.siteAddress ? `<br />${esc(q.siteAddress)}` : ''}</div>
    ${q.status !== 'issued'
    ? `<div class="status">${esc(QUOTE_STATUS_LABEL[q.status])} — not a final issued quotation</div>`
    : ''}

    ${metaTable(input)}

    <div class="confidential">Commercial in Confidence</div>

    <h2>1. Scope of Works</h2>
    <p>We are pleased to quote for rectification of the following defects recorded at
      ${esc(q.siteName)}. The work restores the affected equipment to working order so the system
      performs as it was designed to.</p>
    ${scope.length
    ? `<ul>${scope.map((s) => `<li>${s.location ? `<b>${esc(s.location)}</b> — ` : ''}${esc(s.text)}</li>`).join('')}</ul>`
    : '<p>No scope items were recorded against this quotation.</p>'}
    ${paras(q.scopeNote)}

    <h2>2. Priced Items</h2>
    ${itemsTable(q, totals)}
    ${notPricedNote(totals, q)}

    <h2>3. Quotation Total</h2>
    ${totalsTable(q, totals)}
    ${totals.incomplete
    ? '<p class="foot">This total covers the priced items above only. The note above lists what '
      + 'it does not include.</p>'
    : ''}

    <h2>4. What Is and Is Not Included</h2>
    <p>Included: supply and installation of the items listed above, testing of the affected
      equipment after the work, updating the site records, and a written record of the work
      carried out.</p>
    ${q.exclusions.length
    ? `<p>Not included:</p><ul>${q.exclusions.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '<p>No exclusions have been stated on this quotation.</p>'}

    <h2>5. Terms</h2>
    <ul>${terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    ${q.notes ? paras(q.notes) : ''}

    <h2>6. Acceptance</h2>
    <p>To accept this quotation, please sign below and return a copy. The total accepted is
      <b>${esc(formatCents(totals.totalCents))}</b> including GST${
  q.expiresAt ? `, valid until ${esc(formatAuDate(q.expiresAt))}` : ''}.</p>
    <table class="accept">
      <tr><td>Quotation number</td><td>${esc(q.reference)}</td></tr>
      <tr><td>Total accepted (inc GST)</td><td>${esc(formatCents(totals.totalCents))}</td></tr>
      <tr><td>Accepted for the client by</td><td class="sig"></td></tr>
      <tr><td>Position held</td><td class="sig"></td></tr>
      <tr><td>Signature</td><td class="sig"></td></tr>
      <tr><td>Date</td><td class="sig"></td></tr>
      <tr><td>Purchase order number</td><td class="sig"></td></tr>
    </table>

    <p class="foot">${esc(GST_RATE_SOURCE.label)}
      ${esc(GST_ROUNDING_SOURCE.label)}
      GST is therefore worked once on the subtotal above and may differ by a cent from the GST on
      each line added together.
      This document is a quotation and is not a tax invoice.
      A tax invoice is issued on completion of the work.</p>
`,
  });
}
