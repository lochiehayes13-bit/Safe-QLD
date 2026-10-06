/**
 * What the app is allowed to say when a site search finds nothing.
 *
 * The owner typed "Maroochydore" into the Sites tab and got
 *
 *     Nothing matched
 *     Try a shorter search.
 *
 * then wrote back asking why a building he services was not there. Those four
 * words are the fault. They are advice for somebody who mistyped, they were
 * the only thing on the screen, and the search had in fact done nothing wrong
 * — siteFindable.test.ts runs the real SQL and finds a site called "Storage
 * Choice - Maroochydore" by that word in any casing, with or without an
 * address. A miss means the building is not on the phone, and the screen knew
 * several useful things about why and said none of them.
 *
 * The one that matters most is the one nobody can work out alone: Simpro's
 * site list does not return an archived site, so no amount of syncing brings
 * it down. A technician who is not told that will go on typing shorter and
 * shorter searches for a building they have stood inside.
 */
import {
  SITE_COLUMN_WORDS, siteFallbackWords, siteMissLine, siteNotHereNote, siteSearchMiss,
} from '@/domain/siteMiss';
import { SITE_SEARCH_COLUMNS } from '@/domain/siteSearch';
import type { SyncState } from '@/simpro/incremental';

const NOW = new Date('2026-10-06T09:00:00+10:00');

const SYNCED = (at: string): SyncState => ({
  resource: 'sites', lastSyncedAt: at, lastRecordCount: 3059, mode: 'incremental',
});

const MISS = (over: Partial<Parameters<typeof siteSearchMiss>[0]> = {}) => siteSearchMiss({
  term: 'Maroochydore',
  held: 3059,
  connected: true,
  sites: SYNCED('2026-10-06T06:00:00+10:00'),
  now: NOW,
  ...over,
});

describe('a search that found nothing on a phone that holds sites', () => {
  it('quotes back what was searched for, so there is no doubt what was asked', () => {
    expect(MISS().title).toContain('Maroochydore');
  });

  it('says how many sites it looked at, which is the first thing doubted', () => {
    expect(MISS().lines.join(' ')).toContain('3,059');
  });

  it('names every column the search actually covers', () => {
    /*
     * "Searched the name, the address and the suburb" is worse than saying
     * nothing if the postcode is searched too: somebody holding only a
     * postcode reads it and stops. So the sentence is built from the column
     * list rather than written beside it.
     */
    const said = MISS().lines.join(' ');
    for (const column of SITE_SEARCH_COLUMNS) {
      expect({ column, named: said.includes(SITE_COLUMN_WORDS[column]) })
        .toEqual({ column, named: true });
    }
  });

  it('every searched column has words of its own', () => {
    expect(Object.keys(SITE_COLUMN_WORDS).sort()).toEqual([...SITE_SEARCH_COLUMNS].sort());
  });

  it('says the office’s archived sites never come down, because nothing else can tell them', () => {
    // The cause a technician cannot deduce and a sync cannot fix. Without this
    // sentence the only remaining explanation on offer is "you typed it wrong".
    expect(MISS().lines.join(' ')).toMatch(/archive/i);
  });

  it('never tells somebody to type less, which is what it used to say', () => {
    expect(MISS().lines.join(' ')).not.toMatch(/shorter search/i);
  });

  it('says how old the site list is, in the same words the rest of the app uses', () => {
    expect(MISS({ sites: SYNCED('2026-09-10T06:00:00+10:00') }).lines.join(' '))
      .toMatch(/26 days ago/);
  });

  it('says so plainly where the office’s list has never come down at all', () => {
    expect(MISS({ sites: undefined }).lines.join(' ')).toMatch(/never come down/);
  });

  it('offers the two things that could change the answer', () => {
    const words = MISS();
    expect({ pull: words.offerPull, add: words.offerAdd }).toEqual({ pull: true, add: true });
  });
});

describe('a phone with no sites on it at all', () => {
  it('does not pretend the search was the problem', () => {
    const words = MISS({ held: 0, connected: false, sites: undefined });
    expect(words.title).toBe('No sites on this phone yet');
    expect(words.lines.join(' ')).toMatch(/nothing to search/i);
  });

  it('offers the connection rather than a sync, where there is no connection', () => {
    const words = MISS({ held: 0, connected: false, sites: undefined });
    expect({ connect: words.offerConnect, pull: words.offerPull })
      .toEqual({ connect: true, pull: false });
  });

  it('offers the sync where the connection is already set up', () => {
    const words = MISS({ held: 0, connected: true, sites: undefined });
    expect({ connect: words.offerConnect, pull: words.offerPull })
      .toEqual({ connect: false, pull: true });
  });
});

describe('the one-line form, for a picker inside a form', () => {
  it('still carries the archived sentence, because the screen is smaller and the fact is not', () => {
    expect(siteMissLine({
      term: 'Maroochydore', held: 3059, connected: true,
      sites: SYNCED('2026-10-06T06:00:00+10:00'), now: NOW,
    })).toMatch(/archive/i);
  });
});

/**
 * And the sentence about one named site the office says it has.
 *
 * The customer screen lists the office's sites for a customer and has to say
 * something about any it cannot find on this phone. It said "Not on this phone
 * yet — it comes with the next site sync", which for an archived site is false
 * and stays false however many times it is synced: that is the one case where
 * the answer is to ring the office rather than press a button, and the one the
 * empty-search words already exist to explain.
 */
describe('a named site the phone does not hold', () => {
  it('does not promise a sync that will not bring it', () => {
    expect(siteNotHereNote()).not.toMatch(/next site sync|comes with/i);
  });

  it('says the thing a technician cannot work out alone', () => {
    expect(siteNotHereNote()).toContain('archived');
    expect(siteNotHereNote()).toMatch(/never comes down with the site list/);
  });

  it('is the same words the empty search uses, not a second sentence about one fact', () => {
    // Two sentences about one fact drift apart, and this app's recurring bug
    // is exactly that. The archived note is shared.
    const miss = siteSearchMiss({ term: 'Maroochydore', held: 900, connected: true, now: new Date('2026-10-06T00:00:00Z') });
    const note = siteNotHereNote();
    const shared = miss.lines.find((l) => l.includes('archived'));
    expect(shared).toBeTruthy();
    expect(note).toContain(shared!);
  });

  it('leads with where the site is not, because that is the news', () => {
    expect(siteNotHereNote().startsWith('Not on this phone.')).toBe(true);
  });
});
