import { queueKey, withMarker } from './queueKey';
import { QLD_UTC_OFFSET_HOURS, qldIsoDay, qldMoment } from './qldTime';

/**
 * What a technician does to a job from the card, as the queue carries it.
 *
 * Simpro Mobile lets a person on site move the job's status, write a note,
 * add the parts they used and sign the job off. Until now the phone could
 * only note that it had finished and leave the office to do the rest, so
 * the office typed the materials off a photograph of the van's whiteboard
 * and moved the status by hand. Each of those is a queue row now, keyed on
 * its content so a double tap is one row, and sent by @/simpro/outboundMore
 * — this module only knows what the payloads are, what they are called on
 * the Waiting to send screen, and which office status is the likely one for
 * a word the phone uses. Nothing here touches the database or the network.
 */

export const JOB_STATUS_KIND = 'job-status';
export const JOB_MATERIAL_KIND = 'job-material';
export const JOB_SIGNOFF_KIND = 'job-signoff';

/** The office's status on a job, moved from the phone. The id is Simpro's; the name is for a person. */
export interface JobStatusPayload {
  jobId: string;
  statusId: string;
  statusName: string;
  /** When it was pressed, as an instant. Part of the key: a job may go to the same status twice in a day. */
  at: string;
}

/** A line added to a cost centre: a part from the office catalogue, or a one-off with words and a count. */
export interface JobMaterialPayload {
  jobId: string;
  sectionId: string;
  costCenterId: string;
  kind: 'catalog' | 'oneOff';
  /** The catalogue item, for a catalogue line. Absent on a one-off. */
  catalogId?: string;
  /** The part's name for a catalogue line (shown, never sent); the line itself for a one-off (sent). */
  description: string;
  qty: number;
  at: string;
}

/** The customer's sign-off, as a note on the job. The signature file is a separate attachment row. */
export interface JobSignoffPayload {
  jobId: string;
  signedBy: string;
  signedAt: string;
  /** The note's own key; the marker in the note carries it, so the office record is the proof of sending. */
  noteKey: string;
  subject: string;
  note: string;
}

// ---------------------------------------------------------------------------
// The office's statuses
// ---------------------------------------------------------------------------

/**
 * The job statuses the office uses, by Simpro id.
 *
 * A mirrored job row holds the status name and colour but not the id, and
 * the id is what a PATCH takes. `setup/statusCodes/` is a 404 on this
 * build, so the pairs were read from `jobs/?columns=ID,Status` across every
 * page on 2026-09-09: these are the workflow statuses a job on the books
 * carried that day. A status named for a person is left out on purpose —
 * it is that person's in-tray, not a step in the work, and a technician
 * on site has no business moving a job into it. A status the office adds
 * later is not here until the list is read again; a job seen with a name
 * this list lacks is offered without an id and cannot be sent, which the
 * screen says.
 *
 * A fallback, not the source of truth: once the mirror carries the status
 * id on the job row this list only fills in for a status no mirrored job
 * has worn yet.
 */
export const OFFICE_JOB_STATUSES: readonly { id: string; name: string }[] = [
  { id: '103', name: 'To Be Completed' },
  { id: '108', name: 'To Be Actioned' },
  { id: '109', name: 'Employee Scheduled' },
  { id: '169', name: 'Contractor Scheduled' },
  { id: '113', name: 'In Progress' },
  { id: '114', name: 'End Of Day' },
  { id: '115', name: 'On Hold' },
  { id: '117', name: 'Completed - Ready to Invoice' },
  { id: '369', name: 'Completed & Reviewed' },
  { id: '268', name: 'DLP TEST COMPLETED' },
  { id: '534', name: 'Small Portables Test' },
  { id: '118', name: 'Fully Invoiced' },
  { id: '119', name: 'Fully Paid' },
  { id: '501', name: 'Recurring Invoice' },
  { id: '136', name: 'Contract Site - Recurring Invoice Already Applied' },
  { id: '235', name: 'NO RESPONSE' },
  { id: '336', name: 'Replied - Awaiting Confirmation' },
  { id: '402', name: 'VIEWED ONLINE - Follow Up Required' },
  { id: '435', name: 'Followed Up Once' },
  { id: '304', name: 'Duplicate Job Raised' },
  { id: '301', name: 'Job Cancelled' },
  { id: '106', name: 'Quote : Archived' },
];

export interface StatusChoice {
  /** Simpro's id. Absent where the name was seen on a job but is not in the pinned list: shown, not sendable. */
  id?: string;
  name: string;
  /** The office's colour, from any mirrored job that wore the status. */
  color?: string;
  /** How many mirrored jobs wear it now. Zero for a pinned status no job on the phone has. */
  seen: number;
}

/** A status name as the office would compare it: trimmed, one case, one space. */
export function statusNameKey(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The statuses a technician may pick from, pinned order first.
 *
 * The mirrored jobs are the source of the ids: since v25 each carries the
 * office's own status id beside the name, so a status any job on the phone
 * wears is sendable whether or not anybody pinned it. The pinned list gives
 * the order a job roughly moves through, and an id for a status no mirrored
 * job wears yet. A name with neither goes last with no id: it exists in the
 * office, it can be shown, and it cannot be sent until a job wearing it
 * reaches the phone. The one thing this never does is invent an id.
 */
export function statusChoices(
  jobsSeen: readonly { statusName?: string; statusId?: string; statusColor?: string; count?: number }[],
  known: readonly { id: string; name: string }[] = OFFICE_JOB_STATUSES,
): StatusChoice[] {
  const seen = new Map<string, { name: string; id?: string; color?: string; seen: number }>();
  for (const j of jobsSeen) {
    const key = statusNameKey(j.statusName);
    if (!key) continue;
    const row = seen.get(key) ?? { name: j.statusName!.trim(), seen: 0 };
    row.seen += j.count ?? 1;
    if (!row.id && j.statusId?.trim()) row.id = j.statusId.trim();
    if (!row.color && j.statusColor) row.color = j.statusColor;
    seen.set(key, row);
  }
  const out: StatusChoice[] = known.map((k) => {
    const s = seen.get(statusNameKey(k.name));
    seen.delete(statusNameKey(k.name));
    // The office's own id where a job carried one; the pinned id otherwise.
    return { id: s?.id ?? k.id, name: k.name, color: s?.color, seen: s?.seen ?? 0 };
  });
  for (const s of seen.values()) out.push({ id: s.id, name: s.name, color: s.color, seen: s.seen });
  return out;
}

/**
 * The office status a phone word most likely means.
 *
 * "Started" on the phone is the office's In Progress; "complete" is the
 * status the office moves a finished job to, which on this build is
 * "Completed - Ready to Invoice" — the plain "Completed & Reviewed" is the
 * office's own review step, and "To Be Completed" is the opposite of done.
 * Matched on words rather than ids so a renamed status still finds its
 * match, and undefined rather than a guess where nothing fits.
 */
export function officeStatusFor(local: 'in-progress' | 'complete', choices: readonly StatusChoice[]): StatusChoice | undefined {
  const sendable = choices.filter((c) => c.id);
  const words = (c: StatusChoice) => statusNameKey(c.name);
  if (local === 'in-progress') return sendable.find((c) => words(c).includes('progress'));
  const finished = sendable.filter((c) => /complet/.test(words(c)) && !words(c).startsWith('to be'));
  return finished.find((c) => words(c).includes('invoice')) ?? finished.find((c) => !/review/.test(words(c))) ?? finished[0];
}

export function statusPayload(input: { jobId: string; status: StatusChoice & { id: string }; at: string }): JobStatusPayload {
  return { jobId: input.jobId, statusId: input.status.id, statusName: input.status.name, at: input.at };
}

/** The queue key for a status change: the job, the status and the moment, so the same status twice in a day is two rows. */
export function statusContentKey(p: JobStatusPayload): string {
  return queueKey(JOB_STATUS_KIND, { jobId: p.jobId, statusId: p.statusId, at: p.at });
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export type MaterialCheck =
  | { ok: true; payload: JobMaterialPayload }
  | { ok: false; why: string };

/**
 * A material line as typed, checked before it is queued.
 *
 * The office rejects a blank description and a zero quantity, but only once
 * the row is sent — by which time the technician has driven off. So the
 * checks that can be made on the phone are made here, in words the screen
 * shows beside the field. A quantity is a positive number with at most three
 * decimals, the way Simpro stores one; a catalogue line needs its catalogue
 * id, a one-off its words.
 */
export function materialLine(input: {
  jobId: string;
  sectionId: string;
  costCenterId: string;
  kind: 'catalog' | 'oneOff';
  catalogId?: string;
  description: string;
  qty: number | string;
  at: string;
}): MaterialCheck {
  const description = input.description.trim();
  const qty = typeof input.qty === 'number' ? input.qty : Number(String(input.qty).trim());
  if (!input.jobId.trim()) return { ok: false, why: 'This job has no Simpro job number, so there is nowhere to put the line.' };
  if (!input.sectionId.trim() || !input.costCenterId.trim()) return { ok: false, why: 'Pick the cost centre the line goes under.' };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, why: 'Quantity has to be more than zero.' };
  if (Math.round(qty * 1000) !== qty * 1000) return { ok: false, why: 'Quantity can have up to three decimal places.' };
  if (input.kind === 'catalog' && !input.catalogId?.trim()) return { ok: false, why: 'Pick a part from the catalogue.' };
  if (!description) return { ok: false, why: input.kind === 'oneOff' ? 'Say what the line is.' : 'Pick a part from the catalogue.' };
  return {
    ok: true,
    payload: {
      jobId: input.jobId.trim(),
      sectionId: input.sectionId.trim(),
      costCenterId: input.costCenterId.trim(),
      kind: input.kind,
      catalogId: input.kind === 'catalog' ? input.catalogId!.trim() : undefined,
      description,
      qty,
      at: input.at,
    },
  };
}

/** The queue key for a line: the whole payload, moment included, so the same part added twice on purpose is two lines. */
export function materialContentKey(p: JobMaterialPayload): string {
  return queueKey(JOB_MATERIAL_KIND, p);
}

// ---------------------------------------------------------------------------
// Sign-off
// ---------------------------------------------------------------------------

/** The Queensland clock of an instant as HHmmss, or undefined for anything that is not an instant. */
function qldStamp(iso: string): string | undefined {
  if (qldIsoDay(iso) === undefined || !/T/.test(iso)) return undefined;
  const ms = Date.parse(iso.trim());
  if (!Number.isFinite(ms)) return undefined;
  const shifted = new Date(ms + QLD_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return [shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds()].map((n) => String(n).padStart(2, '0')).join('');
}

/**
 * The name of the signature file on the job.
 *
 * The Queensland day so the office reads it at a glance, then the clock to
 * the second: a second sign-off on the same day — the wrong name typed the
 * first time, a second person for a second area — is a second file, and
 * the first is not written over while its queue row still points at it.
 * `sequence` is for the one case the clock cannot separate, two files in
 * the same second on the same phone; the card counts up until the name is
 * free.
 */
export function signatureFilename(jobId: string, signedAt: string, sequence?: number): string {
  const when = [qldIsoDay(signedAt) ?? 'undated', qldStamp(signedAt)].filter(Boolean).join(' ');
  const suffix = sequence && sequence > 1 ? ` (${sequence})` : '';
  return `Sign-off ${jobId} ${when}${suffix}.svg`;
}

/**
 * The sign-off note, with its key already in the text.
 *
 * Keyed on the job, who signed and the Queensland day: one sign-off per
 * person per day per job, so a tap that lands twice is one note, and a
 * second visit on another day is another. The customer's name is in the
 * note because the office reads the note and not the file list; the file
 * is named beside it so they know where the signature itself is. The card
 * passes the name it actually wrote the file under, since that can carry a
 * sequence the plain name does not; without it the note names the file
 * the instant would get.
 */
export function signOffNote(
  job: { externalId: string; title: string; siteName: string },
  signedBy: string,
  at: string,
  options: { signatureFile?: string } = {},
): JobSignoffPayload {
  const jobId = job.externalId.trim();
  const who = signedBy.trim();
  const day = qldIsoDay(at);
  const noteKey = queueKey(JOB_SIGNOFF_KIND, { jobId, signedBy: statusNameKey(who), day: day ?? at });
  const lines = [
    `SIGNED OFF - ${job.title.trim() || 'job'}`,
    `Site: ${job.siteName}`,
    `Signed by: ${who || 'name not recorded'}`,
    `Signed: ${qldMoment(at) ?? at}`,
    `Signature: ${options.signatureFile?.trim() || signatureFilename(jobId, at)} in this job's attachments.`,
    'Signed off in the Safe QLD field app.',
  ];
  return {
    jobId,
    signedBy: who,
    signedAt: at,
    noteKey,
    subject: `Signed off - ${job.siteName} - ${day ?? ''}`.trim().slice(0, 200),
    note: withMarker(lines.join('\n'), noteKey),
  };
}

// ---------------------------------------------------------------------------
// Waiting to send
// ---------------------------------------------------------------------------

/**
 * One line for a queued job change, for a person deciding whether it went.
 *
 * Undefined for a kind this module does not own, so the screen's own switch
 * can go on to the next. A payload with a field missing still names what it
 * can: a row is easier to find in Simpro by half a description than by its
 * kind alone.
 */
export function describeJobChange(kind: string, payload: unknown): string | undefined {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<JobStatusPayload & JobMaterialPayload & JobSignoffPayload>;
  const job = p.jobId ? `job ${p.jobId}` : 'a job';
  switch (kind) {
    case JOB_STATUS_KIND:
      return `Status of ${job} to ${p.statusName ?? (p.statusId ? `status ${p.statusId}` : '?')}`;
    case JOB_MATERIAL_KIND: {
      const qty = typeof p.qty === 'number' ? `${p.qty} × ` : '';
      const what = p.description ?? (p.catalogId ? `catalogue item ${p.catalogId}` : 'a line');
      return `${p.kind === 'oneOff' ? 'One-off' : 'Material'} on ${job}: ${qty}${what}`;
    }
    case JOB_SIGNOFF_KIND:
      return `Sign-off on ${job} by ${p.signedBy?.trim() || 'an unnamed customer'}`;
    default:
      return undefined;
  }
}
