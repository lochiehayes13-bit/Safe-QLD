import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DESTINATIONS } from '@/domain/appMode';
import { contextId, missingContext } from '@/domain/screenContext';

/**
 * A screen that is about one record has to cope with not being given one.
 *
 * Twelve screens in this app read a site out of a route parameter, and every
 * one of them is in the manifest by name — so search opens them bare, and so
 * does a link saved before the site was deleted. What they did then was worse
 * than a blank page: `/site/due` returned out of its loader before clearing the
 * loading flag and sat on a bare header with a spinner that never stopped, and
 * the rest ran the query with no site, got nothing back, and printed the empty
 * state they were written for — "Nothing outstanding here", about a site nobody
 * had named.
 *
 * These tests hold both halves: the wording, and the fact that every screen
 * that needs a record actually uses it.
 */

const REPO = join(__dirname, '..', '..');

describe('the words for a screen with no record', () => {
  it('asks which one rather than reporting a failure', () => {
    // Nothing has gone wrong and nothing is lost, so it must not read as an
    // error — a technician who thinks the app broke stops using the screen.
    const site = missingContext('site', 'what is due');
    expect(site.title).toBe('Which site?');
    expect(site.body).toContain('what is due');
    expect(site.body).toMatch(/nothing has failed/i);
  });

  it('offers the screen that picks one', () => {
    // The dead end this replaces said "No site" with nothing to press.
    expect(missingContext('site', 'x').actionRoute).toBe('/sites');
    expect(missingContext('asset', 'x').actionRoute).toBe('/assets/find');
  });

  it('names routes that exist in the router', () => {
    for (const kind of ['site', 'asset'] as const) {
      const route = missingContext(kind, 'x').actionRoute;
      const file = join(REPO, 'app', `${route.replace(/^\//, '')}.tsx`);
      const tab = join(REPO, 'app', '(tabs)', `${route.replace(/^\//, '')}.tsx`);
      expect(existsSync(file) || existsSync(tab)).toBe(true);
    }
  });
});

describe('reading a record id off the route', () => {
  it('treats an empty parameter as no parameter', () => {
    /*
     * This is the case that matters. Several screens push
     * `params: { siteId: siteId ?? '' }`, so "no site" arrives as an empty
     * string — which is truthy enough for `params.siteId !== undefined` and
     * false enough to query for the site named "". Both readings were in the
     * app at once.
     */
    expect(contextId('')).toBeUndefined();
    expect(contextId('   ')).toBeUndefined();
    expect(contextId(undefined)).toBeUndefined();
    expect(contextId('site-1')).toBe('site-1');
  });

  it('takes the first when the router hands back a repeated parameter', () => {
    expect(contextId(['site-1', 'site-2'])).toBe('site-1');
    expect(contextId([])).toBeUndefined();
  });
});

describe('every screen that needs a record', () => {
  /**
   * The screens that take their record from a query parameter rather than from
   * a path segment. A `[id]` route cannot be reached without its segment, so
   * RecordGate covers those; these are the ones the router will happily open
   * empty.
   */
  const needsParam = DESTINATIONS.filter((d) => d.needsContext && !d.route.includes('[id]'));

  it('found the screens it meant to check', () => {
    expect(needsParam.length).toBeGreaterThan(8);
  });

  it('says which record it needs and offers a way to pick one', () => {
    /*
     * Two exemptions, both real answers rather than gaps.
     *
     * `/assets/new` needs a site and asks for one on the screen itself — it
     * lists every site in a picker and refuses to save until one is chosen,
     * which is a better answer here than sending somebody away.
     *
     * `/site/assets` is the one screen still without an answer: opened with no
     * site it says "No assets recorded", which is a statement about a site
     * nobody named. It is left out here because it is being changed elsewhere
     * at the time of writing, and it is written down rather than quietly
     * skipped so that the gap is visible.
     */
    const answersItsOwnWay = new Set(['app/assets/new.tsx']);
    const missing = needsParam
      .filter((d) => !answersItsOwnWay.has(d.file))
      .filter((d) => !readFileSync(join(REPO, d.file), 'utf8').includes('<ContextGate'))
      .map((d) => d.file);
    expect(missing).toEqual([]);
  });

  it('reads the parameter through contextId, so an empty one is not a record', () => {
    const raw = needsParam
      .filter((d) => d.file !== 'app/assets/new.tsx')
      .filter((d) => !readFileSync(join(REPO, d.file), 'utf8').includes('contextId('))
      .map((d) => d.file);
    expect(raw).toEqual([]);
  });
});
