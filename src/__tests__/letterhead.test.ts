import { company } from '@/theme/brand';
import { LETTERHEAD_FOOTER_DATA_URI, LETTERHEAD_HEADER_DATA_URI } from '@/export/letterheadArt';
import { LETTERHEAD_CSS, letterheaded } from '@/export/letterhead';
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
    ['footer', LETTERHEAD_FOOTER_DATA_URI],
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
    ['footer', LETTERHEAD_FOOTER_DATA_URI, 4_000],
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

  it('keeps the furniture out of the flow of a page break', () => {
    // The swoosh splitting across two pages is worse than no swoosh.
    expect(LETTERHEAD_CSS).toMatch(/\.lh-footer[^}]*page-break-inside:\s*avoid/);
  });

  it('does not position furniture with `fixed`', () => {
    // Tried and measured: Chrome clips a fixed element to the page content box,
    // so a swoosh offset into the bottom margin is cut off, and a fixed footer
    // inside the box has body text run underneath it on a full page.
    expect(LETTERHEAD_CSS).not.toMatch(/position:\s*fixed/);
  });
});

describe('letterheaded()', () => {
  const doc = letterheaded({ title: 'Test', css: '.x{color:red}', body: '<p id="content">body</p>' });

  it('opens with the masthead and closes with the swoosh', () => {
    // Measured inside <body> only. Both class names appear in the stylesheet
    // first, so searching the whole document finds the CSS rule and reports
    // the footer as coming before the content no matter where it is.
    const body = doc.slice(doc.indexOf('<body>'));
    const header = body.indexOf('lh-header');
    const content = body.indexOf('id="content"');
    const footer = body.indexOf('lh-footer');
    expect({ headerFirst: header < content, footerLast: footer > content, allPresent: header >= 0 && footer >= 0 })
      .toEqual({ headerFirst: true, footerLast: true, allPresent: true });
  });

  it('keeps the caller\'s own stylesheet', () => {
    expect(doc).toContain('.x{color:red}');
  });

  it('lets the letterhead rules win over the document\'s own', () => {
    // Appended last on purpose: a document that sets `body { margin: 0 }` would
    // otherwise pull the masthead flush against the paper edge.
    expect(doc.indexOf('.x{color:red}')).toBeLessThan(doc.indexOf('.lh-header'));
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

describe('the routine service report wears it', () => {
  const html = routineServiceReportHtml({
    customer: { name: 'A Customer', contact: 'Pat Jones', mobile: '0400 000 000', email: 'pat@example.com' },
    site: { name: 'A Site', contact: 'Pat Jones', mobile: '0400 000 000', email: 'pat@example.com' },
    sections: [],
  });

  it('carries the masthead, the swoosh and the ABN', () => {
    expect({
      masthead: html.includes('lh-header'),
      swoosh: html.includes('lh-footer'),
      abn: html.includes(company.abn),
    }).toEqual({ masthead: true, swoosh: true, abn: true });
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
