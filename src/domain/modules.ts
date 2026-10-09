/**
 * Everything a technician can put on their home screen.
 *
 * The home screen is a hub, not a dashboard. It used to open on urgent jobs,
 * open defects, overdue routines and the next job — which is the right screen
 * for one service technician and the wrong one for everybody else on the
 * books: the projects crew, the apprentices, the office. None of that is about
 * the person holding the phone unless the app knows who they are in the office
 * system, and it does not. So the home screen carries what is true for
 * everyone — the question bar, and a grid the technician builds themselves —
 * and job management lives in the Work tab for those who want it.
 *
 * Held as data rather than as JSX so the list can be searched, grouped and
 * tested, and so a screen added later shows up in the picker by adding one line
 * here rather than by editing a layout.
 */

export type ModuleGroup =
  | 'Every day'
  | 'Learn'
  | 'Calculators'
  | 'On site'
  | 'Forms and records'
  | 'Jobs and planning'
  | 'Admin';

export interface AppModule {
  /** The route. Also the stable id — routes outlive labels. */
  href: string;
  label: string;
  /** MaterialCommunityIcons name. */
  icon: string;
  group: ModuleGroup;
  /**
   * One line under the label on the tile: what it does, not what it is
   * called. A grid of one-word labels reads as a menu; a grid that says what
   * each thing is for reads as a place to work.
   */
  blurb: string;
  /** Extra words someone might search for that are not in the label. */
  keywords?: string[];
}

/**
 * The catalogue.
 *
 * Ordered within each group by how often it is likely to be reached for, since
 * that is the order the picker shows and most people take the first thing that
 * looks right. The groups are in the order a technician thinks: what I do
 * every day, what I need to know, what I need to work out, where I am.
 */
export const MODULES: AppModule[] = [
  // -- Every day -----------------------------------------------------------
  { href: '/search', label: 'Find anything', icon: 'text-box-search-outline', group: 'Every day',
    blurb: 'Jobs, sites, customers, invoices, orders and parts.',
    keywords: ['search', 'find', 'lookup', 'job number', 'invoice number', 'purchase order', 'po', 'part number', 'phone', 'who'] },
  { href: '/contacts', label: 'Contacts', icon: 'account-group-outline', group: 'Every day',
    blurb: 'Ring, text or email anyone the office has.',
    keywords: ['people', 'phone', 'ring', 'call', 'text', 'sms', 'email', 'building manager', 'who to ring'] },
  { href: '/work/clock', label: 'Clock on', icon: 'timer-play-outline', group: 'Every day',
    blurb: 'Clock on and off jobs. Hours go to Simpro.',
    keywords: ['clock', 'on', 'off', 'hours', 'time', 'timesheet', 'job hours', 'travel', 'break', 'schedule block'] },
  { href: '/work/timesheets', label: 'Timesheet', icon: 'calendar-clock-outline', group: 'Every day',
    blurb: 'Your week, filled from your schedule or typed.',
    keywords: ['hours', 'pay', 'overtime', 'RDO', 'leave'] },
  { href: '/work/rfi', label: 'Ask the office', icon: 'account-question-outline', group: 'Every day',
    blurb: 'A question to the office about a job.',
    keywords: ['RFI', 'request for information', 'question', 'supervisor', 'held up'] },
  { href: '/work/leave', label: 'Book leave', icon: 'beach', group: 'Every day',
    blurb: 'Book days off onto your Simpro schedule.',
    keywords: ['leave', 'annual', 'rdo', 'sick', 'day off', 'holiday', 'roster', 'simpro'] },
  { href: '/map', label: 'Service map', icon: 'map-marker-radius-outline', group: 'Every day',
    blurb: 'Every site on a map, with directions.',
    keywords: ['map', 'waze', 'navigate', 'directions', 'where'] },
  { href: '/suggest', label: 'Suggest a change', icon: 'message-draw', group: 'Every day',
    blurb: 'An idea or a fault with the app.',
    keywords: ['feedback', 'idea', 'bug', 'improve', 'wrong'] },
  { href: '/work/my-day', label: 'My day', icon: 'calendar-account', group: 'Every day',
    blurb: 'What you are booked on today and ahead.',
    keywords: ['my jobs', 'schedule', 'roster', 'today', 'tomorrow'] },
  { href: '/work/schedule', label: 'Schedule', icon: 'calendar-multiselect-outline', group: 'Every day',
    blurb: "Your day and the team's. Book yourself on.",
    keywords: ['calendar', 'book', 'book me on', 'roster', 'team', 'move', 'blocks'] },
  { href: '/work/outbound', label: 'Waiting to send', icon: 'cloud-upload-outline', group: 'Every day',
    blurb: 'What is queued for Simpro.',
    keywords: ['queue', 'sync', 'offline'] },
  { href: '/work/needs', label: 'Things I need', icon: 'format-list-checks', group: 'Every day',
    blurb: 'Parts to get, now and for coming work.',
    keywords: ['parts', 'order', 'shopping list', 'to get', 'extinguisher', 'flow meter', 'checklist'] },

  // -- Learn ---------------------------------------------------------------
  { href: '/library', label: 'Standards library', icon: 'bookshelf', group: 'Learn',
    blurb: 'Search every standard and your own PDFs.',
    keywords: ['AS', 'clause', 'code', 'AS 1851', 'AS 1670'] },
  { href: '/library/law', label: 'Fire safety regulation', icon: 'gavel', group: 'Learn',
    blurb: 'Building Fire Safety Regulation 2008, by who must act.',
    keywords: ['BFSR', 'regulation', 'legislation', 'occupier'] },
  { href: '/tools/defects', label: 'Defect wording', icon: 'format-quote-close', group: 'Learn',
    blurb: 'Report wording and fix for each defect code.',
    keywords: ['codes', 'standard text', 'rectification'] },
  { href: '/tools/routines', label: 'Service routines', icon: 'clipboard-search-outline', group: 'Learn',
    blurb: 'What each service routine checks, and how often.',
    keywords: ['frequency', 'AS 1851', 'monthly', 'yearly', 'checks'] },

  // -- Calculators ---------------------------------------------------------
  { href: '/tools/resistor', label: 'Resistor values', icon: 'resistor', group: 'Calculators',
    blurb: 'Colour bands to ohms and back.',
    keywords: ['colour code', 'bands', 'EOL', 'ohms'] },
  { href: '/tools/eol', label: 'End of line', icon: 'resistor-nodes', group: 'Calculators',
    blurb: 'EOL values by panel and circuit.',
    keywords: ['EOL', 'terminator', 'panel'] },
  { href: '/tools/ohms', label: "Ohm's law", icon: 'omega', group: 'Calculators',
    blurb: "Ohm's law, power and battery runtime.",
    keywords: ['voltage', 'current', 'watts', 'resistance'] },
  { href: '/tools/voltdrop', label: 'Volt drop', icon: 'flash-outline', group: 'Calculators',
    blurb: 'Volts at the far end of the run.',
    keywords: ['cable', 'run length', 'loop'] },
  { href: '/tools/cable', label: 'Cable sizing', icon: 'cable-data', group: 'Calculators',
    blurb: 'Capacity, volt drop, breaker and fault, to AS/NZS 3008.',
    keywords: ['current carrying capacity', 'ccc', 'as 3008', 'as 3000', 'derating', 'submain', 'mains', 'wiring rules'] },
  { href: '/tools/wiring', label: 'Wiring rules tables', icon: 'book-open-page-variant-outline', group: 'Calculators',
    blurb: 'AS/NZS 3008 and AS/NZS 3000 tables.',
    keywords: ['as 3008', 'as 3000', 'wiring rules', 'tables', 'standard', 'ccc', 'derating', 'volt drop', 'appendix c'] },
  { href: '/tools/fault-loop', label: 'Fault loop', icon: 'flash-alert-outline', group: 'Calculators',
    blurb: 'Loop impedance, trip check, max run and earth size.',
    keywords: ['zs', 'ze', 'earth fault loop', 'impedance', 'disconnection', 'earth conductor', 'adiabatic', 'as 3000'] },
  { href: '/tools/max-demand', label: 'Maximum demand', icon: 'gauge-full', group: 'Calculators',
    blurb: 'Maximum demand per phase.',
    keywords: ['maximum demand', 'diversity', 'main switch', 'supply', 'balance', 'as 3000'] },
  { href: '/tools/battery', label: 'FIP battery', icon: 'battery-charging-outline', group: 'Calculators',
    blurb: 'Standby and alarm load to battery size. VESDA included.',
    keywords: ['standby', 'alarm load', 'AS 1670', 'FIP'] },
  { href: '/tools/dipswitch', label: 'Device address', icon: 'toggle-switch-outline', group: 'Calculators',
    blurb: 'DIP switches, XPERT cards and rotary dials.',
    keywords: ['address', 'binary', 'loop', 'protocol'] },
  { href: '/tools/detector-age', label: 'Detector age', icon: 'calendar-search', group: 'Calculators',
    blurb: 'Date code to age and replacement.',
    keywords: ['date code', 'replacement', 'ten years'] },
  { href: '/tools/spl', label: 'Sound level', icon: 'volume-high', group: 'Calculators',
    blurb: 'Is the warning loud enough in this room?',
    keywords: ['dB', 'sounder', 'coverage', 'occupant warning'] },
  { href: '/tools/hydrant', label: 'Hydrant flow', icon: 'fire-hydrant', group: 'Calculators',
    blurb: 'Flow, supply at brigade pressure, and the duty.',
    keywords: ['pressure', 'AS 2419', 'flow test'] },
  { href: '/tools/hose-reel', label: 'Hose reels', icon: 'hydro-power', group: 'Calculators',
    blurb: 'Reach, flow and next service.',
    keywords: ['flow', 'AS 2441'] },
  { href: '/tools/emergency-lighting', label: 'Emergency lighting', icon: 'lightbulb-alert-outline', group: 'Calculators',
    blurb: 'Discharge, exit signs, battery age and spacing.',
    keywords: ['exit', 'spacing', 'AS 2293', 'discharge'] },
  { href: '/tools/extinguisher', label: 'Extinguishers', icon: 'fire-extinguisher', group: 'Calculators',
    blurb: 'Type, next test and weight check.',
    keywords: ['selection', 'AS 2444', 'pressure test'] },
  { href: '/tools/fire-door', label: 'Fire and smoke doors', icon: 'door-closed', group: 'Calculators',
    blurb: 'Tag, gaps, close and latch.',
    keywords: ['FRL', 'gap', 'AS 1905'] },
  { href: '/tools/converter', label: 'Unit converter', icon: 'swap-horizontal', group: 'Calculators',
    blurb: 'Pressure, flow, volume, temperature and more.',
    keywords: ['units', 'kpa', 'psi', 'litres'] },

  // -- On site -------------------------------------------------------------
  { href: '/sites', label: 'Sites', icon: 'office-building-marker-outline', group: 'On site',
    blurb: 'Every site, by name, address or client.',
    keywords: ['building', 'customer', 'address'] },
  { href: '/config', label: 'Config Explorer', icon: 'file-cog-outline', group: 'On site',
    blurb: 'Open and read a panel config.',
    keywords: ['config', 'configuration', 'panel file', 'nle', 'pci', 'ffp', 'util', 'mx1', 'loop explorer',
      'verifire', 'smartconfig', 'config manager', 'programming', 'open a config', 'what is programmed'] },
  { href: '/assets/find', label: 'Find asset', icon: 'magnify-scan', group: 'On site',
    blurb: 'Search assets by tag, serial or location.',
    keywords: ['search', 'tag', 'barcode', 'serial', 'asset number', 'asset #'] },
  { href: '/scan', label: 'Scan a tag', icon: 'qrcode-scan', group: 'On site',
    blurb: 'Open an asset from its label.',
    keywords: ['qr', 'barcode'] },
  { href: '/routine/run', label: 'Run a routine', icon: 'play-circle-outline', group: 'On site',
    blurb: 'Record an AS 1851 routine, check by check.',
    keywords: ['service', 'AS 1851', 'test', 'checks'] },
  { href: '/work/defect/new', label: 'Raise defect', icon: 'alert-plus-outline', group: 'On site',
    blurb: 'Pick the code. Wording and severity fill in.',
    keywords: ['fault', 'broken', 'report'] },
  { href: '/impairment/new', label: 'Impairment', icon: 'alert-octagon-outline', group: 'On site',
    blurb: 'Log a system out of service.',
    keywords: ['isolation', 'out of service', 'isolate'] },
  { href: '/office-catalogue', label: 'Office catalogue', icon: 'clipboard-list-outline', group: 'On site',
    blurb: "The office's parts list with sell prices.",
    keywords: ['simpro catalogue', 'part number', 'sell price', 'parts', 'materials', 'copy'] },
  { href: '/orders', label: 'Purchase orders', icon: 'package-variant', group: 'On site',
    blurb: 'What the office has ordered, and if it has arrived.',
    keywords: ['po', 'order', 'supplier', 'vendor', 'received', 'parts on order', 'delivery'] },

  // -- Forms and records ---------------------------------------------------
  { href: '/swms', label: 'SWMS and JSEA', icon: 'clipboard-check-outline', group: 'Forms and records',
    blurb: 'Safe work method statements, signed on the phone.',
    keywords: ['swms', 'jsea', 'jsa', 'safe work method', 'safety', 'hazard', 'risk assessment', 'permit'] },
  { href: '/work/reports', label: 'Test sheets', icon: 'file-document-outline', group: 'Forms and records',
    blurb: 'Test sheets on this phone.',
    keywords: ['test sheets', 'service report'] },
  { href: '/occupier', label: 'Occupier statement', icon: 'file-certificate-outline', group: 'Forms and records',
    blurb: 'The annual statement, checked against the defects.',
    keywords: ['MP 6.1', 'annual', 'statement'] },
  { href: '/site/form72', label: 'Form 72', icon: 'clipboard-check-outline', group: 'Forms and records',
    blurb: 'Hydrant and sprinkler Form 72. Part A fills from the job.',
    keywords: ['hydrant', 'sprinkler', 'statutory', 'periodic', 'MP 6.1'] },
  { href: '/work/baselines', label: 'Baseline data', icon: 'database-outline', group: 'Forms and records',
    blurb: 'Commissioning readings for the system.',
    keywords: ['commissioning', 'baseline'] },
  { href: '/quotes', label: 'Quotes', icon: 'currency-usd', group: 'Forms and records',
    blurb: 'Out with clients, and about to lapse.',
    keywords: ['quote', 'pricing'] },

  // -- Jobs and planning ---------------------------------------------------
  { href: '/work/jobs', label: 'Jobs', icon: 'clipboard-list-outline', group: 'Jobs and planning',
    blurb: 'Scheduled and open jobs, urgent first.',
    keywords: ['my jobs', 'work order', 'scheduled', 'urgent'] },
  { href: '/invoices', label: 'Invoices', icon: 'receipt-text-outline', group: 'Jobs and planning',
    blurb: 'Invoices, unpaid first.',
    keywords: ['invoice', 'unpaid', 'owing', 'paid', 'billing', 'simpro'] },
  { href: '/work/route', label: "Today's run", icon: 'map-marker-path', group: 'Jobs and planning',
    blurb: 'Jobs in order of distance.',
    keywords: ['route', 'drive', 'order'] },
  { href: '/work/plan', label: 'Plan work', icon: 'calendar-month-outline', group: 'Jobs and planning',
    blurb: 'Build a day and book it in Simpro.',
    keywords: ['month', 'schedule', 'planner', 'day', 'last service', 'history'] },

  // -- Admin ---------------------------------------------------------------
  { href: '/settings', label: 'Settings', icon: 'cog-outline', group: 'Admin',
    blurb: 'Your details, Simpro and this device.',
    keywords: ['name', 'licence', 'simpro', 'sync'] },
  { href: '/whoami', label: 'Who you are', icon: 'account-check-outline', group: 'Admin',
    blurb: 'Pick yourself from the Simpro staff list.',
    keywords: ['employee', 'technician', 'identity', 'name'] },
];

export const MODULE_GROUPS: ModuleGroup[] = [
  'Every day', 'Learn', 'Calculators', 'On site', 'Forms and records', 'Jobs and planning', 'Admin',
];

/**
 * What a new install starts with: all of it.
 *
 * This used to ship eight tiles, on the reasoning that a full grid looks
 * finished and nobody edits a finished thing, so a short one that is obviously
 * missing your favourite is what sends somebody to the edit button.
 *
 * The owner's call is the other way, and it is the better one for this app: a
 * technician cannot go looking for a module they have never seen. Everything a
 * new phone can do is on the front page, and taking a tile off is one tap from
 * the same screen that adds one. Nobody has to be told the app can do a thing
 * before they can find it.
 *
 * Built from MODULES rather than written out, so a module added next month is
 * on a new phone without anybody remembering to put it here.
 */
export const DEFAULT_SHORTCUTS: string[] = MODULES.map((m) => m.href);

/**
 * The defaults the previous build shipped with.
 *
 * A phone that saved its settings under that build holds this exact list, and
 * holds it because nobody chose it. `migrateShortcuts` swaps it for the current
 * defaults; a list that differs from it in any way was edited by somebody and
 * is left alone.
 */
export const LEGACY_DEFAULT_SHORTCUTS: readonly string[] = [
  '/work/jobs',
  '/sites',
  '/assets/find',
  '/work/defect/new',
  '/work/timesheets',
  '/tools/resistor',
];

/**
 * The eight-tile grid that shipped between the two.
 *
 * A phone updated during that window holds this and holds it because nobody
 * chose it, exactly as LEGACY_DEFAULT_SHORTCUTS describes. Kept as its own
 * list rather than folded into that one, so each is the honest record of what
 * some build actually shipped.
 */
export const SHORT_GRID_DEFAULT_SHORTCUTS: readonly string[] = [
  '/work/timesheets',
  '/swms',
  '/work/rfi',
  '/work/leave',
  '/library',
  '/tools/routines',
  '/tools/resistor',
  '/suggest',
];

/** Every arrangement this app has ever shipped as its own idea of a default. */
const SUPERSEDED_DEFAULTS: readonly (readonly string[])[] = [
  LEGACY_DEFAULT_SHORTCUTS,
  SHORT_GRID_DEFAULT_SHORTCUTS,
];

export function migrateShortcuts(saved: readonly string[] | undefined): string[] {
  if (!saved) return [...DEFAULT_SHORTCUTS];
  const untouched = SUPERSEDED_DEFAULTS.some(
    (was) => saved.length === was.length && saved.every((h, i) => h === was[i]),
  );
  return untouched ? [...DEFAULT_SHORTCUTS] : [...saved];
}

const BY_HREF = new Map(MODULES.map((m) => [m.href, m]));

export function moduleFor(href: string): AppModule | undefined {
  return BY_HREF.get(href);
}

/**
 * Resolves saved shortcuts to modules.
 *
 * Unknown hrefs are dropped rather than rendered as a blank tile: a route
 * removed in an update would otherwise leave a tile that navigates nowhere,
 * and the technician has no way to know why.
 */
export function resolveShortcuts(hrefs: readonly string[]): AppModule[] {
  const seen = new Set<string>();
  const out: AppModule[] = [];
  for (const href of hrefs) {
    const m = BY_HREF.get(href);
    if (m && !seen.has(href)) {
      seen.add(href);
      out.push(m);
    }
  }
  return out;
}

/** Case-insensitive search across label, blurb, group and keywords. */
export function searchModules(query: string): AppModule[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODULES;
  return MODULES.filter((m) =>
    m.label.toLowerCase().includes(q)
    || m.blurb.toLowerCase().includes(q)
    || m.group.toLowerCase().includes(q)
    || (m.keywords ?? []).some((k) => k.toLowerCase().includes(q)));
}

/** Moves a shortcut one place earlier or later, for reordering by tap. */
export function moveShortcut(hrefs: readonly string[], href: string, direction: -1 | 1): string[] {
  const i = hrefs.indexOf(href);
  if (i < 0) return [...hrefs];
  const j = i + direction;
  if (j < 0 || j >= hrefs.length) return [...hrefs];
  const next = [...hrefs];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * Straight to the front, or straight to the back.
 *
 * Moving a tile one place at a time is right for a nudge and useless for the
 * thing people actually do, which is put the one they use every morning at the
 * top. From the fourteenth position that is thirteen taps, and thirteen writes
 * to preferences, and thirteen chances for the list to animate out from under
 * a thumb. It is the same reason a list of three thousand sites needed a
 * search box: the interaction that is fine for a small number stops being an
 * interaction at all for a real one.
 *
 * A missing href is returned unchanged rather than inserted, matching
 * moveShortcut. Something that is not pinned cannot be moved to the top of the
 * pinned list, and inventing it there would put a tile on somebody's home
 * screen that they never chose.
 */
export function promoteShortcut(hrefs: readonly string[], href: string): string[] {
  if (!hrefs.includes(href)) return [...hrefs];
  return [href, ...hrefs.filter((h) => h !== href)];
}

export function demoteShortcut(hrefs: readonly string[], href: string): string[] {
  if (!hrefs.includes(href)) return [...hrefs];
  return [...hrefs.filter((h) => h !== href), href];
}

export function toggleShortcut(hrefs: readonly string[], href: string): string[] {
  return hrefs.includes(href) ? hrefs.filter((h) => h !== href) : [...hrefs, href];
}
