import {
  EOL_VALUES, ZONE_STATE_TABLES, eolBrands, eolFor, type EolEntry,
} from '@/calc/eol';

/**
 * The end-of-line reference.
 *
 * The dangerous thing this module could do is ship a universal
 * normal/alarm/fault table, because one does not exist. EOL value is per panel,
 * per card and often per configured mode, and several Australian panels sense
 * current rather than resistance at all — the F3200 decides alarm from the
 * current a latched detector draws, so no resistance window describes it.
 *
 * A wrong value here is not a wrong number on a screen. A technician fits the
 * resistor it names, and the circuit then reads healthy while the detection on
 * it is not being monitored the way the panel expects. Nothing alarms until
 * something needs to.
 *
 * So these tests are mostly about refusals and provenance: that every value
 * names where it came from, that a panel with no published thresholds says so
 * rather than borrowing another panel's, and that the one panel which does not
 * sense resistance is not given a resistance table.
 */

const entries = EOL_VALUES;

describe('every entry can be traced', () => {
  it('names a brand, a panel and which circuit on it', () => {
    /*
     * "3K3" with no circuit named is the beginning of the universal table this
     * module exists to refuse. The same panel has different values on a
     * detection zone and on a sounder circuit.
     */
    const vague = entries.filter((e) => !e.brand.trim() || !e.panel.trim() || !e.circuit.trim());
    expect(vague.map((e) => `${e.brand} ${e.panel}`)).toEqual([]);
  });

  it('carries a value verbatim rather than an empty cell', () => {
    expect(entries.filter((e) => !e.value.trim()).map((e) => e.panel)).toEqual([]);
  });

  it('names the manual every high-confidence value came from', () => {
    // High confidence is a claim about a document. Without the document it is
    // a claim about somebody's memory.
    const unsourced = entries.filter((e) => e.confidence === 'high' && !e.source?.trim());
    expect(unsourced.map((e) => `${e.brand} ${e.panel} — ${e.circuit}`)).toEqual([]);
  });

  it('grades every entry', () => {
    const graded = new Set(['high', 'medium', 'low']);
    expect(entries.filter((e) => !graded.has(e.confidence)).map((e) => e.panel)).toEqual([]);
  });

  it('holds no duplicate panel-and-circuit pair with a different answer', () => {
    /*
     * Two rows for the same circuit with different values is the reference
     * disagreeing with itself, and a technician picks whichever is on screen.
     */
    const seen = new Map<string, EolEntry>();
    const conflicts: string[] = [];
    for (const e of entries) {
      const key = `${e.brand}|${e.panel}|${e.circuit}`.toLowerCase();
      const prior = seen.get(key);
      if (prior && prior.value !== e.value) conflicts.push(key);
      else seen.set(key, e);
    }
    expect(conflicts).toEqual([]);
  });
});

describe('eolBrands', () => {
  it('lists each brand once, sorted, for the filter', () => {
    const brands = eolBrands();
    expect(brands).toEqual([...new Set(brands)].sort());
    expect(brands.length).toBeGreaterThan(1);
  });

  it('lists only brands that actually have an entry', () => {
    for (const b of eolBrands()) {
      expect(entries.some((e) => e.brand === b)).toBe(true);
    }
  });
});

describe('eolFor', () => {
  it('returns everything when no brand is chosen', () => {
    expect(eolFor()).toHaveLength(entries.length);
  });

  it('returns only that brand when one is', () => {
    const brand = eolBrands()[0]!;
    const got = eolFor(brand);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((e) => e.brand === brand)).toBe(true);
  });

  it('returns nothing for a brand it does not hold, rather than everything', () => {
    // Falling back to the whole list on an unknown brand would show a
    // technician another manufacturer's values under their panel's name.
    expect(eolFor('Not A Real Brand')).toEqual([]);
  });
});

describe('the published state boundaries', () => {
  it('gives a resistance table only to panels that sense resistance', () => {
    /*
     * The F3200 is the case. It decides alarm from the current a latched
     * detector draws, and a resistance window put against it would be an
     * invented answer that measures fine on a meter and means nothing.
     */
    const currentSensing = ZONE_STATE_TABLES.filter((t) => /current band/i.test(t.method));
    expect(currentSensing.length).toBeGreaterThan(0);
    for (const t of currentSensing) expect(t.bands).toBeNull();
  });

  it('says how a panel senses, for every table', () => {
    expect(ZONE_STATE_TABLES.filter((t) => !t.method.trim()).map((t) => t.panel)).toEqual([]);
  });

  it('explains itself wherever it has no bands to show', () => {
    // A table with no bands and no note reads as missing data rather than as
    // "this panel does not work that way".
    const silent = ZONE_STATE_TABLES.filter((t) => t.bands === null && !t.notes?.trim());
    expect(silent.map((t) => t.panel)).toEqual([]);
  });

  it('names the document behind every table', () => {
    expect(ZONE_STATE_TABLES.filter((t) => !t.source?.trim()).map((t) => t.panel)).toEqual([]);
  });

  it('gives every band both a range and a state', () => {
    const broken: string[] = [];
    for (const t of ZONE_STATE_TABLES) {
      for (const b of t.bands ?? []) {
        if (!b.range.trim() || !b.state.trim()) broken.push(`${t.panel} ${t.circuit}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('keeps the two F4000 circuits apart, because they map the same boundaries differently', () => {
    /*
     * The trap on that panel: a fire circuit with a 3K3 EOL and a non-fire
     * circuit with a 10K one share their boundaries and mean different things
     * by them. 5K5 to 16K9 is Alarm on one and Normal on the other, so reading
     * across is how a healthy circuit gets reported in alarm.
     */
    const f4000 = ZONE_STATE_TABLES.filter((t) => t.panel.includes('F4000'));
    expect(f4000.length).toBe(2);

    const band = (t: (typeof f4000)[number]) =>
      t.bands!.find((b) => b.range === '5K5 to 16K9')!.state;
    const states = f4000.map(band);
    expect(new Set(states).size).toBe(2);
  });

  it('names each table against a circuit, not just a panel', () => {
    // Same reason as the entries: a panel has more than one kind of circuit.
    expect(ZONE_STATE_TABLES.filter((t) => !t.circuit.trim()).map((t) => t.panel)).toEqual([]);
  });
});

describe('what the reference refuses to be', () => {
  it('ships no universal table', () => {
    /*
     * Asserted structurally rather than trusted. There is no export that is a
     * bare normal/alarm/fault triple — every value is reached through a panel
     * and a circuit, so a universal one cannot be added without changing the
     * shape first.
     */
    const shape = new Set(['brand', 'panel', 'circuit', 'value', 'notes', 'confidence', 'source']);
    const extra = new Set<string>();
    for (const e of entries) for (const k of Object.keys(e)) if (!shape.has(k)) extra.add(k);
    expect([...extra]).toEqual([]);
  });

  it('covers more than one manufacturer, so it is not a single-panel table wearing a general name', () => {
    expect(eolBrands().length).toBeGreaterThanOrEqual(2);
  });
});
