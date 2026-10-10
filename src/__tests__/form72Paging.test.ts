/**
 * Where the paper is allowed to end.
 *
 * The owner asked for the output template to be perfect. Everything about this
 * form's layout was decided — the column widths, the units, which blanks print
 * red — except where the page breaks, which fell wherever the renderer
 * happened to put it. Two rules existed in nine parts of CSS: the signature
 * grid stays whole, and the attachment starts a page.
 *
 * Three things that go wrong with no further rules, and all three read as a
 * fault in the test rather than in the printing:
 *
 *   a part's blue heading as the last thing on a sheet, its table overleaf —
 *   "Part E — Booster test" alone at the foot of page two reads as a part with
 *   nothing in it, which is what a part marked N/A looks like;
 *
 *   a table row split down the middle of its cells, a pressure in one page's
 *   footer and its units in the next page's header;
 *
 *   a boxed warning across the fold, so half of why the form is not to be
 *   relied on is on each side. Those are the boxes a reader is meant to stop
 *   at.
 *
 * Asserted on the stylesheet rather than on a rendered page, because nothing
 * in this suite paginates. What can be held is that the rules are there, that
 * they are written in both spellings Chromium's print path wants, and that
 * nothing here forces a break — a rule that said "always" in the wrong place
 * would put a part on a sheet of its own.
 *
 * The pagination itself was measured outside the suite, against Chromium,
 * which is the engine that prints this form. Laid out at the print content box
 * (190mm by 273mm, from the @page rule below) a filled form put Part H's band
 * at the foot of page two with its table on page three, and split one grid row
 * across the fold. Printed to PDF with and without the rules below, the same
 * document's page content changes — about 3KB moves off page one and onto the
 * two after it — and it still comes to three sheets, so nothing here is buying
 * tidiness with an extra page.
 */
import { form72Html } from '@/export/form72';
import { emptyForm72 } from '@/domain/form72';

const HTML = form72Html({
  form: emptyForm72({ id: 'f1', siteId: 's1', siteName: 'Fictional Tower', now: '2026-10-06T00:00:00.000Z' }),
  systemLabel: 'Towns Main System',
  companyName: 'A Contractor',
  generatedAt: '2026-10-06T00:00:00.000Z',
});

/** The declared rules, as one block, so a missing semicolon shows up as a miss. */
const css = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));

describe('a heading never ends a page on its own', () => {
  it('keeps a part’s band with whatever follows it', () => {
    expect(css).toMatch(/\.band \{[^}]*break-after: avoid/);
    expect(css).toMatch(/\.band \{[^}]*page-break-after: avoid/);
  });

  it('keeps the department’s note under a band with it too', () => {
    // The note is printed between the band and the table, so a rule on the
    // band alone would let the break fall one line lower and change nothing.
    expect(css).toMatch(/\.note, \.intro \{[^}]*break-after: avoid/);
  });
});

describe('a row is not split down the middle of its cells', () => {
  it('keeps every grid row whole', () => {
    expect(css).toMatch(/table\.grid tr \{[^}]*break-inside: avoid/);
    expect(css).toMatch(/table\.grid tr \{[^}]*page-break-inside: avoid/);
  });

  it('still lets a long table break between its rows', () => {
    /*
     * Part D's flow table on a six-hydrant site is taller than a page, so the
     * table itself has to be allowed to break — only its rows must not. A rule
     * on table.grid rather than on its rows would push the whole table to the
     * next sheet and leave a third of a page blank, or overflow it.
     */
    expect(css).not.toMatch(/table\.grid \{[^}]*break-inside: avoid/);
  });

  it('keeps the one table that must not break at all', () => {
    // Part I. The licensee's name on one page and the signature box on the
    // next is the argument an occupier's solicitor makes in a year's time.
    expect(css).toMatch(/table\.grid\.sig \{ page-break-inside: avoid; break-inside: avoid; \}/);
  });
});

describe('the boxes a reader is meant to stop at', () => {
  it.each([
    ['the DRAFT stamp', 'stamp'],
    ['a caution', 'caution'],
    ['the issues list', 'issues'],
    ['a stated figure', 'stated'],
    ['the department’s note', 'deptnote'],
    ['the department’s fine print', 'deptfine'],
  ])('keeps %s whole', (_what, className) => {
    const rule = css.match(new RegExp(`\\.${className}[^{]*\\{[^}]*break-inside: avoid[^}]*\\}`));
    expect({ className, kept: Boolean(rule) }).toEqual({ className, kept: true });
  });

  it('keeps the declaration whole, which is the sentence being signed', () => {
    expect(css).toMatch(/\.decl \{[^}]*break-inside: avoid/);
  });
});

describe('nothing forces a break except the attachment', () => {
  it('only the attachment page starts a sheet of its own', () => {
    const forced = [...css.matchAll(/(break-before|page-break-before|break-after|page-break-after)\s*:\s*(always|page)/g)];
    expect(forced).toHaveLength(2);
    expect(css).toMatch(/\.attachpage \{ page-break-before: always; break-before: page; \}/);
  });

  it('every other rule only says where a break must not fall', () => {
    // A rule that said "always" in the wrong place would put a part on a sheet
    // of its own, which is the opposite of the fault being fixed.
    const avoids = [...css.matchAll(/break-(inside|after|before)\s*:\s*avoid/g)];
    expect(avoids.length).toBeGreaterThan(8);
  });
});
