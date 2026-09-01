import type { FilledOccupierStatement } from '@/domain/occupierForm';
import {
  checkStatementAgainstRecords, contradictions, evidenceSummary, installationForSystem,
  type RecordedNotice,
} from '@/domain/statementEvidence';

/**
 * Checking the occupier statement against the company's own file.
 *
 * Schedule 2 column 3 asks whether a critical defect notice was issued during
 * the period. A person answers it from memory, and the app already holds the
 * answer — the defect table carries the date each notice was given and the date
 * each defect was rectified.
 *
 * The failure this exists to catch is a statement saying no notice was issued
 * over a Safe QLD record of one being issued and the occupier receiving it.
 * That document goes to the Commissioner and gets produced when something has
 * gone wrong, and it would be the company's own file contradicting the
 * paperwork its customer signed.
 *
 * The quieter risk is the opposite one: warning about everything. Safe QLD is
 * not always the only contractor on a building, so a statement declaring a
 * notice we hold nothing for is ordinary. Calling that a contradiction teaches
 * people to click past the ones that are.
 */

const statement = (over: Partial<FilledOccupierStatement> = {}): FilledOccupierStatement => ({
  buildingName: 'An Example Building',
  buildingAddress: '12 Example Street, Hamilton',
  occupierName: 'An Example Occupier',
  periodStart: '2025-07-01',
  periodEnd: '2026-06-30',
  rows: [],
  ...over,
});

const notice = (over: Partial<RecordedNotice> = {}): RecordedNotice => ({
  defectId: 'd1',
  noticeIssuedAt: '2025-11-04',
  system: 'detection',
  location: 'Level 2 riser',
  description: 'Zone 4 in fault',
  ...over,
});

describe('which Schedule 2 row a system belongs to', () => {
  it('names the row where the system is the installation', () => {
    expect(installationForSystem('extinguisher')).toEqual({
      installation: 'Fire extinguishers', formRef: 'Schedule 2, row 9',
    });
    expect(installationForSystem('hydrant').installation).toBe('Fire hydrants (including boosters)');
    expect(installationForSystem('fire-door').formRef).toBe('Schedule 2, row 8');
  });

  it('files smoke alarms and detection under the same row, because the schedule does', () => {
    // The register splits them because they are serviced differently. Schedule
    // 2 has one row for both, and the statement is the schedule's document.
    expect(installationForSystem('smoke-alarm').installation)
      .toBe(installationForSystem('detection').installation);
  });

  it('refuses to place a pumpset, and says why', () => {
    /*
     * A pump serves whichever installation it feeds. Filing it under hydrants
     * because most of them are would put a contradiction against a row that may
     * be filled in correctly, which is worse than saying nothing.
     */
    const out = installationForSystem('pump');
    expect(out.installation).toBeUndefined();
    expect(out.why).toMatch(/whichever installation it feeds/);
  });

  it('says fire blankets are not one of the twenty-one', () => {
    const out = installationForSystem('fire-blanket');
    expect(out.installation).toBeUndefined();
    expect(out.why).toMatch(/not one of the twenty-one/);
    expect(out.why).toMatch(/Other features/);
  });

  it('admits the register did not identify the system', () => {
    expect(installationForSystem('unknown').why).toMatch(/did not identify/);
  });

  it('always gives a reason where it gives no row', () => {
    // A row that cannot be named and no reason why is the answer that sends
    // somebody looking through the code.
    const systems = ['pump', 'water-tank', 'fire-blanket', 'unknown'] as const;
    for (const s of systems) {
      const out = installationForSystem(s);
      expect(out.installation).toBeUndefined();
      expect(out.why?.length).toBeGreaterThan(20);
    }
  });
});

describe('when the statement and the records agree', () => {
  it('says nothing at all where no notice was issued and none is declared', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [{ installation: 'Fire detection and alarm systems', installed: true, criticalDefectNoticeIssued: false }],
    }), []);
    expect(out).toEqual([]);
    expect(evidenceSummary(out)).toBeUndefined();
  });

  it('says nothing where a notice was issued, declared and rectified', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Fire detection and alarm systems',
        installed: true,
        criticalDefectNoticeIssued: true,
        rectificationDate: '2025-11-20',
      }],
    }), [notice({ rectifiedAt: '2025-11-18' })]);
    expect(out).toEqual([]);
  });

  it('ignores a notice from outside the period, which belongs to another statement', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [{ installation: 'Fire detection and alarm systems', installed: true, criticalDefectNoticeIssued: false }],
    }), [notice({ noticeIssuedAt: '2025-06-30' })]);
    expect(out).toEqual([]);
  });

  it('counts both ends of the period as inside it', () => {
    // The period is inclusive, and a notice on the first or last day of it
    // belongs to this statement rather than falling between two.
    const rows = [{ installation: 'Fire detection and alarm systems', installed: true, criticalDefectNoticeIssued: false }];
    for (const day of ['2025-07-01', '2026-06-30']) {
      const out = checkStatementAgainstRecords(statement({ rows }), [notice({ noticeIssuedAt: day })]);
      expect(out.map((p) => p.kind)).toEqual(['notice-not-declared']);
    }
  });
});

describe('when the statement contradicts the file', () => {
  it('says so where a row declares no notice and we hold one', () => {
    /*
     * The failure the whole module exists for. Nothing in the app looked at
     * this, so the statement could be signed and sent saying the opposite of
     * what Safe QLD recorded and gave the occupier.
     */
    const out = checkStatementAgainstRecords(statement({
      rows: [{ installation: 'Fire detection and alarm systems', installed: true, criticalDefectNoticeIssued: false }],
    }), [notice()]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'notice-not-declared',
      formRef: 'Schedule 2, row 7',
      contradiction: true,
      defectIds: ['d1'],
    });
    expect(out[0]!.message).toContain('Level 2 riser — Zone 4 in fault');
    expect(out[0]!.message).toContain('2025-11-04');
    expect(out[0]!.message).toContain('the statement is the one the occupier signs');
  });

  it('rejects a rectification date for a defect still open on our file', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Fire detection and alarm systems',
        installed: true,
        criticalDefectNoticeIssued: true,
        rectificationDate: '2025-11-20',
      }],
    }), [notice()]);

    expect(out.map((p) => p.kind)).toEqual(['rectification-not-recorded']);
    expect(out[0]!.contradiction).toBe(true);
    expect(out[0]!.message).toMatch(/still open on our file/);
  });

  it('rejects a rectification date earlier than the work we recorded', () => {
    /*
     * Understates how long the building was affected, on the document that
     * exists to record exactly that.
     */
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Fire detection and alarm systems',
        installed: true,
        criticalDefectNoticeIssued: true,
        rectificationDate: '2025-11-10',
      }],
    }), [notice({ rectifiedAt: '2025-11-18' })]);

    expect(out.map((p) => p.kind)).toEqual(['rectification-before-record']);
    expect(out[0]!.contradiction).toBe(true);
    expect(out[0]!.message).toContain('2025-11-18');
  });

  it('accepts a rectification date that matches ours exactly', () => {
    /*
     * The ordinary case, and the one a boundary a day out would break: the
     * statement copying the date off our own paperwork. Reported as earlier
     * than our record, every correctly filled statement would carry a
     * contradiction against it.
     */
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Fire detection and alarm systems',
        installed: true,
        criticalDefectNoticeIssued: true,
        rectificationDate: '2025-11-18',
      }],
    }), [notice({ rectifiedAt: '2025-11-18' })]);
    expect(out).toEqual([]);
  });

  it('accepts a rectification date later than ours, which is the occupier signing off after us', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Fire detection and alarm systems',
        installed: true,
        criticalDefectNoticeIssued: true,
        rectificationDate: '2025-11-25',
      }],
    }), [notice({ rectifiedAt: '2025-11-18' })]);
    expect(out).toEqual([]);
  });

  it('measures against the last defect rectified, not the first', () => {
    // Two defects behind one row. The row is only honestly rectified once the
    // later one is, and taking the earlier date would pass a statement that
    // predates half the work.
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Fire detection and alarm systems',
        installed: true,
        criticalDefectNoticeIssued: true,
        rectificationDate: '2025-11-19',
      }],
    }), [
      notice({ defectId: 'd1', rectifiedAt: '2025-11-18' }),
      notice({ defectId: 'd2', rectifiedAt: '2025-12-02' }),
    ]);
    expect(out.map((p) => p.kind)).toEqual(['rectification-before-record']);
    expect(out[0]!.message).toContain('2025-12-02');
  });
});

describe('when it is something to check rather than something wrong', () => {
  it('does not call another contractor\'s notice a contradiction', () => {
    /*
     * Safe QLD is not always the only maintainer on a building. A row declaring
     * a notice we hold nothing for is ordinary, and calling it a contradiction
     * would teach people to click past the ones that are.
     */
    const out = checkStatementAgainstRecords(statement({
      rows: [{
        installation: 'Sprinklers', installed: true,
        criticalDefectNoticeIssued: true, rectificationDate: '2026-02-04',
      }],
    }), []);

    expect(out.map((p) => p.kind)).toEqual(['declared-without-record']);
    expect(out[0]!.contradiction).toBe(false);
    expect(out[0]!.message).toMatch(/another contractor/);
    expect(out[0]!.message).toMatch(/attached either way/);
  });

  it('answers an unanswered column 3 rather than only complaining about it', () => {
    // The base checker already says the column is blank. This says what the
    // answer is on our records, which is the useful half.
    const out = checkStatementAgainstRecords(statement({
      rows: [{ installation: 'Fire detection and alarm systems', installed: true }],
    }), [notice()]);

    expect(out.map((p) => p.kind)).toEqual(['notice-unanswered']);
    expect(out[0]!.contradiction).toBe(false);
    expect(out[0]!.message).toMatch(/The answer is Yes on our records/);
  });

  it('reports a notice it cannot file against a row, with the reason', () => {
    const out = checkStatementAgainstRecords(statement({ rows: [] }), [
      notice({ system: 'pump', location: 'Pump room', description: 'Jockey pump will not start' }),
    ]);

    expect(out.map((p) => p.kind)).toEqual(['notice-unattributed']);
    expect(out[0]!.contradiction).toBe(false);
    expect(out[0]!.message).toContain('Pump room — Jockey pump will not start');
    expect(out[0]!.message).toMatch(/whichever installation it feeds/);
    expect(out[0]!.message).toMatch(/by hand/);
  });

  it('reports a notice on a defect recorded against no system at all', () => {
    const out = checkStatementAgainstRecords(statement({ rows: [] }), [
      notice({ system: undefined }),
    ]);
    expect(out.map((p) => p.kind)).toEqual(['notice-unattributed']);
    expect(out[0]!.message).toMatch(/not recorded against a system/);
  });

  it('will not check anything against a period that has not been set', () => {
    /*
     * Every column on the schedule is answered "during the period covered by
     * this statement". With no period there is nothing to be inside, and
     * assuming one would produce confident answers about a window nobody chose.
     */
    const out = checkStatementAgainstRecords(
      statement({ periodStart: undefined, periodEnd: undefined }), [notice(), notice({ defectId: 'd2' })],
    );
    expect(out.map((p) => p.kind)).toEqual(['no-period']);
    expect(out[0]!.message).toMatch(/2 critical defect notices/);
    expect(out[0]!.message).toMatch(/Set the period first/);
    expect(out[0]!.defectIds).toEqual(['d1', 'd2']);
  });

  it('stays quiet about a missing period where there is nothing to check', () => {
    expect(checkStatementAgainstRecords(
      statement({ periodStart: undefined, periodEnd: undefined }), [],
    )).toEqual([]);
  });
});

describe('what a screen says about it', () => {
  const rows = [
    { installation: 'Fire detection and alarm systems', installed: true, criticalDefectNoticeIssued: false },
    { installation: 'Sprinklers', installed: true, criticalDefectNoticeIssued: true, rectificationDate: '2026-02-04' },
  ];

  it('separates what disagrees with the file from what needs a look', () => {
    const out = checkStatementAgainstRecords(statement({ rows }), [notice()]);
    expect(out.map((p) => p.kind).sort())
      .toEqual(['declared-without-record', 'notice-not-declared']);
    expect(contradictions(out).map((p) => p.kind)).toEqual(['notice-not-declared']);
  });

  it('counts the two kinds separately, because they are not the same news', () => {
    const out = checkStatementAgainstRecords(statement({ rows }), [notice()]);
    expect(evidenceSummary(out))
      .toBe("1 answer contradicts Safe QLD's records, and 1 other needs checking.");
  });

  it('does not report a contradiction where there is none', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [{ installation: 'Sprinklers', installed: true, criticalDefectNoticeIssued: true, rectificationDate: '2026-02-04' }],
    }), []);
    expect(evidenceSummary(out)).toBe("1 answer needs checking against Safe QLD's records.");
  });

  it('says nothing where there is nothing to say', () => {
    expect(evidenceSummary([])).toBeUndefined();
  });

  it('reads correctly in the plural', () => {
    const out = checkStatementAgainstRecords(statement({
      rows: [
        { installation: 'Fire detection and alarm systems', installed: true, criticalDefectNoticeIssued: false },
        { installation: 'Fire extinguishers', installed: true, criticalDefectNoticeIssued: false },
      ],
    }), [notice(), notice({ defectId: 'd2', system: 'extinguisher' })]);
    expect(evidenceSummary(out)).toBe("2 answers contradict Safe QLD's own records.");
  });
});
