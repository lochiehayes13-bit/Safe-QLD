import { criticalDefectNoticeHtml, type NoticeInput } from '@/export/criticalDefectNotice';
import { formatAuDate } from '@/export/sheets';
import type { Defect, Site } from '@/domain/types';

/**
 * The notice a technician hands an occupier before leaving site.
 *
 * This is the most consequential document the app produces. Queensland
 * requires it within twenty-four hours of the maintenance, the occupier has a
 * month from that maintenance to rectify, and the whole thing hangs on a
 * two-limb test that is not the AS 1851 one.
 *
 * Two failures matter more than everything else on the page, and both produce a
 * document that reads as correct.
 *
 * A limb answered "No" and a limb never asked look identical once printed, and
 * the difference is whether the notice should have been issued at all. And a
 * lookalike presented as the regulator's approved form is worse than no notice
 * — so the page has to say, in its own text, that it is not that form.
 */

const site: Site = {
  id: 's1',
  name: 'An Example Building',
  address: '12 Example Street',
  suburb: 'Ipswich',
  state: 'QLD',
  postcode: '4305',
} as Site;

const defect = (over: Partial<NoticeInput['defect']> = {}): NoticeInput['defect'] => ({
  id: 'd1',
  siteId: 's1',
  location: 'Level 3 east riser',
  description: 'Sprinkler control valve found closed and strapped.',
  severity: 'critical',
  status: 'open',
  raisedAt: '2026-07-03T04:30:00.000Z',
  photos: [],
  ...over,
} as Defect & typeof over);

const input = (over: Partial<NoticeInput> = {}): NoticeInput => ({
  site,
  defect: defect(),
  technicianName: 'A Technician',
  technicianLicence: 'QBCC 123456',
  companyName: 'Safe QLD Pty Ltd',
  occupierName: 'Example Body Corporate',
  maintenanceAt: '2026-07-03T04:30:00.000Z',
  generatedAt: '2026-07-03T06:00:00.000Z',
  ...over,
});

describe('formatAuDate', () => {
  it('prints Australian dates, never American ones', () => {
    // 03/07 and 07/03 are both valid-looking dates and only one is the day the
    // work was done. Eight months of the year the wrong one still reads fine.
    expect(formatAuDate('2026-07-03')).toBe('03/07/2026');
    expect(formatAuDate('2026-07-03T04:30:00.000Z')).toBe('03/07/2026');
  });

  it('returns nothing for nothing, rather than today', () => {
    expect(formatAuDate(undefined)).toBe('');
    expect(formatAuDate('')).toBe('');
  });

  it('hands back what it cannot read rather than inventing a date', () => {
    expect(formatAuDate('last tuesday')).toBe('last tuesday');
  });
});

describe('the critical defect notice', () => {
  it('says what it is not, in its own text', () => {
    /*
     * The one thing that must never be dropped. A document that looks like the
     * approved form and is handed over as one is worse than not producing
     * anything, because the occupier stops looking for the real one.
     */
    const html = criticalDefectNoticeHtml(input());
    // Whitespace-flattened: the sentence wraps in the source, and a test that
    // breaks on a reflowed paragraph is a test nobody trusts.
    const flat = html.replace(/\s+/g, ' ');
    expect(flat).toContain("not itself the regulator's approved form");
    expect(flat).toContain('Queensland Fire Department');
  });

  it('states the one-month rectification obligation and where it runs from', () => {
    const html = criticalDefectNoticeHtml(input());
    expect(html).toContain('within one month of the maintenance');
  });

  it('prints the rectification date where one was worked out', () => {
    const html = criticalDefectNoticeHtml(input({
      defect: defect({ rectificationDueAt: '2026-08-03' }),
    }));
    expect(html).toContain('Rectification due by 03/08/2026');
  });

  it('leaves the rectification line out rather than printing an empty deadline', () => {
    // A notice with "Rectification due by" and nothing after it reads as a
    // system fault, and an occupier discounts the rest of the page with it.
    const html = criticalDefectNoticeHtml(input());
    expect(html).not.toContain('Rectification due by');
  });

  it('answers both Queensland limbs on the page', () => {
    const html = criticalDefectNoticeHtml(input({
      defect: defect({ qldLimbInoperable: true, qldLimbAdverseImpact: true }),
    }));
    expect(html).toContain('Renders the installation inoperable');
    expect(html).toContain('significant adverse impact on occupant safety');
  });

  it('prints No for a limb that was answered No', () => {
    const html = criticalDefectNoticeHtml(input({
      defect: defect({ qldLimbInoperable: true, qldLimbAdverseImpact: false }),
    }));
    // Both rows present, and they do not both say Yes.
    expect(html).toContain('<td>Yes</td>');
    expect(html).toContain('<td>No</td>');
  });

  it('carries the maintenance date, which is what both clocks run from', () => {
    /*
     * Not the date the notice was generated. Section 54(4) counts a month from
     * the maintenance, and section 53(2) counts twenty-four hours from it too —
     * a notice written the next morning is still measured from the day before.
     */
    const html = criticalDefectNoticeHtml(input({
      maintenanceAt: '2026-07-03T04:30:00.000Z',
      generatedAt: '2026-07-04T22:00:00.000Z',
    }));
    expect(html).toContain('Maintenance carried out');
    expect(html).toContain('03/07/2026');
    expect(html).toContain('05/07/2026');
  });

  it('names the licensed person and their licence number', () => {
    // The notice is a statement by somebody, and an unsigned one is a leaflet.
    const html = criticalDefectNoticeHtml(input());
    expect(html).toContain('A Technician');
    expect(html).toContain('QBCC 123456');
    expect(html).toContain('Safe QLD Pty Ltd');
  });

  it('leaves the occupier signature block on the page even with no name', () => {
    // It is signed on the bonnet of the ute. The name is often not known until
    // then, and a page with no line to sign gets handed over unsigned.
    const html = criticalDefectNoticeHtml(input({ occupierName: undefined }));
    expect(html).toContain('Received by (occupier)');
  });

  it('escapes what a technician typed', () => {
    /*
     * A defect description is free text typed on a phone. An ampersand in a
     * company name silently breaks the rest of the document in a PDF renderer,
     * and the page that comes out is short rather than wrong-looking.
     */
    const html = criticalDefectNoticeHtml(input({
      companyName: 'Smith & Sons <Pty>',
      defect: defect({ description: 'Valve "closed" & strapped' }),
    }));
    expect(html).toContain('Smith &amp; Sons &lt;Pty&gt;');
    expect(html).toContain('Valve &quot;closed&quot; &amp; strapped');
    expect(html).not.toContain('<Pty>');
  });

  it("keeps a technician's line breaks in the interim measures", () => {
    // Interim measures are a list of instructions. Reflowed into a paragraph
    // the second one stops being an instruction.
    const html = criticalDefectNoticeHtml(input({
      defect: defect({ interimMeasures: 'Post a fire watch.\nIsolate the level 3 riser.' }),
    }));
    expect(html).toContain('Post a fire watch.<br/>Isolate the level 3 riser.');
  });

  it('leaves the interim measures section out entirely when there are none', () => {
    expect(criticalDefectNoticeHtml(input())).not.toContain('Interim measures recommended');
  });

  it('falls back to the defect description rather than an empty extent box', () => {
    const html = criticalDefectNoticeHtml(input());
    expect(html).toContain('See defect description');
  });

  it('prints the extent of impairment where it was recorded', () => {
    const html = criticalDefectNoticeHtml(input({
      defect: defect({ extentOfImpairment: 'Levels 3 to 7, east riser only.' }),
    }));
    expect(html).toContain('Levels 3 to 7, east riser only.');
    expect(html).not.toContain('See defect description');
  });

  it('builds the address from the parts the site actually has', () => {
    const html = criticalDefectNoticeHtml(input());
    expect(html).toContain('12 Example Street Ipswich QLD 4305');
  });

  it('does not print stray separators for address parts a site is missing', () => {
    const bare = { id: 's2', name: 'Shed' } as Site;
    const html = criticalDefectNoticeHtml(input({ site: bare }));
    expect(html).toContain('Shed');
    expect(html).not.toMatch(/<td>\s+<\/td>\s*<\/tr>\s*<tr><td class="k">Occupier/);
  });

  it('produces a whole document rather than a fragment', () => {
    const html = criticalDefectNoticeHtml(input());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('charset="utf-8"');
  });
});
