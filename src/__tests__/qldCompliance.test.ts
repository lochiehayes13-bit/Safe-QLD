import {
  AS1851_CLASS_OBLIGATION,
  CERTIFICATION_STATEMENT,
  OCCUPIER_STATEMENT_INSTALLATIONS,
  SECTION_6_FREQUENCIES,
  addWorkingDays,
  commissionerCopyDueAt,
  commissionerDaysRemaining,
  workingDaysBetween,
  criticalNoticeDueAt,
  frequencySpec,
  isQldCriticalDefect,
  occupierStatementIssues,
  rectificationDueAt,
  scheduledDate,
  toleranceStatus,
  toleranceWindow,
  validateMaintenanceRecord,
  type MaintenanceRecord,
} from '@/domain/qldCompliance';

function record(over: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    installationDescription: 'Fire detection and alarm system — Vigilant MX1, Level 1 lobby',
    technicianName: 'Lachlan Hayes',
    technicianLicenceNumber: 'QBCC 123456',
    maintenanceDate: '2026-08-31',
    maintenanceDescription: 'AS 1851 Section 6 monthly routine service',
    qdcCompliance: true,
    inProperWorkingOrder: true,
    certificationSignature: 'data:image/svg+xml;utf8,<svg/>',
    hardcopyLeftOnSite: true,
    ...over,
  };
}

describe('scheduling from the anchor date', () => {
  it('counts occurrences from the initial scheduled activity', () => {
    expect(scheduledDate('2026-01-15', 'monthly', 0)).toBe('2026-01-15');
    expect(scheduledDate('2026-01-15', 'monthly', 1)).toBe('2026-02-15');
    expect(scheduledDate('2026-01-15', 'monthly', 6)).toBe('2026-07-15');
    expect(scheduledDate('2026-01-15', 'yearly', 1)).toBe('2027-01-15');
    expect(scheduledDate('2026-01-15', 'five-yearly', 1)).toBe('2031-01-15');
  });

  it('does not let a late service move the schedule', () => {
    // The point of anchoring: occurrence 3 is the same date regardless of when
    // occurrences 1 and 2 were actually done.
    expect(scheduledDate('2026-01-31', 'monthly', 3)).toBe('2026-04-30');
  });

  it('clamps into shorter months rather than rolling over', () => {
    // 31 January plus one month is 28 February, not 3 March.
    expect(scheduledDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
  });

  it('rejects an unparseable anchor', () => {
    expect(scheduledDate('not a date', 'monthly', 1)).toBeNull();
  });
});

describe('working days', () => {
  it('skips weekends', () => {
    // Friday 2026-08-28 plus 1 working day is Monday 2026-08-31.
    expect(addWorkingDays('2026-08-28', 1)).toBe('2026-08-31');
    // Friday plus 5 working days is the following Friday.
    expect(addWorkingDays('2026-08-28', 5)).toBe('2026-09-04');
  });

  it('counts backwards too', () => {
    expect(addWorkingDays('2026-08-31', -1)).toBe('2026-08-28');
  });
});

describe('tolerance windows', () => {
  it('uses working days for monthly', () => {
    const w = toleranceWindow('2026-08-31', 'monthly')!;
    expect(w.earliest).toBe('2026-08-24');
    expect(w.latest).toBe('2026-09-07');
  });

  it('uses calendar months for yearly', () => {
    const w = toleranceWindow('2026-08-31', 'yearly')!;
    expect(w.earliest).toBe('2026-06-30');
    expect(w.latest).toBe('2026-10-31');
  });

  it('gives five-yearly three months either side', () => {
    const w = toleranceWindow('2026-08-31', 'five-yearly')!;
    expect(w.earliest).toBe('2026-05-31');
    expect(w.latest).toBe('2026-11-30');
  });
});

describe('tolerance status', () => {
  it('accepts a service inside the window', () => {
    expect(toleranceStatus('2026-08-31', '2026-09-02', 'monthly')).toBe('in-tolerance');
  });

  it('flags a late service', () => {
    expect(toleranceStatus('2026-08-31', '2026-09-20', 'monthly')).toBe('late');
  });

  it('flags an early service', () => {
    expect(toleranceStatus('2026-08-31', '2026-08-01', 'monthly')).toBe('early');
  });

  it('accepts a yearly service two months out', () => {
    expect(toleranceStatus('2026-08-31', '2026-10-20', 'yearly')).toBe('in-tolerance');
    expect(toleranceStatus('2026-08-31', '2026-11-20', 'yearly')).toBe('late');
  });

  it('counts the first and last days of the window as inside it', () => {
    /*
     * Both ends of the window are compliant days, and both comparisons that
     * decide it could have been off by one with nothing to say so.
     *
     * This is where a job either is or is not in tolerance on the record, so a
     * day either way changes what the annual report says about a service that
     * was actually done properly. Scheduled 2026-08-31 yearly puts the window
     * at 2026-06-30 to 2026-10-31, two months either side.
     */
    expect(toleranceStatus('2026-08-31', '2026-06-30', 'yearly')).toBe('in-tolerance');
    expect(toleranceStatus('2026-08-31', '2026-10-31', 'yearly')).toBe('in-tolerance');
    expect(toleranceStatus('2026-08-31', '2026-06-29', 'yearly')).toBe('early');
    expect(toleranceStatus('2026-08-31', '2026-11-01', 'yearly')).toBe('late');
  });

  it('reads the day the work was done in Queensland, not the day it was stamped in UTC', () => {
    /*
     * This company starts at seven. A service carried out at half past seven on
     * a Brisbane morning is stamped 21:30 the previous day in UTC, so the first
     * ten characters of the stamp are yesterday — and every date this function
     * was given until now was a plain calendar day, which is why that never
     * showed.
     *
     * It is wrong in both directions and neither is harmless. Scheduled
     * 2026-08-31 yearly puts the window at 2026-06-30 to 2026-10-31.
     */

    // The first day of the window, worked at half past seven. Stamped 29 June;
    // read from the stamp it is a day before the window opened, and the annual
    // report carries an AS 1851 non-compliance for a service done on time.
    expect(toleranceStatus('2026-08-31', '2026-06-29T21:30:00.000Z', 'yearly')).toBe('in-tolerance');

    // And the same shift the other way. Worked at half past seven on 1 November,
    // the day after the window closed; read from the stamp it is the last day
    // of it, and a late service is recorded as compliant.
    expect(toleranceStatus('2026-08-31', '2026-10-31T21:30:00.000Z', 'yearly')).toBe('late');

    // An afternoon service, where UTC and Queensland agree about the date.
    expect(toleranceStatus('2026-08-31', '2026-06-30T04:30:00.000Z', 'yearly')).toBe('in-tolerance');
  });

  it('says unknown rather than reading a stamp it does not understand', () => {
    // "1/9/2026" is the first of September to everyone who works here and the
    // ninth of January to Date.parse. A verdict is not the place to guess.
    expect(toleranceStatus('2026-08-31', '1/9/2026', 'yearly')).toBe('unknown');
    expect(toleranceStatus('2026-08-31', '', 'yearly')).toBe('unknown');
  });

  it('counts a monthly by working days at the edges, not calendar days', () => {
    /*
     * Monthly is the only frequency with a working-day tolerance, so its edges
     * move with weekends and the boundary is worth holding separately. Five
     * working days either side of Monday 2026-08-31 reaches back to Monday
     * 2026-08-24 and forward to Monday 2026-09-07 — a calendar-day reading
     * would put them at the 26th and the 5th and call two compliant services
     * out of tolerance.
     */
    expect(toleranceStatus('2026-08-31', '2026-08-24', 'monthly')).toBe('in-tolerance');
    expect(toleranceStatus('2026-08-31', '2026-09-07', 'monthly')).toBe('in-tolerance');
    expect(toleranceStatus('2026-08-31', '2026-08-21', 'monthly')).toBe('early');
    expect(toleranceStatus('2026-08-31', '2026-09-08', 'monthly')).toBe('late');
  });

  it('performed exactly on the scheduled day is in tolerance', () => {
    expect(toleranceStatus('2026-08-31', '2026-08-31', 'yearly')).toBe('in-tolerance');
  });

  it('counts Queensland public holidays as working days, which is an open question', () => {
    /*
     * Not an assertion that this is right — an assertion that it is what the
     * app does, so that changing it is deliberate.
     *
     * The monthly tolerance is given in working days, and this counts only
     * weekends. So a monthly scheduled for Friday 10 April 2026 has its
     * earliest permitted day on Good Friday, with Easter Monday counted as a
     * working day too.
     *
     * The app knows better elsewhere: it carries the Queensland public holiday
     * table appointed under the Holidays Act 1983, and the statutory clocks in
     * occupierForm.ts do exclude those days. The two readings disagree by two
     * days over Easter, and a service done on 1 April 2026 is early under this
     * one and in tolerance under the other.
     *
     * Which reading a maintenance standard intends by "working day" is a
     * question for the company to settle, not for this file to assume. Held
     * here so the answer, when it comes, changes a test rather than surprising
     * somebody at an audit.
     */
    expect(toleranceWindow('2026-04-10', 'monthly')).toMatchObject({
      earliest: '2026-04-03', // Good Friday
      latest: '2026-04-17',
    });
    expect(toleranceStatus('2026-04-10', '2026-04-01', 'monthly')).toBe('early');
  });
});

describe('critical defect test', () => {
  it('requires both limbs', () => {
    expect(isQldCriticalDefect(true, true)).toBe(true);
    expect(isQldCriticalDefect(true, false)).toBe(false);
    expect(isQldCriticalDefect(false, true)).toBe(false);
    expect(isQldCriticalDefect(false, false)).toBe(false);
  });
});

describe('statutory clocks', () => {
  it('gives 24 hours for the written critical defect notice', () => {
    const due = criticalNoticeDueAt('2026-08-31T09:00:00.000Z')!;
    expect(due).toBe('2026-09-01T09:00:00.000Z');
  });

  it('gives the occupier one month to rectify', () => {
    expect(rectificationDueAt('2026-08-31')).toBe('2026-09-30');
    expect(rectificationDueAt('2026-01-31')).toBe('2026-02-28');
  });

  it('gives ten business days for the Commissioner copy, and Easter is not business days', () => {
    /*
     * 30 March 2026 is a Monday. Ten weekdays on is Monday 13 April, but Good
     * Friday and Easter Monday fall inside the count and the Regulation counts
     * business days, so the copy is due Wednesday 15 April. Counting weekends
     * only put the deadline two days early, and a copy sent on the 14th was
     * reported late when it was not.
     */
    expect(commissionerCopyDueAt('2026-03-30')).toBe('2026-04-15');
    // And a run with no holiday in it still lands where it always did.
    expect(commissionerCopyDueAt('2026-08-31')).toBe('2026-09-14');
  });

  it('counts both from the Queensland day the maintenance was carried out', () => {
    /*
     * Every date these were given until now was a plain calendar day, so the
     * reader underneath them could take the first ten characters of an instant
     * and never be caught at it.
     *
     * A defect raised at half past seven on a Brisbane morning is stamped 21:30
     * the previous day in UTC. Counted from the stamp, the occupier is given
     * until the second of the month to rectify rather than the third — on the
     * notice screen and on the notice they are handed — and the Commissioner's
     * copy is due a working day early.
     */
    expect(rectificationDueAt('2026-07-02T21:30:00.000Z')).toBe('2026-08-03');
    expect(rectificationDueAt('2026-07-03')).toBe('2026-08-03');
    // 3 July 2026 is a Friday; ten working days on is Friday 17 July.
    expect(commissionerCopyDueAt('2026-07-02T21:30:00.000Z')).toBe('2026-07-17');
    expect(commissionerCopyDueAt('2026-07-03')).toBe('2026-07-17');
  });

  it('handles an unparseable date without throwing', () => {
    expect(criticalNoticeDueAt('nope')).toBeNull();
    // 1/9/2026 is a date Date.parse is happy to read as 9 January, and a
    // notice clock started from January is not a clock.
    expect(criticalNoticeDueAt('1/9/2026')).toBeNull();
    expect(rectificationDueAt('nope')).toBeNull();
    // An Australian date is the one that gets through a lenient reader, so it
    // is named here rather than left to "nope".
    expect(rectificationDueAt('1/9/2026')).toBeNull();
    expect(commissionerCopyDueAt('1/9/2026')).toBeNull();
  });
});

describe('record of maintenance validation', () => {
  it('accepts a complete record', () => {
    expect(validateMaintenanceRecord(record())).toHaveLength(0);
  });

  it('requires the licence number', () => {
    const issues = validateMaintenanceRecord(record({ technicianLicenceNumber: '' }));
    expect(issues.some((i) => i.legalRef === 's55(2)(b)')).toBe(true);
  });

  it('will not accept a silent QDC compliance default', () => {
    const issues = validateMaintenanceRecord(record({ qdcCompliance: false }));
    expect(issues.some((i) => i.legalRef === 's55(2)(f)')).toBe(true);
  });

  it('treats the signature as its own requirement, separate from the name', () => {
    const issues = validateMaintenanceRecord(record({ certificationSignature: undefined }));
    expect(issues.some((i) => i.legalRef === 's55(3)(a)')).toBe(true);
    // The name being present does not satisfy it.
    expect(issues.some((i) => i.legalRef === 's55(2)(b)')).toBe(false);
  });

  it('requires an unanswered working-order question to be answered', () => {
    const issues = validateMaintenanceRecord(record({ inProperWorkingOrder: null }));
    expect(issues.some((i) => i.legalRef === 's55(2)(g)(i)')).toBe(true);
  });

  it('demands corrective action detail when not in working order', () => {
    const issues = validateMaintenanceRecord(record({ inProperWorkingOrder: false }));
    expect(issues.some((i) => i.legalRef === 's55(2)(g)(ii)')).toBe(true);
  });

  it('accepts not-in-working-order once the corrective action is stated', () => {
    const issues = validateMaintenanceRecord(
      record({ inProperWorkingOrder: false, correctiveActionRequired: 'Replace detector at L1.014' }),
    );
    expect(issues).toHaveLength(0);
  });

  it('requires a licence number for a named supervisor', () => {
    const issues = validateMaintenanceRecord(record({ supervisorName: 'J. Smith' }));
    expect(issues.some((i) => i.legalRef === 's55(2)(c)')).toBe(true);
  });

  it('requires a date against every repair', () => {
    const issues = validateMaintenanceRecord(
      record({ repairsMade: [{ description: 'Replaced detector', date: '' }] }),
    );
    expect(issues.some((i) => i.legalRef === 's55(2)(g)(iii)')).toBe(true);
  });

  it('requires a hardcopy to be left on site', () => {
    const issues = validateMaintenanceRecord(record({ hardcopyLeftOnSite: false }));
    expect(issues.some((i) => i.field === 'hardcopyLeftOnSite')).toBe(true);
  });
});

describe('occupier statement', () => {
  it('lists every prescribed installation', () => {
    expect(OCCUPIER_STATEMENT_INSTALLATIONS).toContain('Fire detection and alarm systems');
    expect(OCCUPIER_STATEMENT_INSTALLATIONS).toContain('Stairwell pressurisation systems');
    expect(OCCUPIER_STATEMENT_INSTALLATIONS.length).toBeGreaterThanOrEqual(21);
  });

  it('flags an installation with no nominated standard', () => {
    const issues = occupierStatementIssues([
      { installation: 'Sprinklers', present: true, criticalDefectNoticeGiven: false },
    ]);
    expect(issues[0]).toContain('no maintenance standard');
  });

  it('flags a critical defect notice with no rectification date', () => {
    const issues = occupierStatementIssues([
      { installation: 'Sprinklers', present: true, nominatedStandard: 'AS 1851-2012', criticalDefectNoticeGiven: true },
    ]);
    expect(issues[0]).toContain('rectification date');
  });

  it('does not ask for a rectification date where no notice was given', () => {
    /*
     * The ordinary row, and the one most of a statement is made of: installed,
     * maintained, nothing went wrong. Asking it for the date a critical defect
     * was rectified would put a query against every clean installation on the
     * form and bury the one row that has a real one.
     */
    expect(occupierStatementIssues([
      { installation: 'Sprinklers', present: true, nominatedStandard: 'AS 1851-2012', criticalDefectNoticeGiven: false },
    ])).toEqual([]);
  });

  it('accepts a notice that has been rectified', () => {
    expect(occupierStatementIssues([
      {
        installation: 'Sprinklers', present: true, nominatedStandard: 'AS 1851-2012',
        criticalDefectNoticeGiven: true, rectifiedDate: '2026-03-04',
      },
    ])).toEqual([]);
  });

  it('ignores installations the building does not have', () => {
    expect(occupierStatementIssues([
      { installation: 'Emergency lifts', present: false, criticalDefectNoticeGiven: false },
    ])).toHaveLength(0);
  });
});

describe('reference data integrity', () => {
  it('has no three-monthly or two-yearly Section 6 activity', () => {
    const intervals = SECTION_6_FREQUENCIES.map((f) => f.intervalMonths);
    expect(intervals).not.toContain(3);
    expect(intervals).not.toContain(24);
  });

  it('gives every frequency a tolerance and a schedule reference', () => {
    for (const f of SECTION_6_FREQUENCIES) {
      expect(f.toleranceDays ?? f.toleranceMonths).toBeDefined();
      expect(f.scheduleTable).toBeTruthy();
      expect(frequencySpec(f.id)).toBe(f);
    }
  });

  it('gives every defect class a notification and rectification expectation', () => {
    for (const k of ['critical', 'non-critical', 'non-conformance'] as const) {
      expect(AS1851_CLASS_OBLIGATION[k].notify).toBeTruthy();
      expect(AS1851_CLASS_OBLIGATION[k].rectify).toBeTruthy();
    }
  });

  it('has certification wording to sign against', () => {
    expect(CERTIFICATION_STATEMENT).toContain('certify');
  });
});

describe('working days between two dates', () => {
  it('counts only weekdays', () => {
    // Monday 31 Aug 2026 to Monday 7 Sep 2026 is five working days.
    expect(workingDaysBetween('2026-08-31', '2026-09-07')).toBe(5);
  });

  it('is zero for the same day', () => {
    expect(workingDaysBetween('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('does not count the weekend a span lands in', () => {
    // Friday to the following Monday is one working day, not three.
    expect(workingDaysBetween('2026-09-04', '2026-09-07')).toBe(1);
  });

  it('goes negative once the target is behind', () => {
    expect(workingDaysBetween('2026-09-07', '2026-08-31')).toBe(-5);
  });

  it('returns null rather than a number for an unparseable date', () => {
    expect(workingDaysBetween('', '2026-08-31')).toBeNull();
    expect(workingDaysBetween('2026-08-31', 'not a date')).toBeNull();
  });
});

describe('time left to copy the Commissioner', () => {
  it('is the full ten working days on the day of signing', () => {
    expect(commissionerDaysRemaining('2026-08-31', '2026-08-31')).toBe(10);
  });

  it('counts down as working days pass', () => {
    // Signed Monday, now the Friday of the same week: four days gone.
    expect(commissionerDaysRemaining('2026-08-31', '2026-09-04')).toBe(6);
  });

  it('goes negative once the statement is late, rather than clamping at zero', () => {
    // The deadline is 14 Sep; a week past it is five working days late.
    expect(commissionerDaysRemaining('2026-08-31', '2026-09-21')).toBe(-5);
  });

  it('does not count Easter down, because the deadline it counts to does not either', () => {
    // Signed Monday 30 March 2026, due Wednesday 15 April. On the 14th there is
    // a day in hand; a weekends-only count had the deadline on the 13th and
    // called the same statement a day late.
    expect(commissionerDaysRemaining('2026-03-30', '2026-04-14')).toBe(1);
  });
});
