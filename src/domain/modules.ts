/**
 * Everything a technician can put on their home screen.
 *
 * The app has grown to seventy-nine screens. A fixed grid of twelve is somebody
 * else's guess at which twelve matter, and it is wrong for almost everyone: the
 * detection tech wants the resistor table and the dip switch decoder, the
 * extinguisher tech wants none of that and wants the pressure test calculator,
 * and both want their timesheet. So the grid is theirs to set.
 *
 * Held as data rather than as JSX so the list can be searched, grouped and
 * tested, and so a screen added later shows up in the picker by adding one line
 * here rather than by editing a layout.
 */

export type ModuleGroup =
  | 'Daily'
  | 'Site work'
  | 'Calculators'
  | 'Forms and records'
  | 'Reference'
  | 'Admin';

export interface AppModule {
  /** The route. Also the stable id — routes outlive labels. */
  href: string;
  label: string;
  /** MaterialCommunityIcons name. */
  icon: string;
  group: ModuleGroup;
  /** Extra words someone might search for that are not in the label. */
  keywords?: string[];
}

/**
 * The catalogue.
 *
 * Ordered within each group by how often it is likely to be reached for, since
 * that is the order the picker shows and most people take the first thing that
 * looks right.
 */
export const MODULES: AppModule[] = [
  // -- Daily ---------------------------------------------------------------
  { href: '/work/jobs', label: 'My jobs', icon: 'clipboard-list-outline', group: 'Daily' },
  { href: '/work/route', label: "Today's run", icon: 'map-marker-path', group: 'Daily', keywords: ['route', 'drive', 'order'] },
  { href: '/work/timesheets', label: 'Timesheet', icon: 'calendar-clock-outline', group: 'Daily', keywords: ['hours', 'pay', 'overtime'] },
  { href: '/work/due', label: 'What is due', icon: 'calendar-alert', group: 'Daily', keywords: ['overdue', 'lapsed'] },
  { href: '/work/promises', label: 'Promises made', icon: 'handshake-outline', group: 'Daily', keywords: ['told the client'] },
  { href: '/work/outbound', label: 'Waiting to send', icon: 'cloud-upload-outline', group: 'Daily', keywords: ['queue', 'sync', 'offline'] },

  // -- Site work -----------------------------------------------------------
  { href: '/sites', label: 'Sites', icon: 'office-building-marker-outline', group: 'Site work' },
  { href: '/assets/find', label: 'Find asset', icon: 'magnify-scan', group: 'Site work', keywords: ['search', 'tag', 'barcode'] },
  { href: '/scan', label: 'Scan a tag', icon: 'qrcode-scan', group: 'Site work', keywords: ['qr', 'barcode'] },
  { href: '/routine/run', label: 'Run a routine', icon: 'play-circle-outline', group: 'Site work', keywords: ['service', 'AS 1851', 'test'] },
  { href: '/work/defect/new', label: 'Raise defect', icon: 'alert-plus-outline', group: 'Site work' },
  { href: '/impairment/new', label: 'Impairment', icon: 'alert-octagon-outline', group: 'Site work', keywords: ['isolation', 'out of service'] },
  { href: '/work/stock', label: 'Van stock', icon: 'van-utility', group: 'Site work', keywords: ['parts', 'restock'] },
  { href: '/catalogue', label: 'Parts catalogue', icon: 'package-variant-closed', group: 'Site work' },
  { href: '/work/purchases', label: 'Order parts', icon: 'cart-outline', group: 'Site work', keywords: ['purchase order', 'supplier'] },

  // -- Calculators ---------------------------------------------------------
  { href: '/tools/resistor', label: 'Resistor values', icon: 'resistor', group: 'Calculators', keywords: ['colour code', 'bands', 'EOL'] },
  { href: '/tools/eol', label: 'End of line', icon: 'resistor-nodes', group: 'Calculators', keywords: ['EOL', 'terminator'] },
  { href: '/tools/ohms', label: "Ohm's law", icon: 'omega', group: 'Calculators', keywords: ['voltage', 'current', 'watts'] },
  { href: '/tools/voltdrop', label: 'Volt drop', icon: 'flash-outline', group: 'Calculators', keywords: ['cable', 'run length'] },
  { href: '/tools/battery', label: 'Battery sizing', icon: 'battery-charging-outline', group: 'Calculators', keywords: ['standby', 'alarm load', 'AS 1670'] },
  { href: '/tools/dipswitch', label: 'Dip switch', icon: 'toggle-switch-outline', group: 'Calculators', keywords: ['address', 'binary'] },
  { href: '/tools/detector-age', label: 'Detector age', icon: 'calendar-search', group: 'Calculators', keywords: ['date code', 'replacement'] },
  { href: '/tools/spl', label: 'Sound level', icon: 'volume-high', group: 'Calculators', keywords: ['dB', 'sounder', 'coverage'] },
  { href: '/tools/hydrant', label: 'Hydrant flow', icon: 'fire-hydrant', group: 'Calculators', keywords: ['pressure', 'AS 2419'] },
  { href: '/tools/hose-reel', label: 'Hose reel', icon: 'hydro-power', group: 'Calculators', keywords: ['flow', 'AS 2441'] },
  { href: '/tools/emergency-lighting', label: 'Emergency lighting', icon: 'lightbulb-alert-outline', group: 'Calculators', keywords: ['exit', 'spacing', 'AS 2293'] },
  { href: '/tools/extinguisher', label: 'Extinguisher', icon: 'fire-extinguisher', group: 'Calculators', keywords: ['selection', 'AS 2444'] },
  { href: '/tools/fire-door', label: 'Fire door', icon: 'door-closed', group: 'Calculators', keywords: ['FRL', 'gap', 'AS 1905'] },
  { href: '/tools/vesda', label: 'VESDA', icon: 'air-filter', group: 'Calculators', keywords: ['aspirating', 'pipe'] },
  { href: '/tools/converter', label: 'Converter', icon: 'swap-horizontal', group: 'Calculators', keywords: ['units', 'kpa', 'psi'] },
  { href: '/tools/routines', label: 'Routine finder', icon: 'clipboard-search-outline', group: 'Calculators', keywords: ['frequency', 'AS 1851'] },

  // -- Forms and records ---------------------------------------------------
  { href: '/work/reports', label: 'Reports', icon: 'file-document-outline', group: 'Forms and records' },
  { href: '/occupier', label: 'Occupier statement', icon: 'file-certificate-outline', group: 'Forms and records', keywords: ['MP 6.1', 'annual'] },
  { href: '/site/form72', label: 'Form 72', icon: 'clipboard-check-outline', group: 'Forms and records', keywords: ['hydrant', 'sprinkler', 'statutory'] },
  { href: '/tools/flow-certificate', label: 'Flow certificate', icon: 'water-check-outline', group: 'Forms and records' },
  { href: '/work/baselines', label: 'Baseline data', icon: 'database-outline', group: 'Forms and records' },
  { href: '/work/labels', label: 'Print labels', icon: 'label-outline', group: 'Forms and records', keywords: ['tag', 'sticker'] },
  { href: '/quotes', label: 'Quotes', icon: 'currency-usd', group: 'Forms and records' },

  // -- Reference -----------------------------------------------------------
  { href: '/library', label: 'Standards library', icon: 'bookshelf', group: 'Reference', keywords: ['AS', 'clause', 'code'] },
  { href: '/library/law', label: 'Queensland law', icon: 'gavel', group: 'Reference', keywords: ['QDC', 'BFSR', 'regulation'] },
  { href: '/ask', label: 'Ask a question', icon: 'comment-question-outline', group: 'Reference', keywords: ['help', 'AI'] },
  { href: '/work/knowledge', label: 'Knowledge', icon: 'lightbulb-on-outline', group: 'Reference', keywords: ['tips', 'how to'] },
  { href: '/tools/defects', label: 'Defect wording', icon: 'format-quote-close', group: 'Reference', keywords: ['codes', 'standard text'] },
  { href: '/import', label: 'Import a file', icon: 'file-import-outline', group: 'Reference', keywords: ['panel', 'config', 'register'] },

  // -- Admin ---------------------------------------------------------------
  { href: '/work/portfolio', label: 'Portfolio', icon: 'chart-box-outline', group: 'Admin', keywords: ['overview', 'manager'] },
  { href: '/work/recurring', label: 'Recurring failures', icon: 'repeat-variant', group: 'Admin' },
  { href: '/work/plan', label: 'Plan work', icon: 'calendar-month-outline', group: 'Admin' },
  { href: '/settings', label: 'Settings', icon: 'cog-outline', group: 'Admin' },
];

export const MODULE_GROUPS: ModuleGroup[] = [
  'Daily', 'Site work', 'Calculators', 'Forms and records', 'Reference', 'Admin',
];

/**
 * What a new install starts with.
 *
 * Six, not twelve. A full grid looks finished and nobody edits a finished
 * thing; a short one that is obviously missing their favourite is what makes
 * someone find the edit button.
 */
export const DEFAULT_SHORTCUTS: string[] = [
  '/work/jobs',
  '/sites',
  '/assets/find',
  '/work/defect/new',
  '/work/timesheets',
  '/tools/resistor',
];

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
export function resolveShortcuts(hrefs: string[]): AppModule[] {
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

/** Case-insensitive search across label, group and keywords. */
export function searchModules(query: string): AppModule[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODULES;
  return MODULES.filter((m) =>
    m.label.toLowerCase().includes(q)
    || m.group.toLowerCase().includes(q)
    || (m.keywords ?? []).some((k) => k.toLowerCase().includes(q)));
}

/** Moves a shortcut one place up or down, for reordering by tap. */
export function moveShortcut(hrefs: string[], href: string, direction: -1 | 1): string[] {
  const i = hrefs.indexOf(href);
  if (i < 0) return hrefs;
  const j = i + direction;
  if (j < 0 || j >= hrefs.length) return hrefs;
  const next = [...hrefs];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function toggleShortcut(hrefs: string[], href: string): string[] {
  return hrefs.includes(href) ? hrefs.filter((h) => h !== href) : [...hrefs, href];
}
