import {
  PROXIMITY_M, SAME_PREMISES_M, addressMatches, distanceM, formatDistance, matchPlace, normaliseName, parseStreet,
  type MatchCustomer, type MatchSite,
} from '@/domain/customerMatch';

/**
 * "Is this a customer of ours?"
 *
 * The false positives matter more than the misses. A technician told "not a
 * customer" opens the site list and finds out; one told "our site" on the
 * strength of a shared first word walks into the wrong shop and starts a
 * service. So the matcher is tested mostly on what it must refuse.
 */

// Invented sites and customers in invented places.
const SITES: MatchSite[] = [
  { id: 's1', name: 'Storage Choice - Sumner Park', address: '12 Example St', suburb: 'Sumner Park', postcode: '4074', clientName: 'Storage Choice Pty Ltd', latitude: -27.560, longitude: 152.930 },
  { id: 's2', name: 'Riverbend Plaza', address: '5/40 Fictional Pde', suburb: 'Springfield', postcode: '4300', clientName: 'Acme Property', latitude: -27.660, longitude: 152.920 },
  { id: 's3', name: 'Harbour Tower', address: '1 Nowhere Rd', suburb: 'Portside', postcode: '4000' },
];

const CUSTOMERS: MatchCustomer[] = [
  { externalId: '812', name: 'ACME Property Pty Ltd', address: '9 Office Ct', suburb: 'Milton', postcode: '4064' },
  { externalId: '813', name: 'Storage King Pty Ltd' },
];

describe('normalising a name', () => {
  it('drops case, punctuation and the corporate suffixes', () => {
    expect(normaliseName('Storage Choice - Sumner Park')).toBe('storage choice sumner park');
    expect(normaliseName('ACME Property Pty Ltd')).toBe('acme property');
    expect(normaliseName('Acme Property P/L')).toBe('acme property');
    expect(normaliseName('The Acme Property Limited')).toBe('acme property');
    expect(normaliseName('Smith & Sons')).toBe('smith and sons');
    expect(normaliseName('  ')).toBe('');
    expect(normaliseName(undefined)).toBe('');
  });

  it('does not strip words that identify a business', () => {
    expect(normaliseName('Storage King')).not.toBe(normaliseName('Storage Choice'));
    expect(normaliseName('Company Kitchen')).toBe('company kitchen');
  });
});

describe('reading a street address', () => {
  it('reads the office’s shorthand', () => {
    expect(parseStreet('12 Example St')).toEqual({ number: '12', street: 'example street' });
    expect(parseStreet('5/40 Fictional Pde')).toEqual({ unit: '5', number: '40', street: 'fictional parade' });
    expect(parseStreet('Unit 5, 40 Fictional Pde')).toEqual({ unit: '5', number: '40', street: 'fictional parade' });
    expect(parseStreet('Shop 3 40 Fictional Pde')).toEqual({ unit: '3', number: '40', street: 'fictional parade' });
    expect(parseStreet('12-14 Example St')).toEqual({ number: '12', street: 'example street' });
    expect(parseStreet('12A Example St')).toEqual({ number: '12a', street: 'example street' });
  });

  it('reads a geocoder’s comma chain, with or without a name in front', () => {
    expect(parseStreet('12, Example Street, Sumner Park, Brisbane City, Queensland, 4074, Australia'))
      .toEqual({ number: '12', street: 'example street', postcode: '4074' });
    expect(parseStreet('Bunnings, 12, Example Street, Sumner Park, Queensland, 4074, Australia'))
      .toEqual({ number: '12', street: 'example street', postcode: '4074' });
    expect(parseStreet('12 Example St, Sumner Park QLD 4074, Australia'))
      .toEqual({ number: '12', street: 'example street', postcode: '4074' });
  });

  it('gives nothing for an address with no number', () => {
    expect(parseStreet('Sumner Park, Queensland, Australia')).toEqual({});
    expect(parseStreet('')).toEqual({});
    expect(parseStreet(undefined)).toEqual({});
  });
});

describe('matching an address', () => {
  const site = SITES[0]!;

  it('matches the geocoder’s long form to the office’s short one', () => {
    expect(addressMatches({ address: '12 Example Street, Sumner Park QLD 4074, Australia' }, site)).toEqual({ ok: true });
    expect(addressMatches({ address: '12, Example Street, Sumner Park, Brisbane City, Queensland, 4074, Australia' }, site)).toEqual({ ok: true });
  });

  it('accepts the postcode where the suburb is spelt differently', () => {
    expect(addressMatches({ address: '12 Example St, Sumner Pk 4074' }, site)).toEqual({ ok: true });
  });

  it('refuses the same number on the same street in another suburb', () => {
    expect(addressMatches({ address: '12 Example St, Springfield QLD 4300' }, site)).toEqual({ ok: false, reason: 'different suburb' });
  });

  it('refuses a different number or a different street', () => {
    expect(addressMatches({ address: '14 Example St, Sumner Park QLD 4074' }, site).ok).toBe(false);
    expect(addressMatches({ address: '12 Example Rd, Sumner Park QLD 4074' }, site).ok).toBe(false);
    expect(addressMatches({ address: '12 Exemplar St, Sumner Park QLD 4074' }, site).ok).toBe(false);
  });

  it('treats a different unit in the same building as a different premises', () => {
    const unit = SITES[1]!;
    expect(addressMatches({ address: '7/40 Fictional Pde, Springfield QLD 4300' }, unit)).toEqual({ ok: false, reason: 'different unit' });
    expect(addressMatches({ address: 'Unit 5, 40 Fictional Pde, Springfield QLD 4300' }, unit)).toEqual({ ok: true });
    // The building itself is the site's building.
    expect(addressMatches({ address: '40 Fictional Parade, Springfield QLD 4300' }, unit)).toEqual({ ok: true });
  });

  it('matches on the street alone only when the office holds no suburb or postcode', () => {
    const bare = { address: '12 Example St' };
    expect(addressMatches({ address: '12 Example St, Anywhere QLD 4999' }, bare)).toEqual({ ok: true });
    expect(addressMatches({ address: 'Sumner Park' }, site).ok).toBe(false);
  });

  it('does not take the council in a geocoder’s chain for the suburb', () => {
    // A geocoder names the council after the suburb, and a council is
    // often named for a suburb in it. A site in Ipswich is not every
    // street in Ipswich City; a site in Brisbane City is not every street
    // in Brisbane's council.
    const ipswich = { address: '12 Main St', suburb: 'Ipswich', postcode: '4305' };
    expect(addressMatches({ address: '12, Main Street, Springfield, Ipswich City, Queensland, 4300, Australia' }, ipswich))
      .toEqual({ ok: false, reason: 'different suburb' });
    expect(addressMatches({ address: '12, Main Street, Ipswich, Ipswich City, Queensland, 4305, Australia' }, ipswich))
      .toEqual({ ok: true });
    const cbd = { address: '12 Main St', suburb: 'Brisbane City', postcode: '4000' };
    expect(addressMatches({ address: '12, Main Street, Fortitude Valley, Brisbane City, Queensland, 4006, Australia' }, cbd))
      .toEqual({ ok: false, reason: 'different suburb' });
    expect(addressMatches({ address: '12, Main Street, Brisbane City, Queensland, 4000, Australia' }, cbd)).toEqual({ ok: true });
    // Even without a postcode on file, the council segment is not the suburb.
    expect(addressMatches({ address: '12, Main Street, Springfield, Ipswich City, Queensland, 4300' }, { address: '12 Main St', suburb: 'Ipswich' }).ok)
      .toBe(false);
  });

  it('lets two postcodes that disagree settle it before the suburb is looked at', () => {
    expect(addressMatches({ address: '12 Example St, Sumner Park QLD 4300' }, site)).toEqual({ ok: false, reason: 'different suburb' });
    // No postcode on the place: the suburb decides, as before.
    expect(addressMatches({ address: '12 Example St, Sumner Park' }, site)).toEqual({ ok: true });
    // No postcode on the site: the suburb decides, and a one-line address
    // with no segments after the street is searched for the word.
    expect(addressMatches({ address: '12 Example St Sumner Park QLD 4074' }, { address: '12 Example St', suburb: 'Sumner Park' })).toEqual({ ok: true });
  });
});

describe('distance', () => {
  it('is zero to itself and about right across a suburb', () => {
    const a = { latitude: -27.560, longitude: 152.930 };
    expect(distanceM(a, a)).toBe(0);
    // One thousandth of a degree of latitude is 111 metres.
    expect(distanceM(a, { latitude: -27.561, longitude: 152.930 })).toBeCloseTo(111, -1);
  });

  it('reads as metres, then tenths of a kilometre, then whole kilometres', () => {
    expect(formatDistance(38.4)).toBe('38 m');
    expect(formatDistance(3240)).toBe('3.2 km');
    expect(formatDistance(42_600)).toBe('43 km');
    expect(formatDistance(NaN)).toBe('');
  });
});

describe('the verdict', () => {
  it('is our site on an exact name, however it is punctuated', () => {
    const m = matchPlace({ name: 'STORAGE CHOICE SUMNER PARK' }, SITES, CUSTOMERS);
    expect(m.verdict).toBe('our site');
    expect(m.site?.id).toBe('s1');
    expect(m.evidence).toEqual([{ signal: 'name', detail: 'same name' }]);
  });

  it('is not fooled by a shared first word', () => {
    // Storage King is the shop next door to Storage Choice, and a customer
    // in its own right — but not this site.
    const m = matchPlace({ name: 'Storage King Sumner Park', address: '14 Example St, Sumner Park QLD 4074' }, SITES, CUSTOMERS);
    expect(m.verdict).toBe('not a customer');
    expect(m.site).toBeUndefined();
  });

  it('is our site on the address, and says which one', () => {
    const m = matchPlace({ name: 'Some Tenant', address: '12 Example Street, Sumner Park QLD 4074, Australia' }, SITES, CUSTOMERS);
    expect(m.verdict).toBe('our site');
    expect(m.site?.id).toBe('s1');
    expect(m.evidence).toEqual([{ signal: 'address', detail: '12 Example St, Sumner Park 4074' }]);
  });

  it('is our site inside sixty metres of a located site, with the distance on it', () => {
    // About 38 m north of s1.
    const near = matchPlace({ name: 'Unknown Shop', latitude: -27.55966, longitude: 152.930 }, SITES, CUSTOMERS);
    expect(near.verdict).toBe('our site');
    expect(near.site?.id).toBe('s1');
    expect(near.evidence[0]?.signal).toBe('proximity');
    expect(near.evidence[0]?.detail).toMatch(/^\d+ m away$/);
    expect(near.distanceM).toBeLessThan(PROXIMITY_M);

    // And not across the road and down a bit.
    const far = matchPlace({ name: 'Unknown Shop', latitude: -27.558, longitude: 152.930 }, SITES, CUSTOMERS);
    expect(far.verdict).toBe('not a customer');
  });

  it('prefers the site with more evidence, then the nearer one', () => {
    const twins: MatchSite[] = [
      { id: 'a', name: 'Luggage Direct', latitude: -27.5, longitude: 153.0 },
      { id: 'b', name: 'Luggage Direct', address: '3 Example St', suburb: 'Portside', latitude: -27.9, longitude: 153.4 },
      { id: 'c', name: 'Luggage Direct', latitude: -27.4, longitude: 153.0 },
    ];
    expect(matchPlace({ name: 'Luggage Direct', address: '3 Example St, Portside QLD' }, twins).site?.id).toBe('b');
    expect(matchPlace({ name: 'Luggage Direct', latitude: -27.41, longitude: 153.0 }, twins).site?.id).toBe('c');
  });

  it('does not take a same-named site thirty kilometres away for this one', () => {
    // Chains: a dozen sites called the same thing. The one with this name
    // across the city is a different store, and its contact is the wrong
    // person to ring. The place is still that customer's.
    const chain: MatchSite[] = [
      { id: 'far', name: 'Bunnings Warehouse', address: '1 Elsewhere Rd', suburb: 'Farside', postcode: '4999', clientName: 'Bunnings Group', latitude: -27.3, longitude: 153.0 },
    ];
    const customers: MatchCustomer[] = [{ externalId: '900', name: 'Bunnings Group Limited' }];
    const m = matchPlace({ name: 'Bunnings Warehouse', address: '2, Example Street, Oxley, Brisbane City, Queensland, 4075', latitude: -27.56, longitude: 152.98 }, chain, customers);
    expect(m.verdict).toBe('our customer, different site');
    expect(m.site).toBeUndefined();
    expect(m.customer?.externalId).toBe('900');
    expect(m.customerName).toBe('Bunnings Group Limited');
    expect(m.evidence).toEqual([{ signal: 'name', detail: 'same name as Bunnings Warehouse, 29 km away' }]);
    expect(m.distanceM).toBeGreaterThan(SAME_PREMISES_M);
  });

  it('does not take a same-named site on another street for this one, even unlocated', () => {
    const chain: MatchSite[] = [
      { id: 'other', name: 'Storage King', address: '9 Other St', suburb: 'Farside', postcode: '4999', clientName: 'Storage King Pty Ltd' },
    ];
    const m = matchPlace({ name: 'Storage King', address: '14 Example St, Sumner Park QLD 4074' }, chain, CUSTOMERS);
    expect(m.verdict).toBe('our customer, different site');
    expect(m.site).toBeUndefined();
    expect(m.customer?.externalId).toBe('813');
    expect(m.evidence).toEqual([{ signal: 'name', detail: 'same name as Storage King, at 9 Other St, Farside 4999' }]);
  });

  it('still takes the name at its word when nothing contradicts it', () => {
    // No address and no position on the place: nothing to check against.
    const located = matchPlace({ name: 'Storage Choice Sumner Park' }, SITES, CUSTOMERS);
    expect(located.verdict).toBe('our site');
    expect(located.site?.id).toBe('s1');
    // A place with a position but a site the geocoder has not placed, and
    // whose address the office wrote without a number: nothing to compare.
    const unplaced: MatchSite[] = [{ id: 'u', name: 'Harbour Tower', address: 'Cnr Nowhere Rd & Fictional Pde', suburb: 'Portside', clientName: 'Northwind' }];
    expect(matchPlace({ name: 'Harbour Tower', address: '1 Nowhere Rd, Portside QLD 4000', latitude: -27.4, longitude: 153.1 }, unplaced).verdict).toBe('our site');
    // And a same-named site a few hundred metres off — a geocoder's
    // reading of the address, or a big site — is still this one.
    const nearby: MatchSite[] = [{ id: 'n', name: 'Riverbend Plaza', latitude: -27.663, longitude: 152.92 }];
    const m = matchPlace({ name: 'Riverbend Plaza', latitude: -27.66, longitude: 152.92 }, nearby);
    expect(m.verdict).toBe('our site');
    expect(m.distanceM).toBeGreaterThan(PROXIMITY_M);
    expect(m.distanceM).toBeLessThan(SAME_PREMISES_M);
  });

  it('is our customer, different site, on a customer’s name with the suffixes off', () => {
    const m = matchPlace({ name: 'Acme Property', address: '77 Elsewhere St, Nowhere QLD 4999' }, SITES, CUSTOMERS);
    expect(m.verdict).toBe('our customer, different site');
    expect(m.customer?.externalId).toBe('812');
    expect(m.site).toBeUndefined();
    expect(m.evidence[0]?.signal).toBe('customer name');
  });

  it('is our customer on the customer’s own office address', () => {
    const m = matchPlace({ name: 'Somebody', address: '9 Office Court, Milton QLD 4064' }, SITES, CUSTOMERS);
    expect(m.verdict).toBe('our customer, different site');
    expect(m.customer?.externalId).toBe('812');
    expect(m.evidence[0]?.signal).toBe('customer address');
  });

  it('is our customer on a site’s client name, even with no mirrored customer', () => {
    const m = matchPlace({ name: 'Storage Choice Pty Ltd' }, SITES, []);
    expect(m.verdict).toBe('our customer, different site');
    expect(m.customer).toBeUndefined();
    expect(m.evidence).toEqual([{ signal: 'client name', detail: 'the client on Storage Choice - Sumner Park' }]);
  });

  it('ranks the site above the customer when both match', () => {
    const m = matchPlace({ name: 'Riverbend Plaza', address: '5/40 Fictional Pde, Springfield QLD 4300' }, SITES, CUSTOMERS);
    expect(m.verdict).toBe('our site');
    expect(m.site?.id).toBe('s2');
    expect(m.evidence.map((e) => e.signal)).toEqual(['name', 'address']);
  });

  it('is not a customer for a blank place', () => {
    expect(matchPlace({}, SITES, CUSTOMERS)).toEqual({ verdict: 'not a customer', evidence: [] });
    expect(matchPlace({ name: '   ', address: '' }, SITES, CUSTOMERS).verdict).toBe('not a customer');
  });
});
