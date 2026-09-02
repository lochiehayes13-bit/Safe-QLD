import { qldDay } from './qldTime';

/**
 * The service map: which sites get a dot, what colour it is, and the page that
 * draws them.
 *
 * Everything here is pure so the rules can be tested without a map. The screen
 * reads the database, works out where each site is, and hands the result to
 * `buildPins`; `mapHtml` turns the pins into a self-contained Leaflet page the
 * WebView renders; the filter and "my location" calls are pushed into that
 * page as small scripts rather than by reloading it, because a reload throws
 * away wherever the technician had panned to.
 *
 * One dot per site, not per job. A site with three jobs on it is one place to
 * drive to, and three overlapping dots at the same coordinate read as one dot
 * anyway — the colour just tells you the most pressing of them.
 */

export type PinKind = 'open' | 'upcoming' | 'recent' | 'site';

/** Strongest first. This is the order a site's colour is decided in, and the legend's. */
export const PIN_KINDS: readonly PinKind[] = ['open', 'upcoming', 'recent', 'site'];

export const PIN_COLOUR: Record<PinKind, string> = {
  open: '#FF6B1A',
  upcoming: '#4DABF7',
  recent: '#51CF66',
  site: '#9AA6B6',
};

export const PIN_LABEL: Record<PinKind, string> = {
  open: 'Job on now',
  upcoming: 'Upcoming job',
  recent: 'Recently completed / invoiced',
  site: 'Site we service',
};

/** The legend chips above the map, where the full label does not fit. */
export const PIN_SHORT: Record<PinKind, string> = {
  open: 'On now',
  upcoming: 'Upcoming',
  recent: 'Recent',
  site: 'Sites',
};

/**
 * How long a finished job keeps its green dot. Long enough that the invoice
 * has usually gone out and been paid, short enough that a site serviced last
 * year does not look like current work.
 */
export const RECENT_DAYS = 60;
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
}

/** Likewise for a job. `status` is the app's own; `stage` is the office's text. */
export interface MapJob {
  id: string;
  siteId?: string | null;
  title: string;
  stage?: string | null;
  status: 'scheduled' | 'in-progress' | 'complete' | 'blocked';
  scheduledFor?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface MapPin extends LatLng {
  siteId: string;
  kind: PinKind;
  /** The site name. */
  title: string;
  /** The address, as one line. */
  subtitle: string;
  client?: string;
  /** Up to three of the site's jobs, most pressing first, each as "title · date". */
  lines: string[];
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
 * technician closes a job here; the office sync does not, so for a Simpro job
 * the due date is the nearest thing to it, and the issue date after that.
 */
function finishedMs(job: MapJob): number | undefined {
  return firstMs(job.completedAt, job.dueAt, job.scheduledFor);
}

/** The date a job's popup line shows. */
function lineDate(job: MapJob, kind: PinKind): string | undefined {
  return kind === 'recent'
    ? (job.completedAt ?? job.dueAt ?? job.scheduledFor ?? undefined)
    : (job.scheduledFor ?? job.dueAt ?? undefined);
}

/**
 * What colour a job contributes to its site, or null when it contributes none.
 *
 * Finished within the last sixty days is `recent`; finished earlier is not on
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
export function siteAddressLine(site: MapSite): string {
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
  /** Site id → position, from the geocode cache. */
  positions: ReadonlyMap<string, LatLng>;
  now?: Date | string | number;
}

export interface BuiltPins {
  pins: MapPin[];
  /** Sites with no position from any source. Not on the map, but counted so the screen can say so. */
  unlocated: number;
  counts: Record<PinKind, number>;
}

function emptyCounts(): Record<PinKind, number> {
  return { open: 0, upcoming: 0, recent: 0, site: 0 };
}

/**
 * One pin per site that has a position.
 *
 * A site's colour is the strongest of its jobs' — a site with a job on now and
 * three invoiced last month is a job on now. A site with no live jobs is a grey
 * dot: it is still a place the company services, and the map is also for
 * answering "do we have anything near here".
 *
 * The cached position is preferred, and a job's own coordinates are the
 * fallback for a site the cache has not reached yet.
 */
export function buildPins(input: BuildPinsInput): BuiltPins {
  const now = input.now ?? Date.now();
  const fromJobs = jobPositions(input.jobs);

  const jobsBySite = new Map<string, MapJob[]>();
  for (const job of input.jobs) {
    if (!job.siteId) continue;
    const list = jobsBySite.get(job.siteId);
    if (list) list.push(job);
    else jobsBySite.set(job.siteId, [job]);
  }

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

    const kind = classified[0]?.kind ?? 'site';
    const lines = classified.slice(0, 3).map(({ job, kind: k }) => {
      const day = qldDay(lineDate(job, k) ?? undefined);
      return day ? `${job.title} · ${day}` : job.title;
    });

    const client = (site.clientName ?? '').trim();
    pins.push({
      siteId: site.id,
      kind,
      latitude: position.latitude,
      longitude: position.longitude,
      title: site.name,
      subtitle: siteAddressLine(site),
      client: client || undefined,
      lines,
    });
    counts[kind] += 1;
  }

  return { pins, unlocated, counts };
}

export interface PinFilter {
  kinds: ReadonlySet<PinKind>;
  query: string;
}

/** The pins the technician has asked to see: matching kinds, matching text. */
export function filterPins(pins: readonly MapPin[], filter: PinFilter): MapPin[] {
  const q = filter.query.trim().toLowerCase();
  return pins.filter((pin) => {
    if (!filter.kinds.has(pin.kind)) return false;
    if (!q) return true;
    return [pin.title, pin.subtitle, pin.client ?? ''].some((v) => v.toLowerCase().includes(q));
  });
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
  | { type: 'navigate'; app: 'waze' | 'google'; latitude: number; longitude: number }
  | { type: 'open'; siteId: string };

/**
 * What the page posted, or null for anything that is not one of its two
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
  if (m.type === 'open' && typeof m.siteId === 'string' && m.siteId) {
    return { type: 'open', siteId: m.siteId };
  }
  if (m.type === 'navigate' && (m.app === 'waze' || m.app === 'google') && isPosition(m.lat, m.lng)) {
    return { type: 'navigate', app: m.app, latitude: m.lat as number, longitude: m.lng as number };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The page
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

/** The script that re-filters the page in place. Ends in `true` because Android's WebView warns otherwise. */
export function filterScript(kinds: ReadonlySet<PinKind>, query: string): string {
  return `window.__setFilter && window.__setFilter(${jsLiteral([...kinds])}, ${jsLiteral(query)}); true;`;
}

/** The script that centres the page on the technician. */
export function centreScript(latitude: number, longitude: number): string {
  return `window.__centre && window.__centre(${Number(latitude)}, ${Number(longitude)}); true;`;
}

export interface MapHtmlOptions {
  centre: LatLng;
  zoom: number;
  dark: boolean;
}

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The whole page, as a string.
 *
 * Leaflet from a CDN and tiles from OpenStreetMap, so the map needs a
 * connection the first time and the page says so rather than sitting blank
 * when it has none. In dark mode the tile pane is inverted and hue-rotated —
 * the standard trick — so the map is not a white sheet in a plant room at
 * night. Markers are drawn on a canvas rather than as SVG elements: three
 * thousand SVG circles make panning stutter, three thousand canvas dots do not.
 *
 * The page never reads anything from the site data as HTML. Every string is
 * escaped on the way into the popup, and the buttons carry a pin index rather
 * than the pin itself, so nothing a person typed becomes markup or script.
 */
export function mapHtml(pins: readonly MapPin[], options: MapHtmlOptions): string {
  const data = pins.map((p, i) => ({
    i,
    siteId: p.siteId,
    kind: p.kind,
    lat: p.latitude,
    lng: p.longitude,
    title: p.title,
    subtitle: p.subtitle,
    client: p.client ?? '',
    lines: p.lines,
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
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:${c.surface};color:${c.text};box-shadow:0 6px 24px rgba(0,0,0,.35)}
.leaflet-popup-content-wrapper{border-radius:14px;border:1px solid ${c.border}}
.leaflet-popup-content{margin:14px 16px;min-width:230px;font-size:14px;line-height:1.35}
.leaflet-popup-close-button{width:44px!important;height:44px!important;font-size:24px!important;line-height:44px!important;color:${c.muted}!important}
.pp .k{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;margin-bottom:6px}
.pp .k i{display:inline-block;width:10px;height:10px;border-radius:50%}
.pp .t{font-size:17px;font-weight:800;color:${c.text};margin-bottom:2px}
.pp .s,.pp .c{color:${c.muted};font-size:13px}
.pp ul{margin:8px 0 0;padding:0 0 0 16px;color:${c.text};font-size:13px}
.pp ul li{margin:2px 0}
.pp .btns{display:flex;gap:8px;margin-top:12px}
.pp .btns button{flex:1;min-height:44px;border-radius:12px;border:1px solid ${c.border};background:transparent;color:${c.text};font-weight:800;font-size:13px;letter-spacing:.3px}
.pp .btns button.go{background:#FF6B1A;border-color:#FF6B1A;color:#12080A}
.legend{background:${c.surface};color:${c.text};border:1px solid ${c.border};border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.legend div{display:flex;align-items:center;gap:7px;white-space:nowrap}
.legend i{display:inline-block;width:11px;height:11px;border-radius:50%;border:1.5px solid ${c.ring}}
.leaflet-control-attribution{background:${c.surface}!important;color:${c.muted}!important;font-size:10px}
.leaflet-control-attribution a{color:${c.muted}!important}
.leaflet-bar a{background:${c.surface}!important;color:${c.text}!important;border-color:${c.border}!important;width:40px!important;height:40px!important;line-height:40px!important;font-size:20px!important}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var PINS = ${jsLiteral(data)};
var COLOUR = ${jsLiteral(PIN_COLOUR)};
var LABEL = ${jsLiteral(PIN_LABEL)};
var ORDER = ${jsLiteral(PIN_KINDS)};
var CENTRE = ${jsLiteral([options.centre.latitude, options.centre.longitude])};
var ZOOM = ${Number(options.zoom)};
var RING = ${jsLiteral(c.ring)};

var state = { kinds: ORDER.slice(), query: '' };
var map = null, layer = null, here = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function post(msg) {
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
}

function act(what, i) {
  var p = PINS[i];
  if (!p) return;
  if (what === 'open') post({ type: 'open', siteId: p.siteId });
  else post({ type: 'navigate', app: what, lat: p.lat, lng: p.lng });
}

function popupHtml(p) {
  var h = '<div class="pp">';
  h += '<div class="k" style="color:' + COLOUR[p.kind] + '"><i style="background:' + COLOUR[p.kind] + '"></i>' + esc(LABEL[p.kind]) + '</div>';
  h += '<div class="t">' + esc(p.title) + '</div>';
  if (p.subtitle) h += '<div class="s">' + esc(p.subtitle) + '</div>';
  if (p.client) h += '<div class="c">' + esc(p.client) + '</div>';
  if (p.lines && p.lines.length) {
    h += '<ul>';
    for (var j = 0; j < p.lines.length; j++) h += '<li>' + esc(p.lines[j]) + '</li>';
    h += '</ul>';
  }
  h += '<div class="btns">';
  h += '<button type="button" onclick="act(\\'waze\\',' + p.i + ')">Waze</button>';
  h += '<button type="button" onclick="act(\\'google\\',' + p.i + ')">Google Maps</button>';
  h += '<button type="button" class="go" onclick="act(\\'open\\',' + p.i + ')">Open site</button>';
  h += '</div></div>';
  return h;
}

function matches(p) {
  if (state.kinds.indexOf(p.kind) < 0) return false;
  var q = state.query;
  if (!q) return true;
  return (p.title + ' ' + p.subtitle + ' ' + p.client).toLowerCase().indexOf(q) >= 0;
}

function render() {
  if (!layer) return;
  layer.clearLayers();
  // Weakest first so a job on now is drawn on top of the grey dots around it.
  var ordered = PINS.slice().sort(function (a, b) { return ORDER.indexOf(b.kind) - ORDER.indexOf(a.kind); });
  for (var i = 0; i < ordered.length; i++) {
    var p = ordered[i];
    if (!matches(p)) continue;
    L.circleMarker([p.lat, p.lng], {
      radius: p.kind === 'site' ? 7 : 9,
      weight: 2,
      color: RING,
      fillColor: COLOUR[p.kind],
      fillOpacity: 0.95,
    }).bindPopup(popupHtml(p), { maxWidth: 300 }).addTo(layer);
  }
}

window.__setFilter = function (kinds, query) {
  state.kinds = Array.isArray(kinds) ? kinds : ORDER.slice();
  state.query = String(query || '').trim().toLowerCase();
  render();
};

window.__centre = function (lat, lng) {
  if (!map) return;
  if (here) map.removeLayer(here);
  here = L.circleMarker([lat, lng], { radius: 8, weight: 3, color: '#FFFFFF', fillColor: '#4DABF7', fillOpacity: 1 })
    .bindPopup('You are here').addTo(map);
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
  layer = L.layerGroup().addTo(map);

  var legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    var div = L.DomUtil.create('div', 'legend');
    var h = '';
    for (var i = 0; i < ORDER.length; i++) {
      h += '<div><i style="background:' + COLOUR[ORDER[i]] + '"></i>' + esc(LABEL[ORDER[i]]) + '</div>';
    }
    div.innerHTML = h;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legend.addTo(map);

  map.setView(CENTRE, ZOOM);
  fitToPins();
  render();
}
</script>
</body>
</html>`;
}
