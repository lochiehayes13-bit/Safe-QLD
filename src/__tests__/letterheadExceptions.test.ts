import { DEPARTMENT_NOTE, form72Html } from '@/export/form72';
import { buildLabelSheet, LABEL_STOCKS } from '@/export/assetLabels';
import { emptyForm72 } from '@/domain/form72';
import { formatTag } from '@/domain/assetTag';
import { zoneChartHtml } from '@/export/zoneChart';
import type { ZoneChart, ZoneChartRow } from '@/domain/zoneChart';
import type { Panel, Site } from '@/domain/types';

/**
 * The three documents the letterhead sweep deliberately did not treat alike.
 *
 * Everything else the app prints now opens with the Safe QLD band and closes
 * with the swoosh. These three do not, and each for a different reason, so the
 * risk they share is that somebody later notices the gap, calls it an oversight
 * and "fixes" it. That would put a second masthead over a statutory form, push
 * the bottom of a zone chart onto a page a technician does not have at the
 * panel, and print 36mm of artwork across the top two rows of a sheet of sticky
 * labels.
 *
 * So these assertions are not really about the letterhead being present. They
 * hold the three exceptions where they are and say why in the failure, which is
 * the only thing that survives the next engineer reading the export folder and
 * counting the files that call `letterheaded`.
 */

const NOW = '2026-07-03T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Form 72 — the foot, and nothing above the department's own head
// ---------------------------------------------------------------------------

const form72 = (): string => form72Html({
  form: emptyForm72({
    id: 'f1', siteId: 's1', siteName: 'Kenmore Plaza', contractor: 'Safe QLD Pty Ltd', now: NOW,
  }),
  companyName: 'Safe QLD Fire Protection',
  generatedAt: NOW,
});

describe('Form 72 carries the company mark at the foot only', () => {
  const html = form72();

  it('puts nothing above the department\'s own head band', () => {
    // The department's `.head` is the first thing inside <body>, and it is a
    // full-width statutory masthead. Two mastheads stacked is a document whose
    // author the reader cannot identify, and it reads as though the company has
    // altered a form the regulator prescribes.
    const body = html.slice(html.indexOf('<body>'));
    expect({
      mastheadAnywhere: body.includes('lh-header'),
      headIsFirst: body.indexOf('class="head"') < body.indexOf('class="intro"'),
    }).toEqual({ mastheadAnywhere: false, headIsFirst: true });
  });

  it('closes with the swoosh, after the department\'s note and after our own disclaimer', () => {
    // The ordering is the whole judgement call. The swoosh sits below the
    // dashed "Not part of the department's form" block, so it reads as the
    // producer's mark on a reproduced form rather than as part of the form.
    // Measured inside <body>, because `lh-entity` and `lh-footer` also appear in
    // the stylesheet and a whole-document indexOf finds the rule, not the element.
    const body = html.slice(html.indexOf('<body>'));
    const positions = {
      deptNote: body.indexOf(DEPARTMENT_NOTE.slice(0, 40)),
      ours: body.indexOf('Not part of the department'),
      entity: body.indexOf('lh-entity'),
      swoosh: body.indexOf('lh-footer'),
      bodyEnd: body.indexOf('</body>'),
    };
    expect(positions.deptNote).toBeGreaterThan(0);
    expect(positions.ours).toBeGreaterThan(positions.deptNote);
    expect(positions.entity).toBeGreaterThan(positions.ours);
    expect(positions.swoosh).toBeGreaterThan(positions.entity);
    expect(positions.bodyEnd).toBeGreaterThan(positions.swoosh);
  });

  it('prints the legal name and the ABN, which is the reason to keep the foot', () => {
    // A statutory record leaving this company without its legal name and ABN on
    // the page is a separate problem from the masthead, and the entity line is
    // where both live — the artwork cannot be corrected without the office.
    expect(html).toMatch(/ABN\s+\d/);
    expect(html).toContain('Pty Ltd');
  });

  it('keeps the form\'s own page margins rather than the letterhead\'s', () => {
    // The form is laid out at 12mm/10mm and has been since it was written. The
    // letterhead's default page box goes into the stylesheet ahead of the
    // caller's, so the form's rule is the later declaration and wins; asserted
    // on that ordering, because cascade position is what decides it.
    const sheet = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(sheet.indexOf('margin: 8mm 10mm 10mm'))
      .toBeLessThan(sheet.indexOf('margin: 12mm 10mm;'));
    expect(sheet).toContain('@page { size: A4; margin: 12mm 10mm; }');
  });

  it('holds the signature grid together on one page', () => {
    // The foot costs roughly 40mm off the tail of the last sheet, which is
    // enough to leave the licensee's name on one page and the signature box on
    // the next. Part I gets the break rule; the other parts must not, because
    // Part E's flow table on a multi-hydrant site is taller than a page.
    expect(html).toContain('class="grid sig"');
    expect(html).toMatch(/table\.grid\.sig\s*\{[^}]*page-break-inside:\s*avoid/);
    // Exactly one table asks not to be broken. A rule on bare table.grid would
    // catch all of them.
    expect(html.match(/class="grid sig"/g)).toHaveLength(1);
    expect(/table\.grid\s*\{[^}]*page-break-inside/.test(html)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The zone chart — opt in, masthead only, and never flipped to portrait
// ---------------------------------------------------------------------------

const site: Site = {
  id: 's1', name: 'Kenmore Plaza', address: '5 Example Road', suburb: 'Kenmore',
  state: 'QLD', postcode: '4069', createdAt: NOW, updatedAt: NOW,
};

const panel: Panel = {
  id: 'p1', siteId: 's1', name: 'FIP 1', brand: 'kentec', model: 'Taktis',
  source: 'config-import', createdAt: NOW, updatedAt: NOW,
};

const row = (n: number): ZoneChartRow => ({
  number: n, text: `Zone ${n} example area`, deviceCount: 3, summary: '3 detectors', unused: false,
});

const chartOf = (count: number): ZoneChart => ({
  rows: Array.from({ length: count }, (_, i) => row(i + 1)),
  totalZones: count,
  totalDevices: count * 3,
  untexted: [],
  orphanedPoints: 0,
});

const zoneChart = (count: number, letterhead?: boolean): string => zoneChartHtml({
  site, panel, chart: chartOf(count), companyName: 'Safe QLD Fire Protection',
  generatedAt: NOW, ...(letterhead === undefined ? {} : { letterhead }),
});

describe('the zone chart keeps its own sheet', () => {
  it('prints bare unless the letterhead is asked for', () => {
    // The copy that matters goes on the panel door, where the masthead buys
    // nothing and 76mm of furniture risks a second page.
    const html = zoneChart(30);
    expect({
      masthead: html.includes('lh-header'),
      swoosh: html.includes('lh-footer'),
    }).toEqual({ masthead: false, swoosh: false });
  });

  it('stays landscape with the letterhead on, at the row count that forces it', () => {
    // This is the regression the @page split exists for. A 41-row chart chooses
    // landscape at runtime; a hardcoded `size: A4` coming in with the letterhead
    // would flip it back to portrait and take the right-hand column off the
    // paper, which nobody would notice until the chart was on the door.
    for (const letterhead of [false, true]) {
      const html = zoneChart(41, letterhead);
      expect({ letterhead, page: html.includes('@page { size: A4 landscape; margin: 10mm; }') })
        .toEqual({ letterhead, page: true });
    }
  });

  it('honours an explicitly requested orientation with the letterhead on', () => {
    const html = zoneChartHtml({
      site, panel, chart: chartOf(12), companyName: 'Safe QLD Fire Protection',
      generatedAt: NOW, orientation: 'landscape', letterhead: true,
    });
    expect(html).toContain('@page { size: A4 landscape; margin: 10mm; }');
    expect(html.match(/@page/g)).toHaveLength(1);
  });

  it('adds the masthead and nothing else when asked', () => {
    // Head only, deliberately. The `.foot` line already carries the company
    // name and "Verify against the panel before it is relied on", and that
    // warning is the one that matters to somebody at a panel at night.
    const html = zoneChart(41, true);
    const body = html.slice(html.indexOf('<body>'));
    expect({
      masthead: body.includes('lh-header'),
      swoosh: body.includes('lh-footer'),
      entity: body.includes('lh-entity'),
      warning: body.includes('Verify against the panel before it is relied on'),
    }).toEqual({ masthead: true, swoosh: false, entity: false, warning: true });
  });

  it('puts the masthead above the chart\'s own red bar', () => {
    const body = zoneChart(41, true).slice(zoneChart(41, true).indexOf('<body>'));
    expect(body.indexOf('lh-header')).toBeLessThan(body.indexOf('class="bar"'));
  });

  it('forces no page break at the row count that fills a landscape sheet', () => {
    // A chart in two halves is a chart nobody trusts, so the letterhead must not
    // bring a break with it. Nothing in the document may declare one.
    const html = zoneChart(41, true);
    expect(html).not.toMatch(/page-break-(before|after)\s*:/);
    // The only break rules that arrive with the furniture are `avoid` ones, and
    // they belong to elements this document does not emit.
    for (const match of html.match(/page-break-inside:\s*\w+/g) ?? []) {
      expect(match).toContain('avoid');
    }
  });
});

// ---------------------------------------------------------------------------
// Asset labels — no letterhead, on purpose
// ---------------------------------------------------------------------------

describe('the asset label sheet has no letterhead at all', () => {
  const stock = LABEL_STOCKS[0]!;
  const tag = formatTag('extinguisher', 1201) ?? formatTag('detector', 1847)!;

  const sheet = buildLabelSheet(
    [{ tag, typeLabel: 'Fire extinguisher', location: 'Level 1 · Plant room', siteName: 'Kenmore Plaza' }],
    { stock },
  );

  it('prints the label it was given, so this is a real sheet', () => {
    expect({ printed: sheet.printed, omitted: sheet.omitted }).toEqual({ printed: 1, omitted: [] });
  });

  it('carries no letterhead markup', () => {
    // There is no flow on this sheet for a masthead to occupy: the page margin
    // is zero because the printer must not inset anything, and every cell is at
    // an absolute millimetre offset taken off the die-cut stock. Artwork at the
    // top would print across the first two rows of labels, and shifting the grid
    // down to make room misses the die cut and wastes the sheet.
    expect(sheet.html).not.toContain('lh-header');
    expect(sheet.html).not.toContain('lh-footer');
    expect(sheet.html).not.toContain('lh-entity');
  });

  it('keeps the zero page margin the die cut depends on', () => {
    expect(sheet.html).toMatch(/@page \{ size: [\d.]+mm [\d.]+mm; margin: 0; \}/);
  });
});
