/**
 * A building the office has archived is still findable.
 *
 * This is the gap behind the owner's "why the fuck is Storage Choice
 * Maroochydore not in this". Simpro's `sites/` list returns current sites; an
 * archived one is simply absent. The sync read that list, wrote what came
 * back, and nothing anywhere recorded that a whole class of buildings was
 * never offered. This repository already knew it in one comment, about one
 * building — the note on describeMissingSites exists because an archived
 * site's fifteen assets came down with nowhere to live — and concluded that
 * "nothing about pulling again changes that". Pulling again does not. Asking
 * for them does.
 *
 * Two halves, and the second is the one that is easy to get wrong. Having
 * finally got the archived sites onto the phone, nothing may then filter them
 * back out: an archived building's logbook is the record of work that
 * happened, its assets are still in the wall, and a technician sent there has
 * to be able to find it. It is marked, never hidden — a search that silently
 * drops rows is the exact fault this is fixing.
 */
import { createSite, getSite, listSitePicks, listSiteSummaries, listSites, updateSite } from '@/db/repo';
import { searchKind } from '@/db/searchRepo';
import { parseQuery } from '@/domain/search';
import { siteIsArchived } from '@/domain/siteNames';
import { siteMatches } from '@/domain/siteSearch';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

const ARCHIVED = {
  id: 'arch',
  name: 'Storage Choice - Maroochydore',
  suburb: 'Maroochydore',
  postcode: '4558',
  clientName: 'Storage Choice',
  siteRef: 'SIMPRO:4471',
  externalId: '4471',
  externalSource: 'simpro',
  archived: true,
};

const LIVE = {
  id: 'live',
  name: 'Storage Choice - Sumner Park',
  suburb: 'Sumner Park',
  siteRef: 'SIMPRO:3349',
  externalId: '3349',
  externalSource: 'simpro',
  archived: false,
};

/** Typed in on a phone: nobody has ever asked the office about this one. */
const UNASKED = { id: 'hand', name: 'Kingaroy Fire Station', suburb: 'Kingaroy' };

beforeEach(async () => {
  db = openMigrated();
  await createSite(ARCHIVED);
  await createSite(LIVE);
  await createSite(UNASKED);
});

afterEach(async () => { await db.closeAsync(); });

describe('the three states, which are not two', () => {
  it('reads an archived site as archived', async () => {
    expect(siteIsArchived((await getSite(ARCHIVED.id))!)).toBe(true);
  });

  it('reads a live site as not archived', async () => {
    expect(siteIsArchived((await getSite(LIVE.id))!)).toBe(false);
  });

  it('leaves a site nobody has asked about unanswered rather than calling it live', async () => {
    // Absent is its own state. A site typed in on a phone has never been in
    // the office's list at all, and printing "live" over that would be the app
    // inventing a fact about the office's records.
    const site = await getSite(UNASKED.id);
    expect(site?.archived ?? null).toBeNull();
    expect(siteIsArchived(site!)).toBe(false);
  });

  it('is stored as a number, which is why nothing may compare it to true', async () => {
    /*
     * SQLite has no boolean. The row type says `archived?: boolean` and the
     * value that comes back is 1, so `site.archived === true` is false on an
     * archived site — a mistake that reads correctly and ships. siteIsArchived
     * exists for that reason and this is the assertion that keeps it honest.
     */
    const row = await db.getFirstAsync<{ archived: unknown }>(
      'SELECT archived FROM site WHERE id = ?', ARCHIVED.id,
    );
    expect(row?.archived).toBe(1);
    expect((await getSite(ARCHIVED.id))!.archived === true).toBe(false);
  });

  it('comes back off the archive when the office un-archives it', async () => {
    await updateSite(ARCHIVED.id, { archived: false });
    expect(siteIsArchived((await getSite(ARCHIVED.id))!)).toBe(false);
  });

  it('is left alone by a patch that does not mention it', async () => {
    // A sync that could not read the archived list must not write "live" over
    // a site it learned nothing about.
    await updateSite(ARCHIVED.id, { suburb: 'Maroochydore' });
    expect(siteIsArchived((await getSite(ARCHIVED.id))!)).toBe(true);
  });
});

describe('every way of finding a site finds an archived one', () => {
  it('the site list', async () => {
    expect((await listSites()).map((s) => s.id)).toContain(ARCHIVED.id);
  });

  it('the picker list, and it carries the flag so the picker can say so', async () => {
    const pick = (await listSitePicks()).find((s) => s.id === ARCHIVED.id);
    expect(pick).toBeTruthy();
    expect(siteIsArchived(pick!)).toBe(true);
  });

  it('the sites tab, searching the word the owner typed', async () => {
    const page = await listSiteSummaries({ query: 'Maroochydore' });
    expect(page.rows.map((r) => r.id)).toContain(ARCHIVED.id);
  });

  it('the sites tab with nothing typed, counted in the total like any other site', async () => {
    const page = await listSiteSummaries();
    expect(page.rows.map((r) => r.id)).toContain(ARCHIVED.id);
    expect(page.total).toBe(3);
  });

  it('the global search', async () => {
    const hits = await searchKind('site', parseQuery('Maroochydore'), 20);
    expect(hits.map((h) => h.id)).toContain(ARCHIVED.id);
  });

  it('the in-memory filter a picker uses on rows it already holds', () => {
    expect(siteMatches(ARCHIVED, 'Maroochydore')).toBe(true);
  });

  it('the office’s own site number, read out over the phone', async () => {
    const page = await listSiteSummaries({ query: '4471' });
    expect(page.rows.map((r) => r.id)).toContain(ARCHIVED.id);
  });
});
