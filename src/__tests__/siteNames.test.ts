import {
  ambiguousNames, disambiguator, indistinguishable, readableRef, type NamedSite,
} from '@/domain/siteNames';

/**
 * Telling two sites with the same name apart.
 *
 * Keying sites on the office system's id is right — it is the only stable
 * identity, and matching on name would merge genuinely separate buildings. The
 * consequence is that three of Safe QLD's sites are called "Storage Choice -
 * Sumner Park", three are "Luggage Direct" and two are "Brisbane
 * Rheumatology", the register carries no address for any of them, and the list
 * shows identical rows.
 *
 * A technician picking the wrong one of three identical rows records a service
 * against the wrong building, and nothing about the screen tells them there
 * was a choice to get wrong.
 */

const site = (over: Partial<NamedSite> = {}): NamedSite => ({
  id: 's1',
  name: 'An Example Building',
  ...over,
});

describe('ambiguousNames', () => {
  it('finds a name more than one site answers to', () => {
    const names = ambiguousNames([
      site({ id: '1', name: 'Luggage Direct' }),
      site({ id: '2', name: 'Luggage Direct' }),
      site({ id: '3', name: 'Somewhere Else' }),
    ]);
    expect([...names]).toEqual(['luggage direct']);
  });

  it('compares on case and spacing, because the register is typed by people', () => {
    const names = ambiguousNames([
      site({ id: '1', name: 'Luggage Direct' }),
      site({ id: '2', name: '  luggage direct  ' }),
    ]);
    expect([...names]).toEqual(['luggage direct']);
  });

  it('ignores a blank name rather than making every blank ambiguous with the rest', () => {
    expect([...ambiguousNames([site({ id: '1', name: '' }), site({ id: '2', name: '  ' })])]).toEqual([]);
  });

  it('finds nothing where every name is its own', () => {
    expect([...ambiguousNames([site({ id: '1', name: 'A' }), site({ id: '2', name: 'B' })])]).toEqual([]);
  });
});

describe('readableRef', () => {
  it('drops the source prefix, because the office says the number', () => {
    // Stored as "register:3349" so two systems cannot collide; spoken as 3349.
    expect(readableRef('register:3349')).toBe('3349');
  });

  it('hands back a bare reference unchanged', () => {
    expect(readableRef('3349')).toBe('3349');
  });

  it('says nothing for nothing', () => {
    expect(readableRef(undefined)).toBeUndefined();
    expect(readableRef('')).toBeUndefined();
    expect(readableRef('register:')).toBeUndefined();
  });
});

describe('disambiguator', () => {
  const sites = [
    site({ id: '1', name: 'Luggage Direct', siteRef: 'register:3370' }),
    site({ id: '2', name: 'Luggage Direct', siteRef: 'register:3371' }),
    site({ id: '3', name: 'Somewhere Else', siteRef: 'register:9000' }),
  ];
  const ambiguous = ambiguousNames(sites);

  it('says nothing for a name that is already unique', () => {
    /*
     * A reference against every site would be noise on 889 of 897 rows, and
     * the eight places it matters would be lost in it.
     */
    expect(disambiguator(sites[2]!, ambiguous)).toBeUndefined();
  });

  it('offers the source reference where two sites share a name', () => {
    expect(disambiguator(sites[0]!, ambiguous)).toBe('Site 3370 in the office system');
    expect(disambiguator(sites[1]!, ambiguous)).toBe('Site 3371 in the office system');
  });

  it('prefers where the building is, because that is how a technician knows it', () => {
    const withAddress = [
      site({ id: '1', name: 'Luggage Direct', address: '12 Example Street', suburb: 'Hamilton', siteRef: 'register:3370' }),
      site({ id: '2', name: 'Luggage Direct', siteRef: 'register:3371' }),
    ];
    const amb = ambiguousNames(withAddress);
    expect(disambiguator(withAddress[0]!, amb)).toBe('12 Example Street, Hamilton');
  });

  it('says nothing where there is nothing to say', () => {
    /*
     * No address and no reference. A label reading "site 2 of 3" would order by
     * nothing a technician can see and would change as sites are added, so it
     * would be worse than silence.
     */
    const bare = [site({ id: '1', name: 'Twins' }), site({ id: '2', name: 'Twins' })];
    expect(disambiguator(bare[0]!, ambiguousNames(bare))).toBeUndefined();
  });
});

describe('indistinguishable', () => {
  it('names the sites nothing can tell apart', () => {
    // Worth saying out loud rather than leaving a technician to find out by
    // opening all three.
    const bare = [
      site({ id: '1', name: 'Twins' }),
      site({ id: '2', name: 'Twins' }),
      site({ id: '3', name: 'Luggage Direct', siteRef: 'register:3370' }),
      site({ id: '4', name: 'Luggage Direct', siteRef: 'register:3371' }),
    ];
    expect(indistinguishable(bare).map((s) => s.id)).toEqual(['1', '2']);
  });

  it('is empty where every duplicate has something to tell it by', () => {
    const fine = [
      site({ id: '1', name: 'Luggage Direct', siteRef: 'register:3370' }),
      site({ id: '2', name: 'Luggage Direct', siteRef: 'register:3371' }),
    ];
    expect(indistinguishable(fine)).toEqual([]);
  });

  it('is empty where no name is shared at all', () => {
    expect(indistinguishable([site({ id: '1', name: 'A' }), site({ id: '2', name: 'B' })])).toEqual([]);
  });
});
