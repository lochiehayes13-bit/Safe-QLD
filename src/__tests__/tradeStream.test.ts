import {
  DESTINATIONS, DEFAULT_STREAM, STREAM_BLURB, STREAM_LABEL, TRADE_STREAMS, TAB_ORDER,
  heldBackFrom, inStream, navFor, readStream, searchDestinations, shows, summarise,
  validateManifest,
  type StreamChoice,
} from '@/domain/appMode';

/**
 * The second axis: which trade's work a phone is set up for.
 *
 * "A service module and a construction module, so my service boys see one side
 * of the app and the construction boys see their side." The thing this file
 * mostly exists to hold is the bargain that makes such a setting safe: it
 * shortens a list, it never takes a module away, and everything it holds back
 * says why and is one tap from the home screen.
 *
 * The mode axis has three rules at the top of appMode.ts and is tested against
 * all three. This axis has the same rules and is held to them here, plus one
 * more that only applies to it: it must be independent of the mode, because the
 * whole reason it is a second setting is that a service technician and a
 * construction technician are both technicians.
 */

const VIEWS: { mode: 'technician' | 'office'; stream: StreamChoice }[] = [
  { mode: 'technician', stream: 'both' },
  { mode: 'technician', stream: 'service' },
  { mode: 'technician', stream: 'construction' },
  { mode: 'office', stream: 'both' },
  { mode: 'office', stream: 'service' },
  { mode: 'office', stream: 'construction' },
];

describe('the setting itself', () => {
  it('shows everything until somebody chooses otherwise', () => {
    // The failure of showing too much is a longer list. The failure of showing
    // too little is a job somebody cannot do from the van.
    expect(DEFAULT_STREAM).toBe('both');
    expect(heldBackFrom('both')).toEqual([]);
  });

  it('reads a stored value, and says so when it could not', () => {
    expect(readStream('service')).toEqual({ stream: 'service' });
    expect(readStream('construction')).toEqual({ stream: 'construction' });
    expect(readStream('both')).toEqual({ stream: 'both' });
    // Absent is not a fault: it is a phone that has never been asked.
    expect(readStream(undefined).stream).toBe('both');
    expect(readStream(undefined).assumed).toBeUndefined();
    expect(readStream('').assumed).toBeUndefined();
    // A value from a newer build, or a typo, falls back and says which.
    const odd = readStream('plumbing');
    expect(odd.stream).toBe('both');
    expect(odd.assumed).toContain('plumbing');
  });

  it('says what each choice is for, in a sentence a technician would use', () => {
    for (const choice of ['both', 'service', 'construction'] as const) {
      expect(STREAM_LABEL[choice].length).toBeGreaterThan(0);
      expect(STREAM_BLURB[choice].length).toBeGreaterThan(40);
      expect(STREAM_BLURB[choice]).toMatch(/^[A-Z]/);
    }
  });
});

describe('nothing is ever deleted', () => {
  it('leaves every module in All modules and in search, whatever the trade', () => {
    /*
     * This is the way back, and it is the whole reason the stream is allowed to
     * be a blunter filter than the mode. Search deliberately ignores the stream
     * — filtering it would close the only door the stream left open.
     */
    for (const stream of TRADE_STREAMS) {
      for (const note of heldBackFrom(stream)) {
        const hits = searchDestinations(note.destination.label, { mode: 'office', stream });
        expect(hits.map((h) => h.destination.route)).toContain(note.destination.route);
      }
    }
  });

  it('never empties a tab, so no tab becomes a dead end', () => {
    for (const view of VIEWS) {
      const tabs = navFor(view).map((g) => g.tab);
      // Every tab the mode shows must still have rows once the trade applies.
      const modeOnly = navFor(view.mode).map((g) => g.tab);
      expect(tabs.sort()).toEqual(modeOnly.sort());
    }
  });

  it('holds back only a minority of the app, in either trade', () => {
    // A split that hides half the app is a different app, not a shorter list.
    for (const stream of TRADE_STREAMS) {
      expect(heldBackFrom(stream).length).toBeLessThan(DESTINATIONS.length / 4);
    }
  });
});

describe('everything held back says why', () => {
  it('carries a reason, and the reason names the work rather than the screen', () => {
    for (const stream of TRADE_STREAMS) {
      for (const note of heldBackFrom(stream)) {
        expect(note.because.length).toBeGreaterThan(40);
        expect(note.because).toMatch(/^[A-Z]/);
        expect(note.because).toMatch(/[.!?]$/);
        expect(note.because).not.toMatch(/No reason recorded/);
        expect(note.shownIn.length).toBeGreaterThan(0);
      }
    }
  });

  it('is caught by validateManifest where it does not', () => {
    // The same check the mode axis gets, and it runs against the real manifest.
    expect(validateManifest()).toEqual([]);
  });
});

describe('the two axes are independent', () => {
  it('lets a construction technician have a technician-sized app and the wiring tables', () => {
    /*
     * The whole reason this is a second setting rather than two more values on
     * the first. On one setting, picking Construction would have meant giving up
     * Technician, and a construction technician would have been handed the
     * office's app to get at the cable tables.
     */
    const view = { mode: 'technician' as const, stream: 'construction' as const };
    expect(shows(view, '/tools/cable')).toBe(true);
    expect(shows(view, '/tools/wiring')).toBe(true);
    // And still technician-sized: the office-only screens stay hidden.
    expect(shows(view, '/tools/cable')).toBe(shows({ mode: 'technician', stream: 'both' }, '/tools/cable'));
  });

  it('gives a service technician the routines and not the design tools', () => {
    const view = { mode: 'technician' as const, stream: 'service' as const };
    expect(shows(view, '/routine/run')).toBe(true);
    expect(shows(view, '/tools/routines')).toBe(true);
    expect(shows(view, '/tools/cable')).toBe(false);
    expect(shows(view, '/tools/max-demand')).toBe(false);
  });

  it('gives a construction technician the design tools and not the routines', () => {
    const view = { mode: 'technician' as const, stream: 'construction' as const };
    expect(shows(view, '/tools/cable')).toBe(true);
    expect(shows(view, '/routine/run')).toBe(false);
    expect(shows(view, '/work/recurring')).toBe(false);
  });

  it('holds a module back from at most one of the two trades', () => {
    // A module in neither trade's hubs is a module nobody sees, which is the
    // one thing this axis must never do.
    for (const d of DESTINATIONS) {
      const hidden = TRADE_STREAMS.filter((st) => !inStream(st, d));
      expect(hidden.length).toBeLessThan(TRADE_STREAMS.length);
    }
  });

  it('applies the trade the same way in both modes', () => {
    // The trade narrows the same modules whichever mode is set; it is not a
    // second, sneakier version of the mode.
    for (const stream of TRADE_STREAMS) {
      const held = new Set(heldBackFrom(stream).map((n) => n.destination.route));
      for (const mode of ['technician', 'office'] as const) {
        for (const route of held) {
          const inMode = shows(mode, route);
          expect(shows({ mode, stream }, route)).toBe(false);
          // And the mode's own answer is untouched by the trade being set.
          if (inMode) expect(shows({ mode, stream: 'both' }, route)).toBe(true);
        }
      }
    }
  });
});

describe('what the settings screen reports', () => {
  it('counts the trade share separately from the mode', () => {
    const both = summarise({ mode: 'technician', stream: 'both' });
    const service = summarise({ mode: 'technician', stream: 'service' });
    expect(both.heldByStream).toBe(0);
    expect(service.heldByStream).toBeGreaterThan(0);
    expect(service.hidden).toBe(both.hidden + service.heldByStream);
    expect(service.stream).toBe('service');
  });

  it('answers a bare mode exactly as it always did', () => {
    // Every existing caller passes a mode string. Leaving one alone must not
    // change what it gets back.
    for (const mode of ['technician', 'office'] as const) {
      expect(summarise(mode)).toEqual(summarise({ mode, stream: 'both' }));
      expect(navFor(mode)).toEqual(navFor({ mode, stream: 'both' }));
    }
  });

  it('keeps every tab in TAB_ORDER accounted for', () => {
    for (const view of VIEWS) {
      for (const g of navFor(view)) expect(TAB_ORDER).toContain(g.tab);
    }
  });
});

describe('the split itself', () => {
  it('puts the AS 1851 servicing work on the service side', () => {
    const held = new Set(heldBackFrom('construction').map((n) => n.destination.route));
    for (const route of ['/routine/run', '/tools/routines', '/work/due', '/occupier']) {
      expect(held).toContain(route);
    }
  });

  it('puts the design and install work on the construction side', () => {
    const held = new Set(heldBackFrom('service').map((n) => n.destination.route));
    for (const route of ['/tools/cable', '/tools/wiring', '/tools/fault-loop', '/tools/max-demand']) {
      expect(held).toContain(route);
    }
  });

  it('leaves the work both trades do in both', () => {
    /*
     * The list of what is NOT split matters more than the list of what is. A
     * defect, a job, a SWMS, a site, the standards and the timesheet are the
     * same on either side of the business, and a split that took any of them
     * off somebody would be the failure this axis is meant to avoid.
     */
    const shared: string[] = [
      '/', '/work/jobs', '/work/job/[id]', '/work/defect/new', '/work/defects',
      '/swms', '/swms/new', '/sites', '/site/[id]', '/assets/find', '/assets/[id]',
      '/library', '/work/clock', '/work/timesheets', '/work/outbound',
      '/work/impairments', '/photos', '/shortcuts', '/search', '/tools/battery',
    ];
    for (const route of shared) {
      for (const stream of TRADE_STREAMS) {
        expect(shows({ mode: 'office', stream }, route)).toBe(true);
      }
    }
  });
});
