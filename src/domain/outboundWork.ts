import {
  AS1851_CLASS_LABEL, AS1851_CLASS_OBLIGATION, criticalNoticeDueAt, isQldCriticalDefect,
  rectificationDueAt, type As1851Class,
} from '@/domain/qldCompliance';
import { qldDay, qldIsoDay, qldMoment } from '@/domain/qldTime';
import { queueKey } from '@/domain/queueKey';
import { extensionFor } from '@/domain/photoStore';

/**
 * Pushing a completed routine service back to the office system.
 *
 * The integration pulls sites, jobs and the rate card down, and pushes notes and
 * purchase orders up, but the one thing a technician actually produces — a
 * finished routine service, its results, and the defects it raised — never
 * leaves the phone. The office finds out when the paperwork arrives, which on a
 * bad week is a fortnight, and by then an invoice has gone out for a service
 * that was nine assets short.
 *
 * This module is the mapping and nothing else: plain data in, a plan of
 * outbound items out. It cannot reach the database or the network, which is
 * what makes every decision below testable on its own.
 *
 * Three things go out of it: the service record and any critical defect
 * notice as job notes, the photographs of each defect as job attachments —
 * one file each, named so the office can read them without opening them — and
 * a short "work completed" note when a job is marked complete on the phone.
 * The attachments are planned here and queued by the send layer, because a
 * photograph is a few megabytes and a basement has no signal.
 *
 * Four rules shape it.
 *
 * **Say the number that decides invoicing.** A note reading "service complete"
 * when nine assets were never reached is a lie the office acts on. Every
 * summary states passed, failed and not-tested, names the not-tested reasons,
 * and where a reason was not recorded it says that too rather than rounding it
 * into the pass column.
 *
 * **A critical defect is unmissable.** It starts a 24-hour written notice and a
 * one-month rectification clock, so it goes out as its own note, ordered ahead
 * of everything else, marked in the subject line, and repeated at the top of
 * the service note in case only one of the two is ever read.
 *
 * **A retry may never post twice.** The queue retries, and the network fails
 * after the server accepted. Every item carries a key derived from its own
 * content — not from a local row id, which changes when the app is reinstalled
 * — so the same service produces the same key forever and a duplicate is
 * detectable both by this app and by a human reading the notes. A duplicated
 * service record is worse than a missing one: nobody goes looking for it, and
 * it double-counts in the office's compliance reporting.
 *
 * **Nothing is sent that the office system is the record for, and nothing
 * overwrites a person.** Concretely, this module will never emit: money of any
 * kind (rates, prices, hours, invoice values — those live in Simpro and a
 * second unreconciled figure in a note is how a job gets billed twice); a
 * change to a job's stage, status, dates or description (only appended notes go
 * out, so a scheduler's edit cannot be clobbered by a phone that has been
 * offline for a week); customer, site or contact details (the office maintains
 * those, and a pull already declines to overwrite them in the other direction);
 * a statutory notice or occupier statement (those are issued to the occupier
 * and copied to the Commissioner — filing one as a job note would look like the
 * notice had been given when it has not); and any defect the office has already
 * been told about.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low';

export type SourceId =
  | 'simpro-job-notes'
  | 'simpro-note-size'
  | 'bfsr-2008'
  | 'as1851-notification';

export interface Source {
  id: SourceId;
  what: string;
  ref: string;
  url: string;
  confidence: Confidence;
  /** Why the confidence is what it is, so a reader can weigh it themselves. */
  basis: string;
}

export const SOURCES: Record<SourceId, Source> = {
  'simpro-job-notes': {
    id: 'simpro-job-notes',
    what: 'That a job note is created by POSTing Subject and Note to jobs/{jobID}/notes/, and that a note is '
      + 'appended rather than replacing anything already on the job',
    ref: 'Simpro API documentation, job notes endpoint; and the same call already in use in this app '
      + '(src/simpro/resources.ts, addJobNote)',
    url: 'https://developer.simprogroup.com/apidoc/',
    confidence: 'high',
    basis: 'The endpoint is in production use from this codebase, so its shape is observed rather than assumed.',
  },
  'simpro-note-size': {
    id: 'simpro-note-size',
    what: 'How long a job note may be',
    ref: 'Not published. Simpro documents the note fields without stating a maximum, and the API returns no '
      + 'schema length for them',
    url: 'https://developer.simprogroup.com/apidoc/',
    confidence: 'low',
    basis: 'A guessed limit that is too high loses the tail of a service record silently on the server, which is '
      + 'the exact failure this module exists to prevent. The budget below is therefore deliberately '
      + 'conservative and is a Safe QLD decision, not a Simpro fact. Raise it only against a documented limit.',
  },
  'bfsr-2008': {
    id: 'bfsr-2008',
    what: 'That a critical defect obliges a written notice to the occupier within 24 hours after the '
      + 'maintenance is carried out, and rectification within one month of it, which is why a critical defect '
      + 'cannot wait behind a summary note and why both clocks are counted from the maintenance rather than '
      + 'from the moment the defect was written up',
    ref: 'Building Fire Safety Regulation 2008 (Qld) s 53 (notice) and s 54 (rectification). The clocks '
      + 'themselves are computed in src/domain/qldCompliance.ts and are not restated here',
    url: 'https://www.legislation.qld.gov.au/view/html/inforce/current/sl-2008-0160',
    confidence: 'high',
    basis: 'Queensland subordinate legislation. This module only orders and labels; it derives no date of its own.',
  },
  'as1851-notification': {
    id: 'as1851-notification',
    what: 'That a critical defect is notified verbally before leaving site and confirmed in writing, which is why '
      + 'a missing verbal notification is stated in the note rather than left blank',
    ref: 'AS 1851 defect classification and notification expectations, as already captured in '
      + 'src/domain/qldCompliance.ts (AS1851_CLASS_OBLIGATION). No clause text is reproduced',
    url: 'https://store.standards.org.au/product/as-1851-2012',
    confidence: 'medium',
    basis: 'Held second-hand from this app\'s own compliance module rather than read from the standard here. '
      + 'The obligation wording is Safe QLD\'s paraphrase, which is why the note says what was recorded and '
      + 'never asserts that an obligation has been met.',
  },
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface FieldLimit {
  chars: number;
  sourceId: SourceId;
  confidence: Confidence;
  why: string;
}

/**
 * What fits in a note, and on whose authority.
 *
 * The subject figure is certain because this app's own client truncates there;
 * the body figure is a decision, not a fact, and is marked as one.
 */
export const NOTE_LIMITS: { subject: FieldLimit; body: FieldLimit } = {
  subject: {
    chars: 200,
    sourceId: 'simpro-job-notes',
    confidence: 'high',
    why: 'The app\'s Simpro client already cuts a subject at 200 characters, so composing longer only moves the '
      + 'cut somewhere this module cannot see or report.',
  },
  body: {
    chars: 4000,
    sourceId: 'simpro-note-size',
    confidence: 'low',
    why: 'No published maximum. Chosen low enough that a note is very unlikely to be refused or trimmed by the '
      + 'server, because a server-side trim happens silently and takes the end of the record — which is where '
      + 'the not-tested assets are.',
  },
};

/**
 * The smallest amount of a section worth keeping at all.
 *
 * Used twice: a section with less room than this is left out whole rather than
 * reduced to a fragment, and a sentence end this early in a block is passed over
 * in favour of a later line ending, so a list is cut between its lines instead
 * of after its first heading.
 */
const MIN_USEFUL_SECTION = 120;

// ---------------------------------------------------------------------------
// Dates — Queensland is UTC+10 all year and never shifts
// ---------------------------------------------------------------------------

/*
 * One copy of the Queensland day, in qldTime.ts.
 *
 * These three were written here first and this module is where they are used
 * hardest — every statutory clock in the office push runs through them — so a
 * second copy grew in qldTime.ts and the suite held the two against each other
 * rather than move the tested one. Holding two copies to each other only proves
 * they agree on what somebody thought to compare, and what nobody compared was
 * an Australian date: both read "1/9/2026" as the ninth of January.
 *
 * Re-exported rather than deleted, because these are part of this module's
 * surface and its tests read them from here.
 */
export { qldDay, qldIsoDay, qldMoment } from '@/domain/qldTime';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type OutboundResultOutcome = 'pass' | 'fail' | 'not-tested';

/** One asset as this visit left it. */
export interface OutboundResult {
  assetId: string;
  /** The number written on the asset's own tag, which is how the office finds it. */
  assetNumber?: string;
  name?: string;
  location?: string;
  /** Detection, extinguishers, hydrants — used to group the note, never invented. */
  system?: string;
  outcome: OutboundResultOutcome;
  /** Required in substance on a not-tested; its absence is reported, not hidden. */
  notTestedReason?: string;
  notes?: string;
}

/** A defect as this visit raised it. Mirrors the fields of `Defect` that the office needs. */
export interface OutboundDefect {
  id: string;
  location: string;
  description: string;
  severity: 'critical' | 'non-critical';
  status: 'open' | 'rectified' | 'quoted' | 'closed';
  raisedAt: string;
  as1851Class?: As1851Class;
  /** Limb (a) of the Queensland test: the defect renders the installation inoperable. */
  qldLimbInoperable?: boolean;
  /** Limb (b): reasonably likely to significantly affect occupant safety. */
  qldLimbAdverseImpact?: boolean;
  verbalNotifiedAt?: string;
  verbalNotifiedTo?: string;
  interimMeasures?: string;
  assetNumber?: string;
  photoCount?: number;
  /**
   * The photographs themselves, where the caller could find them.
   *
   * Each carries its size on disk, which is how the caller says the file is
   * still there: a photograph whose file has gone has no size, and the plan
   * declines it out loud rather than queueing an upload that can never run.
   * Absent altogether (an older caller, or one that did not look), and the
   * count above is all the note can say.
   */
  photos?: OutboundPhoto[];
  /**
   * Set once the office has this defect. The office system is the record for it
   * from that moment, so it is never sent again — a second copy reads as a
   * second defect and gets a second job.
   */
  sentToOfficeAt?: string;
}

/** One photograph of a defect, as stored on the phone. */
export interface OutboundPhoto {
  /** The path as the defect record holds it — relative to document storage, or an absolute file URI. */
  path: string;
  /** Bytes on disk. Undefined means the file could not be found. */
  sizeBytes?: number;
}

/** The completed run, as the app recorded it. */
export interface CompletedRoutineRun {
  /** Local row id. Deliberately not part of any key — see `outboundKey`. */
  runId: string;
  siteId: string;
  siteName: string;
  /**
   * The Simpro job this service was done under. Without it nothing can be sent:
   * a note has nowhere to go, and guessing a job number posts a service against
   * somebody else's work.
   */
  jobId?: string;
  routineId: string;
  routineLabel: string;
  frequency: string;
  system: string;
  /** ISO instant the run was completed. */
  completedAt: string;
  technician?: string;
  /** The technician's own summary, if they wrote one. */
  notes?: string;
  /** Reference of the issued service report, so the note can point at the full record. */
  reportRef?: string;
}

/** Counts the run row already carries, for cross-checking against the results. */
export interface DeclaredCounts {
  passed: number;
  failed: number;
  notTested: number;
}

export interface PlanOptions {
  /**
   * Keys already accepted by the office system. An exact match is not sent
   * again; a match on the identity half means this attendance was already
   * reported and the content has since changed, which is an amendment and is
   * labelled as one.
   */
  alreadySentKeys?: string[];
  /** Counts from the run row. Supplied, they are cross-checked; absent, nothing is assumed. */
  declaredCounts?: DeclaredCounts;
  /** Where the full record lives, in words a person in the office can act on. */
  fullRecordAt?: string;
  /** Overrides the note body budget. Used by tests and by a future documented limit. */
  bodyLimit?: number;
  /**
   * Whether defect photographs go to the job as attachments. On unless the
   * technician has switched it off in Settings; off, the note still states
   * the count and says where the photographs are.
   */
  sendPhotos?: boolean;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * The transport kind.
 *
 * The queue dispatches 'job-note', 'purchase-order', 'asset-test' and
 * 'attachment', and silently marks anything else as sent — so a kind invented
 * here without a matching branch in flushQueue drops a technician's service
 * record on the floor without a word. Add both together or neither.
 */
export type OutboundWorkKind = 'job-note' | 'asset-test' | 'attachment';

/**
 * A test result going back onto the asset in the office system.
 *
 * Held as its own kind rather than folded into the note, because a note is
 * prose a person reads and this is a field the office schedules from. It is
 * also the only outbound kind that changes an existing record rather than
 * appending to one, which is why it is off unless explicitly switched on.
 */
export interface OutboundAssetTest {
  /** Simpro's own id for the asset. Local ids mean nothing to the office. */
  externalAssetId: string;
  result: 'Pass' | 'Fail';
  /** ISO date the test was carried out, not the date it is being sent. */
  testedAt: string;
  /** Which frequency was serviced — a result with no frequency says nothing. */
  serviceLevelId: string;
  /** What the technician saw, for the queue screen. Never sent to Simpro. */
  description: string;
}

export interface OutboundJobNote {
  jobId: string;
  subject: string;
  note: string;
  /** Repeated in the payload so the queue row carries it even if the note is edited. */
  key: string;
  truncated: boolean;
  /** Characters of composed record that did not fit. Zero when nothing was cut. */
  omittedChars: number;
  /** Named sections that were shortened or left out entirely. */
  omittedSections: string[];
  /** Where the whole record is, stated in the note itself as well. */
  fullRecordAt: string;
}

/**
 * A photograph going onto the job as an attachment.
 *
 * The file itself is not here — a plan is data a screen shows and a test
 * inspects, and a base64 photograph is megabytes of neither. The send layer
 * reads the file at `localUri` when it uploads, so a path that is stored
 * relative to document storage still resolves after the app is reinstalled
 * and the container path moves.
 */
export interface OutboundAttachment {
  jobId: string;
  /** As the defect record holds it: relative to document storage, or an absolute file URI. */
  localUri: string;
  /** "<site> — <defect location> — <date>.jpg", numbered where a defect has several. */
  filename: string;
  mimeType: string;
  /** What the photograph is of, for a queue screen. Never sent: Simpro attachments carry no caption. */
  subject: string;
  sizeBytes: number;
  /** The queue's content key: job, filename and size. Repeated in the item so the queue row carries it. */
  key: string;
}

export interface OutboundNoteItem {
  /**
   * A job note. This type is the composed note plan, not the queue row — the
   * queue stores `kind` and arbitrary JSON, and an asset test is enqueued
   * directly rather than composed here.
   */
  kind: 'job-note';
  key: string;
  payload: OutboundJobNote;
  /** One line a person can read in a queue screen and know what it is. */
  description: string;
  /** Critical items are ordered first and must not be batched behind anything. */
  urgency: 'critical' | 'routine';
}

export interface OutboundAttachmentItem {
  kind: 'attachment';
  key: string;
  payload: OutboundAttachment;
  description: string;
  /** Never critical: the notice is the urgent thing, and it says the photographs are coming. */
  urgency: 'routine';
}

export type OutboundItem = OutboundNoteItem | OutboundAttachmentItem;

/**
 * The two shapes a plan item takes, told apart.
 *
 * A note is posted and read back; an attachment is queued and uploaded. A
 * screen or a sender that treats the union as a note reads `.note` off a
 * photograph and renders nothing, so the guards are exported rather than
 * each caller writing its own `kind ===` and drifting.
 */
export function isNoteItem(item: OutboundItem): item is OutboundNoteItem {
  return item.kind === 'job-note';
}

export function isAttachmentItem(item: OutboundItem): item is OutboundAttachmentItem {
  return item.kind === 'attachment';
}

export type OutboundWarningCode =
  | 'no-job-id'
  | 'nothing-recorded'
  | 'counts-disagree'
  | 'already-sent'
  | 'amended-record'
  | 'defect-already-with-office'
  | 'indistinguishable-defects'
  | 'not-tested-reason-missing'
  | 'critical-not-verbally-notified'
  | 'critical-severity-disagrees'
  | 'photos-not-sent'
  | 'photos-after-note'
  | 'photo-file-missing'
  | 'money-in-free-text'
  | 'asset-unidentified'
  | 'truncated'
  | 'does-not-fit';

export interface OutboundWarning {
  code: OutboundWarningCode;
  /**
   * 'declined' means something was deliberately not sent and the message says
   * why. 'caution' means it was sent, with something a person should know.
   */
  severity: 'declined' | 'caution';
  message: string;
}

export interface NotTestedReasonCount {
  /** The reason as first written, so the technician recognises their own words. */
  reason: string;
  count: number;
  /** True for the bucket of assets whose reason was never recorded. */
  unrecorded: boolean;
}

export interface ServiceSummary {
  total: number;
  passed: number;
  failed: number;
  notTested: number;
  notTestedReasons: NotTestedReasonCount[];
  defectsRaised: number;
  criticalDefects: number;
  /**
   * Whether every asset on the visit got a result. The word "complete" is not
   * used anywhere else in this module, and this is the only thing that earns it.
   */
  allAssetsTested: boolean;
}

export interface OutboundPlan {
  items: OutboundItem[];
  warnings: OutboundWarning[];
  summary: ServiceSummary;
}

/** What is deliberately never pushed, and why. Held as data so a screen can show it. */
export const WITHHELD_FROM_SIMPRO: { what: string; why: string }[] = [
  {
    what: 'Any money — rates, prices, hours, totals, invoice values',
    why: 'The office system is the record for what a job costs. A figure in a note is a second, '
      + 'unreconciled number that nobody updates when the quote changes.',
  },
  {
    what: 'Job stage, status, dates, description or scheduling',
    why: 'Only appended notes go out. A phone that has been offline for a week would otherwise overwrite a '
      + 'scheduler\'s edit made yesterday, and nobody would know it had happened.',
  },
  {
    what: 'Customer, site and contact details',
    why: 'The office maintains these. The pull already refuses to overwrite what a technician typed on site; '
      + 'the push owes the office the same courtesy in the other direction.',
  },
  {
    what: 'Occupier statements, critical defect notices to the occupier, and Form 72',
    why: 'These are issued to the occupier and copied to the Commissioner. Filing a copy as a job note would '
      + 'read as the notice having been given, when giving it is a separate act with its own record.',
  },
  {
    what: 'Photographs of a defect with no Simpro job, or whose file is no longer on the phone',
    why: 'An attachment has to go onto a job, and a guessed job number files evidence against somebody else\'s '
      + 'work. A photograph whose file has gone cannot be read, so the note states the count and says the file '
      + 'is missing rather than pretending it was sent.',
  },
  {
    what: 'Defects the office already has',
    why: 'A second copy of a defect reads as a second defect and gets a second job raised against it.',
  },
];

/**
 * What does go to the job, and in what form. Held as data beside the withheld
 * list so a screen can show both and a technician can see the whole picture.
 */
export const PUSHED_TO_SIMPRO: { what: string; how: string }[] = [
  {
    what: 'The service record',
    how: 'One appended job note per attendance: the counts, the not-tested reasons, the defects raised and '
      + 'the failed assets, with a reference key so a retry is recognised and never posts twice.',
  },
  {
    what: 'Critical defect notices',
    how: 'One appended job note per critical defect, sent ahead of the service record and marked in the '
      + 'subject line, with the statutory clocks stated in Queensland time.',
  },
  {
    what: 'Photographs of each defect',
    how: `One job attachment per photograph, named "${'<site> — <defect location> — <date>.jpg'}" and numbered `
      + 'where a defect has several, so the office can read what a file is without opening it. Photographs '
      + 'over 4 MB are downscaled before upload (longest edge 2000 px, JPEG quality 0.85). Attachments are '
      + 'never public. Switch off in Settings under "Send photos to Simpro attachments".',
  },
  {
    what: 'A work-completed note',
    how: 'One short appended note when a job is marked complete on the phone: what was done, when and by '
      + 'whom. The job\'s stage and status in Simpro are left for the office to change.',
  },
];

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The marker written into every note, and read back to recognise our own work.
 *
 * It is in the note text rather than only in the queue row because the queue is
 * on one phone and the risk is on the server: someone in the office, or this app
 * on a replacement handset, can read the job's notes and see that this exact
 * service has already been reported.
 */
const MARKER_PREFIX = 'SQ-REF:';
const KEY_PATTERN = /^(SRV|DEF)-[0-9a-f]{16}-[0-9a-f]{16}$/;
const MARKER_PATTERN = /\[SQ-REF:((?:SRV|DEF)-[0-9a-f]{16}-[0-9a-f]{16})\]/g;

/** FNV-1a, 32-bit. Small, dependency-free, and stable across platforms and app versions. */
function fnv1a(input: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canonical form of a value before it is hashed.
 *
 * Whitespace and case are normalised so that a note retyped with a double space
 * is the same service, not a new one. Nothing else is normalised: a changed
 * word is a changed record.
 */
function canonical(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function digest(parts: (string | number | boolean | undefined | null)[]): string {
  // Joined on the unit separator, which cannot be typed into a field, so
  // ["ab", "c"] and ["a", "bc"] cannot hash alike.
  const joined = parts.map(canonical).join('\u001f');
  // Two independent 32-bit passes rather than one. A single 32-bit hash reaches
  // an even chance of collision at around 77,000 records, which a book of sites
  // gets to inside a few years of monthly services; 64 bits does not.
  return hex8(fnv1a(joined, 0x811c9dc5)) + hex8(fnv1a(`${joined.length}\u001f${joined}`, 0x01000193));
}

/**
 * The key an outbound item carries, in two halves.
 *
 * The first half identifies the thing being reported — this site, this routine,
 * this attendance — and never changes. The second half is the content, so a
 * retry of the same record produces the same key and cannot post twice, while a
 * record that has genuinely changed produces a new key and the office sees the
 * amendment rather than a silent no-op.
 *
 * The local row id is deliberately absent from both halves. It changes when the
 * app is reinstalled or the run is re-entered, and keying on it would let the
 * same service post twice.
 */
export function outboundKey(
  prefix: 'SRV' | 'DEF',
  identity: (string | number | undefined)[],
  content: (string | number | boolean | undefined)[],
): string {
  // Both halves carry the whole digest. Keeping only the first eight hex digits
  // would throw the second pass away and leave 32 bits a side, which is the
  // width the note above says is not enough.
  return `${prefix}-${digest(identity)}-${digest(content)}`;
}

/**
 * The identity half, with the kind that half belongs to.
 *
 * Two keys sharing it describe the same attendance or the same defect. The
 * SRV/DEF prefix is part of it on purpose: a defect notice and a service record
 * are different things even when their identity digests happen to agree, and a
 * bare hex half compared across the two would eventually label a first service
 * record as an amendment of a defect notice nobody had amended.
 */
export function keyIdentity(key: string): string | undefined {
  if (!KEY_PATTERN.test(key)) return undefined;
  const [prefix, identity] = key.split('-');
  return `${prefix}-${identity}`;
}

/** Every Safe QLD key mentioned in a block of note text. Empty when there are none. */
export function keysInNoteText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MARKER_PATTERN)) {
    const key = m[1];
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function marker(key: string): string {
  return `[${MARKER_PREFIX}${key}]`;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * How long an attachment name may run, all in.
 *
 * Simpro does not publish a limit. Windows stops at 255 and a site name plus a
 * plant-room description can get most of the way there, so each part is capped
 * on its own and the whole is capped again — a name cut at the end loses the
 * date, which is the part the office sorts by.
 */
export const ATTACHMENT_NAME_MAX = 150;
const ATTACHMENT_PART_MAX = 60;

/** The dash the name is built on: an em dash with spaces, which no file system objects to. */
const NAME_SEPARATOR = ' — ';

/**
 * One part of a file name, made safe.
 *
 * The characters no file system accepts are replaced rather than dropped, so
 * "Level 3/4 riser" reads "Level 3-4 riser" and not "Level 34 riser", which is
 * a different place.
 */
function safeNamePart(text: string | undefined, fallback: string): string {
  const cleaned = (text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .trim();
  const part = cleaned || fallback;
  return part.length > ATTACHMENT_PART_MAX ? part.slice(0, ATTACHMENT_PART_MAX).trimEnd() : part;
}

/**
 * The date as it goes into a file name: dd-mm-yyyy on the Queensland calendar.
 *
 * Dashes rather than the slashes Australians write, because a slash is a path
 * separator on every operating system the office runs. Day first so the name
 * reads the way the office reads a date; the year is there so it still sorts
 * inside a folder that spans one.
 */
function fileDay(iso: string | undefined): string {
  const day = qldIsoDay(iso);
  if (!day) return 'date-not-recorded';
  const [y, m, d] = day.split('-');
  return `${d}-${m}-${y}`;
}

/**
 * The name a defect photograph gets in Simpro.
 *
 * "<site> — <defect location> — <date>.jpg", so somebody in the office can tell
 * from the file list which building and which fault it shows, and when. The
 * second and later photographs of one defect get " (2)", " (3)" before the
 * extension; a name reused within a job would either be refused by the server
 * or, worse, quietly kept as two files nobody can tell apart.
 */
export function attachmentFilename(input: {
  siteName: string;
  location: string;
  /** The day the defect was raised, as an ISO instant or day. */
  raisedAt: string | undefined;
  /** The stored path, for its extension. Defaults to jpg where it does not say. */
  path?: string;
  /** 1-based position among this defect's photographs. */
  sequence?: number;
}): string {
  const base = [
    safeNamePart(input.siteName, 'Site not recorded'),
    safeNamePart(input.location, 'Location not recorded'),
    fileDay(input.raisedAt),
  ].join(NAME_SEPARATOR);
  const suffix = input.sequence && input.sequence > 1 ? ` (${input.sequence})` : '';
  const ext = `.${extensionFor(input.path ?? '')}`;
  const room = ATTACHMENT_NAME_MAX - suffix.length - ext.length;
  const stem = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${stem}${suffix}${ext}`;
}

/** The MIME type the upload declares, read off the stored extension. */
export function mimeTypeForPhoto(path: string): string {
  switch (extensionFor(path)) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic':
    case 'heif': return 'image/heic';
    default: return 'image/jpeg';
  }
}

/**
 * The queue's content key for an attachment: the job, the name and the size.
 *
 * Not the local path — it differs between phones and moves when the app is
 * reinstalled — and not the bytes, which would mean reading a file to decide
 * whether to queue it. The same photograph of the same defect on the same job
 * produces the same key on every handset, which is what stops a second tap
 * uploading it twice; a photograph that was retaken has a new size and goes
 * up as the new file it is.
 */
export function attachmentContentKey(input: { jobId: string; filename: string; sizeBytes: number | undefined }): string {
  return queueKey('attachment', { jobId: input.jobId, filename: input.filename, sizeBytes: input.sizeBytes ?? null });
}

export interface DefectPhotoPlan {
  items: OutboundAttachmentItem[];
  /** Photographs recorded on the defect whose file could not be found. */
  missing: number;
}

/**
 * The attachments for one defect's photographs, in the order they were taken.
 *
 * Numbering runs across the whole send rather than per defect, through the
 * `used` map: two defects at "Plant room" raised the same day would otherwise
 * both produce "<site> — Plant room — <date>.jpg" and the second would either
 * be refused or file over the first. Pure, so a screen can show the names
 * before anything is queued.
 */
export function attachmentsForDefect(
  defect: Pick<OutboundDefect, 'id' | 'location' | 'raisedAt' | 'photos'>,
  context: { jobId: string; siteName: string; used?: Map<string, number> },
): DefectPhotoPlan {
  const used = context.used ?? new Map<string, number>();
  const items: OutboundAttachmentItem[] = [];
  let missing = 0;
  for (const photo of defect.photos ?? []) {
    if (photo.sizeBytes === undefined || !(photo.sizeBytes > 0)) {
      missing++;
      continue;
    }
    // The stem is what collides, so the sequence is counted on it — with the
    // extension left off, since a .png and a .jpg of the same stem are two
    // names already.
    const stem = attachmentFilename({
      siteName: context.siteName, location: defect.location, raisedAt: defect.raisedAt,
    }).replace(/\.[a-z0-9]+$/i, '');
    const sequence = (used.get(stem) ?? 0) + 1;
    used.set(stem, sequence);
    const filename = attachmentFilename({
      siteName: context.siteName, location: defect.location, raisedAt: defect.raisedAt, path: photo.path, sequence,
    });
    const key = attachmentContentKey({ jobId: context.jobId, filename, sizeBytes: photo.sizeBytes });
    items.push({
      kind: 'attachment',
      key,
      urgency: 'routine',
      description: `Photo - ${defect.location.trim() || 'location not recorded'} - ${context.siteName} `
        + `(job ${context.jobId}) - ${filename}`,
      payload: {
        jobId: context.jobId,
        localUri: photo.path,
        filename,
        mimeType: mimeTypeForPhoto(photo.path),
        subject: `Photo of defect at ${defect.location.trim() || 'an unrecorded location'}, ${context.siteName}`,
        sizeBytes: photo.sizeBytes,
        key,
      },
    });
  }
  return { items, missing };
}

/**
 * What a note says about a defect's photographs.
 *
 * Three buckets, never two. A photograph that was queued on an earlier send
 * is on the job, or about to be, and an amended note that called it "held
 * with the report" sent the office to the wrong place — the evidence was in
 * the attachment list the whole time. So the note counts what is going now,
 * what is already queued for or on the job, and only the remainder — a
 * missing file, the switch off, files not supplied — as held with the
 * report. "Queued for, or on" rather than "on", because the queue holds a
 * photograph until there is signal and the note must not claim more.
 */
function photoLine(
  defect: OutboundDefect,
  outcome: PhotoOutcome,
  filename: string | undefined,
): string | undefined {
  const total = Math.max(defect.photoCount ?? 0, defect.photos?.length ?? 0);
  if (!total) return undefined;
  const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
  const named = filename ? ` as "${filename}"` : '';
  const going = Math.min(outcome.going, total);
  const onJob = Math.min(outcome.alreadyOnJob, total - going);
  const held = total - going - onJob;
  const isAre = (n: number) => (n === 1 ? 'is' : 'are');

  if (going === total) return `${plural(total)} being sent to this job's attachments${named}.`;
  if (onJob === total) return `${plural(total)} already queued for, or on, this job's attachments${named}.`;
  if (going === 0 && onJob === 0) return `${plural(total)} held with the report; photos are not attached to this note.`;

  const parts: string[] = [];
  if (going > 0) parts.push(`${going} of ${plural(total)} being sent to this job's attachments${named}`);
  if (onJob > 0) {
    parts.push(going > 0
      ? `${onJob} ${isAre(onJob)} already queued for, or on, this job's attachments`
      : `${onJob} of ${plural(total)} already queued for, or on, this job's attachments${named}`);
  }
  if (held > 0) parts.push(`the other ${held} ${isAre(held)} held with the report`);
  return `${parts.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

export interface Truncated {
  text: string;
  truncated: boolean;
  /** Characters of the original that did not survive. */
  omittedChars: number;
}

/**
 * Cuts text to a limit at the end of a sentence or a line, never mid-thought.
 *
 * A note cut mid-sentence reads as a system fault and gets ignored; worse, it
 * can invert its own meaning — "the sprinkler control valve was found closed and
 * was" is a different statement from the one that was written. So the cut lands
 * on a full stop, a question or exclamation mark, or a line ending, and the
 * caller is told how much went.
 *
 * Where no boundary exists at all — one unbroken run of characters longer than
 * the limit — the text is cut at a word boundary, or hard if there is not even
 * one. That case is still reported; it is never silent.
 */
export function truncateOnSentence(text: string, limit: number): Truncated {
  if (limit <= 0) return { text: '', truncated: text.length > 0, omittedChars: text.length };
  if (text.length <= limit) return { text, truncated: false, omittedChars: 0 };

  const window = text.slice(0, limit);
  // Sentence ends inside the window, taking the last one that leaves something
  // worth reading behind.
  let cut = -1;
  const sentence = /[.!?](?=\s|$)/g;
  for (const m of window.matchAll(sentence)) {
    if (m.index !== undefined) cut = m.index + 1;
  }
  if (cut < MIN_USEFUL_SECTION) {
    const line = window.lastIndexOf('\n');
    if (line > cut) cut = line;
  }
  if (cut <= 0) {
    const space = window.lastIndexOf(' ');
    cut = space > 0 ? space : limit;
  }

  const kept = text.slice(0, cut).replace(/\s+$/, '');
  return { text: kept, truncated: true, omittedChars: text.length - kept.length };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * What actually happened on the visit.
 *
 * Counted from the result rows rather than taken from a stored total, because a
 * stored total is the thing that goes stale when a retest is entered late. The
 * not-tested reasons are grouped case-insensitively but reported in the words
 * they were first written in, and assets with no reason at all get their own
 * bucket — that is a coverage gap nobody can defend to an inspector, and hiding
 * it inside the number would be the point of this module going missing.
 */
export function summariseRun(results: OutboundResult[], defects: OutboundDefect[]): ServiceSummary {
  const passed = results.filter((r) => r.outcome === 'pass').length;
  const failed = results.filter((r) => r.outcome === 'fail').length;
  const notTestedRows = results.filter((r) => r.outcome === 'not-tested');

  const buckets = new Map<string, NotTestedReasonCount>();
  for (const row of notTestedRows) {
    const written = row.notTestedReason?.trim().replace(/\s+/g, ' ') ?? '';
    // A sentinel no written reason can collide with, since every real one is
    // trimmed non-empty text.
    const bucketKey = written ? written.toLowerCase() : '\u0000unrecorded';
    const existing = buckets.get(bucketKey);
    if (existing) existing.count += 1;
    else {
      buckets.set(bucketKey, {
        reason: written || 'reason not recorded',
        count: 1,
        unrecorded: !written,
      });
    }
  }

  const notTestedReasons = [...buckets.values()].sort((a, b) => {
    // The unrecorded bucket sorts last however big it is: it is not a reason,
    // and listing it first would read as one.
    if (a.unrecorded !== b.unrecorded) return a.unrecorded ? 1 : -1;
    return b.count - a.count || a.reason.localeCompare(b.reason);
  });

  return {
    total: results.length,
    passed,
    failed,
    notTested: notTestedRows.length,
    notTestedReasons,
    defectsRaised: defects.length,
    criticalDefects: defects.filter(isCriticalDefect).length,
    allAssetsTested: results.length > 0 && notTestedRows.length === 0,
  };
}

/**
 * Whether a defect must be treated as critical.
 *
 * Three tests, any of which is enough: the technician recorded it critical, AS
 * 1851 classifies it critical, or both Queensland limbs are met. They are not
 * the same test and they disagree in practice, so the union is taken. Over-
 * notifying costs a phone call; under-notifying is a statutory failure and a
 * building full of people.
 */
export function isCriticalDefect(defect: OutboundDefect): boolean {
  return defect.severity === 'critical'
    || defect.as1851Class === 'critical'
    || isQldCriticalDefect(defect.qldLimbInoperable === true, defect.qldLimbAdverseImpact === true);
}

/** The grounds on which this defect is being treated as critical, for the note. */
function criticalBasis(defect: OutboundDefect): string[] {
  const basis: string[] = [];
  if (defect.severity === 'critical') basis.push('recorded critical on site');
  if (defect.as1851Class === 'critical') basis.push(`AS 1851 class: ${AS1851_CLASS_LABEL.critical}`);
  if (isQldCriticalDefect(defect.qldLimbInoperable === true, defect.qldLimbAdverseImpact === true)) {
    basis.push('both Queensland limbs met (inoperable, and significant adverse impact)');
  }
  return basis;
}

// ---------------------------------------------------------------------------
// Composing the note
// ---------------------------------------------------------------------------

/**
 * A dollar figure typed into free text, which belongs on a quote and not here.
 *
 * Written without a lookbehind on purpose: Hermes has not always supported them
 * and a regex that throws at runtime would take the whole push down with it.
 */
const MONEY_PATTERN = /(\$\s?\d|\b\d+(\.\d{2})?\s?(dollars|aud)\b)/i;

/**
 * The order assets are listed in, which must not depend on the order the rows
 * happened to arrive in.
 *
 * Two phones recording the same visit produce the same note, so a duplicate is
 * recognisable by eye as well as by key. Tag numbers sort numerically where they
 * are numeric — #2 before #10, which is what a walk order looks like.
 */
function byAssetOrder(a: OutboundResult, b: OutboundResult): number {
  const num = (r: OutboundResult): number => {
    const m = r.assetNumber?.match(/\d+/);
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
  };
  return num(a) - num(b)
    || (a.assetNumber ?? '').localeCompare(b.assetNumber ?? '')
    || (a.name ?? '').localeCompare(b.name ?? '')
    || (a.location ?? '').localeCompare(b.location ?? '')
    || a.assetId.localeCompare(b.assetId);
}

function assetLabel(row: OutboundResult): string {
  const parts = [
    row.assetNumber ? `#${row.assetNumber}` : undefined,
    row.name?.trim() || undefined,
    row.location?.trim() || undefined,
  ].filter((p): p is string => !!p);
  // Never the internal id: it means nothing in the office and reads as a fault.
  return parts.length ? parts.join(' - ') : 'asset not identified';
}

function countLine(summary: ServiceSummary): string {
  const tested = summary.passed + summary.failed;
  return `Assets on this visit: ${summary.total}. Tested ${tested}: ${summary.passed} passed, `
    + `${summary.failed} failed. Not tested: ${summary.notTested}.`;
}

/**
 * How many distinct reasons are named before the rest are counted instead.
 *
 * A note that lists ninety-one differently worded reasons is unreadable, and it
 * crowds out the count it exists to explain. The common ones are named; the tail
 * is counted so nothing goes missing without being mentioned.
 */
const MAX_NAMED_REASONS = 6;

function reasonsLine(summary: ServiceSummary): string | undefined {
  if (!summary.notTestedReasons.length) return undefined;
  const named = summary.notTestedReasons.slice(0, MAX_NAMED_REASONS);
  const rest = summary.notTestedReasons.slice(MAX_NAMED_REASONS);
  const parts = named.map((r) => `${r.reason} (${r.count})`);
  const tail = rest.length
    ? ` and ${rest.reduce((n, r) => n + r.count, 0)} more across ${rest.length} other reasons, `
      + 'each named in the full record'
    : '';
  return `Not tested because: ${parts.join('; ')}${tail}.`;
}

/** How many of a defect's photographs are going to the job now, how many are already there, and under what name. */
interface PhotoOutcome {
  going: number;
  /** Queued on an earlier send, or accepted: on the job, or about to be, and not sent again. */
  alreadyOnJob: number;
  filename?: string;
}

const NO_PHOTOS: PhotoOutcome = { going: 0, alreadyOnJob: 0 };

function criticalBlock(defect: OutboundDefect, run: CompletedRoutineRun, photos: PhotoOutcome): string[] {
  const basis = criticalBasis(defect);
  /*
   * Both clocks run from the maintenance, not from the moment the defect was
   * typed up. The written notice is due within 24 hours after the maintenance is
   * carried out and the rectification within one month of it, so a defect
   * written up at the start of a two-day attendance does not get a deadline of
   * its own that nothing in the regulation supports.
   *
   * And the 24-hour one is only stated where the maintenance instant carries a
   * time. Twenty-four hours after a date with no time in it is a moment nobody
   * recorded, and "due by 04/07/2026 10:00" is read as a deadline somebody set.
   */
  const maintenanceHasTime = qldMoment(run.completedAt) !== undefined;
  const noticeDue = maintenanceHasTime
    ? qldMoment(criticalNoticeDueAt(run.completedAt) ?? undefined)
    : undefined;
  const rectifyDue = qldDay(rectificationDueAt(qldIsoDay(run.completedAt) ?? run.completedAt) ?? undefined);
  const lines = [
    `*** CRITICAL DEFECT *** ${defect.location.trim() || 'location not recorded'}`,
    defect.description.trim(),
    `Raised: ${qldDay(defect.raisedAt) ?? 'date not readable'}.`,
    `Classified critical because: ${basis.length ? basis.join('; ') : 'severity recorded as critical'}.`,
  ];
  lines.push(
    defect.verbalNotifiedAt
      ? `Verbal notification: ${qldMoment(defect.verbalNotifiedAt) ?? qldDay(defect.verbalNotifiedAt) ?? 'recorded'}`
        + `${defect.verbalNotifiedTo ? ` to ${defect.verbalNotifiedTo.trim()}` : ''}.`
      : 'Verbal notification: NOT RECORDED in the app. '
        + `${AS1851_CLASS_OBLIGATION.critical.notify}`,
  );
  // The written notice under the Queensland regulation goes to the occupier;
  // AS 1851's verbal notification goes to the responsible entity. They are two
  // obligations to two audiences and the note names each of them correctly.
  lines.push(noticeDue
    ? `Written critical defect notice to the occupier due by ${noticeDue} (24 hours from the maintenance).`
    : 'Written critical defect notice to the occupier is due within 24 hours of the maintenance. No time was '
      + 'recorded for the maintenance, so the hour it falls due is not stated here rather than invented.');
  if (rectifyDue) lines.push(`Rectification due by ${rectifyDue} (one month from the maintenance).`);
  if (defect.interimMeasures?.trim()) lines.push(`Interim measures: ${defect.interimMeasures.trim()}.`);
  if (defect.status !== 'open') lines.push(`Status recorded on site: ${defect.status}.`);
  const photoNote = photoLine(defect, photos, photos.filename);
  if (photoNote) lines.push(photoNote);
  return lines;
}

interface NoteSection {
  /** Named so a truncation can say what went. */
  id: string;
  text: string;
  /**
   * An essential section is never dropped to make room for one below it. The
   * counts and the critical defects are the note; the per-asset detail is
   * supporting material that the full record holds anyway.
   */
  essential: boolean;
}

function composeSections(
  run: CompletedRoutineRun,
  summary: ServiceSummary,
  results: OutboundResult[],
  defects: OutboundDefect[],
  amended: boolean,
  /** Defects raised on this visit that the office already holds, so are not repeated here. */
  alreadyReported: number,
  /** By defect id: how many photographs are going to the job. Absent means none. */
  photos: Map<string, PhotoOutcome> = new Map(),
): NoteSection[] {
  const sections: NoteSection[] = [];
  const criticals = defects.filter(isCriticalDefect);
  const others = defects.filter((d) => !isCriticalDefect(d));
  const photosOf = (d: OutboundDefect): PhotoOutcome => photos.get(d.id) ?? NO_PHOTOS;

  const head = [
    `ROUTINE SERVICE - ${run.routineLabel} (${run.frequency}) - ${run.system}`,
    `Site: ${run.siteName}`,
    `Completed: ${qldMoment(run.completedAt) ?? qldDay(run.completedAt) ?? 'date not readable'}`,
    run.technician ? `Technician: ${run.technician}` : 'Technician: not recorded',
  ];
  if (amended) {
    head.push('AMENDED RECORD: this attendance was reported earlier and the record has since changed. '
      + 'This note replaces the earlier one.');
  }
  sections.push({ id: 'header', text: head.join('\n'), essential: true });

  // The counts come before anything else a reader might stop at. This is the
  // number that decides whether the job can be invoiced.
  const counts = [countLine(summary)];
  if (summary.notTested > 0) {
    counts.push(`${summary.notTested} of ${summary.total} assets were NOT tested on this visit. `
      + 'The routine is not complete for those assets.');
  } else if (summary.total > 0) {
    // Not "every asset was tested". This module sees the assets that got a
    // result, not the routine's register, so an asset nobody reached at all is
    // invisible to it and the sentence says so rather than reading as a
    // completed routine.
    counts.push('Every asset with a result recorded on this visit was tested. '
      + 'An asset nobody reached carries no result and is not counted above.');
  }
  counts.push(`Defects raised: ${summary.defectsRaised}`
    + (summary.criticalDefects ? `, of which ${summary.criticalDefects} CRITICAL.` : '.'));
  if (alreadyReported > 0) {
    // Left out of the count above because they are not this note's to report a
    // second time, and said out loud because a service note that quietly counts
    // three defects as one reads as a quieter visit than it was.
    counts.push(`A further ${alreadyReported} defect${alreadyReported === 1 ? ' was' : 's were'} raised on this `
      + 'visit and already reported to the office separately, so are not repeated here.');
  }
  // The reasons line goes last of the counts, however long it runs. Everything
  // above it is a fixed-length statement the office acts on; this one is free
  // text and can run to thousands of characters, and when the note has to be cut
  // the cut has to land on the explanation rather than on the numbers.
  const reasons = reasonsLine(summary);
  if (reasons) counts.push(reasons);
  sections.push({ id: 'results', text: counts.join('\n'), essential: true });

  if (criticals.length) {
    const block = [`CRITICAL DEFECTS (${criticals.length}) - statutory clocks have started`];
    for (const defect of criticals) block.push(criticalBlock(defect, run, photosOf(defect)).join('\n'));
    sections.push({ id: 'critical defects', text: block.join('\n\n'), essential: true });
  }

  if (others.length) {
    const block = [`OTHER DEFECTS RAISED (${others.length})`];
    for (const defect of others) {
      const label = AS1851_CLASS_LABEL[defect.as1851Class ?? 'non-critical'];
      // The count and where the photographs are, but not the file name: a
      // list line is read at a glance and the name is in the attachment list.
      const photoNote = photoLine(defect, photosOf(defect), undefined);
      block.push(`- ${defect.location.trim() || 'location not recorded'}: ${defect.description.trim()} `
        + `[${label}, raised ${qldDay(defect.raisedAt) ?? 'date not readable'}, ${defect.status}]`
        + (photoNote ? ` - ${photoNote}` : ''));
    }
    sections.push({ id: 'other defects', text: block.join('\n'), essential: false });
  }

  const failed = results.filter((r) => r.outcome === 'fail').sort(byAssetOrder);
  if (failed.length) {
    const block = [`FAILED (${failed.length})`];
    for (const row of failed) {
      block.push(`- ${assetLabel(row)}${row.notes?.trim() ? `: ${row.notes.trim()}` : ''}`);
    }
    sections.push({ id: 'failed assets', text: block.join('\n'), essential: false });
  }

  const notTested = results.filter((r) => r.outcome === 'not-tested').sort(byAssetOrder);
  if (notTested.length) {
    const block = [`NOT TESTED (${notTested.length})`];
    for (const row of notTested) {
      block.push(`- ${assetLabel(row)}: ${row.notTestedReason?.trim() || 'reason not recorded'}`);
    }
    sections.push({ id: 'not tested assets', text: block.join('\n'), essential: false });
  }

  if (run.notes?.trim()) {
    sections.push({ id: 'technician notes', text: `TECHNICIAN NOTES\n${run.notes.trim()}`, essential: false });
  }

  // Passed assets are counted, never listed. Forty lines of "passed" push the
  // not-tested list past the size limit, which is the one thing that must not
  // be lost.
  return sections;
}

interface AssembledNote {
  text: string;
  truncated: boolean;
  omittedChars: number;
  omittedSections: string[];
}

/**
 * Fits the sections into the budget, keeping the ones that matter.
 *
 * Filling top to bottom until the room runs out is the obvious approach and it
 * is wrong here: the counts are near the top and the not-tested reasons can run
 * to thousands of characters, so a long list of reasons would push the critical
 * defect block out of the note that carries it. Instead the essential sections —
 * the header, the counts, the critical defects — are fitted first and share the
 * budget between them, and the per-asset detail gets whatever is left. Detail
 * lives in the full record either way; the counts and a critical defect do not
 * exist anywhere the office is looking.
 *
 * Room for the footer is reserved before anything is fitted, using the longest
 * form it can take. Composing first and trimming afterwards would eat the
 * marker, and a note without its marker cannot be recognised on a retry.
 */
function assemble(sections: NoteSection[], key: string, fullRecordAt: string, limit: number): AssembledNote {
  const markerLine = marker(key);
  const body = sections.map((s) => s.text).join('\n\n');
  const plainFooter = `Full record: ${fullRecordAt}.\n${markerLine}`;

  if (`${body}\n\n${plainFooter}`.length <= limit) {
    return { text: `${body}\n\n${plainFooter}`, truncated: false, omittedChars: 0, omittedSections: [] };
  }

  const truncatedFooter = (omittedChars: number, omitted: string[]): string =>
    `[TRUNCATED to fit the note field: ${omittedChars} characters not shown`
    + `${omitted.length ? ` (${omitted.join(', ')})` : ''}. Full record: ${fullRecordAt}.]\n${markerLine}`;

  // The worst case footer: every section named, and a character count as long as
  // the whole composed record.
  const reserve = truncatedFooter(body.length, sections.map((x) => `${x.id} shortened`)).length + 2;
  let remaining = limit - reserve;

  const kept = new Map<string, string>();
  const omitted: string[] = [];
  let omittedChars = 0;

  const take = (section: NoteSection, room: number): void => {
    if (room < MIN_USEFUL_SECTION && section.text.length > room) {
      omitted.push(section.id);
      omittedChars += section.text.length;
      return;
    }
    if (section.text.length <= room) {
      kept.set(section.id, section.text);
      remaining -= section.text.length + 2;
      return;
    }
    const cut = truncateOnSentence(section.text, room);
    if (!cut.text.length) {
      omitted.push(section.id);
      omittedChars += section.text.length;
      return;
    }
    kept.set(section.id, cut.text);
    omitted.push(`${section.id} shortened`);
    omittedChars += cut.omittedChars;
    remaining -= cut.text.length + 2;
  };

  /*
   * Essential sections first, sharing the budget between them.
   *
   * The room is handed out smallest need first, each section taking an equal
   * share of what is still unspent and the ones that need less than their share
   * releasing the rest. Two other ways of doing this were tried and both lose the
   * case this exists for. Taking whole sections first lets the counts — which can
   * run to a page once the not-tested reasons are in them — swallow the budget
   * and push the critical defect block off the end. Handing out a flat equal
   * share cuts a short section that would have fitted and then leaves the room
   * it did not need unused. Smallest first does neither: the header and the
   * critical defects are kept whole and the counts absorb the cut.
   */
  const essential = sections.filter((s) => s.essential);
  // The two characters are the blank line that separates this section from the
  // next, budgeted with the section so nothing overspends by the joins.
  const need = (s: NoteSection): number => s.text.length + 2;
  const allocation = new Map<string, number>();
  let unspent = remaining;
  let unallocated = essential.length;
  for (const section of [...essential].sort((a, b) => need(a) - need(b))) {
    const share = unallocated > 1 ? Math.floor(unspent / unallocated) : unspent;
    const give = Math.min(need(section), share);
    allocation.set(section.id, give);
    unspent -= give;
    unallocated--;
  }
  for (const section of essential) take(section, (allocation.get(section.id) ?? 0) - 2);

  // Then the detail, in order, until the room runs out.
  let detailAllowed = true;
  for (const section of sections) {
    if (section.essential) continue;
    if (!detailAllowed) {
      omitted.push(section.id);
      omittedChars += section.text.length;
      continue;
    }
    const before = kept.size;
    take(section, remaining);
    if (kept.size === before || kept.get(section.id) !== section.text) detailAllowed = false;
  }

  const text = sections
    .map((s) => kept.get(s.id))
    .filter((t): t is string => t !== undefined)
    .join('\n\n');

  return {
    text: `${text}\n\n${truncatedFooter(omittedChars, omitted)}`,
    truncated: true,
    omittedChars,
    omittedSections: omitted,
  };
}

function subjectFor(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= NOTE_LIMITS.subject.chars) return flat;
  // Cut here rather than letting the client cut, so what is lost is visible.
  return `${flat.slice(0, NOTE_LIMITS.subject.chars - 1).replace(/\s+\S*$/, '')}…`;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Maps a completed run into what should go to the office, and what should not.
 *
 * Returns items in send order: every critical defect notice first, each on its
 * own so one failing to send cannot take the others with it, then the service
 * record. Anything declined comes back as a warning naming the reason, because
 * a technician who is told "3 items queued" when there were four has been told
 * nothing useful.
 */
export function planOutboundWork(
  run: CompletedRoutineRun,
  results: OutboundResult[],
  defects: OutboundDefect[],
  options: PlanOptions = {},
): OutboundPlan {
  const warnings: OutboundWarning[] = [];
  const summary = summariseRun(results, defects.filter((d) => !d.sentToOfficeAt));
  const items: OutboundItem[] = [];
  const alreadySent = new Set(options.alreadySentKeys ?? []);
  const sentIdentities = new Set(
    [...alreadySent].map(keyIdentity).filter((id): id is string => !!id),
  );

  const decline = (code: OutboundWarningCode, message: string) => {
    warnings.push({ code, severity: 'declined', message });
  };
  const caution = (code: OutboundWarningCode, message: string) => {
    warnings.push({ code, severity: 'caution', message });
  };

  // Without a job there is nowhere to send anything, and a guessed job number
  // posts a service record against somebody else's work.
  if (!run.jobId?.trim()) {
    decline('no-job-id',
      `${run.routineLabel} at ${run.siteName} has no Simpro job linked, so nothing can be sent. `
      + 'Link the run to a job first; the record stays on the phone until then.');
    return { items, warnings, summary };
  }
  const jobId = run.jobId.trim();

  if (!results.length) {
    decline('nothing-recorded',
      `${run.routineLabel} at ${run.siteName} has no asset results recorded, so there is nothing to report. `
      + 'A note claiming a service was performed with no results behind it is a claim nobody can support.');
    return { items, warnings, summary };
  }

  // Two sources for the same counts is one too many when they disagree, and
  // this module cannot know which is right.
  const declared = options.declaredCounts;
  if (declared && (declared.passed !== summary.passed
    || declared.failed !== summary.failed
    || declared.notTested !== summary.notTested)) {
    decline('counts-disagree',
      `The run record says ${declared.passed} passed / ${declared.failed} failed / ${declared.notTested} not `
      + `tested, but the result rows say ${summary.passed} / ${summary.failed} / ${summary.notTested}. `
      + 'Nothing is sent until they agree, because the office would act on whichever number went out.');
    return { items, warnings, summary };
  }

  const sendableDefects: OutboundDefect[] = [];
  for (const defect of defects) {
    if (defect.sentToOfficeAt) {
      decline('defect-already-with-office',
        `Defect at ${defect.location || 'an unrecorded location'} was sent to the office on `
        + `${qldDay(defect.sentToOfficeAt) ?? defect.sentToOfficeAt}. It is not sent again: a second copy `
        + 'reads as a second defect and gets a second job raised against it.');
      continue;
    }
    sendableDefects.push(defect);
  }

  const criticals = sendableDefects.filter(isCriticalDefect);
  for (const defect of criticals) {
    if (defect.severity !== 'critical') {
      caution('critical-severity-disagrees',
        `Defect at ${defect.location || 'an unrecorded location'} is recorded ${defect.severity} but meets a `
        + 'critical test, so it is being reported as critical. Confirm the severity on the record.');
    }
    if (!defect.verbalNotifiedAt) {
      caution('critical-not-verbally-notified',
        `No verbal notification is recorded for the critical defect at ${defect.location || 'an unrecorded location'}. `
        + `${AS1851_CLASS_OBLIGATION.critical.notify} The note says so rather than leaving it blank.`);
    }
  }

  /*
   * The photographs, planned before any note is composed, because the notes
   * say what became of them. Each goes as its own attachment item; what could
   * not go is said here, and the note repeats it in fewer words. A defect the
   * office already holds keeps its photographs too — they would arrive as
   * evidence of a defect nobody can find on the job.
   */
  const photoOutcomes = new Map<string, PhotoOutcome>();
  const attachments: OutboundAttachmentItem[] = [];
  const sendPhotos = options.sendPhotos !== false;
  const usedNames = new Map<string, number>();
  /*
   * Named in the order the defects were raised, not the order they were
   * handed in. The sequence number is part of the file name and the name is
   * part of the key, so the numbering has to come out the same on every
   * send: the list arrives critical-first and newest-first, and a defect
   * raised later at the same place on the same day would otherwise sort
   * ahead of one already sent, take its name, and renumber it — the earlier
   * photographs then go up a second time under new names beside a second
   * file with the old one. A defect's raised instant never changes, so a
   * later one can never overtake an earlier one and a number once issued
   * stays put. The notes keep the critical-first order; only the naming
   * pass runs on the sorted copy.
   */
  const byRaised = [...sendableDefects].sort((a, b) =>
    a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id));
  for (const defect of byRaised) {
    const where = defect.location || 'an unrecorded location';
    const recorded = Math.max(defect.photoCount ?? 0, defect.photos?.length ?? 0);
    if (!recorded) continue;
    const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
    if (!defect.photos) {
      // The caller counted them and did not hand them over. Nothing to queue,
      // and the note must not read as though something was attached.
      caution('photos-not-sent',
        `${plural(recorded)} of the defect at ${where} stay with the report; the files were not supplied for `
        + 'attaching, so the note states the count only.');
      continue;
    }
    const planned = attachmentsForDefect(defect, { jobId, siteName: run.siteName, used: usedNames });
    // Counted before the switch is consulted: a photograph that went up on an
    // earlier send is on the job whether or not photos are being sent today,
    // and the note must say so rather than read as though it were held back.
    const onJob = planned.items.filter((item) => alreadySent.has(item.key));
    if (!sendPhotos) {
      const held = recorded - onJob.length;
      if (held > 0) {
        caution('photos-not-sent',
          `${plural(held)} of the defect at ${where} stay on this phone and with the report: sending photos to `
          + 'Simpro is switched off in Settings.'
          + (onJob.length ? ` ${plural(onJob.length)} already went to the job on an earlier send.` : ''));
      }
      photoOutcomes.set(defect.id, {
        going: 0, alreadyOnJob: onJob.length, filename: onJob[0]?.payload.filename,
      });
      continue;
    }
    if (planned.missing) {
      decline('photo-file-missing',
        `${plural(planned.missing)} of the defect at ${where} ${planned.missing === 1 ? 'is' : 'are'} recorded but the `
        + `file${planned.missing === 1 ? ' is' : 's are'} no longer on this device, so ${planned.missing === 1 ? 'it' : 'they'} `
        + 'cannot be attached. The note says how many were taken.');
    }
    let going = 0;
    let filename: string | undefined;
    for (const item of planned.items) {
      if (alreadySent.has(item.key)) {
        // The caller's list carries queued uploads as well as accepted ones,
        // because a photograph waiting for signal is as sent as this plan is
        // concerned: queueing it again would be the second copy.
        decline('already-sent',
          `${item.payload.filename} is already queued for, or on, job ${jobId} in Simpro (${item.key}). `
          + 'It is not sent again.');
        filename ??= item.payload.filename;
        continue;
      }
      attachments.push(item);
      going++;
      filename ??= item.payload.filename;
    }
    photoOutcomes.set(defect.id, { going, alreadyOnJob: onJob.length, filename });
  }

  const fullRecordAt = options.fullRecordAt
    ?? `${run.reportRef ? `routine service report ${run.reportRef}` : 'the routine service report'}`
      + ` for ${run.siteName}, ${qldDay(run.completedAt) ?? 'this attendance'}, in the Safe QLD field app`;
  const bodyLimit = options.bodyLimit ?? NOTE_LIMITS.body.chars;

  // -------------------------------------------------------------- critical first
  const keysUsed = new Set<string>();
  for (const defect of criticals) {
    const identity = ['critical', run.siteId, defect.location, defect.description, defect.raisedAt];
    const content = [
      defect.description, defect.severity, defect.as1851Class, defect.status,
      defect.qldLimbInoperable, defect.qldLimbAdverseImpact,
      defect.verbalNotifiedAt, defect.verbalNotifiedTo, defect.interimMeasures, defect.assetNumber,
    ];
    const key = outboundKey('DEF', identity, content);
    if (alreadySent.has(key)) {
      decline('already-sent',
        `The critical defect notice for ${defect.location || 'an unrecorded location'} has already been accepted `
        + `by the office (${key}). Sending it again would raise it twice.`);
      continue;
    }
    if (keysUsed.has(key)) {
      /*
       * Two critical defects recorded with the same location, description and
       * instant produce one key and one identical note. The send layer would
       * post the first and skip the second as a duplicate — and report it as
       * accepted, which is a critical defect lost with a tick beside it. It is
       * said out loud instead, because only the technician can tell whether
       * there really are two.
       */
      decline('indistinguishable-defects',
        `Two critical defects at ${defect.location || 'an unrecorded location'} are recorded with the same `
        + 'description and the same time raised, so nothing that goes out could tell them apart. One notice is '
        + 'sent. Edit the second so it reads differently, or phone the office about it.');
      continue;
    }
    keysUsed.add(key);
    const amended = sentIdentities.has(keyIdentity(key) ?? '');
    if (amended) {
      caution('amended-record',
        `The critical defect at ${defect.location || 'an unrecorded location'} was already reported and its record `
        + 'has since changed. It goes out again marked as an amendment.');
    }

    const body = [
      ...criticalBlock(defect, run, photoOutcomes.get(defect.id) ?? NO_PHOTOS),
      '',
      `Raised during ${run.routineLabel} at ${run.siteName}, `
        + `${qldDay(run.completedAt) ?? 'date not readable'}.`,
      amended ? 'AMENDED: this replaces the critical defect notice sent earlier for this defect.' : undefined,
    ].filter((l): l is string => l !== undefined).join('\n');

    const note = assemble([{ id: 'critical defect', text: body, essential: true }], key, fullRecordAt, bodyLimit);
    if (note.omittedSections.includes('critical defect')) {
      // The one thing that must never be dropped. Reported loudly rather than
      // sent as an empty shell.
      decline('does-not-fit',
        `The critical defect notice for ${defect.location || 'an unrecorded location'} does not fit in a Simpro `
        + 'note and was not sent. Phone the office: this defect starts a 24-hour written notice clock.');
      continue;
    }
    if (note.truncated) {
      caution('truncated',
        `The critical defect notice for ${defect.location || 'an unrecorded location'} was shortened to fit; `
        + `${note.omittedChars} characters are only in the full record.`);
    }

    items.push({
      kind: 'job-note',
      key,
      urgency: 'critical',
      description: `Critical defect notice - ${defect.location || 'location not recorded'} - `
        + `${run.siteName} (job ${jobId})`,
      payload: {
        jobId,
        subject: subjectFor(`CRITICAL DEFECT - ${run.siteName} - ${defect.location || 'location not recorded'}`),
        note: note.text,
        key,
        truncated: note.truncated,
        omittedChars: note.omittedChars,
        omittedSections: note.omittedSections,
        fullRecordAt,
      },
    });
  }

  // ------------------------------------------------------------- service record
  const serviceIdentity = ['service', run.siteId, run.routineId, run.completedAt];
  const serviceContent = [
    run.routineLabel, run.frequency, run.system, run.technician, run.notes,
    summary.passed, summary.failed, summary.notTested,
    ...summary.notTestedReasons.map((r) => `${r.reason}:${r.count}`),
    // Each field is canonicalised before it is composed, so a reason retyped with
    // a trailing space is the same service and not a new one. Sorted, because the
    // order rows came back in is not part of what was found.
    ...results
      .map((r) => [
        canonical(r.assetNumber ?? r.assetId), r.outcome,
        canonical(r.notTestedReason), canonical(r.notes),
      ].join('|'))
      .sort(),
    ...sendableDefects
      .map((d) => [
        canonical(d.location), canonical(d.description), d.severity, d.status,
      ].join('|'))
      .sort(),
  ];
  const serviceKey = outboundKey('SRV', serviceIdentity, serviceContent);

  /*
   * A service record the office already holds is not composed again, but
   * the photographs are still planned and still go. They are queued rather
   * than posted, and the queue lets a failed one go on purpose so that
   * pressing send again is how a person asks for another go; a plan that
   * stopped here the moment the note was accepted would leave a photograph
   * whose upload was abandoned, or one added after the send, or the lot of
   * them if the switch was off that day, on the phone with no route to the
   * job. So the note is declined and the plan carries on to the attachments.
   */
  const serviceAlreadySent = alreadySent.has(serviceKey);
  if (serviceAlreadySent) {
    decline('already-sent',
      `This service record has already been accepted by the office (${serviceKey}). It is not sent again: a `
      + 'duplicated service record double-counts in the office\'s compliance reporting and nobody goes looking '
      + 'for it.' + (attachments.length ? ' Any photographs not yet on the job still go.' : ''));
    if (attachments.length) {
      caution('photos-after-note',
        `${attachments.length} photograph${attachments.length === 1 ? '' : 's'} will arrive on job ${jobId} on `
        + 'their own: the service note was sent earlier and said they were held with the report. The file names '
        + 'carry the site, the location and the date, which is how the office matches them to the defect.');
    }
  }
  const serviceAmended = !serviceAlreadySent && sentIdentities.has(keyIdentity(serviceKey) ?? '');
  if (!serviceAlreadySent) {
    if (serviceAmended) {
      caution('amended-record',
        'A service record for this attendance was already sent and the record has since changed. The new note is '
        + 'marked as an amendment so the office knows which one stands.');
    }

    if (summary.notTestedReasons.some((r) => r.unrecorded)) {
      const bucket = summary.notTestedReasons.find((r) => r.unrecorded);
      caution('not-tested-reason-missing',
        `${bucket?.count ?? 0} asset${(bucket?.count ?? 0) === 1 ? '' : 's'} recorded as not tested with no reason. `
        + 'The note says "reason not recorded", which is what an inspector will read it as.');
    }
    if (results.some((r) => !r.assetNumber && !r.name?.trim() && !r.location?.trim())) {
      caution('asset-unidentified',
        'Some assets have no tag number, name or location, so the note can only say "asset not identified". '
        + 'The office cannot match those rows to their register.');
    }
    // Every free-text field that ends up in the note is scanned, not only the
    // obvious ones. A price is typed into a not-tested reason ("no access, quoted
    // $450 to open the ceiling") at least as often as into a defect description,
    // and a warning that misses those is a rule nobody is actually keeping.
    const freeText = [
      run.notes,
      ...results.map((r) => r.notes),
      ...results.map((r) => r.notTestedReason),
      ...sendableDefects.map((d) => d.description),
      ...sendableDefects.map((d) => d.interimMeasures),
    ].filter((t): t is string => !!t);
    if (freeText.some((t) => MONEY_PATTERN.test(t))) {
      caution('money-in-free-text',
        'A price appears in typed notes. It is sent as written because dropping a technician\'s words silently is '
        + 'worse, but money belongs on a quote in Simpro: a figure in a note is never reconciled.');
    }

    const sections = composeSections(
      run, summary, results, sendableDefects, serviceAmended, defects.length - sendableDefects.length, photoOutcomes,
    );
    const note = assemble(sections, serviceKey, fullRecordAt, bodyLimit);
    if (note.truncated) {
      caution('truncated',
        `The service note was shortened to fit the note field: ${note.omittedChars} characters `
        + `(${note.omittedSections.join(', ')}) are only in the full record. The note says so and points at it.`);
    }

    const headline = summary.notTested > 0
      ? `${summary.passed} passed, ${summary.failed} failed, ${summary.notTested} NOT TESTED`
      : `${summary.passed} passed, ${summary.failed} failed`;

    items.push({
      kind: 'job-note',
      key: serviceKey,
      urgency: 'routine',
      description: `Service record - ${run.routineLabel} at ${run.siteName} - ${headline} (job ${jobId})`,
      payload: {
        jobId,
        subject: subjectFor(
          `${summary.criticalDefects ? 'CRITICAL DEFECT RAISED - ' : ''}`
          + `Routine service ${qldDay(run.completedAt) ?? ''} - ${run.routineLabel} - ${headline}`,
        ),
        note: note.text,
        key: serviceKey,
        truncated: note.truncated,
        omittedChars: note.omittedChars,
        omittedSections: note.omittedSections,
        fullRecordAt,
      },
    });
  }

  // Photographs last. The notes say they are coming, and a note that lands
  // after its evidence is easier to read than evidence that lands before
  // anybody has been told what it shows.
  items.push(...attachments);

  return { items, warnings, summary };
}

// ---------------------------------------------------------------------------
// Work completed
// ---------------------------------------------------------------------------

/** The job as the phone holds it, at the moment it is marked complete. */
export interface WorkCompletedJob {
  /** The Simpro job number. Without one there is nowhere to put the note. */
  externalId: string;
  title: string;
  siteName: string;
  /** ISO instant the technician marked it complete. */
  completedAt: string;
  /** The technician the office booked on the job, as the job row holds it. */
  technician?: string;
  /**
   * The person who marked it complete on this phone — the signed-in Simpro
   * user where there is one, otherwise the name in Settings. Preferred over
   * the booked technician in the note: the office wants to know who did the
   * work, and the job row lists whoever was rostered, which on a two-person
   * job is only half the answer and on a swapped one is the wrong person.
   */
  completedBy?: string;
  /** The technician's own notes on the job, if any. */
  notes?: string;
  orderNo?: string;
}

/** The routine service done under the job, where one was recorded and linked. */
export interface WorkCompletedRun {
  routineLabel: string;
  frequency: string;
  system: string;
  completedAt: string;
  checksPassed?: number;
  checksFailed?: number;
  checksNotTested?: number;
  defectsRaised?: number;
}

/**
 * The short note that goes up when a job is marked complete on the phone.
 *
 * Deliberately not the service record: that carries the counts and the
 * defects and goes through its own review. This says only that the work is
 * done, when, and by whom, so the office sees it the moment it happens rather
 * than when the paperwork lands — and it says in so many words that the job's
 * stage in Simpro has not been touched, because a scheduler reading "work
 * completed" would otherwise wonder why the job is still in progress.
 *
 * Keyed on the job and the Queensland day it was completed, so marking the
 * same job complete twice in a day — a double tap, a re-open and re-close a
 * minute later — is one note. Completing it again on another day is a
 * different event and gets its own.
 */
export function workCompletedNote(job: WorkCompletedJob, run?: WorkCompletedRun): OutboundJobNote {
  const jobId = job.externalId.trim();
  const day = qldIsoDay(job.completedAt);
  const identity = ['work-completed', jobId, day ?? job.completedAt];
  const completedBy = job.completedBy?.trim() || undefined;
  const technician = job.technician?.trim() || undefined;
  const content = [
    job.title, technician, completedBy, job.notes, job.orderNo,
    run?.routineLabel, run?.frequency, run?.system,
    run?.checksPassed, run?.checksFailed, run?.checksNotTested, run?.defectsRaised,
  ];
  const key = outboundKey('SRV', identity, content);

  // Who did it comes from the person holding the phone where the app knows;
  // the booked technician is named too where it is somebody else, because
  // the office reads the roster and a completion from an unlisted name
  // otherwise looks like a mistake rather than a swap.
  const who = completedBy
    ? `Completed by: ${completedBy}`
      + (technician && canonical(technician) !== canonical(completedBy) ? ` (booked technician: ${technician})` : '')
    : technician ? `Technician: ${technician}` : 'Technician: not recorded';
  const lines = [
    `WORK COMPLETED - ${job.title.trim() || 'job'}`,
    `Site: ${job.siteName}`,
    `Completed: ${qldMoment(job.completedAt) ?? qldDay(job.completedAt) ?? 'date not readable'}`,
    who,
  ];
  if (job.orderNo?.trim()) lines.push(`Order no: ${job.orderNo.trim()}`);
  if (run) {
    const counts = run.checksPassed !== undefined || run.checksFailed !== undefined || run.checksNotTested !== undefined
      ? ` Results: ${run.checksPassed ?? 0} passed, ${run.checksFailed ?? 0} failed, ${run.checksNotTested ?? 0} not tested`
        + `${run.defectsRaised ? `; ${run.defectsRaised} defect${run.defectsRaised === 1 ? '' : 's'} raised` : ''}.`
      : '';
    lines.push(`Routine: ${run.routineLabel} (${run.frequency}) - ${run.system}, `
      + `${qldDay(run.completedAt) ?? 'date not readable'}.${counts} The service record note carries the detail.`);
  }
  const sections: NoteSection[] = [{ id: 'work completed', text: lines.join('\n'), essential: true }];
  if (job.notes?.trim()) {
    sections.push({ id: 'technician notes', text: `TECHNICIAN NOTES\n${job.notes.trim()}`, essential: false });
  }
  sections.push({
    id: 'footer',
    text: 'Marked complete in the Safe QLD field app. The job\'s stage and status in Simpro are not changed by '
      + 'this note; the office closes the job.',
    essential: true,
  });

  const fullRecordAt = `the job record for ${job.siteName} in the Safe QLD field app`;
  const note = assemble(sections, key, fullRecordAt, NOTE_LIMITS.body.chars);
  return {
    jobId,
    subject: subjectFor(`Work completed - ${job.siteName} - ${qldDay(job.completedAt) ?? ''}`),
    note: note.text,
    key,
    truncated: note.truncated,
    omittedChars: note.omittedChars,
    omittedSections: note.omittedSections,
    fullRecordAt,
  };
}
