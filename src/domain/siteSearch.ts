/**
 * What searching for a site matches, said once.
 *
 * Four searches in this app looked for a site and each matched a different set
 * of columns. The sites tab missed the office's own site number and the
 * postcode — the owner's complaint was that a number read out over the phone
 * found nothing — the map could not match a site reference, and the day
 * planner ignored the client and the reference that every other search covers.
 * None of that was decided; it is four people writing a LIKE clause on four
 * afternoons.
 *
 * The differences are the bug, so the columns live here and the searches use
 * them. A test asserts each one does.
 *
 * **Why these columns and no others.** Each is something a person standing on
 * site, or holding a phone to their ear, actually has:
 *
 *   name       — what the building is called, which is what they will try first
 *   address     and
 *   suburb     — where it is, which is what they have when they do not know
 *                what the office calls it
 *   postcode   — read off a work order or an email signature; four digits is
 *                also the fastest thing to type on a phone keypad
 *   clientName — "the Baldwin ones", which is how a portfolio is talked about
 *   siteRef    — the office's own reference, written on the job sheet
 *
 * **And why the office's Simpro number is matched differently.** externalId is
 * a bare number, so a substring match on it turns every search containing
 * digits into a hunt through three thousand ids — type "12" and you get every
 * site whose number has a 12 anywhere in it. Matched from the start instead:
 * somebody reading a number over the phone reads it from the start, and a
 * prefix is enough to find it while a substring is noise.
 *
 * Nothing here matches a contact's name, phone or email. Those are searchable
 * on the contact itself (see searchRepo's `contact` kind) and a site list that
 * matched them would return a site because of somebody who once worked there.
 */

/** Columns matched anywhere inside, which is how a person half-remembers a name. */
export const SITE_SEARCH_TEXT_COLUMNS = [
  'name', 'address', 'suburb', 'postcode', 'clientName', 'siteRef',
] as const;

/** Columns matched from the start, because they are numbers somebody reads out. */
export const SITE_SEARCH_PREFIX_COLUMNS = ['externalId'] as const;

export type SiteSearchColumn =
  | (typeof SITE_SEARCH_TEXT_COLUMNS)[number]
  | (typeof SITE_SEARCH_PREFIX_COLUMNS)[number];

/** Every column a site search looks at, for a client-side filter to read. */
export const SITE_SEARCH_COLUMNS: readonly SiteSearchColumn[] = [
  ...SITE_SEARCH_TEXT_COLUMNS, ...SITE_SEARCH_PREFIX_COLUMNS,
];

/** LIKE's own wildcards, escaped, so a site called "100%" is searchable. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The WHERE clause for a site search, and the values to bind to it.
 *
 * `alias` is the table alias the caller used — '' where there is none. The
 * clause is parenthesised, so a caller can AND it with their own conditions
 * without the OR chain swallowing them, which is the mistake this shape exists
 * to prevent.
 */
export function siteSearchClause(
  term: string,
  alias = '',
): { where: string; args: string[] } | undefined {
  const trimmed = term.trim();
  if (!trimmed) return undefined;

  const q = alias ? `${alias}.` : '';
  const like = `%${escapeLike(trimmed)}%`;
  const prefix = `${escapeLike(trimmed)}%`;

  const parts = [
    ...SITE_SEARCH_TEXT_COLUMNS.map((c) => `${q}${c} LIKE ? ESCAPE '\\'`),
    ...SITE_SEARCH_PREFIX_COLUMNS.map((c) => `${q}${c} LIKE ? ESCAPE '\\'`),
  ];
  return {
    where: `(${parts.join(' OR ')})`,
    args: [
      ...SITE_SEARCH_TEXT_COLUMNS.map(() => like),
      ...SITE_SEARCH_PREFIX_COLUMNS.map(() => prefix),
    ],
  };
}

/**
 * Whether a site in hand matches a typed term, for a list already in memory.
 *
 * The same columns and the same prefix rule as the SQL, so a picker filtering
 * rows it already holds cannot disagree with a screen that searched for them.
 */
export function siteMatches(
  site: Partial<Record<SiteSearchColumn, string | undefined | null>>,
  term: string,
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  for (const c of SITE_SEARCH_TEXT_COLUMNS) {
    const v = site[c];
    if (v && String(v).toLowerCase().includes(q)) return true;
  }
  for (const c of SITE_SEARCH_PREFIX_COLUMNS) {
    const v = site[c];
    if (v && String(v).toLowerCase().startsWith(q)) return true;
  }
  return false;
}
