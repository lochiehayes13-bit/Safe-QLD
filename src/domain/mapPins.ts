import { qldDay, qldIsoDay } from './qldTime';

/**
 * The service map: which sites get a dot, what colour it is, and the page that
 * draws them.
 *
 * Everything here is pure so the rules can be tested without a map. The screen
 * reads the database, works out where each site is, and hands the result to
 * `buildPins`; `mapHtml` turns the pins into a self-contained Leaflet page the
 * WebView renders; the filter, the search results and "my location" are
 * pushed into that page as small scripts rather than by reloading it, because
 * a reload throws away wherever the technician had panned to.
 *
 * One dot per site, not per job. A site with three jobs on it is one place to
 * drive to, and three overlapping dots at the same coordinate read as one dot
 * anyway — the colour just tells you the most pressing of them.
 *
 * A site carries every kind it qualifies for, strongest first, and the legend
 * chips are layers over that: switch "Recent" off and a site whose only news
 * is last month's invoice goes grey rather than vanishing, because it is still
 * a place the company services. Only switching "Sites" off hides the sites
 * with nothing live on them.
 */

export type PinKind = 'open' | 'upcoming' | 'recent' | 'quote' | 'site';

/** Strongest first. This is the order a site's colour is decided in, and the legend's. */
export const PIN_KINDS: readonly PinKind[] = ['open', 'upcoming', 'recent', 'quote', 'site'];

/**
 * The layers on when the map opens. Recent invoices and open quotes are a
 * tap away rather than on by default: with them on, every site the company
 * has billed this quarter is green, and the live work is lost in it.
 */
export const DEFAULT_KINDS: readonly PinKind[] = ['open', 'upcoming', 'site'];

export const PIN_COLOUR: Record<PinKind, string> = {
  open: '#FF6B1A',
  upcoming: '#4DABF7',
  recent: '#51CF66',
  quote: '#B197FC',
  site: '#9AA6B6',
};

export const PIN_LABEL: Record<PinKind, string> = {
  open: 'Job on now',
  upcoming: 'Upcoming job',
  recent: 'Recently completed / invoiced',
  quote: 'Open quote',
  site: 'Site we service',
};

/** The legend chips over the map, where the full label does not fit. */
export const PIN_SHORT: Record<PinKind, string> = {
  open: 'On now',
  upcoming: 'Upcoming',
  recent: 'Recent',
  quote: 'Quotes',
  site: 'Sites',
};

/**
 * How long finished work keeps its green dot. Ninety days: a quarter, which is
 * the cadence the office invoices routine servicing on, so "recently invoiced"
 * means "this quarter's work" rather than a site serviced last year.
 */
export const RECENT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = RECENT_DAYS * DAY_MS;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * The fields the map reads off a site. A structural subset of the site record
 * rather than an import of it, so this module stays clear of the database and
 * the screen can pass its rows straight through.
 */
export interface MapSite {
  id: string;
  name: string;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  clientName?: string | null;
  /** The office's customer on the site's latest job, where the mirror knows it. */
  customerExternalId?: string | null;
  customerName?: string | null;
  /** The day the site's jobs were last invoiced, yyyy-mm-dd, from the invoices table. */
  lastInvoicedAt?: string | null;
}

/** Likewise for a job. `status` is the app's own; `stage` is the office's text. */
export interface MapJob {
  id: string;
  /** The office's job number, which is what a technician searches by. */
  externalId?: string | null;
  siteId?: string | null;
  title: string;
  stage?: string | null;
  status: 'scheduled' | 'in-progress' | 'complete' | 'blocked';
  scheduledFor?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  /** The office's completion day, yyyy-mm-dd. */
  completedDate?: string | null;
  updatedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** A quote from the office, as far as the map cares: whose site, and whether it is still open. */
export interface MapQuote {
  externalId: string;
  siteId?: string | null;
  name?: string | null;
  isClosed: boolean;
  /** Set once the quote became a job, at which point the job is the news. */
  jobExternalId?: string | null;
  dateIssued?: string | null;
}

export interface MapPin extends LatLng {
  siteId: string;
  /** The strongest kind. What the dot is coloured when every layer is on. */
  kind: PinKind;
  /** Every kind the site qualifies for, strongest first, always ending in 'site'. */
  kinds: PinKind[];
  /** The site name. */
  title: string;
  /** The address, as one line. */
  subtitle: string;
  client?: string;
  customerExternalId?: string;
  /** Up to three lines of news, most pressing first, each as "title · date". */
  lines: string[];
  /** Job and quote numbers on the site, so a search for "43747" finds it. */
  refs: string[];
}

/**
 * The office's stage text that means the work is finished, compared lower-case
 * because Simpro capitalises and technicians do not. "Invoiced" is finished
 * work too: the map shows where money has just been made, not where a job is
 * still open in the accounts sense.
 */
const COMPLETE_STAGES = new Set(['complete', 'completed', 'invoiced']);

function isComplete(job: MapJob): boolean {
  if (job.status === 'complete') return true;
  return COMPLETE_STAGES.has((job.stage ?? '').trim().toLowerCase());
}

function toMs(when: Date | string | number): number {
  if (when instanceof Date) return when.getTime();
  if (typeof when === 'number') return when;
  return Date.parse(when);
}

function parseMs(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The first of several optional instants that parses. */
function firstMs(...candidates: (string | null | undefined)[]): number | undefined {
  for (const c of candidates) {
    const ms = parseMs(c);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

/**
 * When a finished job was finished. The app stamps `completedAt` when a
 * technician closes a job here; the office records a completion day; failing
 * both, the due date is the nearest thing to it, and the issue date after that.
 */
function finishedMs(job: MapJob): number | undefined {
  return firstMs(job.completedAt, job.completedDate, job.dueAt, job.scheduledFor);
}

/** The date a job's line shows. */
function lineDate(job: MapJob, kind: PinKind): string | undefined {
  return kind === 'recent'
    ? (job.completedAt ?? job.completedDate ?? job.dueAt ?? job.scheduledFor ?? undefined)
    : (job.scheduledFor ?? job.dueAt ?? undefined);
}

/**
 * What colour a job contributes to its site, or null when it contributes none.
 *
 * Finished within the last ninety days is `recent`; finished earlier is not on
 * the map at all, because it is history rather than service. A finished job
 * with no date on it is treated the same way — the alternative is a green dot
 * that never goes out. Anything not finished is `upcoming` if it is scheduled
 * after now, and otherwise `open`: in progress, blocked, overdue or simply
 * unscheduled are all work that exists today.
 */
export function classifyJob(job: MapJob, now: Date | string | number = Date.now()): PinKind | null {
  const nowMs = toMs(now);
  if (isComplete(job)) {
    const finished = finishedMs(job);
    if (finished === undefined) return null;
    return nowMs - finished <= RECENT_MS ? 'recent' : null;
  }
  const scheduled = parseMs(job.scheduledFor);
  if (scheduled !== undefined && scheduled > nowMs) return 'upcoming';
  return 'open';
}

/**
 * The first Queensland day inside the recent window, yyyy-mm-dd. The screen
 * and the repository bound their invoice reads with it so the map and the
 * card agree on what "recently invoiced" means.
 */
export function recentSinceDay(now: Date | string | number = Date.now()): string {
  return qldIsoDay(new Date(toMs(now) - RECENT_MS).toISOString()) ?? '';
}

/** Whether an invoice day falls inside the recent window. Days compare as strings. */
export function isRecentDay(day: string | null | undefined, sinceDay: string): boolean {
  const d = qldIsoDay(day ?? undefined);
  return !!d && !!sinceDay && d >= sinceDay;
}

/** An open quote: not closed, and not yet turned into a job. */
export function quoteIsOpen(quote: MapQuote): boolean {
  return !quote.isClosed && !quote.jobExternalId;
}

/**
 * A coordinate that is actually somewhere. Null island is what a blank field
 * becomes on the way through a spreadsheet, and it is in the Gulf of Guinea.
 */
export function isPosition(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 && longitude === 0) return false;
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/**
 * Where each site is according to its jobs, for the sites whose jobs carry a
 * position. The most recently updated job wins, on the same reasoning as the
 * planner: a visit last week is a better guide than one in 2019.
 */
export function jobPositions(jobs: readonly MapJob[]): Map<string, LatLng> {
  const best = new Map<string, { updatedAt: string; position: LatLng }>();
  for (const job of jobs) {
    if (!job.siteId || !isPosition(job.latitude, job.longitude)) continue;
    const updatedAt = job.updatedAt ?? '';
    const current = best.get(job.siteId);
    if (current && current.updatedAt >= updatedAt) continue;
    best.set(job.siteId, { updatedAt, position: { latitude: job.latitude!, longitude: job.longitude! } });
  }
  return new Map([...best].map(([siteId, b]) => [siteId, b.position]));
}

/** The address as one line: "12 Smith St, Springfield QLD 4300". */
export function siteAddressLine(site: Pick<MapSite, 'address' | 'suburb' | 'state' | 'postcode'>): string {
  const street = (site.address ?? '').trim();
  const locality = [site.suburb, site.state, site.postcode]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return [street, locality].filter(Boolean).join(', ');
}

function strength(kind: PinKind): number {
  return PIN_KINDS.indexOf(kind);
}

export interface BuildPinsInput {
  sites: readonly MapSite[];
  jobs: readonly MapJob[];
  quotes?: readonly MapQuote[];
  /** Site id → position, from the geocode cache. */
  positions: ReadonlyMap<string, LatLng>;
  now?: Date | string | number;
}

export interface BuiltPins {
  pins: MapPin[];
  /** Sites with no position from any source. Not on the map, but counted so the screen can say so. */
  unlocated: number;
  /** How many located sites qualify for each kind. A site counts under every kind it has, so `site` is all of them. */
  counts: Record<PinKind, number>;
}

function emptyCounts(): Record<PinKind, number> {
  return { open: 0, upcoming: 0, recent: 0, quote: 0, site: 0 };
}

function groupBySite<T extends { siteId?: string | null }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    if (!item.siteId) continue;
    const list = out.get(item.siteId);
    if (list) list.push(item);
    else out.set(item.siteId, [item]);
  }
  return out;
}

/**
 * One pin per site that has a position.
 *
 * A site's colour is the strongest of its kinds — a site with a job on now and
 * three invoiced last month is a job on now. A site with no live jobs is a grey
 * dot: it is still a place the company services, and the map is also for
 * answering "do we have anything near here".
 *
 * Recent is decided two ways and either will do: a job finished inside the
 * window, or an invoice issued inside it. The invoice is the office's word and
 * covers the jobs the sync closed without a completion date; the job is the
 * technician's, and covers the work not yet billed.
 *
 * The cached position is preferred, and a job's own coordinates are the
 * fallback for a site the cache has not reached yet.
 */
export function buildPins(input: BuildPinsInput): BuiltPins {
  const now = input.now ?? Date.now();
  const sinceDay = recentSinceDay(now);
  const fromJobs = jobPositions(input.jobs);
  const jobsBySite = groupBySite(input.jobs);
  const quotesBySite = groupBySite((input.quotes ?? []).filter(quoteIsOpen));

  const pins: MapPin[] = [];
  const counts = emptyCounts();
  let unlocated = 0;

  for (const site of input.sites) {
    const position = input.positions.get(site.id) ?? fromJobs.get(site.id);
    if (!position || !isPosition(position.latitude, position.longitude)) {
      unlocated += 1;
      continue;
    }

    const classified = (jobsBySite.get(site.id) ?? [])
      .map((job) => ({ job, kind: classifyJob(job, now) }))
      .filter((c): c is { job: MapJob; kind: PinKind } => c.kind !== null)
      .sort((a, b) => {
        const byKind = strength(a.kind) - strength(b.kind);
        if (byKind !== 0) return byKind;
        // Within a colour, the nearest date first, so an upcoming job reads
        // soonest-first and recent work reads latest-first.
        const da = parseMs(lineDate(a.job, a.kind)) ?? 0;
        const db = parseMs(lineDate(b.job, b.kind)) ?? 0;
        return a.kind === 'recent' ? db - da : da - db;
      });
    const quotes = quotesBySite.get(site.id) ?? [];
    const invoiced = isRecentDay(site.lastInvoicedAt, sinceDay);

    const kinds: PinKind[] = [];
    if (classified.some((c) => c.kind === 'open')) kinds.push('open');
    if (classified.some((c) => c.kind === 'upcoming')) kinds.push('upcoming');
    if (invoiced || classified.some((c) => c.kind === 'recent')) kinds.push('recent');
    if (quotes.length) kinds.push('quote');
    kinds.push('site');

    const lines = classified.slice(0, 3).map(({ job, kind: k }) => {
      const day = qldDay(lineDate(job, k) ?? undefined);
      return day ? `${job.title} · ${day}` : job.title;
    });
    if (invoiced && lines.length < 3) {
      const day = qldDay(site.lastInvoicedAt ?? undefined);
      lines.push(day ? `Invoiced · ${day}` : 'Invoiced');
    }
    for (const quote of quotes) {
      if (lines.length >= 3) break;
      const name = (quote.name ?? '').trim();
      lines.push(name ? `Quote ${quote.externalId} · ${name}` : `Quote ${quote.externalId}`);
    }

    const refs = [
      ...classified.map((c) => (c.job.externalId ?? '').trim()).filter(Boolean),
      ...quotes.map((q) => q.externalId.trim()).filter(Boolean),
    ];

    const client = (site.clientName ?? site.customerName ?? '').trim();
    pins.push({
      siteId: site.id,
      kind: kinds[0]!,
      kinds,
      latitude: position.latitude,
      longitude: position.longitude,
      title: site.name,
      subtitle: siteAddressLine(site),
      client: client || undefined,
      customerExternalId: site.customerExternalId ?? undefined,
      lines,
      refs,
    });
    for (const k of kinds) counts[k] += 1;
  }

  return { pins, unlocated, counts };
}

export interface PinFilter {
  kinds: ReadonlySet<PinKind>;
  query: string;
}

/** The colour a pin shows with these layers on, or null when none of its kinds is on. */
export function visibleKind(pin: Pick<MapPin, 'kinds'>, kinds: ReadonlySet<PinKind>): PinKind | null {
  for (const k of pin.kinds) if (kinds.has(k)) return k;
  return null;
}

/** Everything a search runs over: name, address, client, and the job and quote numbers. */
export function pinSearchText(pin: Pick<MapPin, 'title' | 'subtitle' | 'client' | 'refs'>): string {
  return [pin.title, pin.subtitle, pin.client ?? '', ...pin.refs].join(' ').toLowerCase();
}

/**
 * The pins the technician has asked to see, each coloured by the strongest
 * of its kinds that is switched on. Text matches the site, the client, the
 * address or a job number.
 */
export function filterPins(pins: readonly MapPin[], filter: PinFilter): MapPin[] {
  const q = filter.query.trim().toLowerCase();
  const out: MapPin[] = [];
  for (const pin of pins) {
    const kind = visibleKind(pin, filter.kinds);
    if (!kind) continue;
    if (q && !pinSearchText(pin).includes(q)) continue;
    out.push(kind === pin.kind ? pin : { ...pin, kind });
  }
  return out;
}

/**
 * Waze's universal link. It is https rather than a `waze://` scheme so that a
 * phone without Waze lands on a web page offering directions instead of an
 * error about an unknown URL.
 */
export function wazeUrl(latitude: number, longitude: number): string {
  return `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
}

export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

/** 3059 → "3,059". Hand-rolled so it needs no Intl support from the JS engine. */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------------------------------------------------------------------------
// Messages from the page
// ---------------------------------------------------------------------------

export type MapMessage =
  | { type: 'select'; siteId: string }
  | { type: 'place'; placeId: string }
  | { type: 'clear' };

/**
 * What the page posted, or null for anything that is not one of its
 * messages. The page is ours, but the WebView's message channel is a string,
 * and a string is checked rather than trusted.
 */
export function parseMapMessage(raw: string): MapMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const m = parsed as Record<string, unknown>;
  if (m.type === 'select' && typeof m.siteId === 'string' && m.siteId) {
    return { type: 'select', siteId: m.siteId };
  }
  if (m.type === 'place' && typeof m.placeId === 'string' && m.placeId) {
    return { type: 'place', placeId: m.placeId };
  }
  if (m.type === 'clear') return { type: 'clear' };
  return null;
}

// ---------------------------------------------------------------------------
// Scripts pushed into the page
// ---------------------------------------------------------------------------

/**
 * A value as a JavaScript literal safe to drop inside a `<script>` block.
 *
 * `</script>` inside a site name would end the block early and hand the rest
 * of the name to the HTML parser as markup — and a site name is whatever the
 * office typed. Escaping every `<` keeps the JSON valid and the page inert to
 * it. Quotes are already JSON's problem, and JSON handles them.
 */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The script that re-filters the page in place. `fit` asks the page to pan
 * and zoom to whatever matched, for a search that was submitted rather than
 * typed. Ends in `true` because Android's WebView warns otherwise.
 */
export function filterScript(kinds: ReadonlySet<PinKind>, query: string, fit = false): string {
  return `window.__setFilter && window.__setFilter(${jsLiteral([...kinds])}, ${jsLiteral(query)}, ${fit ? 'true' : 'false'}); true;`;
}

/** The script that centres the page on the technician. */
export function centreScript(latitude: number, longitude: number): string {
  return `window.__centre && window.__centre(${Number(latitude)}, ${Number(longitude)}); true;`;
}

/** A search result on the page: a hollow marker the card can be opened from. */
export interface PlacePin extends LatLng {
  id: string;
  name: string;
}

/** The script that replaces the search results on the page and brings them into view. */
export function placesScript(places: readonly PlacePin[]): string {
  const data = places.map((p) => ({ id: p.id, lat: p.latitude, lng: p.longitude, name: p.name }));
  return `window.__setPlaces && window.__setPlaces(${jsLiteral(data)}); true;`;
}

export type MapSelection = { siteId: string } | { placeId: string } | null;

/** The script that rings the selected dot, or clears the ring. */
export function selectScript(selection: MapSelection): string {
  return `window.__select && window.__select(${jsLiteral(selection)}); true;`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export interface MapHtmlOptions {
  centre: LatLng;
  zoom: number;
  dark: boolean;
  /** The layers on at first paint. Defaults to DEFAULT_KINDS. */
  kinds?: readonly PinKind[];
  /** Clustering, overridable for tests. */
  cellPx?: number;
  clusterMaxZoom?: number;
}

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Mirrors src/domain/mapCluster.ts; the two must agree, and the test says so. */
const PAGE_CELL_PX = 56;
const PAGE_CLUSTER_MAX_ZOOM = 14;

/**
 * The whole page, as a string.
 *
 * Leaflet from a CDN and tiles from OpenStreetMap, so the map needs a
 * connection the first time and the page says so rather than sitting blank
 * when it has none. In dark mode the tile pane is inverted and hue-rotated —
 * the standard trick — so the map is not a white sheet in a plant room at
 * night. Dots are drawn on a canvas rather than as SVG elements: three
 * thousand SVG circles make panning stutter, three thousand canvas dots do not.
 * Below street zoom the dots are gathered into grid cells and drawn as counts;
 * the maths is a copy of `mapCluster.ts`, in the ES5 a WebView is sure to run.
 *
 * The page draws and reports; it decides nothing. A tap on a dot posts the
 * site id and the native card takes over, so nothing a person typed is ever
 * rendered as markup here: the only strings the page holds are search text,
 * and those are compared, never written into the document.
 */
export function mapHtml(pins: readonly MapPin[], options: MapHtmlOptions): string {
  const data = pins.map((p, i) => ({
    i,
    siteId: p.siteId,
    kinds: p.kinds,
    lat: p.latitude,
    lng: p.longitude,
    search: pinSearchText(p),
  }));

  const c = options.dark
    ? { bg: '#0B0E13', surface: '#161B24', text: '#EEF2F7', muted: '#9AA6B6', border: '#2E3847', ring: '#0B0E13' }
    : { bg: '#F8F9FA', surface: '#FFFFFF', text: '#212529', muted: '#495057', border: '#DEE2E6', ring: '#FFFFFF' };

  const darkTiles = options.dark
    ? '.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.9) saturate(.7)}'
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map{height:100%;margin:0;padding:0;background:${c.bg};font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;-webkit-tap-highlight-color:transparent}
${darkTiles}
.offline{display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:${c.muted};font-size:15px}
.leaflet-container{background:${c.bg}}
.leaflet-control-attribution{background:${c.surface}!important;color:${c.muted}!important;font-size:10px}
.leaflet-control-attribution a{color:${c.muted}!important}
.leaflet-bar a{background:${c.surface}!important;color:${c.text}!important;border-color:${c.border}!important;width:40px!important;height:40px!important;line-height:40px!important;font-size:20px!important}
.leaflet-top.leaflet-left{top:150px}
.leaflet-bottom{bottom:96px}
.clw{background:none;border:none}
.cl{display:flex;align-items:center;justify-content:center;border-radius:50%;color:#12080A;font-weight:800;border:2px solid ${c.ring};box-shadow:0 2px 8px rgba(0,0,0,.35);font-size:12px;line-height:1}
.cl-s{width:30px;height:30px}
.cl-m{width:38px;height:38px;font-size:13px}
.cl-l{width:46px;height:46px;font-size:14px}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var PINS = ${jsLiteral(data)};
var COLOUR = ${jsLiteral(PIN_COLOUR)};
var ORDER = ${jsLiteral(PIN_KINDS)};
var DEFAULT_KINDS = ${jsLiteral(options.kinds ?? DEFAULT_KINDS)};
var CENTRE = ${jsLiteral([options.centre.latitude, options.centre.longitude])};
var ZOOM = ${Number(options.zoom)};
var RING = ${jsLiteral(c.ring)};
var SURFACE = ${jsLiteral(c.surface)};
var CELL_PX = ${Number(options.cellPx ?? PAGE_CELL_PX)};
var MAX_ZOOM = ${Number(options.clusterMaxZoom ?? PAGE_CLUSTER_MAX_ZOOM)};
var TILE_PX = 256;

var state = { kinds: DEFAULT_KINDS.slice(), query: '', places: [], selected: null };
var map = null, dots = null, clusters = null, placeLayer = null, here = null, ring = null;

function post(msg) {
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
}

function strength(kind) {
  var i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length : i;
}

function visibleKind(p) {
  for (var i = 0; i < p.kinds.length; i++) {
    if (state.kinds.indexOf(p.kinds[i]) >= 0) return p.kinds[i];
  }
  return null;
}

function matches(p) {
  return !state.query || p.search.indexOf(state.query) >= 0;
}

function visiblePins() {
  var out = [];
  for (var i = 0; i < PINS.length; i++) {
    var p = PINS[i];
    var kind = visibleKind(p);
    if (!kind || !matches(p)) continue;
    out.push({ index: i, latitude: p.lat, longitude: p.lng, kind: kind });
  }
  return out;
}

// --- The grid, mirroring mapCluster.ts ------------------------------------

function worldPixel(latitude, longitude, zoom) {
  var scale = TILE_PX * Math.pow(2, zoom);
  var lat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  var sin = Math.sin(lat * Math.PI / 180);
  return {
    x: (longitude + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}

function clusterPoints(points, zoom) {
  var out = [], i, p;
  if (zoom >= MAX_ZOOM) {
    for (i = 0; i < points.length; i++) {
      p = points[i];
      out.push({ latitude: p.latitude, longitude: p.longitude, count: 1, kind: p.kind, members: [p.index] });
    }
    return out;
  }
  var cells = {}, keys = [];
  for (i = 0; i < points.length; i++) {
    p = points[i];
    var px = worldPixel(p.latitude, p.longitude, zoom);
    var key = Math.floor(px.x / CELL_PX) + ':' + Math.floor(px.y / CELL_PX);
    var cell = cells[key];
    if (cell) {
      cell.sumLat += p.latitude;
      cell.sumLng += p.longitude;
      cell.count += 1;
      cell.members.push(p.index);
      if (strength(p.kind) < strength(cell.kind)) cell.kind = p.kind;
    } else {
      cells[key] = { sumLat: p.latitude, sumLng: p.longitude, count: 1, kind: p.kind, members: [p.index] };
      keys.push(key);
    }
  }
  for (i = 0; i < keys.length; i++) {
    var c = cells[keys[i]];
    out.push({ latitude: c.sumLat / c.count, longitude: c.sumLng / c.count, count: c.count, kind: c.kind, members: c.members });
  }
  return out;
}

function expandZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.floor(zoom) + 2);
}

// --- Drawing ---------------------------------------------------------------

function clusterIcon(c) {
  var size = c.count < 10 ? 30 : c.count < 100 ? 38 : 46;
  var bucket = c.count < 10 ? 's' : c.count < 100 ? 'm' : 'l';
  var label = c.count >= 1000 ? Math.round(c.count / 100) / 10 + 'k' : String(c.count);
  return L.divIcon({
    className: 'clw',
    html: '<div class="cl cl-' + bucket + '" style="background:' + COLOUR[c.kind] + '">' + label + '</div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function addDot(c) {
  var p = PINS[c.members[0]];
  L.circleMarker([c.latitude, c.longitude], {
    radius: c.kind === 'site' ? 7 : 9,
    weight: 2,
    color: RING,
    fillColor: COLOUR[c.kind],
    fillOpacity: 0.95
  }).on('click', function (e) {
    L.DomEvent.stopPropagation(e);
    state.selected = { siteId: p.siteId };
    drawSelection();
    post({ type: 'select', siteId: p.siteId });
  }).addTo(dots);
}

function addCluster(c, zoom) {
  L.marker([c.latitude, c.longitude], { icon: clusterIcon(c), keyboard: false })
    .on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      map.setView([c.latitude, c.longitude], expandZoom(zoom));
    })
    .addTo(clusters);
}

function render() {
  if (!map) return;
  var zoom = map.getZoom();
  var cs = clusterPoints(visiblePins(), zoom);
  dots.clearLayers();
  clusters.clearLayers();
  // Weakest first so a job on now is drawn on top of the grey dots around it.
  cs.sort(function (a, b) { return strength(b.kind) - strength(a.kind); });
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].count === 1) addDot(cs[i]);
    else addCluster(cs[i], zoom);
  }
  drawSelection();
}

function addPlace(place) {
  L.circleMarker([place.lat, place.lng], {
    radius: 10,
    weight: 3,
    color: '#FF6B1A',
    fillColor: SURFACE,
    fillOpacity: 0.9
  }).on('click', function (e) {
    L.DomEvent.stopPropagation(e);
    state.selected = { placeId: place.id };
    drawSelection();
    post({ type: 'place', placeId: place.id });
  }).addTo(placeLayer);
}

function renderPlaces() {
  placeLayer.clearLayers();
  for (var i = 0; i < state.places.length; i++) addPlace(state.places[i]);
}

function selectedPosition() {
  var s = state.selected, i;
  if (!s) return null;
  if (s.siteId) {
    for (i = 0; i < PINS.length; i++) if (PINS[i].siteId === s.siteId) return [PINS[i].lat, PINS[i].lng];
  } else if (s.placeId) {
    for (i = 0; i < state.places.length; i++) if (state.places[i].id === s.placeId) return [state.places[i].lat, state.places[i].lng];
  }
  return null;
}

function drawSelection() {
  if (ring) { map.removeLayer(ring); ring = null; }
  var at = selectedPosition();
  if (!at) return;
  ring = L.circleMarker(at, { radius: 16, weight: 3, color: '#FFFFFF', fillOpacity: 0, interactive: false }).addTo(map);
}

function fitTo(latLngs, maxZoom) {
  if (!latLngs.length) return;
  if (latLngs.length === 1) {
    map.setView(latLngs[0], Math.max(map.getZoom(), maxZoom));
    return;
  }
  // The card sits over the bottom of the map and the search over the top.
  map.fitBounds(L.latLngBounds(latLngs), { paddingTopLeft: [28, 150], paddingBottomRight: [28, 200], maxZoom: maxZoom });
}

// --- Hooks the screen drives ----------------------------------------------

window.__setFilter = function (kinds, query, fit) {
  state.kinds = Array.isArray(kinds) ? kinds : DEFAULT_KINDS.slice();
  state.query = String(query || '').trim().toLowerCase();
  render();
  if (fit && map) {
    var pts = visiblePins();
    if (pts.length && pts.length <= 500) {
      fitTo(pts.map(function (p) { return [p.latitude, p.longitude]; }), 15);
    }
  }
};

window.__setPlaces = function (places) {
  state.places = Array.isArray(places) ? places : [];
  if (!map) return;
  renderPlaces();
  drawSelection();
  fitTo(state.places.map(function (p) { return [p.lat, p.lng]; }), 15);
};

window.__select = function (selection) {
  state.selected = selection || null;
  if (!map) return;
  drawSelection();
  var at = selectedPosition();
  if (at) map.panInside(at, { paddingTopLeft: [20, 150], paddingBottomRight: [20, 320] });
};

window.__centre = function (lat, lng) {
  if (!map) return;
  if (here) map.removeLayer(here);
  here = L.circleMarker([lat, lng], { radius: 8, weight: 3, color: '#FFFFFF', fillColor: '#4DABF7', fillOpacity: 1, interactive: false })
    .addTo(map);
  map.setView([lat, lng], Math.max(map.getZoom(), 13));
};

function fitToPins() {
  if (PINS.length === 1) {
    map.setView([PINS[0].lat, PINS[0].lng], 14);
  } else if (PINS.length > 1) {
    var bounds = L.latLngBounds(PINS.map(function (p) { return [p.lat, p.lng]; }));
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  } else {
    map.setView(CENTRE, ZOOM);
  }
}

if (!window.L) {
  document.getElementById('map').innerHTML = '<div class="offline">The map needs a data connection the first time it opens. The site list still works without one.</div>';
} else {
  map = L.map('map', { renderer: L.canvas({ padding: 0.5 }), zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: ${jsLiteral(OSM_ATTRIBUTION)},
  }).addTo(map);
  clusters = L.layerGroup().addTo(map);
  dots = L.layerGroup().addTo(map);
  placeLayer = L.layerGroup().addTo(map);

  map.on('zoomend', render);
  map.on('click', function () {
    state.selected = null;
    drawSelection();
    post({ type: 'clear' });
  });

  map.setView(CENTRE, ZOOM);
  fitToPins();
  render();
}
</script>
</body>
</html>`;
}
