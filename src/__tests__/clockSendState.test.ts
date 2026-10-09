import { entrySendState, neverSendable } from '@/domain/clockSendState';
import type { ClockEntry } from '@/domain/clockOn';

/**
 * What the clock says beside an entry.
 *
 * The rule worth pinning: hours with no cost centre, employee or activity on
 * them can never reach Simpro, because nothing fills those in later. The
 * screen used to say they would wait for the office; they say they can't be
 * sent instead.
 */

const work = (over: Partial<ClockEntry> = {}): ClockEntry => ({
  id: 'w1', employeeExternalId: '77', kind: 'work',
  jobExternalId: '9001', jobSectionExternalId: '5', jobCostCenterExternalId: '9',
  jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower',
  date: '2026-09-08', startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-07T23:30:00.000Z',
  ...over,
});

describe('an entry that can never be sent', () => {
  it('says so for a job with no cost centre, and does not promise it will wait', () => {
    const e = work({ jobSectionExternalId: undefined, jobCostCenterExternalId: undefined, sendError: 'No cost centre on this job' });
    const said = entrySendState(e, undefined);
    expect(said.label).toBe("Can't send");
    expect(said.words).toContain("can't be sent");
    expect(said.words).toContain('cost centre');
    expect(said.words).not.toMatch(/wait|yet|until/i);
  });

  it('says so for an entry with no Simpro employee', () => {
    const said = entrySendState(work({ employeeExternalId: '' }), undefined);
    expect(said.label).toBe("Can't send");
    expect(said.words).toContain('employee');
  });

  it('says so for an activity with no Simpro id', () => {
    const e = work({ kind: 'travel', activityName: 'Travel', jobExternalId: undefined, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined });
    expect(neverSendable(e)).toContain('activity');
    expect(entrySendState(e, undefined).label).toBe("Can't send");
  });

  it('warns while it is still running, so the person knows before clocking off', () => {
    const e = work({ endedAt: undefined, jobCostCenterExternalId: undefined });
    const said = entrySendState(e, undefined);
    expect(said.label).toBe('Running');
    expect(said.words).toContain("can't be sent");
  });
});

describe('an entry that can be sent', () => {
  it('has nothing in the way', () => {
    expect(neverSendable(work())).toBeUndefined();
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
    expect(neverSendable(brk)).toBeUndefined();
    expect(entrySendState(brk, undefined)).toEqual({ label: 'Break', tone: 'muted' });
  });

  it('keeps a fixable reason as Not sent', () => {
    // Under a minute can be fixed by editing the times.
    const e = work({ endedAt: '2026-09-07T21:00:20.000Z' });
    expect(entrySendState(e, undefined).label).toBe('Not sent');
  });
});
