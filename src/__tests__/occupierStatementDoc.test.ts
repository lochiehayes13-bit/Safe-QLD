import { occupierStatementHtml, type OccupierStatementInput } from '@/export/occupierStatement';
import {
  OCCUPIER_STATEMENT_INSTALLATIONS, type OccupierStatementRow,
} from '@/domain/qldCompliance';
import type { OccupierStatement } from '@/db/occupierRepo';

/**
 * The annual occupier statement, as the page somebody signs.
 *
 * The duty is the occupier's, and they are usually a body corporate secretary
 * who has never heard of a prescribed fire safety installation. So the document
 * has to be checkable by them rather than merely correct: every installation
 * listed, including the ones the building does not have, and every deadline on
 * it counted the way the Regulation counts.
 *
 * That last one is the failure this file exists for. The page used to say the
 * ten days ran "after signing". Section 55A(3) counts from the day the
 * statement was required to be prepared, and an occupier who signs a month late
 * was being handed a document telling them they had ten days left when they had
 * none.
 */

const row = (
  installation: string,
  over: Partial<OccupierStatementRow> = {},
): OccupierStatementRow => ({
  installation,
  present: false,
  criticalDefectNoticeGiven: false,
  ...over,
});

const statement = (over: Partial<OccupierStatement> = {}): OccupierStatement => ({
  id: 'os1',
  siteId: 's1',
  occupierName: 'Example Body Corporate',
  occupierPhone: '07 3000 0000',
  premisesName: 'An Example Building',
  premisesAddress: '12 Example Street, Ipswich QLD 4305',
  periodStart: '2025-07-01',
  periodEnd: '2026-06-30',
  rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i) => row(i)),
  signedBy: 'A Secretary',
  signedPosition: 'Body Corporate Secretary',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
} as OccupierStatement);

const input = (over: Partial<OccupierStatementInput> = {}): OccupierStatementInput => ({
  statement: statement(),
  companyName: 'Safe QLD Pty Ltd',
  preparedBy: 'A Technician',
  generatedAt: '2026-07-03T06:00:00.000Z',
  ...over,
});

describe('the dates printed on the signed document', () => {
  /*
   * Every date on this page came from a timestamp with its first ten characters
   * taken, which is the UTC day. Queensland is UTC+10, so a statement signed at
   * seven on a Brisbane morning printed the day before — on the document the
   * occupier signs and the Commissioner receives, and next to a deadline
   * counted in business days from it.
   *
   * The formatter this page uses had already been fixed to resolve the
   * Queensland day. The slice at each call site was throwing that away before
   * it ever saw the timestamp.
   *
   * 2026-07-02T21:00:00Z is seven in the morning on 3 July in Queensland.
   */
  const MORNING = '2026-07-02T21:00:00.000Z';

  it('dates the signature the day it was signed in Queensland', () => {
    const html = occupierStatementHtml(input({
      statement: statement({ signedAt: MORNING, signature: 'data:image/svg+xml;utf8,<svg/>' }),
    }));
    expect(html).toContain('03/07/2026');
    expect(html).not.toContain('02/07/2026');
  });

  it('dates the copy to the Commissioner the day it was sent in Queensland', () => {
    // This one evidences the ten business days. A day early on the page is a
    // day of an obligation that reads as met earlier than it was.
    const html = occupierStatementHtml(input({
      statement: statement({ sentToCommissionerAt: MORNING }),
    }));
    expect(html).toMatch(/Recorded as sent 03\/07\/2026/);
  });

  it('leaves a date with no time in it where it was written', () => {
    // A rectification date is stored as a day, not an instant, and shifting it
    // forward ten hours would move it to the next day.
    const html = occupierStatementHtml(input({
      statement: statement({
        rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i) => row(i, i === 'Sprinklers'
          ? { present: true, criticalDefectNoticeGiven: true, rectifiedDate: '2026-03-01' }
          : {})),
      }),
    }));
    expect(html).toContain('rectified 01/03/2026');
  });
});

describe('the commissioner deadline on the page', () => {
  it('counts from when the statement was required, not from when it was signed', () => {
    /*
     * The trap, on the document rather than the screen. An occupier who signs
     * late has a deadline that has already run; counting from the signature
     * hands them a comfortable date that is simply not the law.
     */
    const html = occupierStatementHtml(input({
      statement: statement({ periodEnd: '2026-06-30', signedAt: '2026-08-01T00:00:00.000Z' }),
    }));
    const flat = html.replace(/\s+/g, ' ');
    expect(flat).toContain('the day the statement was required to be prepared');
    expect(flat).not.toContain('business days from the date it was signed');
  });

  it('says so plainly when it had to fall back to the signature', () => {
    // A fallback that looks like an answer is worse than no answer.
    const html = occupierStatementHtml(input({
      statement: statement({ periodEnd: '', signedAt: '2026-07-01T00:00:00.000Z' }),
    }));
    const flat = html.replace(/\s+/g, ' ');
    expect(flat).toContain('not the date the Regulation counts from');
  });

  it('counts business days rather than weekends alone, and says which way it can be wrong', () => {
    /*
     * A district show holiday this app cannot know pushes the real deadline
     * later, never earlier — so the date printed is one the occupier cannot be
     * late working to. That direction is stated rather than left to be assumed.
     */
    const flat = occupierStatementHtml(input()).replace(/\s+/g, ' ');
    expect(flat).toContain("Queensland's appointed public holidays");
    expect(flat).toContain('later than the date shown, never earlier');
  });

  it('records the date the copy actually went, where it did', () => {
    const html = occupierStatementHtml(input({
      statement: statement({
        signedAt: '2026-07-01T00:00:00.000Z',
        sentToCommissionerAt: '2026-07-10T00:00:00.000Z',
      }),
    }));
    expect(html).toContain('Recorded as sent 10/07/2026');
  });
});

describe('what the page has to show an occupier', () => {
  it('says in its own text that it is not the approved form', () => {
    // Presenting a lookalike as the statutory document is worse than not
    // producing one, because they stop looking for the real one.
    const flat = occupierStatementHtml(input()).replace(/\s+/g, ' ');
    expect(flat).toContain("not the regulator's approved form");
  });

  it('lists every prescribed installation, including the ones the building has not got', () => {
    /*
     * A statement that silently omits them reads as an oversight to a regulator
     * and gives the occupier nothing to check against — they cannot confirm an
     * absence they were never shown.
     */
    const html = occupierStatementHtml(input());
    for (const installation of OCCUPIER_STATEMENT_INSTALLATIONS) {
      expect({ installation, shown: html.includes(installation) })
        .toEqual({ installation, shown: true });
    }
  });

  it('names who prepared it, so the occupier knows who to ask about a row', () => {
    const html = occupierStatementHtml(input());
    expect(html).toContain('A Technician');
    expect(html).toContain('Safe QLD Pty Ltd');
  });

  it('prints the period in Australian dates', () => {
    expect(occupierStatementHtml(input())).toContain('01/07/2025');
    expect(occupierStatementHtml(input())).toContain('30/06/2026');
  });

  it('leaves a signature line even before anybody has signed', () => {
    // It is signed on site. A page with nowhere to sign goes back unsigned.
    const html = occupierStatementHtml(input());
    expect(html).toContain('A Secretary');
    expect(html).toContain('Date');
  });

  it('escapes what was typed into it', () => {
    const html = occupierStatementHtml(input({
      statement: statement({ premisesName: 'Smith & Sons <Pty>' }),
    }));
    expect(html).toContain('Smith &amp; Sons &lt;Pty&gt;');
    expect(html).not.toContain('<Pty>');
  });

  it('produces a whole document rather than a fragment', () => {
    const html = occupierStatementHtml(input());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });
});

describe('installations the building actually has', () => {
  it('shows a present installation differently from one the building has not got', () => {
    // A document showing only one of the two states is not one anybody can
    // check: the occupier cannot confirm an absence they were never shown.
    const mixed = occupierStatementHtml(input({
      statement: statement({
        rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i, n) =>
          row(i, { present: n === 0, nominatedStandard: n === 0 ? 'AS 1851-2012' : undefined })),
      }),
    }));
    const none = occupierStatementHtml(input());
    expect(mixed).not.toBe(none);
    expect(mixed).toContain('AS 1851-2012');
  });

  it('does not print a present installation with no standard against it the same as one with', () => {
    /*
     * The row the occupier is actually signing. "This installation is here and
     * was maintained to a standard" and "this installation is here" are
     * different claims, and the second is the one that needs chasing before
     * anybody signs.
     */
    const withStandard = occupierStatementHtml(input({
      statement: statement({
        rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i, n) =>
          row(i, { present: n === 0, nominatedStandard: n === 0 ? 'AS 1851-2012' : undefined })),
      }),
    }));
    const without = occupierStatementHtml(input({
      statement: statement({
        rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i, n) => row(i, { present: n === 0 })),
      }),
    }));
    expect(withStandard).not.toBe(without);
  });

  it('does not let a critical defect notice disappear into a tidy-looking row', () => {
    /*
     * A notice given and not yet rectified is the single most consequential
     * thing on this page, and it must not print as though the year were clean.
     */
    const noticed = occupierStatementHtml(input({
      statement: statement({
        rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i, n) =>
          row(i, { present: n === 0, criticalDefectNoticeGiven: n === 0 })),
      }),
    }));
    const clean = occupierStatementHtml(input({
      statement: statement({
        rows: OCCUPIER_STATEMENT_INSTALLATIONS.map((i, n) => row(i, { present: n === 0 })),
      }),
    }));
    expect(noticed).not.toBe(clean);
  });
});
