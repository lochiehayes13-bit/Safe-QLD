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
 *     runs it against the filesystem. `auditLinks()` does the same job one
 *     level down, on the links between the screens: a path this module prints
 *     is only worth printing if the file at each step really does open the
 *     next one, and two of those claims were wrong when they were first
 *     written down from memory.
 *
 * There are no external facts in this module. Every route, label and parent
 * link was read out of this repository's own `app/` directory, which is why
 * the audit rather than a citation is what keeps it honest — the source is the
 * filesystem, and it is checked rather than quoted.
 *
 * What this module does **not** yet do: the Today, Tools and Work hubs still
 * carry their own hardcoded rows, so choosing a mode changes what this module
 * reports and not yet what those hubs list. `navFor()` returns exactly what a
 * hub needs — tab, section, title, label, blurb and route — and until one of
 * them is built from it, Technician mode describes the app that is intended
 * rather than the app that ships. It is said here, and on the settings screen,
 * because a setting that quietly does nothing is the same class of failure as
 * a setting that quietly deletes something.
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

/**
 * The trade a phone is on, which is a different question from how much of the
 * app it shows.
 *
 * "A service module and a construction module, so my service boys see one side
 * of the app and the construction boys see their side." The temptation was to
 * add them beside technician and office as two more values of one setting, and
 * that would have been wrong: a service technician and a construction
 * technician are both technicians, and neither of them is the office. The two
 * questions are independent —
 *
 *   how much of the app   technician / office
 *   which trade's work    service / construction / both
 *
 * — so they are two settings, and a phone answers both. Four values on one
 * setting would have forced a construction technician to choose between seeing
 * the wiring tables and seeing a technician-sized app.
 *
 * The stream is a softer filter than the mode, deliberately. It narrows the
 * hubs and nothing else: All modules still lists every module in the app and
 * search still finds everything, so anything a stream holds back is one tap
 * from the home screen. That makes rule 1 at the top of this file trivially
 * true on this axis — nothing is deleted, and nobody has to know a screen
 * exists to get to it.
 */
export type TradeStream = 'service' | 'construction';

export const TRADE_STREAMS: readonly TradeStream[] = ['service', 'construction'];

/** A phone's answer: one stream, or both. */
export type StreamChoice = TradeStream | 'both';

export const STREAM_CHOICES: readonly StreamChoice[] = ['both', 'service', 'construction'];

/**
 * Both, and it is not a coin toss either.
 *
 * Most of this company's technicians do both kinds of work in a week, and the
 * failure of showing somebody too much is a longer list, while the failure of
 * showing them too little is a job they cannot do from the van. So a phone
 * shows everything until somebody decides otherwise on that phone.
 */
export const DEFAULT_STREAM: StreamChoice = 'both';

export const STREAM_LABEL: Record<StreamChoice, string> = {
  both: 'Both',
  service: 'Service',
  construction: 'Construction',
};

export const STREAM_BLURB: Record<StreamChoice, string> = {
  both:
    'Everything, which is what most people want: the routine servicing side and the install side '
    + 'in the same lists.',
  service:
    'Routine servicing of systems that are already in: routines, what is due, test sheets, occupier '
    + 'statements and the history behind them. The install and design tools move out of the hubs.',
  construction:
    'Putting systems in: cable sizing, the wiring tables, fault loop, maximum demand, labelling and '
    + 'the register import. The routine servicing lists move out of the hubs.',
};

/** Reads a stored stream, and says so where it could not. */
export function readStream(value: unknown): { stream: StreamChoice; assumed?: string } {
  if (value === 'service' || value === 'construction' || value === 'both') return { stream: value };
  if (value === undefined || value === null || value === '') return { stream: DEFAULT_STREAM };
  return {
    stream: DEFAULT_STREAM,
    assumed: `This phone has "${String(value)}" saved as its trade, which is not one this app knows. `
      + 'It is showing both until you pick one.',
  };
}

/**
 * What a phone is set to, on both axes.
 *
 * Every function below takes either a bare mode — which is what it always took
 * — or this. A bare mode means both streams, so nothing that was written
 * against the old signature changes behaviour by being left alone.
 */
export interface AppView {
  mode: AppMode;
  stream: StreamChoice;
}

export type ViewLike = AppMode | AppView;

function asView(v: ViewLike): AppView {
  return typeof v === 'string' ? { mode: v, stream: 'both' } : v;
}

export type TabKey = 'today' | 'sites' | 'map' | 'tools' | 'work' | 'settings';

/**
 * The order a technician works, which is also the order of the tab bar.
 *
 * What is on today, then the site in front of them, then the tools and the
 * reference that goes with them, then the paperwork the office needs, then
 * setup. The tab bar was already ordered by how often each is reached for, so
 * navigation built from this manifest agrees with the bar rather than
 * presenting a second, different order to learn.
 */
export const TAB_ORDER: readonly TabKey[] = ['today', 'sites', 'map', 'tools', 'work', 'settings'];

export const TAB_LABEL: Record<TabKey, string> = {
  today: 'Home',
  sites: 'Sites',
  map: 'Map',
  tools: 'Tools',
  work: 'Work',
  settings: 'Settings',
};

export const TAB_BLURB: Record<TabKey, string> = {
  today: 'The question bar, the modules you chose, and anything running against a clock.',
  sites: 'The site in front of you, and everything recorded against it.',
  map: 'Every place we service on a map, and whether the place you are looking at is ours.',
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
   * The trade streams whose hubs list it. Absent means both, which is almost
   * everything: the split is deliberately narrow, because a module hidden from
   * somebody who needed it costs more than a module they scroll past.
   */
  streams?: readonly TradeStream[];
  /**
   * Why the other stream does not need it in its hubs. Required exactly where
   * `streams` is set, and `validateManifest` checks both directions.
   */
  streamBecause?: string;
  /**
   * True where the screen cannot do its job without knowing which record —
   * a dynamic segment, or a required `siteId`. These are never listed in a
   * hub, because a hub row that opens a screen with no record is a dead end.
   */
  needsContext?: boolean;
  /** True for the five tab roots, which are on screen in every mode. */
  root?: boolean;
  /**
   * A second file that carries this screen's navigation.
   *
   * `auditLinks` proves a link by finding the route written out in the parent's
   * own source. That works while every screen names its destinations directly,
   * and stops working the moment one renders a list from a registry: the home
   * screen picker pushes `m.href`, and the literals live in the registry it
   * maps over. Naming that file here keeps the proof — the route still has to
   * appear verbatim somewhere real — rather than loosening the check to accept
   * a screen that might navigate anywhere.
   */
  opensVia?: string;
  /** Screens this is opened from. Empty only on a root. */
  openedFrom: readonly string[];
  /**
   * A screen that opens this one whatever the mode, because the link is an
   * action rather than a menu row.
   *
   * Hiding a destination takes its row out of the hubs; it does not and must
   * not disarm a button in the middle of a piece of work. Things I need ends a
   * request on Purchase requests, and it does that for a technician too. Where
   * that is true it is written down, because the alternative is this module
   * telling somebody to go and search for a screen they were standing on
   * thirty seconds ago. Must be one of `openedFrom`, and must itself be shown
   * in every mode that hides this one — `validateManifest` checks both.
   */
  stillOpenedFrom?: string;
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
    route: '/', file: 'app/(tabs)/index.tsx', opensVia: 'src/components/PhotoDrop.tsx',
    tab: 'today', section: 'The day',
    label: 'Home', root: true, modes: BOTH, openedFrom: [],
    // A hub, not a dashboard. It renders whichever modules the technician
    // pinned, so it is not credited here with opening any of them — the
    // picker at /shortcuts is, because that one always does. The photo button
    // is the exception: it is not a pinned module and it always renders, and
    // it holds its route in the component rather than on the screen.
    blurb: 'Your modules, search, and anything running against a clock.',
    terms: ['home', 'today', 'start', 'hub', 'front page'],
  },
  {
    route: '/work/jobs', file: 'app/work/jobs.tsx', tab: 'today', section: 'The day',
    // A site and a customer open it scoped to their own jobs — the way in a
    // technician on site actually uses.
    label: 'Jobs', modes: BOTH, openedFrom: ['/work', '/shortcuts', '/site/[id]', '/customer/[id]'],
    blurb: 'Scheduled and open jobs, urgent first.',
    terms: ['job', 'jobs', 'work order', 'scheduled', 'urgent'],
  },
  {
    route: '/work/route', file: 'app/work/route.tsx', tab: 'today', section: 'The day',
    label: "Today's run", modes: BOTH, openedFrom: ['/work'],
    blurb: 'Jobs in order of distance.',
    terms: ['run', 'route', 'order', 'driving', 'nearest', 'travel'],
  },
  {
    route: '/search', file: 'app/search.tsx', opensVia: 'src/domain/search.ts',
    tab: 'today', section: 'The day',
    label: 'Find anything', modes: BOTH, openedFrom: ['/', '/shortcuts'],
    // Its results open record screens by the routes held in the domain
    // module it maps over, the same arrangement as the module picker.
    blurb: 'Jobs, sites, customers, invoices and parts.',
    terms: ['find', 'search', 'lookup', 'number', 'job number', 'invoice number', 'po', 'part number', 'phone', 'anything'],
  },
  {
    route: '/work/job/[id]', file: 'app/work/job/[id].tsx', tab: 'today', section: 'The day',
    label: 'Job', needsContext: true, modes: BOTH,
    openedFrom: ['/work/jobs', '/customer/[id]', '/quotes/simpro/[id]', '/invoices/[id]', '/search', '/orders/[id]'],
    blurb: 'One job: the work, the site, notes and photos.',
    terms: ['job', 'briefing', 'attendance'],
  },
  {
    route: '/swms', file: 'app/swms/index.tsx', tab: 'today', section: 'Before you start',
    label: 'Safe work method statements', modes: BOTH, openedFrom: ['/shortcuts'],
    blurb: 'Brief the crew, then sign once the company approves it.',
    terms: ['swms', 'jsea', 'jsa', 'safe work', 'method statement', 'safety', 'hazard', 'risk', 'permit', 'high risk'],
  },
  {
    route: '/swms/new', file: 'app/swms/new.tsx', tab: 'today', section: 'Before you start',
    label: 'New statement', modes: BOTH, openedFrom: ['/swms', '/work/job/[id]'],
    blurb: 'Pick the job and the work. The statements it needs come up ticked.',
    terms: ['swms', 'jsea', 'new', 'start', 'builder', 'safe work', 'method statement', 'today'],
  },
  {
    route: '/swms/[id]', file: 'app/swms/[id].tsx', tab: 'today', section: 'Before you start',
    label: 'The statement', needsContext: true, modes: BOTH, openedFrom: ['/swms'],
    blurb: 'One day’s statement: the steps, the site answers and the signatures.',
    terms: ['swms', 'jsea', 'sign', 'steps', 'hazards', 'controls'],
  },
  {
    route: '/work/impairments', file: 'app/work/impairments.tsx', tab: 'today', section: 'Against a clock',
    label: 'Impairments', modes: BOTH, openedFrom: ['/work'],
    blurb: 'Systems out of service, with the clock on each.',
    terms: ['impairment', 'isolation', 'out of service', 'isolated'],
  },
  {
    route: '/impairment/new', file: 'app/impairment/new.tsx', tab: 'today', section: 'Against a clock',
    label: 'Declare an impairment', modes: BOTH, openedFrom: ['/work/impairments', '/shortcuts'],
    blurb: 'Log a system out of service.',
    terms: ['impairment', 'declare', 'isolate', 'shut down', 'out of service'],
  },
  {
    route: '/impairment/[id]', file: 'app/impairment/[id].tsx', tab: 'today', section: 'Against a clock',
    label: 'Live impairment', needsContext: true, modes: BOTH,
    openedFrom: ['/', '/work/impairments'],
    blurb: 'One impairment, its time out of service, and what closes it.',
    terms: ['impairment', 'elapsed', 'restore', 'reinstate'],
  },
  {
    route: '/work/notice/[id]', file: 'app/work/notice/[id].tsx', tab: 'today', section: 'Against a clock',
    label: 'Critical defect notice', needsContext: true, modes: BOTH,
    // Home only, as a banner that shows while a notice this phone owes is
    // unissued — the same rule as a live impairment. The defects list raises a
    // defect but does not open the notice; `auditLinks` is what caught that
    // claim being written down.
    openedFrom: ['/'],
    blurb: 'The written notice the occupier is owed within 24 hours.',
    terms: ['notice', 'critical', 'occupier', '24 hours', 'commissioner'],
  },
  {
    route: '/photos', file: 'app/photos.tsx', tab: 'today', section: 'Setup',
    label: 'Photos for the website', modes: BOTH, openedFrom: ['/'],
    // The big orange button on the home screen, which is not a pinned module
    // and so is not covered by the /shortcuts row above. It is written down
    // here because it is the only way in.
    blurb: 'Good photos of fire systems, sent for the website.',
    terms: ['photo', 'photos', 'photograph', 'picture', 'website', 'marketing', 'upload', 'camera'],
    keptBecause:
      'A technician standing in front of a tidy booster is the only person who can take the '
      + 'photograph, so the button belongs on the phone and not at a desk.',
  },
  {
    route: '/shortcuts', file: 'app/shortcuts.tsx', opensVia: 'src/domain/modules.ts',
    tab: 'today', section: 'Setup',
    label: 'All modules', modes: BOTH, openedFrom: ['/'],
    blurb: 'Every module, to open or pin to your home screen.',
    terms: ['shortcuts', 'home', 'tiles', 'favourites', 'customise', 'pin', 'modules', 'everything'],
  },

  // -- Ask the office --------------------------------------------------------
  {
    route: '/work/rfi', file: 'app/work/rfi.tsx', tab: 'today', section: 'Ask the office',
    label: 'Ask the office', modes: BOTH, openedFrom: ['/shortcuts', '/work/job/[id]'],
    blurb: 'A question to the office about a job.',
    terms: ['rfi', 'request for information', 'question', 'ask', 'supervisor', 'held up'],
  },
  {
    route: '/work/leave', file: 'app/work/leave.tsx', tab: 'today', section: 'Ask the office',
    label: 'Book leave', modes: BOTH, openedFrom: ['/shortcuts'],
    blurb: 'Book days off onto your Simpro schedule.',
    terms: ['leave', 'annual', 'sick', 'rdo', 'holiday', 'day off', 'unpaid', 'book', 'roster'],
  },
  {
    route: '/suggest', file: 'app/suggest.tsx', tab: 'today', section: 'Ask the office',
    label: 'Suggest a change', modes: BOTH, openedFrom: ['/shortcuts'],
    blurb: 'An idea or a fault with the app.',
    terms: ['suggest', 'suggestion', 'feedback', 'idea', 'bug', 'improve', 'wrong'],
  },


  // -- You in Simpro ---------------------------------------------------------
  {
    route: '/whoami', file: 'app/whoami.tsx', tab: 'today', section: 'You in Simpro',
    label: 'Who you are', modes: BOTH, openedFrom: ['/settings', '/work/my-day', '/work/clock', '/work/leave'],
    blurb: 'Pick yourself from the Simpro staff list.',
    terms: ['who am i', 'employee', 'technician', 'name', 'identity', 'pick', 'staff list'],
  },
  {
    route: '/work/my-day', file: 'app/work/my-day.tsx', tab: 'today', section: 'You in Simpro',
    label: 'My day', modes: BOTH, openedFrom: ['/shortcuts'],
    blurb: 'What you are booked on today and ahead.',
    terms: ['my day', 'my jobs', 'schedule', 'roster', 'today', 'tomorrow', 'scheduled for me'],
  },

  // -- Sites -----------------------------------------------------------------
  {
    route: '/sites', file: 'app/(tabs)/sites.tsx', tab: 'sites', section: 'Your sites',
    label: 'Sites', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Every site, by name, address or client.',
    terms: ['site', 'sites', 'building', 'customer', 'address'],
  },
  {
    route: '/site/new', file: 'app/site/new.tsx', tab: 'sites', section: 'Your sites',
    label: 'New site', modes: BOTH, openedFrom: ['/sites'],
    blurb: 'Add a site by hand, with its address.',
    terms: ['new site', 'add site', 'create'],
  },
  {
    route: '/site/[id]', file: 'app/site/[id].tsx', tab: 'sites', section: 'Your sites',
    label: 'Site', needsContext: true, modes: BOTH,
    openedFrom: [
      '/sites', '/work/job/[id]', '/customer/[id]', '/quotes/simpro/[id]', '/search', '/contacts/[id]', '/leads',
      '/config/[id]', '/config/compare',
    ],
    blurb: 'One site: jobs, assets, defects and paperwork.',
    terms: ['site', 'building', 'pack'],
  },
  // -- Config Explorer -------------------------------------------------------
  // A panel configuration opened and read rather than imported. Every other
  // path in this app that touches a vendor file writes it into a site on the
  // way past; these six screens write nothing until somebody says so.
  {
    route: '/config', file: 'app/config/index.tsx', tab: 'sites', section: 'Config Explorer',
    label: 'Config Explorer', modes: BOTH, openedFrom: ['/sites', '/shortcuts', '/site/[id]'],
    blurb: 'Open and read a panel config.',
    terms: ['config', 'configuration', 'panel file', 'nle', 'pci', 'ffp', 'util', 'loop explorer',
      'verifire', 'smartconfig', 'config manager', 'open a config'],
  },
  {
    route: '/config/[id]', file: 'app/config/[id].tsx', tab: 'sites', section: 'Config Explorer',
    label: 'A configuration', needsContext: true, modes: BOTH, openedFrom: ['/config'],
    blurb: 'One config: panels, loops, zones and logic.',
    terms: ['config', 'panel', 'loops', 'zones'],
  },
  {
    route: '/config/points', file: 'app/config/points.tsx', tab: 'sites', section: 'Config Explorer',
    label: 'Devices in a configuration', needsContext: true, modes: BOTH,
    openedFrom: ['/config/[id]', '/config/verify'],
    blurb: 'Every point in the file, by text, address or zone.',
    terms: ['devices', 'points', 'addresses', 'device list'],
  },
  {
    route: '/config/verify', file: 'app/config/verify.tsx', tab: 'sites', section: 'Config Explorer',
    label: 'Check a configuration', needsContext: true, modes: BOTH, openedFrom: ['/config/[id]'],
    blurb: 'What is wrong with the file, and what could not be checked.',
    terms: ['check', 'verify', 'duplicate address', 'zone text', 'findings', 'errors'],
  },
  {
    route: '/config/logic', file: 'app/config/logic.tsx', tab: 'sites', section: 'Config Explorer',
    label: 'Cause and effect in a configuration', needsContext: true, modes: BOTH, openedFrom: ['/config/[id]'],
    blurb: 'The logic as the panel holds it.',
    terms: ['cause and effect', 'matrix', 'logic', 'equations', 'c&e'],
  },
  {
    route: '/config/compare', file: 'app/config/compare.tsx', tab: 'sites', section: 'Config Explorer',
    label: 'Compare a configuration', needsContext: true, modes: BOTH, openedFrom: ['/config/[id]'],
    blurb: 'The file against the register: new, gone and changed.',
    terms: ['compare', 'difference', 'changed', 'what changed', 'diff'],
  },
  {
    route: '/config/raw', file: 'app/config/raw.tsx', tab: 'sites', section: 'Config Explorer',
    label: 'Inside a configuration file', needsContext: true, modes: BOTH, openedFrom: ['/config/[id]'],
    blurb: 'The vendor tool’s own tables, row by row.',
    terms: ['raw', 'tables', 'inside', 'sqlite', 'structure', 'what is in the file'],
  },
  {
    route: '/scan', file: 'app/scan.tsx', tab: 'sites', section: 'In front of you',
    label: 'Scan a tag', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Open an asset from its label.',
    terms: ['scan', 'qr', 'barcode', 'tag', 'label'],
  },
  {
    route: '/assets/find', file: 'app/assets/find.tsx', tab: 'sites', section: 'In front of you',
    label: 'Find an asset', modes: BOTH, openedFrom: ['/shortcuts'],
    blurb: 'Search assets by tag, serial or location.',
    terms: ['find', 'search asset', 'serial', 'part number', 'code'],
  },
  {
    route: '/assets/[id]', file: 'app/assets/[id].tsx', tab: 'sites', section: 'In front of you',
    label: 'Asset', needsContext: true, modes: BOTH,
    openedFrom: ['/assets/find', '/scan', '/site/assets'],
    blurb: 'One asset and its history.',
    terms: ['asset', 'device', 'history', 'timeline'],
  },
  {
    route: '/assets/new', file: 'app/assets/new.tsx', tab: 'sites', section: 'In front of you',
    // Needs the site even though the screen will let you pick one: an asset
    // filed against no site is a record nobody finds again.
    label: 'Add an asset', needsContext: true, modes: BOTH, openedFrom: ['/site/assets'],
    blurb: 'Add an asset to a site.',
    terms: ['new asset', 'add device', 'register'],
  },
  {
    route: '/routine/run', file: 'app/routine/run.tsx', tab: 'sites', section: 'In front of you',
    label: 'Run a routine', needsContext: true, modes: BOTH,
    streams: ['service'],
    streamBecause:
      'A routine is the AS 1851 service of a system that is already in and already commissioned. A '
      + 'construction crew commissions; they do not run the six-monthly.',
    openedFrom: ['/site/[id]'],
    blurb: 'Record an AS 1851 routine, check by check.',
    terms: ['routine', 'service', 'run', 'monthly', 'annual', 'test'],
  },
  {
    route: '/work/defect/new', file: 'app/work/defect/new.tsx', tab: 'sites', section: 'In front of you',
    label: 'Raise a defect', modes: BOTH,
    openedFrom: ['/shortcuts', '/work/defects', '/site/defects', '/assets/[id]'],
    blurb: 'Pick the code. Wording and severity fill in.',
    terms: ['defect', 'fault', 'raise', 'report a fault', 'broken'],
  },
  {
    route: '/site/assets', file: 'app/site/assets.tsx', tab: 'sites', section: 'This site',
    label: 'Asset register', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: "The site's register, grouped by system.",
    terms: ['register', 'assets', 'devices', 'equipment'],
  },
  {
    route: '/site/bulk-test', file: 'app/site/bulk-test.tsx', tab: 'sites', section: 'This site',
    label: 'Bulk test', needsContext: true, modes: BOTH,
    streams: ['service'],
    streamBecause:
      'Bulk testing works down a register that exists. On a new install the register is being '
      + 'built, not swept.',
    openedFrom: ['/site/[id]'],
    blurb: 'Test every asset on the register in turn.',
    terms: ['bulk test', 'test assets', 'fail', 'walk'],
  },
  {
    route: '/site/points', file: 'app/site/points.tsx', tab: 'sites', section: 'This site',
    label: 'Points', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Every point from the panel config, with its zone.',
    terms: ['points', 'loop', 'zone text', 'addresses', 'panel'],
  },
  {
    route: '/site/zones', file: 'app/site/zones.tsx', tab: 'sites', section: 'This site',
    label: 'Zone chart', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'The zone chart for the panel door.',
    terms: ['zone chart', 'zones', 'panel door', 'print'],
  },
  {
    route: '/site/defects', file: 'app/site/defects.tsx', tab: 'sites', section: 'This site',
    label: 'Site defects', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Open and closed defects for this site.',
    terms: ['defects', 'faults', 'outstanding'],
  },
  {
    route: '/site/cause-effect', file: 'app/site/cause-effect.tsx', tab: 'sites', section: 'This site',
    label: 'Cause and effect', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Built by cause and exported as the matrix.',
    terms: ['cause and effect', 'matrix', 'c&e', 'interface', 'commissioning'],
  },
  {
    route: '/site/quote', file: 'app/site/quote.tsx', tab: 'sites', section: 'This site',
    label: 'Quote', needsContext: true, modes: OFFICE, openedFrom: ['/site/[id]'],
    blurb: 'Price the rectification work from the defects.',
    terms: ['quote', 'price', 'rectification', 'sell', 'estimate'],
    hiddenBecause:
      'A price given on the spot commits the company to a number nobody has checked. Raise the '
      + 'defect; the quote lines come off it, and the office prices it.',
  },
  {
    route: '/report/[id]', file: 'app/report/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Test sheet', needsContext: true, modes: BOTH,
    // Running a routine ends in `router.back()`, not in the sheet, so it is
    // not an opener however much it feels like one.
    openedFrom: ['/site/[id]', '/work/reports'],
    blurb: 'One service report, device by device.',
    terms: ['test sheet', 'report', 'service report', 'results'],
  },
  {
    route: '/form72', file: 'app/form72/index.tsx', opensVia: 'src/components/Form72Card.tsx',
    tab: 'sites', section: 'Paperwork',
    label: 'Form 72', modes: BOTH, openedFrom: ['/shortcuts', '/site/form72'],
    blurb: 'Drafts and occupier copies owed, every site.',
    terms: ['form 72', 'drafts', 'occupier copy', 'owed', 'hydrant test', 'sprinkler'],
  },
  {
    route: '/site/form72', file: 'app/site/form72.tsx', tab: 'sites', section: 'Paperwork',
    label: 'Form 72s', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'Hydrant and sprinkler Form 72. Part A fills from the job.',
    terms: ['form 72', 'certificate', 'occupier', 'qfes'],
  },
  {
    route: '/form72/new', file: 'app/form72/new.tsx', tab: 'sites', section: 'Paperwork',
    label: 'Start a Form 72', modes: BOTH, openedFrom: ['/form72', '/work/job/[id]'],
    blurb: 'Pick the job. Part A fills from it.',
    terms: ['form 72', 'new', 'hydrant test', 'start', 'raise'],
  },
  {
    route: '/form72/[id]', file: 'app/form72/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Form 72', needsContext: true, modes: BOTH, openedFrom: ['/site/form72', '/form72/new', '/form72'],
    blurb: 'One Form 72, part by part, signed on site.',
    terms: ['form 72', 'sign', 'declaration', 'booster', 'hydrant test'],
  },
  {
    route: '/occupier/[id]', file: 'app/occupier/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Occupier statement', needsContext: true, modes: BOTH, openedFrom: ['/site/[id]'],
    blurb: 'The annual statement, filled from the year’s work.',
    terms: ['occupier statement', 'annual', 'prescribed installation', 'declaration'],
  },
  {
    route: '/assessment/[id]', file: 'app/assessment/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Effectiveness assessment', needsContext: true, modes: BOTH,
    streams: ['service'],
    streamBecause:
      'An effectiveness assessment weighs a maintained system against what it is supposed to do. It '
      + 'is a servicing judgement.',
    openedFrom: ['/site/[id]'],
    blurb: 'Recommendations and observations, not defects.',
    terms: ['assessment', 'effectiveness', 'recommendation', 'observation', 'audit'],
  },
  {
    route: '/baseline/[id]', file: 'app/baseline/[id].tsx', tab: 'sites', section: 'Paperwork',
    label: 'Baseline data', needsContext: true, modes: BOTH,
    openedFrom: ['/site/[id]', '/work/baselines'],
    blurb: 'One commissioning record, saved as you type.',
    terms: ['baseline', 'commissioning', 'as installed'],
  },

  // -- Map -------------------------------------------------------------------
  {
    route: '/map', file: 'app/(tabs)/map.tsx', tab: 'map', section: 'The map',
    label: 'Map', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Every site on a map, with directions.',
    terms: ['map', 'waze', 'navigate', 'directions', 'sites map', 'where', 'google maps', 'customer', 'place'],
  },

  // -- Tools -----------------------------------------------------------------
  {
    route: '/tools', file: 'app/(tabs)/tools.tsx', tab: 'tools', section: 'Calculators',
    label: 'Tools', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Calculators and reference, all offline.',
    terms: ['tools', 'calculator', 'calculators'],
  },
  {
    route: '/tools/battery', file: 'app/tools/battery.tsx', tab: 'tools', section: 'Calculators',
    label: 'FIP battery', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Standby and alarm load to battery size. VESDA included.',
    terms: ['battery', 'standby', 'ah', 'quiescent', 'alarm current', 'fip'],
  },
  {
    route: '/tools/voltdrop', file: 'app/tools/voltdrop.tsx', tab: 'tools', section: 'Calculators',
    label: 'Cable volt drop', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Volts at the far end of the run.',
    terms: ['volt drop', 'cable', 'sounder', 'run', 'voltage'],
  },
  {
    route: '/tools/cable', file: 'app/tools/cable.tsx', tab: 'tools', section: 'Calculators',
    label: 'Cable sizing', modes: BOTH,
    streams: ['construction'],
    streamBecause:
      'Sizing a run is design work. A service technician replacing a like-for-like run has the '
      + 'existing size; picking a new one is an install decision.',
    openedFrom: ['/tools'],
    blurb: 'Capacity, volt drop, breaker and fault, to AS/NZS 3008.',
    terms: ['cable', 'sizing', 'current carrying capacity', 'ccc', 'as 3008', 'as 3000', 'derating', 'submain', 'wiring rules'],
  },
  {
    route: '/tools/wiring', file: 'app/tools/wiring.tsx', tab: 'tools', section: 'Calculators',
    label: 'Wiring rules tables', modes: BOTH,
    streams: ['construction'],
    streamBecause:
      'The wiring rules tables themselves: derating, grouping, installation methods. Design inputs.', openedFrom: ['/tools', '/tools/cable'],
    blurb: 'AS/NZS 3008 and AS/NZS 3000 tables.',
    terms: ['as 3008', 'as 3000', 'wiring rules', 'table', 'tables', 'current carrying capacity', 'derating',
      'volt drop', 'reactance', 'resistance', 'earth fault loop', 'maximum demand', 'appendix c', 'standard'],
  },
  {
    route: '/tools/fault-loop', file: 'app/tools/fault-loop.tsx', tab: 'tools', section: 'Calculators',
    label: 'Fault loop', modes: BOTH,
    streams: ['construction'],
    streamBecause:
      'Fault loop impedance and earthing are proved when a circuit is installed, not when a '
      + 'detector is serviced.',
    openedFrom: ['/tools'],
    blurb: 'Loop impedance, trip check, max run and earth size.',
    terms: ['fault loop', 'zs', 'ze', 'impedance', 'disconnection', 'earth', 'earthing', 'adiabatic', 'as 3000'],
  },
  {
    route: '/tools/max-demand', file: 'app/tools/max-demand.tsx', tab: 'tools', section: 'Calculators',
    label: 'Maximum demand', modes: BOTH,
    streams: ['construction'],
    streamBecause:
      'Maximum demand sizes a supply. Nothing in a routine service changes the supply.', openedFrom: ['/tools'],
    blurb: 'Maximum demand per phase.',
    terms: ['maximum demand', 'diversity', 'main switch', 'supply', 'phase balance', 'as 3000'],
  },
  {
    route: '/tools/ohms', file: 'app/tools/ohms.tsx', tab: 'tools', section: 'Calculators',
    label: "Ohm's law", modes: BOTH, openedFrom: ['/tools'],
    blurb: "Ohm's law, power and battery runtime.",
    terms: ['ohms law', 'volts', 'amps', 'watts', 'runtime', 'power'],
  },
  {
    route: '/tools/converter', file: 'app/tools/converter.tsx', tab: 'tools', section: 'Calculators',
    label: 'Unit converter', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Pressure, flow, volume, temperature and more.',
    terms: ['convert', 'units', 'kpa', 'psi', 'litres', 'metres'],
  },
  {
    route: '/tools/resistor', file: 'app/tools/resistor.tsx', tab: 'tools', section: 'Calculators',
    label: 'Resistor values', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Colour bands to ohms and back.',
    terms: ['resistor', 'bands', 'colour code', 'ohms', '4k7'],
  },
  {
    route: '/tools/dipswitch', file: 'app/tools/dipswitch.tsx', tab: 'tools', section: 'Calculators',
    label: 'Device address', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'DIP switches, XPERT cards and rotary dials.',
    terms: ['address', 'dip switch', 'dipswitch', 'loop', 'protocol'],
  },
  {
    route: '/tools/detector-age', file: 'app/tools/detector-age.tsx', tab: 'tools', section: 'Calculators',
    label: 'Detector age', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Date code to age and replacement.',
    terms: ['detector age', 'date code', 'head', 'service life', 'replace'],
  },
  {
    route: '/tools/eol', file: 'app/tools/eol.tsx', tab: 'tools', section: 'Calculators',
    label: 'End of line', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'EOL values by panel and circuit.',
    terms: ['end of line', 'eol', 'resistor', 'monitoring', 'circuit'],
  },
  {
    route: '/tools/hose-reel', file: 'app/tools/hose-reel.tsx', tab: 'tools', section: 'Calculators',
    label: 'Hose reels', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Reach, flow and next service.',
    terms: ['hose reel', 'reel', 'coverage', 'reach', 'flow', 'nozzle'],
    keptBecause:
      'A hose reel is the only asset on the book whose whole job is a distance, and nobody checks '
      + 'it because the reel is already on the wall.',
  },
  {
    route: '/tools/fire-door', file: 'app/tools/fire-door.tsx', tab: 'tools', section: 'Calculators',
    label: 'Fire and smoke doors', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Tag, gaps, close and latch.',
    terms: ['fire door', 'smoke door', 'door', 'gap', 'clearance', 'latch', 'self closing', 'tag'],
  },
  {
    route: '/tools/spl', file: 'app/tools/spl.tsx', tab: 'tools', section: 'Calculators',
    label: 'Sound pressure level', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Is the warning loud enough in this room?',
    terms: ['spl', 'sound', 'db', 'decibel', 'loud', 'sounder', 'ewis'],
  },
  {
    route: '/tools/hydrant', file: 'app/tools/hydrant.tsx', tab: 'tools', section: 'Calculators',
    label: 'Hydrant flow test', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Flow, supply at brigade pressure, and the duty.',
    terms: ['hydrant', 'flow', 'pressure', 'booster', 'lps', 'kpa'],
  },
  {
    route: '/tools/extinguisher', file: 'app/tools/extinguisher.tsx', tab: 'tools', section: 'Calculators',
    label: 'Extinguishers', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Type, next test and weight check.',
    terms: ['extinguisher', 'co2', 'dry chemical', 'pressure test', 'weigh'],
  },
  {
    route: '/tools/emergency-lighting', file: 'app/tools/emergency-lighting.tsx', tab: 'tools', section: 'Calculators',
    label: 'Emergency lighting', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Discharge, exit signs, battery age and spacing.',
    terms: ['emergency lighting', 'exit sign', 'discharge', 'lux', 'viewing distance'],
  },
  {
    route: '/library/law', file: 'app/library/law.tsx', tab: 'tools', section: 'Reference',
    label: 'Fire safety regulation', modes: BOTH, openedFrom: ['/library'],
    blurb: 'Building Fire Safety Regulation 2008, by who must act.',
    terms: ['regulation', 'bfsr', 'law', 'legislation', 'section 49', 'critical defect',
      'occupier', 'penalty', 'statutory'],
    keptBecause:
      'Every clock this app counts comes from a section in here, and a technician being argued '
      + 'with on site has no way to point at the section without it. It is Crown material '
      + 'published free, so it costs nothing to carry.',
  },
  {
    route: '/library', file: 'app/library/index.tsx', tab: 'tools', section: 'Reference',
    label: 'Standards', modes: BOTH, openedFrom: ['/', '/tools', '/shortcuts'],
    blurb: 'Search every standard and your own PDFs.',
    terms: ['standard', 'standards', 'clause', 'as 1851', 'as 1670', 'library'],
  },
  {
    route: '/library/[id]', file: 'app/library/[id].tsx', tab: 'tools', section: 'Reference',
    label: 'One standard', needsContext: true, modes: BOTH, openedFrom: ['/library'],
    blurb: 'One standard and its clauses.',
    terms: ['clause', 'standard', 'index'],
  },
  {
    route: '/tools/routines', file: 'app/tools/routines.tsx', tab: 'tools', section: 'Reference',
    label: 'Service routines', modes: BOTH,
    streams: ['service'],
    streamBecause:
      'The AS 1851 service routines and their frequencies. Nothing on a construction job runs to '
      + 'them.',
    openedFrom: ['/tools'],
    blurb: 'What each service routine checks, and how often.',
    terms: ['routine', 'monthly', 'annual', 'checks', 'what to do'],
  },
  {
    route: '/tools/defects', file: 'app/tools/defects.tsx', tab: 'tools', section: 'Reference',
    label: 'Defect wording', modes: BOTH, openedFrom: ['/tools'],
    blurb: 'Report wording and fix for each defect code.',
    terms: ['defect', 'wording', 'code', 'critical', 'rectification'],
  },

  // -- Work ------------------------------------------------------------------
  {
    route: '/work', file: 'app/(tabs)/work.tsx', tab: 'work', section: 'Records',
    label: 'Work', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Jobs, records and parts.',
    terms: ['work', 'records'],
  },
  {
    route: '/work/defects', file: 'app/work/defects.tsx', tab: 'work', section: 'Records',
    label: 'Defects', modes: BOTH, openedFrom: ['/work'],
    blurb: 'Raised, quoted and open, oldest first.',
    terms: ['defects', 'outstanding', 'open', 'faults'],
  },
  {
    route: '/quote/[id]', file: 'app/quote/[id].tsx', tab: 'work', section: 'Records',
    label: 'Quote', needsContext: true, modes: OFFICE,
    openedFrom: ['/quotes'],
    blurb: 'One quote: reprint, email, accepted or declined.',
    terms: ['quote', 'quotation', 'accepted', 'declined', 'reprint', 'expiry'],
    hiddenBecause:
      'What is out with a client and what it is worth. The number commits the company, and a '
      + 'technician asked in a corridor should not be the one who answers it — the same argument '
      + 'as the quote builder itself.',
  },
  {
    route: '/defect/[id]', file: 'app/defect/[id].tsx', tab: 'work', section: 'Records',
    label: 'Defect', needsContext: true, modes: BOTH,
    openedFrom: ['/work/defects', '/site/defects'],
    blurb: 'One defect: wording, location, severity and photos.',
    terms: ['defect', 'fault', 'edit', 'photo', 'rectify', 'reword', 'severity'],
  },
  {
    route: '/work/outbound', file: 'app/work/outbound.tsx', tab: 'work', section: 'Records',
    label: 'Waiting to send', modes: BOTH, openedFrom: ['/work'],
    blurb: 'What is queued for Simpro.',
    terms: ['send', 'office', 'simpro', 'push', 'upload', 'sync', 'job note', 'waiting', 'queue', 'outbound'],
    keptBecause:
      'A technician is the only person who knows the service is finished, and the office finding '
      + 'out when the paperwork arrives is how an invoice goes out for a service that was nine '
      + 'assets short. The review before it sends is on this screen too, and that is the part '
      + 'that has to be read on site rather than in an office.',
  },
  {
    route: '/occupier', file: 'app/occupier/index.tsx', tab: 'work', section: 'Records',
    label: 'Occupier statements', modes: BOTH,
    streams: ['service'],
    streamBecause:
      'The occupier statement is the annual declaration about maintained systems, and it is signed '
      + 'off the year of servicing behind it.',
    openedFrom: ['/work'],
    blurb: 'The annual statement, checked against the defects.',
    terms: ['occupier', 'statement', 'commissioner', 'annual statement', 'schedule 2', 'declaration'],
    keptBecause:
      'A statement signed and never sent looks, from the site screen, exactly like one that was '
      + 'sent — both are signed. Across 897 sites nobody notices until somebody asks, and the '
      + 'technician who did the work is often the one who can chase it.',
  },
  {
    route: '/quotes', file: 'app/quotes/index.tsx', tab: 'work', section: 'Records',
    label: 'Quotes', modes: OFFICE, openedFrom: ['/work', '/quotes/simpro'],
    // The office's quotes carry a switch to these, and it works in Technician
    // mode too — hiding the row must not turn that switch into a dead end.
    stillOpenedFrom: '/quotes/simpro',
    blurb: 'Your quotes and when they lapse.',
    terms: ['quotes', 'quotations', 'price', 'accepted', 'expired', 'lapsed', 'out with clients'],
    hiddenBecause:
      'The answer to "what did we quote for this?" given on the spot commits the company to a '
      + 'number nobody has checked. Quotes are raised from the site and priced by the office.',
  },
  {
    route: '/quotes/simpro', file: 'app/quotes/simpro.tsx', tab: 'work', section: 'Records',
    label: 'Simpro quotes', modes: BOTH, openedFrom: ['/quotes', '/customer/[id]', '/site/[id]'],
    blurb: 'The office’s quotes in Simpro.',
    terms: ['simpro quotes', 'office quotes', 'quote number', 'approved', 'converted', 'sell'],
    keptBecause:
      'The figure on one of these is the office\'s own, already sent to the customer, so reading it '
      + 'out commits nobody to anything new — and "what did we quote for this?" is asked of the '
      + 'technician on site far more often than of the office. The phone\'s own quote builder '
      + 'stays hidden; this is the mirror, not the pen.',
  },
  {
    route: '/quotes/simpro/[id]', file: 'app/quotes/simpro/[id].tsx', tab: 'work', section: 'Records',
    label: 'Simpro quote', needsContext: true, modes: BOTH, openedFrom: ['/quotes/simpro', '/customer/[id]', '/search'],
    blurb: 'One Simpro quote: lines, notes, files and the job it became.',
    terms: ['quote', 'simpro', 'lines', 'sections', 'attachments', 'converted'],
  },
  {
    route: '/invoices', file: 'app/invoices/index.tsx', tab: 'work', section: 'Records',
    label: 'Invoices', modes: BOTH, openedFrom: ['/shortcuts', '/customer/[id]', '/site/[id]'],
    blurb: 'Invoices, unpaid first.',
    terms: ['invoices', 'invoice', 'unpaid', 'owing', 'paid', 'billing', 'balance due'],
    keptBecause:
      'Whether a site has paid is the first thing a customer raises when a technician turns up, '
      + 'and "I will have to check with the office" from a phone that holds the answer is the '
      + 'wrong reply. These are the office\'s sell figures only; nothing here shows a cost.',
  },
  {
    route: '/invoices/[id]', file: 'app/invoices/[id].tsx', tab: 'work', section: 'Records',
    label: 'Invoice', needsContext: true, modes: BOTH, openedFrom: ['/invoices', '/work/job/[id]', '/customer/[id]', '/search'],
    blurb: 'One invoice: what it bills, when it is due, what is paid.',
    terms: ['invoice', 'balance', 'due', 'paid', 'jobs billed'],
  },
  {
    route: '/customer/[id]', file: 'app/customer/[id].tsx', tab: 'work', section: 'Records',
    label: 'Customer', needsContext: true, modes: BOTH,
    openedFrom: ['/work/job/[id]', '/quotes/simpro/[id]', '/invoices/[id]', '/site/[id]', '/search', '/contacts/[id]'],
    blurb: 'A customer: contacts, sites, jobs, quotes and invoices.',
    terms: ['customer', 'client', 'company', 'contact', 'sites', 'who to ring'],
  },
  {
    route: '/contacts', file: 'app/contacts/index.tsx', tab: 'work', section: 'Records',
    // A site and a customer open it scoped to their own people.
    label: 'Contacts', modes: BOTH, openedFrom: ['/shortcuts', '/site/[id]', '/customer/[id]'],
    blurb: 'Ring, text or email anyone the office has.',
    terms: ['contacts', 'people', 'phone', 'ring', 'call', 'text', 'sms', 'email', 'building manager', 'who to ring'],
  },
  {
    route: '/contacts/[id]', file: 'app/contacts/[id].tsx', tab: 'work', section: 'Records',
    label: 'Contact', needsContext: true, modes: BOTH,
    openedFrom: ['/contacts', '/search', '/site/[id]', '/customer/[id]'],
    blurb: 'One person: ring, text or email, and their sites.',
    terms: ['contact', 'person', 'ring', 'text', 'email', 'position'],
  },
  {
    route: '/leads', file: 'app/leads/index.tsx', tab: 'work', section: 'Records',
    label: 'Leads', modes: BOTH, openedFrom: ['/search'],
    blurb: 'Sales leads synced from Simpro.',
    terms: ['leads', 'lead', 'prospect', 'sales', 'chasing', 'follow up'],
    keptBecause:
      'A lead is a salesperson\'s record and reads as office work, but it carries no price — only a site, a '
      + 'customer and a stage — and "is anything happening with this building" is asked of whoever is standing '
      + 'in it. Nothing lists it in a hub either way; Find anything is the only way in.',
  },
  {
    route: '/work/reports', file: 'app/work/reports.tsx', tab: 'work', section: 'Records',
    label: 'Test sheets', modes: BOTH,
    streams: ['service'],
    streamBecause:
      'Test sheets are the record a routine service leaves. The install equivalent is the '
      + 'commissioning paperwork, which is on the job.',
    openedFrom: ['/shortcuts', '/work'],
    blurb: 'Test sheets on this phone.',
    terms: ['test sheets', 'reports', 'service reports'],
    keptBecause:
      'The sheet you were filling in this morning is reopened from here. Making a technician '
      + 'walk back through the site to find their own half-finished report is how it gets '
      + 'finished on paper instead.',
  },
  {
    route: '/work/clock', file: 'app/work/clock.tsx', tab: 'work', section: 'Records',
    label: 'Clock on', modes: BOTH, openedFrom: ['/work', '/shortcuts'],
    blurb: 'Clock on and off jobs. Hours go to Simpro.',
    terms: ['clock on', 'clock off', 'hours', 'job hours', 'travel', 'break', 'schedule block', 'timesheet'],
  },
  {
    route: '/work/timesheets', file: 'app/work/timesheets.tsx', tab: 'work', section: 'Records',
    label: 'Timesheets', modes: BOTH, openedFrom: ['/shortcuts', '/work'],
    blurb: 'Your week, filled from your schedule or typed.',
    terms: ['timesheet', 'hours', 'week', 'pay', 'attendance'],
    keptBecause:
      'Named as an office feature, kept anyway: a technician\'s own hours are the one payroll '
      + 'record only they can enter, and the alternative to this screen is a paper docket that '
      + 'reaches the office a fortnight late.',
  },
  {
    route: '/timesheet/[id]', file: 'app/timesheet/[id].tsx', tab: 'work', section: 'Records',
    label: 'One week', needsContext: true, modes: BOTH, openedFrom: ['/work/timesheets'],
    blurb: 'Your hours and leave for one week.',
    terms: ['timesheet', 'week', 'attendances', 'value'],
  },
  {
    route: '/work/baselines', file: 'app/work/baselines.tsx', tab: 'work', section: 'Records',
    label: 'Baseline data', modes: OFFICE, openedFrom: ['/work'],
    blurb: 'Commissioning readings for the system.',
    terms: ['baseline', 'commissioning', 'records'],
    hiddenBecause:
      'This is the all-sites list, and a technician works one site at a time. The record itself '
      + 'is untouched — it opens from the site that owns it, which is also the only place it '
      + 'means anything.',
  },
  {
    route: '/work/needs', file: 'app/work/needs.tsx', tab: 'work', section: 'Parts and stock',
    label: 'Things I need', modes: BOTH, openedFrom: ['/work', '/shortcuts'],
    blurb: 'Parts to get, now and for coming work.',
    terms: ['need', 'needs', 'parts', 'order', 'shopping list', 'to get', 'checklist', 'flow meter'],
    keptBecause:
      'A list of parts to buy reads as office work and is not: it is written on site by the person '
      + 'who found the thing missing, and every one of these lines currently lives on a dashboard or '
      + 'in somebody\'s phone until it is forgotten.',
  },
  {
    route: '/orders', file: 'app/orders/index.tsx', tab: 'work', section: 'Parts and stock',
    // A supplier opens it scoped to their orders; a job card may too.
    label: 'Purchase orders', modes: BOTH, openedFrom: ['/shortcuts', '/vendors/[id]'],
    blurb: 'What the office has ordered, and if it has arrived.',
    terms: ['purchase orders', 'po', 'orders', 'supplier', 'vendor', 'received', 'on order', 'delivery'],
    keptBecause:
      '"Has the part for this job been ordered, and is it here yet" is asked on site, of the technician, '
      + 'and the answer is on the order. Nothing on it is a price: the phone holds quantities only.',
  },
  {
    route: '/orders/[id]', file: 'app/orders/[id].tsx', tab: 'work', section: 'Parts and stock',
    label: 'Purchase order', needsContext: true, modes: BOTH, openedFrom: ['/orders', '/search', '/vendors/[id]'],
    blurb: 'One order and its lines.',
    terms: ['purchase order', 'po', 'lines', 'received', 'supplier', 'reference'],
  },
  {
    route: '/vendors/[id]', file: 'app/vendors/[id].tsx', tab: 'work', section: 'Parts and stock',
    label: 'Supplier', needsContext: true, modes: BOTH, openedFrom: ['/orders/[id]', '/search'],
    blurb: 'A supplier: contacts and open orders.',
    terms: ['supplier', 'vendor', 'ring', 'counter', 'orders with'],
  },
  {
    route: '/office-catalogue', file: 'app/office-catalogue/index.tsx', tab: 'work', section: 'Parts and stock',
    label: 'Office catalogue', modes: BOTH, openedFrom: ['/shortcuts', '/search'],
    blurb: "The office's parts list with sell prices.",
    terms: ['office catalogue', 'simpro catalogue', 'part number', 'sell price', 'parts', 'materials', 'copy'],
    keptBecause:
      'The sell price on a part is the office\'s own figure, already on every quote a customer has seen; reading '
      + 'it out commits nobody to anything. What the company pays for the part is not on the phone at all.',
  },
  {
    route: '/work/plan', file: 'app/work/plan.tsx', tab: 'work', section: 'Planning',
    label: 'Plan work', modes: BOTH, openedFrom: ['/work'],
    blurb: 'Build a day and book it in Simpro.',
    terms: ['plan', 'planner', 'day', 'build my day', 'month', 'schedule', 'capacity', 'last service', 'history'],
  },

  {
    route: '/work/schedule', file: 'app/work/schedule.tsx', tab: 'work', section: 'On the tools',
    label: 'Schedule', modes: BOTH, openedFrom: ['/work', '/work/my-day', '/shortcuts'],
    blurb: "Your day and the team's. Book yourself on.",
    terms: ['schedule', 'calendar', 'book', 'book me on', 'roster', 'team', 'blocks', 'move', 'who is where'],
  },

  // -- Settings --------------------------------------------------------------
  {
    route: '/settings', file: 'app/(tabs)/settings.tsx', tab: 'settings', section: 'Setup',
    label: 'Settings', root: true, modes: BOTH, openedFrom: [],
    blurb: 'Your details, Simpro and this device.',
    terms: ['settings', 'setup', 'preferences', 'sync', 'simpro'],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_ROUTE: ReadonlyMap<string, Destination> = new Map(
  DESTINATIONS.map((d) => [d.route, d]),
);

/** Undefined for a route the manifest has never heard of, rather than a guess. */
export function destinationAt(route: string): Destination | undefined {
  return BY_ROUTE.get(route);
}

/**
 * Whether this stream's hubs list it. A destination with no `streams` is in
 * every stream, and a phone set to both is in every destination's.
 */
export function inStream(stream: StreamChoice, d: Destination): boolean {
  if (stream === 'both' || !d.streams) return true;
  return d.streams.includes(stream);
}

/** Does this view put it in front of you? Unknown routes are not shown by anything. */
export function shows(view: ViewLike, route: string): boolean {
  const { mode, stream } = asView(view);
  const d = BY_ROUTE.get(route);
  return !!d && d.modes.includes(mode) && inStream(stream, d);
}

/** Everything a view shows, in manifest order — hub rows and record screens alike. */
export function destinationsFor(view: ViewLike): Destination[] {
  const { mode, stream } = asView(view);
  return DESTINATIONS.filter((d) => d.modes.includes(mode) && inStream(stream, d));
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
export function navFor(view: ViewLike): NavGroup[] {
  const { mode, stream } = asView(view);
  const groups: NavGroup[] = [];
  for (const tab of TAB_ORDER) {
    const sections: NavSection[] = [];
    for (const d of DESTINATIONS) {
      if (d.tab !== tab || d.needsContext || !d.modes.includes(mode) || !inStream(stream, d)) continue;
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
  /**
   * Not listed in this mode, but a screen that is shown still opens it as
   * part of doing something — see `stillOpenedFrom`.
   */
  | 'opened'
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
   * True only for `nav`, `record` and `opened` — the three that are a tap
   * path somebody can follow without knowing the screen exists.
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
 *
 * Every step comes off `openedFrom`, including for the screens that sit in a
 * hub. It is tempting to shortcut a hub row to "its tab root, then it" — the
 * manifest already says which tab lists it — but that path is a guess, and it
 * is wrong wherever a screen is listed under one tab and opened from another.
 * Scan a tag is filed under Sites and opened from Tools; Today's run is filed
 * under Today and opened from Work. A technician handed "Sites → Scan a tag"
 * taps Sites, finds no such row, and stops believing the rest of the screen.
 * `auditLinks` checks each of these steps against the real file, so a chain
 * printed here is a chain that exists.
 */
function provenChain(route: string, mode: AppMode, seen: Set<string>): string[] | undefined {
  const d = BY_ROUTE.get(route);
  if (!d || seen.has(route) || !d.modes.includes(mode)) return undefined;
  if (d.root) return [route];
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

  // Hidden here, but a screen this mode does show still opens it in the middle
  // of a piece of work. Saying "go and search for it" would be a lie told to
  // somebody who was on it a minute ago, so the real path is given instead.
  if (!d.modes.includes(mode) && d.stillOpenedFrom) {
    const via = provenChain(d.stillOpenedFrom, mode, new Set());
    if (via) {
      const chain = [...via, route];
      return {
        route, mode, reachable: true, proven: true, channel: 'opened', chain,
        sentence:
          `Not listed in ${MODE_LABEL[mode]}, but ${labelOf(d.stillOpenedFrom)} still opens it: `
          + `${pathWords(chain)}. Nothing was deleted.`,
      };
    }
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
      + 'Technician or office and it opens from the result, or put this device in '
      + `${MODE_LABEL['office']} for a minute. Nothing was deleted.`,
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

export interface StreamNote {
  destination: Destination;
  /** Why this stream does not need it in its hubs. */
  because: string;
  /** The streams that do list it. */
  shownIn: TradeStream[];
}

/**
 * What a stream keeps out of the hubs, each with its reason.
 *
 * The way back is the same for every one of them and is worth saying in the
 * same breath: All modules lists every module in the app whatever the stream
 * is, and search finds everything. So this is a shorter list, not a smaller
 * app, and the settings screen says so beside it.
 */
export function heldBackFrom(stream: StreamChoice): StreamNote[] {
  if (stream === 'both') return [];
  return DESTINATIONS
    .filter((d) => d.streams && !d.streams.includes(stream))
    .map((d) => ({
      destination: d,
      because: d.streamBecause ?? 'No reason recorded, which is itself a fault — see validateManifest.',
      shownIn: TRADE_STREAMS.filter((t) => d.streams!.includes(t)),
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
 *
 * The mode is required rather than defaulted. `hidden` on every result is a
 * statement about one mode, and a default would answer it for whichever mode
 * the caller forgot to mention.
 */
export function searchDestinations(query: string, view: ViewLike, limit = 8): DestinationHit[] {
  /*
   * The stream is deliberately not applied here. Search is how somebody gets
   * to a module their stream keeps out of the hubs, so filtering it by the
   * stream would close the only door the stream left open. The mode still
   * applies below, because that is a different guarantee with its own proof in
   * `unreachableRoutes`.
   */
  const { mode } = asView(view);
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
      // A layout is not a destination, and neither is a file whose name starts
      // with `+`: those are expo-router's own hooks — `+html` is the page shell
      // the web build wraps everything in, `+not-found` the fallback. Nothing
      // navigates to them, so the manifest neither lists nor promises them.
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('_layout.tsx') && !/(^|\/)\+[^/]*$/.test(f)),
  );
  const listed = new Set(DESTINATIONS.map((d) => d.file));
  const missingFromApp = [...listed].filter((f) => !real.has(f)).sort();
  const missingFromManifest = [...real].filter((f) => !listed.has(f)).sort();
  return { missingFromApp, missingFromManifest, ok: !missingFromApp.length && !missingFromManifest.length };
}

/**
 * Checks that every claimed parent really does open its child.
 *
 * `auditManifest` proves the screens exist; this proves the links between them
 * do. That matters because `openedFrom` is what `reach()` prints: an entry
 * written from memory rather than from the file turns into a tap path on the
 * settings screen that a technician follows and does not find. Two of them
 * were wrong when this was first written — the defects list was credited with
 * opening the critical defect notice, and running a routine with opening the
 * test sheet, and neither file contains the link.
 *
 * Takes a reader rather than touching the filesystem, for the same reason
 * `auditManifest` takes a list: this module has to load where there is no
 * `app/` directory. A reader that returns undefined is reported, not assumed
 * away — an unreadable parent is not a verified one.
 */
export function auditLinks(read: (file: string) => string | undefined): string[] {
  const problems: string[] = [];
  for (const d of DESTINATIONS) {
    for (const parentRoute of d.openedFrom) {
      const parent = BY_ROUTE.get(parentRoute);
      if (!parent) continue; // validateManifest names this one.
      const src = read(parent.file);
      if (src === undefined) {
        problems.push(`${parent.file} could not be read, so the link to ${d.route} is unverified.`);
        continue;
      }
      // A screen that navigates from a registry keeps its routes in that file.
      const viaSrc = parent.opensVia ? read(parent.opensVia) : undefined;
      if (parent.opensVia && viaSrc === undefined) {
        problems.push(`${parent.opensVia} could not be read, so the link to ${d.route} is unverified.`);
        continue;
      }
      const haystack = viaSrc === undefined ? src : `${src}\n${viaSrc}`;
      // Two forms appear in this app: the object form, which carries the route
      // verbatim including `[id]`, and a template literal, which carries
      // everything up to the segment and then interpolates it.
      const dynamicAt = d.route.indexOf('[');
      const found = dynamicAt < 0
        ? [`'${d.route}'`, `"${d.route}"`, `\`${d.route}\``].some((form) => haystack.includes(form))
        : haystack.includes(d.route) || haystack.includes(`${d.route.slice(0, dynamicAt)}\${`);
      if (!found) {
        problems.push(`${parent.file} does not open ${d.route}, but the manifest says it does.`);
      }
    }
  }
  return problems;
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

    /*
     * The stream axis, held to the same bargain as the mode one: nothing is
     * held back without a reason a technician can read and disagree with, and
     * a reason on something that is not held back is a rule somebody moved and
     * did not finish moving.
     */
    if (d.streams) {
      if (!d.streams.length) {
        problems.push(`${d.route} lists no trade stream at all, so neither stream's hubs show it.`);
      }
      if (d.streams.length === TRADE_STREAMS.length) {
        problems.push(`${d.route} lists every stream, which is what leaving streams off means.`);
      }
      if (!d.streamBecause) {
        problems.push(`${d.route} is held back from a trade stream with no reason given.`);
      }
      if (d.root) {
        problems.push(`${d.route} is a tab root, and a tab with no rows in a stream is a dead tab.`);
      }
    } else if (d.streamBecause) {
      problems.push(`${d.route} carries a reason for being held back from a stream but is in both.`);
    }

    if (d.root && d.openedFrom.length) problems.push(`${d.route} is a tab root and cannot be opened from anywhere.`);
    if (!d.root && !d.openedFrom.length) problems.push(`${d.route} is opened from nowhere.`);
    for (const parent of d.openedFrom) {
      if (!BY_ROUTE.has(parent)) problems.push(`${d.route} says it opens from ${parent}, which is not in the manifest.`);
    }

    if (d.stillOpenedFrom) {
      if (!d.openedFrom.includes(d.stillOpenedFrom)) {
        problems.push(`${d.route} says ${d.stillOpenedFrom} still opens it but does not list it as an opener.`);
      }
      // The promise is only worth making if the screen making it is on the
      // technician's phone in the mode that hides this one.
      for (const mode of APP_MODES) {
        if (!d.modes.includes(mode) && !BY_ROUTE.get(d.stillOpenedFrom)?.modes.includes(mode)) {
          problems.push(
            `${d.route} says ${d.stillOpenedFrom} still opens it in ${MODE_LABEL[mode]}, `
            + `which does not show ${d.stillOpenedFrom} either.`,
          );
        }
      }
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
  stream: StreamChoice;
  /** Rows this view puts in a hub. */
  listed: number;
  /** Record screens it shows, which are opened from a record rather than a menu. */
  contextual: number;
  /** Destinations it holds back, on either axis. */
  hidden: number;
  /** Of those, the ones the stream holds back rather than the mode. */
  heldByStream: number;
  total: number;
}

/** The numbers behind the setting, for the screen that offers it. */
export function summarise(view: ViewLike): ModeSummary {
  const { mode, stream } = asView(view);
  const shown = destinationsFor(view);
  return {
    mode,
    stream,
    listed: shown.filter((d) => !d.needsContext).length,
    contextual: shown.filter((d) => d.needsContext).length,
    hidden: DESTINATIONS.length - shown.length,
    heldByStream: heldBackFrom(stream).filter((n) => n.destination.modes.includes(mode)).length,
    total: DESTINATIONS.length,
  };
}
