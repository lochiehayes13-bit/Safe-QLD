import { siteAddressKey } from '@/geo/geocodeKey';

/**
 * The geocode cache key.
 *
 * Two people typing the same address must land on one row, and a site with no
 * street must land on none: a suburb alone geocodes to the middle of the
 * suburb, which on a map is indistinguishable from a building.
 */
describe('the address key', () => {
  it('is empty for a site with no street address', () => {
    expect(siteAddressKey({})).toBe('');
    expect(siteAddressKey({ address: '   ' })).toBe('');
    expect(siteAddressKey({ address: null, suburb: 'Springfield', state: 'QLD', postcode: '4300' })).toBe('');
  });

  it('includes the street, suburb, state, postcode and country', () => {
    expect(siteAddressKey({ address: '12 Example St', suburb: 'Springfield', state: 'QLD', postcode: '4300' }))
      .toBe('12 example st, springfield qld 4300, australia');
  });

  it('normalises case and whitespace so the same address is one key', () => {
    const a = siteAddressKey({ address: '12 Example St', suburb: 'Springfield', state: 'QLD', postcode: '4300' });
    const b = siteAddressKey({ address: '  12   EXAMPLE st ', suburb: 'springfield ', state: ' qld', postcode: ' 4300 ' });
    expect(b).toBe(a);
  });

  it('leaves out the parts that are missing without leaving gaps', () => {
    expect(siteAddressKey({ address: '12 Example St', suburb: 'Springfield' })).toBe('12 example st, springfield, australia');
    expect(siteAddressKey({ address: '12 Example St' })).toBe('12 example st, australia');
    expect(siteAddressKey({ address: '12 Example St,', postcode: '4300' })).toBe('12 example st, 4300, australia');
  });
});
