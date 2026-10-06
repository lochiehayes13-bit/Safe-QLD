/**
 * The map could not be searched by the office's number for the building.
 *
 * A pin's searchable text was its name, its address line, the client, and the
 * job and quote numbers on it. Not the site's own number, and not the office's
 * reference — so the one number a technician is most likely to be holding, the
 * one read out over the phone, found nothing on the map even with the pin on
 * screen.
 *
 * That is the owner's complaint about the site list ("the number read out over
 * the phone finds nothing"), which was fixed in the SQL searches and left true
 * here: the map was the one module not brought across.
 */
import { buildPins, filterPins, pinSearchText, type MapSite } from '@/domain/mapPins';

const SITE: MapSite = {
  id: 'busy',
  name: 'Baldwin Living Emsworth',
  address: '3 Emsworth Street',
  suburb: 'Wynnum',
  state: 'QLD',
  postcode: '4178',
  clientName: 'Baldwin Living',
  externalId: '8812',
  siteRef: 'SIMPRO:8812',
};

const TYPED: MapSite = {
  id: 'hand',
  name: 'Kingaroy Fire Station',
  suburb: 'Kingaroy',
  // Somebody's own reference, typed on the phone: no stamp, no office number.
  siteRef: 'SB-014',
};

const pinsFor = (sites: MapSite[]) => buildPins({
  sites,
  jobs: [],
  quotes: [],
  positions: new Map(sites.map((s) => [s.id, { latitude: -27.4, longitude: 153.1 }])),
  now: '2026-10-06T00:00:00.000Z',
}).pins;

const found = (sites: MapSite[], query: string) =>
  filterPins(pinsFor(sites), {
    kinds: new Set(pinsFor(sites).flatMap((p) => p.kinds)),
    query,
  }).map((p) => p.siteId);

describe('searching the map for the office’s site number', () => {
  it('finds the site by the number itself', () => {
    expect(found([SITE], '8812')).toEqual(['busy']);
  });

  it('finds it by the stamped reference as the office writes it', () => {
    expect(found([SITE], 'SIMPRO:8812')).toEqual(['busy']);
  });

  it('finds a site by a reference somebody typed on the phone', () => {
    expect(found([TYPED], 'SB-014')).toEqual(['hand']);
  });

  it('still finds it by name, address and client, which always worked', () => {
    for (const q of ['Baldwin', 'Emsworth', 'Wynnum']) {
      expect({ q, ids: found([SITE], q) }).toEqual({ q, ids: ['busy'] });
    }
  });

  it('answers nothing for a number no site carries', () => {
    expect(found([SITE, TYPED], '99999')).toEqual([]);
  });

  it('puts the number in the pin’s own searchable text, which is what the page filters on', () => {
    // The WebView filters with the same string, so a pin whose text lacks the
    // number cannot be found there either however the screen is written.
    const [pin] = pinsFor([SITE]);
    expect(pinSearchText(pin!)).toContain('8812');
  });

  it('drops the stamp as well as keeping it, because 8812 is what is read out', () => {
    const [pin] = pinsFor([SITE]);
    expect(pin!.refs).toContain('8812');
    expect(pin!.refs).toContain('SIMPRO:8812');
  });

  it('carries no empty refs for a site with neither', () => {
    const bare: MapSite = { id: 'bare', name: 'Nowhere' };
    expect(pinsFor([bare])[0]!.refs).toEqual([]);
  });
});
