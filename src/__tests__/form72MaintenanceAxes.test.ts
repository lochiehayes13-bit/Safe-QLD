/**
 * Part A's two questions, answered one tap at a time.
 *
 * This is the field that says what the document is a record of, and it could
 * not be answered at all. The six cells are a product — system × interval —
 * and the chips read their state back out of the stored grid. So tapping "Fire
 * hydrant" with no interval chosen wrote six falses, came back as no system
 * chosen, and un-lit the chip that had just been pressed. Tapping "Annual"
 * next did the same. Neither axis could ever be set, and since validateForm72
 * blocks issuing a form with nothing ticked, no Form 72 could be issued
 * through that screen.
 *
 * The defaults that used to hide this were removed on purpose: tapping "Fire
 * hydrant" also ticked Annual, and tapping "5 year" also ticked fire hydrant,
 * so a five-yearly could print as an annual because the app answered the
 * second question and nobody saw it happen. That rule stands. What changed is
 * that the half-answer is carried on screen until its partner arrives.
 *
 * The transition lives in the domain rather than in the component so these can
 * run the taps end to end — the suite's react-native mock cannot load a screen,
 * and a state machine asserted through source text is not asserted at all.
 */
import {
  intervalsTested, systemTypesTested, toggleMaintenanceAxes, validateForm72, emptyForm72,
  type MaintenanceAxes, type MaintenanceTest,
} from '@/domain/form72';

const NONE: MaintenanceTest = {
  hydrantAnnual: false, hydrantFiveYear: false,
  sprinklerAnnual: false, sprinklerFiveYear: false,
  combinedAnnual: false, combinedFiveYear: false,
};

/** What the screen does: hold the half-answer, fall back to the stored grid. */
function screen(stored: MaintenanceTest) {
  let pending: MaintenanceAxes | null = null;
  let grid = stored;
  const shown = (): MaintenanceAxes => pending
    ?? { types: systemTypesTested(grid), intervals: intervalsTested(grid) };
  return {
    tap(t: Parameters<typeof toggleMaintenanceAxes>[1]) {
      const next = toggleMaintenanceAxes(shown(), t);
      pending = next.pending ? next.shown : null;
      grid = next.grid;
      return this;
    },
    get lit() { return shown(); },
    get stored() { return grid; },
  };
}

describe('answering both questions', () => {
  it('a system tapped on its own stays lit', () => {
    // The whole fault in one assertion: this used to come back empty.
    expect(screen(NONE).tap({ axis: 'type', value: 'hydrant' }).lit.types).toEqual(['hydrant']);
  });

  it('and the interval tapped after it ticks the cell', () => {
    const s = screen(NONE)
      .tap({ axis: 'type', value: 'hydrant' })
      .tap({ axis: 'interval', value: 'annual' });
    expect(s.stored.hydrantAnnual).toBe(true);
    expect(s.stored.hydrantFiveYear).toBe(false);
  });

  it('works in the other order too, because neither question is first', () => {
    const s = screen(NONE)
      .tap({ axis: 'interval', value: 'fiveYear' })
      .tap({ axis: 'type', value: 'sprinkler' });
    expect(s.stored.sprinklerFiveYear).toBe(true);
    expect(s.stored.sprinklerAnnual).toBe(false);
  });

  it('lets a form be issued once both are answered', () => {
    const form = emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', now: '2026-10-06T00:00:00.000Z' });
    form.maintenanceTest = screen(NONE)
      .tap({ axis: 'type', value: 'hydrant' })
      .tap({ axis: 'interval', value: 'annual' })
      .stored;
    expect(validateForm72(form).map((i) => i.message))
      .not.toContain('No maintenance test ticked, so the form does not say what was done.');
  });
});

describe('what a half-answer writes, which is nothing', () => {
  it('stores an all-false grid, so the form still says it is not answered', () => {
    /*
     * The rule that must not be softened to fix the screen. One tap answers one
     * question; the app does not answer the other. A five-yearly that printed
     * as an annual because the app filled in the second question is the fault
     * the defaults were removed for.
     */
    expect(screen(NONE).tap({ axis: 'type', value: 'hydrant' }).stored).toEqual(NONE);
  });

  it('and the form reports itself unanswered, so it cannot be issued half-done', () => {
    const form = emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', now: '2026-10-06T00:00:00.000Z' });
    form.maintenanceTest = screen(NONE).tap({ axis: 'type', value: 'hydrant' }).stored;
    expect(validateForm72(form).filter((i) => i.blocking).map((i) => i.message))
      .toContain('No maintenance test ticked, so the form does not say what was done.');
  });

  it('says a half-answer is still pending, which is how the screen knows to carry it', () => {
    expect(toggleMaintenanceAxes({ types: [], intervals: [] }, { axis: 'type', value: 'hydrant' }).pending)
      .toBe(true);
  });

  it('and says it is not, once the grid can hold the whole answer', () => {
    expect(toggleMaintenanceAxes({ types: ['hydrant'], intervals: [] }, { axis: 'interval', value: 'annual' }).pending)
      .toBe(false);
  });
});

describe('taking an answer back', () => {
  it('un-ticking the system clears the cell and keeps the interval lit', () => {
    const s = screen(NONE)
      .tap({ axis: 'type', value: 'hydrant' })
      .tap({ axis: 'interval', value: 'annual' })
      .tap({ axis: 'type', value: 'hydrant' });
    expect(s.stored).toEqual(NONE);
    expect(s.lit).toEqual({ types: [], intervals: ['annual'] });
  });

  it('un-ticking the interval does the same the other way round', () => {
    const s = screen(NONE)
      .tap({ axis: 'type', value: 'hydrant' })
      .tap({ axis: 'interval', value: 'annual' })
      .tap({ axis: 'interval', value: 'annual' });
    expect(s.stored).toEqual(NONE);
    expect(s.lit).toEqual({ types: ['hydrant'], intervals: [] });
  });
});

describe('a form that already says something', () => {
  it('reads its axes back off the grid, with nothing carried', () => {
    const s = screen({ ...NONE, hydrantAnnual: true });
    expect(s.lit).toEqual({ types: ['hydrant'], intervals: ['annual'] });
  });

  it('adds a second system to it in one tap', () => {
    const s = screen({ ...NONE, hydrantAnnual: true }).tap({ axis: 'type', value: 'sprinkler' });
    expect(s.stored.hydrantAnnual).toBe(true);
    expect(s.stored.sprinklerAnnual).toBe(true);
  });

  it('every combination of the two axes, which is what the grid means', () => {
    const s = screen(NONE)
      .tap({ axis: 'type', value: 'hydrant' })
      .tap({ axis: 'type', value: 'sprinkler' })
      .tap({ axis: 'interval', value: 'annual' })
      .tap({ axis: 'interval', value: 'fiveYear' });
    expect(s.stored).toEqual({
      hydrantAnnual: true, hydrantFiveYear: true,
      sprinklerAnnual: true, sprinklerFiveYear: true,
      combinedAnnual: false, combinedFiveYear: false,
    });
  });
});
