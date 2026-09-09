import type { SimproClient } from './client';
import { SIMPRO_PATHS } from './mirrorResources';
import type { QueuedItem, SendDeps, SendMoreOutcome } from './outboundKinds';
import { deleteAsset, getAsset, updateAsset } from '@/db/assetRepo';
import { changeForQueueRow, markAssetChangeFailed, markAssetChangeSent } from '@/db/assetChangeRepo';
import {
  isAssetChangeKind, isBeforeWindow,
  type AssetArchivePayload, type AssetChangePayload, type AssetCreatePayload, type AssetDeletePayload,
  type AssetFieldValue, type AssetUpdatePayload,
} from '@/domain/assetChanges';

/**
 * Sending changes to the office's asset register: an asset created on site,
 * one corrected, one archived, one deleted.
 *
 * Its own module because the register is the one thing the office schedules
 * twelve and a half thousand jobs from, and a change to it deserves its own
 * rules — a confirmation before it queues, a moment to take it back, and a
 * row that says exactly what it did. ./outboundMore hands any kind it does
 * not know to this module before giving up on it.
 *
 * Three rules, the same for every kind.
 *
 * **Not before its moment.** Every payload carries `notBefore`, the end of
 * the half minute a person has to take the change back, and until then the
 * answer is `later`: the row stays pending and untouched, and deleting it
 * is the undo (@/db/assetChangeRepo). The undo deletes the change row with
 * the queue row, and the queue only hands a row here once it has claimed
 * it, so a row that arrives with no change row beside it was taken back
 * and is closed without a send — the two rows are written together, and
 * nothing else takes the change row away.
 *
 * **Read before write.** A create lists the site's assets first and stops if
 * one already carries the tag number, because a retry after a reply that
 * could not be read, or a person's "send again", must not put a second
 * extinguisher on the register. An office type with no tag field has no
 * tag to look for, so the location and the type stand in for it, and a
 * create with neither is not sent at all — New asset refuses it first. An
 * update, archive or delete reads the record first and stops if it is
 * already as asked, or gone. The reads are the ones the build honours:
 * `customerAssets/?Site.ID=` answers with the site's assets (a bare `Site=`
 * is a 422), and a record's own path with no trailing slash.
 *
 * **The writes are as the documentation gives them, and unverified.** The
 * one write this app has made against the build is the LastTest PATCH in
 * ./resources; the POST, the CustomFields PATCH, the Archived PATCH and the
 * DELETE below are built exactly as the public API documents them and have
 * not been tried. A refusal is thrown as the client's own error and reaches
 * the person in the server's words, on the change row and on Waiting to
 * send. `ServiceLevels` is never sent, for the reason postAssetTest gives:
 * an array of one would very plausibly replace the whole set.
 */

/** The record as the build answers a GET on it, as far as the send reads it. */
interface RemoteAsset {
  ID?: number;
  AssetType?: { ID?: number; Name?: string };
  Archived?: boolean;
  StartDate?: string | null;
  CustomFields?: { CustomField?: { ID?: number; Name?: string }; Value?: string | null }[];
}

/** The reply to the POST, as far as the send reads it: the id, if one came back. */
interface CreateReply { ID?: unknown }

/** The office's headings for the number written on the equipment; the same set assetSync reads. */
const TAG_FIELD = /^(asset\s*#|asset\s*number|asset\s*no\.?|tag\s*no\.?|tag\s*number)$/i;
/** The office's one field for where the equipment is. */
const LOCATION_FIELD = /^location$/i;

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

function fieldOf(remote: RemoteAsset, heading: RegExp): string | undefined {
  for (const f of remote.CustomFields ?? []) {
    if (heading.test(f.CustomField?.Name ?? '') && (f.Value ?? '').trim()) return (f.Value ?? '').trim();
  }
  return undefined;
}

const tagOf = (remote: RemoteAsset): string | undefined => fieldOf(remote, TAG_FIELD);
const locationOf = (remote: RemoteAsset): string | undefined => fieldOf(remote, LOCATION_FIELD);

/** The record, or undefined where the office no longer has it. Any other refusal is thrown. */
async function readRemote(client: SimproClient, externalId: string): Promise<RemoteAsset | undefined> {
  try {
    const { data } = await client.request<RemoteAsset | undefined>('GET', SIMPRO_PATHS.customerAsset(externalId));
    return data && typeof data === 'object' ? data : undefined;
  } catch (e) {
    if ((e as { status?: unknown }).status === 404) return undefined;
    throw e;
  }
}

/** The site's assets with their type and fields, every page: a site is at most a few hundred rows. */
async function siteAssets(client: SimproClient, siteExternalId: string): Promise<RemoteAsset[]> {
  const { items } = await client.listAllPaged<RemoteAsset>(SIMPRO_PATHS.customerAssets(), {
    'Site.ID': siteExternalId,
    columns: 'ID,AssetType,CustomFields',
  }, 5000);
  return items;
}

/** The request body's CustomFields, from the fields that have an id to address. */
function customFieldsBody(fields: readonly AssetFieldValue[]): { CustomField: number; Value: string }[] {
  return fields
    .filter((f): f is AssetFieldValue & { id: number } => typeof f.id === 'number')
    .map((f) => ({ CustomField: f.id, Value: f.value }));
}

/**
 * Sends one write, keeping the server's words on the change row when it
 * refuses. Rethrown so the queue files the refusal exactly as it files any
 * other — retry, give up, stop or ask a person — from ./sendOutcome.
 */
async function write<T>(changeId: string | undefined, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (e) {
    if (changeId) await markAssetChangeFailed(changeId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function sendCreate(p: AssetCreatePayload, changeId: string | undefined, client: SimproClient): Promise<SendMoreOutcome> {
  const local = await getAsset(p.assetId);
  // Gone from the phone, or the office already knows it: nothing to create.
  if (!local) return { status: 'done' };
  if (local.externalId && local.externalSource === 'simpro') {
    if (changeId) await markAssetChangeSent(changeId, { assetExternalId: local.externalId });
    return { status: 'done' };
  }
  if (!p.siteExternalId || !p.assetTypeExternalId) {
    return { status: 'abandon', reason: 'Nothing was sent: the asset has no Simpro site or office type to be created under.' };
  }

  // Is it there already? The tag says where the type has a tag field; the
  // location and the type together say where it does not. With neither
  // there is nothing to tell a retry from a second asset, and it does not
  // go — New asset refuses to queue such a create, so this is the guard
  // behind that one. The office's own id is written onto the phone's asset
  // so the next pull updates rather than duplicates it.
  const location = p.fields.find((f) => LOCATION_FIELD.test(f.name) && f.value.trim())?.value.trim();
  // The tag is only a key if it is going into a tag field on the record.
  // A payload can carry the phone's own asset code for a type the office
  // has no tag field for, and matching on a field the record does not have
  // never matches — every retry then created another asset.
  const taggable = Boolean(p.tag && p.fields.some((f) => TAG_FIELD.test(f.name) && f.value.trim()));
  if (!taggable && !location) {
    const reason = 'Nothing was sent: this asset type has no tag field in Simpro and the asset has no location, so a retry could create it twice. Create it in the office instead.';
    if (changeId) await markAssetChangeFailed(changeId, reason);
    return { status: 'abandon', reason };
  }
  const same = (a: RemoteAsset): boolean => (taggable
    ? norm(tagOf(a)) === norm(p.tag)
    : norm(locationOf(a)) === norm(location) && a.AssetType?.ID !== undefined && String(a.AssetType.ID) === p.assetTypeExternalId);
  const link = async (): Promise<string | undefined> => {
    const held = (await siteAssets(client, p.siteExternalId)).find((a) => a.ID !== undefined && same(a));
    if (held?.ID === undefined) return undefined;
    const externalId = String(held.ID);
    await updateAsset(local.id, { externalId, externalSource: 'simpro' });
    return externalId;
  };
  const already = await link();
  if (already) {
    if (changeId) await markAssetChangeSent(changeId, { assetExternalId: already });
    return { status: 'done' };
  }

  // Documented shape, unverified on the build: AssetType and Site by id,
  // CustomFields by field id, StartDate as yyyy-mm-dd.
  const body: Record<string, unknown> = {
    AssetType: Number(p.assetTypeExternalId),
    Site: Number(p.siteExternalId),
    CustomFields: customFieldsBody(p.fields),
  };
  if (p.startDate) body.StartDate = p.startDate;
  const { data } = await write(changeId, () => client.request<CreateReply | undefined>('POST', SIMPRO_PATHS.customerAssets(), { body }));

  // A 204, or a 2xx with nothing in it, is still an asset created: the id
  // was just not handed back, so it is looked up the way a retry would
  // find it. An asset the lookup cannot find stays unlinked until the next
  // pull, which will bring it down as the office's copy.
  const id = data?.ID !== undefined && data?.ID !== null ? String(data.ID) : await link();
  if (id) await updateAsset(local.id, { externalId: id, externalSource: 'simpro' });
  if (changeId) await markAssetChangeSent(changeId, { assetExternalId: id });
  return { status: 'sent' };
}

async function sendUpdate(p: AssetUpdatePayload, changeId: string | undefined, client: SimproClient): Promise<SendMoreOutcome> {
  const remote = await readRemote(client, p.assetExternalId);
  if (!remote) {
    const reason = 'Nothing was sent: the office no longer has this asset, so there is nothing to correct.';
    if (changeId) await markAssetChangeFailed(changeId, reason);
    return { status: 'abandon', reason };
  }

  // The field ids come from the office's own record, by name, because the
  // phone's copy of an asset never kept them; a field the office's type
  // does not have is dropped. A value the office already holds is not sent
  // again, so a retry after an unreadable reply changes nothing twice.
  const remoteFields = new Map<string, { id?: number; value: string }>();
  for (const f of remote.CustomFields ?? []) {
    const name = norm(f.CustomField?.Name);
    if (name) remoteFields.set(name, { id: f.CustomField?.ID, value: (f.Value ?? '').trim() });
  }
  // The office's own heading for a serial, whatever it calls it: "Serial
  // No." and "Serial Number" are the same field to a technician, and a
  // serial typed on site under one spelling used to be dropped for want of
  // the other and the change still reported as sent.
  const remoteSerial = [...remoteFields.entries()].find(([name]) => /serial/i.test(name));
  const fields: AssetFieldValue[] = [];
  for (const f of p.fields) {
    const held = remoteFields.get(norm(f.name))
      ?? (/serial/i.test(f.name) ? remoteSerial?.[1] : undefined);
    const id = held?.id ?? f.id;
    if (id === undefined) continue;
    if (held && held.value === f.value.trim()) continue;
    fields.push({ ...f, id, value: f.value.trim() });
  }
  const startDate = p.startDate !== undefined && p.startDate !== (remote.StartDate ?? '') ? p.startDate : undefined;
  if (!fields.length && startDate === undefined) {
    if (changeId) await markAssetChangeSent(changeId);
    return { status: 'done' };
  }

  // Documented shape, unverified on the build: only what changed.
  const body: Record<string, unknown> = {};
  if (fields.length) body.CustomFields = customFieldsBody(fields);
  if (startDate !== undefined) body.StartDate = startDate;
  await write(changeId, () => client.request('PATCH', SIMPRO_PATHS.customerAsset(p.assetExternalId), { body }));
  if (changeId) await markAssetChangeSent(changeId);
  return { status: 'sent' };
}

async function sendArchive(p: AssetArchivePayload, changeId: string | undefined, client: SimproClient): Promise<SendMoreOutcome> {
  const remote = await readRemote(client, p.assetExternalId);
  // Gone, or already archived: as asked, either way.
  const already = !remote || remote.Archived === true;
  // Documented shape, unverified on the build.
  if (!already) await write(changeId, () => client.request('PATCH', SIMPRO_PATHS.customerAsset(p.assetExternalId), { body: { Archived: true } }));
  // The phone's copy is taken off the register only now, with the office's
  // yes: a status changed when the change was queued stayed changed when
  // the office refused, with the buttons that could put it right disabled
  // behind it.
  await updateAsset(p.assetId, { status: 'decommissioned' });
  if (changeId) await markAssetChangeSent(changeId);
  return { status: already ? 'done' : 'sent' };
}

async function sendDelete(p: AssetDeletePayload, changeId: string | undefined, client: SimproClient): Promise<SendMoreOutcome> {
  const remote = await readRemote(client, p.assetExternalId);
  if (remote) {
    // Documented, unverified on the build: a DELETE on the record's path.
    await write(changeId, () => client.request('DELETE', SIMPRO_PATHS.customerAsset(p.assetExternalId)));
  }
  // The phone's copy waited, untouched, until the office agreed; now it
  // goes too. The change row outlives it and says what happened.
  await deleteAsset(p.assetId);
  if (changeId) await markAssetChangeSent(changeId);
  return { status: remote ? 'sent' : 'done' };
}

/**
 * Sends one register change.
 *
 * `now` is a parameter for the tests; the queue passes nothing and the
 * clock is read here.
 */
export async function sendAssetChange(
  item: QueuedItem,
  deps: SendDeps,
  now: string = new Date().toISOString(),
): Promise<SendMoreOutcome> {
  if (!isAssetChangeKind(item.kind)) return { status: 'not-mine' };
  const p = item.payload as Partial<AssetChangePayload> | null | undefined;
  if (!p || typeof p !== 'object' || typeof p.assetId !== 'string' || p.kind !== item.kind) {
    return { status: 'abandon', reason: 'Nothing was sent: the queued register change could not be read.' };
  }
  // Still inside the moment a person has to take it back.
  if (isBeforeWindow(now, p.notBefore)) return { status: 'later' };

  // Taken back. The two rows are written together and the undo deletes
  // them together, so a queue row with no change row beside it was taken
  // back by a person; closed here without a send, and nothing touched.
  const change = await changeForQueueRow(item.id);
  if (!change) return { status: 'done' };
  const changeId = change.id;
  const { client } = deps;
  switch (item.kind) {
    case 'asset-create': return sendCreate(p as AssetCreatePayload, changeId, client);
    case 'asset-update': return sendUpdate(p as AssetUpdatePayload, changeId, client);
    case 'asset-archive': return sendArchive(p as AssetArchivePayload, changeId, client);
    case 'asset-delete': return sendDelete(p as AssetDeletePayload, changeId, client);
    default: return { status: 'not-mine' };
  }
}
