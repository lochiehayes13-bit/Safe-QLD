/**
 * Which customer a site belongs to, worked out from the office's records.
 *
 * The site row the sync writes carries a client name and nothing else about
 * the customer — no Simpro customer number, so nothing a screen could open.
 * The number is on every job and every quote the office has raised at the
 * site, so it is read off those: the most recently changed record first,
 * because a site that has changed hands is filed under whoever the office is
 * billing now, and the previous owner's jobs are still there underneath.
 *
 * Pure. The site screen hands it what it already read for its counts.
 */

export interface SiteCustomer {
  /** Simpro's customer number, the key /customer/[id] opens. */
  externalId: string;
  name?: string;
}

export interface CustomerBearing {
  customerExternalId?: string;
  customerName?: string;
  /** Simpro's DateModified, an instant. Records without one sort after those with. */
  dateModified?: string;
}

/**
 * The distinct customers across a site's jobs and quotes, most recently
 * changed first. A record with no customer number says nothing and is
 * skipped; a name is taken from whichever of a customer's records has one,
 * because the list-level row and the detail row do not always both carry it.
 */
export function siteCustomers(...lists: readonly (readonly CustomerBearing[])[]): SiteCustomer[] {
  const stamped = lists
    .flat()
    .filter((r) => !!r.customerExternalId)
    .map((r, i) => ({ r, i, ms: r.dateModified ? Date.parse(r.dateModified) : NaN }));

  stamped.sort((a, b) => {
    const aStamped = Number.isFinite(a.ms);
    const bStamped = Number.isFinite(b.ms);
    if (aStamped && bStamped && a.ms !== b.ms) return b.ms - a.ms;
    if (aStamped !== bStamped) return aStamped ? -1 : 1;
    // Neither stamped, or stamped alike: the order they were handed over,
    // which the repository already has newest first.
    return a.i - b.i;
  });

  const order: string[] = [];
  const names = new Map<string, string | undefined>();
  for (const { r } of stamped) {
    const id = r.customerExternalId!;
    if (!names.has(id)) {
      order.push(id);
      names.set(id, undefined);
    }
    const name = r.customerName?.trim();
    if (name && !names.get(id)) names.set(id, name);
  }
  return order.map((externalId) => ({ externalId, name: names.get(externalId) }));
}
