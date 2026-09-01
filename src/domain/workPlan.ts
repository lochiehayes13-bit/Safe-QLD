import { SYSTEM_LABELS, type SystemKind } from '@/seed/assetTypes';
import { FREQUENCY_LABEL, type Frequency } from '@/seed/serviceRoutines';
import { distanceKm, hasPosition } from '@/domain/routing';
import type { DueState } from '@/domain/schedule';

/**
 * Planning a month of routine servicing across the whole book.
 *
 * The app can already answer "what is due?" — 897 sites and 12,553 assets worth
 * of it. Nobody could answer "what does next month look like?", which is the
 * office's actual daily job, and doing it on a whiteboard produces the two
 * failures this module exists to stop.
 *
 * The first is a booked month that quietly breaches. A routine is schedulable
 * anywhere inside its tolerance window, not only on its due date, so a plan that
 * books everything on its due date has no give in it: one sick day, one locked
 * riser cupboard, and the service falls outside the window. Every visit here is
 * placed near the *middle* of its window and reports how many days of margin it
 * has left, so a slip stays a slip rather than becoming a compliance failure.
 *
 * The second is a month of driving. A technician does a suburb, not a radius —
 * a run sheet that sends someone to Springwood, then Chermside, then back to
 * Springwood is how a nine-hour day happens. Work is therefore batched by
 * locality first and by straight-line proximity only where locality is missing,
 * and every cluster says which of the two it used, because the two are not
 * equally trustworthy.
 *
 * Three things this module refuses to do:
 *
 *  - It never presents an estimate as a measurement. The hours come from a
 *    per-asset minutes table that is Safe QLD's own field experience — not a
 *    figure from any standard — and every estimate carries that with it.
 *  - It never invents a site's size. A site with no asset register comes back
 *    unplanned with the reason, because a made-up half day is worse than a
 *    visible gap.
 *  - It never quietly drops work. Anything that could not be placed is returned
 *    with why: no schedule table behind the frequency, no anchor to count from,
 *    no locality and no coordinates, or simply no room left in the window.
 *
 * Nothing here touches the database. It takes plain arrays and returns a plan,
 * which is what makes the scheduling decisions testable.
 */

// ---------------------------------------------------------------------------
// Dates — Queensland is UTC+10 all year and never shifts
// ---------------------------------------------------------------------------

/**
 * Queensland does not observe daylight saving, so a fixed ten-hour offset is
 * correct in every month of the year. Everything below works in date-only
 * strings parsed as UTC midnight, which keeps a plan from sliding a day when
 * the phone is in another timezone.
 */
export const QLD_UTC_OFFSET_HOURS = 10;

/** The Queensland calendar date at an instant. */
export function qldDate(instantIso: string): string | undefined {
  const t = Date.parse(instantIso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t + QLD_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

function parseIsoDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string | undefined {
  const d = parseIsoDate(iso);
  if (!d) return undefined;
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Whole days from one date to another. Negative when `to` is the earlier one. */
export function daysBetween(fromIso: string, toIso: string): number | undefined {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return undefined;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function weekdayName(iso: string): string | undefined {
  const d = parseIsoDate(iso);
  return d ? WEEKDAY_NAMES[d.getUTCDay()] : undefined;
}

/** Saturday and Sunday. Public holidays are a separate matter — see below. */
export function isWeekend(iso: string): boolean {
  const d = parseIsoDate(iso);
  if (!d) return false;
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** d/m/yyyy, which is the only date format this company writes. */
export function formatPlanDate(iso: string): string {
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------------------------------------------------------------------------
// The window being planned
// ---------------------------------------------------------------------------

export interface PlanWindow {
  /** First date in the window, inclusive. */
  from: string;
  /** Last date in the window, inclusive. */
  to: string;
  /** "October 2026", or a plain date range where the window is not a month. */
  label: string;
}

/**
 * A whole calendar month, `offset` months from the one containing the date.
 *
 * The offset defaults to 0 — the month the date is in — because that is the
 * only answer this function can give without guessing what the caller meant.
 * `defaultPlanWindow` is the one that opinionates, and it asks for next month,
 * because the office books October during September.
 */
export function calendarMonthWindow(anyDateIso: string, offset = 0): PlanWindow | undefined {
  const d = parseIsoDate(anyDateIso);
  if (!d) return undefined;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + offset;
  const first = new Date(Date.UTC(year, month, 1));
  // Day zero of the following month is the last day of this one, which handles
  // February and the leap year without a table.
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return {
    from: toIsoDate(first),
    to: toIsoDate(last),
    label: `${MONTH_NAMES[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
  };
}

export function defaultPlanWindow(todayIso: string): PlanWindow | undefined {
  return calendarMonthWindow(todayIso, 1);
}

/**
 * The working days inside a window.
 *
 * Weekends are excluded outright. Public holidays are **not** known to this
 * module: Queensland's list changes yearly and the Brisbane show holiday is
 * regional, so a hardcoded list would be wrong for half the book within a year.
 * The caller passes the dates it wants excluded, and a plan built without them
 * says so in its notes rather than pretending the month has no holidays in it.
 *
 * Source for the official list, for whoever supplies it:
 * https://www.qld.gov.au/recreation/travel/holidays/public
 */
export function workingDaysIn(window: PlanWindow, holidays: string[] = [], notBefore?: string): string[] {
  const excluded = new Set(holidays.map((h) => h.slice(0, 10)));
  const out: string[] = [];
  let cursor = window.from.slice(0, 10);
  const end = window.to.slice(0, 10);
  if (!parseIsoDate(cursor) || !parseIsoDate(end)) return out;
  // The loop is bounded by the window's own length rather than by a round
  // number. A fixed cap silently returns half a window when somebody plans a
  // quarter, and a plan that is quietly short of days is a plan that quietly
  // reports "no room left" for work there was room for.
  const span = daysBetween(cursor, end) ?? -1;
  for (let i = 0; i <= span && cursor <= end; i++) {
    if (
      !isWeekend(cursor) &&
      !excluded.has(cursor) &&
      (!notBefore || cursor >= notBefore.slice(0, 10))
    ) {
      out.push(cursor);
    }
    const next = addDaysIso(cursor, 1);
    if (!next) break;
    cursor = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// How long a visit takes — estimates, and labelled as such everywhere
// ---------------------------------------------------------------------------

export type EstimateConfidence = 'low' | 'medium' | 'high';

export interface AssetMinutes {
  system: SystemKind;
  /** Minutes of work per asset of this system, on an attendance that walks it. */
  minutesPerAsset: number;
  /** Where the figure came from. Shown wherever the estimate is shown. */
  source: string;
  sourceUrl?: string;
  confidence: EstimateConfidence;
  note?: string;
}

/** The sentence that travels with every number this module produces. */
export const ESTIMATE_CAVEAT =
  'Estimated from asset counts, not measured. These minutes are an estimate from Safe QLD practice '
  + 'and are not a figure from AS 1851 or any other standard. Use them to size a month, not to price a job.';

const PRACTICE = 'Safe QLD field practice — an estimate from experience, not a standard';

/**
 * Minutes per asset, by system.
 *
 * Every entry is an estimate. Only one of them has anything published behind it
 * at all: the detection figure of six minutes is the same number a North
 * American trade test-time calculator gives for a smoke detector, which is a
 * different standard in a different country and is therefore recorded as
 * corroboration at low confidence rather than as a source. The occupant-warning
 * figure deliberately does NOT match it — that calculator says three minutes for
 * a speaker or a strobe and this table says four, because a sound pressure
 * reading is part of the Australian job — and the entry says so rather than
 * letting a citation imply agreement it does not have. The rest are Safe QLD's
 * own with nothing published behind them.
 *
 * Electrical and structure assets sit at zero deliberately. They are recorded
 * on a site because they matter to the building, not because a fire routine
 * walks them, and giving them minutes would inflate every estimate at every
 * site that keeps a good register.
 */
export const PER_ASSET_MINUTES: Record<SystemKind, AssetMinutes> = {
  detection: {
    system: 'detection', minutesPerAsset: 6, confidence: 'low',
    source: `${PRACTICE}; corroborated by a US trade test-time calculator (NFPA 72 context) at 6 min per detector`,
    sourceUrl: 'https://www.firetechs.net/library/forms/PMACalculator.htm',
    note: 'Covers reaching the head, testing it, restoring it and logging the point.',
  },
  ews: {
    system: 'ews', minutesPerAsset: 4, confidence: 'low',
    source: `${PRACTICE}. The same US calculator lists 3 min per speaker or strobe; this figure is a `
      + 'minute above it and is not derived from it',
    sourceUrl: 'https://www.firetechs.net/library/forms/PMACalculator.htm',
    note: 'Sound pressure readings on a sample push this up on a large site.',
  },
  aspirating: {
    system: 'aspirating', minutesPerAsset: 25, confidence: 'low', source: PRACTICE,
    note: 'Per detector unit, not per sampling hole: airflow, filter and transport time. The sampling '
      + 'points are in NOT_COUNTED_ASSET_TYPES for exactly that reason.',
  },
  sprinkler: {
    system: 'sprinkler', minutesPerAsset: 8, confidence: 'low', source: PRACTICE,
    note: 'Per valve set or flow switch. Heads are a visual sweep and are in NOT_COUNTED_ASSET_TYPES; '
      + 'charging eight minutes each would make a 400 head building a fifty hour visit.',
  },
  hydrant: { system: 'hydrant', minutesPerAsset: 12, confidence: 'low', source: PRACTICE },
  'hose-reel': { system: 'hose-reel', minutesPerAsset: 8, confidence: 'low', source: PRACTICE },
  extinguisher: { system: 'extinguisher', minutesPerAsset: 4, confidence: 'low', source: PRACTICE },
  'emergency-lighting': {
    system: 'emergency-lighting', minutesPerAsset: 6, confidence: 'low', source: PRACTICE,
    note: 'The discharge runs in the background; this is the walk to check each fitting at the end of it.',
  },
  pump: {
    system: 'pump', minutesPerAsset: 45, confidence: 'low', source: PRACTICE,
    note: 'Per pumpset. A diesel set with a weekly run log takes longer than this.',
  },
  gas: { system: 'gas', minutesPerAsset: 20, confidence: 'low', source: PRACTICE },
  passive: { system: 'passive', minutesPerAsset: 5, confidence: 'low', source: PRACTICE },
  door: { system: 'door', minutesPerAsset: 6, confidence: 'low', source: PRACTICE },
  electrical: {
    system: 'electrical', minutesPerAsset: 0, confidence: 'medium', source: PRACTICE,
    note: 'Not walked on a fire routine. Recorded against the site for other reasons.',
  },
  structure: {
    system: 'structure', minutesPerAsset: 0, confidence: 'medium', source: PRACTICE,
    note: 'Not walked on a fire routine. Recorded against the site for other reasons.',
  },
};

/**
 * Asset types this module does NOT charge a per-asset figure for.
 *
 * The rates above are per *device*, and the register is not only devices. It is
 * a tree — site, level, panel, loop, then the detectors hanging off it — and a
 * plain count of rows in a system charges the loop as though it were a detector
 * and the sampling hole as though it were an aspirating unit. On a 400 head
 * sprinkler building that arithmetic produces a fifty hour visit, which the
 * planner then refuses as larger than a day, and a real site drops out of a real
 * month because of a counting error.
 *
 * Nothing here is excluded on a hunch. Every entry names the figure that already
 * covers the work, so no minutes go missing — they are charged somewhere else.
 * The tests hold this list against the shipped asset type catalogue, so a new
 * type has to be considered rather than quietly costed at its system's rate.
 */
export const NOT_COUNTED_ASSET_TYPES: Record<string, string> = {
  fip: 'The panel is the routine. Its work is the systemMinutes in FREQUENCY_EFFORT, not a device walk.',
  loop: 'A loop is wiring, not a device. Everything on it is counted individually.',
  'ews-panel': 'Same as the fire indicator panel: charged as panel minutes, not as a device.',
  'sampling-point': 'The aspirating figure is per detector unit and already covers its sampling network.',
  'sprinkler-head': 'Heads are a visual sweep from the floor, not an eight minute item each.',
};

export interface FrequencyEffort {
  frequency: Frequency;
  /**
   * The share of a system's assets touched at this attendance. A monthly is a
   * visit to the panel; nobody walks 300 detectors every month.
   */
  assetCoverage: number;
  /** Panel and paperwork minutes for this routine, before any device walk. */
  systemMinutes: number;
  /** Where the two figures above came from. Carried in the data, not a comment. */
  source: string;
  confidence: EstimateConfidence;
}

/**
 * How much of a site each frequency actually touches.
 *
 * This is the estimate that matters most, because getting it wrong is not a
 * small error: treat a monthly as though it walked every device and a book of
 * monthlies becomes a fictional four hundred hours. The shape of it —
 * panel-level monthly, sampled six-monthly, whole-of-site yearly — is Safe QLD's
 * reading of how the work is actually carried out, written in our own words.
 * Nothing here is transcribed from a schedule table.
 */
export const FREQUENCY_EFFORT: Record<Frequency, FrequencyEffort> = {
  monthly: { frequency: 'monthly', assetCoverage: 0, systemMinutes: 30, source: PRACTICE, confidence: 'low' },
  quarterly: { frequency: 'quarterly', assetCoverage: 0, systemMinutes: 30, source: PRACTICE, confidence: 'low' },
  'six-monthly': { frequency: 'six-monthly', assetCoverage: 0.25, systemMinutes: 45, source: PRACTICE, confidence: 'low' },
  annual: { frequency: 'annual', assetCoverage: 1, systemMinutes: 60, source: PRACTICE, confidence: 'low' },
  'five-yearly': { frequency: 'five-yearly', assetCoverage: 1, systemMinutes: 90, source: PRACTICE, confidence: 'low' },
  'ten-yearly': { frequency: 'ten-yearly', assetCoverage: 1, systemMinutes: 90, source: PRACTICE, confidence: 'low' },
  commissioning: { frequency: 'commissioning', assetCoverage: 1, systemMinutes: 120, source: PRACTICE, confidence: 'low' },
};

/**
 * Getting on site, finding the contact, isolating monitoring, and the paperwork
 * at the end of it. Charged once per visit however many routines are done.
 * Safe QLD's own figure, like everything else in this section.
 */
export const VISIT_OVERHEAD = {
  minutes: 45,
  source: PRACTICE,
  confidence: 'low' as EstimateConfidence,
};

export const VISIT_OVERHEAD_MINUTES = VISIT_OVERHEAD.minutes;

export interface HoursEstimate {
  /** Estimated hours, to the nearest quarter hour. */
  hours: number;
  minutes: number;
  /** Literally true, so no caller can mistake this for a measurement. */
  estimate: true;
  confidence: EstimateConfidence;
  /** The arithmetic, in words, so a planner can argue with it. */
  basis: string[];
  /**
   * Systems or frequencies with nothing behind them in the tables above. Their
   * work is NOT in the figure, which is why the figure says so out loud rather
   * than borrowing minutes from something that looks similar.
   */
  notCosted: string[];
  /** True when something could not be costed, so the figure understates. */
  partial: boolean;
}

export interface SystemCount {
  system: string;
  count: number;
}

function roundQuarterHours(minutes: number): number {
  return Math.max(0.25, Math.round((minutes / 60) * 4) / 4);
}

/**
 * How long one attendance is likely to take.
 *
 * Assets are counted once per system at the deepest coverage of the day: a
 * six-monthly and a yearly detection routine done on the same visit is one walk
 * of the detectors, not one and a quarter. Panel and paperwork minutes are
 * charged per routine, because each one produces its own record.
 *
 * Returns undefined when the site's asset counts are unknown. That is the whole
 * point of the function returning something optional — a site nobody has
 * registered could be a cupboard or a hospital, and a plausible half day is a
 * worse answer than no answer.
 *
 * The same refusal applies one level down. Where a routine walks a system the
 * register holds nothing for, the walk is named in `notCosted` and the estimate
 * marks itself partial rather than costing it at nothing: a detection annual is
 * only ever due at a site because a detection service was recorded there, so
 * zero registered detectors is a gap in the register, not an empty building.
 */
export function estimateVisitHours(
  assetCounts: SystemCount[] | undefined,
  routines: { system: string; frequency: Frequency }[],
): HoursEstimate | undefined {
  if (!assetCounts) return undefined;

  const counts = new Map<string, number>();
  // A count that is not a whole number of assets is not a count. Rolling it in
  // as zero would quietly shrink the visit, which is the direction that hurts:
  // the day gets booked and the technician runs out of it.
  const unreadable = new Set<string>();
  for (const row of assetCounts) {
    if (!Number.isFinite(row.count) || row.count < 0 || !Number.isInteger(row.count)) {
      unreadable.add(row.system);
      continue;
    }
    counts.set(row.system, (counts.get(row.system) ?? 0) + row.count);
  }

  const basis: string[] = [`Attendance overhead ${VISIT_OVERHEAD_MINUTES} min`];
  let minutes = VISIT_OVERHEAD_MINUTES;

  // Deepest coverage per system across the routines being done that day.
  const coverage = new Map<string, number>();
  const notCosted: string[] = [];

  for (const routine of routines) {
    const effort = FREQUENCY_EFFORT[routine.frequency];
    if (!effort) {
      // A frequency the effort table has never heard of. Say so rather than
      // guessing an interval's worth of work.
      const label = `${routine.frequency} routines`;
      if (!notCosted.includes(label)) notCosted.push(label);
      continue;
    }
    minutes += effort.systemMinutes;
    basis.push(
      `${FREQUENCY_LABEL[routine.frequency]} ${systemLabel(routine.system)} — `
      + `${effort.systemMinutes} min at the panel and on the record`,
    );
    coverage.set(routine.system, Math.max(coverage.get(routine.system) ?? 0, effort.assetCoverage));
  }

  for (const [system, fraction] of coverage) {
    const rate = PER_ASSET_MINUTES[system as SystemKind];
    if (!rate) {
      // A system nobody has costed. Its assets are left out of the figure and
      // named, rather than being charged at whatever the nearest system costs.
      const label = `${system} assets`;
      if (!notCosted.includes(label)) notCosted.push(label);
      continue;
    }
    if (fraction === 0 || rate.minutesPerAsset === 0) continue;
    if (unreadable.has(system)) {
      const label = `${systemLabel(system).toLowerCase()} assets (the count did not read as a whole number)`;
      if (!notCosted.includes(label)) notCosted.push(label);
      continue;
    }
    const count = counts.get(system) ?? 0;
    if (count === 0) {
      // A routine is due against this system and the register holds nothing for
      // it. That is a contradiction, not an empty building: a detection annual
      // exists here because a detection service was recorded here. Costing the
      // walk at nothing would size a hospital as an hour and three quarters, so
      // the walk is named as uncosted and the estimate admits it understates.
      const label = `${systemLabel(system).toLowerCase()} devices (none registered, but the routine walks them)`;
      if (!notCosted.includes(label)) notCosted.push(label);
      basis.push(
        `No ${systemLabel(system).toLowerCase()} assets registered, so the device walk could not be sized `
        + '— the visit is longer than this figure',
      );
      continue;
    }
    const walk = Math.round(count * rate.minutesPerAsset * fraction);
    minutes += walk;
    basis.push(
      `${count} ${systemLabel(system).toLowerCase()} × ${rate.minutesPerAsset} min`
      + `${fraction < 1 ? ` × ${Math.round(fraction * 100)}% sampled` : ''} = ${walk} min (estimate)`,
    );
  }

  return {
    hours: roundQuarterHours(minutes),
    minutes: Math.round(minutes),
    estimate: true,
    confidence: 'low',
    basis,
    notCosted,
    partial: notCosted.length > 0,
  };
}

function systemLabel(system: string): string {
  return SYSTEM_LABELS[system as SystemKind] ?? system;
}

// ---------------------------------------------------------------------------
// Clustering — a technician does a suburb, not a radius
// ---------------------------------------------------------------------------

export type ClusterMethod = 'locality' | 'proximity';

export const CLUSTER_METHOD_LABEL: Record<ClusterMethod, string> = {
  locality: 'Grouped by suburb',
  proximity: 'Grouped by straight-line distance',
};

export interface SiteCluster {
  id: string;
  label: string;
  method: ClusterMethod;
  /** What decided the grouping, said plainly, because the two are not equal. */
  basis: string;
  siteIds: string[];
}

export interface PlanSite {
  siteId: string;
  siteName: string;
  suburb?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
  /**
   * Assets by system. `undefined` means nobody knows what is at this site,
   * which is not the same as `[]` — an empty register means the site has been
   * looked at and holds nothing. The first cannot be planned; the second can.
   */
  assetCounts?: SystemCount[];
}

/**
 * A suburb is not free text. "SPRINGWOOD ", "Springwood" and "springwood" are
 * one place, and treating them as three splits a day's work three ways.
 */
function normaliseSuburb(suburb: string | undefined): string | undefined {
  const s = suburb?.trim().replace(/\s+/g, ' ').toLowerCase();
  return s ? s : undefined;
}

/**
 * Australian postcodes are four digits. Anything else — "QLD 4127", a blank, a
 * truncated import — is not a postcode, and keying a cluster on it would batch
 * sites together on the strength of a data entry error.
 */
function normalisePostcode(postcode: string | undefined): string | undefined {
  const p = postcode?.trim();
  return p && /^\d{4}$/.test(p) ? p : undefined;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * A site's position, if it has one worth using.
 *
 * Borrowed from the router rather than re-checked here, so "0,0 is the Gulf of
 * Guinea, not a site" stays one rule in one place.
 */
export function sitePosition(site: PlanSite): { latitude: number; longitude: number } | undefined {
  const point = {
    id: site.siteId,
    label: site.siteName,
    latitude: site.latitude,
    longitude: site.longitude,
  };
  return hasPosition(point) ? { latitude: point.latitude, longitude: point.longitude } : undefined;
}

/** Default radius for the proximity fallback. About a suburb across, in SEQ. */
export const DEFAULT_PROXIMITY_RADIUS_KM = 8;

export interface ClusterResult {
  clusters: SiteCluster[];
  /** Sites with no locality and no usable coordinates. */
  unclustered: PlanSite[];
}

/**
 * Batches sites into the groups a day is actually built from.
 *
 * Locality first: same suburb and postcode is one cluster, because that is how
 * the work is handed out. A site carrying a suburb but no postcode is folded
 * into that suburb's cluster only when the book knows exactly one postcode for
 * the name — Australia Post lists a Springfield in Queensland at 4300, next to
 * Ipswich, and another at 4871 in the far north, and guessing which is how a
 * technician ends up over a thousand kilometres from the job.
 * https://auspost.com.au/postcode/springfield (checked 1/9/2026)
 *
 * Straight-line proximity is the fallback, used only where a site has no
 * locality at all, and every cluster reports which method produced it. The two
 * are not equally trustworthy: proximity ignores the river, the motorway and
 * every bridge, and two sites a kilometre apart across the Brisbane River are a
 * fifteen minute drive.
 */
export function clusterSites(sites: PlanSite[], radiusKm = DEFAULT_PROXIMITY_RADIUS_KM): ClusterResult {
  const clusters: SiteCluster[] = [];
  const unclustered: PlanSite[] = [];

  const withSuburbAndPostcode = new Map<string, PlanSite[]>();
  const suburbOnly = new Map<string, PlanSite[]>();
  const postcodeOnly = new Map<string, PlanSite[]>();
  const noLocality: PlanSite[] = [];

  for (const site of sites) {
    const suburb = normaliseSuburb(site.suburb);
    const postcode = normalisePostcode(site.postcode);
    if (suburb && postcode) {
      const key = `${suburb}|${postcode}`;
      withSuburbAndPostcode.set(key, [...(withSuburbAndPostcode.get(key) ?? []), site]);
    } else if (suburb) {
      suburbOnly.set(suburb, [...(suburbOnly.get(suburb) ?? []), site]);
    } else if (postcode) {
      postcodeOnly.set(postcode, [...(postcodeOnly.get(postcode) ?? []), site]);
    } else {
      noLocality.push(site);
    }
  }

  // Which postcodes each suburb name is known to use, so an ambiguous name is
  // visible as ambiguous rather than resolved to whichever came first.
  const postcodesForSuburb = new Map<string, Set<string>>();
  for (const key of withSuburbAndPostcode.keys()) {
    const [suburb, postcode] = key.split('|');
    if (!suburb || !postcode) continue;
    const set = postcodesForSuburb.get(suburb) ?? new Set<string>();
    set.add(postcode);
    postcodesForSuburb.set(suburb, set);
  }

  for (const [key, members] of withSuburbAndPostcode) {
    const [suburb, postcode] = key.split('|');
    if (!suburb || !postcode) continue;
    const strays = postcodesForSuburb.get(suburb)?.size === 1 ? suburbOnly.get(suburb) ?? [] : [];
    if (strays.length) suburbOnly.delete(suburb);
    clusters.push({
      id: `loc:${key}`,
      label: `${titleCase(suburb)} ${postcode}`,
      method: 'locality',
      basis: strays.length
        ? `Same suburb and postcode. ${strays.length} site${strays.length === 1 ? '' : 's'} with no postcode `
          + 'recorded joined this cluster, because the book knows only one postcode for the name.'
        : 'Same suburb and postcode.',
      siteIds: [...members, ...strays].map((s) => s.siteId),
    });
  }

  for (const [suburb, members] of suburbOnly) {
    const known = postcodesForSuburb.get(suburb);
    clusters.push({
      id: `sub:${suburb}`,
      label: titleCase(suburb),
      method: 'locality',
      basis: known && known.size > 1
        ? `Same suburb name, no postcode recorded. The book holds ${known.size} postcodes for this name, `
          + 'so these are kept apart from the sites that do carry one.'
        : 'Same suburb name. No postcode recorded, so the match is on the name alone.',
      siteIds: members.map((s) => s.siteId),
    });
  }

  for (const [postcode, members] of postcodeOnly) {
    clusters.push({
      id: `pc:${postcode}`,
      label: `Postcode ${postcode}`,
      method: 'locality',
      basis: 'Same postcode. No suburb recorded, and a postcode can cover several suburbs.',
      siteIds: members.map((s) => s.siteId),
    });
  }

  // Fallback: no suburb and no postcode, but a position. Greedy single pass —
  // the first unassigned site seeds a cluster and everything inside the radius
  // joins it. Not the tightest possible grouping, but one whose reasoning a
  // technician can read off the screen.
  const placeable = noLocality
    .map((site) => ({ site, position: sitePosition(site) }))
    .filter((s): s is { site: PlanSite; position: { latitude: number; longitude: number } } => !!s.position);
  const assigned = new Set<string>();
  for (const { site: seed, position: seedAt } of placeable) {
    if (assigned.has(seed.siteId)) continue;
    assigned.add(seed.siteId);
    const members = [seed];
    for (const { site: other, position: otherAt } of placeable) {
      if (assigned.has(other.siteId)) continue;
      const km = distanceKm(seedAt, otherAt);
      if (km <= radiusKm) {
        assigned.add(other.siteId);
        members.push(other);
      }
    }
    clusters.push({
      id: `prox:${seed.siteId}`,
      label: `Near ${seed.siteName}`,
      method: 'proximity',
      basis: `No suburb or postcode recorded, so grouped within ${radiusKm} km straight line of `
        + `${seed.siteName}. Straight-line distance ignores the river and the motorways, so this is a `
        + 'weaker grouping than a suburb.',
      siteIds: members.map((s) => s.siteId),
    });
  }

  for (const site of noLocality) {
    if (!assigned.has(site.siteId)) unclustered.push(site);
  }

  return { clusters, unclustered };
}

// ---------------------------------------------------------------------------
// What goes into the plan
// ---------------------------------------------------------------------------

export interface PlanRoutine {
  siteId: string;
  routineId: string;
  routineLabel?: string;
  system: string;
  frequency: Frequency;
  state: DueState;
  /** The date the schedule calls for, anchored to the first service. */
  scheduledFor?: string;
  /** The tolerance window around it — the dates it may actually be done. */
  window?: { earliest: string; latest: string };
}

export type UnplannableReason =
  | 'no-schedule-table'
  | 'never-recorded'
  | 'unknown-site'
  | 'unknown-routine'
  | 'no-locality-or-position'
  | 'no-asset-estimate'
  | 'larger-than-a-day'
  | 'no-capacity'
  | 'no-working-day';

export const UNPLANNABLE_REASON_LABEL: Record<UnplannableReason, string> = {
  'no-schedule-table': 'No schedule behind this frequency',
  'never-recorded': 'Never recorded here',
  'unknown-site': 'Site not in the book',
  'unknown-routine': 'Routine this app does not hold',
  'no-locality-or-position': 'Nothing says where this site is',
  'no-asset-estimate': 'Nothing says how big this site is',
  'larger-than-a-day': 'Bigger than one working day',
  'no-capacity': 'No room left in the window',
  'no-working-day': 'No working day available',
};

export interface UnplannedItem {
  siteId: string;
  siteName?: string;
  routineId: string;
  routineLabel?: string;
  /**
   * Absent where nothing knows it. A routine this build does not hold has no
   * frequency, and writing a plausible one here would put "Annual" in front of
   * an office clerk on the one list they act on. Undefined is the answer.
   */
  frequency?: Frequency;
  reason: UnplannableReason;
  /** Said in full, because this list is what the office acts on. */
  detail: string;
  /** The last date it could have been done in tolerance, where one is known. */
  latestSafeDate?: string;
}

export interface PlannedRoutineRef {
  routineId: string;
  routineLabel?: string;
  frequency: Frequency;
  system: string;
  scheduledFor?: string;
  /** Last date inside tolerance. */
  latestSafeDate?: string;
  urgent: boolean;
}

export interface PlannedVisit {
  id: string;
  siteId: string;
  siteName: string;
  clusterId: string;
  clusterLabel: string;
  clusterMethod: ClusterMethod;
  date: string;
  /** 0-based index of the technician the visit is stacked on. */
  technician: number;
  routines: PlannedRoutineRef[];
  hours: HoursEstimate;
  /** True when something in this visit is already outside its window. */
  urgent: boolean;
  /** Where the visit would ideally have sat: the middle of the usable window. */
  preferredDate: string;
  /** How far from that it actually landed. Zero is the ideal. */
  daysFromPreferred: number;
  /**
   * Days of margin before the tightest window in this visit closes. Negative on
   * urgent work, which has already breached.
   */
  daysOfMargin?: number;
  latestSafeDate?: string;
}

export interface TechnicianDay {
  index: number;
  label: string;
  /** Estimated hours. */
  hours: number;
  capacityHours: number;
  visits: PlannedVisit[];
}

export interface PlannedDay {
  date: string;
  dateAu: string;
  weekday: string;
  technicians: TechnicianDay[];
  /** Estimated hours across every technician that day. */
  hours: number;
  capacityHours: number;
  /** 0..1 against capacity, and it is a load on estimates, not on measurements. */
  utilisation: number;
  visitCount: number;
  urgentCount: number;
  clusterLabels: string[];
}

export interface PlanSummary {
  visits: number;
  sites: number;
  routines: number;
  urgentVisits: number;
  /** Estimated, never measured. */
  estimatedHours: number;
  capacityHours: number;
  utilisation: number;
  workingDays: number;
  /** Routines whose window falls entirely outside the planned window. */
  notDueInWindow: number;
  unplanned: number;
  clusteredByLocality: number;
  clusteredByProximity: number;
}

export interface WorkPlan {
  window: PlanWindow;
  today: string;
  technicians: number;
  hoursPerDay: number;
  days: PlannedDay[];
  clusters: SiteCluster[];
  unplanned: UnplannedItem[];
  summary: PlanSummary;
  /** What a reader has to know before trusting any of the above. */
  notes: string[];
}

export interface PlanOptions {
  /** Today, as a Queensland calendar date. Nothing is planned before it. */
  today: string;
  /** Defaults to the next calendar month. */
  window?: PlanWindow;
  technicians?: number;
  hoursPerDay?: number;
  /** Dates nobody works. Public holidays are the caller's to supply. */
  holidays?: string[];
  proximityRadiusKm?: number;
  /**
   * How far a visit may be dragged from the middle of its window in order to
   * join the rest of its suburb. Beyond this the saving in driving stops being
   * worth the loss of margin.
   */
  clusterPullDays?: number;
}

/** Seven and a half hours on site, which is what a day leaves after travel. */
export const DEFAULT_WORKING_HOURS = 7.5;
export const DEFAULT_CLUSTER_PULL_DAYS = 14;

interface Feasible {
  from: string;
  to: string;
  preferred: string;
  urgent: boolean;
  latestSafeDate?: string;
}

/**
 * When a routine may actually be carried out inside the planned window.
 *
 * The tolerance window is the point. A routine due on the 14th with a two month
 * tolerance can be done any working day either side of it, and pinning it to
 * the 14th throws that away. The middle is preferred so a slip eats margin
 * instead of breaching, and anything whose window has already closed is treated
 * as urgent and pulled to the front regardless of where it is.
 */
function feasibleInterval(
  routine: PlanRoutine,
  window: PlanWindow,
  todayIso: string,
): Feasible | { skip: 'not-due' } | { unplannable: UnplannableReason; detail: string } {
  if (routine.state === 'not-scheduled') {
    return {
      unplannable: 'no-schedule-table',
      detail: `${FREQUENCY_LABEL[routine.frequency]} has no schedule table behind it, so this module `
        + 'cannot say when it falls due. Plan it by hand.',
    };
  }
  if (routine.state === 'never-done' || !routine.window || !routine.scheduledFor) {
    return {
      unplannable: 'never-recorded',
      detail: 'No service has been recorded here, so there is no anchor to count a schedule from. '
        + 'The first attendance sets the schedule and has to be booked deliberately.',
    };
  }

  // Nothing is planned into the past, whatever the window says.
  const from = window.from > todayIso ? window.from : todayIso;
  const to = window.to;
  if (from > to) {
    return { unplannable: 'no-working-day', detail: 'The window has already passed.' };
  }

  const { earliest, latest } = routine.window;

  if (latest < from) {
    // Already outside tolerance before the window even opens. It cannot be put
    // right by scheduling — it is late whenever it happens — so it goes first.
    return { from, to, preferred: from, urgent: true, latestSafeDate: latest };
  }
  if (earliest > to) {
    return { skip: 'not-due' };
  }

  const start = earliest > from ? earliest : from;
  const end = latest < to ? latest : to;
  if (start > end) return { skip: 'not-due' };

  const span = daysBetween(start, end) ?? 0;
  const preferred = addDaysIso(start, Math.floor(span / 2)) ?? start;
  return {
    from: start,
    to: end,
    preferred,
    urgent: routine.state === 'overdue',
    latestSafeDate: latest,
  };
}

interface CandidateVisit {
  siteId: string;
  routines: PlanRoutine[];
  feasible: Feasible;
}

/**
 * Groups a site's routines into as few visits as the tolerance windows allow.
 *
 * Two routines due at one site are one attendance whenever their windows
 * overlap — driving to Ipswich twice for work that could have been done in one
 * morning is the most expensive mistake a plan can make. Where the windows do
 * not overlap the site genuinely needs two visits, and this says so rather than
 * forcing one and breaching the tighter of the two.
 *
 * Ordering by the closing date and merging greedily is the standard way to hit
 * a set of intervals with the fewest points, so this is also the fewest visits.
 */
function groupIntoVisits(items: { routine: PlanRoutine; feasible: Feasible }[]): CandidateVisit[] {
  const ordered = [...items].sort(
    (a, b) => a.feasible.to.localeCompare(b.feasible.to) || a.feasible.from.localeCompare(b.feasible.from),
  );

  const visits: CandidateVisit[] = [];
  let current: { routines: PlanRoutine[]; from: string; to: string; urgent: boolean; latest?: string } | null = null;

  const close = (): void => {
    if (!current) return;
    const span = daysBetween(current.from, current.to) ?? 0;
    const preferred = current.urgent
      ? current.from
      : addDaysIso(current.from, Math.floor(span / 2)) ?? current.from;
    visits.push({
      siteId: current.routines[0]!.siteId,
      routines: current.routines,
      feasible: {
        from: current.from,
        to: current.to,
        preferred,
        urgent: current.urgent,
        latestSafeDate: current.latest,
      },
    });
    current = null;
  };

  for (const item of ordered) {
    if (!current) {
      current = {
        routines: [item.routine],
        from: item.feasible.from,
        to: item.feasible.to,
        urgent: item.feasible.urgent,
        latest: item.feasible.latestSafeDate,
      };
      continue;
    }
    const from = item.feasible.from > current.from ? item.feasible.from : current.from;
    const to = item.feasible.to < current.to ? item.feasible.to : current.to;
    if (from <= to) {
      current.routines.push(item.routine);
      current.from = from;
      current.to = to;
      current.urgent = current.urgent || item.feasible.urgent;
      // The tightest deadline in the group is the one that governs it.
      if (item.feasible.latestSafeDate && (!current.latest || item.feasible.latestSafeDate < current.latest)) {
        current.latest = item.feasible.latestSafeDate;
      }
    } else {
      close();
      current = {
        routines: [item.routine],
        from: item.feasible.from,
        to: item.feasible.to,
        urgent: item.feasible.urgent,
        latest: item.feasible.latestSafeDate,
      };
    }
  }
  close();

  return visits;
}

interface Bin {
  hours: number;
  clusters: Set<string>;
  visits: PlannedVisit[];
}

/**
 * Builds the month.
 *
 * The order of business is deliberate and each step earns its place:
 *
 *  1. Anything already outside its window is placed first, on the earliest day
 *     it can be done. It is late whatever happens; the only variable left is
 *     how late, and locality does not get a vote on that.
 *  2. Everything else is placed tightest window first. A monthly with five
 *     working days of tolerance has to be booked before a yearly with four
 *     months of it, or the monthly finds the month full and breaches while the
 *     yearly sits comfortably on a day it did not need.
 *  3. Each visit takes the day nearest the middle of its window, except that a
 *     day already carrying its suburb wins if it is within reach. That single
 *     rule is what produces days that read as "Springwood" rather than as a
 *     list of postcodes.
 *  4. Within a day the visit goes to the technician already in that suburb, and
 *     otherwise to whoever has the emptiest day.
 */
export function planWork(routines: PlanRoutine[], sites: PlanSite[], options: PlanOptions): WorkPlan {
  const today = options.today.slice(0, 10);
  const window = options.window ?? defaultPlanWindow(today);
  const technicians = Math.max(0, Math.floor(options.technicians ?? 1));
  const hoursPerDay = options.hoursPerDay && options.hoursPerDay > 0 ? options.hoursPerDay : DEFAULT_WORKING_HOURS;
  const clusterPull = options.clusterPullDays ?? DEFAULT_CLUSTER_PULL_DAYS;
  const radiusKm = options.proximityRadiusKm ?? DEFAULT_PROXIMITY_RADIUS_KM;

  const emptyWindow: PlanWindow = { from: today, to: today, label: 'No window' };
  const notes: string[] = [];
  const unplanned: UnplannedItem[] = [];

  if (!window || !parseIsoDate(today)) {
    return {
      window: window ?? emptyWindow,
      today,
      technicians,
      hoursPerDay,
      days: [],
      clusters: [],
      unplanned: [],
      summary: emptySummary(),
      notes: ['No plan was produced: the date given is not a date this module can read.'],
    };
  }

  const siteById = new Map(sites.map((s) => [s.siteId, s]));
  const days = workingDaysIn(window, options.holidays ?? [], today);

  // ---- what is in scope, and what cannot be scheduled at all ----
  const perSite = new Map<string, { routine: PlanRoutine; feasible: Feasible }[]>();
  let notDueInWindow = 0;

  const reject = (routine: PlanRoutine, reason: UnplannableReason, detail: string, latestSafeDate?: string): void => {
    unplanned.push({
      siteId: routine.siteId,
      siteName: siteById.get(routine.siteId)?.siteName,
      routineId: routine.routineId,
      routineLabel: routine.routineLabel,
      frequency: routine.frequency,
      reason,
      detail,
      latestSafeDate,
    });
  };

  for (const routine of routines) {
    const outcome = feasibleInterval(routine, window, today);
    if ('skip' in outcome) {
      notDueInWindow += 1;
      continue;
    }
    if ('unplannable' in outcome) {
      reject(routine, outcome.unplannable, outcome.detail, routine.window?.latest);
      continue;
    }
    const site = siteById.get(routine.siteId);
    if (!site) {
      reject(
        routine,
        'unknown-site',
        'This routine is against a site that is not in the list given to the planner, so nothing is '
        + 'known about where it is or how big it is.',
        outcome.latestSafeDate,
      );
      continue;
    }
    perSite.set(routine.siteId, [...(perSite.get(routine.siteId) ?? []), { routine, feasible: outcome }]);
  }

  // ---- clustering, over the sites actually in scope ----
  const inScope = [...perSite.keys()]
    .map((id) => siteById.get(id))
    .filter((s): s is PlanSite => !!s);
  const { clusters, unclustered } = clusterSites(inScope, radiusKm);
  const clusterBySite = new Map<string, SiteCluster>();
  for (const cluster of clusters) {
    for (const siteId of cluster.siteIds) clusterBySite.set(siteId, cluster);
  }

  for (const site of unclustered) {
    for (const { routine, feasible } of perSite.get(site.siteId) ?? []) {
      reject(
        routine,
        'no-locality-or-position',
        `${site.siteName} has no suburb, no postcode and no coordinates, so it cannot be batched with `
        + 'anything. Add a suburb to the site and it plans itself.',
        feasible.latestSafeDate,
      );
    }
    perSite.delete(site.siteId);
  }

  // ---- visits, with an estimate each ----
  interface Pending {
    visit: CandidateVisit;
    site: PlanSite;
    cluster: SiteCluster;
    hours: HoursEstimate;
  }
  const pending: Pending[] = [];

  for (const [siteId, items] of perSite) {
    const site = siteById.get(siteId)!;
    const cluster = clusterBySite.get(siteId);
    if (!cluster) {
      // Every site is either clustered or returned as unclustered, so nothing
      // should reach here. Reported rather than skipped anyway: a `continue`
      // in this position is how a site disappears out of a month with no row
      // anywhere saying it did.
      for (const { routine, feasible } of items) {
        reject(
          routine,
          'no-locality-or-position',
          `${site.siteName} came back from the grouping step in neither a cluster nor the unclustered `
          + 'list. That is a fault in this app, not in the site record — report it.',
          feasible.latestSafeDate,
        );
      }
      continue;
    }
    for (const visit of groupIntoVisits(items)) {
      const hours = estimateVisitHours(
        site.assetCounts,
        visit.routines.map((r) => ({ system: r.system, frequency: r.frequency })),
      );
      if (!hours) {
        for (const routine of visit.routines) {
          reject(
            routine,
            'no-asset-estimate',
            `No asset register for ${site.siteName}, so there is no honest way to say how long the `
            + 'visit takes. Import or build the register and it can be planned.',
            visit.feasible.latestSafeDate,
          );
        }
        continue;
      }
      pending.push({ visit, site, cluster, hours });
    }
  }

  // ---- days and technicians ----
  const bins = new Map<string, Bin[]>();
  for (const day of days) {
    bins.set(day, Array.from({ length: technicians }, () => ({ hours: 0, clusters: new Set<string>(), visits: [] })));
  }

  const order = [...pending].sort((a, b) => {
    if (a.visit.feasible.urgent !== b.visit.feasible.urgent) return a.visit.feasible.urgent ? -1 : 1;
    if (a.visit.feasible.urgent) {
      // Most overdue first: the one whose window closed longest ago.
      const aLate = a.visit.feasible.latestSafeDate ?? '';
      const bLate = b.visit.feasible.latestSafeDate ?? '';
      if (aLate !== bLate) return aLate.localeCompare(bLate);
    } else {
      // Tightest window first, or the tight ones find the month already full.
      const aSpan = daysBetween(a.visit.feasible.from, a.visit.feasible.to) ?? 0;
      const bSpan = daysBetween(b.visit.feasible.from, b.visit.feasible.to) ?? 0;
      if (aSpan !== bSpan) return aSpan - bSpan;
      if (a.visit.feasible.to !== b.visit.feasible.to) {
        return a.visit.feasible.to.localeCompare(b.visit.feasible.to);
      }
    }
    return a.site.siteName.localeCompare(b.site.siteName) || a.site.siteId.localeCompare(b.site.siteId);
  });

  let visitSeq = 0;

  for (const item of order) {
    const { feasible } = item.visit;
    const candidates = days.filter((d) => d >= feasible.from && d <= feasible.to);

    if (!candidates.length) {
      rejectVisit(
        item,
        'no-working-day',
        `Nothing between ${formatPlanDate(feasible.from)} and ${formatPlanDate(feasible.to)} is a working `
        + 'day in this window, so there is nowhere to put it.',
      );
      continue;
    }
    if (item.hours.hours > hoursPerDay) {
      rejectVisit(
        item,
        'larger-than-a-day',
        `Estimated at ${item.hours.hours} h against a ${hoursPerDay} h day. A site is never split across `
        + 'two days by this planner, so this one has to be crewed or broken up deliberately by a person.',
      );
      continue;
    }

    const choice = chooseSlot(item, candidates);
    if (!choice) {
      rejectVisit(
        item,
        'no-capacity',
        `Needs ${item.hours.hours} h (estimated) and every working day between `
        + `${formatPlanDate(feasible.from)} and ${formatPlanDate(feasible.to)} is full. Add a technician, `
        + 'a day, or move it to the next window.',
      );
      continue;
    }

    const { day, bin, binIndex } = choice;
    const planned: PlannedVisit = {
      id: `visit-${++visitSeq}`,
      siteId: item.site.siteId,
      siteName: item.site.siteName,
      clusterId: item.cluster.id,
      clusterLabel: item.cluster.label,
      clusterMethod: item.cluster.method,
      date: day,
      technician: binIndex,
      routines: item.visit.routines.map((r) => ({
        routineId: r.routineId,
        routineLabel: r.routineLabel,
        frequency: r.frequency,
        system: r.system,
        scheduledFor: r.scheduledFor,
        latestSafeDate: r.window?.latest,
        urgent: r.state === 'overdue' || (r.window ? r.window.latest < day : false),
      })),
      hours: item.hours,
      urgent: feasible.urgent,
      preferredDate: feasible.preferred,
      daysFromPreferred: daysBetween(feasible.preferred, day) ?? 0,
      daysOfMargin: feasible.latestSafeDate ? daysBetween(day, feasible.latestSafeDate) : undefined,
      latestSafeDate: feasible.latestSafeDate,
    };
    bin.hours += item.hours.hours;
    bin.clusters.add(item.cluster.id);
    bin.visits.push(planned);
  }

  function rejectVisit(item: Pending, reason: UnplannableReason, detail: string): void {
    for (const routine of item.visit.routines) {
      reject(routine, reason, detail, item.visit.feasible.latestSafeDate);
    }
  }

  /**
   * Picks the day and the technician.
   *
   * The middle of the window is the target. A day already holding this suburb
   * beats a day nearer the middle, but only while it stays within reach of it —
   * dragging a visit three weeks across a month to save a drive spends margin
   * that exists for a reason.
   */
  function chooseSlot(
    item: Pending,
    candidates: string[],
  ): { day: string; bin: Bin; binIndex: number } | undefined {
    let best: { day: string; bin: Bin; binIndex: number; score: [number, number, string] } | undefined;

    for (const day of candidates) {
      const dayBins = bins.get(day);
      if (!dayBins?.length) continue;

      const sameCluster = dayBins.filter((b) => b.clusters.has(item.cluster.id) && b.hours + item.hours.hours <= hoursPerDay);
      const free = dayBins.filter((b) => b.hours + item.hours.hours <= hoursPerDay);
      if (!free.length) continue;

      const distance = Math.abs(daysBetween(item.visit.feasible.preferred, day) ?? 0);
      // Urgent work is not steered towards the middle of anything: the earliest
      // day it can be done is the right day.
      const affinity = item.visit.feasible.urgent
        ? 1
        : sameCluster.length && distance <= clusterPull
          ? 0
          : 1;
      const pool = affinity === 0 ? sameCluster : free;
      // Emptiest technician first, so a day fills evenly rather than stacking
      // one person to seven hours and leaving the other on one.
      const chosen = [...pool].sort((a, b) => a.hours - b.hours)[0]!;
      const binIndex = dayBins.indexOf(chosen);
      const score: [number, number, string] = [
        affinity,
        item.visit.feasible.urgent ? (daysBetween(candidates[0]!, day) ?? 0) : distance,
        day,
      ];

      if (!best || compareScore(score, best.score) < 0) {
        best = { day, bin: chosen, binIndex, score };
      }
    }

    return best ? { day: best.day, bin: best.bin, binIndex: best.binIndex } : undefined;
  }

  // ---- assemble ----
  const plannedDays: PlannedDay[] = days.map((date) => {
    const dayBins = bins.get(date) ?? [];
    const techs: TechnicianDay[] = dayBins.map((bin, index) => ({
      index,
      label: `Technician ${index + 1}`,
      hours: round2(bin.hours),
      capacityHours: hoursPerDay,
      visits: [...bin.visits].sort((a, b) => a.clusterLabel.localeCompare(b.clusterLabel) || a.siteName.localeCompare(b.siteName)),
    }));
    const hours = round2(techs.reduce((sum, t) => sum + t.hours, 0));
    const capacityHours = round2(technicians * hoursPerDay);
    const visits = techs.flatMap((t) => t.visits);
    return {
      date,
      dateAu: formatPlanDate(date),
      weekday: weekdayName(date) ?? '',
      technicians: techs,
      hours,
      capacityHours,
      utilisation: capacityHours > 0 ? round2(hours / capacityHours) : 0,
      visitCount: visits.length,
      urgentCount: visits.filter((v) => v.urgent).length,
      clusterLabels: [...new Set(visits.map((v) => v.clusterLabel))].sort(),
    };
  });

  const allVisits = plannedDays.flatMap((d) => d.technicians.flatMap((t) => t.visits));
  const usedClusterIds = new Set(allVisits.map((v) => v.clusterId));
  const usedClusters = clusters.filter((c) => usedClusterIds.has(c.id));
  const capacityHours = round2(days.length * technicians * hoursPerDay);
  const estimatedHours = round2(allVisits.reduce((sum, v) => sum + v.hours.hours, 0));

  const summary: PlanSummary = {
    visits: allVisits.length,
    sites: new Set(allVisits.map((v) => v.siteId)).size,
    routines: allVisits.reduce((sum, v) => sum + v.routines.length, 0),
    urgentVisits: allVisits.filter((v) => v.urgent).length,
    estimatedHours,
    capacityHours,
    utilisation: capacityHours > 0 ? round2(estimatedHours / capacityHours) : 0,
    workingDays: days.length,
    notDueInWindow,
    unplanned: unplanned.length,
    clusteredByLocality: usedClusters.filter((c) => c.method === 'locality').length,
    clusteredByProximity: usedClusters.filter((c) => c.method === 'proximity').length,
  };

  notes.push(ESTIMATE_CAVEAT);
  if (!options.holidays?.length) {
    notes.push(
      'No public holidays were supplied, so every weekday in the window is treated as workable. '
      + 'Queensland holidays — and the Brisbane show holiday, which is regional — have to be passed in.',
    );
  } else {
    notes.push(`${options.holidays.length} non-working date${options.holidays.length === 1 ? '' : 's'} were excluded.`);
  }
  if (summary.clusteredByProximity) {
    notes.push(
      `${summary.clusteredByProximity} cluster${summary.clusteredByProximity === 1 ? ' was' : 's were'} built from `
      + 'straight-line distance because those sites carry no suburb or postcode. Straight-line distance is not '
      + 'driving distance across SEQ; check those days before they are handed out.',
    );
  }
  if (summary.urgentVisits) {
    notes.push(
      `${summary.urgentVisits} visit${summary.urgentVisits === 1 ? ' is' : 's are'} already outside tolerance. `
      + 'They are placed on the earliest working day available and are not batched by suburb — being late is the '
      + 'bigger cost.',
    );
  }
  if (!technicians) {
    notes.push('No technicians were given, so the window has no capacity and nothing could be placed.');
  }
  notes.push(
    'Visits are placed near the middle of each tolerance window so a day lost to weather or a locked '
    + 'cupboard does not put the service outside it.',
  );

  return {
    window,
    today,
    technicians,
    hoursPerDay,
    days: plannedDays,
    clusters: usedClusters,
    unplanned,
    summary,
    notes,
  };
}

function compareScore(a: [number, number, string], b: [number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptySummary(): PlanSummary {
  return {
    visits: 0, sites: 0, routines: 0, urgentVisits: 0,
    estimatedHours: 0, capacityHours: 0, utilisation: 0,
    workingDays: 0, notDueInWindow: 0, unplanned: 0,
    clusteredByLocality: 0, clusteredByProximity: 0,
  };
}

/** Hours as a run sheet reads them: "3.5 h", "45 min" for anything under one. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, '')} h`;
}

/**
 * The whole plan as a handful of lines, for the top of the screen and for
 * anyone who wants to know whether the month fits before reading the days.
 */
export function planHeadline(plan: WorkPlan): string {
  const s = plan.summary;
  if (!s.visits && !s.unplanned) return `Nothing falls due in ${plan.window.label}.`;
  const load = s.capacityHours > 0 ? ` — ${Math.round(s.utilisation * 100)}% of ${s.capacityHours} h available` : '';
  return `${s.visits} visit${s.visits === 1 ? '' : 's'} across ${s.sites} site${s.sites === 1 ? '' : 's'}, `
    + `${s.estimatedHours} h estimated${load}.`;
}
