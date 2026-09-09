/**
 * A change to the office's asset register, asked for on the phone.
 *
 * Four kinds — an asset created on site, one corrected, one archived, one
 * deleted — and each is a queued item with three things the other queued
 * kinds do not have. It carries no job, because the register is not a job's.
 * It carries the moment before which it must not go, so a person has half a
 * minute to take it back, which is the one undo the queue offers: a row
 * still inside its window has not been sent, and deleting it is the undo.
 * And it is keyed on the asset and a change counter rather than on its
 * content, because a second edit of the same asset is a second change even
 * where it happens to write the same words, while the same edit queued
 * twice by a double tap is one.
 *
 * Pure: the shapes, the keys, the words for Waiting to send, the diff that
 * keeps a PATCH to what actually changed, and what to put back on the phone
 * when a change is taken back. The database and the send live in
 * @/db/assetChangeRepo and @/simpro/outboundAssets.
 */

export type AssetChangeKind = 'asset-create' | 'asset-update' | 'asset-archive' | 'asset-delete';

export const ASSET_CHANGE_KINDS: readonly AssetChangeKind[] = ['asset-create', 'asset-update', 'asset-archive', 'asset-delete'];

export function isAssetChangeKind(kind: string): kind is AssetChangeKind {
  return (ASSET_CHANGE_KINDS as readonly string[]).includes(kind);
}

/** The time a person has to take a change back before the queue may send it. */
export const UNDO_WINDOW_MS = 30_000;

/**
 * One custom field value as the office will receive it.
 *
 * Addressed by name as well as id: the id is what the request needs, and
 * for an asset the office already holds the send resolves it from the
 * office's own record — the phone's copy of the asset never kept the field
 * ids, only the names. A create has the ids from the office's type list.
 */
export interface AssetFieldValue {
  name: string;
  id?: number;
  value: string;
}

interface ChangeBase {
  assetId: string;
  /** Sequence within the asset, so an edit after an edit is a new row. */
  changeNo: number;
  /** ISO instant; the queue answers "later" until it. */
  notBefore: string;
}

export interface AssetCreatePayload extends ChangeBase {
  kind: 'asset-create';
  siteExternalId: string;
  assetTypeExternalId: string;
  assetTypeName?: string;
  fields: AssetFieldValue[];
  /** yyyy-mm-dd, the office's StartDate. */
  startDate?: string;
  /** The tag or asset number the send looks for before creating, so a retry does not create twice. */
  tag?: string;
  /** For the words on Waiting to send. */
  label: string;
}

export interface AssetUpdatePayload extends ChangeBase {
  kind: 'asset-update';
  assetExternalId: string;
  /** Only the fields whose value changed. */
  fields: AssetFieldValue[];
  startDate?: string;
  label: string;
  /**
   * The phone's record before the edit, so taking the change back from
   * anywhere — the list on the asset screen, the banner New asset opens —
   * can put the phone's copy back too, not only stop the send.
   */
  before?: EditableAsset;
}

export interface AssetArchivePayload extends ChangeBase {
  kind: 'asset-archive';
  assetExternalId: string;
  /** The local status before, so an undo can put it back. */
  previousStatus: string;
  label: string;
}

export interface AssetDeletePayload extends ChangeBase {
  kind: 'asset-delete';
  assetExternalId: string;
  previousStatus: string;
  label: string;
}

export type AssetChangePayload = AssetCreatePayload | AssetUpdatePayload | AssetArchivePayload | AssetDeletePayload;

export interface BuiltChange<P extends AssetChangePayload = AssetChangePayload> {
  kind: P['kind'];
  payload: P;
  /** What the queue de-duplicates on. */
  contentKey: string;
}

/** The queue key: the kind, the phone's asset, and which change to it this is. */
export function assetChangeKey(kind: AssetChangeKind, assetId: string, changeNo: number): string {
  return `${kind}|${assetId}|${changeNo}`;
}

/** The instant a change queued now may first go. */
export function undoDeadline(nowIso: string, windowMs = UNDO_WINDOW_MS): string {
  return new Date(Date.parse(nowIso) + windowMs).toISOString();
}

/**
 * Whether `now` is still inside the window, so the queue must answer "later".
 *
 * A `notBefore` that cannot be read is treated as passed rather than as
 * never: a row that could not be sent because its date was unreadable would
 * sit pending for good, and the guard is there to hold a change for half a
 * minute, not to hold it forever.
 */
export function isBeforeWindow(nowIso: string, notBefore: string | undefined): boolean {
  if (!notBefore) return false;
  const until = Date.parse(notBefore);
  if (Number.isNaN(until)) return false;
  return Date.parse(nowIso) < until;
}

/** Milliseconds left in the window, never negative, for a countdown. */
export function undoMsLeft(nowIso: string, notBefore: string | undefined): number {
  if (!notBefore) return 0;
  const left = Date.parse(notBefore) - Date.parse(nowIso);
  return Number.isFinite(left) && left > 0 ? left : 0;
}

interface Timing { now: string; changeNo: number; windowMs?: number }

const base = (assetId: string, t: Timing): ChangeBase => ({
  assetId,
  changeNo: t.changeNo,
  notBefore: undoDeadline(t.now, t.windowMs),
});

const build = <P extends AssetChangePayload>(payload: P): BuiltChange<P> => ({
  kind: payload.kind,
  payload,
  contentKey: assetChangeKey(payload.kind, payload.assetId, payload.changeNo),
});

export function buildCreate(
  input: {
    assetId: string; siteExternalId: string; assetTypeExternalId: string; assetTypeName?: string;
    fields: AssetFieldValue[]; startDate?: string; tag?: string; label: string;
  },
  t: Timing,
): BuiltChange<AssetCreatePayload> {
  return build<AssetCreatePayload>({
    kind: 'asset-create',
    ...base(input.assetId, t),
    siteExternalId: input.siteExternalId,
    assetTypeExternalId: input.assetTypeExternalId,
    assetTypeName: input.assetTypeName,
    fields: input.fields.filter((f) => f.value.trim() !== ''),
    startDate: input.startDate,
    tag: input.tag?.trim() || undefined,
    label: input.label,
  });
}

export function buildUpdate(
  input: {
    assetId: string; assetExternalId: string; fields: AssetFieldValue[]; startDate?: string; label: string;
    before?: EditableAsset;
  },
  t: Timing,
): BuiltChange<AssetUpdatePayload> {
  return build<AssetUpdatePayload>({
    kind: 'asset-update',
    ...base(input.assetId, t),
    assetExternalId: input.assetExternalId,
    fields: input.fields,
    startDate: input.startDate,
    label: input.label,
    before: input.before ? snapshot(input.before) : undefined,
  });
}

export function buildArchive(
  input: { assetId: string; assetExternalId: string; previousStatus: string; label: string },
  t: Timing,
): BuiltChange<AssetArchivePayload> {
  return build<AssetArchivePayload>({ kind: 'asset-archive', ...base(input.assetId, t), ...input });
}

export function buildDelete(
  input: { assetId: string; assetExternalId: string; previousStatus: string; label: string },
  t: Timing,
): BuiltChange<AssetDeletePayload> {
  return build<AssetDeletePayload>({ kind: 'asset-delete', ...base(input.assetId, t), ...input });
}

/**
 * Whether an update has anything the office would notice.
 *
 * An edit to the phone's own name for an asset, or to a note, changes no
 * field the office holds, and a PATCH with nothing in it is a request for
 * nothing.
 */
export function updateHasContent(payload: Pick<AssetUpdatePayload, 'fields' | 'startDate'>): boolean {
  return payload.fields.length > 0 || payload.startDate !== undefined;
}

/**
 * The fields of an asset that changed between two versions of it.
 *
 * Reads the columns a person can edit and each attribute key on its own, so
 * a change to one type attribute is reported as that attribute and not as
 * "attributes". Blank and absent are the same value: clearing a field the
 * record never had is not a change.
 */
export interface EditableAsset {
  name?: string;
  level?: string;
  room?: string;
  locationNote?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  installedDate?: string;
  notes?: string;
  attributes?: Record<string, string | number | boolean>;
}

const EDITABLE_COLUMNS = ['name', 'level', 'room', 'locationNote', 'manufacturer', 'model', 'serial', 'installedDate', 'notes'] as const;

const text = (v: string | number | boolean | undefined): string => (v === undefined || v === null ? '' : String(v).trim());

/** The editable part of a record and nothing else, so a payload does not carry the whole row. */
export function snapshot(asset: EditableAsset): EditableAsset {
  const out: EditableAsset = {};
  for (const col of EDITABLE_COLUMNS) {
    if (asset[col] !== undefined && asset[col] !== null) out[col] = String(asset[col]);
  }
  out.attributes = { ...(asset.attributes ?? {}) };
  return out;
}

/** What updateAsset is handed to put the phone's copy back as it was. */
export type RevertPatch = Record<(typeof EDITABLE_COLUMNS)[number], string> & {
  attributes: Record<string, string | number | boolean>;
};

/**
 * The patch that puts every editable column back to `before`.
 *
 * Every column, unconditionally, and blank as '' rather than undefined:
 * updateAsset skips a column it is handed undefined for, so a revert that
 * only named the columns that had a value left a field the edit had filled
 * in exactly as the edit left it.
 */
export function revertPatch(before: EditableAsset): RevertPatch {
  const out = { attributes: { ...(before.attributes ?? {}) } } as RevertPatch;
  for (const col of EDITABLE_COLUMNS) out[col] = text(before[col]);
  return out;
}

/** What taking a change back puts back on the phone, and the words for it. */
export interface LocalRevert {
  patch: Partial<RevertPatch> & { status?: string };
  note: string;
}

/**
 * What a taken-back change leaves to put right on the phone, from its
 * payload alone, so an undo from the list on the asset screen is the same
 * undo as the one offered the moment the change was queued.
 *
 * A create leaves the phone's asset where it is: the asset is the phone's,
 * and only the office's copy of it was stopped. An archive or delete puts
 * the status back; the status was not changed on the phone when it was
 * queued (it waits for the office's yes), so this is what it already is
 * unless something else moved it. An update puts the snapshot back, and an
 * update queued without one — there were none before the snapshot was
 * added — is stopped and said so.
 */
export function revertFor(payload: AssetChangePayload): LocalRevert {
  switch (payload.kind) {
    case 'asset-create':
      return { patch: {}, note: 'Nothing was sent to the office. The asset stays on the phone.' };
    case 'asset-update':
      return payload.before
        ? { patch: revertPatch(payload.before), note: 'Nothing was sent to the office, and the asset is back as it was on the phone.' }
        : { patch: {}, note: 'Nothing was sent to the office. The edit is still on the phone; change it back by hand if it should not stand.' };
    case 'asset-archive':
    case 'asset-delete':
      return { patch: { status: payload.previousStatus }, note: 'Nothing was sent to the office. The asset is still on the register.' };
  }
}

/**
 * Whether a string is a real day written yyyy-mm-dd, which is the one shape
 * the office's StartDate takes. Built from the parts and read back, so
 * 2026-02-30 is refused along with 30/09/2026.
 */
export function isIsoDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function changedFields(before: EditableAsset, after: EditableAsset): string[] {
  const changed: string[] = [];
  for (const col of EDITABLE_COLUMNS) {
    if (text(before[col]) !== text(after[col])) changed.push(col);
  }
  const keys = new Set([...Object.keys(before.attributes ?? {}), ...Object.keys(after.attributes ?? {})]);
  for (const key of [...keys].sort()) {
    if (text(before.attributes?.[key]) !== text(after.attributes?.[key])) changed.push(`attributes.${key}`);
  }
  return changed;
}

/**
 * The office fields whose value differs between two renderings of the same
 * asset, so a PATCH carries only what changed. A field present before and
 * blank after is carried as blank: that is the clearing of it.
 */
export function diffFields(before: AssetFieldValue[], after: AssetFieldValue[]): AssetFieldValue[] {
  const was = new Map(before.map((f) => [f.name, f.value.trim()]));
  const out: AssetFieldValue[] = [];
  const seen = new Set<string>();
  for (const f of after) {
    seen.add(f.name);
    if ((was.get(f.name) ?? '') !== f.value.trim()) out.push({ ...f, value: f.value.trim() });
  }
  for (const f of before) {
    if (!seen.has(f.name) && f.value.trim() !== '') out.push({ ...f, value: '' });
  }
  return out;
}

/** The words for one change on Waiting to send. */
export function describeAssetChange(kind: string, payload: unknown): string {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Partial<AssetChangePayload>;
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : 'an asset';
  switch (kind) {
    case 'asset-create': {
      const type = (p as Partial<AssetCreatePayload>).assetTypeName;
      return `New asset in Simpro: ${label}${type ? ` (${type})` : ''}`;
    }
    case 'asset-update': {
      const fields = (p as Partial<AssetUpdatePayload>).fields ?? [];
      const names = fields.map((f) => f.name);
      if ((p as Partial<AssetUpdatePayload>).startDate !== undefined) names.push('Start date');
      return `Asset corrected in Simpro: ${label}${names.length ? ` — ${names.join(', ')}` : ''}`;
    }
    case 'asset-archive':
      return `Asset archived in Simpro: ${label}`;
    case 'asset-delete':
      return `Asset deleted from Simpro: ${label}`;
    default:
      return `Register change: ${label}`;
  }
}

/** The state of a change in a word a person can act on. */
export type AssetChangeState = 'undoable' | 'queued' | 'sent' | 'failed' | 'unknown' | 'forgotten' | 'taken-back';

export function describeChangeState(state: AssetChangeState, error?: string): string {
  switch (state) {
    case 'undoable': return 'Not sent yet — you can still take it back';
    case 'queued': return 'Waiting to send — goes with the next sync';
    case 'sent': return 'Sent to the office';
    case 'failed': return `Refused by Simpro${error ? `: ${error}` : ''}`;
    case 'unknown': return 'Sent, and no reply came — see Waiting to send';
    case 'forgotten': return `Dropped from Waiting to send${error ? `: ${error}` : ''} — the office does not have it`;
    case 'taken-back': return 'Taken back before it went';
  }
}
