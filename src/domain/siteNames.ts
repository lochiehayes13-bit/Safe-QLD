/**
 * Telling two sites with the same name apart.
 *
 * The register keys sites on the id the office system gave them, which is
 * right — it is the only stable identity, and matching on name would merge
 * genuinely separate buildings. But three of Safe QLD's sites are called
 * "Storage Choice - Sumner Park", three are "Luggage Direct" and two are
 * "Brisbane Rheumatology", and the register carries no address for any of
 * them. So the list shows identical rows, and a technician picking the wrong
 * one records a service against the wrong building.
 *
 * There is nothing to invent here. The app already holds the distinguishing
 * fact — the source system's own site id, kept as `siteRef` when the register
 * was imported — and simply never showed it. This decides where showing it
 * helps.
 *
 * Only where the name is ambiguous. A reference against every site would be
 * noise on 889 of 897 rows, and the one place it matters would be lost in it.
 */

export interface NamedSite {
  id: string;
  name: string;
  /** "register:3349" where the site came from an asset register import. */
  siteRef?: string;
  address?: string;
  suburb?: string;
}

/** Names shared by more than one site, lowercased and trimmed for comparison. */
export function ambiguousNames(sites: readonly NamedSite[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of sites) {
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * The source reference with its prefix stripped, for showing to a person.
 *
 * `register:3349` is stored with the prefix so two systems cannot collide, but
 * "3349" is what the office says on the phone.
 */
export function readableRef(siteRef: string | undefined): string | undefined {
  if (!siteRef?.trim()) return undefined;
  const colon = siteRef.indexOf(':');
  const tail = colon >= 0 ? siteRef.slice(colon + 1) : siteRef;
  return tail.trim() || undefined;
}

/**
 * What to show beside a site's name so it can be told from its namesakes.
 *
 * Returns nothing where the name is already unique, and nothing where there is
 * no distinguishing fact to offer — a label reading "site 2 of 3" would order
 * by nothing a technician can see and change as sites are added.
 *
 * The address is preferred where there is one, because a technician knows the
 * building by where it is. The source reference is the fallback, and it is the
 * one that actually applies here: the register carries no address for any of
 * the duplicated names.
 */
export function disambiguator(
  site: NamedSite,
  ambiguous: ReadonlySet<string>,
): string | undefined {
  if (!ambiguous.has(site.name.trim().toLowerCase())) return undefined;

  const where = [site.address, site.suburb].map((p) => p?.trim()).filter(Boolean).join(', ');
  if (where) return where;

  const ref = readableRef(site.siteRef);
  return ref ? `Site ${ref} in the office system` : undefined;
}

/**
 * Sites that cannot be told apart at all, for a screen that wants to say so.
 *
 * A name shared by several sites where none of them has an address or a source
 * reference is the case nothing here can fix, and it is worth naming rather
 * than leaving a technician to discover it by opening all three.
 */
export function indistinguishable(sites: readonly NamedSite[]): NamedSite[] {
  const ambiguous = ambiguousNames(sites);
  return sites.filter((s) => ambiguous.has(s.name.trim().toLowerCase())
    && !disambiguator(s, ambiguous));
}

// ---------------------------------------------------------------------------
// Matching an incoming site to one already held
// ---------------------------------------------------------------------------

export interface SiteMatch<T> {
  /** The site this one is, where that can be established. */
  match?: T;
  /**
   * The sites a name matched, where it matched more than one.
   *
   * Present only when no match was made. It is what a caller says out loud:
   * "three sites are called this, so the incoming one was added separately."
   */
  ambiguous?: T[];
}

/**
 * The site an incoming record belongs to: by reference, then by an unambiguous
 * name, and never by a name that identifies more than one building.
 *
 * Two importers do this — the asset register and the Simpro sync — and both
 * fell back to matching on name whenever the reference did not hit. That
 * fallback is necessary: a site created by hand on a phone has no reference to
 * match on, and without it every import makes a second copy of the building.
 *
 * But it was matching on names that are not identities. In Safe QLD's own
 * register three names cover eight separate buildings — three "Luggage
 * Direct", three "Storage Choice - Sumner Park", two "Brisbane
 * Rheumatology" — and a name lookup returns whichever of them comes first.
 * So all three Luggage Directs collapse onto one local site, and the assets,
 * jobs and service history of three different buildings merge into it.
 * Silently, because a match is the quiet path.
 *
 * The two importers also write different references for the same site —
 * `asset-register:3370` and `SIMPRO:3370` — so a site imported from the
 * register never matches the sync by reference, and every sync falls through to
 * the name. The ambiguity is not a one-off: it recurs on every sync, for as
 * long as the site is on the books.
 *
 * Refusing the ambiguous match creates a second site instead. That is a worse
 * answer in the abstract and a much better one here: a duplicate is visible, it
 * is already reported by `indistinguishable` above, and it can be merged by
 * hand. Two buildings folded into one cannot be taken apart afterwards —
 * nothing records which service belonged to which.
 */
export function matchSiteByRefOrName<T extends NamedSite>(
  existing: readonly T[],
  ref: string | undefined,
  name: string,
): SiteMatch<T> {
  if (ref) {
    const byRef = existing.find((s) => s.siteRef === ref);
    if (byRef) return { match: byRef };
  }

  const wanted = name.trim().toLowerCase();
  // A blank name is not an identity either. Matching on it would join every
  // unnamed site into one.
  if (!wanted) return {};

  const byName = existing.filter((s) => s.name.trim().toLowerCase() === wanted);
  if (byName.length === 1) return { match: byName[0] };
  if (byName.length > 1) return { ambiguous: byName };
  return {};
}
