import { normaliseDeviceType } from './deviceType';
import type {
  CauseEffectRule, CauseKind, DeviceType, EffectKind, ParsedConfig, ParsedPanel, Point, Zone,
} from '@/domain/types';

/**
 * Ampac FireFinder PLUS `.ffp` configuration reader.
 *
 * The format is plain ASCII, tab-separated, LF-terminated, opening with a magic
 * line and a short header block, then a flat list of bracketed sections:
 *
 *   [ <TYPE> <id> <SUB> <index>
 *   ...tab-separated rows...
 *   ]
 *
 * Sections that matter:
 *   P  one per node (panel). id / 10000 is the node number.
 *   M  loop and module data. id = node * 10000 + 100 + loop, so
 *      `90104` is node 9 loop 4. The `X` sub-section with 126 rows is the
 *      addressable loop itself.
 *   Z  the zone table, one row per zone slot.
 *   F  cause and effect. One section per function per slot: slot 1 carries the
 *      function name, the low slots carry causes and the high slots effects.
 *
 * The single most dangerous thing about this format is that zone numbers and
 * device addresses are never written down — they are the row's ordinal position
 * within its section. Filtering out blank rows before assigning that index
 * silently shifts every device after the first gap onto the wrong address, so
 * indices are assigned first and filtering happens afterwards, always.
 */

export const FFP_MAGIC = 'Fire Finder Plus Configuration File';

/**
 * The addressable loop lives in the `X` sub-section at index 2.
 *
 * An `M` id carries three sub-sections: index 1 is the loop's own settings,
 * index 2 is the device table, index 3 is module input/output. Discriminating
 * by index rather than by row count matters — a small loop is still a loop, and
 * counting rows would quietly drop it.
 */
const LOOP_SECTION_SUB = 'X';
const LOOP_SECTION_INDEX = 2;

/** Module I/O rows label their channel in the second column, e.g. "I1", "O2". */
const MODULE_CHANNEL = /^[IO]\d+$/;

/** Slot ranges within an F function. */
const CAUSE_SLOT_MIN = 10;
const CAUSE_SLOT_MAX = 15;
const EFFECT_SLOT_MIN = 40;
const EFFECT_SLOT_MAX = 55;

export interface FfpSection {
  type: string;
  id: number;
  sub: string;
  index: number;
  rows: string[][];
}

export interface FfpHeader {
  fileVersion?: string;
  project?: string;
  date?: string;
  configurationVersion?: string;
  configManagerVersion?: string;
}

export function isFfp(text: string): boolean {
  return text.slice(0, 200).includes(FFP_MAGIC);
}

/**
 * Splits the file into sections.
 *
 * Rows keep their empty trailing fields — the column count is meaningful and a
 * trimmed row misaligns everything after it.
 */
export function parseSections(text: string): { header: FfpHeader; sections: FfpSection[] } {
  const header: FfpHeader = {};
  const sections: FfpSection[] = [];
  let current: FfpSection | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (current === null) {
      if (line.startsWith('[')) {
        current = openSection(line);
        continue;
      }
      // Header lines only appear before the first section.
      const colon = line.indexOf(':');
      if (colon > 0) {
        const key = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (key === 'file version') header.fileVersion = value;
        else if (key === 'project') header.project = value;
        else if (key === 'date') header.date = value;
        else if (key === 'configuration version') header.configurationVersion = value;
        else if (key === 'configmanagerplus version') header.configManagerVersion = value;
      }
      continue;
    }

    if (line.startsWith(']')) {
      sections.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('[')) {
      // An unterminated section: close it rather than swallowing the next one.
      sections.push(current);
      current = openSection(line);
      continue;
    }
    current.rows.push(line.split('\t'));
  }

  if (current) sections.push(current);
  return { header, sections };
}

function openSection(line: string): FfpSection {
  // "[ M 10101 X 2" — the parts are space separated in the header only.
  const parts = line.slice(1).trim().split(/\s+/);
  return {
    type: parts[0] ?? '',
    id: Number.parseInt(parts[1] ?? '0', 10) || 0,
    sub: parts[2] ?? '',
    index: Number.parseInt(parts[3] ?? '0', 10) || 0,
    rows: [],
  };
}

/** Node number from a P or M section id. */
export function nodeOf(id: number): number {
  return Math.floor(id / 10000);
}

/** Loop number from an M section id, or null where the id is not a loop. */
export function loopOf(id: number): number | null {
  const remainder = id % 10000;
  // Loop ids are 100 + loop number; anything else is a module or option board.
  if (remainder <= 100 || remainder >= 200) return null;
  return remainder - 100;
}

const cell = (row: string[] | undefined, i: number): string => (row?.[i] ?? '').trim();

/**
 * Expands an Ampac device type token.
 *
 * Only tokens actually observed in real configurations are mapped. Anything
 * else keeps its raw token rather than being guessed at — a wrong expansion on
 * a test sheet is worse than an unfamiliar abbreviation.
 */
const DEVICE_TOKENS: Record<string, string> = {
  OPT: 'Optical smoke detector',
  DMULTI: 'Multisensor detector',
  HEAT: 'Heat detector',
  MCP: 'Manual call point',
  SOUND: 'Sounder',
  SIGN: 'Exit sign interface',
  MECH: 'Mechanical plant interface',
  'MECH D': 'Mechanical damper interface',
  SPRINK: 'Sprinkler interface',
  HYD: 'Hydrant interface',
  DOOR: 'Door interface',
  MDH: 'Magnetic door holder',
  VM: 'Valve monitor',
  SEC: 'Security interface',
  GAS: 'Gas interface',
  PUMP: 'Pump interface',
  ESCA: 'Escalator interface',
  CURTIN: 'Fire curtain interface',
  ROLLER: 'Roller shutter interface',
  ANSUL: 'Ansul suppression interface',
  INOUT: 'Input / output module',
  MASDS: 'Aspirating detector interface',
  'PRE AC': 'Pre-action interface',
};

export function expandDeviceToken(token: string): string | undefined {
  return DEVICE_TOKENS[token.trim().toUpperCase()];
}

/**
 * Ampac tokens mapped straight to a device class.
 *
 * The English expansion above is for display. Mapping the class directly rather
 * than round-tripping the expanded text through the generic normaliser is what
 * keeps the interface types — the plant, sprinkler and hydrant monitors that
 * make up a fifth of a real site — out of "unknown".
 */
const TOKEN_DEVICE_TYPE: Record<string, DeviceType> = {
  OPT: 'smoke-photo',
  DMULTI: 'multi',
  HEAT: 'heat',
  MCP: 'mcp',
  SOUND: 'sounder',
  MASDS: 'aspirating',
  GAS: 'gas',
  ANSUL: 'gas',
  VM: 'sprinkler-valve',
  SPRINK: 'sprinkler-flow',
  MDH: 'door-holder',
  DOOR: 'module-io',
  SIGN: 'module-output',
  MECH: 'module-output',
  'MECH D': 'module-output',
  ESCA: 'module-output',
  CURTIN: 'module-output',
  ROLLER: 'module-output',
  HYD: 'module-input',
  SEC: 'module-input',
  PUMP: 'module-input',
  INOUT: 'module-io',
  'PRE AC': 'module-io',
  'C/S': 'module-io',
};

export function deviceTypeForToken(token: string): DeviceType {
  const key = token.trim().toUpperCase();
  return TOKEN_DEVICE_TYPE[key] ?? normaliseDeviceType(DEVICE_TOKENS[key] ?? token);
}

export interface FfpParseOptions {
  /** Keep unpopulated address slots. Off by default, matching panel display. */
  includeUnused?: boolean;
}

/**
 * Reads a `.ffp` file into the app's panel-agnostic shapes.
 *
 * A large networked site produces tens of thousands of points, so this walks
 * the sections once and builds arrays directly rather than repeatedly scanning.
 */
export function parseFfp(text: string, options: FfpParseOptions = {}): ParsedConfig {
  const { header, sections } = parseSections(text);
  const warnings: string[] = [];

  if (!isFfp(text)) {
    warnings.push('This file does not carry the FireFinder PLUS header line, so it may not be a .ffp configuration.');
  }

  // Zone table: the row's position is the zone number.
  const zoneText = new Map<number, string>();
  const zones: Omit<Zone, 'id' | 'panelId'>[] = [];
  const zoneSection = sections.find((s) => s.type === 'Z');
  if (zoneSection) {
    zoneSection.rows.forEach((row, i) => {
      const number = i + 1;
      const inUse = cell(row, 0).toUpperCase() === 'Y';
      const text2 = cell(row, 1);
      if (text2) zoneText.set(number, text2);
      // Ampac marks a slot in use even when the text is blank, so a zone counts
      // as used only when it has both.
      const unused = !inUse || !text2;
      if (!unused || options.includeUnused) {
        zones.push({ number, text: text2, unused });
      }
    });
  } else {
    warnings.push('No zone table was found in this file.');
  }

  // Node names, so panels come out labelled rather than numbered.
  const nodeNames = new Map<number, string>();
  let siteFromPanel: string | undefined;
  for (const s of sections.filter((x) => x.type === 'P')) {
    const node = nodeOf(s.id);
    const name = cell(s.rows[0], 0);
    if (node > 0 && name) nodeNames.set(node, name);
    // Node 1's second row carries the site and servicing company.
    if (node === 1 && !siteFromPanel) {
      const candidate = cell(s.rows[1], 0);
      if (candidate) siteFromPanel = candidate;
    }
  }

  // ConfigManager seeds "NewProject" and it is frequently left alone, so the
  // panel's own site line is the better name when the header is still default.
  const projectName = header.project?.trim();
  const siteName =
    projectName && projectName.toLowerCase() !== 'newproject' ? projectName : (siteFromPanel ?? projectName);

  // Loop devices.
  const points: Omit<Point, 'id' | 'panelId'>[] = [];
  const loopNumbers = new Set<number>();
  let populated = 0;

  for (const s of sections) {
    if (s.type !== 'M' || s.sub !== LOOP_SECTION_SUB || s.index !== LOOP_SECTION_INDEX) continue;
    const loop = loopOf(s.id);
    if (loop === null) continue;
    // Guard against a module table appearing at this index on some firmware.
    if (s.rows.some((r) => MODULE_CHANNEL.test((r[1] ?? '').trim()))) continue;

    const node = nodeOf(s.id);
    loopNumbers.add(loop);

    s.rows.forEach((row, i) => {
      // Address is the ordinal position. Assigned before any filtering, always.
      const address = i + 1;
      const zoneNumber = Number.parseInt(cell(row, 0), 10) || 0;
      const text2 = cell(row, 1);
      const model = cell(row, 2);
      const token = cell(row, 3);

      const unused = !text2 || text2.toUpperCase() === 'UNASSIGNED TEXT';
      if (unused && !options.includeUnused) return;
      if (!unused) populated++;

      points.push({
        loopNumber: loop,
        address,
        pointRef: `N${node}L${loop}P${String(address).padStart(3, '0')}`,
        text: text2,
        text2: expandDeviceToken(token),
        deviceTypeRaw: [model, token].filter(Boolean).join(' '),
        deviceType: deviceTypeForToken(token),
        zoneNumber: zoneNumber || undefined,
        zoneText: zoneNumber ? zoneText.get(zoneNumber) : undefined,
        unused,
      });
    });
  }

  if (!points.length) warnings.push('No loop devices were found. The file may only contain panel settings.');

  const causeEffect = parseCauseEffect(sections, zoneText, warnings);

  const panel: ParsedPanel = {
    name: nodeNames.get(1) || siteName || 'FireFinder PLUS',
    brand: 'ampac',
    model: 'FireFinder PLUS',
    zones,
    points,
    loops: [...loopNumbers].sort((a, b) => a - b).map((number) => ({ number })),
    causeEffect,
  };

  const nodeCount = nodeNames.size;
  if (nodeCount > 1) {
    warnings.push(
      `${nodeCount} panels are networked in this configuration. All ${populated.toLocaleString()} devices have been imported under one panel record, with the node number carried in each point reference.`,
    );
  }

  return {
    brand: 'ampac',
    model: 'FireFinder PLUS',
    siteName: siteName || undefined,
    panels: [panel],
    warnings,
    parser: 'ampac-ffp@1',
  };
}

/**
 * Cause-and-effect functions.
 *
 * Each function is spread across sections sharing an id: slot 1 holds the name,
 * low slots hold causes and high slots hold effects. Operand prefixes are
 * recorded verbatim — no vendor documentation defines them, so the raw token is
 * always kept and only the ones observable from context are expanded.
 */
function parseCauseEffect(
  sections: FfpSection[],
  zoneText: Map<number, string>,
  warnings: string[],
): Omit<CauseEffectRule, 'id' | 'panelId'>[] {
  interface Fn { name?: string; causes: { token: string; value: number }[]; effects: { token: string; value: number }[] }
  const functions = new Map<number, Fn>();

  for (const s of sections) {
    if (s.type !== 'F') continue;
    const row = s.rows[0];
    if (!row) continue;

    const fn = functions.get(s.id) ?? { causes: [], effects: [] };

    if (s.index === 1) {
      const name = cell(row, 0);
      if (name) fn.name = name;
    } else if (s.index >= CAUSE_SLOT_MIN && s.index <= CAUSE_SLOT_MAX) {
      const token = cell(row, 0);
      const value = Number.parseInt(cell(row, 1), 10);
      if (token && Number.isFinite(value)) fn.causes.push({ token, value });
    } else if (s.index >= EFFECT_SLOT_MIN && s.index <= EFFECT_SLOT_MAX) {
      const token = cell(row, 0);
      const value = Number.parseInt(cell(row, 1), 10);
      if (token && Number.isFinite(value)) fn.effects.push({ token, value });
    }

    functions.set(s.id, fn);
  }

  const rules: Omit<CauseEffectRule, 'id' | 'panelId'>[] = [];
  let unknownTokens = new Set<string>();

  for (const [id, fn] of functions) {
    if (!fn.causes.length && !fn.effects.length) continue;

    for (const cause of fn.causes) {
      const kind = causeKindFor(cause.token);
      if (kind === null) unknownTokens.add(cause.token);
      const zoneNumber = cause.token.toUpperCase() === 'Z' ? cause.value : undefined;

      rules.push({
        causeLabel: [
          fn.name ?? `Function ${id}`,
          zoneNumber ? `Zone ${zoneNumber}${zoneText.get(zoneNumber) ? ` — ${zoneText.get(zoneNumber)}` : ''}` : `${cause.token} ${cause.value}`,
        ].join(' · '),
        causeKind: kind ?? 'other',
        causeZoneNumber: zoneNumber,
        sourceLogic: `${cause.token} ${cause.value}`,
        effects: fn.effects.map((e, i) => ({
          id: `${id}-${i}`,
          effectLabel: `${e.token} ${e.value}`,
          effectKind: effectKindFor(e.token) ?? 'other',
          state: 'operates' as const,
        })),
      });
    }
  }

  if (unknownTokens.size) {
    warnings.push(
      `Cause and effect operands ${[...unknownTokens].sort().join(', ')} are shown as recorded — no manufacturer documentation defines them, so they have not been expanded.`,
    );
  }

  return rules;
}

/** Only the token whose meaning is observable from the data is mapped. */
function causeKindFor(token: string): CauseKind | null {
  return token.toUpperCase() === 'Z' ? 'zone-alarm' : null;
}

function effectKindFor(_token: string): EffectKind | null {
  return null;
}
