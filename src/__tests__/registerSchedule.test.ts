import {
  REGISTER_DUE_LABEL, registerAttributes, registerScheduleLines, type RegisterScheduleRow,
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

/**
 * What the register said that no screen was showing.
 *
 * The importer keeps every column it did not claim to understand — its own
 * comment says so — and the asset screen rendered the attributes the *type
 * definition* declares, so anything the register carried that the type does not
 * know about was stored on every import and displayed nowhere.
 *
 * On the real register that is 2,892 asset numbers, 281 fire doors' FRL level,
 * 243 tag numbers, and the battery-size and flow-test columns. The asset number
 * is the one that matters most: it is the number written on the asset's own
 * tag, and it is how a technician standing in front of one says which row of
 * the register this is.
 */
describe('the register columns the type definition has no field for', () => {
  it('shows what the type does not declare, and leaves alone what it does', () => {
    const rows = registerAttributes(
      { assetNumber: '0147', 'FRL Level': '-/60/30', capacity: '2.5' },
      ['capacity'],
    );
    expect(rows.map((r) => r.key)).toEqual(['assetNumber', 'FRL Level']);
  });

  it('puts the asset number first, because that is the one being held', () => {
    const rows = registerAttributes(
      { 'Annual Flow Test': '1/6/25', 'Brand & Location': 'Wormald', assetNumber: '0147' },
      [],
    );
    expect(rows.map((r) => r.label)).toEqual(['Asset number', 'Annual Flow Test', 'Brand & Location']);
  });

  it('keeps the register heading for a column it has no name of its own for', () => {
    // "FRL Level" is the register's heading and it is the only name anybody
    // uses for it. Renaming it here would make the screen and the export
    // disagree about a fire door's fire-resistance level.
    const [frl] = registerAttributes({ 'FRL Level': '-/60/30' }, []);
    expect(frl).toEqual({ key: 'FRL Level', label: 'FRL Level', value: '-/60/30' });
  });

  it('does not repeat what is already on the screen', () => {
    /*
     * The descriptor is what assetName builds the asset's name from, and the
     * last overhaul belongs against its own routine in the schedule above.
     * Printing either again is noise on a screen read one-handed.
     */
    expect(registerAttributes({ descriptor: 'DCP 2.5kg ABE', lastOverhaul: 'Jun-25' }, [])).toEqual([]);
  });

  it('drops a blank rather than printing an empty row', () => {
    expect(registerAttributes({ 'Tag No.': '   ', 'Contract No.': '' }, [])).toEqual([]);
  });

  it('renders a value that is not text', () => {
    // Type-defined attributes can be numbers or flags, and this is handed the
    // whole attribute bag.
    const rows = registerAttributes({ 'Walk Order': 6 as unknown as string }, []);
    expect(rows).toEqual([{ key: 'Walk Order', label: 'Walk Order', value: '6' }]);
  });
});
