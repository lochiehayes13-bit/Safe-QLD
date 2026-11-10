/**
 * The Simpro card's one sentence about the PDF.
 *
 * It used to read "On the job" from the moment the file was queued and never
 * looked again. An upload abandoned because the file had gone from the
 * cache, refused by the server, or lost without a reply still read as filed.
 * The sentence is now read off the queue row, state by state.
 */
import { jobCopyState } from '@/domain/form72Link';

const base = { jobExternalId: '9001', issued: true, attachedAt: '2026-10-02T04:14:00.000Z', queuedAt: '2:14 pm', hasRow: true };

describe('before anything is queued', () => {
  it('asks for a job, and says when the PDF would go', () => {
    expect(jobCopyState({ issued: false, hasRow: false, row: undefined })).toMatchObject({
      chip: { label: 'No job', tone: 'warn' }, again: false,
    });
    expect(jobCopyState({ issued: false, hasRow: false, row: undefined }).line).toContain('the moment the form is issued');
    expect(jobCopyState({ issued: true, hasRow: false, row: undefined }).line).toContain('straight away');
  });

  it('tells an issued form it is not on the job yet, and a draft that it will be', () => {
    expect(jobCopyState({ ...base, attachedAt: undefined, row: undefined })).toMatchObject({
      line: expect.stringContaining('not yet on the job'), chip: { label: 'Not on the job', tone: 'warn' },
    });
    expect(jobCopyState({ ...base, issued: false, attachedAt: undefined, row: undefined })).toMatchObject({
      line: 'The PDF goes onto this job the moment the form is issued.', chip: { label: 'Linked', tone: 'default' },
    });
  });
});

describe('once queued', () => {
  it('says only that it was queued where the row is not known', () => {
    expect(jobCopyState({ ...base, hasRow: false, row: undefined })).toMatchObject({
      line: 'PDF queued for the job 2:14 pm.', chip: { label: 'Queued', tone: 'pass' }, again: true,
    });
    expect(jobCopyState({ ...base, row: undefined }).chip.label).toBe('Queued');
  });

  it('reads each state off the row', () => {
    expect(jobCopyState({ ...base, row: { status: 'pending' } })).toMatchObject({
      line: expect.stringContaining('waiting to send to job 9001'), chip: { label: 'Waiting to send', tone: 'warn' },
    });
    expect(jobCopyState({ ...base, row: { status: 'sending' } }).chip.label).toBe('Sending');
    expect(jobCopyState({ ...base, row: { status: 'sent' } })).toMatchObject({
      line: expect.stringContaining("on job 9001's attachments"), chip: { label: 'On the job', tone: 'pass' },
    });
    expect(jobCopyState({ ...base, row: { status: 'failed', lastError: 'The file is no longer on this device.' } })).toMatchObject({
      line: 'The PDF did not reach job 9001: The file is no longer on this device. Queue it again.',
      chip: { label: 'Not sent', tone: 'fail' },
    });
    expect(jobCopyState({ ...base, row: { status: 'unknown', lastError: 'No reply' } })).toMatchObject({
      line: expect.stringContaining('may or may not have reached job 9001 (No reply)'),
      chip: { label: 'Unconfirmed', tone: 'warn' },
    });
  });

  it('treats a deleted row as a file that did not go', () => {
    expect(jobCopyState({ ...base, row: null })).toMatchObject({
      line: expect.stringContaining('did not go'), chip: { label: 'Not sent', tone: 'fail' }, again: true,
    });
  });
});
