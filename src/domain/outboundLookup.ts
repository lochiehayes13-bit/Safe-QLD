import { CLOCK_QUEUE_KIND } from './clockOn';
import { JOB_SIGNOFF_KIND } from './jobActions';
import { isScheduleKind } from './scheduling';
import { isAssetChangeKind } from './assetChanges';
import { markerFor } from './queueKey';

/**
 * Where to look in Simpro for something the app is not sure landed.
 *
 * A request goes out, the van drives into a basement, and the connection dies
 * before Simpro answers. It may have been accepted. Sending again could post
 * it twice, so the app refuses and asks a person to go and look — which is the
 * right call, and it was being asked impossibly.
 *
 * What the screen showed was `[SQ-REF:timesheet-block|1e5f9769-aa40-…]`, under
 * the words "search Simpro for the reference below". That string is a LOCAL
 * key. It is how the queue on this phone recognises a row it already holds, so
 * that editing a clock entry does not make a second one; it has never been
 * written into any Simpro record and never will be. A technician could search
 * Simpro for it until the end of the shift and find nothing, and would
 * reasonably conclude the app was broken — or worse, press Send again.
 *
 * Only two things this app posts carry a reference that is genuinely in the
 * record: a job note and a purchase order, both of which have the marker
 * appended to their text by `withMarker`. Everywhere else the honest answer is
 * not a reference at all — it is a place. The schedule for that day. The
 * attachments on that job. The asset at that site.
 *
 * So this says the place, in the words a person would use to get there, and it
 * offers a reference only where one is really there to be found.
 */

export interface OutboundLookup {
  /** Where to go and what to look at, as an instruction. */
  look: string;
  /**
   * The marker written into the Simpro record, for the two kinds that carry
   * one. Absent everywhere else, because showing a local key as though it were
   * findable is the fault this module exists to fix.
   */
  reference?: string;
}

/** What the queue row's payload might carry. Everything optional: it is read from JSON. */
export interface LookupPayload {
  jobId?: string;
  subject?: string;
  filename?: string;
  siteName?: string;
  date?: string;
  assetNumber?: string;
  noteKey?: string;
}

const JOB_NOTE_KIND = 'job-note';
const PURCHASE_ORDER_KIND = 'purchase-order';
const ATTACHMENT_KIND = 'attachment';

/** "job 42823" where there is one, so a sentence can be built either way. */
function jobPhrase(p: LookupPayload): string {
  return p.jobId?.trim() ? `job ${p.jobId.trim()}` : 'the job';
}

/**
 * Where to check, for one queued row.
 *
 * `describe` is the line already on the card — "Annual Leave, 07:00–15:00,
 * 20 Oct" — so a kind that knows nothing else about itself can still point at
 * the day it names rather than at nothing.
 */
export function whereToCheck(kind: string, payload: LookupPayload, describe?: string): OutboundLookup {
  if (kind === JOB_NOTE_KIND) {
    return {
      look: `Open ${jobPhrase(payload)} in Simpro and read its notes. The note carries the reference below, so `
        + 'searching the job for it finds the one this phone sent.',
      reference: payload.noteKey?.trim() ? markerFor(payload.noteKey.trim()) : undefined,
    };
  }

  if (kind === JOB_SIGNOFF_KIND) {
    return {
      look: `Open ${jobPhrase(payload)} in Simpro and read its notes — a sign-off posts as a note. It carries the `
        + 'reference below where one was made.',
      reference: payload.noteKey?.trim() ? markerFor(payload.noteKey.trim()) : undefined,
    };
  }

  if (kind === PURCHASE_ORDER_KIND) {
    return {
      look: `Open ${jobPhrase(payload)} in Simpro and look at its purchase orders. The order's notes carry the `
        + 'reference below.',
      reference: payload.noteKey?.trim() ? markerFor(payload.noteKey.trim()) : undefined,
    };
  }

  if (kind === ATTACHMENT_KIND) {
    const named = payload.filename?.trim();
    return {
      look: `Open ${jobPhrase(payload)} in Simpro and look at its attachments`
        + (named ? ` for a file called "${named}".` : '.'),
    };
  }

  if (kind === CLOCK_QUEUE_KIND) {
    // Hours and leave land on the person's own day in the Simpro schedule.
    // There is no reference on them anywhere: the block is either on the day
    // or it is not, and that is a thing somebody can actually look at.
    return {
      look: 'Open the Simpro schedule for that day and look at your own row. '
        + (describe?.trim() ? `You are looking for ${describe.trim()}.` : 'The block is either there or it is not.'),
    };
  }

  if (isScheduleKind(kind)) {
    return {
      look: 'Open the Simpro schedule for that day and look at your own row. '
        + (describe?.trim() ? `You are looking for ${describe.trim()}.` : 'The block is either there or it is not.'),
    };
  }

  if (isAssetChangeKind(kind)) {
    const where = payload.siteName?.trim();
    const which = payload.assetNumber?.trim();
    return {
      look: `Open the customer asset register in Simpro${where ? ` for ${where}` : ''} and find `
        + `${which ? `asset ${which}` : 'the asset'}. The change is either on it or it is not.`,
    };
  }

  // A status, a line, a cost centre — everything else the job card sends.
  return {
    look: `Open ${jobPhrase(payload)} in Simpro and see whether the change is on it.`,
  };
}

/**
 * The one-line reason under a row whose outcome nobody knows.
 *
 * Not the raw error. "Load failed" was being printed under a leave block, and
 * it is the transport's word for a request that did not come back — which the
 * heading above it has already said, better. A person reading this needs the
 * day it was queued, not a phrase from a networking library.
 */
export function unknownOutcomeLine(queuedOn: string, attempts?: number): string {
  const tries = attempts && attempts > 1 ? ` · ${attempts} attempts` : '';
  return `Queued ${queuedOn}${tries}`;
}
