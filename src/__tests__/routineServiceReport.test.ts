import {
  DEFAULT_DECLARATION, notesFor, resultText, routineServiceReportHtml, tallyReport,
  type RoutineReportInput,
} from '@/export/routineServiceReport';
import { SYSTEM_COLUMNS } from '@/parsers/assetRegister';

/**
 * The routine service report.
 *
 * Modelled on a report Safe QLD has already issued, because this is the only
 * part of the app the client ever sees. So the tests are mostly about fidelity
 * to that document — its column headings, its three-value result vocabulary,
 * its declaration — rather than about anything being clever.
 */

const INPUT: RoutineReportInput = {
  jobNumber: '42823',
  customer: {
    name: 'Royal Qld Yacht Squadron', address: '578 Royal Esplanade, Manly QLD 4179',
    contact: 'Glenn Scott', mobile: '0455 103 817', email: 'marinamanager@example.com',
  },
  site: { name: 'RQYS - Royal QLD Yacht Squadron', address: '578 Royal Esplanade, Manly QLD 4179' },
  workRequested: 'Annual maintenance of fire detection systems and assets',
  datePerformed: '2026-05-19',
  technicianName: 'Jade Castle',
  sections: [
    {
      system: 'hydrant',
      assets: [
        { assetNumber: '1', location: 'VIP Finger', descriptor: 'Fire Hydrant - 65mm',
          date: '2026-05-20', result: 'pass', notes: 'Switchboard in office, use test switch' },
        { assetNumber: '63', location: 'Booster Cabinet - Salt water suction',
          descriptor: '100mm FBBV', date: '2026-05-22', result: 'fail',
          testNotes: 'Valve seized' },
      ],
    },
    {
      system: 'extinguisher',
      assets: [
        { assetNumber: '223', location: 'Walkway to X Finger', descriptor: 'DCP 9.0kg ABE',
          overhaul: '25', date: '2026-05-26', result: 'fail',
          testNotes: 'Lost pressure, replacement required' },
        { assetNumber: '224', location: 'Locked plant room', descriptor: 'CO2 5.0kg',
          date: '2026-05-26', result: 'not-tested', notTestedReason: 'No key held on site' },
      ],
    },
  ],
};

const html = () => routineServiceReportHtml(INPUT);

describe('matching the issued document', () => {
  it('heads the report with the customer job number', () => {
    expect(html()).toMatch(/Customer Job No\. 42823/);
  });

  it('shows customer and site details side by side', () => {
    const out = html();
    expect(out).toMatch(/Customer Details/);
    expect(out).toMatch(/Site Details/);
    expect(out).toMatch(/Royal Qld Yacht Squadron/);
    expect(out).toMatch(/0455 103 817/);
  });

  it('carries the work requested and the date performed', () => {
    expect(html()).toMatch(/Annual maintenance of fire detection systems and assets/);
    // Australian order, matching every other date on the document.
    expect(html()).toMatch(/19\/05\/2026/);
  });

  it("uses each system's own column headings", () => {
    const out = html();
    // A hydrant register calls these "Asset Number" and "Size mm RG / QRT";
    // an extinguisher register calls them "Asset #" and "Extinguisher Type".
    expect(out).toMatch(/Asset Number/);
    expect(out).toMatch(/Size mm RG \/ QRT/);
    expect(out).toMatch(/Extinguisher Type/);
    expect(out).toMatch(/Last 5 Yearly/);
  });

  it('takes those headings from the register, so the two cannot disagree', () => {
    // The same table drives the importer. A report whose columns differ from
    // the register it came from is work handed to the client.
    const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/[/]/g, '\\/');
    expect(html()).toMatch(new RegExp(escaped(SYSTEM_COLUMNS.hydrant.descriptor)));
    expect(html()).toMatch(new RegExp(escaped(SYSTEM_COLUMNS.extinguisher.descriptor)));
  });

  it('omits the overhaul column for a system that has none', () => {
    const out = routineServiceReportHtml({
      ...INPUT,
      sections: [{ system: 'emergency-lighting', assets: [{ assetNumber: '1', result: 'pass' }] }],
    });
    // Escaped, because a heading goes through the same escaping as any other
    // content — several of these headings contain an ampersand.
    expect(out).toMatch(/Emergency Light Type &amp; Size/);
    expect(out).not.toMatch(/Last 5 Yearly/);
  });

  it('gives every asset its Test Notes and Notes rows', () => {
    const out = html();
    expect(out.match(/Test Notes/g)?.length).toBe(4);
    expect(out.match(/Notes:/g)?.length).toBe(4);
  });

  it('prints what is written in them, not just the rows they go in', () => {
    /*
     * Counting the rows was the whole of this check, and it passed for months
     * against a report whose Notes line was blank under every asset on every
     * page: the field was declared, the row was rendered, and the repository
     * that builds the report never set it.
     *
     * 453 assets in the real register carry a note and they are read before the
     * work starts — "Switchboard in office, use test switch", "Logbook inside
     * switchboard". A row that is present and empty looks exactly like an asset
     * nobody wrote anything about.
     */
    const out = html();
    expect(out).toContain('Switchboard in office, use test switch');
    expect(out).toContain('Valve seized');
  });

  it('closes with the declaration and a signature block', () => {
    const out = html();
    expect(out).toMatch(new RegExp(DEFAULT_DECLARATION));
    expect(out).toMatch(/Jade Castle/);
    expect(out).toMatch(/Print Name/);
    expect(out).toMatch(/Signature/);
  });

  it('embeds a captured signature when there is one', () => {
    const out = routineServiceReportHtml({ ...INPUT, technicianSignature: 'data:image/png;base64,AAA' });
    expect(out).toMatch(/<img src="data:image\/png;base64,AAA"/);
  });
});

describe('the result vocabulary', () => {
  // The issued document has three values. The app carries a fourth.

  it('writes the three the document uses', () => {
    expect(resultText('pass')).toBe('Pass');
    expect(resultText('fail')).toBe('Fail');
    expect(resultText('na')).toBe('N/A');
  });

  it('renders an untested asset as N/A rather than inventing a fourth value', () => {
    expect(resultText('not-tested')).toBe('N/A');
  });

  it('keeps the reason it could not be tested rather than dropping it', () => {
    // There is no column for it, and an inaccessible device recorded as a bare
    // N/A is indistinguishable from one that genuinely did not apply.
    expect(notesFor({ result: 'not-tested', notTestedReason: 'No key held on site' }))
      .toBe('Not tested: No key held on site');
    expect(html()).toMatch(/Not tested: No key held on site/);
  });

  it("keeps both the reason and the technician's own note", () => {
    expect(notesFor({ result: 'not-tested', notTestedReason: 'Locked', testNotes: 'Try reception' }))
      .toBe('Not tested: Locked — Try reception');
  });

  it('adds nothing for the ordinary results', () => {
    expect(notesFor({ result: 'pass' })).toBe('');
    expect(notesFor({ result: 'fail', testNotes: 'Lost pressure' })).toBe('Lost pressure');
  });
});

describe('what the document does not say', () => {
  it('counts the results, because the report itself does not', () => {
    // Ninety-nine pages with forty-nine failures in it looks exactly like
    // ninety-nine pages with none, until somebody reads every page.
    expect(tallyReport(INPUT)).toEqual({
      total: 4, pass: 1, fail: 2, na: 0, notTested: 1, missingReason: 0,
    });
  });

  it('flags an untested asset with no reason given', () => {
    const sloppy = tallyReport({
      ...INPUT,
      sections: [{ system: 'hydrant', assets: [{ assetNumber: '1', result: 'not-tested' }] }],
    });
    expect(sloppy.missingReason).toBe(1);
  });
});

describe('holding up to real content', () => {
  it('escapes markup in a location rather than letting it into the document', () => {
    const out = routineServiceReportHtml({
      ...INPUT,
      sections: [{ system: 'hydrant', assets: [
        { assetNumber: '1', location: 'Plant room <b>rear</b> & "north"', result: 'pass' },
      ] }],
    });
    expect(out).toMatch(/Plant room &lt;b&gt;rear&lt;\/b&gt; &amp; &quot;north&quot;/);
    expect(out).not.toMatch(/<b>rear<\/b>/);
  });

  it('says so when a system has no assets', () => {
    const out = routineServiceReportHtml({ ...INPUT, sections: [{ system: 'pump', assets: [] }] });
    expect(out).toMatch(/No assets recorded for this system/);
  });

  it('leaves blank what it was not given, without printing "undefined"', () => {
    const out = routineServiceReportHtml({
      customer: {}, site: {},
      sections: [{ system: 'hydrant', assets: [{ result: 'pass' }] }],
    });
    expect(out).not.toMatch(/undefined|null|NaN/);
  });

  it('keeps an asset and its notes on one page', () => {
    // A row orphaned from its notes across a page break is how a failure and
    // its explanation end up in different places in a printed report.
    expect(html()).toMatch(/\.asset \{ page-break-inside: avoid/);
    expect(html()).toMatch(/thead \{ display: table-header-group/);
  });
});
