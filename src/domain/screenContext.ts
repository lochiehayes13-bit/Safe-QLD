/**
 * A screen opened without the record it is about.
 *
 * A dozen screens in this app are written about one site — what is due there,
 * what was not tested there, the parts its open defects need — and they learn
 * which site from a parameter the screen before them passed. Reached the way
 * they are meant to be reached, from a site, that parameter is always there.
 * Reached any other way it is not: search finds the screen by name and opens it
 * bare, a hub row does the same, and a deep link saved a fortnight ago points
 * at a site this handset no longer holds.
 *
 * What those screens did with no parameter was the worst available answer.
 * `/site/due` returned out of its loader before clearing the loading flag and
 * sat on a bare header for ever. The rest ran their query with `siteId`
 * undefined, got nothing back, and printed the empty state they were written
 * for: "No assets recorded", "Nothing outstanding here". Both of those are
 * statements about a site, made when no site was named — the first is a dead
 * page and the second is a lie, and the lie is worse, because a technician
 * believes it.
 *
 * So a screen that needs a record and was not given one says which record it
 * needs and offers the screen that picks one. That is all this module is: the
 * words and the way out, kept pure so they can be tested and kept in one place
 * so twelve screens cannot each invent their own.
 */

/** The kinds of record a screen in this app can be opened *about*. */
export type ContextKind = 'site' | 'asset';

export interface MissingContext {
  /** The heading, phrased as the question the screen cannot answer. */
  title: string;
  /** Why the screen is empty, and what would have filled it. */
  body: string;
  /** The button that leads to the screen where one is chosen. */
  actionLabel: string;
  /** Where that button goes. A real route under `app/`. */
  actionRoute: string;
}

/** Where each kind of record is chosen. Both are tab-level screens, so neither is a dead end. */
const PICKER: Record<ContextKind, { route: string; label: string }> = {
  site: { route: '/sites', label: 'Choose a site' },
  asset: { route: '/assets/find', label: 'Find an asset' },
};

/**
 * What to show on a screen that needs `kind` and was opened without it.
 *
 * `what` is what the screen would have shown, in a technician's words — "what
 * is due", "the parts these defects need". It goes in the body rather than the
 * title because the title has to be the same shape every time: the screen is
 * not broken and nothing has been lost, it simply does not know which record
 * it is about, and that reads better as a question than as an error.
 */
export function missingContext(kind: ContextKind, what: string): MissingContext {
  const picker = PICKER[kind];
  const subject = kind === 'site' ? 'a site' : 'an asset';
  return {
    title: kind === 'site' ? 'Which site?' : 'Which asset?',
    body:
      `This screen shows ${what} for one ${kind}, and it was opened without one — which happens `
      + `when it is reached from search or from a link rather than from the ${kind} itself. `
      + `Nothing is missing and nothing has failed: it simply has no ${kind} to report on yet.`,
    actionLabel: picker.label,
    actionRoute: picker.route,
  };
}

/**
 * Whether a parameter that arrived from the router counts as a record id.
 *
 * expo-router hands back a string, an array of strings when a parameter is
 * repeated in the query, or undefined. An empty string is the one worth calling
 * out: several screens push `siteId: siteId ?? ''` so the parameter is always
 * present, which means the receiving screen gets `''` and a naive `if (!siteId)`
 * is the only thing standing between it and a query for the site named "".
 */
export function contextId(param: string | string[] | undefined): string | undefined {
  const value = Array.isArray(param) ? param[0] : param;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
