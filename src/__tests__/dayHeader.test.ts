import { syncedLine, whoName } from '@/domain/dayHeader';

/**
 * The top line of My day: the person's name and when the schedule last came
 * down. It used to read "Scheduled to Sam Fictional (employee 123). Office
 * schedule as of 09/10/2026 07:12 (Qld)."
 */

const NOW = '2026-10-09T00:30:00.000Z'; // 10:30 in Brisbane

describe('whose day it is', () => {
  it('shows the name, never the employee number, where a name is known', () => {
    expect(whoName({ by: 'id', staffId: '123', label: 'Sam Fictional (employee 123)' }, ' Sam Fictional ')).toBe('Sam Fictional');
    expect(whoName({ by: 'name', staffName: 'Sam Fictional', label: 'Sam Fictional' }, '')).toBe('Sam Fictional');
  });

  it('falls back to the employee number only when there is no name', () => {
    expect(whoName({ by: 'id', staffId: '123', label: 'employee 123' }, '  ')).toBe('Employee 123');
  });
});

describe('when the schedule last synced', () => {
  it('says how long ago, in plain words', () => {
    expect(syncedLine('2026-10-09T00:25:00.000Z', NOW)).toBe('Synced 5 min ago');
    expect(syncedLine('2026-10-08T22:30:00.000Z', NOW)).toBe('Synced 2 h ago');
    expect(syncedLine('2026-10-09T00:30:20.000Z', '2026-10-09T00:30:40.000Z')).toBe('Synced just now');
  });

  it('names yesterday in lower case after the verb', () => {
    // 16:10 on the 8th in Brisbane.
    expect(syncedLine('2026-10-08T06:10:00.000Z', NOW)).toBe('Synced yesterday 16:10');
  });

  it('says so when the schedule has never come down', () => {
    expect(syncedLine(undefined, NOW)).toBe('Not synced yet');
    expect(syncedLine('', NOW)).toBe('Not synced yet');
  });
});
