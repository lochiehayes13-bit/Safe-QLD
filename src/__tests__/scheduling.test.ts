import {
  SCHEDULE_BOOK_KIND, SCHEDULE_MOVE_KIND, SCHEDULE_REMOVE_KIND, buildBooking, buildMove, buildRemove, canChangeFromPhone,
  conflicts, dayColumns, describeScheduleChange, heldForUndo, mergePending, normaliseClock, notBeforeFrom,
  parseSchedulePath, readScheduleChange, recordAlreadyAt, recordIsMine, relativeSchedulePath, scheduleContentKey,
  spanProblem, weekOf, type PendingScheduleChange,
} from '@/domain/scheduling';
import type { ScheduleEntry } from '@/domain/myDay';

/**
 * Scheduling from the phone: the layout, the conflict check, the three
 * requests and the rule about whose blocks may be changed.
 *
 * The requests are asserted byte for byte because the PATCH and DELETE
 * have not been tried on the live build, and the body is the one thing the
 * module is for. Every job number and employee id here is invented.
 */

const block = (over: Partial<ScheduleEntry> & { id: string }): ScheduleEntry => ({
  jobId: '1001', staffId: '77', staffName: 'Alex Fixture', date: '2026-09-08', startTime: '07:00', endTime: '15:30', type: 'Job',
  ...over,
});

describe('laying a day out by person', () => {
  it('gives everyone on the staff list a column, filled or empty, in name order', () => {
    const cols = dayColumns(
      [block({ id: '1' }), block({ id: '2', staffId: '78', staffName: 'Zed Fixture', startTime: '09:00', endTime: '10:00' })],
      '2026-09-08',
      [{ id: '78', name: 'Zed Fixture' }, { id: '77', name: 'Alex Fixture' }, { id: '79', name: 'Mo Fixture' }],
    );
    expect(cols.map((c) => [c.staffName, c.blocks.map((b) => b.id)])).toEqual([
      ['Alex Fixture', ['1']], ['Mo Fixture', []], ['Zed Fixture', ['2']],
    ]);
  });

  it('keeps a block whose person is not on the list, under the name on the block, and puts nobody last', () => {
    const cols = dayColumns(
      [block({ id: '1', staffId: '99', staffName: 'New Starter' }), block({ id: '2', staffId: undefined, staffName: undefined })],
      '2026-09-08',
      [{ id: '77', name: 'Alex Fixture' }],
    );
    expect(cols.map((c) => c.staffName)).toEqual(['Alex Fixture', 'New Starter', 'Unassigned']);
    expect(cols[2]!.blocks.map((b) => b.id)).toEqual(['2']);
  });

  it('matches a block by name where it has no id, and sorts a column by time', () => {
    const cols = dayColumns(
      [block({ id: 'b', staffId: undefined, staffName: 'alex fixture', startTime: '13:00' }), block({ id: 'a' })],
      '2026-09-08',
      [{ id: '77', name: 'Alex Fixture' }],
    );
    expect(cols).toHaveLength(1);
    expect(cols[0]!.blocks.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('leaves other days out', () => {
    expect(dayColumns([block({ id: '1', date: '2026-09-09' })], '2026-09-08')).toEqual([]);
  });

  it('counts a week from Monday, as the payroll week does', () => {
    // 2026-09-09 is a Wednesday.
    expect(weekOf('2026-09-09')).toEqual({
      start: '2026-09-07', end: '2026-09-13',
      days: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'],
    });
    expect(weekOf('2026-09-13').start).toBe('2026-09-07');
  });
});

describe('the conflict check', () => {
  const mine = [
    block({ id: 'am', startTime: '07:00', endTime: '12:00' }),
    block({ id: 'pm', startTime: '12:00', endTime: '15:30' }),
    block({ id: 'tomorrow', date: '2026-09-09' }),
    block({ id: 'untimed', startTime: undefined, endTime: undefined }),
  ];

  it('finds the blocks a candidate overlaps, on its day only', () => {
    expect(conflicts(mine, { date: '2026-09-08', start: '11:00', end: '13:00' }).map((b) => b.id)).toEqual(['am', 'pm']);
    expect(conflicts(mine, { date: '2026-09-08', start: '08:00', end: '09:00' }).map((b) => b.id)).toEqual(['am']);
  });

  it('lets a morning and an afternoon meet without overlapping', () => {
    expect(conflicts(mine, { date: '2026-09-08', start: '15:30', end: '17:00' })).toEqual([]);
  });

  it('does not count the block being moved against itself', () => {
    expect(conflicts(mine, { id: 'am', date: '2026-09-08', start: '08:00', end: '11:00' })).toEqual([]);
  });

  it('refuses a span that is not one, in words', () => {
    expect(spanProblem({ date: '2026-09-08', start: '07:00', end: '15:30' })).toBeUndefined();
    expect(spanProblem({ date: '8/9/2026', start: '07:00', end: '15:30' })).toBe('The date is yyyy-mm-dd.');
    expect(spanProblem({ date: '2026-09-08', start: '7am', end: '15:30' })).toMatch(/HH:MM/);
    expect(spanProblem({ date: '2026-09-08', start: '15:30', end: '07:00' })).toBe('The block ends before it starts.');
  });

  it('reads the clocks people type', () => {
    expect(normaliseClock('7:00')).toBe('07:00');
    expect(normaliseClock('0730')).toBe('07:30');
    expect(normaliseClock(' 15:30 ')).toBe('15:30');
    expect(normaliseClock('24:00')).toBeUndefined();
    expect(normaliseClock('half seven')).toBeUndefined();
  });
});

describe('the requests', () => {
  it('books a person onto a cost centre with the same POST the clock sends', () => {
    expect(buildBooking({ employeeId: '77', jobExternalId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '07:00', end: '15:30' })).toEqual({
      method: 'POST',
      path: 'jobs/1001/sections/5/costCenters/9/schedules/',
      body: { Staff: 77, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '15:30' }] },
    });
  });

  it('refuses a booking with no employee or no span rather than guessing', () => {
    expect(() => buildBooking({ employeeId: '', jobExternalId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '07:00', end: '15:30' })).toThrow(/no Simpro employee/);
    expect(() => buildBooking({ employeeId: '77', jobExternalId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '09:00', end: '08:00' })).toThrow(/ends before/);
  });

  it('moves a block with a PATCH to the record, from the href the office hands out', () => {
    expect(buildMove('/api/v1.0/companies/0/jobs/1001/sections/5/costCenters/9/schedules/4410', '2026-09-09', '08:00', '12:00')).toEqual({
      method: 'PATCH',
      path: 'jobs/1001/sections/5/costCenters/9/schedules/4410',
      body: { Date: '2026-09-09', Blocks: [{ StartTime: '08:00', EndTime: '12:00' }] },
    });
  });

  it('removes a block with a DELETE to the record, and no body', () => {
    expect(buildRemove('jobs/1001/sections/5/costCenters/9/schedules/4410/')).toEqual({
      method: 'DELETE', path: 'jobs/1001/sections/5/costCenters/9/schedules/4410',
    });
  });

  it('never builds a path for something that is not a job schedule', () => {
    expect(relativeSchedulePath('/api/v1.0/companies/0/activitySchedules/12')).toBeUndefined();
    expect(() => buildRemove('/api/v1.0/companies/0/activitySchedules/12')).toThrow(/not a job schedule path/);
    expect(() => buildMove('jobs/1001/schedules/12', '2026-09-09', '08:00', '12:00')).toThrow(/not a job schedule path/);
    expect(parseSchedulePath('/api/v1.0/companies/0/jobs/1001/sections/5/costCenters/9/schedules/4410'))
      .toEqual({ jobId: '1001', sectionId: '5', costCenterId: '9', scheduleId: '4410' });
  });
});

describe('the queue rows', () => {
  const book = {
    employeeId: '77', jobId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '07:00', end: '15:30',
    siteName: 'Fictional Tower', notBefore: '2026-09-07T22:01:00.000Z',
  };
  const move = {
    employeeId: '77', scheduleId: '4410', jobId: '1001', href: '/api/v1.0/companies/0/jobs/1001/sections/5/costCenters/9/schedules/4410',
    date: '2026-09-09', start: '08:00', end: '12:00', from: { date: '2026-09-08', start: '07:00', end: '15:30' }, notBefore: '2026-09-07T22:01:00.000Z',
  };
  const remove = { employeeId: '77', scheduleId: '4410', jobId: '1001', costCentres: [{ sectionId: '5', costCenterId: '9' }], date: '2026-09-08', start: '07:00', end: '15:30', notBefore: '2026-09-07T22:01:00.000Z' };

  it('reads each kind back and refuses what it cannot send, in words', () => {
    expect(readScheduleChange(SCHEDULE_BOOK_KIND, book)).toEqual({ kind: SCHEDULE_BOOK_KIND, payload: book });
    expect(readScheduleChange(SCHEDULE_MOVE_KIND, move)).toEqual({ kind: SCHEDULE_MOVE_KIND, payload: move });
    expect(readScheduleChange(SCHEDULE_REMOVE_KIND, remove)).toEqual({ kind: SCHEDULE_REMOVE_KIND, payload: remove });
    expect(readScheduleChange('job-note', book)).toEqual({ error: '"job-note" is not a schedule change.' });
    expect(readScheduleChange(SCHEDULE_BOOK_KIND, { ...book, employeeId: '' })).toEqual({ error: 'The change names no Simpro employee.' });
    expect(readScheduleChange(SCHEDULE_BOOK_KIND, { ...book, costCenterId: undefined })).toEqual({ error: 'The booking names no cost centre to go on.' });
    expect(readScheduleChange(SCHEDULE_BOOK_KIND, { ...book, end: '06:00' })).toEqual({ error: 'The block ends before it starts.' });
    expect(readScheduleChange(SCHEDULE_REMOVE_KIND, { ...remove, costCentres: [] })).toEqual({ error: 'The block has no cost centre path on the phone, so it cannot be changed from here.' });
    expect(readScheduleChange(SCHEDULE_MOVE_KIND, null)).toEqual({ error: 'The change names no Simpro employee.' });
  });

  it('keys a booking on where it goes, a move on where the block goes, a removal on the block', () => {
    expect(scheduleContentKey({ kind: SCHEDULE_BOOK_KIND, payload: book })).toBe('schedule-book|77|1001/5/9|2026-09-08|07:00-15:30');
    expect(scheduleContentKey({ kind: SCHEDULE_MOVE_KIND, payload: move })).toBe('schedule-move|4410|2026-09-09|08:00-12:00');
    expect(scheduleContentKey({ kind: SCHEDULE_REMOVE_KIND, payload: remove })).toBe('schedule-remove|4410');
    // The words around a booking are not the booking.
    expect(scheduleContentKey({ kind: SCHEDULE_BOOK_KIND, payload: { ...book, siteName: 'Other', notBefore: '2030-01-01T00:00:00.000Z' } }))
      .toBe(scheduleContentKey({ kind: SCHEDULE_BOOK_KIND, payload: book }));
  });

  it('holds a change for its minute and no longer', () => {
    expect(notBeforeFrom('2026-09-07T22:00:00.000Z')).toBe('2026-09-07T22:01:00.000Z');
    expect(heldForUndo('2026-09-07T22:01:00.000Z', '2026-09-07T22:00:30.000Z')).toBe(true);
    expect(heldForUndo('2026-09-07T22:01:00.000Z', '2026-09-07T22:01:00.000Z')).toBe(false);
    expect(heldForUndo('not a time', '2026-09-07T22:00:30.000Z')).toBe(false);
  });

  it('names a change for a person', () => {
    expect(describeScheduleChange(SCHEDULE_BOOK_KIND, book)).toBe('Book me on job 1001 · Fictional Tower, 07:00–15:30, 8 Sep');
    expect(describeScheduleChange(SCHEDULE_MOVE_KIND, move)).toBe('Move my block on job 1001 from 07:00–15:30, 8 Sep to 08:00–12:00, 9 Sep');
    expect(describeScheduleChange(SCHEDULE_REMOVE_KIND, remove)).toBe('Take me off job 1001, 07:00–15:30, 8 Sep');
    expect(describeScheduleChange(SCHEDULE_BOOK_KIND, {})).toBe('Booking (The change names no Simpro employee.)');
  });
});

describe('whose block', () => {
  it('lets a person change only their own job blocks', () => {
    expect(canChangeFromPhone(block({ id: '1' }), '77')).toEqual({ ok: true });
    expect(canChangeFromPhone(block({ id: '1' }), '78')).toEqual({ ok: false, why: "This block is Alex Fixture's. The office moves other people's blocks." });
    expect(canChangeFromPhone(block({ id: '1', staffId: undefined }), '77').ok).toBe(false);
    expect(canChangeFromPhone(block({ id: '1' }), '').ok).toBe(false);
    expect(canChangeFromPhone(block({ id: '1', type: 'Activity' }), '77')).toEqual({ ok: false, why: 'Activity blocks are changed in Simpro, not from the phone.' });
  });

  it('checks the record the office holds the same way', () => {
    expect(recordIsMine({ ID: 4410, Staff: { ID: 77 } }, '77')).toBe(true);
    expect(recordIsMine({ ID: 4410, Staff: { ID: 78 } }, '77')).toBe(false);
    expect(recordIsMine({ ID: 4410, Staff: null }, '77')).toBe(false);
    expect(recordAlreadyAt({ Date: '2026-09-09', Blocks: [{ StartTime: '08:00', EndTime: '12:00' }] }, '2026-09-09', '08:00', '12:00')).toBe(true);
    expect(recordAlreadyAt({ Date: '2026-09-08', Blocks: [{ StartTime: '08:00', EndTime: '12:00' }] }, '2026-09-09', '08:00', '12:00')).toBe(false);
    expect(recordAlreadyAt({ Date: '2026-09-09', Blocks: [{ StartTime: '08:00', EndTime: '12:00' }, { StartTime: '13:00', EndTime: '14:00' }] }, '2026-09-09', '08:00', '12:00')).toBe(false);
  });
});

describe('drawing what is queued', () => {
  const office = [block({ id: '4410' }), block({ id: '4411', staffId: '78', staffName: 'Zed Fixture' })];
  const change = (kind: PendingScheduleChange['kind'], payload: PendingScheduleChange['payload'], over: Partial<PendingScheduleChange> = {}): PendingScheduleChange =>
    ({ queueRowId: 'q1', kind, payload, state: 'pending', createdAt: '2026-09-07T22:00:00.000Z', ...over });

  it('adds a booking as a queued block of its own, named from the staff list', () => {
    const out = mergePending(office, [change(SCHEDULE_BOOK_KIND, {
      employeeId: '77', jobId: '1002', sectionId: '5', costCenterId: '9', date: '2026-09-09', start: '07:00', end: '15:30', notBefore: 'x',
    })], [{ id: '77', name: 'Alex Fixture' }]);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ id: 'queued-q1', jobId: '1002', staffId: '77', staffName: 'Alex Fixture', date: '2026-09-09', pending: SCHEDULE_BOOK_KIND, pendingState: 'pending', queueRowId: 'q1' });
  });

  it('does not draw a booking twice once the office holds it', () => {
    const out = mergePending(office, [change(SCHEDULE_BOOK_KIND, {
      employeeId: '77', jobId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '07:00', end: '15:30', notBefore: 'x',
    })]);
    expect(out).toHaveLength(2);
  });

  it('draws a move where the block is going and remembers where it was', () => {
    const out = mergePending(office, [change(SCHEDULE_MOVE_KIND, {
      employeeId: '77', scheduleId: '4410', href: 'h', date: '2026-09-09', start: '08:00', end: '12:00', from: { date: '2026-09-08', start: '07:00', end: '15:30' }, notBefore: 'x',
    }, { state: 'failed', lastError: 'Simpro said no' })]);
    expect(out[0]).toMatchObject({
      id: '4410', date: '2026-09-09', startTime: '08:00', endTime: '12:00', pending: SCHEDULE_MOVE_KIND, pendingState: 'failed',
      pendingError: 'Simpro said no', movedFrom: { date: '2026-09-08', start: '07:00', end: '15:30' },
    });
  });

  it('marks a removal on the block and leaves it in place until the office has it', () => {
    const out = mergePending(office, [change(SCHEDULE_REMOVE_KIND, {
      employeeId: '77', scheduleId: '4411', href: 'h', date: '2026-09-08', notBefore: 'x',
    })]);
    expect(out[1]).toMatchObject({ id: '4411', date: '2026-09-08', pending: SCHEDULE_REMOVE_KIND });
    expect(out[0]!.pending).toBeUndefined();
  });

  it('stops drawing a sent booking the office has since taken off', () => {
    const booking = {
      employeeId: '77', jobId: '1002', sectionId: '5', costCenterId: '9', date: '2026-09-09', start: '07:00', end: '15:30', notBefore: 'x',
    };
    const sent = change(SCHEDULE_BOOK_KIND, booking, { state: 'sent' });
    // Read before the booking went: the office cannot have shown it yet, so
    // it stays drawn.
    expect(mergePending(office, [sent], [], '2026-09-07T21:00:00.000Z')).toHaveLength(3);
    // Read since, and the office's blocks do not include it: taken off.
    expect(mergePending(office, [sent], [], '2026-09-09T06:00:00.000Z')).toHaveLength(2);
    // A booking still on its way is drawn whatever the read says.
    expect(mergePending(office, [change(SCHEDULE_BOOK_KIND, booking)], [], '2026-09-09T06:00:00.000Z')).toHaveLength(3);
    // And with no read at all, nothing is dropped.
    expect(mergePending(office, [sent])).toHaveLength(3);
  });

  it('ignores a change for a block the office no longer lists', () => {
    expect(mergePending(office, [change(SCHEDULE_REMOVE_KIND, { employeeId: '77', scheduleId: '9', href: 'h', date: '2026-09-08', notBefore: 'x' })]))
      .toHaveLength(2);
  });
});
