import { company } from '@/theme/brand';
import { LETTERHEAD_HEADER_DATA_URI } from '@/export/letterheadArt';
import { LETTERHEAD_CSS, LETTERHEAD_PAGE, LETTERHEAD_PAGE_CSS, letterheaded } from '@/export/letterhead';
import { routineServiceReportHtml } from '@/export/routineServiceReport';

/**
 * The letterhead.
 *
 * A report from this app lands in a building manager's inbox beside the ones
 * the office sends, so it either looks like the company's paperwork or it looks
 * like a printout. Most of what can go wrong here is silent: a data URI that
 * decodes to nothing renders as a broken image, a fixed height stretches the
 * logo, and a bundled-file reference works perfectly on the phone that made the
 * document and nowhere else.
 */

function decode(dataUri: string): Buffer {
  const comma = dataUri.indexOf(',');
  return Buffer.from(dataUri.slice(comma + 1), 'base64');
}

describe('the embedded artwork', () => {
  it.each([
    ['header', LETTERHEAD_HEADER_DATA_URI],
  ])('%s is a real JPEG, not a truncated string', (_name, uri) => {
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    const bytes = decode(uri);
    // JPEG starts FF D8 FF and ends FF D9. A base64 chunk list that lost a
    // comma, or a copy that dropped its tail, still looks like a plausible
    // string and produces a broken image in the document.
    expect({
      soi: bytes.subarray(0, 3).toString('hex'),
      eoi: bytes.subarray(-2).toString('hex'),
    }).toEqual({ soi: 'ffd8ff', eoi: 'ffd9' });
  });

  it.each([
    ['header', LETTERHEAD_HEADER_DATA_URI, 20_000],
  ])('%s is big enough to be the artwork and small enough to email', (_name, uri, floor) => {
    const bytes = decode(uri).length;
    expect({ bytes, plausible: bytes > floor && bytes < 120_000 })
      .toEqual({ bytes, plausible: true });
  });
});

describe('page furniture', () => {
  it('lets the artwork set its own height', () => {
    // The masthead is 2480x470; pinning a height instead of letting the width
    // drive it squashes the logo, which is precisely what a stretched logo on
    // someone's letterhead looks like.
    expect(LETTERHEAD_CSS).toMatch(/\.lh-header img[^}]*height:\s*auto/);
    expect(LETTERHEAD_CSS).not.toMatch(/\.lh-header\s*\{[^}]*height:\s*\d/);
  });

  it('keeps the entity line out of the flow of a page break, and carries no foot artwork', () => {
    // The orange swoosh that closed every page is gone at the owner's ask;
    // nothing at the foot but the entity line, which must not split.
    expect(LETTERHEAD_CSS).toMatch(/\.lh-entity[^}]*page-break-inside:\s*avoid/);
    expect(LETTERHEAD_CSS).not.toContain('lh-footer');
  });

  it('carries no page box of its own', () => {
    // The furniture block is appended after the caller's stylesheet, so an
    // @page in here wins against the caller's whether or not that was intended
    // — which is exactly how the routine service report lost its own margins.
    // The page box lives in LETTERHEAD_PAGE_CSS, which goes in first.
    expect(LETTERHEAD_CSS).not.toContain('@page');
    expect(LETTERHEAD_PAGE_CSS).toBe(`@page { ${LETTERHEAD_PAGE} }`);
  });

  it('does not position furniture with `fixed`', () => {
    // Tried and measured: Chrome clips a fixed element to the page content box,
    // so artwork offset into the bottom margin is cut off, and a fixed footer
    // inside the box has body text run underneath it on a full page.
    expect(LETTERHEAD_CSS).not.toMatch(/position:\s*fixed/);
  });
});

describe('letterheaded()', () => {
  const doc = letterheaded({ title: 'Test', css: '.x{color:red}', body: '<p id="content">body</p>' });

  it('opens with the masthead and closes with the entity line, with no artwork at the foot', () => {
    // Measured inside <body> only. Both class names appear in the stylesheet
    // first, so searching the whole document finds the CSS rule and reports
    // the footer as coming before the content no matter where it is.
    const body = doc.slice(doc.indexOf('<body>'));
    const header = body.indexOf('lh-header');
    const content = body.indexOf('id="content"');
    const footer = body.indexOf('lh-entity');
    expect({ headerFirst: header < content, footerLast: footer > content, allPresent: header >= 0 && footer >= 0 })
      .toEqual({ headerFirst: true, footerLast: true, allPresent: true });
    expect(body).not.toContain('lh-footer');
    // One image on the page: the masthead. Nothing drawn at the foot.
    expect((body.match(/<img /g) ?? []).length).toBe(1);
  });

  it('keeps the caller\'s own stylesheet', () => {
    expect(doc).toContain('.x{color:red}');
  });

  it('puts the furniture rules after the document\'s own so a broad rule cannot reach them', () => {
    // The furniture comes last so a document-wide `img { width: 50% }` or
    // `div { border }` cannot shrink the masthead or box the entity line. Note this
    // is NOT, as the docstring used to claim, about beating a caller's
    // `body { margin: 0 }` — see the @page tests below for what appending last
    // was really doing before this was split up.
    expect(doc.indexOf('.x{color:red}')).toBeLessThan(doc.indexOf('.lh-header {'));
  });

  it('normalises the body margin so every document\'s masthead sits in the same place', () => {
    // The paper inset is the @page margin's job. A body margin on top of it
    // insets the band again, and the SWMS (which set no body margin) printed
    // its masthead lower than the routine service report (which set 0) for
    // exactly that reason.
    expect(LETTERHEAD_CSS).toMatch(/body\s*\{[^}]*margin:\s*0/);
    const styles = doc.slice(doc.indexOf('<style>'), doc.indexOf('</style>'));
    expect(styles.indexOf('.x{color:red}')).toBeLessThan(styles.search(/body\s*\{[^}]*margin:\s*0/));
  });

  it('prints the entity details as real text, not as part of the picture', () => {
    // The artwork cannot be corrected without new art from the office, and the
    // ABN is the part that has to be right. It is also what makes the document
    // searchable.
    for (const value of [company.legalName, company.abn, company.phone, company.email]) {
      expect({ value, present: doc.includes(value) }).toEqual({ value, present: true });
    }
  });

  it('escapes the title rather than pasting it into markup', () => {
    const evil = letterheaded({ title: 'A "<script>" & co', css: '', body: '' });
    expect(evil).toContain('<title>A &quot;&lt;script&gt;&quot; &amp; co</title>');
    expect(evil).not.toContain('<script>');
  });
});

describe('the page box', () => {
  /** The rules inside the document's one stylesheet, which is where the cascade happens. */
  function styles(html: string): string {
    return html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));
  }

  it('uses the standard A4 letterhead page when the caller asks for nothing', () => {
    const doc = letterheaded({ css: '.x{color:red}', body: '' });
    expect(styles(doc)).toContain(`@page { ${LETTERHEAD_PAGE} }`);
  });

  it('prints the page box the caller asked for, including a landscape sheet', () => {
    // Not hypothetical: the zone chart turns the paper sideways when a panel has
    // more zones than fit down a portrait column. A letterhead that forced
    // `size: A4` would rotate it back and cut the second column off the sheet.
    const doc = letterheaded({ css: '.x{color:red}', body: '', page: 'size: A4 landscape; margin: 10mm;' });
    expect(styles(doc)).toContain('@page { size: A4 landscape; margin: 10mm; }');
    expect(styles(doc)).not.toContain('size: A4;');
  });

  it('declares the page box exactly once for a document that has none of its own', () => {
    // Two @page rules is not an error, it is just something to reason about;
    // for the common case there should be nothing to reason about.
    const doc = letterheaded({ css: '.x{color:red}', body: '', page: 'size: A5; margin: 5mm;' });
    expect(doc.match(/@page/g)).toHaveLength(1);
  });

  it('lets a document that declares its own @page beat the letterhead default', () => {
    // This is the regression the split exists for. The letterhead's @page used
    // to be appended after the caller's stylesheet, so a document that set its
    // own page margins lost silently — the rule was right there in the file and
    // simply never applied. Asserted on cascade order, because that is what
    // decides it: at equal specificity the later declaration wins.
    const doc = letterheaded({ css: '@page { size: A4; margin: 12mm 10mm 16mm; }', body: '' });
    const sheet = styles(doc);
    expect({
      letterheadFirst: sheet.indexOf(LETTERHEAD_PAGE) < sheet.indexOf('margin: 12mm 10mm 16mm'),
      callerPresent: sheet.includes('margin: 12mm 10mm 16mm'),
    }).toEqual({ letterheadFirst: true, callerPresent: true });
  });

  it('gives the routine service report the margins its own stylesheet asks for', () => {
    // The real document, not a fixture: routineServiceReport has asked for
    // 12mm/10mm/16mm since it was written and, until the split, printed on the
    // letterhead's 8mm/10mm/10mm instead.
    const html = routineServiceReportHtml({
      customer: { name: 'A Customer' },
      site: { name: 'A Site' },
      sections: [],
    });
    const sheet = styles(html);
    expect(sheet.indexOf(LETTERHEAD_PAGE)).toBeLessThan(sheet.indexOf('margin: 12mm 10mm 16mm'));
  });
});

describe('a document that wants the foot but not the masthead', () => {
  // Form 72 is an approved form with its own full-width statutory head. Stacking
  // the Safe QLD band above it gives the reader two mastheads and pushes the
  // signature part onto a second page. It still needs the foot, because that is
  // where the legal name and ABN are.
  const bare = letterheaded({ css: '', body: '<p id="content">body</p>', masthead: false });
  const body = bare.slice(bare.indexOf('<body>'));

  it('leaves the band off the page', () => {
    expect(body).not.toContain('lh-header');
  });

  it('still closes with the entity line and the ABN', () => {
    expect({
      entity: body.includes('lh-entity'),
      abn: body.includes(company.abn),
      legalName: body.includes(company.legalName),
    }).toEqual({ entity: true, abn: true, legalName: true });
  });

  it('keeps the masthead when the option is left alone or passed as true', () => {
    // A missing option must not silently drop the letterhead from the two
    // documents that already wear it.
    for (const options of [{}, { masthead: true }]) {
      const doc = letterheaded({ css: '', body: '', ...options });
      const docBody = doc.slice(doc.indexOf('<body>'));
      expect({ options, masthead: docBody.includes('lh-header') })
        .toEqual({ options, masthead: true });
    }
  });
});

describe('the routine service report wears it', () => {
  const html = routineServiceReportHtml({
    customer: { name: 'A Customer', contact: 'Pat Jones', mobile: '0400 000 000', email: 'pat@example.com' },
    site: { name: 'A Site', contact: 'Pat Jones', mobile: '0400 000 000', email: 'pat@example.com' },
    sections: [],
  });

  it('carries the masthead and the ABN', () => {
    expect({
      masthead: html.includes('lh-header'),
      abn: html.includes(company.abn),
    }).toEqual({ masthead: true, abn: true });
  });

  it('still prints the contact rows it was given', () => {
    // The whole point of the sync change: these rows were blank on every
    // report the app had produced.
    for (const value of ['Pat Jones', '0400 000 000', 'pat@example.com']) {
      expect({ value, present: html.includes(value) }).toEqual({ value, present: true });
    }
  });

  it('is one well-formed document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.endsWith('</body></html>')).toBe(true);
    // A stray second <body> from a half-finished refactor renders in some
    // engines and not others, which is the worst way to find out.
    expect(html.match(/<body>/g)).toHaveLength(1);
    expect(html.match(/<\/html>/g)).toHaveLength(1);
  });
});
