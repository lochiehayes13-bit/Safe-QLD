/**
 * Telling the office a defect has moved on.
 *
 * Raising a defect is only the first half of it. The screens that change what a
 * defect is — rectified on the way out, reopened because the part was wrong,
 * quoted because it is not a warranty job, the occupier's notice handed over —
 * wrote the new state into SQLite and stopped there, so a defect the office had
 * been told about stayed "open" in Simpro for as long as the job did. The
 * scheduler who booked the return visit had no way of knowing it had already
 * been fixed, and the only thing that ever corrected it was a phone call.
 *
 * Two decisions live here rather than in the four screens that need them, and
 * both of them are the sort of thing that goes subtly different in four places
 * if it is written four times.
 *
 * The first is which changes are worth a note at all. This matters more than it
 * sounds. The note's key is built in two halves (see `defectRaisedNote`): the
 * identity half holds the location, the wording and the moment it was raised,
 * and the content half holds everything else. So a change to the status reads at
 * the other end as an amendment of a defect the office already has, while a
 * change to the wording reads as a different defect and gets its own note. That
 * is the right way round for the office, but it means a screen that reported
 * every keystroke in the description field would post one note per letter typed,
 * none of them recognised as a duplicate of the last. Only a deliberate move
 * from one status to another goes through here, and `defectMove` is what makes
 * that judgement rather than a `!==` written slightly differently on each screen.
 *
 * The second is what to say to the technician afterwards. There are three real
 * outcomes and each of them means something different for their afternoon: the
 * note is queued and will go, the office already has exactly this and nothing
 * needs sending, or the defect is not linked to a job and so nothing can be sent
 * at all until somebody links it. Saying "sent" for the third of those is the
 * failure this whole change exists to fix, so the words are written once, here,
 * where they can be read next to each other and tested.
 *
 * Pure: no database, no queue, no clock. The screens do the reading and the
 * queueing; this decides and this speaks.
 */

import type { DefectStatus } from './types';

/**
 * A status change the office has to be told about, named the way a technician
 * would say it rather than the way the column stores it.
 *
 * `reopened` is not a status — the column goes back to `open` — but "it is open
 * again" and "it was raised" are different pieces of news to somebody holding a
 * schedule, and the word the note carries should say which one happened.
 */
export type DefectMove = 'rectified' | 'reopened' | 'quoted' | 'closed';

/**
 * What the status just did, or nothing where it did not move.
 *
 * Called with the status as the row held it and the status about to be written.
 * A `null` means do not queue: the commonest way to get one is a technician
 * tapping the chip the defect is already on, which happens constantly on a list
 * where the chips are the only thing to press, and which must not cost a note.
 */
export function defectMove(before: DefectStatus, after: DefectStatus): DefectMove | null {
  if (before === after) return null;
  switch (after) {
    case 'rectified': return 'rectified';
    case 'quoted': return 'quoted';
    case 'closed': return 'closed';
    // Back to open from anywhere is a reopening. From `rectified` that is a
    // repair that did not hold or a tap on the wrong row; from `quoted` it is a
    // quote that was withdrawn. Either way the office is being told to put the
    // work back on the list, which is the part that matters.
    case 'open': return 'reopened';
  }
}

/**
 * Why a defect is being reported, where it was not a status change.
 *
 * `notice issued` is the critical defect notice reaching the occupier's hands,
 * and `job linked` is a defect that had no job on it being given one — which is
 * the first moment anything about it can reach Simpro at all, so it is reported
 * in full rather than waiting for its next status change.
 */
export type DefectReportOccasion = DefectMove | 'notice issued' | 'job linked';

/** What came back from the queue, as the screen saw it. */
export interface DefectReportOutcome {
  occasion: DefectReportOccasion;
  /**
   * The Simpro job the note went to. Absent means the defect has no job on its
   * row, which is the case for every defect raised before the app started
   * recording one, and is the outcome the technician most needs told about.
   */
  jobId?: string;
  /**
   * True where a new queue row was written. False with a job means the office
   * already holds a note saying exactly this, which is a good outcome and not a
   * failure — see `queueDefectNote`.
   */
  queued: boolean;
}

/** What the technician is told, shaped for the `Banner` the screens already use. */
export interface DefectReportNotice {
  tone: 'pass' | 'info' | 'warn';
  title: string;
  body: string;
}

/**
 * The news itself, as the sentence that follows "the office is told".
 *
 * Written as a clause rather than a word so the three outcomes below can each
 * put it in a different sentence without any of them reading like a status
 * column pasted into prose.
 */
function newsOf(occasion: DefectReportOccasion): string {
  switch (occasion) {
    case 'rectified': return 'that it has been rectified';
    case 'reopened': return 'that it is open again';
    case 'quoted': return 'that it has been quoted';
    case 'closed': return 'that it is closed';
    case 'notice issued': return 'the details from the notice';
    case 'job linked': return 'about this defect';
  }
}

/**
 * What to put on screen after trying to report a defect.
 *
 * Deliberately never says the office has the defect. A queued note is on this
 * phone, not in Simpro, and on a work phone in a basement plant room it can sit
 * there for the rest of the afternoon — so the words say queued and say when it
 * goes, because a technician who reads "sent" and drives away has been told
 * something the app does not know.
 */
export function describeDefectReport(outcome: DefectReportOutcome): DefectReportNotice {
  const news = newsOf(outcome.occasion);

  if (!outcome.jobId) {
    return {
      tone: 'warn',
      title: 'The office has not been told',
      body: 'The office works in jobs, not sites, so there is nowhere on their side to put a note about a '
        + 'defect until the defect is linked to one. This one has no job on it, which almost always means it '
        + 'was raised before the app started recording the job. Open the defect, set the job it belongs to, '
        + `and the office is told ${news} then. The change is saved on this phone either way.`,
    };
  }

  if (!outcome.queued) {
    return {
      tone: 'info',
      title: `Job ${outcome.jobId} already has this`,
      body: outcome.occasion === 'notice issued'
        // Said out loud because it is a real limit and not a tidy outcome. The
        // note is built from the defect, and the defect's note does not carry
        // the fact that the written notice changed hands — so where the
        // technician filled nothing else in on the notice screen there is
        // genuinely nothing new to send, and claiming otherwise would have them
        // believe the office knows the notice was given when it does not.
        ? 'The note on the job is built from the defect itself, and handing the notice over does not change '
          + 'the defect. Nothing on it has changed since the last note, so nothing is sent twice. The notice '
          + 'itself is the document you have just handed over, and it is recorded against this defect.'
        : `Nothing about this defect has changed since the last note went to job ${outcome.jobId}, so it is `
          + 'not sent a second time. The office already reads it the way it now stands.',
    };
  }

  return {
    tone: 'pass',
    title: `Queued for job ${outcome.jobId}`,
    // Deliberately does not call it an amendment. It usually is one -- the office
    // already holds a note about this defect and this one supersedes it -- but a
    // defect that has just been linked to a job for the first time has no earlier
    // note to amend, and the same sentence has to be true for both.
    body: `The office is told ${news}. It is queued on this phone and goes up with the next send, so a plant `
      + 'room with no signal costs nothing but a wait.',
  };
}
