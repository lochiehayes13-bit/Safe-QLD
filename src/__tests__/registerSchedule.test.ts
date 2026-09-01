import {
  REGISTER_DUE_LABEL, registerScheduleLines, type RegisterScheduleRow,
} from '@/domain/registerSchedule';

/**
 * What the register says is due on one asset.
 *
 * The importer has always written one row per routine, and the schema comment
 * says why: an extinguisher is due six-monthly, yearly and five-yearly on three
 * different dates, and the asset's own nextDueAt can only hold the soonest.
 *
 * Thirty-one thousand of those rows went in on the real register and nothing
 * ever read one. The table was created, indexed on nextDueAt for a query nobody
 * had written, and refilled on every re-import — while the technician standing
 * in front of the extinguisher saw one collapsed date and no way to tell
 * whether it was the six-monthly or the pressure test. One is a look and a tag.
 * The other takes the extinguisher off site.
 */

const row = (over: Partial<RegisterScheduleRow> = {}): RegisterScheduleRow => ({
  frequency: 'annual',
  nextDueAt: '2026-10-01',
  ...over,
});

/** Half past seven on a Brisbane morning — the previous day in UTC. */
const MORNING = '2026-09-30T21:30:00.000Z';

describe('reading the register schedule', () => {
  it('keeps each routine apart rather than collapsing them to the soonest', () => {
    const lines = registerScheduleLines([
      row({ frequency: 'five-yearly', nextDueAt: '2030-10-01' }),
      row({ frequency: 'six-monthly', nextDueAt: '2027-03-01' }),
      row({ frequency: 'annual', nextDueAt: '2027-03-01' }),
    ], '2026-09-01');
    expect(lines.map((l) => l.frequency)).toEqual(['six-monthly', 'annual', 'five-yearly']);
    expect(lines.map((l) => l.label)).toEqual(['Six-monthly', 'Annual', 'Five-yearly']);
  });

  it('puts what has run out first, and the longer job last on a shared date', () => {
    /*
     * A six-monthly and a five-yearly falling on one day is the register saying
     * they are done in one visit, and the pressure test is the half being
     * planned around.
     */
    const lines = registerScheduleLines([
      row({ frequency: 'annual', nextDueAt: '2026-12-01' }),
      row({ frequency: 'five-yearly', nextDueAt: '2026-08-01' }),
      row({ frequency: 'six-monthly', nextDueAt: '2026-08-01' }),
      row({ frequency: 'monthly', nextDueAt: undefined }),
    ], '2026-09-01');
    expect(lines.map((l) => [l.frequency, l.state])).toEqual([
      ['six-monthly', 'overdue'],
      ['five-yearly', 'overdue'],
      ['annual', 'upcoming'],
      ['monthly', 'unscheduled'],
    ]);
  });

  it('reads today in Queensland, so a routine due today is not overdue at seven', () => {
    /*
     * The whole point of the state. Asked at half past seven on the first of
     * October — 21:30 on the thirtieth in UTC — a routine the register puts on
     * the first is due, not overdue, and the one on the thirtieth is overdue
     * rather than due.
     */
    expect(registerScheduleLines([row({ nextDueAt: '2026-10-01' })], MORNING)[0]!.state).toBe('due');
    expect(registerScheduleLines([row({ nextDueAt: '2026-09-30' })], MORNING)[0]!.state).toBe('overdue');
    expect(registerScheduleLines([row({ nextDueAt: '2026-10-02' })], MORNING)[0]!.state).toBe('upcoming');
  });

  it('counts the days from the same day it judged the state on', () => {
    const [line] = registerScheduleLines([row({ nextDueAt: '2026-10-15' })], MORNING);
    expect(line!.daysUntil).toBe(14);
    const [gone] = registerScheduleLines([row({ nextDueAt: '2026-09-01' })], MORNING);
    expect(gone!.daysUntil).toBe(-30);
  });

  it('shows the last overhaul as the register wrote it, not as a date it invented', () => {
    /*
     * "Jun-25" knows no day. Printing 01/06/2025 against it invents one, on the
     * routine where the next occurrence is five years out and a month of drift
     * compounds — which is exactly why the importer keeps the raw cell.
     */
    const [line] = registerScheduleLines([row({
      frequency: 'five-yearly', nextDueAt: '2030-06-01',
      lastDoneAt: null, lastDonePrecision: 'month', lastDoneRaw: 'Jun-25',
    })], '2026-09-01');
    expect(line!.lastDone).toBe('Jun-25');
    expect(line!.lastDoneImprecise).toBe(true);
  });

  it('says a day is a day', () => {
    const [line] = registerScheduleLines([row({
      frequency: 'five-yearly', lastDoneAt: '2023-02-01', lastDonePrecision: 'day', lastDoneRaw: '1/2/23',
    })], '2026-09-01');
    expect(line!.lastDone).toBe('1/2/23');
    expect(line!.lastDoneImprecise).toBe(false);
  });

  it('still shows a date it cannot judge rather than dropping the routine', () => {
    // A day this app could not read is not a reason to hide what the office
    // system says is due.
    const [line] = registerScheduleLines([row({ nextDueAt: '2026-10-01' })], 'not a day');
    expect(line!.nextDueAt).toBe('2026-10-01');
    expect(line!.state).toBe('upcoming');
    expect(line!.daysUntil).toBeUndefined();
  });

  it('has a label for every state it can produce', () => {
    for (const state of ['overdue', 'due', 'upcoming', 'unscheduled'] as const) {
      expect(REGISTER_DUE_LABEL[state]).toBeTruthy();
    }
  });

  it('is nothing at all for an asset the register never scheduled', () => {
    expect(registerScheduleLines([], '2026-09-01')).toEqual([]);
  });
});
