import { qldDay, qldIsoDay, qldMoment } from './qldTime';
import { addDays, type WhoseSchedule } from './myDay';
import { formatCents } from './rates';
import type {
  SimproAddress, SimproContact, SimproItem, SimproItemKind, SimproPerson,
} from '@/simpro/mirrorResources';

/**
 * How the office's records read on a phone.
 *
 * The mirror hands the screens Simpro's own words — a stage of "Progress",
 * a status colour of "#f5a623", a line with a quantity and a sell price —
 * and every screen that shows a job, a quote, an invoice or a customer has
 * to turn those into something a technician reads at arm's length in glare.
 * Six screens doing that six ways is six places for "Progress" to be spelt
 * differently and six chances to put an unreadable dot on a dark card.
 *
 * So the wording, the colour handling and the line formatting live here,
 * pure, and are tested. Nothing here reads the database or the network, and
 * nothing here knows what a cost is: the shapes it takes carry sell figures
 * only, because the mirror never held anything else.
 */

export type Tone = 'pass' | 'fail' | 'warn' | 'info' | 'muted';

export interface StateWord {
  label: string;
  tone: Tone;
}

// ---------------------------------------------------------------------------
// Stages and statuses
// ---------------------------------------------------------------------------

/**
 * Simpro's job stages, in a technician's words.
 *
 * "Progress" on its own reads as a noun; "In progress" is the state. The
 * rest are already plain. An unknown stage comes back as written rather than
 * as nothing, because a stage the phone has never heard of is still a fact.
 */
const STAGE_LABEL: Record<string, string> = {
  pending: 'Pending',
  progress: 'In progress',
  complete: 'Complete',
  invoiced: 'Invoiced',
  archived: 'Archived',
  approved: 'Approved',
  declined: 'Declined',
};

export function stageLabel(stage: string | undefined): string {
  if (!stage) return '';
  return STAGE_LABEL[stage.trim().toLowerCase()] ?? stage.trim();
}

/** A tone for a stage, so a list scans by colour before anyone reads a word. */
export function stageTone(stage: string | undefined): Tone {
  switch ((stage ?? '').trim().toLowerCase()) {
    case 'pending': return 'info';
    case 'progress': return 'warn';
    case 'complete':
    case 'invoiced':
    case 'approved':
      return 'pass';
    case 'archived':
    case 'declined':
      return 'muted';
    default: return 'muted';
  }
}

/**
 * What to put in the status pill on a job: the office's status name where
 * the office has one, the stage where it has not, and the phone's own state
 * as the last resort. The office's word is the one the scheduler uses on the
 * phone to the technician, so it is the one that goes first.
 */
export function jobStatusWord(job: {
  statusName?: string;
  stage?: string;
  stageRaw?: string;
  status: string;
}): StateWord {
  const stage = job.stageRaw ?? job.stage;
  const label = job.statusName?.trim() || stageLabel(stage) || localStatusLabel(job.status);
  return { label, tone: stage ? stageTone(stage) : localStatusTone(job.status) };
}

const LOCAL_STATUS: Record<string, StateWord> = {
  complete: { label: 'Done', tone: 'pass' },
  'in-progress': { label: 'Running', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'fail' },
  scheduled: { label: 'Scheduled', tone: 'info' },
};

function localStatusLabel(status: string): string {
  return LOCAL_STATUS[status]?.label ?? status;
}

function localStatusTone(status: string): Tone {
  return LOCAL_STATUS[status]?.tone ?? 'muted';
}

/** The office's stages under which a job is still work to be done. */
const OPEN_STAGES = new Set(['pending', 'progress']);

/**
 * Whether a job is still open: neither side has closed it.
 *
 * A job has two hands on it. The office moves the stage — Pending, Progress,
 * then Complete, Invoiced, Archived — and the technician sets a status on
 * the phone, which the sync keeps over the office's. A job is open only
 * while the office still has it under Pending or Progress AND the phone has
 * not marked it complete; a job added by hand has no stage, so the phone's
 * status is all there is. One rule, used by the list's Open and Mine
 * filters and mirrored in SQL by the site and customer counts, so the
 * number on a card and the rows it opens onto never disagree.
 */
export function jobIsOpen(job: { status: string; stage?: string; stageRaw?: string }): boolean {
  if (job.status === 'complete') return false;
  const stage = (job.stageRaw ?? job.stage ?? '').trim().toLowerCase();
  return !stage || OPEN_STAGES.has(stage);
}

/**
 * What the phone did to a job that the office's pill does not say.
 *
 * The pill carries the office's word, because that is the word the
 * scheduler uses on the phone. After "Start job" or "Mark complete" that
 * word does not change, so without this the only sign the button worked
 * was the button going away. Undefined where the pill already reads the
 * phone's own state — a job added by hand has nothing else — and where the
 * office has already closed the job, so a finished job does not wear two
 * pills saying the same thing.
 */
export function localStateWord(job: { status: string; statusName?: string; stage?: string; stageRaw?: string }): StateWord | undefined {
  const stage = (job.stageRaw ?? job.stage ?? '').trim().toLowerCase();
  if (!job.statusName?.trim() && !stage) return undefined;
  switch (job.status) {
    case 'in-progress': return { label: 'Started on this phone', tone: 'warn' };
    case 'blocked': return { label: 'Blocked on this phone', tone: 'fail' };
    case 'complete': return !stage || OPEN_STAGES.has(stage) ? { label: 'Completed on this phone', tone: 'pass' } : undefined;
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// The office's status colour, made safe on our surfaces
// ---------------------------------------------------------------------------

export interface Rgb { r: number; g: number; b: number }

/** `#f5a623`, `#FA3` or `f5a623` to channels. Anything else — a name, a rgb() — is refused. */
export function parseHexColor(color: string | undefined): Rgb | undefined {
  if (!color) return undefined;
  const m = color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const hex = m[1]!;
  const wide = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return {
    r: parseInt(wide.slice(0, 2), 16),
    g: parseInt(wide.slice(2, 4), 16),
    b: parseInt(wide.slice(4, 6), 16),
  };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two colours, 1 for identical and 21 for black on white. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface StatusSwatch {
  /** The office's colour, normalised to `#rrggbb`. */
  fill: string;
  /**
   * Whether the dot needs a hairline around it to be seen at all. The
   * office picks its colours on a white screen; a navy status on our dark
   * card is a dot nobody can find, and a pale yellow on paper the same.
   */
  outlined: boolean;
}

/**
 * How low a dot's contrast against its card may go before it gets a ring.
 * Below about 1.8:1 a colour is a slightly different shade of the card.
 */
const SWATCH_FLOOR = 1.8;

/**
 * The office's status colour as a dot on one of our surfaces.
 *
 * The colour is only ever used as a dot or a border: the text beside it
 * stays in the theme's own colours, because a status name written in the
 * office's yellow on a dark card is 2:1 and unreadable in sun. Undefined
 * where the office sent nothing the phone can read, and the screen then
 * falls back to a stage tone.
 */
export function statusSwatch(color: string | undefined, surface: string): StatusSwatch | undefined {
  const rgb = parseHexColor(color);
  if (!rgb) return undefined;
  const ground = parseHexColor(surface);
  const hex = `#${[rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return { fill: hex, outlined: ground ? contrastRatio(rgb, ground) < SWATCH_FLOOR : false };
}

// ---------------------------------------------------------------------------
// Whose job, and which jobs
// ---------------------------------------------------------------------------

function parsePeople(json: string | undefined): SimproPerson[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as SimproPerson[]).filter((p) => p && typeof p === 'object') : [];
  } catch {
    return [];
  }
}

/**
 * Whether a job is booked to the person holding the phone.
 *
 * By employee id where the phone knows one, because the id is the office's
 * key and survives a rename; by name otherwise, case-insensitively, against
 * both the technicians list and the joined names the row carries — a job
 * added by hand has only the latter.
 */
export function jobIsMine(
  job: { techniciansJson?: string; technician?: string },
  who: WhoseSchedule | null,
): boolean {
  if (!who) return false;
  const people = parsePeople(job.techniciansJson);
  if (who.by === 'id') return people.some((p) => String(p.id) === who.staffId);
  const wanted = who.staffName.trim().toLowerCase();
  if (!wanted) return false;
  if (people.some((p) => (p.name ?? '').trim().toLowerCase() === wanted)) return true;
  return (job.technician ?? '').split(',').some((n) => n.trim().toLowerCase() === wanted);
}

/**
 * A search box's worth of matching: every word typed has to appear in the
 * job number, site, customer, title, address or order number. "#43747" and
 * "43747" are the same search, because the number is written both ways on
 * the phone.
 */
export function jobMatchesQuery(
  job: { externalId?: string; siteName: string; customerName?: string; title: string; address?: string; orderNo?: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean);
  if (!words.length) return true;
  const hay = [job.externalId, job.siteName, job.customerName, job.title, job.address, job.orderNo]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export type JobListFilter = 'open' | 'mine' | 'today' | 'all';

export interface JobFilterContext {
  filter: JobListFilter;
  /** The Queensland day, yyyy-mm-dd. */
  today: string;
  who: WhoseSchedule | null;
  /** Office job numbers on today's schedule, for anyone. */
  scheduledToday: ReadonlySet<string>;
  query: string;
}

/**
 * The rows a filter shows.
 *
 * Today is the schedule's word first — a block on today's schedule is today's
 * work whatever the job's issue date says — and the issue date second, for a
 * phone that has no schedule synced. Mine is the open jobs booked to this
 * person: the closed ones are history, and history for a technician who has
 * been here five years is three thousand rows. Open is jobIsOpen's word —
 * neither the office nor this phone has closed it — and Today has no status
 * condition at all, because a job finished at ten this morning is still
 * today's work.
 */
export function applyJobFilter<T extends {
  externalId?: string; siteName: string; customerName?: string; title: string; address?: string; orderNo?: string;
  status: string; stage?: string; stageRaw?: string; scheduledFor?: string; techniciansJson?: string; technician?: string;
}>(jobs: readonly T[], ctx: JobFilterContext): T[] {
  return jobs.filter((j) => {
    if (!jobMatchesQuery(j, ctx.query)) return false;
    switch (ctx.filter) {
      case 'open': return jobIsOpen(j);
      case 'mine': return jobIsOpen(j) && jobIsMine(j, ctx.who);
      case 'today':
        return (!!j.externalId && ctx.scheduledToday.has(j.externalId)) || qldIsoDay(j.scheduledFor) === ctx.today;
      default: return true;
    }
  });
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

/** A day or an instant as d/m/yyyy; what cannot be read comes back as it arrived. */
export function auDate(iso: string | undefined): string {
  if (!iso) return '';
  return qldDay(iso) ?? iso;
}

/** The Queensland clock out of an instant, "14:05", or nothing for a date-only value. */
export function qldClock(iso: string | undefined): string | undefined {
  const m = qldMoment(iso)?.match(/ (\d{2}:\d{2}) /);
  return m?.[1];
}

/**
 * When something happened, relative to now, on the Queensland calendar.
 *
 * Minutes and hours within the day; yesterday by name; a week by days; and
 * the date past that. "3 h ago" at eight in the morning is this morning's
 * note, and only the Queensland day can say whether a note at 23:50 is
 * yesterday's — its UTC day is the day before.
 *
 * The days are calendar days, counted between the two Queensland dates, not
 * the elapsed time floored: a note at eleven on Sunday night read at seven
 * on Tuesday morning is thirty-two hours old and two days ago, and "1 days
 * ago" dated the office's instruction a day late.
 */
export function relativeQldTime(at: string | undefined, nowIso: string): string {
  if (!at) return '';
  const ms = Date.parse(at);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return auDate(at);
  const diff = now - ms;
  if (diff < 0) return qldMoment(at) ?? auDate(at);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const dayAt = qldIsoDay(at);
  const dayNow = qldIsoDay(nowIso);
  if (dayAt && dayNow) {
    if (dayAt === dayNow) return `${Math.floor(diff / 3_600_000)} h ago`;
    if (dayAt === addDays(dayNow, -1)) return `Yesterday ${qldClock(at) ?? ''}`.trim();
  }
  const days = dayAt && dayNow ? calendarDaysBetween(dayAt, dayNow) : Math.floor(diff / 86_400_000);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  return auDate(at);
}

/** Whole calendar days from one yyyy-mm-dd to a later one. */
function calendarDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The dates on a job's header, in the order they happen, only where the office set them. */
export function jobDates(job: { scheduledFor?: string; dueAt?: string; completedDate?: string }): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (job.scheduledFor) out.push({ label: 'Issued', value: auDate(job.scheduledFor) });
  if (job.dueAt) out.push({ label: 'Due', value: auDate(job.dueAt) });
  if (job.completedDate) out.push({ label: 'Completed', value: auDate(job.completedDate) });
  return out;
}

// ---------------------------------------------------------------------------
// Money: the sell side, and only the sell side
// ---------------------------------------------------------------------------

/**
 * A sell total as one line: "$1,523.50 ex GST · $1,675.85 inc GST".
 *
 * Both figures where both came across, because a technician quoting a
 * number on site is asked "is that with GST?" every single time. Undefined
 * where the office sent neither, so a card shows nothing rather than $0.00.
 */
export function sellTotalLine(exTaxCents: number | undefined, incTaxCents: number | undefined): string | undefined {
  const parts: string[] = [];
  if (exTaxCents !== undefined) parts.push(`${formatCents(exTaxCents)} ex GST`);
  if (incTaxCents !== undefined) parts.push(`${formatCents(incTaxCents)} inc GST`);
  return parts.length ? parts.join(' · ') : undefined;
}

// ---------------------------------------------------------------------------
// Lines under a cost centre
// ---------------------------------------------------------------------------

export const ITEM_KIND_LABEL: Record<SimproItemKind, string> = {
  catalog: 'Part',
  oneOff: 'One-off',
  labor: 'Labour',
  prebuild: 'Pre-build',
  serviceFee: 'Fee',
};

/** A quantity without trailing noise: 3, 2.5, 0.25. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** "3 ×" for a part, "2.5 h" for labour, because the unit is the difference between a price and a rate. */
export function formatQty(item: Pick<SimproItem, 'kind' | 'qty'>): string {
  return item.kind === 'labor' ? `${formatNumber(item.qty)} h` : `${formatNumber(item.qty)} ×`;
}

/** What to call a line: its description, its part number, or its family. */
export function itemHeading(item: Pick<SimproItem, 'kind' | 'description' | 'partNo'>): string {
  return item.description?.trim() || item.partNo?.trim() || ITEM_KIND_LABEL[item.kind];
}

export interface ItemPrice {
  /** The line's sell, ex GST. */
  line?: string;
  /** The unit sell, shown only where it differs from the line — a quantity of one says nothing twice. */
  unit?: string;
}

/**
 * A line's sell price, from the line total the office worked out, or from
 * unit by quantity where only the unit came across. Never from anything
 * else: the mirror does not hold a cost, so there is nothing else to show.
 */
export function itemPrice(item: Pick<SimproItem, 'qty' | 'unitSellExTaxCents' | 'sellExTaxCents'>): ItemPrice {
  const out: ItemPrice = {};
  const line = item.sellExTaxCents ?? (item.unitSellExTaxCents !== undefined ? Math.round(item.unitSellExTaxCents * item.qty) : undefined);
  if (line !== undefined) out.line = formatCents(line);
  if (item.unitSellExTaxCents !== undefined && item.qty !== 1) out.unit = `${formatCents(item.unitSellExTaxCents)} each`;
  return out;
}

/**
 * A line's discount as a word: "10% off", or "10% surcharge" for a negative
 * one, which is how Simpro writes a surcharge. Left as the office's figure
 * either way; the sign is the reading, and "-10% off" read as a discount.
 */
export function discountLabel(item: Pick<SimproItem, 'discountPercent'>): string | undefined {
  const d = item.discountPercent;
  if (d === undefined || !Number.isFinite(d) || d === 0) return undefined;
  return d > 0 ? `${formatNumber(d)}% off` : `${formatNumber(-d)}% surcharge`;
}

/** How many lines sit under a section, across its cost centres, for the collapsed heading. */
export function sectionLineCount(section: { costCenters: { items: readonly unknown[] }[] }): number {
  return section.costCenters.reduce((n, c) => n + c.items.length, 0);
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export type AttachmentIcon =
  | 'file-pdf-box' | 'file-image' | 'file-word-box' | 'file-excel-box' | 'file-powerpoint-box'
  | 'email-outline' | 'folder-zip-outline' | 'file-video-outline' | 'file-document-outline' | 'file-outline';

/** An icon by MIME type, falling back to the file's extension, because the office's list omits the type. */
export function attachmentIcon(mimeType: string | undefined, filename: string | undefined): AttachmentIcon {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = (filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'file-pdf-box';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'bmp'].includes(ext)) return 'file-image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'avi'].includes(ext)) return 'file-video-outline';
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return 'file-word-box';
  if (mime.includes('sheet') || mime.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) return 'file-excel-box';
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx'].includes(ext)) return 'file-powerpoint-box';
  if (mime === 'message/rfc822' || ['eml', 'msg'].includes(ext)) return 'email-outline';
  if (mime.includes('zip') || mime.includes('compressed') || ['zip', 'rar', '7z'].includes(ext)) return 'folder-zip-outline';
  if (mime.startsWith('text/') || ['txt', 'rtf', 'md'].includes(ext)) return 'file-document-outline';
  return 'file-outline';
}

/** "12.3 KB", or nothing where the office did not say. */
export function formatFileSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Invoices, quotes, tasks
// ---------------------------------------------------------------------------

/**
 * Where an invoice stands, against today.
 *
 * Paid is paid. An unpaid one is overdue once its due day has gone — the
 * comparison is on Queensland days, both sides yyyy-mm-dd — and simply due
 * until then. One with no due date is just unpaid, in the office's word for
 * it where there is one.
 */
export function invoiceState(
  inv: { isPaid: boolean; datePaid?: string; dueDate?: string; statusName?: string },
  today: string,
): StateWord {
  if (inv.isPaid) return { label: inv.datePaid ? `Paid ${auDate(inv.datePaid)}` : 'Paid', tone: 'pass' };
  if (inv.dueDate && inv.dueDate < today) return { label: `Overdue since ${auDate(inv.dueDate)}`, tone: 'fail' };
  if (inv.dueDate) return { label: `Due ${auDate(inv.dueDate)}`, tone: 'warn' };
  return { label: inv.statusName?.trim() || 'Unpaid', tone: 'warn' };
}

/** Unpaid first, and the most overdue of those first; then the rest newest first. */
export function orderInvoices<T extends { isPaid: boolean; dueDate?: string; dateIssued?: string }>(invoices: readonly T[]): T[] {
  return [...invoices].sort((a, b) => {
    if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
    if (!a.isPaid) {
      const da = a.dueDate ?? '9999';
      const db = b.dueDate ?? '9999';
      if (da !== db) return da < db ? -1 : 1;
    }
    const ia = a.dateIssued ?? '';
    const ib = b.dateIssued ?? '';
    return ia === ib ? 0 : ia < ib ? 1 : -1;
  });
}

/** "Invoice 12345 — Harbourline" matches on number, customer, order number or description. */
export function invoiceMatchesQuery(
  inv: { externalId: string; customerName?: string; orderNo?: string; description?: string; jobs: { id: string }[] },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean);
  if (!words.length) return true;
  const hay = [inv.externalId, inv.customerName, inv.orderNo, inv.description, ...inv.jobs.map((j) => j.id)]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Where a quote stands.
 *
 * Converted to a job outranks everything: the number is what a technician
 * is then looking for. Closed without a job is history. Otherwise the
 * office's status name, coloured by the stage.
 */
export function quoteState(q: { isClosed: boolean; jobExternalId?: string; stage?: string; statusName?: string }): StateWord {
  if (q.jobExternalId) return { label: `Job ${q.jobExternalId}`, tone: 'pass' };
  const stage = (q.stage ?? '').toLowerCase();
  if (q.isClosed) return { label: q.statusName?.trim() || 'Closed', tone: stage.includes('approv') ? 'pass' : 'muted' };
  const label = q.statusName?.trim() || stageLabel(q.stage) || 'Open';
  if (stage.includes('approv') || stage.includes('complete')) return { label, tone: 'pass' };
  if (stage.includes('declin') || stage.includes('archiv') || stage.includes('lost')) return { label, tone: 'muted' };
  if (stage.includes('progress')) return { label, tone: 'warn' };
  return { label, tone: 'info' };
}

export type QuoteListFilter = 'open' | 'approved' | 'converted' | 'closed' | 'all';

/**
 * The quote rows a filter shows. Open is neither closed nor converted; approved
 * is an open quote the customer has said yes to but the office has not yet
 * turned into a job; converted has a job number; closed is the rest.
 */
export function applyQuoteFilter<T extends {
  externalId: string; name: string; siteName?: string; customerName?: string; orderNo?: string;
  isClosed: boolean; jobExternalId?: string; stage?: string;
}>(quotes: readonly T[], filter: QuoteListFilter, query: string): T[] {
  return quotes.filter((q) => {
    if (!quoteMatchesQuery(q, query)) return false;
    const stage = (q.stage ?? '').toLowerCase();
    switch (filter) {
      case 'open': return !q.isClosed && !q.jobExternalId;
      case 'approved': return !q.jobExternalId && stage.includes('approv');
      case 'converted': return !!q.jobExternalId;
      case 'closed': return q.isClosed && !q.jobExternalId;
      default: return true;
    }
  });
}

export function quoteMatchesQuery(
  q: { externalId: string; name: string; siteName?: string; customerName?: string; orderNo?: string; jobExternalId?: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean);
  if (!words.length) return true;
  const hay = [q.externalId, q.name, q.siteName, q.customerName, q.orderNo, q.jobExternalId]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The sell total across a set of quotes, ex GST, for the strip above a list. Lines with no figure count nothing. */
export function sumExTax(rows: readonly { totalExTaxCents?: number }[]): number {
  return rows.reduce((n, r) => n + (r.totalExTaxCents ?? 0), 0);
}

/** Where a task stands against today. */
export function taskState(
  task: { completedBy?: string; percentComplete?: number; dueDate?: string },
  today: string,
): StateWord {
  if (task.completedBy || (task.percentComplete ?? 0) >= 100) return { label: 'Done', tone: 'pass' };
  const progress = task.percentComplete ? ` · ${formatNumber(task.percentComplete)}%` : '';
  if (task.dueDate && task.dueDate < today) return { label: `Overdue ${auDate(task.dueDate)}${progress}`, tone: 'fail' };
  if (task.dueDate) return { label: `Due ${auDate(task.dueDate)}${progress}`, tone: 'warn' };
  return { label: `Open${progress}`, tone: 'info' };
}

// ---------------------------------------------------------------------------
// People and places
// ---------------------------------------------------------------------------

/** The names on a job, joined, or the row's own joined string where the list is empty. */
export function technicianLine(technicians: readonly SimproPerson[], fallback?: string): string {
  const names = technicians.map((p) => p.name?.trim()).filter(Boolean);
  return names.length ? names.join(', ') : (fallback ?? '');
}

/** "12 Wharf St, Newstead QLD 4006" out of the office's address parts. */
export function formatAddress(a: SimproAddress | undefined): string | undefined {
  if (!a) return undefined;
  const street = a.address?.trim();
  const locality = [a.suburb, a.state, a.postcode].map((s) => s?.trim()).filter(Boolean).join(' ');
  const line = [street, locality].filter(Boolean).join(', ');
  return line || undefined;
}

/** A dialable number, or nothing where what the office typed has too few digits to be one. */
export function telHref(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, '');
  const plain = digits.replace(/\+/g, '');
  if (plain.length < 6) return undefined;
  return `tel:${digits.startsWith('+') ? '+' : ''}${plain}`;
}

export function mailHref(email: string | undefined): string | undefined {
  const e = email?.trim();
  return e && e.includes('@') ? `mailto:${e}` : undefined;
}

export function mapHref(address: string | undefined): string | undefined {
  const a = address?.trim();
  return a ? `https://maps.google.com/?q=${encodeURIComponent(a)}` : undefined;
}

export interface ContactAction {
  kind: 'mobile' | 'phone' | 'email';
  label: string;
  href: string;
}

/**
 * The ways to reach a contact, in the order a technician tries them: the
 * mobile first because that is the one that answers on site, the desk
 * number, then email. Only the ones the phone can actually act on.
 */
export function contactActions(c: Pick<SimproContact, 'mobile' | 'workPhone' | 'email'> | undefined): ContactAction[] {
  if (!c) return [];
  const out: ContactAction[] = [];
  const mobile = telHref(c.mobile);
  if (mobile && c.mobile) out.push({ kind: 'mobile', label: c.mobile, href: mobile });
  const phone = telHref(c.workPhone);
  if (phone && c.workPhone) out.push({ kind: 'phone', label: c.workPhone, href: phone });
  const email = mailHref(c.email);
  if (email && c.email) out.push({ kind: 'email', label: c.email, href: email });
  return out;
}

/** "Company" or "Individual", or the office's own word for anything else. */
export function customerKindLabel(kind: string | undefined): string {
  const k = (kind ?? '').trim().toLowerCase();
  if (k === 'company') return 'Company';
  if (k === 'individual') return 'Individual';
  return kind?.trim() ?? '';
}
