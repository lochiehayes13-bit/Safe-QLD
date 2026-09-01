/**
 * Technician mode — what the app shows when it is sitting on a technician's phone.
 *
 * The app grew an office half. A work planner, a quote builder, purchase
 * requests, label runs, a rate card: all of it needed, none of it anything a
 * technician does with one hand while the other holds a detector head. Mixed
 * into the same lists as the day's jobs it costs the person on the ladder the
 * one thing they cannot get back, which is taps.
 *
 * So there are two modes and technician is the default. That default is the
 * point of the whole module: most installs are on a phone in a van, and a mode
 * switch that starts by showing everything would only ever be found by the
 * people who did not need it.
 *
 * Three rules hold this together, and the tests are written against all three.
 *
 *  1. **Nothing is ever deleted.** Hiding is not removal. Every route in the
 *     manifest is reachable in at least one mode through navigation or through
 *     the record that owns it, and `unreachableRoutes()` proves it. The proof
 *     deliberately refuses to count search: a search backstop that is allowed
 *     into the proof makes the proof vacuous, because you cannot search for a
 *     screen whose name you do not know. Search is the second way back, not
 *     the reason a screen may be dropped from the first.
 *
 *  2. **Every hidden thing says why.** A mode that hides work without saying
 *     what it hid or why is indistinguishable, from the ute, from a bug. Each
 *     hidden destination carries a sentence a technician can read on the
 *     settings screen and disagree with.
 *
 *  3. **The manifest must not drift from `app/`.** A menu that promises a
 *     screen the router does not have is worse than no menu, and a screen the
 *     menu has never heard of is unreachable in exactly the way rule 1 forbids
 *     — this repository already had six of those. `auditManifest()` takes the
 *     real list of route files and names both kinds of drift, and the test
 *     runs it against the filesystem.
 *
 * There are no external facts in this module. Every route, label and parent
 * link was read out of this repository's own `app/` directory, which is why
 * the audit rather than a citation is what keeps it honest — the source is the
 * filesystem, and it is checked rather than quoted.
 */

export type AppMode = 'technician' | 'office';

export const APP_MODES: readonly AppMode[] = ['technician', 'office'];

/**
 * Technician, always.
 *
 * Not a coin toss: an office user is sitting at a desk and will find the
 * setting, a technician halfway up a ladder will not, and the failure of
 * showing a technician too much is silent.
 */
export const DEFAULT_MODE: AppMode = 'technician';

export const MODE_LABEL: Record<AppMode, string> = {
  technician: 'Technician',
  office: 'Office',
};

export const MODE_BLURB: Record<AppMode, string> = {
  technician:
    'The work in front of you: today, the site you are standing in, the calculators and the '
    + 'reference. Pricing and planning move out of the lists and stay one search away.',
  office:
    'Everything the app has, including the work planner, quoting, ordering and the records '
    + 'across every site at once.',
};

/**
 * Reads a stored mode back.
 *
 * An unrecognised value is not silently treated as the default — the caller is
 * told what it did and why, so a preference file written by a newer build
 * shows up as a sentence on the settings screen rather than as a mode that
 * quietly reverted overnight.
 */
export function readMode(value: unknown): { mode: AppMode; assumed?: string } {
  if (value === 'technician' || value === 'office') return { mode: value };
  if (value === undefined || value === null || value === '') return { mode: DEFAULT_MODE };
  return {
    mode: DEFAULT_MODE,
    assumed:
      `This device has "${String(value)}" saved as its mode, which this build does not know. `
      + `It is showing ${MODE_LABEL[DEFAULT_MODE]} until you pick one.`,
  };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export type TabKey = 'today' | 'sites' | 'tools' | 'work' | 'settings';

/**
 * The order a technician works, which is also the order of the tab bar.
 *
 * What is on today, then the site in front of them, then the tools and the
 * reference that goes with them, then the paperwork the office needs, then
 * setup. The tab bar was already ordered by how often each is reached for, so
 * navigation built from this manifest agrees with the bar rather than
 * presenting a second, different order to learn.
 */
export const TAB_ORDER: readonly TabKey[] = ['today', 'sites', 'tools', 'work', 'settings'];

export const TAB_LABEL: Record<TabKey, string> = {
  today: 'Today',
  sites: 'Sites',
  tools: 'Tools',
  work: 'Work',
  settings: 'Settings',
};

export const TAB_BLURB: Record<TabKey, string> = {
  today: 'What is on today, and anything running against a clock.',
  sites: 'The site in front of you, and everything recorded against it.',
  tools: 'The calculations and the reference, all of it offline.',
  work: 'The records the office needs, and the stock to do the work.',
  settings: 'This device, this technician, and how the app behaves.',
};

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export interface Destination {
  /** The href, in expo-router form. Dynamic segments stay as `[id]`. */
  route: string;
  /** The file under `app/` that implements it. This is the tie to the router. */
  file: string;
  label: string;
  /** One line, in a technician's words, for a nav row or a search result. */
  blurb: string;
  tab: TabKey;
  /** Heading this sits under within its tab. */
  section: string;
  /** The modes whose lists show it. Never empty — see `validateManifest`. */
  modes: readonly AppMode[];
  /**
   * True where the screen cannot do its job without knowing which record —
   * a dynamic segment, or a required `siteId`. These are never listed in a
   * hub, because a hub row that opens a screen with no record is a dead end.
   */
  needsContext?: boolean;
  /** True for the five tab roots, which are on screen in every mode. */
  root?: boolean;
  /** Screens this is opened from. Empty only on a root. */
  openedFrom: readonly string[];
  /** What a technician would type looking for this. */
  terms: readonly string[];
  /** Why a technician does not need it. Required exactly where one is hidden. */
  hiddenBecause?: string;
  /**
   * Why something that looks like office work is still in the technician's
   * lists. Written down because the argument for hiding it gets made again
   * every few months and deserves an answer that does not depend on who is in
   * the room.
   */
  keptBecause?: string;
}

const BOTH: readonly AppMode[] = ['technician', 'office'];
const OFFICE: readonly AppMode[] = ['office'];

/**
 * Every navigable destination in the app, in the order a technician works.
 *
 * Written in nav order rather than sorted at runtime, so the file reads the
 * way the app reads; `validateManifest` enforces that each tab and each
 * section stays contiguous rather than trusting that.
 */
export const DESTINATIONS: readonly Destination[] = [
  // -- Today -----------------------------------------------------------------
  {
    route: '/', file: 'app/(tabs)/index.tsx', tab: 'today', section: 'The day',
    label: 'Today', root: true, modes: BOTH, openedFrom: [],
    blurb: 'The job you are on, what is urgent, and the question bar over everything the app holds.',
    terms: ['today', 'home', 'start', 'dashboard'],
  },
  {
    route: '/work/jobs', file: 'app/work/jobs.tsx', tab: 'today', section: 'The day',
    label: 'Jobs', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'Scheduled and outstanding work, urgent first.',
    terms: ['job', 'jobs', 'work order', 'scheduled', 'urgent'],
  },
  {
    route: '/work/route', file: 'app/work/route.tsx', tab: 'today', section: 'The day',
    label: "Today's run", modes: BOTH, openedFrom: ['/work'],
    blurb: 'The day ordered by where the work is, with the distances marked as straight-line.',
    terms: ['run', 'route', 'order', 'driving', 'nearest', 'travel'],
  },
  {
    route: '/work/due', file: 'app/work/due.tsx', tab: 'today', section: 'The day',
    label: 'Overdue and due', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'Routines past their tolerance window, across every site.',
    terms: ['due', 'overdue', 'lapsed', 'tolerance', 'schedule'],
    keptBecause:
      'It reads as an office list and it is one, but the Overdue count on Today opens it. A '
      + 'number a technician can tap that lands nowhere is worse than the list being there.',
  },
  {
    route: '/work/promises', file: 'app/work/promises.tsx', tab: 'today', section: 'The day',
    label: 'Promises', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'What you said you would come back for, so it survives the drive home.',
    terms: ['promise', 'come back', 'follow up', 'owe'],
  },
  {
    route: '/work/recurring', file: 'app/work/recurring.tsx', tab: 'today', section: 'The day',
    label: 'Recurring failures', modes: BOTH, openedFrom: ['/'],
    blurb: 'Assets that keep failing, where replacing it a fourth time will not fix it.',
    terms: ['recurring', 'repeat', 'keeps failing', 'again'],
  },
  {
    route: '/work/job/[id]', file: 'app/work/job/[id].tsx', tab: 'today', section: 'The day',
    label: 'Job', needsContext: true, modes: BOTH, openedFrom: ['/', '/work/jobs'],
    blurb: 'The site briefing: what is already broken, and what the last person found.',
    terms: ['job', 'briefing', 'attendance'],
  },
  {
    route: '/work/impairments', file: 'app/work/impairments.tsx', tab: 'today', section: 'Against a clock',
    label: 'Impairments', modes: BOTH, openedFrom: ['/work'],
    blurb: 'Systems currently out of service, with the clock running on each.',
    terms: ['impairment', 'isolation', 'out of service', 'isolated'],
  },
  {
    route: '/impairment/new', file: 'app/impairment/new.tsx', tab: 'today', section: 'Against a clock',
    label: 'Declare an impairment', modes: BOTH, openedFrom: ['/', '/work/impairments'],
    blurb: 'Takes a system out of service, and starts the clock and the obligations with it.',
    terms: ['impairment', 'declare', 'isolate', 'shut down', 'out of service'],
  },
  {
    route: '/impairment/[id]', file: 'app/impairment/[id].tsx', tab: 'today', section: 'Against a clock',
    label: 'Live impairment', needsContext: true, modes: BOTH,
    openedFrom: ['/', '/work/impairments'],
    blurb: 'One impairment, its elapsed time, and what has to happen before it can close.',
    terms: ['impairment', 'elapsed', 'restore', 'reinstate'],
  },
  {
    route: '/work/notice/[id]', file: 'app/work/notice/[id].tsx', tab: 'today', section: 'Against a clock',
    label: 'Critical defect notice', needsContext: true, modes: BOTH,
    openedFrom: ['/', '/work/defects'],
    blurb: 'The written notice the occupier is owed within 24 hours, counting down.',
    terms: ['notice', 'critical', 'occupier', '24 hours', 'commissioner'],
  },

  // -- Sites -----------------------------------------------------------------
  {
    route: '/sites', file: 'app/(tabs)/sites.tsx', tab: 'sites', section: 'Your sites',
    label: 'Sites', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Every site on the book, searched by name, address or client.',
    terms: ['site', 'sites', 'building', 'customer', 'address'],
  },
  {
    route: '/site/new', file: 'app/site/new.tsx', tab: 'sites', section: 'Your sites',
    label: 'New site', modes: BOTH, openedFrom: ['/sites'],
    blurb: 'Creates a site by hand — no configuration file needed to start using the app.',
    terms: ['new site', 'add site', 'create'],
  },
  {
    route: '/import', file: 'app/import.tsx', tab: 'sites', section: 'Your sites',
    label: 'Import', modes: BOTH, openedFrom: ['/sites', '/site/[id]'],
    blurb: 'Reads a panel configuration or an asset register, and describes what it cannot parse rather than dismissing it.',
    terms: ['import', 'config', 'csv', 'panel file', 'register'],
  },
  {
    route: '/site/[id]', file: 'app/site/[id].tsx', tab: 'sites', section: 'Your sites',
    label: 'Site', needsContext: true, modes: BOTH, openedFrom: ['/sites', '/work/job/[id]'],
    blurb: 'One site: its systems, its history, its paperwork, and the pack that hands it to another technician.',
    terms: ['site', 'building', 'pack'],
  },
  {
    route: '/scan', file: 'app/scan.tsx', tab: 'sites', section: 'In front of you',
    label: 'Scan a tag', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Reads a tag and finds the asset, the serial or the catalogue part behind it.',
    terms: ['scan', 'qr', 'barcode', 'tag', 'label'],
  },
  {
    route: '/assets/find', file: 'app/assets/find.tsx', tab: 'sites', section: 'In front of you',
    label: 'Find an asset', modes: BOTH, openedFrom: ['/'],
    blurb: 'One box across assets, imported points and the parts catalogue, because you only ever know one identifier.',
    terms: ['find', 'search asset', 'serial', 'part number', 'code'],
  },
  {
    route: '/assets/[id]', file: 'app/assets/[id].tsx', tab: 'sites', section: 'In front of you',
    label: 'Asset', needsContext: true, modes: BOTH,
    openedFrom: ['/assets/find', '/scan', '/site/assets'],
    blurb: 'What it is, and the timeline that says whether it can be trusted.',
    terms: ['asset', 'device', 'history', 'timeline'],
  },
  {
    route: '/assets/trend', file: 'app/assets/trend.tsx', tab: 'sites', section: 'In front of you',
    label: 'Measurement trend', needsContext: true, modes: BOTH, openedFrom: ['/assets/[id]'],
    blurb: 'What one asset\u2019s readings have been doing across every service, not just at this one.',
    terms: ['trend', 'measurements', 'readings', 'over time', 'declining', 'history'],
    keptBecause:
      'The hydrant that passes every year at a pressure fifteen per cent lower than it started at '
      + 'is the conversation to have before it fails, and it is a technician standing at the asset '
      + 'who is in a position to have it.',
  },
  {
    route: '/assets/new', file: 'app/assets/new.tsx', tab: 'sites', section: 'In front of you',
    // Needs the site even though the screen will let you pick one: an asset
    // filed against no site is a record nobody finds again.
    label: 'Add an asset', needsContext: true, modes: BOTH, openedFrom: ['/site/assets'],
    blurb: 'Adds one by hand, with the attributes its own type calls for.',
    terms: ['new asset', 'add device', 'register'],
  },
  {
    route: '/routine/run', file: 'app/routine/run.tsx', tab: 'sites', section: 'In front of you',
    label: 'Run a routine', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Turns a service routine into work: the app finds the assets it applies to, you answer each check.',
    terms: ['routine', 'service', 'run', 'monthly', 'annual', 'test'],
  },
  {
    route: '/work/defect/new', file: 'app/work/defect/new.tsx', tab: 'sites', section: 'In front of you',
    label: 'Raise a defect', modes: BOTH,
    openedFrom: ['/', '/work/defects', '/site/defects', '/assets/[id]'],
    blurb: 'System, component, defect — the library supplies the severity, the wording and the work to clear it.',
    terms: ['defect', 'fault', 'raise', 'report a fault', 'broken'],
  },
  {
    route: '/site/assets', file: 'app/site/assets.tsx', tab: 'sites', section: 'This site',
    label: 'Asset register', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: "The site's register, grouped by system.",
    terms: ['register', 'assets', 'devices', 'equipment'],
  },
  {
    route: '/site/points', file: 'app/site/points.tsx', tab: 'sites', section: 'This site',
    label: 'Points', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Every point off the panel configuration, with its zone text on the row.',
    terms: ['points', 'loop', 'zone text', 'addresses', 'panel'],
  },
  {
    route: '/site/zones', file: 'app/site/zones.tsx', tab: 'sites', section: 'This site',
    label: 'Zone chart', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Prints the chart for the panel door, built from the configuration imported off that panel.',
    terms: ['zone chart', 'zones', 'panel door', 'print'],
  },
  {
    route: '/site/due', file: 'app/site/due.tsx', tab: 'sites', section: 'This site',
    label: 'What is due', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Every routine this site owes, including the ones with nothing recorded against them yet.',
    terms: ['due', 'next service', 'schedule', 'frequency'],
  },
  {
    route: '/site/defects', file: 'app/site/defects.tsx', tab: 'sites', section: 'This site',
    label: 'Site defects', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Open and closed defects for this site.',
    terms: ['defects', 'faults', 'outstanding'],
  },
  {
    route: '/site/coverage', file: 'app/site/coverage.tsx', tab: 'sites', section: 'This site',
    label: 'Not tested', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'The devices nobody could reach — a hole in the year, and deliberately not a defect list.',
    terms: ['not tested', 'inaccessible', 'coverage', 'missed', 'no access'],
  },
  {
    route: '/site/history', file: 'app/site/history.tsx', tab: 'sites', section: 'This site',
    label: 'Service history', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Whether each service landed inside tolerance, measured against the date the schedule called for.',
    terms: ['history', 'past services', 'on time', 'tolerance'],
  },
  {
    route: '/site/cause-effect', file: 'app/site/cause-effect.tsx', tab: 'sites', section: 'This site',
    label: 'Cause and effect', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Edited by cause, exported as the matrix, and tested by confirming what actually happened.',
    terms: ['cause and effect', 'matrix', 'c&e', 'interface', 'commissioning'],
  },
  {
    route: '/site/parts', file: 'app/site/parts.tsx', tab: 'sites', section: 'This site',
    label: 'Parts needed', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: "What clearing this site's open defects takes, gathered from the defect codes rather than from memory.",
    terms: ['parts', 'order', 'materials', 'what to bring'],
    keptBecause:
      'It feeds a purchase order, which is office work — but it is also the list a technician '
      + 'loads the van from the night before, and no office list can be that.',
  },
  {
    route: '/site/quote', file: 'app/site/quote.tsx', tab: 'sites', section: 'This site',
    label: 'Quote', needsContext: true, modes: OFFICE, openedFrom: ['/site/[id]'],
    blurb: 'Prices the rectification work from the defect list and the rate card.',
    terms: ['quote', 'price', 'rectification', 'sell', 'estimate'],
    hiddenBecause:
      'A quote carries cost and margin, and a number given on the spot commits the company to '
      + 'something nobody has checked. Raise the defect — the quote lines come off it — and let '
      + 'the office price it.',
  },
  {
    route: '/report/[id]', file: 'app/report/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Test sheet', needsContext: true, modes: BOTH,
    openedFrom: ['/site/[id]', '/work/reports', '/routine/run'],
    blurb: 'The service report: one tap per device, everything else behind a tab so the list stays the screen.',
    terms: ['test sheet', 'report', 'service report', 'results'],
  },
  {
    route: '/site/form72', file: 'app/site/form72.tsx', tab: 'sites', section: 'Paperwork',
    label: 'Form 72s', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: "The Form 72s held for this site, and the start of a new one.",
    terms: ['form 72', 'certificate', 'occupier', 'qfes'],
  },
  {
    route: '/form72/[id]', file: 'app/form72/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Form 72', needsContext: true, modes: BOTH, openedFrom: ['/site/form72'],
    blurb: "One Form 72, laid out part for part in the department's own order and signed on site.",
    terms: ['form 72', 'sign', 'declaration', 'booster', 'hydrant test'],
  },
  {
    route: '/occupier/[id]', file: 'app/occupier/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Occupier statement', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: "The annual statement, arriving already filled in from the year's own work.",
    terms: ['occupier statement', 'annual', 'prescribed installation', 'declaration'],
  },
  {
    route: '/assessment/[id]', file: 'app/assessment/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Effectiveness assessment', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Not a service: recommendations and observations, and nothing found here is a defect.',
    terms: ['assessment', 'effectiveness', 'recommendation', 'observation', 'audit'],
  },
  {
    route: '/baseline/[id]', file: 'app/baseline/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Baseline data', needsContext: true, modes: BOTH,
    openedFrom: ['/site/[id]', '/work/baselines'],
    blurb: 'The commissioning record, saved on every keystroke so a lock screen costs nothing.',
    terms: ['baseline', 'commissioning', 'as installed'],
  },

  // -- Tools -----------------------------------------------------------------
  {
    route: '/tools', file: 'app/(tabs)/tools.tsx', tab: 'tools', section: 'Calculators',
    label: 'Tools', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Every calculation and reference a technician looks up on site, all of it offline.',
    terms: ['tools', 'calculator', 'calculators'],
  },
  {
    route: '/tools/battery', file: 'app/tools/battery.tsx', tab: 'tools', section: 'Calculators',
    label: 'FIP battery', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Sizes a standby battery from a load schedule rather than from two total-current boxes.',
    terms: ['battery', 'standby', 'ah', 'quiescent', 'alarm current', 'fip'],
  },
  {
    route: '/tools/vesda', file: 'app/tools/vesda.tsx', tab: 'tools', section: 'Calculators',
    label: 'VESDA battery', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'The same calculation with the aspirator setting made a required choice, because it is the biggest lever in it.',
    terms: ['vesda', 'aspirating', 'asd', 'battery', 'aspirator'],
  },
  {
    route: '/tools/voltdrop', file: 'app/tools/voltdrop.tsx', tab: 'tools', section: 'Calculators',
    label: 'Cable volt drop', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Whether the device at the far end of a long run still sees enough voltage to operate in alarm.',
    terms: ['volt drop', 'cable', 'sounder', 'run', 'voltage'],
  },
  {
    route: '/tools/ohms', file: 'app/tools/ohms.tsx', tab: 'tools', section: 'Calculators',
    label: 'Electrical', modes: BOTH, openedFrom: ['/tools'],
    blurb: "Ohm's law, power and battery runtime — the arithmetic that turns up daily.",
    terms: ['ohms law', 'volts', 'amps', 'watts', 'runtime', 'power'],
  },
  {
    route: '/tools/converter', file: 'app/tools/converter.tsx', tab: 'tools', section: 'Calculators',
    label: 'Unit converter', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Shows every unit at once, because on site the question is what this is in everything else.',
    terms: ['convert', 'units', 'kpa', 'psi', 'litres', 'metres'],
  },
  {
    route: '/tools/resistor', file: 'app/tools/resistor.tsx', tab: 'tools', section: 'Calculators',
    label: 'Resistor decoder', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Bands to a value with an unknown part in your hand, and a value back to bands before you fit one.',
    terms: ['resistor', 'bands', 'colour code', 'ohms', '4k7'],
  },
  {
    route: '/tools/dipswitch', file: 'app/tools/dipswitch.tsx', tab: 'tools', section: 'Calculators',
    label: 'Device address', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Draws the switch bank, so what is in your hand can be matched against what the panel expects.',
    terms: ['address', 'dip switch', 'dipswitch', 'loop', 'protocol'],
  },
  {
    route: '/tools/detector-age', file: 'app/tools/detector-age.tsx', tab: 'tools', section: 'Calculators',
    label: 'Detector age', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Reads the date code off a head and returns every year it could be, rather than the likeliest one.',
    terms: ['detector age', 'date code', 'head', 'service life', 'replace'],
  },
  {
    route: '/tools/eol', file: 'app/tools/eol.tsx', tab: 'tools', section: 'Calculators',
    label: 'End of line', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'End-of-line values per panel and per circuit, each with its source, because one universal table would be wrong on most sites.',
    terms: ['end of line', 'eol', 'resistor', 'monitoring', 'circuit'],
  },
  {
    route: '/tools/hose-reel', file: 'app/tools/hose-reel.tsx', tab: 'tools', section: 'Calculators',
    label: 'Hose reels', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Whether the reel reaches the back of the room, whether it made its duty, and which service is next.',
    terms: ['hose reel', 'reel', 'coverage', 'reach', 'flow', 'nozzle'],
    keptBecause:
      'A hose reel is the only asset on the book whose whole job is a distance, and nobody checks '
      + 'it because the reel is already on the wall.',
  },
  {
    route: '/tools/fire-door', file: 'app/tools/fire-door.tsx', tab: 'tools', section: 'Calculators',
    label: 'Fire and smoke doors', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'What the tag says, whether the gap passes, whether it closed and latched, and what to write down.',
    terms: ['fire door', 'smoke door', 'door', 'gap', 'clearance', 'latch', 'self closing', 'tag'],
  },
  {
    route: '/tools/spl', file: 'app/tools/spl.tsx', tab: 'tools', section: 'Calculators',
    label: 'Sound pressure level', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'What the reading on the meter has to beat, with the assumption behind the answer printed above it.',
    terms: ['spl', 'sound', 'db', 'decibel', 'loud', 'sounder', 'ewis'],
  },
  {
    route: '/tools/hydrant', file: 'app/tools/hydrant.tsx', tab: 'tools', section: 'Calculators',
    label: 'Hydrant flow test', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Flow measured, supply worked back to the pressure the brigade needs, then the losses that explain a marginal result.',
    terms: ['hydrant', 'flow', 'pressure', 'booster', 'lps', 'kpa'],
  },
  {
    route: '/tools/flow-certificate', file: 'app/tools/flow-certificate.tsx', tab: 'tools', section: 'Calculators',
    label: 'Flow certificate', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'The combined sprinkler and hydrant certificate, with the litres-per-minute and litres-per-second mix-up done on the page rather than in your head.',
    terms: ['flow certificate', 'combined', 'sprinkler', 'hydrant', 'pump', 'duty'],
  },
  {
    route: '/tools/extinguisher', file: 'app/tools/extinguisher.tsx', tab: 'tools', section: 'Calculators',
    label: 'Extinguishers', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'What it is and what it must never be pointed at, when its next test falls, and whether it is still full.',
    terms: ['extinguisher', 'co2', 'dry chemical', 'pressure test', 'weigh'],
  },
  {
    route: '/tools/emergency-lighting', file: 'app/tools/emergency-lighting.tsx', tab: 'tools', section: 'Calculators',
    label: 'Emergency lighting', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Pass or fail, how far a sign can be read from, whether the battery age explains it, and whether the room has anything like enough light.',
    terms: ['emergency lighting', 'exit sign', 'discharge', 'lux', 'viewing distance'],
  },
  {
    route: '/library', file: 'app/library/index.tsx', tab: 'tools', section: 'Reference',
    label: 'Standards', modes: BOTH, openedFrom: ['/', '/tools'],
    blurb: 'The clause index and your own imported documents, searched the way the question gets asked, offline.',
    terms: ['standard', 'standards', 'clause', 'as 1851', 'as 1670', 'library'],
  },
  {
    route: '/library/[id]', file: 'app/library/[id].tsx', tab: 'tools', section: 'Reference',
    label: 'One standard', needsContext: true, modes: BOTH, openedFrom: ['/library'],
    blurb: 'Clause by clause in plain English, saying nothing at all where nobody has written it up.',
    terms: ['clause', 'standard', 'index'],
  },
  {
    route: '/tools/routines', file: 'app/tools/routines.tsx', tab: 'tools', section: 'Reference',
    label: 'Service routines', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'What you are actually meant to do here, and why, with the source of every check named.',
    terms: ['routine', 'monthly', 'annual', 'checks', 'what to do'],
  },
  {
    route: '/tools/defects', file: 'app/tools/defects.tsx', tab: 'tools', section: 'Reference',
    label: 'Defect library', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'The coded wording that goes on a report, and the work that clears it.',
    terms: ['defect', 'wording', 'code', 'critical', 'rectification'],
  },
  {
    route: '/catalogue', file: 'app/catalogue/index.tsx', tab: 'tools', section: 'Reference',
    label: 'Parts', modes: BOTH, openedFrom: ['/', '/tools'],
    blurb: 'Part numbers, brands and descriptions, searched all at once because you only know one of them.',
    terms: ['part', 'catalogue', 'part number', 'brand', 'spares'],
  },
  {
    route: '/ask', file: 'app/ask.tsx', tab: 'tools', section: 'Reference',
    label: 'Ask Safe QLD', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'A search across everything the app holds, which says on the screen that it is not a language model.',
    terms: ['ask', 'question', 'search', 'how do i'],
  },

  // -- Work ------------------------------------------------------------------
  {
    route: '/work', file: 'app/(tabs)/work.tsx', tab: 'work', section: 'Records',
    label: 'Work', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Everything that produces a record the office needs.',
    terms: ['work', 'records'],
  },
  {
    route: '/work/defects', file: 'app/work/defects.tsx', tab: 'work', section: 'Records',
    label: 'Defects', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'Raised, quoted and outstanding, aged in days so a list feels as urgent as it is.',
    terms: ['defects', 'outstanding', 'open', 'faults'],
  },
  {
    route: '/work/outbound', file: 'app/work/outbound.tsx', tab: 'work', section: 'Records',
    label: 'Send to the office', modes: BOTH, openedFrom: ['/work'],
    blurb: 'A finished service and the defects it raised, pushed to the Simpro job as notes.',
    terms: ['send', 'office', 'simpro', 'push', 'upload', 'sync', 'job note'],
    keptBecause:
      'A technician is the only person who knows the service is finished, and the office finding '
      + 'out when the paperwork arrives is how an invoice goes out for a service that was nine '
      + 'assets short. The review before it sends is on this screen too, and that is the part '
      + 'that has to be read on site rather than in an office.',
  },
  {
    route: '/work/reports', file: 'app/work/reports.tsx', tab: 'work', section: 'Records',
    label: 'Test sheets', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'Every service report on this device, newest first.',
    terms: ['test sheets', 'reports', 'service reports'],
    keptBecause:
      'The sheet you were filling in this morning is reopened from here. Making a technician '
      + 'walk back through the site to find their own half-finished report is how it gets '
      + 'finished on paper instead.',
  },
  {
    route: '/work/timesheets', file: 'app/work/timesheets.tsx', tab: 'work', section: 'Records',
    label: 'Timesheets', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'Your week, the attendances in it, and the sign-off that ends it.',
    terms: ['timesheet', 'hours', 'week', 'pay', 'attendance'],
    keptBecause:
      'Named as an office feature, kept anyway: a technician\'s own hours are the one payroll '
      + 'record only they can enter, and the alternative to this screen is a paper docket that '
      + 'reaches the office a fortnight late.',
  },
  {
    route: '/timesheet/[id]', file: 'app/timesheet/[id].tsx', tab: 'work', section: 'Records',
    label: 'One week', needsContext: true, modes: BOTH, openedFrom: ['/work/timesheets'],
    blurb: "A week's attendances, and behind a tap what they are worth as an estimate.",
    terms: ['timesheet', 'week', 'attendances', 'value'],
  },
  {
    route: '/work/baselines', file: 'app/work/baselines.tsx', tab: 'work', section: 'Records',
    label: 'Baseline data', modes: OFFICE, openedFrom: ['/work'],
    blurb: 'Commissioning records across every site.',
    terms: ['baseline', 'commissioning', 'records'],
    hiddenBecause:
      'This is the all-sites list, and a technician works one site at a time. The record itself '
      + 'is untouched — it opens from the site that owns it, which is also the only place it '
      + 'means anything.',
  },
  {
    route: '/work/stock', file: 'app/work/stock.tsx', tab: 'work', section: 'Parts and stock',
    label: 'Van stock', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'What you carry, and what tomorrow will leave you short of.',
    terms: ['stock', 'van', 'restock', 'inventory', 'spares'],
  },
  {
    route: '/work/purchases', file: 'app/work/purchases.tsx', tab: 'work', section: 'Parts and stock',
    label: 'Purchase requests', modes: OFFICE, openedFrom: ['/work', '/work/stock'],
    blurb: 'Parts to order, queued until the phone has signal.',
    terms: ['purchase', 'order', 'request', 'parts', 'buy'],
    hiddenBecause:
      'Ordering is the office\'s job. You still raise a request in one action from Van stock '
      + 'when you run out — this is the list of everybody\'s requests, and nothing on it is work '
      + 'you can do.',
  },
  {
    route: '/work/knowledge', file: 'app/work/knowledge.tsx', tab: 'work', section: 'Parts and stock',
    label: 'Company knowledge', modes: BOTH, openedFrom: ['/', '/work'],
    blurb: 'Tricks of the trade, marked verified or not wherever they are used.',
    terms: ['knowledge', 'tips', 'notes', 'how we do it'],
  },
  {
    route: '/work/portfolio', file: 'app/work/portfolio.tsx', tab: 'work', section: 'Planning',
    label: 'Portfolio health', modes: OFFICE, openedFrom: ['/work'],
    blurb: 'How the whole book is going, with the coverage figure printed before any health figure.',
    terms: ['portfolio', 'health', 'overview', 'dashboard', 'coverage', 'how are we going'],
    hiddenBecause:
      'How 897 sites are going is not a question anybody answers from a plant room, and it is not '
      + 'actionable by the person standing in one. The site in front of you already shows its own '
      + 'state in full.',
  },
  {
    route: '/work/plan', file: 'app/work/plan.tsx', tab: 'work', section: 'Planning',
    label: 'Work planner', modes: OFFICE, openedFrom: ['/work'],
    blurb: 'The month laid out day by day, with every hours figure marked as an estimate.',
    terms: ['plan', 'planner', 'month', 'schedule', 'capacity'],
    hiddenBecause:
      'Deciding who goes where next month is not a decision made from a plant room, and a '
      + 'technician acting on a draft plan that has not been agreed is worse than not seeing it. '
      + "Today's run is the same question for the day you are actually in.",
  },
  {
    route: '/work/labels', file: 'app/work/labels.tsx', tab: 'work', section: 'Planning',
    label: 'Asset labels', modes: OFFICE, openedFrom: ['/work'],
    blurb: 'Issues numbers to untagged assets and prints the sheet.',
    terms: ['labels', 'tags', 'print', 'numbering', 'untagged'],
    hiddenBecause:
      'A batch job that ends at a label printer, so it happens in the workshop and not on site. '
      + 'The numbers it issues are what you scan afterwards.',
  },

  // -- Settings --------------------------------------------------------------
  {
    route: '/settings', file: 'app/(tabs)/settings.tsx', tab: 'settings', section: 'Setup',
    label: 'Settings', root: true, modes: BOTH, openedFrom: [],
    blurb: 'You, the office system, the rate card, storage, and what this device is holding.',
    terms: ['settings', 'setup', 'preferences', 'sync', 'simpro'],
  },
  {
    route: '/settings/mode', file: 'app/settings/mode.tsx', tab: 'settings', section: 'Setup',
    label: 'Technician or office', modes: BOTH, openedFrom: ['/settings'],
    blurb: 'Picks which of the two views this device shows, and lists exactly what each one holds back and why.',
    terms: ['mode', 'technician', 'office', 'hide', 'simplify', 'view'],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_ROUTE: ReadonlyMap<string, Destination> = new Map(
  DESTINATIONS.map((d) => [d.route, d]),
);

const ROOT_BY_TAB: Partial<Record<TabKey, string>> = (() => {
  const out: Partial<Record<TabKey, string>> = {};
  for (const d of DESTINATIONS) if (d.root) out[d.tab] = d.route;
  return out;
})();

/** Undefined for a route the manifest has never heard of, rather than a guess. */
export function destinationAt(route: string): Destination | undefined {
  return BY_ROUTE.get(route);
}

/** Does this mode put it in front of you? Unknown routes are not shown by anything. */
export function shows(mode: AppMode, route: string): boolean {
  return BY_ROUTE.get(route)?.modes.includes(mode) ?? false;
}

/** Everything a mode shows, in manifest order — hub rows and record screens alike. */
export function destinationsFor(mode: AppMode): Destination[] {
  return DESTINATIONS.filter((d) => d.modes.includes(mode));
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavSection {
  title: string;
  destinations: Destination[];
}

export interface NavGroup {
  tab: TabKey;
  label: string;
  blurb: string;
  sections: NavSection[];
}

/**
 * The mode's navigation, grouped by tab, in the order a technician works.
 *
 * Record screens are left out on purpose. A row that opens `/site/[id]` with no
 * site is a dead end, and a menu full of dead ends is how a technician stops
 * trusting the menu. They are still in the manifest, still counted by
 * `destinationsFor`, and still reachable from the record that owns them.
 */
export function navFor(mode: AppMode): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const tab of TAB_ORDER) {
    const sections: NavSection[] = [];
    for (const d of DESTINATIONS) {
      if (d.tab !== tab || d.needsContext || !d.modes.includes(mode)) continue;
      const last = sections[sections.length - 1];
      if (last && last.title === d.section) last.destinations.push(d);
      else sections.push({ title: d.section, destinations: [d] });
    }
    if (sections.length) {
      groups.push({ tab, label: TAB_LABEL[tab], blurb: TAB_BLURB[tab], sections });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

export type ReachChannel =
  /** Listed in this mode's navigation, under its tab. */
  | 'nav'
  /** Opened from the record it belongs to, which is itself reachable. */
  | 'record'
  /** Not listed in this mode: found by name and opened from the result. */
  | 'search'
  /** Not listed, and it needs a record — so a direct link, or a minute in the other mode. */
  | 'link';

export interface Reach {
  route: string;
  mode: AppMode;
  reachable: boolean;
  channel: ReachChannel;
  /** The tap path, first screen to last. Empty where nothing opens it. */
  chain: string[];
  /** The same thing in a technician's words. */
  sentence: string;
  /**
   * True only for `nav` and `record`.
   *
   * Search is deliberately not a proof. Letting it count would make every
   * route trivially reachable and the guarantee meaningless — you cannot
   * search for a screen whose name you have never seen.
   */
  proven: boolean;
}

function labelOf(route: string): string {
  return BY_ROUTE.get(route)?.label ?? route;
}

function pathWords(chain: string[]): string {
  return chain.map(labelOf).join(' → ');
}

/**
 * The shortest tap path to a route in a mode, or undefined if this mode's
 * lists do not lead there. Parents are explored on their own copy of the
 * visited set, so one dead branch cannot poison a live one.
 */
function provenChain(route: string, mode: AppMode, seen: Set<string>): string[] | undefined {
  const d = BY_ROUTE.get(route);
  if (!d || seen.has(route) || !d.modes.includes(mode)) return undefined;
  if (d.root) return [route];
  if (!d.needsContext) {
    const root = ROOT_BY_TAB[d.tab];
    return root ? [root, route] : undefined;
  }
  const next = new Set(seen).add(route);
  let best: string[] | undefined;
  for (const parent of d.openedFrom) {
    const via = provenChain(parent, mode, new Set(next));
    if (via && (!best || via.length + 1 < best.length)) best = [...via, route];
  }
  return best;
}

/** How this mode gets you there — or undefined for a route nobody has heard of. */
export function reach(route: string, mode: AppMode): Reach | undefined {
  const d = BY_ROUTE.get(route);
  if (!d) return undefined;

  const chain = provenChain(route, mode, new Set());
  if (chain) {
    const channel: ReachChannel = !d.needsContext ? 'nav' : 'record';
    return {
      route, mode, reachable: true, proven: true, channel, chain,
      sentence: `${pathWords(chain)}.`,
    };
  }

  if (d.modes.includes(mode)) {
    // Listed, but nothing in this mode opens it. That is a hole in the
    // manifest rather than a design decision, so it is reported as one.
    return {
      route, mode, reachable: false, proven: false, channel: 'link', chain: [],
      sentence:
        `${d.label} is listed in ${MODE_LABEL[mode]} but nothing in ${MODE_LABEL[mode]} opens it. `
        + 'That is a fault in the manifest, not a setting.',
    };
  }

  if (d.needsContext) {
    const owner = d.openedFrom[0];
    return {
      route, mode, reachable: true, proven: false, channel: 'link', chain: [],
      sentence:
        `Not shown in ${MODE_LABEL[mode]}. It needs a record to open, so it comes back from a `
        + `direct link${owner ? `, or from ${labelOf(owner)} in ${MODE_LABEL['office']} mode` : ''}. `
        + 'Nothing was deleted.',
    };
  }

  return {
    route, mode, reachable: true, proven: false, channel: 'search', chain: [],
    sentence:
      `Not shown in ${MODE_LABEL[mode]}. Search "${d.label.toLowerCase()}" under Settings → `
      + `Technician or office and it opens from the result, or go straight to ${d.route}. `
      + 'Nothing was deleted.',
  };
}

/**
 * The proof behind rule 1: routes no mode can navigate to.
 *
 * Expected to be empty, and the test says so. It is the check that would have
 * caught the six screens this repository had already built and never linked to
 * anything — a screen nobody can reach is the same as a screen nobody wrote.
 */
export function unreachableRoutes(): string[] {
  return DESTINATIONS
    .filter((d) => !APP_MODES.some((m) => reach(d.route, m)?.proven))
    .map((d) => d.route);
}

export interface HiddenNote {
  destination: Destination;
  /** Why a technician does not need it. */
  because: string;
  /** How it is still got at, said in full. */
  stillReachedBy: Reach;
  /** The mode that does show it, so the settings screen can say where it went. */
  shownIn: AppMode[];
}

/** What this mode holds back, each with its reason and its way back. */
export function hiddenFrom(mode: AppMode): HiddenNote[] {
  return DESTINATIONS
    .filter((d) => !d.modes.includes(mode))
    .map((d) => ({
      destination: d,
      because: d.hiddenBecause ?? 'No reason recorded, which is itself a fault — see validateManifest.',
      stillReachedBy: reach(d.route, mode)!,
      shownIn: APP_MODES.filter((m) => d.modes.includes(m)),
    }));
}

/**
 * Things that look like office work and stay anyway.
 *
 * The argument for cutting these gets made every few months. Writing the answer
 * down once, where the person making the argument can read it, is cheaper than
 * having it again.
 */
export function keptForTechnician(): Destination[] {
  return DESTINATIONS.filter((d) => d.keptBecause && d.modes.includes('technician'));
}

// ---------------------------------------------------------------------------
// Finding a screen by name
// ---------------------------------------------------------------------------

export interface DestinationHit {
  destination: Destination;
  /** True when the mode asked about does not list it — shown, not filtered out. */
  hidden: boolean;
  /** What matched, so a result is never a black box. */
  matched: 'name' | 'a word for it' | 'its description' | 'its address';
  score: number;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Search over every destination in the app, whatever mode is set.
 *
 * This is the second way back to anything technician mode holds back, and it
 * deliberately does not filter by mode — a search that hides what the current
 * mode hides would turn a trimmed menu into a locked one. Hidden results come
 * back flagged rather than dropped.
 *
 * Below two characters it returns nothing at all. A one-letter query matches
 * half the app, and half the app is not an answer.
 */
export function searchDestinations(query: string, mode: AppMode = DEFAULT_MODE, limit = 8): DestinationHit[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const words = q.split(' ');

  const hits: DestinationHit[] = [];
  for (const d of DESTINATIONS) {
    const name = normalise(d.label);
    const terms = d.terms.map(normalise);
    const address = normalise(d.route);
    const prose = normalise(`${d.blurb} ${d.section} ${TAB_LABEL[d.tab]}`);
    const hay = `${name} ${terms.join(' ')} ${address} ${prose}`;

    // Every word has to land somewhere. A query that half matches is the
    // nearest thing lying around, and this app does not hand those over.
    if (!words.every((w) => hay.includes(w))) continue;

    let score = 0;
    let matched: DestinationHit['matched'] = 'its description';
    if (name === q) { score = 100; matched = 'name'; }
    else if (name.startsWith(q)) { score = 80; matched = 'name'; }
    else if (name.includes(q)) { score = 60; matched = 'name'; }
    else if (terms.some((t) => t === q)) { score = 55; matched = 'a word for it'; }
    else if (terms.some((t) => t.includes(q))) { score = 45; matched = 'a word for it'; }
    else if (address.includes(q)) { score = 35; matched = 'its address'; }
    else { score = 20 + words.filter((w) => name.includes(w) || terms.some((t) => t.includes(w))).length; }

    hits.push({ destination: d, hidden: !d.modes.includes(mode), matched, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.destination.label.localeCompare(b.destination.label))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Keeping the manifest honest
// ---------------------------------------------------------------------------

export interface ManifestAudit {
  /** In the manifest, no such file under app/. The menu promises a screen the router has not got. */
  missingFromApp: string[];
  /** Under app/, absent from the manifest. A screen the menu has never heard of. */
  missingFromManifest: string[];
  ok: boolean;
}

/**
 * Compares the manifest against the real route files.
 *
 * Takes the file list rather than reading the disk itself, because this module
 * has to load in a test and in a bundle where there is no `app/` directory to
 * read. The test hands it the filesystem; a build step could hand it anything.
 */
export function auditManifest(routeFiles: readonly string[]): ManifestAudit {
  const real = new Set(
    routeFiles
      .map((f) => f.replace(/^\.\//, ''))
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('_layout.tsx')),
  );
  const listed = new Set(DESTINATIONS.map((d) => d.file));
  const missingFromApp = [...listed].filter((f) => !real.has(f)).sort();
  const missingFromManifest = [...real].filter((f) => !listed.has(f)).sort();
  return { missingFromApp, missingFromManifest, ok: !missingFromApp.length && !missingFromManifest.length };
}

/**
 * Everything that must be true of the manifest, said once.
 *
 * Returns the problems in plain sentences rather than throwing: the settings
 * screen shows them, so a manifest that has gone wrong is visible to the
 * person using the app rather than only to whoever runs the tests.
 */
export function validateManifest(): string[] {
  const problems: string[] = [];
  const seenRoute = new Set<string>();
  const seenFile = new Set<string>();

  for (const d of DESTINATIONS) {
    if (seenRoute.has(d.route)) problems.push(`${d.route} is in the manifest twice.`);
    seenRoute.add(d.route);
    if (seenFile.has(d.file)) problems.push(`${d.file} is claimed by two destinations.`);
    seenFile.add(d.file);

    if (!d.modes.length) problems.push(`${d.route} is in no mode at all, so nothing lists it.`);
    if (!d.label.trim() || !d.blurb.trim()) problems.push(`${d.route} is missing a label or a blurb.`);
    if (!d.terms.length) problems.push(`${d.route} has no search terms, so it cannot be found by name.`);

    const hiddenFromTech = !d.modes.includes('technician');
    if (hiddenFromTech && !d.hiddenBecause) {
      problems.push(`${d.route} is hidden from Technician with no reason given.`);
    }
    if (!hiddenFromTech && d.hiddenBecause) {
      problems.push(`${d.route} carries a reason for being hidden but is not hidden.`);
    }
    if (!d.modes.includes('office')) {
      problems.push(`${d.route} is not in Office. Office is the mode that shows everything.`);
    }

    if (d.root && d.openedFrom.length) problems.push(`${d.route} is a tab root and cannot be opened from anywhere.`);
    if (!d.root && !d.openedFrom.length) problems.push(`${d.route} is opened from nowhere.`);
    for (const parent of d.openedFrom) {
      if (!BY_ROUTE.has(parent)) problems.push(`${d.route} says it opens from ${parent}, which is not in the manifest.`);
    }
  }

  for (const tab of TAB_ORDER) {
    const roots = DESTINATIONS.filter((d) => d.root && d.tab === tab);
    if (roots.length !== 1) problems.push(`The ${TAB_LABEL[tab]} tab has ${roots.length} roots; it needs exactly one.`);
  }
  for (const d of DESTINATIONS) {
    if (!TAB_ORDER.includes(d.tab)) problems.push(`${d.route} sits under an unknown tab.`);
  }

  // The file is written in nav order, so a tab or a section that appears,
  // stops and starts again means the reading order and the app's order have
  // quietly parted company.
  const runs = (key: (d: Destination) => string) => {
    const seen = new Set<string>();
    let prev = '';
    for (const d of DESTINATIONS) {
      const k = key(d);
      if (k !== prev && seen.has(k)) problems.push(`${k} is split across the manifest instead of being written in one run.`);
      seen.add(k);
      prev = k;
    }
  };
  runs((d) => d.tab);
  runs((d) => `${d.tab}/${d.section}`);

  for (const route of unreachableRoutes()) {
    problems.push(`${route} cannot be reached in any mode.`);
  }

  const tech = destinationsFor('technician').length;
  const office = destinationsFor('office').length;
  if (tech >= office) {
    problems.push('Technician mode is not smaller than Office, so the setting does nothing.');
  }

  return problems;
}

export interface ModeSummary {
  mode: AppMode;
  /** Rows this mode puts in a hub. */
  listed: number;
  /** Record screens it shows, which are opened from a record rather than a menu. */
  contextual: number;
  /** Destinations it holds back. */
  hidden: number;
  total: number;
}

/** The numbers behind the setting, for the screen that offers it. */
export function summarise(mode: AppMode): ModeSummary {
  const shown = destinationsFor(mode);
  return {
    mode,
    listed: shown.filter((d) => !d.needsContext).length,
    contextual: shown.filter((d) => d.needsContext).length,
    hidden: DESTINATIONS.length - shown.length,
    total: DESTINATIONS.length,
  };
}
