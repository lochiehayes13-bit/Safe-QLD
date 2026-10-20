/**
 * The address as the geocoder sees it and the cache is keyed by.
 *
 * Pure, and in its own file so it can be tested without the geocoder or the
 * database behind `geocode.ts`.
 */

export interface AddressParts {
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}

/** Trimmed, lower-cased, inner whitespace collapsed to one space. */
function clean(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * "12 smith st, springfield qld 4300, australia", or empty.
 *
 * Empty when there is no street line. A suburb on its own would geocode to the
 * middle of the suburb, and a dot in the middle of a suburb looks exactly like
 * a dot on a building — a technician would drive to it. Better that the site
 * is counted as unlocated and stays off the map.
 *
 * Normalised so the same address typed twice by two people is one cache row
 * and one geocoder call. The country is always appended: without it a street
 * name that exists in three countries is the geocoder's guess.
 */
export function siteAddressKey(site: AddressParts): string {
  const street = clean(site.address).replace(/,+$/, '').trim();
  if (!street) return '';
  const locality = [clean(site.suburb), clean(site.state), clean(site.postcode)].filter(Boolean).join(' ');
  return [street, locality, 'australia'].filter(Boolean).join(', ');
}
