import { cannotSend, entrySendState, waitingFor } from '@/domain/clockSendState';
import type { ClockEntry } from '@/domain/clockOn';

/**
 * What the clock says beside an entry.
 *
 * Two rules worth pinning. Hours with no employee or no job on them can
 * never reach Simpro, so they say so. Hours with no cost centre or no
 * Simpro activity id wait: a sync fills those in once the office has them,
 * and the line says what they are waiting for, in the words the last match
 * left on the entry.
 */

const work = (over: Partial<ClockEntry> = {}): ClockEntry => ({
  id: 'w1', employeeExternalId: '77', kind: 'work',
  jobExternalId: '9001', jobSectionExternalId: '5', jobCostCenterExternalId: '9',
  jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower',
  date: '2026-09-08', startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-07T23:30:00.000Z',
  ...over,
});

describe('an entry that can never be sent', () => {
  it('says so for an entry with no Simpro employee', () => {
    const said = entrySendState(work({ employeeExternalId: '' }), undefined);
    expect(said.label).toBe("Can't send");
    expect(said.words).toContain('employee');
    expect(said.words).toContain('Tell the office');
  });

  it('says so for hours with no job', () => {
    const e = work({ jobExternalId: undefined, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined });
    expect(cannotSend(e)).toContain('No job');
    expect(entrySendState(e, undefined).label).toBe("Can't send");
  });
});

describe('an entry waiting on a Simpro id', () => {
  it('waits for a cost centre, in the words the last match left', () => {
    const e = work({ jobSectionExternalId: undefined, jobCostCenterExternalId: undefined, sendError: 'Pick a cost centre for job 9001.' });
    expect(cannotSend(e)).toBeUndefined();
    expect(entrySendState(e, undefined)).toEqual({ label: 'Waiting', tone: 'warn', words: 'Pick a cost centre for job 9001.' });
  });

  it('names the gap where nothing has been matched yet', () => {
    expect(waitingFor(work({ jobCostCenterExternalId: undefined }))).toBe('No cost centre on this job yet. Ask the office.');
    const travel = work({ kind: 'travel', activityName: 'Travel', jobExternalId: undefined, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined });
    expect(waitingFor(travel)).toBe('Sends once Simpro activities sync.');
    expect(entrySendState(travel, undefined).label).toBe('Waiting');
  });

  it('says so while it is still running, so the person knows before clocking off', () => {
    const said = entrySendState(work({ endedAt: undefined, jobCostCenterExternalId: undefined }), undefined);
    expect(said.label).toBe('Running');
    expect(said.words).toContain('cost centre');
  });

  it('never says it cannot be sent', () => {
    const e = work({ jobSectionExternalId: undefined, jobCostCenterExternalId: undefined });
    expect(entrySendState(e, undefined).words).not.toMatch(/can't be sent/i);
  });
});

describe('an entry that can be sent', () => {
  it('has nothing in the way', () => {
    expect(cannotSend(work())).toBeUndefined();
    expect(waitingFor(work())).toBeUndefined();
    expect(entrySendState(work(), undefined)).toEqual({ label: 'To send', tone: 'muted' });
  });

  it('shows the queue row where there is one', () => {
    expect(entrySendState(work(), { status: 'pending' }).label).toBe('Queued');
    expect(entrySendState(work(), { status: 'sending', lastError: 'Timed out' })).toMatchObject({ label: 'Retrying', words: 'Timed out' });
    expect(entrySendState(work(), { status: 'failed', lastError: 'Staff not found' })).toMatchObject({ label: 'Failed', words: 'Staff not found' });
    expect(entrySendState(work(), { status: 'unknown' }).words).toContain('Waiting to send');
  });

  it('shows Sent once Simpro has it, and a break as a break', () => {
    expect(entrySendState(work({ sentAt: '2026-09-08T00:00:00.000Z' }), undefined).label).toBe('Sent');
    const brk = work({ kind: 'break', jobExternalId: undefined, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined });
    expect(cannotSend(brk)).toBeUndefined();
    expect(waitingFor(brk)).toBeUndefined();
    expect(entrySendState(brk, undefined)).toEqual({ label: 'Break', tone: 'muted' });
  });

  it('keeps a fixable reason as Not sent', () => {
    // Under a minute can be fixed by editing the times.
    const e = work({ endedAt: '2026-09-07T21:00:20.000Z' });
    expect(entrySendState(e, undefined).label).toBe('Not sent');
  });
});
