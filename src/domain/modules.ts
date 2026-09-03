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
  { href: '/work/timesheets', label: 'Timesheet', icon: 'calendar-clock-outline', group: 'Every day',
    blurb: 'Your week, copied from last week if you like, emailed to accounts.',
    keywords: ['hours', 'pay', 'overtime', 'RDO', 'leave'] },
  { href: '/work/rfi', label: 'Ask the office', icon: 'account-question-outline', group: 'Every day',
    blurb: 'A question to your supervisor, filed against the job you are on.',
    keywords: ['RFI', 'request for information', 'question', 'supervisor', 'held up'] },
  { href: '/work/leave', label: 'Leave request', icon: 'beach', group: 'Every day',
    blurb: 'Annual, sick, RDO or unpaid. Dates in, working days counted, sent.',
    keywords: ['holiday', 'annual', 'sick', 'RDO', 'day off'] },
  { href: '/map', label: 'Service map', icon: 'map-marker-radius-outline', group: 'Every day',
    blurb: 'Every site we service, jobs coloured by state, Waze one tap away.',
    keywords: ['map', 'waze', 'navigate', 'directions', 'where'] },
  { href: '/suggest', label: 'Suggest a change', icon: 'message-draw', group: 'Every day',
    blurb: 'Tell us what this app should do. It goes straight to whoever builds it.',
    keywords: ['feedback', 'idea', 'bug', 'improve', 'wrong'] },
  { href: '/work/my-day', label: 'My day', icon: 'calendar-account', group: 'Every day',
    blurb: 'What the office has scheduled for you: today, tomorrow, the weeks ahead.',
    keywords: ['my jobs', 'schedule', 'roster', 'today', 'tomorrow'] },
  { href: '/work/outbound', label: 'Waiting to send', icon: 'cloud-upload-outline', group: 'Every day',
    blurb: 'What is queued for the office. It goes up on its own when there is signal.',
    keywords: ['queue', 'sync', 'offline'] },
  { href: '/work/needs', label: 'Things I need', icon: 'format-list-checks', group: 'Every day',
    blurb: 'Parts to get: an extinguisher now, a flow meter before the March annuals.',
    keywords: ['parts', 'order', 'shopping list', 'to get', 'extinguisher', 'flow meter', 'checklist'] },

  // -- Learn ---------------------------------------------------------------
  { href: '/library', label: 'Standards library', icon: 'bookshelf', group: 'Learn',
    blurb: 'Every clause index, searched the way the question is asked. Offline.',
    keywords: ['AS', 'clause', 'code', 'AS 1851', 'AS 1670'] },
  { href: '/library/law', label: 'Queensland law', icon: 'gavel', group: 'Learn',
    blurb: 'The QDC, the fire safety regulation, and what each obliges an occupier to do.',
    keywords: ['QDC', 'BFSR', 'regulation', 'legislation'] },
  { href: '/ask', label: 'Ask a question', icon: 'comment-search-outline', group: 'Learn',
    blurb: 'Routines, defect codes, EOL values and addressing, with the source named every time.',
    keywords: ['help', 'search', 'what is'] },
  { href: '/work/knowledge', label: 'Knowledge', icon: 'lightbulb-on-outline', group: 'Learn',
    blurb: 'Tricks of the trade from the crew, marked verified or not wherever they are used.',
    keywords: ['tips', 'how to', 'notes'] },
  { href: '/tools/defects', label: 'Defect wording', icon: 'format-quote-close', group: 'Learn',
    blurb: 'The standard wording, the severity and the work to clear every defect code.',
    keywords: ['codes', 'standard text', 'rectification'] },
  { href: '/tools/routines', label: 'Routine finder', icon: 'clipboard-search-outline', group: 'Learn',
    blurb: 'Which AS 1851 routine, how often, and what each check actually covers.',
    keywords: ['frequency', 'AS 1851', 'monthly', 'yearly', 'checks'] },

  // -- Calculators ---------------------------------------------------------
  { href: '/tools/resistor', label: 'Resistor values', icon: 'resistor', group: 'Calculators',
    blurb: 'Colour bands to ohms and back, for the end-of-line resistor in your hand.',
    keywords: ['colour code', 'bands', 'EOL', 'ohms'] },
  { href: '/tools/eol', label: 'End of line', icon: 'resistor-nodes', group: 'Calculators',
    blurb: 'The EOL value each panel expects on each circuit type.',
    keywords: ['EOL', 'terminator', 'panel'] },
  { href: '/tools/ohms', label: "Ohm's law", icon: 'omega', group: 'Calculators',
    blurb: 'Any two of volts, amps, ohms and watts give you the other two.',
    keywords: ['voltage', 'current', 'watts', 'resistance'] },
  { href: '/tools/voltdrop', label: 'Volt drop', icon: 'flash-outline', group: 'Calculators',
    blurb: 'Whether the far end of the cable run still sees enough volts.',
    keywords: ['cable', 'run length', 'loop'] },
  { href: '/tools/battery', label: 'Battery sizing', icon: 'battery-charging-outline', group: 'Calculators',
    blurb: 'Standby and alarm load to a battery size, with the AS 1670 cases built in.',
    keywords: ['standby', 'alarm load', 'AS 1670', 'FIP'] },
  { href: '/tools/dipswitch', label: 'Dip switch', icon: 'toggle-switch-outline', group: 'Calculators',
    blurb: 'An address to switch positions and back, for each protocol.',
    keywords: ['address', 'binary', 'loop', 'protocol'] },
  { href: '/tools/detector-age', label: 'Detector age', icon: 'calendar-search', group: 'Calculators',
    blurb: 'Reads the date code on a detector and says when it is due for replacement.',
    keywords: ['date code', 'replacement', 'ten years'] },
  { href: '/tools/spl', label: 'Sound level', icon: 'volume-high', group: 'Calculators',
    blurb: 'Whether the warning is loud enough in the room you are standing in.',
    keywords: ['dB', 'sounder', 'coverage', 'occupant warning'] },
  { href: '/tools/hydrant', label: 'Hydrant flow', icon: 'fire-hydrant', group: 'Calculators',
    blurb: 'A measured flow to what the supply gives at brigade pressure, against the duty.',
    keywords: ['pressure', 'AS 2419', 'flow test'] },
  { href: '/tools/hose-reel', label: 'Hose reel', icon: 'hydro-power', group: 'Calculators',
    blurb: 'Reach, flow and whether the reel made its duty.',
    keywords: ['flow', 'AS 2441'] },
  { href: '/tools/emergency-lighting', label: 'Emergency lighting', icon: 'lightbulb-alert-outline', group: 'Calculators',
    blurb: 'Discharge outcome, exit sign viewing distance and battery age.',
    keywords: ['exit', 'spacing', 'AS 2293', 'discharge'] },
  { href: '/tools/extinguisher', label: 'Extinguisher', icon: 'fire-extinguisher', group: 'Calculators',
    blurb: 'Type, what it must never be pointed at, and when the next test falls.',
    keywords: ['selection', 'AS 2444', 'pressure test'] },
  { href: '/tools/fire-door', label: 'Fire door', icon: 'door-closed', group: 'Calculators',
    blurb: 'What the tag says, whether the gap passes, whether it closed and latched.',
    keywords: ['FRL', 'gap', 'AS 1905'] },
  { href: '/tools/vesda', label: 'VESDA', icon: 'air-filter', group: 'Calculators',
    blurb: 'Aspirating battery sizing, where the aspirator runs all day.',
    keywords: ['aspirating', 'pipe', 'battery'] },
  { href: '/tools/converter', label: 'Converter', icon: 'swap-horizontal', group: 'Calculators',
    blurb: 'kPa to psi, litres to gallons, and the rest of the units on a tag.',
    keywords: ['units', 'kpa', 'psi', 'litres'] },

  // -- On site -------------------------------------------------------------
  { href: '/sites', label: 'Sites', icon: 'office-building-marker-outline', group: 'On site',
    blurb: 'Every site on the books, by name, address or client.',
    keywords: ['building', 'customer', 'address'] },
  { href: '/assets/find', label: 'Find asset', icon: 'magnify-scan', group: 'On site',
    blurb: 'One box across assets, imported points and parts, for the one identifier you have.',
    keywords: ['search', 'tag', 'barcode', 'serial'] },
  { href: '/scan', label: 'Scan a tag', icon: 'qrcode-scan', group: 'On site',
    blurb: 'Point the camera at an asset tag and open the record.',
    keywords: ['qr', 'barcode'] },
  { href: '/routine/run', label: 'Run a routine', icon: 'play-circle-outline', group: 'On site',
    blurb: 'Walk an AS 1851 routine check by check and record each result.',
    keywords: ['service', 'AS 1851', 'test', 'checks'] },
  { href: '/work/defect/new', label: 'Raise defect', icon: 'alert-plus-outline', group: 'On site',
    blurb: 'System, component, defect. The library supplies the wording and the severity.',
    keywords: ['fault', 'broken', 'report'] },
  { href: '/impairment/new', label: 'Impairment', icon: 'alert-octagon-outline', group: 'On site',
    blurb: 'Takes a system out of service and starts the clock on the obligations.',
    keywords: ['isolation', 'out of service', 'isolate'] },
  { href: '/work/stock', label: 'Van stock', icon: 'van-utility', group: 'On site',
    blurb: 'What you carry and what tomorrow will leave you short of.',
    keywords: ['parts', 'restock', 'inventory'] },
  { href: '/catalogue', label: 'Parts catalogue', icon: 'package-variant-closed', group: 'On site',
    blurb: 'Part numbers, brands and descriptions, searched all at once.',
    keywords: ['part number', 'brand', 'spares'] },
  { href: '/work/purchases', label: 'Order parts', icon: 'cart-outline', group: 'On site',
    blurb: 'A purchase request that lands in Simpro as an order.',
    keywords: ['purchase order', 'supplier'] },

  // -- Forms and records ---------------------------------------------------
  { href: '/work/reports', label: 'Reports', icon: 'file-document-outline', group: 'Forms and records',
    blurb: 'Every service report on this device, newest first.',
    keywords: ['test sheets', 'service report'] },
  { href: '/occupier', label: 'Occupier statement', icon: 'file-certificate-outline', group: 'Forms and records',
    blurb: 'The annual statement, cross-checked against the defects on record.',
    keywords: ['MP 6.1', 'annual', 'statement'] },
  { href: '/site/form72', label: 'Form 72', icon: 'clipboard-check-outline', group: 'Forms and records',
    blurb: 'The statutory hydrant and sprinkler form, filled from the site.',
    keywords: ['hydrant', 'sprinkler', 'statutory'] },
  { href: '/tools/flow-certificate', label: 'Flow certificate', icon: 'water-check-outline', group: 'Forms and records',
    blurb: 'Sprinkler and hydrant duty on one page, with the overload run answered.',
    keywords: ['flow test', 'certificate'] },
  { href: '/work/baselines', label: 'Baseline data', icon: 'database-outline', group: 'Forms and records',
    blurb: 'Commissioning records, so the next person knows what normal looks like.',
    keywords: ['commissioning', 'baseline'] },
  { href: '/work/labels', label: 'Print labels', icon: 'label-outline', group: 'Forms and records',
    blurb: 'Issue numbers to untagged assets and print the sheet.',
    keywords: ['tag', 'sticker', 'asset numbers'] },
  { href: '/quotes', label: 'Quotes', icon: 'currency-usd', group: 'Forms and records',
    blurb: 'What is out with clients and what is about to lapse.',
    keywords: ['quote', 'pricing'] },

  // -- Jobs and planning ---------------------------------------------------
  { href: '/work/jobs', label: 'Jobs', icon: 'clipboard-list-outline', group: 'Jobs and planning',
    blurb: 'Scheduled and outstanding work from Simpro, urgent first.',
    keywords: ['my jobs', 'work order', 'scheduled', 'urgent'] },
  { href: '/quotes/simpro', label: 'Simpro quotes', icon: 'file-sign', group: 'Jobs and planning',
    blurb: "The office's quotes as Simpro holds them: open, approved, and the job each became.",
    keywords: ['quote', 'simpro', 'approved', 'converted', 'office'] },
  { href: '/invoices', label: 'Invoices', icon: 'receipt-text-outline', group: 'Jobs and planning',
    blurb: "Two years of the office's invoices, unpaid first, with what is still owed.",
    keywords: ['invoice', 'unpaid', 'owing', 'paid', 'billing', 'simpro'] },
  { href: '/work/route', label: "Today's run", icon: 'map-marker-path', group: 'Jobs and planning',
    blurb: 'The day ordered by where the work is.',
    keywords: ['route', 'drive', 'order'] },
  { href: '/work/due', label: 'What is due', icon: 'calendar-alert', group: 'Jobs and planning',
    blurb: 'Routines past their tolerance window, across every site.',
    keywords: ['overdue', 'lapsed', 'tolerance'] },
  { href: '/work/promises', label: 'Promises made', icon: 'handshake-outline', group: 'Jobs and planning',
    blurb: 'What you told a client you would come back for.',
    keywords: ['told the client', 'follow up'] },
  { href: '/work/portfolio', label: 'Portfolio', icon: 'chart-box-outline', group: 'Jobs and planning',
    blurb: 'How the whole book is going, coverage stated before any score.',
    keywords: ['overview', 'manager', 'health'] },
  { href: '/work/recurring', label: 'Recurring failures', icon: 'repeat-variant', group: 'Jobs and planning',
    blurb: 'Assets that keep failing, where a fourth swap will not fix it.',
    keywords: ['repeat', 'keeps failing'] },
  { href: '/work/plan', label: 'Plan work', icon: 'calendar-month-outline', group: 'Jobs and planning',
    blurb: 'The month day by day, with what could not be planned said out loud.',
    keywords: ['month', 'schedule', 'planner'] },

  // -- Admin ---------------------------------------------------------------
  { href: '/settings', label: 'Settings', icon: 'cog-outline', group: 'Admin',
    blurb: 'Your name and licence, the Simpro link, and how this device behaves.',
    keywords: ['name', 'licence', 'simpro', 'sync'] },
  { href: '/signin', label: 'Sign in to Simpro', icon: 'login', group: 'Admin',
    blurb: 'Your own Simpro login, the same one as Simpro Mobile.',
    keywords: ['login', 'log in', 'account', 'password'] },
  { href: '/whoami', label: 'Who you are', icon: 'account-check-outline', group: 'Admin',
    blurb: 'Pick yourself from the office employee list.',
    keywords: ['employee', 'technician', 'identity', 'name'] },
  { href: '/import', label: 'Import a file', icon: 'file-import-outline', group: 'Admin',
    blurb: 'A panel configuration or an asset register, read and described before it is written.',
    keywords: ['panel', 'config', 'register', 'csv'] },
];

export const MODULE_GROUPS: ModuleGroup[] = [
  'Every day', 'Learn', 'Calculators', 'On site', 'Forms and records', 'Jobs and planning', 'Admin',
];

/**
 * What a new install starts with.
 *
 * Eight, and none of them a job list. The first thing a technician sees has
 * to be true for the projects crew and the service crew alike: the week's
 * hours, a way to ask the office something, leave, the map, the reference and
 * two calculators. Anyone who wants their jobs on the front page adds them,
 * which takes one tap, and the grid is obviously theirs from then on.
 */
export const DEFAULT_SHORTCUTS: string[] = [
  '/work/timesheets',
  '/work/rfi',
  '/work/leave',
  '/map',
  '/library',
  '/tools/routines',
  '/tools/resistor',
  '/suggest',
];

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

export function migrateShortcuts(saved: readonly string[] | undefined): string[] {
  if (!saved) return [...DEFAULT_SHORTCUTS];
  const untouchedLegacy = saved.length === LEGACY_DEFAULT_SHORTCUTS.length
    && saved.every((h, i) => h === LEGACY_DEFAULT_SHORTCUTS[i]);
  return untouchedLegacy ? [...DEFAULT_SHORTCUTS] : [...saved];
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

export function toggleShortcut(hrefs: readonly string[], href: string): string[] {
  return hrefs.includes(href) ? hrefs.filter((h) => h !== href) : [...hrefs, href];
}
