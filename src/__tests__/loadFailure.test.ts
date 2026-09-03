import { describeActionFailure, describeLoadFailure, messageOf } from '@/domain/loadFailure';

/**
 * The words a screen shows instead of a spinner that will never stop.
 *
 * Every one of these strings is what a technician on a roof reads when the
 * phone gives up, so they are checked the way the rest of this repository
 * checks wording that matters: for the two things that make it useful — the
 * device's own message kept verbatim, and advice attached where the message is
 * one a person can act on.
 */

describe('the message out of a thrown value', () => {
  it('reads an Error, a bare string and an object with a message', () => {
    expect(messageOf(new Error('database is locked'))).toBe('database is locked');
    expect(messageOf('  disk I/O error  ')).toBe('disk I/O error');
    expect(messageOf({ message: 'no such table: asset' })).toBe('no such table: asset');
  });

  it('gives nothing back for the values that carry nothing', () => {
    // `throw undefined` and an aborted native call both land here, and both
    // used to produce the string "undefined" in front of a technician.
    expect(messageOf(undefined)).toBe('');
    expect(messageOf(null)).toBe('');
    expect(messageOf(new Error('   '))).toBe('');
    expect(messageOf({})).toBe('');
  });
});

describe('a read that failed', () => {
  it('names what was being read and keeps what the device said', () => {
    const said = describeLoadFailure(new Error('database is locked'), 'this timesheet');
    expect(said).toContain('This timesheet could not be read');
    expect(said).toContain('database is locked');
  });

  it('says what to do about the failures a person can do something about', () => {
    expect(describeLoadFailure(new Error('database or disk is full'), 'this job'))
      .toMatch(/run out of storage/i);
    expect(describeLoadFailure(new Error('database is locked'), 'this job'))
      .toMatch(/try again/i);
    expect(describeLoadFailure(new Error('SQLITE_IOERR: disk I/O error'), 'this job'))
      .toMatch(/Restart it/i);
  });

  it('reaches for the storage advice before the general database wording', () => {
    /*
     * "database or disk is full" contains "database", and an earlier ordering
     * would have answered a full phone with "send this to the office", which is
     * the one piece of advice that does not clear it.
     */
    const full = describeLoadFailure(new Error('database or disk is full'), 'this site');
    expect(full).not.toMatch(/Send this message to the office/);
  });

  it('still says something when the device says nothing', () => {
    const said = describeLoadFailure(undefined, 'this asset');
    expect(said).toBe('This asset could not be read, and the device did not say why.');
  });

  it('does not swallow a message it has no advice for', () => {
    // An unrecognised message is still the only clue anyone has.
    expect(describeLoadFailure(new Error('constraint failed: unique'), 'this quote'))
      .toContain('constraint failed: unique');
  });
});

describe('an action that failed', () => {
  it('is phrased as the thing that did not happen, not as a read', () => {
    /*
     * A failed export is not a failed read, and telling somebody their
     * timesheet could not be read when it was the spreadsheet that would not
     * write sends them looking in the wrong place.
     */
    const said = describeActionFailure(new Error('ENOSPC: no space left'), 'export this timesheet');
    expect(said).toContain('The app could not export this timesheet');
    expect(said).toMatch(/run out of storage/i);
  });

  it('says so plainly when nothing came back with the failure', () => {
    expect(describeActionFailure(null, 'produce the zone chart'))
      .toBe('The app could not produce the zone chart, and the device did not say why.');
  });
});
