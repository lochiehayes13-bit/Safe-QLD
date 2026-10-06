import { describeStaleness, type SyncState } from '@/simpro/incremental';
import type { SiteSearchColumn } from '@/domain/siteSearch';

/**
 * What to say when a site search finds nothing.
 *
 * The owner typed "Maroochydore" into the Sites tab, got
 *
 *     Nothing matched
 *     Try a shorter search.
 *
 * and wrote back asking why a building he services was not there. That empty
 * state is the fault. "Try a shorter search" is advice for somebody who
 * mistyped, and it is the only thing the screen said — so a technician has no
 * way to tell a typo from a site that never came down from the office, and the
 * screen quietly implies the first.
 *
 * The search itself is sound: the real SQL finds a site called "Storage Choice
 * - Maroochydore" by that word, in any casing, with or without surrounding
 * spaces, whether it carries an address or not, and whether it came from the
 * office or was typed in here (src/__tests__/siteFindable.test.ts runs it
 * against a database). So a miss means one of a small number of things, and
 * every one of them is worth saying out loud:
 *
 *   - the phone holds no sites at all, which is a connection problem and not a
 *     search problem;
 *   - the site list is old, and the building was added to the office's books
 *     after it last came down;
 *   - the office has archived the site. Simpro's site list does not return an
 *     archived site, so no amount of syncing brings it down — this is the one
 *     a technician can never work out on their own, and the one that costs the
 *     whole afternoon;
 *   - the word genuinely is not on any of them.
 *
 * Which of those it is cannot always be settled on the phone. What can be done
 * is to stop pretending, say what was searched and over how many, say how old
 * the list is, and offer the two things that could actually change the answer.
 *
 * Pure, and shared, because "every site appears in every module" is a promise
 * about every screen that searches for one — and a promise kept in four places
 * and broken in the fifth is not kept.
 */

export interface SiteMissWords {
  title: string;
  /** Said in order. Each stands on its own, because people read the first and stop. */
  lines: string[];
  /** Worth offering a full re-read of the office's site list. */
  offerPull: boolean;
  /** Worth offering to type the building in here. */
  offerAdd: boolean;
  /** Worth offering to set the office connection up. */
  offerConnect: boolean;
}

export interface SiteMissInput {
  /** What was typed. Quoted back, so there is no doubt what was searched for. */
  term: string;
  /** Sites on this phone, all of them, not the page that was drawn. */
  held: number;
  /** Whether the office connection has been set up here at all. */
  connected: boolean;
  /** The site list's own sync record. Absent where nothing has ever come down. */
  sites?: SyncState;
  now: Date;
}

/**
 * Every column a site search looks at, in the words a person uses for it.
 *
 * Keyed by the column so a test can hold this to covering all of them. The
 * sentence "searched the name, the address and the suburb" is worse than no
 * sentence if the postcode is searched too and went unmentioned: somebody who
 * has only the postcode reads it and stops.
 */
export const SITE_COLUMN_WORDS: Record<SiteSearchColumn, string> = {
  name: 'the name',
  address: 'the address',
  suburb: 'the suburb',
  postcode: 'the postcode',
  clientName: 'the client',
  siteRef: 'the office’s reference',
  externalId: 'the office’s site number',
};

/** In the order a person would try them, which is not the order they are stored. */
const SEARCH_ORDER: readonly SiteSearchColumn[] = [
  'name', 'address', 'suburb', 'postcode', 'clientName', 'siteRef', 'externalId',
];

const SEARCHED = SEARCH_ORDER.map((c) => SITE_COLUMN_WORDS[c])
  .reduce((all, word, i) => (i === 0 ? word : i === SEARCH_ORDER.length - 1 ? `${all} and ${word}` : `${all}, ${word}`), '');

/**
 * The sentence that would have answered the owner's question.
 *
 * Deliberately specific about archiving. It is the only cause on the list that
 * a sync cannot fix, and the only one where the right next step is to ring the
 * office rather than to press a button.
 */
const ARCHIVED_NOTE = 'A site the office has archived never comes down with the site list, '
  + 'however many times it is synced — if the office has it and this does not, that is usually why.';

export function siteSearchMiss(input: SiteMissInput): SiteMissWords {
  const term = input.term.trim();
  const quoted = term ? `“${term}”` : 'that';

  if (!input.connected && input.held === 0) {
    return {
      title: 'No sites on this phone yet',
      lines: [
        'Nothing has come down from the office, so there is nothing to search.',
        'Connect this device once in Settings and the whole book arrives — on a phone, in a browser, wherever this is open.',
      ],
      offerPull: false,
      offerAdd: true,
      offerConnect: true,
    };
  }

  if (input.held === 0) {
    return {
      title: 'No sites on this phone yet',
      lines: [
        'This device knows how to reach the office but is not holding any sites.',
        'Pull the site list, or add the building by hand — both work with no signal.',
      ],
      offerPull: true,
      offerAdd: true,
      offerConnect: false,
    };
  }

  const lines = [
    `Searched ${SEARCHED} on all ${input.held.toLocaleString()} sites on this phone.`,
  ];

  /*
   * How old the list is, said in the same words the rest of the app uses for
   * staleness rather than a second vocabulary for the same fact. Where it has
   * never come down at all, that is the more useful sentence.
   */
  const age = input.sites ? describeStaleness(input.sites, input.now) : undefined;
  if (!age || age.state === 'never') {
    lines.push('The office’s site list has never come down onto this device, so what is here was typed in.');
  } else {
    lines.push(`The site list ${age.label.charAt(0).toLowerCase()}${age.label.slice(1)}`);
  }

  lines.push(ARCHIVED_NOTE);

  return {
    title: `Nothing matched ${quoted}`,
    lines,
    offerPull: true,
    offerAdd: true,
    offerConnect: false,
  };
}

/**
 * The same words as one block of text, for a screen with nowhere to put a list.
 *
 * A picker inside a form has a line and a half, not an empty state with
 * buttons under it. It still has to say the true thing.
 */
export function siteMissLine(input: SiteMissInput): string {
  const words = siteSearchMiss(input);
  return words.lines.join(' ');
}

/**
 * What to say when the module has nothing but the building is on the phone.
 *
 * The other half of "every site appears in every module". A technician types a
 * building into the job list, the quote list or the invoice list, the module
 * has no row for it, and the module answers "Nothing matches" — which a person
 * reads as "that site is not on this phone". It is: the same words find it on
 * the sites tab, and the module they are standing in offered no way through.
 *
 * A site with nothing attached is the ordinary case, not an error. The office
 * has not raised work against it yet, or every job it had is closed and
 * purged, and the technician standing at it still wants its register, its
 * history and its documents. So the module says what it has none of, and then
 * offers the building.
 *
 * Shared, and the module's own word for its rows is the only thing that
 * varies, because this sentence being written separately on each screen is how
 * four modules came to disagree about what searching for a site means.
 *
 * `what` is that word in the plural — "jobs", "quotes", "invoices" — because
 * both sentences read as plurals and a singular one puts "No job match that"
 * on the screen.
 */
export function siteFallbackWords(count: number, what: string): { title: string; body: string } {
  return {
    title: `No ${what} match that`,
    body: `No ${what} on this phone match those words. ${count === 1
      ? 'The site below does — open it for its register, its history and its documents.'
      : 'The sites below do — open one for its register, its history and its documents.'}`,
  };
}
