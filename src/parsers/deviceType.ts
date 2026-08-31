import type { DeviceType } from '@/domain/types';

/**
 * Normalises the free-text device type strings that panels use into the app's
 * DeviceType enum.
 *
 * Every vendor spells these differently — "PHOTO", "Optical", "SMOKE (PHOTO)",
 * "ION", "MCP", "CALL POINT", "BGA". Normalising once here means filtering,
 * test sheets, icons and exports all behave consistently regardless of which
 * panel the data came from. The raw string is always preserved alongside, so
 * nothing is lost when a mapping is wrong.
 */

interface Rule {
  type: DeviceType;
  /** Matched against the uppercased, punctuation-stripped type string. */
  patterns: RegExp[];
}

// Order matters: the most specific rules run first.
const RULES: Rule[] = [
  { type: 'sounder-strobe', patterns: [/\bSOUNDER\s*(BEACON|STROBE|VAD)\b/, /\bSND\s*STR\b/, /\bCOMBI\b/] },
  { type: 'strobe', patterns: [/\bSTROBE\b/, /\bBEACON\b/, /\bVAD\b/, /\bVISUAL\s*ALARM\b/] },
  { type: 'sounder', patterns: [/\bSOUNDER\b/, /\bSND\b/, /\bBELL\b/, /\bHORN\b/, /\bWARNING\s*DEVICE\b/, /\bALARM\s*DEVICE\b/] },
  { type: 'mcp', patterns: [/\bMCP\b/, /\bCALL\s*POINT\b/, /\bMANUAL\s*(CALL|STATION|ALARM)\b/, /\bBGA\b/, /\bBREAK\s*GLASS\b/, /\bPULL\s*STATION\b/] },
  { type: 'aspirating', patterns: [/\bVESDA\b/, /\bASPIRAT/, /\bASD\b/, /\bLASER\s*(PLUS|FOCUS|SCANNER)\b/, /\bICAM\b/] },
  { type: 'beam', patterns: [/\bBEAM\b/, /\bREFLECT/, /\bFIRERAY\b/] },
  { type: 'duct', patterns: [/\bDUCT\b/, /\bAIR\s*DUCT\b/, /\bSAMPLING\s*DUCT\b/] },
  { type: 'flame', patterns: [/\bFLAME\b/, /\bUV\s*IR\b/, /\bINFRA\s*RED\s*FLAME\b/] },
  { type: 'multi', patterns: [/\bMULTI\s*(CRITERIA|SENSOR)\b/, /\bMULTISENSOR\b/, /\bCOMBINED\s*(SMOKE|OPTICAL)\b/, /\bOPTICAL\s*HEAT\b/, /\bSMOKE\s*HEAT\b/, /\bMULTI\b/] },
  { type: 'smoke-ion', patterns: [/\bION(I[SZ]ATION)?\b/, /\bIONISATION\b/, /\bIONIZATION\b/] },
  { type: 'smoke-photo', patterns: [/\bPHOTO(ELECTRIC)?\b/, /\bOPTICAL\b/, /\bPE\s*SMOKE\b/] },
  { type: 'heat', patterns: [/\bHEAT\b/, /\bTHERMAL\b/, /\bTEMP(ERATURE)?\b/, /\bROR\b/, /\bRATE\s*OF\s*RISE\b/, /\bFIXED\s*TEMP\b/] },
  { type: 'smoke', patterns: [/\bSMOKE\b/, /\bSMK\b/] },
  { type: 'sprinkler-flow', patterns: [/\bFLOW\s*SW/, /\bFLOWSWITCH\b/, /\bWATER\s*FLOW\b/, /\bSPRINKLER\s*FLOW\b/, /\bALARM\s*VALVE\b/] },
  { type: 'sprinkler-valve', patterns: [/\bVALVE\s*MON/, /\bTAMPER\b/, /\bISOLATION\s*VALVE\b/, /\bSTOP\s*VALVE\b/, /\bOS\s*&?\s*Y\b/] },
  { type: 'gas', patterns: [/\bGAS\b/, /\bCO\b(?!MMS)/, /\bCARBON\s*MONOXIDE\b/, /\bLPG\b/] },
  { type: 'wip', patterns: [/\bWIP\b/, /\bWARDEN\s*(PHONE|INTERCOM)\b/, /\bEWIS\s*PHONE\b/] },
  { type: 'door-holder', patterns: [/\bDOOR\s*(HOLDER|RELEASE|MAG)\b/, /\bMAG\s*DOOR\b/, /\bMAGNET\b/] },
  { type: 'isolator', patterns: [/\bISOLATOR\b/, /\bSHORT\s*CIRCUIT\s*ISOLATOR\b/, /\bSCI\b/] },
  { type: 'relay', patterns: [/\bRELAY\b/, /\bRLY\b/] },
  { type: 'module-io', patterns: [/\bI\/?O\s*(MODULE|UNIT)\b/, /\bINPUT\s*OUTPUT\b/, /\bIOM\b/] },
  { type: 'module-output', patterns: [/\bOUTPUT\s*(MODULE|UNIT)\b/, /\bCONTROL\s*MODULE\b/, /\bSUPERVISED\s*OUTPUT\b/, /\bSIGNAL\s*MODULE\b/] },
  { type: 'module-input', patterns: [/\bINPUT\s*(MODULE|UNIT)\b/, /\bMONITOR\s*MODULE\b/, /\bMINI\s*MONITOR\b/, /\bCONTACT\s*MODULE\b/, /\bZONE\s*MONITOR\b/] },
];

const CACHE = new Map<string, DeviceType>();

/** Maps a raw vendor device-type string to a normalised DeviceType. */
export function normaliseDeviceType(raw: string | undefined | null): DeviceType {
  if (!raw) return 'unknown';
  const key = raw.trim();
  if (!key) return 'unknown';

  const cached = CACHE.get(key);
  if (cached) return cached;

  // Uppercase and turn separators into spaces so \b anchors behave.
  const s = ` ${key.toUpperCase().replace(/[^A-Z0-9&/]+/g, ' ').trim()} `;

  let result: DeviceType = 'unknown';
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(s))) {
      result = rule.type;
      break;
    }
  }

  CACHE.set(key, result);
  return result;
}

/** Short label for UI chips and export columns. */
export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  smoke: 'Smoke',
  'smoke-photo': 'Smoke (Photo)',
  'smoke-ion': 'Smoke (Ion)',
  heat: 'Heat',
  multi: 'Multisensor',
  beam: 'Beam',
  aspirating: 'Aspirating',
  flame: 'Flame',
  duct: 'Duct',
  mcp: 'MCP',
  sounder: 'Sounder',
  'sounder-strobe': 'Sounder/Strobe',
  strobe: 'Strobe',
  'module-input': 'Input module',
  'module-output': 'Output module',
  'module-io': 'I/O module',
  relay: 'Relay',
  isolator: 'Isolator',
  'sprinkler-flow': 'Flow switch',
  'sprinkler-valve': 'Valve monitor',
  gas: 'Gas',
  wip: 'WIP',
  'door-holder': 'Door holder',
  unknown: 'Unknown',
};

/**
 * Default test method for a device class.
 *
 * Pre-filling the method column saves a tech a tap per device on a sheet that
 * can run to hundreds of rows; it stays editable because site practice varies.
 */
export const DEFAULT_TEST_METHOD: Partial<Record<DeviceType, string>> = {
  smoke: 'Smoke aerosol',
  'smoke-photo': 'Smoke aerosol',
  'smoke-ion': 'Smoke aerosol',
  multi: 'Smoke aerosol + heat',
  heat: 'Heat source',
  duct: 'Smoke aerosol',
  beam: 'Beam obscuration',
  aspirating: 'Smoke test at sampling point',
  flame: 'Flame simulator',
  mcp: 'Operate call point',
  sounder: 'Audible check',
  'sounder-strobe': 'Audible + visual check',
  strobe: 'Visual check',
  'sprinkler-flow': 'Test valve flow',
  'sprinkler-valve': 'Operate tamper switch',
  'module-input': 'Operate input',
  'module-output': 'Verify output operates',
  'module-io': 'Operate input + verify output',
  relay: 'Verify relay operates',
  isolator: 'Verify isolation',
  gas: 'Test gas applied',
  wip: 'Handset call test',
  'door-holder': 'Verify release on alarm',
};

/** Device classes that are outputs rather than initiating devices. */
export function isOutputDevice(t: DeviceType): boolean {
  return t === 'sounder' || t === 'sounder-strobe' || t === 'strobe' ||
    t === 'module-output' || t === 'relay' || t === 'door-holder';
}
