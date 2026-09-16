import { SWMS_TEMPLATES } from '@/seed/swms';
import {
  OFFER_SCORE, matchTemplates, preselectedTemplates, rareBodyWords,
} from '@/domain/swmsMatch';

/**
 * Which safe work method statements a line of typed text should produce.
 *
 * Run against the REAL ten statements rather than a fixture, because the whole
 * value of this is whether the actual word lists behave. A fixture would pass
 * for ever while the shipped lists rotted.
 *
 * The phrasings below are the ones a technician would really type. They are
 * the contract: the statement a crew forgets is the second one, every time, so
 * a change that stops one of these appearing has cost somebody something.
 */

const ticks = (text: string): string[] =>
  preselectedTemplates(matchTemplates(SWMS_TEMPLATES, { text }));

const offers = (text: string): string[] =>
  matchTemplates(SWMS_TEMPLATES, { text }).filter((m) => m.verdict === 'offer').map((m) => m.templateId);

const anywhere = (text: string): string[] =>
  matchTemplates(SWMS_TEMPLATES, { text }).map((m) => m.templateId);

describe('what a technician types, and what comes up ticked', () => {
  it('finds the asbestos statement in "coring", which the old rule could not', () => {
    // The old matcher asked whether 'core' was a substring of the text, and
    // 'coring' contains 'cori', not 'core'. The one word that names the hazard
    // was the one word that did not match.
    expect(ticks('core drilling the slab to run pipe in an old shopping centre')).toContain('asbestos-silica');
  });

  it('brings up the second statement nobody remembers: a public building is a traffic and lone-work job', () => {
    expect(ticks('core drilling the slab to run pipe in an old shopping centre')).toContain('traffic-lone');
  });

  it('knows a detection annual on a high ceiling is also a height job', () => {
    const t = ticks('annual detection test, detectors on a 6m ceiling, occupied offices');
    expect(t).toContain('live-testing');
    expect(t).toContain('heights');
  });

  it('knows a hydrant flow test at a street booster is also a traffic job', () => {
    const t = ticks('hydrant flow test at the booster on the street');
    expect(t).toContain('hydrant-flow');
    expect(t).toContain('traffic-lone');
  });

  it('reads FIP as the panel, and batteries and megger as electrical work', () => {
    // 'FIP' reaches the detection words only through the trade vocabulary.
    const t = ticks('changing the batteries in the FIP and megger testing the mains');
    expect(t).toContain('electrical');
    expect(t).toContain('live-testing');
  });

  it('sends an extinguisher off site without ticking the detection statement', () => {
    // This is the one the old rule got wrong in the other direction: 'test' is
    // in the detection list, and 'pressure test' contains it.
    const t = ticks('pulling an extinguisher off site for pressure test');
    expect(t).toContain('extinguisher-cylinders');
    expect(t).not.toContain('live-testing');
  });

  it('still offers the detection statement there, rather than hiding it', () => {
    expect(offers('pulling an extinguisher off site for pressure test')).toContain('live-testing');
  });

  it('ticks confined space for a tank entry', () => {
    expect(ticks('entering the fire water tank to inspect it')).toContain('confined-space');
  });

  it('ticks the lone-work statement for a night job in a basement', () => {
    expect(ticks('working alone in the basement carpark at night')).toContain('traffic-lone');
  });
});

describe('the substring matches that were firing on the wrong words', () => {
  it('does not read "basement" as an ASE', () => {
    // 'ase' was in the detection list and 'basement' contains it.
    expect(ticks('checking the basement')).not.toContain('live-testing');
  });

  it('does not read "pitot" as a pit', () => {
    // 'pit' was in the confined-space list.
    expect(ticks('took a pitot reading')).not.toContain('confined-space');
  });

  it('does not read "gasket" as gas', () => {
    expect(ticks('replaced a gasket')).not.toContain('extinguisher-cylinders');
  });

  it('does not read "stairwell" as a well', () => {
    expect(ticks('walked the stairwell')).not.toContain('confined-space');
  });
});

describe('what may tick a box', () => {
  it('ticks nothing on a description that says nothing about the work', () => {
    expect(ticks('')).toEqual([]);
    expect(ticks('job')).toEqual([]);
  });

  it('never ticks a box on corroborating words alone', () => {
    /*
     * "panel", "test", "service", "annual" are in most of these statements.
     * A pile of them is not a fact, and four of them used to reach the tick
     * line by arithmetic alone.
     */
    const matches = matchTemplates(SWMS_TEMPLATES, { text: 'annual service test of the panel' });
    for (const m of matches) {
      if (m.verdict !== 'preselect') continue;
      // Anything ticked here must have been ticked by a decisive word, and the
      // reason line is where that word is named.
      expect(m.because.length).toBeGreaterThan(0);
    }
  });

  it('ticks on a fact about the site even when nothing was typed', () => {
    const t = preselectedTemplates(matchTemplates(SWMS_TEMPLATES, { systems: ['hydrant'] }));
    expect(t).toContain('hydrant-flow');
  });

  it('ticks on a routine that is due', () => {
    const t = preselectedTemplates(matchTemplates(SWMS_TEMPLATES, { routineIds: ['spr-annual'] }));
    expect(t).toContain('sprinkler-wet');
  });

  it('returns nothing below the offer line', () => {
    for (const m of matchTemplates(SWMS_TEMPLATES, { text: 'annual detection test on a ceiling' })) {
      expect(m.score).toBeGreaterThanOrEqual(OFFER_SCORE);
    }
  });

  it('returns the best first', () => {
    const scores = matchTemplates(SWMS_TEMPLATES, { text: 'core drilling the slab in a shopping centre' })
      .map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('says why, in the words that caused it', () => {
    const top = matchTemplates(SWMS_TEMPLATES, { text: 'entering the fire water tank' })[0]!;
    expect(top.templateId).toBe('confined-space');
    expect(top.because.length).toBeGreaterThan(0);
    expect(top.because.length).toBeLessThanOrEqual(4);
  });

  it('does not offer every statement for an ordinary day', () => {
    // Generosity is the point, but a crew handed all ten reads none of them.
    expect(anywhere('annual detection test').length).toBeLessThan(SWMS_TEMPLATES.length);
  });
});

describe('matching a statement on its own steps and hazards', () => {
  const rare = rareBodyWords(SWMS_TEMPLATES);

  it('drops the words every statement uses', () => {
    // Two hundred words appear in all ten — matching any of them would return
    // all ten every time.
    for (const [, set] of rare) {
      expect(set.has('isolate')).toBe(false);
      expect(set.has('permit')).toBe(false);
    }
  });

  it('keeps a word that belongs to one statement', () => {
    // "entrant", "tripod" and "retrieval" are confined-space words and nothing
    // else's. "atmosphere" and "ventilation" are not: three of the ten mention
    // them, which is exactly the case this index exists to drop.
    const cs = rare.get('confined-space');
    expect(cs?.has('entrant')).toBe(true);
    expect(cs?.has('tripod')).toBe(true);
  });

  it('indexes words, not words with punctuation stuck to them', () => {
    // normalise keeps dots and hyphens so that "AS 1670.4" survives a search,
    // which left "shafts." and "below-ground" in the index — neither of which
    // can ever match what somebody types.
    for (const [, set] of rare) {
      for (const w of set) expect(w).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('carries a set for every statement', () => {
    expect([...rare.keys()].sort()).toEqual(SWMS_TEMPLATES.map((t) => t.id).sort());
  });
});

describe('a statement with no suggestion wiring', () => {
  it('never suggests itself, which is the safe direction', () => {
    const bare = SWMS_TEMPLATES.map((t) => ({ ...t, suggestFor: undefined }));
    expect(matchTemplates(bare, { text: 'core drilling the slab' })).toEqual([]);
  });
});
