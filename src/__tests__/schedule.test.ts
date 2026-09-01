import {
  DUE_LABEL, RUN_STATUS_LABEL, assessRunHistory, complianceFrequency, routineDue, sortByUrgency,
  type RoutineHistory,
} from '@/domain/schedule';
import { SERVICE_ROUTINES } from '@/seed/serviceRoutines';

/**
 * Working out what is due.
 *
 * The trap this exists to avoid is the schedule sliding: if the next service is
 * counted from the last one, a job done three weeks late silently becomes the
 * new baseline and the system reports compliance while drifting out of it.
 */

function history(over: Partial<RoutineHistory> = {}): RoutineHistory {
  return {
    routineId: 'det-annual',
    frequency: 'annual',
    firstCompletedAt: '2024-03-01',
    lastCompletedAt: '2024-03-01',
    completedCount: 1,
    ...over,
  };
}

describe('mapping a routine frequency onto the standard', () => {
  it('translates the names that differ', () => {
    // Routines are named the way technicians talk; the schedule tables are not.
    expect(complianceFrequency('annual')).toBe('yearly');
    expect(complianceFrequency('monthly')).toBe('monthly');
    expect(complianceFrequency('six-monthly')).toBe('six-monthly');
    expect(complianceFrequency('five-yearly')).toBe('five-yearly');
  });

  it('refuses to map a frequency with no schedule table behind it', () => {
    // Giving a quarterly routine a yearly tolerance would report compliance it
    // has no basis for.
    expect(complianceFrequency('quarterly')).toBeNull();
    expect(complianceFrequency('commissioning')).toBeNull();
  });

  it('maps every frequency the shipped routines actually use', () => {
    // The two vocabularies are edited separately; a routine whose frequency
    // maps to null reports "no schedule" forever, silently.
    const unmapped = [...new Set(SERVICE_ROUTINES.map((r) => r.frequency))]
      .filter((f) => complianceFrequency(f) === null);
    expect(unmapped).toEqual([]);
  });
});

describe('where a routine stands', () => {
  it('says so when it has never been done', () => {
    const due = routineDue(history({ firstCompletedAt: undefined, completedCount: 0 }), '2026-08-31');
    expect(due.state).toBe('never-done');
  });

  it('schedules the next one a year after the first, not after the last', () => {
    // Done on time in 2024, then three weeks late in 2025. The 2026 service is
    // still due on the March anniversary — the late one did not move it.
    const due = routineDue(
      history({ firstCompletedAt: '2024-03-01', lastCompletedAt: '2025-03-22', completedCount: 2 }),
      '2026-01-01',
    );
    expect(due.scheduledFor).toBe('2026-03-01');
  });

  it('is upcoming before the window opens', () => {
    const due = routineDue(history(), '2024-06-01');
    expect(due.state).toBe('upcoming');
    expect(due.daysUntilDue).toBeGreaterThan(0);
  });

  it('is due once inside the tolerance window', () => {
    // Yearly carries a two month tolerance, so January is inside it.
    const due = routineDue(history(), '2025-01-15');
    expect(due.state).toBe('due');
  });

  it('is overdue past the end of the window, and counts the days negatively', () => {
    const due = routineDue(history(), '2025-09-01');
    expect(due.state).toBe('overdue');
    expect(due.daysUntilDue).toBeLessThan(0);
  });

  it('reports the window it is judged against', () => {
    const due = routineDue(history(), '2025-01-15');
    expect(due.window?.earliest).toBeTruthy();
    expect(due.window?.latest).toBeTruthy();
    expect(due.window!.earliest < due.window!.latest).toBe(true);
    expect(due.scheduledFor! >= due.window!.earliest).toBe(true);
    expect(due.scheduledFor! <= due.window!.latest).toBe(true);
  });

  it('carries the history through rather than hiding it', () => {
    const due = routineDue(history({ completedCount: 3, lastCompletedAt: '2026-02-02' }), '2026-08-31');
    expect(due.completedCount).toBe(3);
    expect(due.lastCompletedAt).toBe('2026-02-02');
  });

  it('says a quarterly routine has no schedule rather than inventing one', () => {
    const due = routineDue(history({ frequency: 'quarterly' }), '2026-08-31');
    expect(due.state).toBe('not-scheduled');
    expect(due.scheduledFor).toBeUndefined();
  });

  it('does not throw on an unparseable date', () => {
    const due = routineDue(history({ firstCompletedAt: 'not a date' }), '2026-08-31');
    expect(['never-done', 'not-scheduled']).toContain(due.state);
  });
});

describe('ordering a list of them', () => {
  it('puts overdue first, then due, then the rest', () => {
    const items = [
      routineDue(history({ routineId: 'a' }), '2024-06-01'),                       // upcoming
      routineDue(history({ routineId: 'b' }), '2025-09-01'),                       // overdue
      routineDue(history({ routineId: 'c' }), '2025-01-15'),                       // due
      routineDue(history({ routineId: 'd', frequency: 'quarterly' }), '2025-01-15'), // not scheduled
    ];
    expect(sortByUrgency(items).map((i) => i.state))
      .toEqual(['overdue', 'due', 'upcoming', 'not-scheduled']);
  });

  it('puts the most overdue first among the overdue', () => {
    const items = [
      routineDue(history({ routineId: 'recent', firstCompletedAt: '2025-03-01' }), '2026-08-31'),
      routineDue(history({ routineId: 'ancient', firstCompletedAt: '2020-03-01' }), '2026-08-31'),
    ];
    const sorted = sortByUrgency(items);
    expect(sorted[0]!.routineId).toBe('ancient');
  });

  it('does not mutate what it was given', () => {
    const items = [
      routineDue(history({ routineId: 'a' }), '2025-09-01'),
      routineDue(history({ routineId: 'b' }), '2024-06-01'),
    ];
    const before = items.map((i) => i.routineId);
    sortByUrgency(items);
    expect(items.map((i) => i.routineId)).toEqual(before);
  });

  it('has wording for every state it can report', () => {
    for (const state of ['overdue', 'due', 'never-done', 'upcoming', 'not-scheduled'] as const) {
      expect(DUE_LABEL[state]).toBeTruthy();
    }
  });
});

describe('assessRunHistory', () => {
  const runs = (...dates: string[]) => dates.map((completedAt) => ({ completedAt }));

  it('does not judge the first service, which defines the schedule', () => {
    const [first] = assessRunHistory(runs('2023-03-15'), 'annual');
    expect(first).toEqual({ occurrence: 0, completedAt: '2023-03-15', status: 'anchor' });
    expect(RUN_STATUS_LABEL.anchor).toContain('counts from here');
  });

  it('judges each service against the schedule, not against the one before it', () => {
    // Roughly fourteen months between each. Measured against the service
    // before it every one looks like an annual done slightly late; measured
    // against the schedule the drift compounds and the third is out of
    // tolerance, which is the whole reason the anchor exists.
    const out = assessRunHistory(runs('2023-03-01', '2024-04-20', '2025-06-10'), 'annual');
    expect(out.map((r) => r.status)).toEqual(['anchor', 'in-tolerance', 'late']);
    expect(out[1]!.daysFromScheduled).toBe(50);
    expect(out[2]!.scheduledFor).toBe('2025-03-01');
    // Yearly carries a two-month tolerance, so 50 days late is still compliant
    // and 101 is not. The drift is only visible because each is measured from
    // the anchor.
    expect(out[2]!.daysFromScheduled).toBe(101);
  });

  it('counts a service inside the window as in tolerance', () => {
    const out = assessRunHistory(runs('2023-03-01', '2024-03-10'), 'annual');
    expect(out[1]).toMatchObject({ status: 'in-tolerance', scheduledFor: '2024-03-01' });
  });

  it('reports one done well before its window as early, not as compliant', () => {
    const out = assessRunHistory(runs('2023-03-01', '2023-09-01'), 'annual');
    expect(out[1]!.status).toBe('early');
    expect(out[1]!.daysFromScheduled).toBeLessThan(0);
  });

  it('orders by date, so runs recorded out of order still anchor correctly', () => {
    const out = assessRunHistory(runs('2024-03-10', '2023-03-01'), 'annual');
    expect(out[0]!.completedAt).toBe('2023-03-01');
    expect(out[0]!.status).toBe('anchor');
    expect(out[1]!.status).toBe('in-tolerance');
  });

  it('says it does not know rather than inventing a window', () => {
    // Quarterly has no schedule table behind it, so there is no tolerance to
    // measure against and none is assumed.
    const out = assessRunHistory(runs('2023-03-01', '2023-06-14'), 'quarterly');
    expect(out[1]!.status).toBe('unknown');
    expect(out[1]!.scheduledFor).toBeUndefined();
  });

  it('returns nothing for a routine never carried out', () => {
    expect(assessRunHistory([], 'annual')).toEqual([]);
  });

  it('labels every status it can produce', () => {
    for (const status of ['anchor', 'in-tolerance', 'early', 'late', 'unknown'] as const) {
      expect(RUN_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
