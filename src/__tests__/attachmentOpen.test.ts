import { attachmentBlobType, attachmentKey, describeOpenOutcome } from '@/domain/attachmentOpen';

/**
 * Opening an office attachment: what both builds share.
 *
 * The phone writes the file and opens the share sheet; the browser builds a
 * Blob and hands it over. Both tell the technician the same thing when it
 * does not open, and the browser has to give the Blob the right type or an
 * iPhone offers a site plan as an unnamed download instead of showing it.
 */

describe('what the technician is told', () => {
  it('says nothing when the file opened', () => {
    expect(describeOpenOutcome({ status: 'opened', uri: 'blob:x' })).toBeUndefined();
  });

  it('keeps every message short and about what to do', () => {
    const outcomes = [
      describeOpenOutcome({ status: 'no-signal' })!,
      describeOpenOutcome({ status: 'no-bytes' })!,
      describeOpenOutcome({ status: 'not-configured', reason: 'No Simpro build domain is set. Add it in Settings.' })!,
      describeOpenOutcome({ status: 'failed', error: 'HTTP 500' })!,
    ];
    for (const words of outcomes) {
      expect(words.title.split(' ').length).toBeLessThanOrEqual(5);
      expect(words.body).not.toMatch(/this phone|this app|—/i);
    }
  });

  it('passes the reason and the error through, since they are the facts', () => {
    expect(describeOpenOutcome({ status: 'not-configured', reason: 'Add the client id in Settings.' })!.body)
      .toBe('Add the client id in Settings.');
    expect(describeOpenOutcome({ status: 'failed', error: 'HTTP 404' })!.body).toBe('HTTP 404');
  });
});

describe('the type a downloaded attachment is given', () => {
  it('takes Simpro’s own type where it names one', () => {
    expect(attachmentBlobType('Plan.pdf', 'application/pdf')).toBe('application/pdf');
    expect(attachmentBlobType('Riser photo', 'image/JPEG')).toBe('image/jpeg');
  });

  it('falls back to the file name when Simpro’s type says nothing', () => {
    expect(attachmentBlobType('Level 2 plan.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(attachmentBlobType('Riser.jpg', undefined)).toBe('image/jpeg');
    expect(attachmentBlobType('Valve.png', '')).toBe('image/png');
    expect(attachmentBlobType('Sign-off 9001.svg', null)).toBe('image/svg+xml');
    expect(attachmentBlobType('Schedule.xlsx')).toContain('spreadsheetml');
    expect(attachmentBlobType('Scope.docx')).toContain('wordprocessingml');
  });

  it('calls an unknown file a file rather than guessing', () => {
    expect(attachmentBlobType('drawing.dwg')).toBe('application/octet-stream');
    expect(attachmentBlobType('no extension')).toBe('application/octet-stream');
  });
});

describe('one attachment, as a key', () => {
  it('keeps the same office id under two parents apart', () => {
    const job = attachmentKey({ kind: 'job', localJobId: 'simpro-9001', externalId: '9001' }, '12');
    const quote = attachmentKey({ kind: 'quote', externalId: '9001' }, '12');
    expect(job).not.toBe(quote);
    expect(attachmentKey({ kind: 'job', localJobId: 'simpro-9002', externalId: '9002' }, '12')).not.toBe(job);
  });
});
