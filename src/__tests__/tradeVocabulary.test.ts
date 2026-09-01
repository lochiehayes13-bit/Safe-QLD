import { clauseQuery, expand, normalise, words } from '@/domain/tradeVocabulary';

/**
 * Turning what a technician typed into what the documents call it.
 *
 * The stake here is a search that comes back empty in a plant room. A question
 * that finds nothing sends someone back to the ute for a folder, and the two
 * failures that cause it are the ones tested hardest: a query that never
 * reaches the document's vocabulary, and a query that gets quietly rewritten
 * into a different question.
 */

describe('normalise', () => {
  it('keeps the characters a clause number is made of', () => {
    // Stripping the dot would turn AS 2419.1 clause 10.4 into gibberish.
    expect(normalise('AS 2419.1, clause 10.4!')).toBe('as 2419.1 clause 10.4');
  });

  it('handles the apostrophe both ways round', () => {
    expect(normalise("occupier's statement")).toBe('occupiers statement');
    expect(normalise('occupier’s statement')).toBe('occupiers statement');
  });

  it('returns nothing for nothing', () => {
    expect(normalise('   ')).toBe('');
    expect(words('')).toEqual([]);
  });
});

describe('expand', () => {
  it('bridges the words a technician uses to the words a standard uses', () => {
    // The whole reason this module exists: "how far off the wall" and
    // "Spacing from walls, partitions or air supply openings" share one word,
    // and it is "from".
    const e = expand('how far off the wall can a detector go');
    expect(e.terms).toContain('spacing');
    expect(e.terms).toContain('clearance');
    expect(e.terms).toContain('proximity');
    expect(e.readings).toContain('a spacing or clearance question');
  });

  it('never drops what was actually typed', () => {
    // Expansion adds; it must not rewrite. A query silently turned into a
    // different question is worse than one that finds nothing.
    const e = expand('vesda aspirator filter');
    for (const w of ['vesda', 'aspirator', 'filter']) expect(e.terms).toContain(w);
  });

  it('searches a word it has never heard of rather than discarding it', () => {
    const e = expand('kentec taktis quiescent');
    expect(e.terms).toContain('kentec');
    expect(e.terms).toContain('taktis');
  });

  it('reads a condemnation question that never says condemn', () => {
    const e = expand('can i still use this extinguisher');
    expect(e.terms).toContain('condemn');
    expect(e.terms).toContain('out of service');
    expect(e.readings).toContain('whether equipment can stay in service');
  });

  it('reads a notification obligation from plain speech', () => {
    const e = expand('do i have to tell anyone about this');
    expect(e.terms).toContain('critical defect');
    expect(e.terms).toContain('commissioner');
  });

  it('pulls the trade brand name through to the generic term', () => {
    // VESDA is a brand that became the trade word for aspirating detection.
    const e = expand('vesda');
    expect(e.terms).toContain('aspirating');
    expect(e.terms).toContain('asd');
  });

  it('expands units the way they are actually written on a gauge', () => {
    const e = expand('what pressure in kpa');
    expect(e.terms).toContain('pressure');
    expect(e.terms).toContain('bar');
  });

  it('reports what it added, so the search can show its working', () => {
    const e = expand('how loud does the siren need to be');
    expect(e.added.length).toBeGreaterThan(0);
    expect(e.added).not.toContain('loud');
    expect(e.terms).toContain('loud');
    expect(e.readings).toContain('an audibility question');
  });

  it('adds nothing for a query it does not recognise, and says so by adding nothing', () => {
    const e = expand('zzzz qqqq');
    expect(e.terms).toEqual(['zzzz', 'qqqq']);
    expect(e.added).toEqual([]);
    expect(e.readings).toEqual([]);
    expect(e.consumed).toEqual([]);
  });

  it('is empty for an empty query rather than matching everything', () => {
    expect(expand('')).toEqual({ terms: [], added: [], readings: [], consumed: [] });
  });

  it('consumes the filler a recognised question shape leaves behind', () => {
    // "far", "off" and "go" appear in no document ever written. Counting them
    // against a match drags a perfect hit on the spacing clause below the
    // threshold and the search returns nothing at all.
    const e = expand('how far off the wall can a detector go');
    expect(e.consumed).toContain('far');
    expect(e.consumed).toContain('off');
    expect(e.consumed).toContain('go');
    // The words that carry the question are never consumed.
    expect(e.consumed).not.toContain('wall');
    expect(e.consumed).not.toContain('detector');
  });

  it('consumes nothing when it did not recognise the question', () => {
    // A query this file does not understand keeps every word it was given.
    expect(expand('kentec taktis off').consumed).toEqual([]);
  });
});

describe('clauseQuery', () => {
  it('recognises a technician navigating rather than searching', () => {
    expect(clauseQuery('AS 2419.1 clause 10.4')).toEqual({ standard: 'as 2419.1', clause: '10.4' });
    expect(clauseQuery('as1670.4 section 4.7')).toEqual({ standard: 'as 1670.4', clause: '4.7' });
  });

  it('takes a bare clause number only when a standard was named with it', () => {
    // Otherwise "2419.1" reads as its own clause number and the jump lands
    // somewhere arbitrary.
    expect(clauseQuery('as 2419.1 3.5')).toEqual({ standard: 'as 2419.1', clause: '3.5' });
    expect(clauseQuery('2419.1')).toBeUndefined();
  });

  it('takes the standard on its own', () => {
    expect(clauseQuery('AS 2444')).toEqual({ standard: 'as 2444', clause: undefined });
  });

  it('reads AS/NZS the same as AS', () => {
    expect(clauseQuery('AS/NZS 2293.2 clause 3.4')).toEqual({ standard: 'as 2293.2', clause: '3.4' });
  });

  it('ignores the edition year, which is not part of the reference being sought', () => {
    expect(clauseQuery('AS 2419.1:2005 clause 8.4')).toEqual({ standard: 'as 2419.1', clause: '8.4' });
  });

  it('says nothing for an ordinary question', () => {
    expect(clauseQuery('how far off the wall can a detector go')).toBeUndefined();
    expect(clauseQuery('extinguisher pressure test')).toBeUndefined();
  });
});
