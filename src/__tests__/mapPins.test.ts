import {
  OSM_ATTRIBUTION, PIN_COLOUR, PIN_KINDS, PIN_LABEL, RECENT_DAYS,
  buildPins, centreScript, classifyJob, filterPins, filterScript, formatCount, googleMapsUrl,
  jobPositions, jsLiteral, mapHtml, parseMapMessage, siteAddressLine, wazeUrl,
  type LatLng, type MapJob, type MapSite, type PinKind,
} from '@/domain/mapPins';

/**
 * The service map's rules.
 *
 * Checked at the boundaries, because that is where a map lies: a job finished
 * sixty days ago is either the last green dot or a site that has gone grey, and
 * the two read as different companies.
 */

const NOW = '2026-09-02T02:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): string {
  return new Date(Date.parse(NOW) + days * DAY_MS).toISOString();
}

let seq = 0;
function job(patch: Partial<MapJob> = {}): MapJob {
  seq += 1;
  return { id: `j${seq}`, siteId: 's1', title: `Job ${seq}`, status: 'scheduled', ...patch };
}

// Made-up sites in made-up places.
const SITES: MapSite[] = [
  { id: 's1', name: 'Riverbend Plaza', address: '12 Example St', suburb: 'Springfield', state: 'QLD', postcode: '4300', clientName: 'Acme Property' },
  { id: 's2', name: 'Harbour Tower', address: '1 Fictional Pde', suburb: 'Portside', state: 'QLD', postcode: '4000', clientName: 'Northwind Holdings' },
  { id: 's3', name: 'Depot Nine', address: '', suburb: 'Nowhere', state: 'QLD', postcode: '4999' },
];

const POSITIONS = new Map<string, LatLng>([
  ['s1', { latitude: -27.6, longitude: 152.9 }],
  ['s2', { latitude: -27.4, longitude: 153.1 }],
]);

describe('classifying a job', () => {
  it('is recent when completed within the last sixty days, inclusive', () => {
    expect(classifyJob(job({ status: 'complete', completedAt: daysFromNow(-1) }), NOW)).toBe('recent');
    expect(classifyJob(job({ status: 'complete', completedAt: daysFromNow(-RECENT_DAYS) }), NOW)).toBe('recent');
  });

  it('drops a job completed more than sixty days ago', () => {
    const justOver = new Date(Date.parse(NOW) - RECENT_DAYS * DAY_MS - 1).toISOString();
    expect(classifyJob(job({ status: 'complete', completedAt: justOver }), NOW)).toBeNull();
    expect(classifyJob(job({ status: 'complete', completedAt: daysFromNow(-200) }), NOW)).toBeNull();
  });

  it('reads the office stage text case-insensitively as finished', () => {
    expect(classifyJob(job({ stage: 'Invoiced', dueAt: daysFromNow(-10) }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'COMPLETE', dueAt: daysFromNow(-10) }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: ' complete ', dueAt: daysFromNow(-100) }), NOW)).toBeNull();
    // Pending is the office's word for open.
    expect(classifyJob(job({ stage: 'Pending', scheduledFor: daysFromNow(-1) }), NOW)).toBe('open');
  });

  it('falls back through the dates a finished job carries', () => {
    // The office sync never stamps completedAt, so the due date stands in.
    expect(classifyJob(job({ stage: 'Invoiced', scheduledFor: daysFromNow(-90), dueAt: daysFromNow(-5) }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'Invoiced', scheduledFor: daysFromNow(-5) }), NOW)).toBe('recent');
    // With no date at all it is not shown rather than shown forever.
    expect(classifyJob(job({ status: 'complete' }), NOW)).toBeNull();
  });

  it('is upcoming when scheduled after now and open when scheduled before', () => {
    expect(classifyJob(job({ scheduledFor: daysFromNow(3) }), NOW)).toBe('upcoming');
    expect(classifyJob(job({ scheduledFor: daysFromNow(-3) }), NOW)).toBe('open');
    expect(classifyJob(job({ scheduledFor: NOW }), NOW)).toBe('open');
  });

  it('treats in-progress, blocked and unscheduled work as on now', () => {
    expect(classifyJob(job({ status: 'in-progress', scheduledFor: daysFromNow(5) }), NOW)).toBe('upcoming');
    expect(classifyJob(job({ status: 'in-progress' }), NOW)).toBe('open');
    expect(classifyJob(job({ status: 'blocked' }), NOW)).toBe('open');
    expect(classifyJob(job({}), NOW)).toBe('open');
  });
});

describe('building pins', () => {
  it('gives each located site one pin and counts the rest as unlocated', () => {
    const built = buildPins({ sites: SITES, jobs: [], positions: POSITIONS, now: NOW });
    expect(built.pins.map((p) => p.siteId).sort()).toEqual(['s1', 's2']);
    expect(built.unlocated).toBe(1);
    expect(built.counts).toEqual({ open: 0, upcoming: 0, recent: 0, site: 2 });
  });

  it('colours a site by its strongest job: open over upcoming over recent over site', () => {
    const jobs = [
      job({ siteId: 's1', status: 'complete', completedAt: daysFromNow(-2) }),
      job({ siteId: 's1', scheduledFor: daysFromNow(4) }),
      job({ siteId: 's1', status: 'in-progress' }),
      job({ siteId: 's2', status: 'complete', completedAt: daysFromNow(-2) }),
      job({ siteId: 's2', scheduledFor: daysFromNow(4) }),
    ];
    const built = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW });
    const byId = new Map(built.pins.map((p) => [p.siteId, p]));
    expect(byId.get('s1')?.kind).toBe('open');
    expect(byId.get('s2')?.kind).toBe('upcoming');
    expect(built.counts).toEqual({ open: 1, upcoming: 1, recent: 0, site: 0 });
  });

  it('goes grey when the only jobs are old history', () => {
    const jobs = [job({ siteId: 's1', status: 'complete', completedAt: daysFromNow(-400) })];
    const built = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW });
    expect(built.pins.find((p) => p.siteId === 's1')?.kind).toBe('site');
    expect(built.pins.find((p) => p.siteId === 's1')?.lines).toEqual([]);
  });

  it('carries the popup text: name, address, client and up to three job lines', () => {
    const jobs = [
      job({ siteId: 's1', title: 'Annual service', scheduledFor: '2026-09-10T00:00:00.000Z' }),
      job({ siteId: 's1', title: 'Callout', status: 'in-progress', scheduledFor: '2026-09-01T00:00:00.000Z' }),
      job({ siteId: 's1', title: 'Old invoice', status: 'complete', completedAt: daysFromNow(-3) }),
      job({ siteId: 's1', title: 'Another old invoice', status: 'complete', completedAt: daysFromNow(-4) }),
    ];
    const pin = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW }).pins.find((p) => p.siteId === 's1')!;
    expect(pin.title).toBe('Riverbend Plaza');
    expect(pin.subtitle).toBe('12 Example St, Springfield QLD 4300');
    expect(pin.client).toBe('Acme Property');
    expect(pin.latitude).toBe(-27.6);
    expect(pin.lines).toHaveLength(3);
    // Most pressing first, and the date is the Queensland day in Australian order.
    expect(pin.lines[0]).toBe('Callout · 01/09/2026');
    expect(pin.lines[1]).toBe('Annual service · 10/09/2026');
    expect(pin.lines[2]).toMatch(/^Old invoice · \d\d\/\d\d\/\d{4}$/);
  });

  it('falls back to a job’s own coordinates for a site the cache has not reached', () => {
    const jobs = [job({ siteId: 's3', latitude: -27.9, longitude: 153.3 })];
    const built = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW });
    expect(built.unlocated).toBe(0);
    const pin = built.pins.find((p) => p.siteId === 's3')!;
    expect(pin.latitude).toBe(-27.9);
    expect(pin.kind).toBe('open');
  });

  it('does not put a site on null island', () => {
    const jobs = [job({ siteId: 's3', latitude: 0, longitude: 0 })];
    expect(buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW }).unlocated).toBe(1);
  });

  it('prefers the most recently updated job’s position', () => {
    const positions = jobPositions([
      job({ siteId: 's9', latitude: -1, longitude: 1, updatedAt: '2020-01-01T00:00:00Z' }),
      job({ siteId: 's9', latitude: -2, longitude: 2, updatedAt: '2026-01-01T00:00:00Z' }),
      job({ siteId: 's9', latitude: -3, longitude: 3, updatedAt: '2023-01-01T00:00:00Z' }),
    ]);
    expect(positions.get('s9')).toEqual({ latitude: -2, longitude: 2 });
  });
});

describe('filtering pins', () => {
  const jobs = [job({ siteId: 's1', status: 'in-progress' })];
  const pins = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW }).pins;
  const all = new Set<PinKind>(PIN_KINDS);

  it('matches the client name, case-insensitively', () => {
    expect(filterPins(pins, { kinds: all, query: 'northwind' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(filterPins(pins, { kinds: all, query: '  ACME ' }).map((p) => p.siteId)).toEqual(['s1']);
  });

  it('matches the site name and the address', () => {
    expect(filterPins(pins, { kinds: all, query: 'harbour' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(filterPins(pins, { kinds: all, query: 'example st' }).map((p) => p.siteId)).toEqual(['s1']);
  });

  it('drops the kinds that are switched off', () => {
    expect(filterPins(pins, { kinds: new Set<PinKind>(['site']), query: '' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(filterPins(pins, { kinds: new Set<PinKind>(['open']), query: '' }).map((p) => p.siteId)).toEqual(['s1']);
    expect(filterPins(pins, { kinds: new Set<PinKind>(), query: '' })).toEqual([]);
  });

  it('shows everything for an empty query', () => {
    expect(filterPins(pins, { kinds: all, query: '' })).toHaveLength(2);
  });
});

describe('links out', () => {
  it('builds the Waze universal link', () => {
    expect(wazeUrl(-27.47, 153.02)).toBe('https://waze.com/ul?ll=-27.47,153.02&navigate=yes');
  });

  it('builds the Google Maps directions link', () => {
    expect(googleMapsUrl(-27.47, 153.02)).toBe('https://www.google.com/maps/dir/?api=1&destination=-27.47,153.02');
  });

  it('reads the page’s messages and nothing else', () => {
    expect(parseMapMessage(JSON.stringify({ type: 'navigate', app: 'waze', lat: -27.5, lng: 153 })))
      .toEqual({ type: 'navigate', app: 'waze', latitude: -27.5, longitude: 153 });
    expect(parseMapMessage(JSON.stringify({ type: 'open', siteId: 's1' }))).toEqual({ type: 'open', siteId: 's1' });
    expect(parseMapMessage(JSON.stringify({ type: 'navigate', app: 'apple', lat: -27.5, lng: 153 }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'navigate', app: 'waze', lat: 0, lng: 0 }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'open' }))).toBeNull();
    expect(parseMapMessage('not json')).toBeNull();
  });
});

describe('the page', () => {
  const hostile: MapSite = {
    id: 'h1',
    name: `Bad "Site" </script><script>alert('x')</script>`,
    address: "1 O'Reilly St",
    suburb: 'Springfield',
    state: 'QLD',
    postcode: '4300',
    clientName: 'Acme & Sons <b>',
  };
  const pins = buildPins({ sites: [hostile], jobs: [], positions: new Map([['h1', { latitude: -27.5, longitude: 153 }]]), now: NOW }).pins;
  const page = mapHtml(pins, { centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: true });

  it('neutralises a closing script tag inside a site name', () => {
    // Exactly one </script> per script block in the page — ours — and none
    // from the data.
    const opened = (page.match(/<script[\s>]/g) ?? []).length;
    const closed = (page.match(/<\/script>/g) ?? []).length;
    expect(closed).toBe(opened);
    expect(page).toContain('\\u003c/script>');
    expect(page).not.toContain(`alert('x')</script>`);
  });

  it('keeps the data a valid literal after escaping', () => {
    const literal = jsLiteral({ name: hostile.name });
    expect(JSON.parse(literal)).toEqual({ name: hostile.name });
    expect(literal).not.toContain('<');
  });

  it('carries the OpenStreetMap attribution and tiles', () => {
    // Embedded as a JS literal, so it is the escaped form that has to be there.
    expect(page).toContain(jsLiteral(OSM_ATTRIBUTION));
    expect(page).toContain('openstreetmap.org/copyright');
    expect(page).toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(page).toContain('leaflet@1.9.4');
  });

  it('carries every kind’s colour and label for the legend', () => {
    for (const kind of PIN_KINDS) {
      expect(page).toContain(PIN_COLOUR[kind]);
      expect(page).toContain(PIN_LABEL[kind]);
    }
  });

  it('darkens the tiles only in dark mode', () => {
    expect(page).toContain('.leaflet-tile-pane{filter:invert(1)');
    const light = mapHtml(pins, { centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: false });
    expect(light).not.toContain('.leaflet-tile-pane{filter:invert(1)');
  });

  it('exposes the two hooks the screen drives it through', () => {
    expect(page).toContain('window.__setFilter = function');
    expect(page).toContain('window.__centre = function');
    expect(filterScript(new Set<PinKind>(['open', 'site']), 'a<b')).toBe(
      'window.__setFilter && window.__setFilter(["open","site"], "a\\u003cb"); true;',
    );
    expect(centreScript(-27.5, 153.1)).toBe('window.__centre && window.__centre(-27.5, 153.1); true;');
  });
});

describe('small helpers', () => {
  it('formats counts with thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(812)).toBe('812');
    expect(formatCount(3059)).toBe('3,059');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('writes an address line without stray commas for missing parts', () => {
    expect(siteAddressLine({ id: 'x', name: 'X', suburb: 'Springfield', state: 'QLD' })).toBe('Springfield QLD');
    expect(siteAddressLine({ id: 'x', name: 'X', address: '5 Example Rd' })).toBe('5 Example Rd');
    expect(siteAddressLine({ id: 'x', name: 'X' })).toBe('');
  });
});
