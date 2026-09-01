import {
  ambiguousNames, disambiguator, indistinguishable, matchSiteByRefOrName, readableRef,
  type NamedSite,
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

describe('matching an incoming site to one already held', () => {
  /*
   * Both importers — the asset register and the Simpro sync — fell back to
   * matching on name whenever the reference did not hit. The fallback is
   * necessary: a site created by hand on a phone has no reference, and without
   * it every import makes a second copy of the building.
   *
   * But three names in Safe QLD's own register cover eight separate buildings,
   * and a name lookup returns whichever comes first. All three Luggage Directs
   * collapsed onto one local site and took three buildings' assets, jobs and
   * service history with them — silently, because a match is the quiet path.
   */
  const held: NamedSite[] = [
    { id: 'a', name: 'Luggage Direct', siteRef: 'asset-register:3370' },
    { id: 'b', name: 'Luggage Direct', siteRef: 'asset-register:3371' },
    { id: 'c', name: 'Luggage Direct', siteRef: 'asset-register:3372' },
    { id: 'd', name: 'Sandgate Hall', siteRef: 'asset-register:9000' },
    { id: 'e', name: 'Carina Bus Depot' },
  ];

  it('matches on the reference, which is the only real identity', () => {
    expect(matchSiteByRefOrName(held, 'asset-register:3371', 'Luggage Direct').match?.id).toBe('b');
  });

  it('prefers the reference over a name that would have matched something else', () => {
    // The reference wins even where the name is unique and points elsewhere.
    expect(matchSiteByRefOrName(held, 'asset-register:9000', 'Carina Bus Depot').match?.id)
      .toBe('d');
  });

  it('falls back to a name only one site answers to', () => {
    // The case the fallback exists for: a site somebody created on a phone,
    // with no reference on it at all.
    expect(matchSiteByRefOrName(held, 'SIMPRO:412', 'Carina Bus Depot').match?.id).toBe('e');
  });

  it('refuses a name three buildings answer to, and names them', () => {
    /*
     * The whole point. A second site is visible, is already reported by
     * indistinguishable(), and can be merged by hand. Two buildings folded
     * together cannot be taken apart afterwards — nothing records which
     * service belonged to which.
     */
    const out = matchSiteByRefOrName(held, 'SIMPRO:3370', 'Luggage Direct');
    expect(out.match).toBeUndefined();
    expect(out.ambiguous?.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('is the case that actually arises, because the two importers write different references', () => {
    /*
     * The register writes asset-register:3370 and the sync writes SIMPRO:3370
     * for the same building, so a register-imported site never matches the sync
     * by reference and every sync falls through to the name. This is not a
     * one-off on first import; it recurs on every sync for the life of the
     * site.
     */
    for (const id of ['3370', '3371', '3372']) {
      expect(matchSiteByRefOrName(held, `SIMPRO:${id}`, 'Luggage Direct').match).toBeUndefined();
    }
  });

  it('says nothing matched rather than matching a blank name to a blank name', () => {
    // Otherwise every unnamed site joins into one.
    const blanks: NamedSite[] = [{ id: 'x', name: '' }, { id: 'y', name: '  ' }];
    expect(matchSiteByRefOrName(blanks, undefined, '')).toEqual({});
    expect(matchSiteByRefOrName(blanks, undefined, '   ')).toEqual({});
  });

  it('matches a name on case and spacing, because the register is typed by people', () => {
    expect(matchSiteByRefOrName(held, undefined, '  sandgate hall ').match?.id).toBe('d');
  });

  it('finds nothing for a site it has never seen', () => {
    expect(matchSiteByRefOrName(held, 'SIMPRO:1', 'Somewhere New')).toEqual({});
  });
});
