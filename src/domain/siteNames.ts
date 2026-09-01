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
