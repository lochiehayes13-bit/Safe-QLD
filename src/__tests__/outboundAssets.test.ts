import { sendAssetChange } from '@/simpro/outboundAssets';
import { sendMore } from '@/simpro/outboundMore';
import { SimproError, type SimproClient } from '@/simpro/client';
import type { SimproResources } from '@/simpro/resources';
import { createAsset, getAsset } from '@/db/assetRepo';
import { createSite } from '@/db/repo';
import { getAssetChange, queueAssetChange } from '@/db/assetChangeRepo';
import { pendingSync } from '@/db/opsRepo';
import { buildArchive, buildCreate, buildDelete, buildUpdate, type BuiltChange } from '@/domain/assetChanges';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));
jest.mock('@/simpro/attachmentFiles', () => ({ AttachmentFileMissing: class extends Error {}, readAttachmentForUpload: jest.fn() }));
jest.mock('@/simpro/attachments', () => ({ uploadJobAttachment: jest.fn() }));

/**
 * The send seam for register changes.
 *
 * A fake client records what would have gone to the office; the assertion
 * is the exact path, method and body, because none of the four writes has
 * been tried on the live build and the body is the one thing this module
 * is for. The reads before each write are answered by the same fake, so
 * the guards — a create found already there, an update already applied,
 * an archive of an archived asset, a delete of one that is gone — are
 * checked against the shapes the build answers with.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

interface Sent { method: string; path: string; body: unknown }
interface Read { path: string; query: Record<string, string | number> | undefined }

/**
 * `get` answers a record read (throw a SimproError for a 404), `list` a
 * collection read, `answer` a write. Everything is recorded.
 */
function fakeClient(opts: {
  get?: (path: string) => unknown;
  list?: (path: string, query: Record<string, string | number>) => unknown[];
  answer?: (s: Sent) => unknown;
} = {}): { client: SimproClient; sent: Sent[]; reads: Read[] } {
  const sent: Sent[] = [];
  const reads: Read[] = [];
  const client = {
    request: async (method: string, path: string, options: { body?: unknown; query?: Record<string, string | number> } = {}) => {
      if (method === 'GET') {
        reads.push({ path, query: options.query });
        return { data: opts.get ? opts.get(path) : undefined, total: null };
      }
      const s = { method, path, body: options.body };
      sent.push(s);
      return { data: opts.answer ? opts.answer(s) : undefined, total: null };
    },
    listAllPaged: async (path: string, query: Record<string, string | number>) => {
      reads.push({ path, query });
      return { items: opts.list ? opts.list(path, query) : [], truncated: false };
    },
  } as unknown as SimproClient;
  return { client, sent, reads };
}

const deps = (client: SimproClient) => ({ client, api: {} as SimproResources });

const NOW = '2026-09-09T01:00:00.000Z';
/** Well after any window opened at NOW. */
const LATER = '2026-09-09T01:05:00.000Z';
const notFound = (path: string) => new SimproError(`Simpro returned HTTP 404 for ${path}.`, 404, path);

async function simproSite() {
  return createSite({ name: 'Fictional Tower', externalId: '55', externalSource: 'simpro' });
}

/** Queues a built change and hands back the item the queue would pass on. */
async function queued(built: BuiltChange) {
  const { change } = await queueAssetChange(built);
  return { change, item: { id: change.queueRowId!, kind: built.kind, payload: built.payload, contentKey: built.contentKey } };
}

describe('the contract', () => {
  it('is not the sender for other kinds', async () => {
    const { client } = fakeClient();
    expect(await sendAssetChange({ id: 'q', kind: 'timesheet-block', payload: {} }, deps(client), LATER)).toEqual({ status: 'not-mine' });
  });

  it('answers later while the window is open, touching nothing', async () => {
    const site = await simproSite();
    const asset = await createAsset({ siteId: site.id, assetTypeId: 'extinguisher', name: 'Ext', externalId: '900', externalSource: 'simpro' });
    const { item } = await queued(buildArchive({ assetId: asset.id, assetExternalId: '900', previousStatus: 'in-service', label: 'Ext' }, { now: NOW, changeNo: 1 }));
    const { client, sent, reads } = fakeClient();
    expect(await sendAssetChange(item, deps(client), '2026-09-09T01:00:29.000Z')).toEqual({ status: 'later' });
    expect(sent).toEqual([]);
    expect(reads).toEqual([]);
    expect((await pendingSync()).map((r) => r.status)).toEqual(['pending']);
    // ./outboundMore hands the kind here before giving up on it; it reads
    // the real clock, so this window is opened from it.
    const fresh = await queued(buildArchive({ assetId: asset.id, assetExternalId: '900', previousStatus: 'in-service', label: 'Ext' }, { now: new Date().toISOString(), changeNo: 2 }));
    expect(await sendMore(fresh.item, deps(client))).toEqual({ status: 'later' });
    expect(sent).toEqual([]);
  });

  it('abandons a payload it cannot read rather than throwing', async () => {
    const { client } = fakeClient();
    const outcome = await sendAssetChange({ id: 'q', kind: 'asset-delete', payload: { kind: 'asset-update' } }, deps(client), LATER);
    expect(outcome).toMatchObject({ status: 'abandon' });
  });
});

describe('creating an asset', () => {
  const create = async (assetOver: Record<string, unknown> = {}, over: Partial<Parameters<typeof buildCreate>[0]> = {}) => {
    const site = await simproSite();
    const asset = await createAsset({ siteId: site.id, assetTypeId: 'extinguisher', name: 'Extinguisher E-12', level: 'Level 1', room: 'Kitchen', installedDate: '2026-09-01', ...assetOver });
    const built = buildCreate({
      assetId: asset.id, siteExternalId: '55', assetTypeExternalId: '6', assetTypeName: 'Fire Extinguishers',
      fields: [{ id: 62, name: 'Location', value: 'Level 1 Kitchen' }, { id: 61, name: 'Asset #', value: 'E-12' }, { name: 'No id', value: 'dropped' }],
      startDate: '2026-09-01', tag: 'E-12', label: 'Extinguisher E-12', ...over,
    }, { now: NOW, changeNo: 1 });
    return { asset, ...(await queued(built)) };
  };

  it('reads the site first, then posts the documented shape and links the reply id to the phone asset', async () => {
    const { asset, item, change } = await create();
    const { client, sent, reads } = fakeClient({ answer: () => ({ ID: 9001 }) });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    // The type comes back too: two assets can wear the same tag on one site
    // when they are different kinds of thing.
    expect(reads).toEqual([{ path: 'customerAssets/', query: { 'Site.ID': '55', columns: 'ID,AssetType,CustomFields' } }]);
    expect(sent).toEqual([{
      method: 'POST',
      path: 'customerAssets/',
      body: {
        AssetType: 6,
        Site: 55,
        CustomFields: [{ CustomField: 62, Value: 'Level 1 Kitchen' }, { CustomField: 61, Value: 'E-12' }],
        StartDate: '2026-09-01',
      },
    }]);
    expect(await getAsset(asset.id)).toMatchObject({ externalId: '9001', externalSource: 'simpro' });
    expect(await getAssetChange(change.id)).toMatchObject({ assetExternalId: '9001' });
    expect((await getAssetChange(change.id))?.sentAt).toBeDefined();
  });

  it('does not create an asset the site already has under that tag; it links to it instead', async () => {
    const { asset, item } = await create();
    const { client, sent } = fakeClient({
      list: () => [
        { ID: 8000, CustomFields: [{ CustomField: { ID: 61, Name: 'Asset #' }, Value: 'E-11' }] },
        { ID: 8001, CustomFields: [{ CustomField: { ID: 61, Name: 'Asset #' }, Value: ' e-12 ' }] },
      ],
    });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
    expect(await getAsset(asset.id)).toMatchObject({ externalId: '8001', externalSource: 'simpro' });
  });

  it('finds the asset by tag after a reply with no id in it', async () => {
    const { asset, item } = await create();
    let posted = false;
    const { client, sent } = fakeClient({
      list: () => (posted ? [{ ID: 8002, CustomFields: [{ CustomField: { ID: 61, Name: 'Asset #' }, Value: 'E-12' }] }] : []),
      answer: () => { posted = true; return undefined; },
    });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(await getAsset(asset.id)).toMatchObject({ externalId: '8002' });
  });

  it('links by location and type where the office type has no tag field, so a retry cannot duplicate', async () => {
    // A fire door type with Location and no Asset # field. The payload still
    // carries the phone's own code, which is written nowhere on the record,
    // so keying on it would never match and every retry made another door.
    const { asset, item } = await create({}, {
      assetTypeExternalId: '11',
      fields: [{ id: 71, name: 'Location', value: 'Level 1 Stair A' }],
      tag: 'SQ-FD-0000001',
    });
    let posted = false;
    const { client, sent } = fakeClient({
      list: () => (posted
        ? [{ ID: 8100, AssetType: { ID: 11 }, CustomFields: [{ CustomField: { ID: 71, Name: 'Location' }, Value: 'Level 1 Stair A' }] }]
        : []),
      answer: () => { posted = true; return undefined; },
    });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    // The second run finds the door it made rather than posting again.
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'done' });
    expect(sent).toHaveLength(1);
    expect(await getAsset(asset.id)).toMatchObject({ externalId: '8100' });
  });

  it('refuses a create with nothing a retry could recognise it by', async () => {
    const { item } = await create({}, { fields: [{ id: 71, name: 'FRL Level', value: '-/60/30' }], tag: undefined });
    const { client, sent } = fakeClient();
    expect(await sendAssetChange(item, deps(client), LATER)).toMatchObject({
      status: 'abandon', reason: expect.stringContaining('no tag field'),
    });
    expect(sent).toEqual([]);
  });

  it('is done for an asset gone from the phone, or already linked', async () => {
    const { asset, item } = await create({ externalId: '7', externalSource: 'simpro' });
    const { client, sent, reads } = fakeClient();
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
    expect(reads).toEqual([]);
    expect(await sendAssetChange({ ...item, payload: { ...(item.payload as object), assetId: 'nope' } }, deps(client), LATER)).toEqual({ status: 'done' });
    void asset;
  });

  it('abandons a create with no site or type to go under', async () => {
    const { item } = await create({}, { siteExternalId: '' });
    const { client, sent } = fakeClient();
    expect(await sendAssetChange(item, deps(client), LATER)).toMatchObject({ status: 'abandon' });
    expect(sent).toEqual([]);
  });

  it('keeps the server\'s refusal on the change row and rethrows it for the queue', async () => {
    const { item, change } = await create();
    const { client } = fakeClient({ answer: (s) => { throw new SimproError(`Simpro returned HTTP 422 for ${s.path}.`, 422, s.path); } });
    await expect(sendAssetChange(item, deps(client), LATER)).rejects.toThrow('HTTP 422');
    expect((await getAssetChange(change.id))?.error).toContain('HTTP 422');
  });
});

describe('correcting an asset', () => {
  const remote = {
    ID: 900, Archived: false, StartDate: '2020-01-01',
    CustomFields: [
      { CustomField: { ID: 62, Name: 'Location' }, Value: 'Level 1 Kitchen' },
      { CustomField: { ID: 61, Name: 'Asset #' }, Value: 'E-12' },
      { CustomField: { ID: 63, Name: 'Extinguisher Type' }, Value: 'ABE' },
    ],
  };
  const update = async (fields: { name: string; value: string; id?: number }[], startDate?: string) => {
    const site = await simproSite();
    const asset = await createAsset({ siteId: site.id, assetTypeId: 'extinguisher', name: 'Ext', externalId: '900', externalSource: 'simpro' });
    return queued(buildUpdate({ assetId: asset.id, assetExternalId: '900', fields, startDate, label: 'Ext' }, { now: NOW, changeNo: 1 }));
  };

  it('reads the record, resolves ids by name, and patches only what differs', async () => {
    const { item, change } = await update([
      { name: 'Location', value: 'Level 2 Kitchen' },
      { name: 'extinguisher type', value: 'ABE' },
      { name: 'Nonsense', value: 'x' },
    ], '2020-01-01');
    const { client, sent, reads } = fakeClient({ get: () => remote });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    expect(reads).toEqual([{ path: 'customerAssets/900', query: undefined }]);
    expect(sent).toEqual([{ method: 'PATCH', path: 'customerAssets/900', body: { CustomFields: [{ CustomField: 62, Value: 'Level 2 Kitchen' }] } }]);
    expect((await getAssetChange(change.id))?.sentAt).toBeDefined();
  });

  it('sends a changed start date on its own', async () => {
    const { item } = await update([], '2026-09-01');
    const { client, sent } = fakeClient({ get: () => remote });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    expect(sent).toEqual([{ method: 'PATCH', path: 'customerAssets/900', body: { StartDate: '2026-09-01' } }]);
  });

  it('is done when the office already holds every value', async () => {
    const { item, change } = await update([{ name: 'Location', value: 'Level 1 Kitchen' }]);
    const { client, sent } = fakeClient({ get: () => remote });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
    expect((await getAssetChange(change.id))?.sentAt).toBeDefined();
  });

  it('abandons a correction to an asset the office no longer has', async () => {
    const { item, change } = await update([{ name: 'Location', value: 'x' }]);
    const { client, sent } = fakeClient({ get: (path) => { throw notFound(path); } });
    expect(await sendAssetChange(item, deps(client), LATER)).toMatchObject({ status: 'abandon' });
    expect(sent).toEqual([]);
    expect((await getAssetChange(change.id))?.error).toMatch(/no longer has/);
  });

  it('lets any other refusal of the read through to the queue', async () => {
    const { item } = await update([{ name: 'Location', value: 'x' }]);
    const { client } = fakeClient({ get: (path) => { throw new SimproError(`HTTP 500 for ${path}`, 500, path); } });
    await expect(sendAssetChange(item, deps(client), LATER)).rejects.toThrow('HTTP 500');
  });
});

describe('archiving and deleting', () => {
  const ready = async (kind: 'archive' | 'delete') => {
    const site = await simproSite();
    const asset = await createAsset({ siteId: site.id, assetTypeId: 'hose-reel', name: 'Hose reel 3', externalId: '900', externalSource: 'simpro' });
    const input = { assetId: asset.id, assetExternalId: '900', previousStatus: 'in-service', label: 'Hose reel 3' };
    const built = kind === 'archive' ? buildArchive(input, { now: NOW, changeNo: 1 }) : buildDelete(input, { now: NOW, changeNo: 1 });
    return { asset, ...(await queued(built)) };
  };

  it('archives with the documented patch after reading the record', async () => {
    const { item, change } = await ready('archive');
    const { client, sent, reads } = fakeClient({ get: () => ({ ID: 900, Archived: false }) });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    expect(reads).toEqual([{ path: 'customerAssets/900', query: undefined }]);
    expect(sent).toEqual([{ method: 'PATCH', path: 'customerAssets/900', body: { Archived: true } }]);
    expect((await getAssetChange(change.id))?.sentAt).toBeDefined();
  });

  it('is done archiving one already archived, or gone', async () => {
    const { item } = await ready('archive');
    const archived = fakeClient({ get: () => ({ ID: 900, Archived: true }) });
    expect(await sendAssetChange(item, deps(archived.client), LATER)).toEqual({ status: 'done' });
    expect(archived.sent).toEqual([]);
    const gone = fakeClient({ get: (path) => { throw notFound(path); } });
    expect(await sendAssetChange(item, deps(gone.client), LATER)).toEqual({ status: 'done' });
    expect(gone.sent).toEqual([]);
  });

  it('deletes on the record path and then takes the phone\'s copy with it', async () => {
    const { asset, item, change } = await ready('delete');
    const { client, sent } = fakeClient({ get: () => ({ ID: 900, Archived: false }) });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'sent' });
    expect(sent).toEqual([{ method: 'DELETE', path: 'customerAssets/900', body: undefined }]);
    expect(await getAsset(asset.id)).toBeNull();
    expect((await getAssetChange(change.id))?.sentAt).toBeDefined();
  });

  it('is done deleting one the office no longer has, and still clears the phone', async () => {
    const { asset, item } = await ready('delete');
    const { client, sent } = fakeClient({ get: (path) => { throw notFound(path); } });
    expect(await sendAssetChange(item, deps(client), LATER)).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
    expect(await getAsset(asset.id)).toBeNull();
  });

  it('keeps the phone\'s copy when the delete is refused', async () => {
    const { asset, item, change } = await ready('delete');
    const { client } = fakeClient({
      get: () => ({ ID: 900 }),
      answer: (s) => { throw new SimproError(`Simpro returned HTTP 403 for ${s.path}.`, 403, s.path); },
    });
    await expect(sendAssetChange(item, deps(client), LATER)).rejects.toThrow('HTTP 403');
    expect(await getAsset(asset.id)).not.toBeNull();
    expect((await getAssetChange(change.id))?.error).toContain('HTTP 403');
  });
});
