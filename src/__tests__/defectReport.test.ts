import { defectMove, describeDefectReport, type DefectReportOccasion } from '@/domain/defectReport';
import { defectRaisedNote, keyIdentity, type DefectRaisedContext, type RaisedDefect } from '@/domain/outboundWork';
import type { DefectStatus } from '@/domain/types';

/**
 * Telling the office a defect has moved on.
 *
 * Two failures are being guarded here and they pull in opposite directions,
 * which is why the middle of it needs testing rather than eyeballing.
 *
 * The first is silence: a defect the office was told about being rectified,
 * reopened or quoted on the phone and nothing about that ever reaching Simpro.
 * That is the complaint this work exists to answer, so every real move has to be
 * reportable and the words the technician reads must never claim it was sent
 * when it was not.
 *
 * The second is noise. The screens that move a defect's status are lists where
 * the chips are the only thing to press, and the detail screen writes on every
 * keystroke. A report fired on every write posts one note per letter typed in
 * the description — and because the description sits in the identity half of the
 * note's key, not one of those notes would be recognised as a duplicate of the
 * last. So the no-op cases matter as much as the real ones, and the last test
 * here goes through `defectRaisedNote` to prove the two halves of the key behave
 * the way the guard assumes they do rather than the way this file hopes.
 */

const ALL_STATUSES: DefectStatus[] = ['open', 'rectified', 'quoted', 'closed'];

describe('defectMove', () => {
  it('names every real move the way a technician would say it', () => {
    expect(defectMove('open', 'rectified')).toBe('rectified');
    expect(defectMove('open', 'quoted')).toBe('quoted');
    expect(defectMove('open', 'closed')).toBe('closed');
    expect(defectMove('rectified', 'open')).toBe('reopened');
    expect(defectMove('quoted', 'open')).toBe('reopened');
    expect(defectMove('closed', 'open')).toBe('reopened');
    expect(defectMove('quoted', 'rectified')).toBe('rectified');
    expect(defectMove('rectified', 'quoted')).toBe('quoted');
  });

  it('reports nothing when the status has not moved', () => {
    // The tap that costs nothing. A technician working down a list of eleven
    // defects presses the chip the row is already on constantly, and every one
    // of those must not become a note.
    for (const s of ALL_STATUSES) expect(defectMove(s, s)).toBeNull();
  });

  it('has an answer for every pair of statuses, so no transition falls through silently', () => {
    // Guards the switch: a fifth status added to DefectStatus without a case
    // here would return undefined, which is falsy, which means the screens would
    // quietly stop reporting that transition and nobody would see an error.
    for (const before of ALL_STATUSES) {
      for (const after of ALL_STATUSES) {
        const move = defectMove(before, after);
        if (before === after) expect(move).toBeNull();
        else expect(typeof move).toBe('string');
      }
    }
  });
});

describe('describeDefectReport', () => {
  const OCCASIONS: DefectReportOccasion[] = [
    'rectified', 'reopened', 'quoted', 'closed', 'notice issued', 'job linked',
  ];

  it('never tells the technician the office has it, because a queued note is still on the phone', () => {
    for (const occasion of OCCASIONS) {
      const notice = describeDefectReport({ occasion, jobId: '39901', queued: true });
      expect(notice.tone).toBe('pass');
      // The word that must appear, and the promise that must not.
      expect(notice.title).toContain('Queued');
      expect(notice.body).toMatch(/goes up with the next send/);
      expect(`${notice.title} ${notice.body}`).not.toMatch(/\bsent to the office\b|\bthe office has it\b/i);
    }
  });

  it('warns and names the remedy when the defect has no job, and does not pretend the change was lost', () => {
    const notice = describeDefectReport({ occasion: 'rectified', queued: false });
    expect(notice.tone).toBe('warn');
    expect(notice.title).toBe('The office has not been told');
    // The remedy has to be in the words. A technician told only that it failed
    // has no way to work out that a defect raised last year has no job on it.
    expect(notice.body).toMatch(/set the job it belongs to/i);
    // And the local record is safe, which is the other half of what they need.
    expect(notice.body).toMatch(/saved on this phone/i);
  });

  it('treats a job with nothing new as a good outcome rather than a failure', () => {
    const notice = describeDefectReport({ occasion: 'quoted', jobId: '39901', queued: true });
    const duplicate = describeDefectReport({ occasion: 'quoted', jobId: '39901', queued: false });
    expect(duplicate.tone).toBe('info');
    expect(duplicate.tone).not.toBe(notice.tone);
    expect(duplicate.title).toContain('39901');
    expect(duplicate.body).toMatch(/not sent a second time/i);
  });

  it('admits, on the notice screen, that handing the notice over is not itself in the note', () => {
    // The honest bit. noticeIssuedAt is in neither half of the note's key and in
    // none of the note's lines, so a notice handed over on a defect nothing else
    // changed on produces a duplicate and goes nowhere. The technician is told
    // that plainly instead of reading a message that implies the office knows.
    const notice = describeDefectReport({ occasion: 'notice issued', jobId: '39901', queued: false });
    expect(notice.body).toMatch(/handing the notice over does not change the defect/);
    expect(notice.body).not.toMatch(/already reads it the way it now stands/);
  });

  it('says something different for each occasion, so the banner is not the same sentence four times', () => {
    const bodies = OCCASIONS.map((occasion) => describeDefectReport({ occasion, jobId: '39901', queued: true }).body);
    expect(new Set(bodies).size).toBe(OCCASIONS.length);
  });

  it('never puts a bare status word into prose', () => {
    // "The office is told quoted" is what happens when a status column is
    // pasted into a sentence, and this app talks to a person.
    for (const occasion of OCCASIONS) {
      const body = describeDefectReport({ occasion, jobId: '39901', queued: true }).body;
      expect(body).not.toMatch(/told (open|rectified|quoted|closed)[.,]/);
    }
  });
});

/**
 * The assumption the guard rests on, checked against the real note builder.
 *
 * `defectMove` exists because a status change is an amendment the office
 * recognises while a reworded description is a different defect. If that ever
 * stopped being true the guard would be protecting against the wrong thing, so
 * it is asserted here rather than left as a comment.
 */
describe('what the note key does with a change', () => {
  const defect = (over: Partial<RaisedDefect> = {}): RaisedDefect => ({
    id: 'defect-fixture-1',
    location: 'Level 2 riser cupboard',
    description: 'Hose reel nozzle is seized and will not open.',
    severity: 'non-critical',
    status: 'open',
    raisedAt: '2026-09-21T23:30:00.000Z',
    photos: [],
    ...over,
  } as RaisedDefect);

  const context: DefectRaisedContext = {
    jobId: '39901',
    siteId: 'site-fixture-1',
    siteName: 'Fictional Arcade',
  };

  it('reads a status change as an amendment of the same defect', () => {
    const open = defectRaisedNote(defect(), context);
    const rectified = defectRaisedNote(
      defect({ status: 'rectified', rectifiedAt: '2026-09-28T01:00:00.000Z' }),
      context,
    );
    // A different key, so the send layer does queue it and the office reads the
    // new state...
    expect(rectified.key).not.toBe(open.key);
    // ...but the identity half is untouched, which is what makes it an amendment
    // of this defect rather than a second defect in the same cupboard.
    expect(keyIdentity(open.key)).toBeDefined();
    expect(keyIdentity(rectified.key)).toBe(keyIdentity(open.key));
    expect(rectified.note).toContain('rectified');
  });

  it('reads a reworded description as a different defect, which is why keystrokes are not reported', () => {
    const first = defectRaisedNote(defect(), context);
    const halfTyped = defectRaisedNote(defect({ description: 'Hose reel nozzle is seiz' }), context);
    // Both halves move, so every intermediate spelling would be a note of its
    // own that nothing recognises as a duplicate. Hence: report moves, not writes.
    expect(keyIdentity(halfTyped.key)).toBeDefined();
    expect(keyIdentity(halfTyped.key)).not.toBe(keyIdentity(first.key));
  });
});
