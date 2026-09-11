import {
  DEFAULT_KINDS, LEAFLET_CSS_INTEGRITY, LEAFLET_CSS_URL, LEAFLET_JS_INTEGRITY, LEAFLET_JS_URL, LEAFLET_VERSION,
  OSM_ATTRIBUTION, PIN_COLOUR, PIN_KINDS, PIN_LABEL, RECENT_DAYS,
  buildPins, centreScript, classifyJob, filterPins, filterScript, formatCount, googleMapsUrl, hereScript, isRecentDay,
  jobPositions, jsLiteral, mapHtml, mapUserAgent, parseMapMessage, pinSearchText, placesScript, quoteIsOpen,
  recentSinceDay, selectScript, siteAddressLine, visibleKind, wazeUrl,
  type LatLng, type MapJob, type MapQuote, type MapSite, type PinKind,
} from '@/domain/mapPins';

/**
 * The service map's rules.
 *
 * Checked at the boundaries, because that is where a map lies: a job finished
 * ninety days ago is either the last green dot or a site that has gone grey,
 * and the two read as different companies.
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

function quote(patch: Partial<MapQuote> = {}): MapQuote {
  seq += 1;
  return { externalId: `${500 + seq}`, siteId: 's1', name: `Quote ${seq}`, isClosed: false, ...patch };
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

const ALL = new Set<PinKind>(PIN_KINDS);

describe('the kinds', () => {
  it('are ordered strongest first, with the quote between recent work and a plain site', () => {
    expect(PIN_KINDS).toEqual(['open', 'upcoming', 'recent', 'quote', 'site']);
    expect(PIN_COLOUR.quote).toBe('#B197FC');
  });

  it('start with the live work and the sites on, and the quarter’s invoices and the quotes off', () => {
    expect([...DEFAULT_KINDS].sort()).toEqual(['open', 'site', 'upcoming']);
  });
});

describe('classifying a job', () => {
  it('is recent when completed within the window, inclusive', () => {
    expect(RECENT_DAYS).toBe(90);
    expect(classifyJob(job({ status: 'complete', completedAt: daysFromNow(-1) }), NOW)).toBe('recent');
    expect(classifyJob(job({ status: 'complete', completedAt: daysFromNow(-RECENT_DAYS) }), NOW)).toBe('recent');
  });

  it('drops a job completed before the window', () => {
    expect(classifyJob(job({ status: 'complete', completedAt: daysFromNow(-200) }), NOW)).toBeNull();
  });

  it('draws the boundary on the Queensland calendar, the way the invoice read and the repository do', () => {
    // The window starts on 4 June. A job closed at one minute to midnight on
    // 3 June, Brisbane time, is out; one closed at midnight is in, however
    // early in UTC terms that is — and a completion day of the 4th is in
    // outright, not out by the two hours between UTC midnight and now.
    expect(recentSinceDay(NOW)).toBe('2026-06-04');
    expect(classifyJob(job({ status: 'complete', completedAt: '2026-06-03T13:59:59.999Z' }), NOW)).toBeNull();
    expect(classifyJob(job({ status: 'complete', completedAt: '2026-06-03T14:00:00.000Z' }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'Invoiced', completedDate: '2026-06-04' }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'Invoiced', completedDate: '2026-06-03' }), NOW)).toBeNull();
  });

  it('reads the office stage text case-insensitively as finished', () => {
    expect(classifyJob(job({ stage: 'Invoiced', dueAt: daysFromNow(-10) }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'COMPLETE', dueAt: daysFromNow(-10) }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: ' complete ', dueAt: daysFromNow(-100) }), NOW)).toBeNull();
    // Pending is the office's word for open.
    expect(classifyJob(job({ stage: 'Pending', scheduledFor: daysFromNow(-1) }), NOW)).toBe('open');
  });

  it('falls back through the dates a finished job carries', () => {
    // The office sync never stamps completedAt; its completion day comes
    // first, then the due date, then the issue date.
    expect(classifyJob(job({ stage: 'Invoiced', scheduledFor: daysFromNow(-200), dueAt: daysFromNow(-100), completedDate: '2026-08-20' }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'Invoiced', scheduledFor: daysFromNow(-200), dueAt: daysFromNow(-5) }), NOW)).toBe('recent');
    expect(classifyJob(job({ stage: 'Invoiced', scheduledFor: daysFromNow(-5) }), NOW)).toBe('recent');
    // With no date at all it is not shown rather than shown forever.
    expect(classifyJob(job({ status: 'complete' }), NOW)).toBeNull();
  });

  it('is upcoming when scheduled after now and open when scheduled before', () => {
    expect(classifyJob(job({ scheduledFor: daysFromNow(3) }), NOW)).toBe('upcoming');
    expect(classifyJob(job({ scheduledFor: daysFromNow(-3) }), NOW)).toBe('open');
    expect(classifyJob(job({ scheduledFor: NOW }), NOW)).toBe('open');
  });

  it('is upcoming on the office’s booking, not on the day the job was issued', () => {
    // The office's job record only carries the day it was issued, which the
    // sync stores as scheduledFor; the booking is a block on the schedule.
    // An open job issued last week and booked for next week is upcoming.
    expect(classifyJob(job({ stage: 'Pending', scheduledFor: '2026-08-26', scheduledDay: '2026-09-10' }), NOW)).toBe('upcoming');
    // Booked for today is on now, and so is an open job with no booking held.
    expect(classifyJob(job({ stage: 'Pending', scheduledFor: '2026-08-26', scheduledDay: '2026-09-02' }), NOW)).toBe('open');
    expect(classifyJob(job({ stage: 'Pending', scheduledFor: '2026-08-26' }), NOW)).toBe('open');
    expect(classifyJob(job({ stage: 'Progress', scheduledFor: '2026-09-02' }), NOW)).toBe('open');
  });

  it('compares days on the Queensland calendar, so a job booked for today is on now from midnight', () => {
    // Six in the morning on 2 September in Brisbane is still 1 September in
    // UTC. A day-only date read as a UTC-midnight instant would put today's
    // booking four hours in the future and colour it upcoming until ten.
    const earlyMorning = '2026-09-01T20:00:00.000Z';
    expect(classifyJob(job({ scheduledFor: '2026-09-02' }), earlyMorning)).toBe('open');
    expect(classifyJob(job({ scheduledDay: '2026-09-02' }), earlyMorning)).toBe('open');
    expect(classifyJob(job({ scheduledDay: '2026-09-03' }), earlyMorning)).toBe('upcoming');
    // And a planned instant on the phone reads by its Queensland day too.
    expect(classifyJob(job({ scheduledFor: '2026-09-02T22:00:00.000Z' }), earlyMorning)).toBe('upcoming');
    expect(classifyJob(job({ scheduledFor: '2026-09-02T04:00:00.000Z' }), earlyMorning)).toBe('open');
  });

  it('treats in-progress, blocked and unscheduled work as on now', () => {
    expect(classifyJob(job({ status: 'in-progress', scheduledFor: daysFromNow(5) }), NOW)).toBe('upcoming');
    expect(classifyJob(job({ status: 'in-progress' }), NOW)).toBe('open');
    expect(classifyJob(job({ status: 'blocked' }), NOW)).toBe('open');
    expect(classifyJob(job({}), NOW)).toBe('open');
  });
});

describe('the recent window on the Queensland calendar', () => {
  it('starts ninety days back, as a Queensland day', () => {
    // 2 September minus 90 days is 4 June; the instant is midday Brisbane.
    expect(recentSinceDay(NOW)).toBe('2026-06-04');
  });

  it('takes an invoice day on or after the start and not one before it', () => {
    const since = recentSinceDay(NOW);
    expect(isRecentDay('2026-06-04', since)).toBe(true);
    expect(isRecentDay('2026-09-01', since)).toBe(true);
    expect(isRecentDay('2026-06-03', since)).toBe(false);
    expect(isRecentDay(undefined, since)).toBe(false);
    expect(isRecentDay('not a day', since)).toBe(false);
  });

  it('knows an open quote from a closed or converted one', () => {
    expect(quoteIsOpen(quote())).toBe(true);
    expect(quoteIsOpen(quote({ isClosed: true }))).toBe(false);
    expect(quoteIsOpen(quote({ jobExternalId: '4001' }))).toBe(false);
  });
});

describe('building pins', () => {
  it('gives each located site one pin and counts the rest as unlocated', () => {
    const built = buildPins({ sites: SITES, jobs: [], positions: POSITIONS, now: NOW });
    expect(built.pins.map((p) => p.siteId).sort()).toEqual(['s1', 's2']);
    expect(built.unlocated).toBe(1);
    expect(built.counts).toEqual({ open: 0, upcoming: 0, recent: 0, quote: 0, site: 2 });
    expect(built.pins.every((p) => p.kind === 'site' && p.kinds.length === 1)).toBe(true);
  });

  it('colours a site by its strongest kind and carries every kind it has, strongest first', () => {
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
    expect(byId.get('s1')?.kinds).toEqual(['open', 'upcoming', 'recent', 'site']);
    expect(byId.get('s2')?.kind).toBe('upcoming');
    expect(byId.get('s2')?.kinds).toEqual(['upcoming', 'recent', 'site']);
    // A site counts under every kind it has, so the legend says how many
    // sites have recent work, not how many are coloured green.
    expect(built.counts).toEqual({ open: 1, upcoming: 2, recent: 2, quote: 0, site: 2 });
  });

  it('goes grey when the only jobs are old history', () => {
    const jobs = [job({ siteId: 's1', status: 'complete', completedAt: daysFromNow(-400) })];
    const built = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW });
    const pin = built.pins.find((p) => p.siteId === 's1')!;
    expect(pin.kind).toBe('site');
    expect(pin.kinds).toEqual(['site']);
    expect(pin.lines).toEqual([]);
    expect(pin.refs).toEqual([]);
  });

  it('is recent on the strength of an invoice inside the window, from the invoices table', () => {
    const sites: MapSite[] = [
      { ...SITES[0]!, lastInvoicedAt: '2026-08-05' },
      { ...SITES[1]!, lastInvoicedAt: '2026-05-01' },
    ];
    const built = buildPins({ sites, jobs: [], positions: POSITIONS, now: NOW });
    const byId = new Map(built.pins.map((p) => [p.siteId, p]));
    expect(byId.get('s1')?.kind).toBe('recent');
    expect(byId.get('s1')?.lines).toEqual(['Invoiced · 05/08/2026']);
    expect(byId.get('s2')?.kind).toBe('site');
    expect(built.counts.recent).toBe(1);
  });

  it('is a quote where an open quote sits on the site, and not for a closed or converted one', () => {
    const quotes = [
      quote({ siteId: 's1', externalId: '555', name: 'Sprinkler upgrade' }),
      quote({ siteId: 's2', externalId: '556', isClosed: true }),
      quote({ siteId: 's2', externalId: '557', jobExternalId: '9' }),
      quote({ siteId: undefined, externalId: '558' }),
    ];
    const built = buildPins({ sites: SITES, jobs: [], quotes, positions: POSITIONS, now: NOW });
    const byId = new Map(built.pins.map((p) => [p.siteId, p]));
    expect(byId.get('s1')?.kind).toBe('quote');
    expect(byId.get('s1')?.kinds).toEqual(['quote', 'site']);
    expect(byId.get('s1')?.lines).toEqual(['Quote 555 · Sprinkler upgrade']);
    expect(byId.get('s1')?.refs).toEqual(['555']);
    expect(byId.get('s2')?.kind).toBe('site');
    expect(built.counts.quote).toBe(1);
  });

  it('ranks a job on now above a quote, and a quote above a plain site', () => {
    const jobs = [job({ siteId: 's1', status: 'in-progress', externalId: '43747' })];
    const quotes = [quote({ siteId: 's1', externalId: '555' })];
    const pin = buildPins({ sites: SITES, jobs, quotes, positions: POSITIONS, now: NOW }).pins.find((p) => p.siteId === 's1')!;
    expect(pin.kinds).toEqual(['open', 'quote', 'site']);
    expect(pin.refs).toEqual(['43747', '555']);
  });

  it('carries the card text: name, address, client, customer and up to three lines', () => {
    const jobs = [
      job({ siteId: 's1', title: 'Annual service', scheduledFor: '2026-09-10T00:00:00.000Z' }),
      job({ siteId: 's1', title: 'Callout', status: 'in-progress', scheduledFor: '2026-09-01T00:00:00.000Z' }),
      job({ siteId: 's1', title: 'Old invoice', status: 'complete', completedAt: daysFromNow(-3) }),
      job({ siteId: 's1', title: 'Another old invoice', status: 'complete', completedAt: daysFromNow(-4) }),
    ];
    const sites: MapSite[] = [{ ...SITES[0]!, customerExternalId: '812', customerName: 'Acme Property Pty Ltd' }];
    const pin = buildPins({ sites, jobs, positions: POSITIONS, now: NOW }).pins.find((p) => p.siteId === 's1')!;
    expect(pin.title).toBe('Riverbend Plaza');
    expect(pin.subtitle).toBe('12 Example St, Springfield QLD 4300');
    // The office's client name wins where the site has one; the customer id
    // travels regardless.
    expect(pin.client).toBe('Acme Property');
    expect(pin.customerExternalId).toBe('812');
    expect(pin.latitude).toBe(-27.6);
    expect(pin.lines).toHaveLength(3);
    // Most pressing first, and the date is the Queensland day in Australian order.
    expect(pin.lines[0]).toBe('Callout · 01/09/2026');
    expect(pin.lines[1]).toBe('Annual service · 10/09/2026');
    expect(pin.lines[2]).toMatch(/^Old invoice · \d\d\/\d\d\/\d{4}$/);
  });

  it('dates a line by the booking where there is one, and orders the upcoming ones soonest first', () => {
    const jobs = [
      job({ siteId: 's1', title: 'Later routine', stage: 'Pending', scheduledFor: '2026-08-20', scheduledDay: '2026-09-20' }),
      job({ siteId: 's1', title: 'Sooner routine', stage: 'Pending', scheduledFor: '2026-08-25', scheduledDay: '2026-09-10' }),
    ];
    const pin = buildPins({ sites: SITES, jobs, positions: POSITIONS, now: NOW }).pins.find((p) => p.siteId === 's1')!;
    expect(pin.kind).toBe('upcoming');
    expect(pin.lines).toEqual(['Sooner routine · 10/09/2026', 'Later routine · 20/09/2026']);
  });

  it('uses the customer name where the site has no client', () => {
    const sites: MapSite[] = [{ ...SITES[0]!, clientName: undefined, customerName: 'Harbourline Body Corporate' }];
    const pin = buildPins({ sites, jobs: [], positions: POSITIONS, now: NOW }).pins[0]!;
    expect(pin.client).toBe('Harbourline Body Corporate');
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
  const jobs = [job({ siteId: 's1', status: 'in-progress', externalId: '43747', title: 'Callout' })];
  const quotes = [quote({ siteId: 's2', externalId: '555' })];
  const pins = buildPins({ sites: SITES, jobs, quotes, positions: POSITIONS, now: NOW }).pins;

  it('matches the client name, case-insensitively', () => {
    expect(filterPins(pins, { kinds: ALL, query: 'northwind' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(filterPins(pins, { kinds: ALL, query: '  ACME ' }).map((p) => p.siteId)).toEqual(['s1']);
  });

  it('matches the site name and the address', () => {
    expect(filterPins(pins, { kinds: ALL, query: 'harbour' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(filterPins(pins, { kinds: ALL, query: 'example st' }).map((p) => p.siteId)).toEqual(['s1']);
  });

  it('matches a job number and a quote number', () => {
    expect(filterPins(pins, { kinds: ALL, query: '43747' }).map((p) => p.siteId)).toEqual(['s1']);
    expect(filterPins(pins, { kinds: ALL, query: '555' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(pinSearchText(pins[0]!)).toContain('43747');
  });

  it('treats the kinds as layers: a site whose colour is off goes grey rather than vanishing', () => {
    const grey = filterPins(pins, { kinds: new Set<PinKind>(['site']), query: '' });
    expect(grey.map((p) => [p.siteId, p.kind])).toEqual([['s1', 'site'], ['s2', 'site']]);
    // And the pin handed back is a copy coloured for these layers, not the original recoloured.
    expect(pins.find((p) => p.siteId === 's1')?.kind).toBe('open');
  });

  it('hides the plain sites when only the live layers are on', () => {
    expect(filterPins(pins, { kinds: new Set<PinKind>(['open']), query: '' }).map((p) => p.siteId)).toEqual(['s1']);
    expect(filterPins(pins, { kinds: new Set<PinKind>(['quote']), query: '' }).map((p) => p.siteId)).toEqual(['s2']);
    expect(filterPins(pins, { kinds: new Set<PinKind>(), query: '' })).toEqual([]);
  });

  it('picks the strongest layer that is on', () => {
    const pin = { kinds: ['open', 'recent', 'site'] as PinKind[] };
    expect(visibleKind(pin, new Set<PinKind>(['recent', 'site']))).toBe('recent');
    expect(visibleKind(pin, new Set<PinKind>(['upcoming']))).toBeNull();
  });

  it('shows everything for an empty query', () => {
    expect(filterPins(pins, { kinds: ALL, query: '' })).toHaveLength(2);
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
    expect(parseMapMessage(JSON.stringify({ type: 'select', siteId: 's1' }))).toEqual({ type: 'select', siteId: 's1' });
    expect(parseMapMessage(JSON.stringify({ type: 'place', placeId: 'osm:1' }))).toEqual({ type: 'place', placeId: 'osm:1' });
    expect(parseMapMessage(JSON.stringify({ type: 'clear' }))).toEqual({ type: 'clear' });
    expect(parseMapMessage(JSON.stringify({ type: 'select' }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'place', placeId: '' }))).toBeNull();
    // The page no longer navigates or opens anything itself; the card does.
    expect(parseMapMessage(JSON.stringify({ type: 'navigate', app: 'waze', lat: -27.5, lng: 153 }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'open', siteId: 's1' }))).toBeNull();
    expect(parseMapMessage('not json')).toBeNull();
  });

  it('reads a tapped link only when it is a web address, and the view only when it is somewhere', () => {
    expect(parseMapMessage(JSON.stringify({ type: 'link', url: 'https://www.openstreetmap.org/copyright' })))
      .toEqual({ type: 'link', url: 'https://www.openstreetmap.org/copyright' });
    expect(parseMapMessage(JSON.stringify({ type: 'link', url: 'javascript:alert(1)' }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'link', url: 'about:blank#' }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'view', lat: -27.5, lng: 153, zoom: 12 })))
      .toEqual({ type: 'view', view: { centre: { latitude: -27.5, longitude: 153 }, zoom: 12 } });
    expect(parseMapMessage(JSON.stringify({ type: 'view', lat: 0, lng: 0, zoom: 12 }))).toBeNull();
    expect(parseMapMessage(JSON.stringify({ type: 'view', lat: -27.5, lng: 153 }))).toBeNull();
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

  it('loads Leaflet pinned to the byte, with an integrity hash on the script and the stylesheet', () => {
    // A CDN answering with anything but these exact files gets a map that
    // fails to draw, not a page that runs somebody else's script over the
    // whole site list.
    expect(LEAFLET_VERSION).toBe('1.9.4');
    expect(LEAFLET_JS_INTEGRITY).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(LEAFLET_CSS_INTEGRITY).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(page).toContain(`<script src="${LEAFLET_JS_URL}" integrity="${LEAFLET_JS_INTEGRITY}" crossorigin="anonymous"></script>`);
    expect(page).toContain(`<link rel="stylesheet" href="${LEAFLET_CSS_URL}" integrity="${LEAFLET_CSS_INTEGRITY}" crossorigin="anonymous">`);
    // Nothing external without an integrity attribute.
    for (const tag of page.match(/<(?:script|link)\b[^>]*https?:[^>]*>/g) ?? []) expect(tag).toContain('integrity="sha256-');
  });

  it('fetches tiles for the viewport only, once a pan has settled', () => {
    expect(page).toContain('updateWhenIdle: true');
    expect(page).toContain('updateWhenZooming: false');
    expect(page).toContain('keepBuffer: 1');
  });

  it('names the app and a contact in what the WebView appends to its User-Agent', () => {
    expect(mapUserAgent('service@example.com.au')).toBe('SafeQLD-FieldApp/1.0 (service map; service@example.com.au)');
    expect(mapUserAgent('  ')).toBe('SafeQLD-FieldApp/1.0 (service map)');
  });

  it('hands every link in the page to the phone rather than following it', () => {
    // The attribution is a link, and a WebView that follows it has no way
    // back to the map. The page intercepts anchors and posts them instead.
    expect(page).toContain("document.addEventListener('click'");
    expect(page).toContain("post({ type: 'link', url: el.href })");
    expect(page).toContain('e.preventDefault()');
  });

  it('keeps the attribution clear of the tab bar by whatever clearance the screen gives it', () => {
    expect(page).toContain('.leaflet-bottom{bottom:96px}');
    const tall = mapHtml(pins, { centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: true, bottomClearancePx: 114 });
    expect(tall).toContain('.leaflet-bottom{bottom:114px}');
  });

  it('opens on the saved view when it has one, and fits to the pins when it does not', () => {
    expect(page).toContain('var VIEW = null;');
    expect(page).toContain('if (VIEW) {');
    const restored = mapHtml(pins, {
      centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: true,
      view: { centre: { latitude: -26.65, longitude: 153.07 }, zoom: 12 },
    });
    expect(restored).toContain('var VIEW = [-26.65,153.07,12];');
    expect(page).toContain("map.on('moveend', postView)");
  });

  it('carries every kind’s colour, and the layers that start on', () => {
    for (const kind of PIN_KINDS) expect(page).toContain(PIN_COLOUR[kind]);
    expect(page).toContain(`var DEFAULT_KINDS = ${jsLiteral(DEFAULT_KINDS)};`);
    const custom = mapHtml(pins, { centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: true, kinds: ['open'] });
    expect(custom).toContain('var DEFAULT_KINDS = ["open"];');
    // Labels are the card's business now, not the page's.
    expect(page).not.toContain(PIN_LABEL.open);
  });

  it('gives the page only what it draws with: no names, no addresses, just the search text', () => {
    expect(page).toContain('"search":');
    expect(page).not.toContain('"title":');
    expect(page).not.toContain('"subtitle":');
  });

  it('darkens the tiles only in dark mode', () => {
    expect(page).toContain('.leaflet-tile-pane{filter:invert(1)');
    const light = mapHtml(pins, { centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: false });
    expect(light).not.toContain('.leaflet-tile-pane{filter:invert(1)');
  });

  it('exposes the hooks the screen drives it through', () => {
    expect(page).toContain('window.__setFilter = function');
    expect(page).toContain('window.__setPlaces = function');
    expect(page).toContain('window.__select = function');
    expect(page).toContain('window.__centre = function');
    // Drawing the technician's dot and moving the map to it are separate
    // hooks: only the button may move the map.
    expect(page).toContain('window.__here = function');
    expect(page).toContain('window.__here(lat, lng);\n  map.setView');
    expect(hereScript(-27.5, 153.1)).toBe('window.__here && window.__here(-27.5, 153.1); true;');
    expect(filterScript(new Set<PinKind>(['open', 'site']), 'a<b')).toBe(
      'window.__setFilter && window.__setFilter(["open","site"], "a\\u003cb", false); true;',
    );
    expect(filterScript(new Set<PinKind>(['open']), 'x', true)).toContain(', true); true;');
    expect(centreScript(-27.5, 153.1)).toBe('window.__centre && window.__centre(-27.5, 153.1); true;');
    expect(placesScript([{ id: 'osm:1', name: 'Bunnings <b>', latitude: -27.5, longitude: 153 }])).toBe(
      'window.__setPlaces && window.__setPlaces([{"id":"osm:1","lat":-27.5,"lng":153,"name":"Bunnings \\u003cb>"}]); true;',
    );
    expect(selectScript({ siteId: 's1' })).toBe('window.__select && window.__select({"siteId":"s1"}); true;');
    expect(selectScript(null)).toBe('window.__select && window.__select(null); true;');
  });

  it('posts a selection rather than opening anything itself', () => {
    expect(page).toContain("post({ type: 'select', siteId: p.siteId })");
    expect(page).toContain("post({ type: 'place', placeId: place.id })");
    expect(page).toContain("post({ type: 'clear' })");
    expect(page).not.toContain('onclick=');
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
    expect(siteAddressLine({ suburb: 'Springfield', state: 'QLD' })).toBe('Springfield QLD');
    expect(siteAddressLine({ address: '5 Example Rd' })).toBe('5 Example Rd');
    expect(siteAddressLine({})).toBe('');
  });
});
