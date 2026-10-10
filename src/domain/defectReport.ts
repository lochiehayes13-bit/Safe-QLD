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

/** The status as a technician reads it on a chip. */
export function defectStatusLabel(status: DefectStatus): string {
  switch (status) {
    case 'open': return 'Open';
    case 'quoted': return 'Quoted';
    case 'rectified': return 'Rectified';
    case 'closed': return 'Closed';
  }
}

/**
 * The news itself, as the opening of the banner's sentence.
 *
 * One phrase per occasion so the queued banner says which change is on its
 * way rather than the same sentence for all of them.
 */
function newsOf(occasion: DefectReportOccasion): string {
  switch (occasion) {
    case 'rectified': return 'Rectified note';
    case 'reopened': return 'Reopened note';
    case 'quoted': return 'Quoted note';
    case 'closed': return 'Closed note';
    // Each phrase is one note, so "goes" agrees with all of them.
    case 'notice issued': return 'Notice handover note';
    case 'job linked': return 'Defect note';
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
 *
 * Handing the critical defect notice over does not change the defect, and the
 * note is built from the defect, so a notice given on a defect that changed in
 * no other way comes back as a duplicate. That banner says the notice is
 * recorded rather than implying the office was told.
 *
 * A duplicate is not proof the office has it either: the queue also calls a
 * note a duplicate while the earlier copy is still pending on this phone, so
 * that banner says nothing new went rather than that the job holds it.
 */
export function describeDefectReport(outcome: DefectReportOutcome): DefectReportNotice {
  if (!outcome.jobId) {
    return {
      tone: 'warn',
      title: 'No job on this defect',
      body: 'Saved on this phone. Set the job to send it to the office.',
    };
  }

  if (!outcome.queued) {
    return {
      tone: 'info',
      title: `Nothing new for job ${outcome.jobId}`,
      body: outcome.occasion === 'notice issued'
        ? 'Notice recorded on this defect.'
        : 'No change since the last note.',
    };
  }

  return {
    tone: 'pass',
    title: `Queued for job ${outcome.jobId}`,
    body: `${newsOf(outcome.occasion)} goes with the next send.`,
  };
}
