import { CLOCK_QUEUE_KIND } from '@/domain/clockOn';
import { JOB_SIGNOFF_KIND } from '@/domain/jobActions';
import { SCHEDULE_BOOK_KIND } from '@/domain/scheduling';
import { unknownOutcomeLine, whereToCheck } from '@/domain/outboundLookup';

/**
 * What the app tells somebody to go and look at, when it cannot tell whether
 * something landed in Simpro.
 *
 * The screen said "search Simpro for the reference below" and then printed
 * `[SQ-REF:timesheet-block|1e5f9769-aa40-…]`. That is a key this phone uses to
 * recognise its own queue rows. It is not in Simpro, it never was, and a
 * technician sent to search for it finds nothing and reasonably concludes the
 * app is broken — or presses Send again and posts the leave twice.
 *
 * So the rule these hold is simple and absolute: a reference is shown only
 * where the marker is genuinely written into the Simpro record, and everywhere
 * else the app names a PLACE instead.
 */

describe('the two things that really carry a reference', () => {
  it('points a job note at the job, and gives the marker that is in it', () => {
    const out = whereToCheck('job-note', { jobId: '42823', noteKey: 'abcdef0123456789abcdef0123456789' });
    expect(out.look).toContain('job 42823');
    expect(out.look).toContain('notes');
    expect(out.reference).toBe('[SQ-REF:abcdef0123456789abcdef0123456789]');
  });

  it('points a sign-off at the job notes, where a sign-off is posted', () => {
    const out = whereToCheck(JOB_SIGNOFF_KIND, { jobId: '42823', noteKey: 'aaaa1111bbbb2222cccc3333dddd4444' });
    expect(out.look).toContain('job 42823');
    expect(out.reference).toContain('SQ-REF:');
  });

  it('points a parts order at the job’s purchase orders', () => {
    const out = whereToCheck('purchase-order', { jobId: '42823', noteKey: 'ffff0000ffff0000ffff0000ffff0000' });
    expect(out.look).toContain('purchase orders');
    expect(out.reference).toContain('SQ-REF:');
  });

  it('offers no reference where the row carries no marker key', () => {
    // Better nothing than a string that is not in the record.
    expect(whereToCheck('job-note', { jobId: '42823' }).reference).toBeUndefined();
  });
});

describe('everything else gets a place, never a reference', () => {
  const noReference = (kind: string, payload = {}) => whereToCheck(kind, payload).reference;

  it('sends hours and leave to the schedule for that day, and shows no key', () => {
    // This is the exact row from the screenshot.
    const out = whereToCheck(CLOCK_QUEUE_KIND, { jobId: undefined }, 'Annual Leave, 07:00–15:00, 20 Oct');
    expect(out.reference).toBeUndefined();
    expect(out.look).toContain('Simpro schedule');
    expect(out.look).toContain('Annual Leave, 07:00–15:00, 20 Oct');
  });

  it('still names the place for a block it cannot describe', () => {
    const out = whereToCheck(CLOCK_QUEUE_KIND, {});
    expect(out.look).toContain('Simpro schedule');
    expect(out.look.length).toBeGreaterThan(20);
  });

  it('sends a booking to the schedule', () => {
    expect(whereToCheck(SCHEDULE_BOOK_KIND, {}).look).toContain('Simpro schedule');
    expect(noReference(SCHEDULE_BOOK_KIND)).toBeUndefined();
  });

  it('sends an attachment to the job’s attachments, by filename', () => {
    const out = whereToCheck('attachment', { jobId: '42823', filename: 'Tower-defect-1.jpg' });
    expect(out.look).toContain('attachments');
    expect(out.look).toContain('Tower-defect-1.jpg');
    expect(out.reference).toBeUndefined();
  });

  it('sends an asset change to the register at that site', () => {
    const out = whereToCheck('asset-update', { siteName: 'Fictional Tower', assetNumber: 'FE-014' });
    expect(out.look).toContain('asset register');
    expect(out.look).toContain('Fictional Tower');
    expect(out.look).toContain('FE-014');
    expect(out.reference).toBeUndefined();
  });

  it('sends anything else to the job it belongs to', () => {
    const out = whereToCheck('job-status', { jobId: '42823' });
    expect(out.look).toContain('job 42823');
    expect(out.reference).toBeUndefined();
  });

  it('still reads as a sentence with no job number on the row', () => {
    const out = whereToCheck('job-status', {});
    expect(out.look).toContain('the job');
    expect(out.look).not.toContain('undefined');
  });

  it('never shows a reference for a kind that does not post one', () => {
    for (const kind of [CLOCK_QUEUE_KIND, SCHEDULE_BOOK_KIND, 'attachment', 'asset-update', 'job-status', 'anything']) {
      expect(noReference(kind, { noteKey: 'aaaa1111bbbb2222cccc3333dddd4444' })).toBeUndefined();
    }
  });

  it('never puts a local queue key in front of somebody', () => {
    // The shape of the string that caused this: kind, a pipe, a row id.
    const out = whereToCheck(CLOCK_QUEUE_KIND, {}, 'Annual Leave');
    expect(`${out.look} ${out.reference ?? ''}`).not.toMatch(/timesheet-block\|/);
    expect(`${out.look} ${out.reference ?? ''}`).not.toMatch(/SQ-REF/);
  });
});

describe('the line under a row nobody knows the outcome of', () => {
  it('says when it was queued rather than repeating the heading', () => {
    // It used to print the transport's own words — "Load failed" — under a
    // heading that had already said the connection dropped.
    expect(unknownOutcomeLine('12/09/2026')).toBe('Queued 12/09/2026');
  });

  it('counts the attempts once there has been more than one', () => {
    expect(unknownOutcomeLine('12/09/2026', 3)).toBe('Queued 12/09/2026 · 3 attempts');
  });

  it('says nothing about a single attempt', () => {
    expect(unknownOutcomeLine('12/09/2026', 1)).toBe('Queued 12/09/2026');
  });
});

/**
 * The rule, as a rule.
 *
 * `markerFor` wraps a key in the `[SQ-REF:…]` syntax, and that syntax means
 * one thing: this string is written into the Simpro record. A screen reaching
 * for it directly is how a local queue key came to be printed under the words
 * "search Simpro for the reference below" — and every kind but two has no
 * marker in Simpro at all.
 *
 * So only this module may dress a key that way. A screen asks it where to
 * look, and gets a reference back only where there is genuinely one to find.
 */
describe('no screen may print a reference of its own', () => {
  const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  };

  it('finds the app directory to check against', () => {
    expect(walk(join(__dirname, '..', '..', 'app')).length).toBeGreaterThan(20);
  });

  it('has no screen importing markerFor', () => {
    const offenders = walk(join(__dirname, '..', '..', 'app'))
      .filter((f) => /\bmarkerFor\b/.test(
        readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      ))
      .map((f) => f.split('/app/')[1] ?? f);
    expect(offenders).toEqual([]);
  });

  it('has no screen building the reference syntax by hand either', () => {
    const offenders = walk(join(__dirname, '..', '..', 'app'))
      .filter((f) => /SQ-REF/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split('/app/')[1] ?? f);
    expect(offenders).toEqual([]);
  });
});
