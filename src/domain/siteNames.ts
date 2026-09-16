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
/** The importer a reference came from: "SIMPRO:3370" is from SIMPRO. */
function refSource(ref: string): string {
  const colon = ref.indexOf(':');
  return (colon >= 0 ? ref.slice(0, colon) : ref).trim().toLowerCase();
}

/**
 * The site list arranged for repeated lookups.
 *
 * `matchSiteByRefOrName` answers one question by walking the whole list — a
 * `find` for the reference and a `filter` for the name, each lowercasing every
 * site it passes. That is the right shape for the asset register, which asks
 * once. It is the wrong shape for the Simpro sync, which asks once per
 * incoming site: at the 3,112 sites this company holds, a full pull walked the
 * list 3,112 times and built about nineteen million throwaway strings doing it.
 *
 * Measured rather than assumed, because the assumption was wrong and worth
 * writing down: at that size the walking costs 57 ms and the index 3.4 ms — 17
 * times faster and about fifty milliseconds saved. Some multiple of that on a
 * handset's slower engine, and still nowhere near the minutes a full sync
 * takes. It is not the reason syncing was slow; the reason was that every
 * press re-read the company at all (see `readsEverything` in
 * `@/simpro/incremental`). This is a wasteful shape removed on the way past,
 * not a fix, and claiming otherwise would send the next person hunting in the
 * wrong place.
 *
 * The rules are not relaxed by an inch — `matchSiteInIndex` below is the same
 * three decisions in the same order, and `matchSiteByRefOrName` is now written
 * in terms of it so the two cannot drift apart.
 */
export interface SiteIndex<T> {
  /** Reference to the first site carrying it, matching `find`'s first-wins. */
  byRef: Map<string, T>;
  /** Trimmed, lowercased name to every site called that, in list order. */
  byName: Map<string, T[]>;
}

export function indexSites<T extends NamedSite>(existing: readonly T[]): SiteIndex<T> {
  const byRef = new Map<string, T>();
  const byName = new Map<string, T[]>();
  for (const site of existing) {
    // First wins, because `find` returned the first and a later duplicate
    // reference must not quietly become the one incoming records attach to.
    if (site.siteRef && !byRef.has(site.siteRef)) byRef.set(site.siteRef, site);
    const key = site.name.trim().toLowerCase();
    // A blank name is not an identity, so it is not indexed. Nothing is lost:
    // a blank can never equal the non-empty name being looked up.
    if (!key) continue;
    const namesakes = byName.get(key);
    if (namesakes) namesakes.push(site);
    else byName.set(key, [site]);
  }
  return { byRef, byName };
}

/**
 * Adds a site to an index in place, as pushing it onto the list would.
 *
 * The sync creates sites as it walks the incoming list and relies on the ones
 * it just made being matchable by the records still to come — two Simpro sites
 * sharing a name arrive one after the other, and the second has to see the
 * first. An index built once and never added to would miss them and make a
 * duplicate of every site created in the same run.
 */
export function addToIndex<T extends NamedSite>(index: SiteIndex<T>, site: T): void {
  if (site.siteRef && !index.byRef.has(site.siteRef)) index.byRef.set(site.siteRef, site);
  const key = site.name.trim().toLowerCase();
  if (!key) return;
  const namesakes = index.byName.get(key);
  if (namesakes) namesakes.push(site);
  else index.byName.set(key, [site]);
}

/** The same match as below, against a list already indexed. */
export function matchSiteInIndex<T extends NamedSite>(
  index: SiteIndex<T>,
  ref: string | undefined,
  name: string,
): SiteMatch<T> {
  if (ref) {
    const byRef = index.byRef.get(ref);
    if (byRef) return { match: byRef };
  }

  const wanted = name.trim().toLowerCase();
  // A blank name is not an identity either. Matching on it would join every
  // unnamed site into one.
  if (!wanted) return {};

  const namesakes = index.byName.get(wanted);
  if (!namesakes) return {};

  /*
   * A namesake that already carries a different reference from the same
   * source is a different building, and the name must not join them. Three
   * Luggage Directs arriving from the sync one after another: the first has
   * no namesake and is created; the second finds exactly one site by name, but
   * that site is SIMPRO:3370 and this one is SIMPRO:3371, and the office does
   * not give one building two numbers. A site with no reference, or one from
   * the other importer, is still a candidate — that is the case the fallback
   * exists for.
   */
  const source = ref ? refSource(ref) : undefined;
  const byName = source
    ? namesakes.filter((s) => !(s.siteRef && s.siteRef !== ref && refSource(s.siteRef) === source))
    : namesakes;
  if (byName.length === 1) return { match: byName[0] };
  // Copied, so a caller reading the ambiguous list cannot reach into the index.
  if (byName.length > 1) return { ambiguous: [...byName] };
  return {};
}

export function matchSiteByRefOrName<T extends NamedSite>(
  existing: readonly T[],
  ref: string | undefined,
  name: string,
): SiteMatch<T> {
  return matchSiteInIndex(indexSites(existing), ref, name);
}
