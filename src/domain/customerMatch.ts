/**
 * "Is this place a customer of ours?"
 *
 * The map lets a technician search for any place at all — a shop found on
 * Google, an address a caller read out — and the first thing they want to
 * know is whether the company already looks after it. That is decided here,
 * from three signals, each of which is checked rather than trusted:
 *
 *  - the name, compared after the noise is taken off it, so "ACME Pty Ltd"
 *    and "Acme" are the same customer but "Storage Choice" and "Storage King"
 *    are not — one is a customer and the other is the shop next door;
 *  - the address, compared on the street number, the street and the suburb,
 *    so "12 Smith Street, Springfield QLD 4300, Australia" from a geocoder
 *    is the site the office typed as "12 Smith St" in Springfield, and so a
 *    different unit in the same building is not assumed to be the same site;
 *  - the distance, for a place with coordinates and a site the geocoder has
 *    placed: inside sixty metres is the same building or the one beside it,
 *    and it is offered with the distance on it so the technician can judge.
 *
 * The verdict comes with its evidence. "Our site" with "same name" beside it
 * is something a person can check against the building in front of them;
 * a bare verdict is something they either trust or ignore.
 *
 * Pure. Sites and customers come in as the plain shapes below so the matcher
 * runs anywhere, and the screen adapts its rows to them.
 */

export type MatchVerdict = 'our site' | 'our customer, different site' | 'not a customer';

export interface MatchSite {
  id: string;
  name: string;
  address?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  clientName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface MatchCustomer {
  externalId: string;
  name: string;
  address?: string | null;
  suburb?: string | null;
  postcode?: string | null;
}

export interface MatchPlace {
  name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type MatchSignal = 'name' | 'address' | 'proximity' | 'client name' | 'customer name' | 'customer address';

export interface MatchEvidence {
  signal: MatchSignal;
  /** One line a person can read: "same name", "12 Smith St, Springfield", "38 m away". */
  detail: string;
}

export interface PlaceMatch<S extends MatchSite = MatchSite, C extends MatchCustomer = MatchCustomer> {
  verdict: MatchVerdict;
  site?: S;
  customer?: C;
  /** The customer's name where it is known without a mirrored customer record: the client on a site. */
  customerName?: string;
  evidence: MatchEvidence[];
  /** Metres from the place to the matched site, where both have coordinates. */
  distanceM?: number;
}

export interface MatchOptions {
  /** Metres within which a located site is taken to be the place. Defaults to 60. */
  proximityM?: number;
  /** Metres beyond which a site of the same name is taken to be a different premises. Defaults to 2000. */
  samePremisesM?: number;
}

/** Sixty metres: the building, or the one sharing its car park. Not the one across the road. */
export const PROXIMITY_M = 60;

/**
 * Two kilometres: the distance past which a site with the place's name is
 * some other branch of the same chain, not this one. Generous on purpose —
 * a site's position comes from a geocoder reading the office's address and
 * can be a few hundred metres out, and a shopping centre is a few hundred
 * metres across — but two stores of one chain are not two kilometres apart.
 */
export const SAME_PREMISES_M = 2000;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The words that say nothing about which business this is. A name is compared
 * without them so a company's registered name and its sign agree. Deliberately
 * short: taking "storage" out would make every storage business one customer.
 */
const NAME_NOISE = new Set(['pty', 'ltd', 'limited', 'p/l', 'inc', 'incorporated', 'the', 'ta', 'trading', 'as']);

/**
 * A name reduced to what identifies it: lower case, "&" as "and", punctuation
 * as spaces, the corporate suffixes gone. "Storage Choice - Sumner Park" and
 * "STORAGE CHOICE SUMNER PARK" come out the same; "Storage King" does not.
 */
export function normaliseName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/p\/l/g, ' ')
    .replace(/t\/a/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NAME_NOISE.has(w))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Street types the way the office abbreviates them, mapped to the word a
 * geocoder writes out. Both sides are put through this so "Smith St" and
 * "Smith Street" compare equal.
 */
const STREET_TYPES: Record<string, string> = {
  st: 'street', street: 'street',
  rd: 'road', road: 'road',
  ave: 'avenue', av: 'avenue', avenue: 'avenue',
  dr: 'drive', drv: 'drive', drive: 'drive',
  pde: 'parade', parade: 'parade',
  cres: 'crescent', cr: 'crescent', crescent: 'crescent',
  ct: 'court', crt: 'court', court: 'court',
  pl: 'place', place: 'place',
  hwy: 'highway', highway: 'highway',
  tce: 'terrace', terrace: 'terrace',
  blvd: 'boulevard', bvd: 'boulevard', boulevard: 'boulevard',
  ln: 'lane', lane: 'lane',
  cct: 'circuit', cir: 'circuit', circuit: 'circuit',
  esp: 'esplanade', esplanade: 'esplanade',
  gr: 'grove', grove: 'grove',
  cl: 'close', close: 'close',
  sq: 'square', square: 'square',
  wy: 'way', way: 'way',
  mwy: 'motorway', motorway: 'motorway',
  rdge: 'ridge', ridge: 'ridge',
};

const UNIT_WORDS = /^(?:unit|u|shop|suite|level|lvl|apt|apartment|flat|lot|tenancy|t)\s*(\d+[a-z]?)\s*[,/\-]?\s*/i;

export interface ParsedStreet {
  /** "5" from "5/12 Smith St" or "Unit 5, 12 Smith St". */
  unit?: string;
  /** "12" from "12 Smith St" or "12-14 Smith St". */
  number?: string;
  /** "smith street", the type written out, lower case. */
  street?: string;
  /** The first four-digit number after the street, where there is one. */
  postcode?: string;
}

function normaliseStreet(words: string): string {
  return words
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_TYPES[w] ?? w)
    .join(' ');
}

/**
 * The street number, unit and street name out of an address, however it was
 * written. The office writes "5/12 Smith St"; a geocoder writes "12, Smith
 * Street, Springfield, Ipswich City, Queensland, 4300, Australia" and may put
 * the business name in front of that. Segments are read at the commas, the
 * first segment that starts with a number is the number, and the street is
 * whatever follows it — in the same segment or the next.
 */
export function parseStreet(address: string | null | undefined): ParsedStreet {
  return readStreet(address).parsed;
}

/**
 * The parse, plus the comma segments after the street: the suburb, the
 * council, the state and the postcode, in whatever order and however many
 * the writer used. The suburb check reads those and nothing before them.
 */
function readStreet(address: string | null | undefined): { parsed: ParsedStreet; tail: string[] } {
  const out: ParsedStreet = {};
  if (!address) return { parsed: out, tail: [] };
  const segments = address.split(',').map((s) => s.trim()).filter(Boolean);

  let index = segments.findIndex((s) => /^(?:(?:unit|u|shop|suite|level|lvl|apt|apartment|flat|lot|tenancy|t)\s*)?\d/i.test(s));
  if (index < 0) return { parsed: out, tail: [] };

  let rest = segments[index]!;
  const unit = rest.match(UNIT_WORDS);
  if (unit) {
    out.unit = unit[1]!.toLowerCase();
    rest = rest.slice(unit[0].length);
  }
  // "5/12 Smith St": the unit before the slash, the building after it.
  const slashed = rest.match(/^(\d+[a-z]?)\s*\/\s*(\d+[a-z]?)\s*/i);
  if (slashed) {
    out.unit = out.unit ?? slashed[1]!.toLowerCase();
    out.number = slashed[2]!.toLowerCase();
    rest = rest.slice(slashed[0].length);
  } else {
    // "12 Smith St", "12A Smith St", "12-14 Smith St": the first number is the building.
    const plain = rest.match(/^(\d+[a-z]?)(?:\s*[-–]\s*\d+[a-z]?)?\s*/i);
    if (plain) {
      out.number = plain[1]!.toLowerCase();
      rest = rest.slice(plain[0].length);
    } else {
      // "Unit 5" on its own, with the building number in the next segment.
      index += 1;
      const next = segments[index];
      const again = next?.match(/^(\d+[a-z]?)(?:\s*[-–]\s*\d+[a-z]?)?\s*/i);
      if (!next || !again) return { parsed: out, tail: [] };
      out.number = again[1]!.toLowerCase();
      rest = next.slice(again[0].length);
    }
  }

  let streetWords = rest.trim();
  if (!streetWords) {
    index += 1;
    streetWords = segments[index] ?? '';
  }
  const street = normaliseStreet(streetWords);
  if (street && !/^\d/.test(street)) out.street = street;

  const tail = segments.slice(index + 1);
  const postcode = tail.join(' ').match(/\b(\d{4})\b/);
  if (postcode) out.postcode = postcode[1];
  return { parsed: out, tail };
}

/** True when the word appears whole in the text, case-insensitively. */
function mentions(text: string | null | undefined, word: string | null | undefined): boolean {
  const w = (word ?? '').trim().toLowerCase();
  if (!w || !text) return false;
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return hay.includes(` ${w.replace(/[^a-z0-9]+/g, ' ')} `);
}

/** Lower case, punctuation as spaces, one space between words. */
function words(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Whether one of the segments after the street is the suburb.
 *
 * Each segment is taken whole, with the state and postcode a one-line
 * address hangs on the end of it taken off: "Sumner Park QLD 4074" is the
 * suburb Sumner Park, and so is Nominatim's own "Sumner Park" segment. The
 * council segment beside it — "Ipswich City", "Brisbane City" — is a whole
 * segment too, so a site whose suburb is Ipswich does not match every street
 * in the council of the same name, which is what searching the flattened
 * address for the word did.
 */
function namesSuburb(tail: readonly string[], suburb: string): boolean {
  const want = words(suburb);
  if (!want) return false;
  return tail.some((segment) => {
    const locality = words(segment.replace(/\b(?:qld|queensland)\b\s*\d{0,4}\s*$/i, '').replace(/\b\d{4}\s*$/, ''));
    return locality === want;
  });
}

/** Two normalised streets that are the same street: equal, or one is the other with a suffix like "north". */
function sameStreet(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = a.split(' ');
  const wb = b.split(' ');
  const shorter = wa.length <= wb.length ? wa : wb;
  const longer = wa.length <= wb.length ? wb : wa;
  // A street needs a name and a type to be compared on a prefix; "smith" alone
  // would match "smith street" and "smithfield road" both.
  if (shorter.length < 2) return false;
  return shorter.every((w, i) => longer[i] === w);
}

export interface AddressMatch {
  ok: boolean;
  /** Why not, where it is worth saying: "different unit", "different suburb". */
  reason?: string;
}

/**
 * Whether a geocoder's address and the office's are the same premises.
 *
 * Same building number and same street, and the place has to name the
 * site's suburb or its postcode — a "12 Smith Street" exists in a dozen
 * suburbs. A site with neither suburb nor postcode on file is matched on the
 * street alone, which is the best that record allows.
 *
 * Where both sides carry a postcode and they disagree, that settles it
 * before the suburb is looked at: a postcode is a stronger word than a
 * suburb name, and a geocoder's address names the council as well as the
 * suburb, so a site in "Brisbane City" would otherwise match the same street
 * number in every suburb of Brisbane's council.
 *
 * A unit is a tenancy, not a building. Where both sides carry one and they
 * differ, it is a different shop in the same block and is not the site. Where
 * only one side carries one, the place is the building and the site is in it.
 */
export function addressMatches(
  place: { address?: string | null },
  site: { address?: string | null; suburb?: string | null; postcode?: string | null },
): AddressMatch {
  const { parsed: p, tail } = readStreet(place.address);
  const s = parseStreet(site.address);
  if (!p.number || !p.street || !s.number || !s.street) return { ok: false };
  if (p.number !== s.number) return { ok: false };
  if (!sameStreet(p.street, s.street)) return { ok: false };
  if (p.unit && s.unit && p.unit !== s.unit) return { ok: false, reason: 'different unit' };

  const suburb = (site.suburb ?? '').trim();
  const postcode = (site.postcode ?? '').trim();
  if (postcode && p.postcode && p.postcode !== postcode) return { ok: false, reason: 'different suburb' };
  if (suburb || postcode) {
    // An address written without commas has no segments after the street;
    // the whole line is searched for the word then, since there is no
    // council segment in it to be fooled by.
    const inSuburb = suburb ? (tail.length ? namesSuburb(tail, suburb) : mentions(place.address, suburb)) : false;
    const inPostcode = postcode ? (p.postcode === postcode || mentions(place.address, postcode)) : false;
    if (!inSuburb && !inPostcode) return { ok: false, reason: 'different suburb' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

const EARTH_M = 6_371_000;

/** Great-circle distance in metres. Haversine, which is exact enough at any distance a technician drives. */
export function distanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "38 m" or "3.2 km", the way a person says it. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  if (metres < 1000) return `${Math.round(metres)} m`;
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

function hasPosition(p: { latitude?: number | null; longitude?: number | null }): p is { latitude: number; longitude: number } {
  return typeof p.latitude === 'number' && typeof p.longitude === 'number'
    && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && !(p.latitude === 0 && p.longitude === 0);
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/** The address the office holds for a site, as one line, for the evidence. */
function siteAddressLine(site: MatchSite | MatchCustomer): string {
  return [site.address, [site.suburb, site.postcode].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Whether a place is one of our sites, a site of one of our customers, or
 * nobody we know.
 *
 * Sites are tried first, and every signal is scored so that a site matched on
 * name and address outranks one matched on proximity alone. Then the
 * customers: a place carrying a customer's name is theirs even if the office
 * has no site at that address yet, and that is worth knowing before knocking
 * — it is a quote, not a cold call. The site's client name counts the same
 * way, for the customers the sync has not mirrored.
 *
 * A name on its own is decisive unless something contradicts it. Chains are
 * common in a fire-protection book — a dozen sites called the same thing —
 * and the one with the place's name thirty kilometres away is a different
 * store: its contact is the wrong person to ring and its jobs are somebody
 * else's. So a site matched on name alone is set aside when the two are
 * plainly not the same premises: both are positioned and far apart, or both
 * have a street address and the addresses disagree. The place is then still
 * a customer's, which is what the verdict says, with the site it was mistaken
 * for named so the technician can see why. A place with no address and no
 * position has nothing to contradict the name with, and is taken at its word.
 */
export function matchPlace<S extends MatchSite, C extends MatchCustomer>(
  place: MatchPlace,
  sites: readonly S[],
  customers: readonly C[] = [],
  options: MatchOptions = {},
): PlaceMatch<S, C> {
  const proximityM = options.proximityM ?? PROXIMITY_M;
  const samePremisesM = options.samePremisesM ?? SAME_PREMISES_M;
  const name = normaliseName(place.name);
  const placeStreet = parseStreet(place.address);

  let best: { site: S; score: number; evidence: MatchEvidence[]; distance?: number } | undefined;
  /** The nearest same-named site the evidence said was somewhere else. */
  let namesake: { site: S; distance?: number } | undefined;
  for (const site of sites) {
    const evidence: MatchEvidence[] = [];
    let score = 0;
    let distance: number | undefined;

    const sameName = !!name && normaliseName(site.name) === name;
    if (sameName) {
      score += 4;
      evidence.push({ signal: 'name', detail: 'same name' });
    }
    const address = addressMatches(place, site);
    if (address.ok) {
      score += 4;
      evidence.push({ signal: 'address', detail: siteAddressLine(site) || 'same address' });
    }
    if (hasPosition(place) && hasPosition(site)) {
      distance = distanceM(place, site);
      if (distance <= proximityM) {
        score += 1;
        evidence.push({ signal: 'proximity', detail: `${formatDistance(distance)} away` });
      }
    }
    if (score === 0) continue;

    // Name alone: the address did not agree and the place is not within
    // proximity. Is there anything that says it is not this site?
    if (sameName && score === 4) {
      const siteStreet = parseStreet(site.address);
      const farApart = distance !== undefined && distance > samePremisesM;
      const elsewhere = !!placeStreet.number && !!placeStreet.street && !!siteStreet.number && !!siteStreet.street;
      if (farApart || elsewhere) {
        if (!namesake || (distance ?? Infinity) < (namesake.distance ?? Infinity)) namesake = { site, distance };
        continue;
      }
    }
    if (!best || score > best.score || (score === best.score && (distance ?? Infinity) < (best.distance ?? Infinity))) {
      best = { site, score, evidence, distance };
    }
  }

  if (best) {
    return {
      verdict: 'our site',
      site: best.site,
      evidence: best.evidence,
      distanceM: best.distance,
    };
  }

  if (namesake) {
    const { site, distance } = namesake;
    const clientName = normaliseName(site.clientName);
    const customer = clientName ? customers.find((c) => normaliseName(c.name) === clientName) : undefined;
    const where = distance !== undefined
      ? `${formatDistance(distance)} away`
      : `at ${siteAddressLine(site) || 'another address'}`;
    return {
      verdict: 'our customer, different site',
      customer,
      customerName: customer?.name ?? ((site.clientName ?? '').trim() || undefined),
      evidence: [{ signal: 'name', detail: `same name as ${site.name}, ${where}` }],
      distanceM: distance,
    };
  }

  if (name) {
    for (const customer of customers) {
      if (normaliseName(customer.name) === name) {
        return {
          verdict: 'our customer, different site',
          customer,
          evidence: [{ signal: 'customer name', detail: `same name as customer ${customer.name}` }],
        };
      }
    }
  }
  for (const customer of customers) {
    if (addressMatches(place, customer).ok) {
      return {
        verdict: 'our customer, different site',
        customer,
        evidence: [{ signal: 'customer address', detail: `the address of customer ${customer.name}` }],
      };
    }
  }
  if (name) {
    for (const site of sites) {
      if (normaliseName(site.clientName) === name) {
        const customer = customers.find((c) => normaliseName(c.name) === name);
        return {
          verdict: 'our customer, different site',
          customer,
          customerName: customer?.name ?? ((site.clientName ?? '').trim() || undefined),
          evidence: [{ signal: 'client name', detail: `the client on ${site.name}` }],
        };
      }
    }
  }

  return { verdict: 'not a customer', evidence: [] };
}
