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
 *   siteRef    — the office's own reference, written on the job sheet; read
 *                differently where the sync stamped it, see below
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
  'name', 'address', 'suburb', 'clientName',
] as const;

/**
 * Columns matched from the start, because they are numbers somebody reads out.
 *
 * The postcode is here and not above, and the difference matters: as a
 * substring, "46" matched a site in 4046 as readily as one in 4610, and
 * somebody typing two digits of a postcode means the area, not any number
 * containing it.
 */
export const SITE_SEARCH_PREFIX_COLUMNS = ['externalId', 'postcode'] as const;

/**
 * The office's reference, which is two different things in one column.
 *
 * On a site somebody typed in, siteRef is their own free text — "SB-014", a
 * job number, an asset number — and it is matched like any other text.
 *
 * On a site that came down from the office it is stamped
 * `SIMPRO:8812`, `register:3349`, `asset-register:3370`
 * (src/simpro/sync.ts, src/domain/siteNames.ts), which is nearly every site
 * on a synced phone. Matched as a substring, that made every digit a hunt
 * through three thousand ids: "81" found site 8812 and "34" found 3349,
 * defeating the prefix rule externalId exists for. The number after the colon
 * is therefore matched from the start, like the number it is.
 *
 * It is its own column rather than a flag on the two lists above because it is
 * the only one that needs reading before it can be matched.
 */
export const SITE_SEARCH_STAMPED_COLUMN = 'siteRef' as const;

export type SiteSearchColumn =
  | (typeof SITE_SEARCH_TEXT_COLUMNS)[number]
  | (typeof SITE_SEARCH_PREFIX_COLUMNS)[number]
  | typeof SITE_SEARCH_STAMPED_COLUMN;

/** Every column a site search looks at, for a client-side filter to read. */
export const SITE_SEARCH_COLUMNS: readonly SiteSearchColumn[] = [
  ...SITE_SEARCH_TEXT_COLUMNS, ...SITE_SEARCH_PREFIX_COLUMNS, SITE_SEARCH_STAMPED_COLUMN,
];

/**
 * The stamped-reference clause as SQL, for a caller that builds its own.
 *
 * Takes two binds in this order: the term for the after-the-colon prefix, and
 * the term wrapped in % for the free-text form. Both must already be escaped
 * for LIKE if the caller escapes anything else.
 */
export const STAMPED_REF_SQL = "(CASE WHEN siteRef LIKE '%:%' "
  + "THEN siteRef LIKE '%:' || ? || '%' ELSE 0 END "
  + "OR (siteRef NOT LIKE '%:%' AND siteRef LIKE ?))";

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

  const ref = `${q}${SITE_SEARCH_STAMPED_COLUMN}`;
  const parts = [
    ...SITE_SEARCH_TEXT_COLUMNS.map((c) => `${q}${c} LIKE ? ESCAPE '\\'`),
    ...SITE_SEARCH_PREFIX_COLUMNS.map((c) => `${q}${c} LIKE ? ESCAPE '\\'`),
    // A stamped reference matches from the colon: ':88' is the start of
    // ':8812' and is not inside ':1889'. A free-text one matches as text.
    `(${ref} LIKE '%:%' AND ${ref} LIKE '%:' || ? || '%' ESCAPE '\\')`,
    `(${ref} NOT LIKE '%:%' AND ${ref} LIKE ? ESCAPE '\\')`,
  ];
  return {
    where: `(${parts.join(' OR ')})`,
    args: [
      ...SITE_SEARCH_TEXT_COLUMNS.map(() => like),
      ...SITE_SEARCH_PREFIX_COLUMNS.map(() => prefix),
      escapeLike(trimmed),
      like,
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
  // The same colon rule as the SQL, so a picker filtering rows it holds
  // cannot disagree with the screen that fetched them.
  const ref = site[SITE_SEARCH_STAMPED_COLUMN];
  if (ref) {
    const text = String(ref);
    const colon = text.indexOf(':');
    if (colon >= 0
      ? text.slice(colon + 1).toLowerCase().startsWith(q)
      : text.toLowerCase().includes(q)) return true;
  }
  return false;
}
