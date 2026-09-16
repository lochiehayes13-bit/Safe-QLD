import { effectivenessReportHtml, type EffectivenessReportInput } from '@/export/effectivenessReport';
import type { Finding } from '@/domain/findings';

/**
 * The effectiveness report as a document.
 *
 * The assertions are about what the document must never let a reader conclude.
 * A client who reads this as a service record believes their statutory
 * obligations are met when nothing was tested; a client who reads a
 * recommendation as a defect believes their building is faulty when it is not.
 * Both are the document's fault if it does not say otherwise, so it says
 * otherwise in its own text and these tests hold it to that.
 */

const finding = (over: Partial<Finding> & Pick<Finding, 'id' | 'kind' | 'seq'>): Finding => ({
  assessmentId: 'a1',
  item: 'An item',
  location: 'Somewhere',
  detail: 'Something was seen.',
  action: 'Do something.',
  priority: over.kind === 'recommendation' ? 'high' : undefined,
  relatedRefs: [],
  photos: [],
  createdAt: '2026-07-03T00:00:00.000Z',
  updatedAt: '2026-07-03T00:00:00.000Z',
  ...over,
});

const input = (over: Partial<EffectivenessReportInput> = {}): EffectivenessReportInput => ({
  reportReference: 'SQLD-EX-01',
  jobReference: '43733',
  assessmentType: 'Fire System Effectiveness / Readiness',
  clientName: 'A Client',
  siteName: 'A Site',
  scopeLabel: 'Administration Building',
  attendanceDate: '2026-07-03',
  issueDate: '2026-07-06',
  assessedBy: 'Safe QLD Fire Protection',
  preparedBy: 'A Service Manager',
  findings: [],
  ...over,
});

describe('what the report says about itself', () => {
  const html = effectivenessReportHtml(input());

  it('states on its face that no AS 1851 testing was conducted', () => {
    expect(html).toContain('no AS 1851:2012 testing conducted');
    expect(html).toContain('No inspection, testing or survey activities');
  });

  it('refuses to be read as a service record or a certificate', () => {
    expect(html).toContain('does not constitute an AS 1851:2012');
    expect(html).toContain('certificate of compliance');
    expect(html).toContain('Building Fire Safety Regulation 2008');
  });

  it('says it is not a design review, because "effectiveness" invites that reading', () => {
    expect(html).toContain('not an engineered design investigation');
    expect(html).toContain('AS 1670.1');
  });

  it('explains why no defects are listed rather than leaving it implied', () => {
    // Whitespace-insensitive: the sentence matters, the template's wrapping
    // does not.
    expect(html.replace(/\s+/g, ' ')).toContain(
      'No Critical Defects, Non-Critical Defects or Non-Conformances were identified, because no '
      + 'testing was conducted.',
    );
  });
});

describe('the findings register', () => {
  const findings = [
    finding({ id: 'r1', kind: 'recommendation', seq: 1, item: 'FIP upgrade', location: 'Main FIP' }),
    finding({
      id: 'r2', kind: 'recommendation', seq: 2, item: 'Detector fleet replacement',
      relatedRefs: ['R-01'], priority: 'medium',
    }),
    finding({
      id: 'o1', kind: 'observation', seq: 1, item: 'East offices', priority: undefined,
      action: 'Note only — no action required.',
    }),
  ];
  const html = effectivenessReportHtml(input({ findings }));

  it('numbers findings as the issued report does', () => {
    expect(html).toContain('R-01');
    expect(html).toContain('R-02');
    expect(html).toContain('OBS-01');
  });

  it('labels a recommendation row Action and an observation row Note', () => {
    expect(html).toContain('↳ Action:');
    expect(html).toContain('↳ Note:');
  });

  it('prints the priority on a recommendation and nowhere else', () => {
    expect(html).toContain('Priority: HIGH');
    expect(html).toContain('Priority: MEDIUM');
    // The observation carries no priority, so the register cannot show one.
    const observationRow = html.slice(html.indexOf('OBS-01'));
    expect(observationRow).not.toContain('Priority:');
  });

  it('carries a cross-reference through to the page', () => {
    expect(html).toContain('programmed with R-01');
  });

  it('says none were identified rather than printing an empty table', () => {
    const empty = effectivenessReportHtml(input({ findings: [] }));
    expect(empty).toContain('None identified within the scope');
    expect(empty).toContain('None were identified within the scope');
  });

  it('prints the classification key, so no reader has to infer what a class means', () => {
    expect(html).toContain('No defect exists');
    expect(html).toContain('no action required');
  });
});

describe('the closing statement', () => {
  it('builds its numbered list from the register above it', () => {
    // Typed by hand this list drifts, and a report that recommends three things
    // while listing two gets a project quoted short.
    const html = effectivenessReportHtml(input({
      statement: 'The installation appears to remain effective.',
      findings: [
        finding({ id: 'a', kind: 'recommendation', seq: 1, item: 'Replacement of the FIP' }),
        finding({ id: 'b', kind: 'recommendation', seq: 2, item: 'Replacement of the detection fleet' }),
        finding({ id: 'c', kind: 'observation', seq: 1, item: 'East offices', priority: undefined }),
      ],
    }));
    expect(html).toContain('(1) Replacement of the FIP; (2) Replacement of the detection fleet');
    expect(html).toContain('The installation appears to remain effective.');
  });

  it('leaves the list off when nothing is recommended', () => {
    const html = effectivenessReportHtml(input({ statement: 'All good.', findings: [] }));
    expect(html).not.toContain('should incorporate');
    expect(html).toContain('All good.');
  });
});

describe('open defects already on the site', () => {
  it('prints the caution where a reader will see it, above the register', () => {
    const html = effectivenessReportHtml(input({
      openDefectCaution: 'This site has 4 open defects already recorded.',
    }));
    expect(html.indexOf('4 open defects')).toBeLessThan(html.indexOf('5.1 Recommendations'));
  });

  it('says nothing when there is nothing to say', () => {
    expect(effectivenessReportHtml(input())).not.toContain('already recorded');
  });
});

describe('the photographic register', () => {
  it('prints the numbers the register gave them, rather than counting again', () => {
    const html = effectivenessReportHtml(input({
      photos: [
        { ref: 'Photo 1', uri: 'file:///a.jpg', caption: 'Panel front', group: 'Fire Indicator Panel' },
        { ref: 'Photo 2', uri: 'file:///b.jpg', caption: 'Panel display', group: 'Fire Indicator Panel' },
        { ref: 'Photo 3', uri: 'file:///c.jpg', caption: 'A detector head', group: 'Detection' },
      ],
    }));
    expect(html).toContain('Photo 1 — Panel front');
    expect(html).toContain('Photo 2 — Panel display');
    expect(html).toContain('Photo 3 — A detector head');
    expect(html).toContain('Fire Indicator Panel');
    expect(html).toContain('Detection');
  });

  it('renumbers the sign-off section when there are no photographs', () => {
    expect(effectivenessReportHtml(input({ photos: [] }))).toContain('6. Assessment Summary');
    expect(effectivenessReportHtml(input({
      photos: [{ ref: 'Photo 1', uri: 'file:///a.jpg', caption: 'x' }],
    }))).toContain('7. Assessment Summary');
  });
});

describe('escaping', () => {
  it('escapes what a technician types, including an ampersand', () => {
    const html = effectivenessReportHtml(input({
      clientName: 'Smith & Sons <Pty> Ltd',
      findings: [finding({ id: 'a', kind: 'recommendation', seq: 1, detail: '"quoted" & <angled>' })],
    }));
    expect(html).toContain('Smith &amp; Sons &lt;Pty&gt; Ltd');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;angled&gt;');
    expect(html).not.toContain('<Pty>');
  });

  it('keeps paragraph breaks in prose without letting markup through', () => {
    const html = effectivenessReportHtml(input({ summary: 'First para.\n\nSecond <b>para</b>.' }));
    expect(html).toContain('<p>First para.</p>');
    expect(html).toContain('&lt;b&gt;para&lt;/b&gt;');
  });
});

describe('dates', () => {
  it('prints Australian dates, never American', () => {
    // 3 July, not 7 March. A register full of these read the other way is
    // wrong for eight months of the year and right for four.
    const html = effectivenessReportHtml(input({ attendanceDate: '2026-07-03' }));
    expect(html).toContain('<td>03/07/2026</td>');
    expect(html).not.toContain('07/03/2026');
  });
});

describe('naming the site', () => {
  it('names both the site and the part of it assessed', () => {
    // A report headed only "Administration Building" does not say which site's.
    const html = effectivenessReportHtml(input({
      siteName: 'North Pine WTP', scopeLabel: 'Administration Building',
    }));
    expect(html).toContain('North Pine WTP — Administration Building');
  });

  it('does not repeat itself when the assessment covers the whole site', () => {
    const html = effectivenessReportHtml(input({
      siteName: 'North Pine WTP', scopeLabel: 'North Pine WTP',
    }));
    expect(html).not.toContain('North Pine WTP — North Pine WTP');
    expect(html).toContain('North Pine WTP');
  });

  it('falls back to the site name when no scope is given', () => {
    const html = effectivenessReportHtml(input({ siteName: 'North Pine WTP', scopeLabel: '' }));
    expect(html).toContain('<td>North Pine WTP</td>');
  });
});
