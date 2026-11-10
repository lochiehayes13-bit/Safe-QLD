import type {
  CauseEffectRule, Loop, ParsedConfig, ParsedPanel, Point, Zone,
} from '@/domain/types';
import { normaliseDeviceType } from './deviceType';
import { decodeCp1252, parseTagLine } from './lineTags';

/**
 * Vigilant site files, as written by SmartConfig.
 *
 * One writer serves the whole family, so one reader does too. The panel is
 * named by the root element: `<MX1>` for an MX1, `<F4000-MX4428>` for an F4000
 * or MX4428, `<FP1600>` for an FP1600. Everything below is a flat sequence of
 * self-closing elements, one to a line, all data in attributes, no nesting.
 *
 * Two things will catch a careless reader. The files are Windows-1252, not
 * UTF-8 — 30 of the 44 configuration files the vendor ships publicly fail a
 * strict UTF-8 decode on a curly apostrophe — and they are not valid XML
 * documents in other respects either. Reading a line at a time and decoding
 * 1252 handles both.
 *
 * What this does not do is guess. The vendor's own template files are blank of
 * site data, so they contain no loop devices at all, which means the element
 * that carries them has never been seen here. Rather than invent a name for
 * it, any record type the reader does not recognise is counted and reported by
 * name — so the first real site file says exactly what is missing instead of
 * having its devices silently dropped.
 */

const PARSER_ID = 'vigilant-smartconfig@1';

/** The root element, which is how the file says which panel it is for. */
const ROOTS: Record<string, { model: string; family: 'mx1' | 'f4000' | 'fp1600' }> = {
  MX1: { model: 'MX1', family: 'mx1' },
  'F4000-MX4428': { model: 'F4000 / MX4428', family: 'f4000' },
  FP1600: { model: 'FP1600', family: 'fp1600' },
  IONET: { model: 'IO-NET', family: 'mx1' },
};

/**
 * Record types that carry no site data: profile libraries, tone tables,
 * passwords, printer settings. Skipped silently, so that what is reported as
 * unrecognised is only ever something that might have mattered.
 */
const KNOWN_UNINTERESTING = /^(.*Profiles|Sys_Info|Information|ChangeLog|System2?|Network|Passwords|Instructions|AnalogGlobals|PointDefaults|AlarmTypeText|ZoneGroups|LogicSubstitutions|Hardware)$/;

/**
 * The prefix each panel-side point table gets in a point reference.
 *
 * Spelled out rather than derived from the element name, because the elements
 * are not spelled consistently — `MainboardPoints` but `Equipmentpoints` —
 * and a reference of "EQUIPMENTPOINTS-2.1" is not something to put in front of
 * a technician.
 */
const POINT_TABLE_PREFIX: Record<string, string> = {
  MainboardPoints: 'MB',
  Equipmentpoints: 'EQ',
  PseudoPoints: 'PSEUDO',
  RZDUPoints: 'RZDU',
  KeypadPoints: 'KEYPAD',
  FBPPoints: 'FBP',
};

/** Record types this reader turns into points, zones, loops or logic. */
const HANDLED = new Set([
  'Zones', 'MainboardPoints', 'Equipmentpoints', 'PseudoPoints', 'RZDUPoints',
  'KeypadPoints', 'FBPPoints', 'Circuits', 'Responders', 'Relays',
  'UserLogic', 'SystemLogic', 'AutomaticLogic', 'Logic',
]);

function intOf(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function text(v: string | undefined): string {
  return (v ?? '').trim();
}

/** True when a logic line is a comment rather than an equation. */
function isLogicComment(eqn: string): boolean {
  const t = eqn.trim();
  return t.length === 0 || t.startsWith(';') || t.startsWith('*');
}

export function isVigilant(s: string): boolean {
  // The root element is the first line of every file this tool writes.
  const first = s.slice(0, 200).trimStart().split(/\r?\n/, 1)[0] ?? '';
  const tag = parseTagLine(first);
  return Boolean(tag && !tag.closing && tag.name in ROOTS);
}

export function isVigilantBytes(bytes: Uint8Array): boolean {
  return isVigilant(decodeCp1252(bytes.subarray(0, 200)));
}

export function parseVigilant(source: string, fileName = ''): ParsedConfig {
  const warnings: string[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  const rootTag = parseTagLine(lines.find((l) => l.trim().length > 0) ?? '');
  const root = rootTag && ROOTS[rootTag.name];
  if (!root) {
    throw new Error(
      `${fileName || 'This file'} does not begin with a Vigilant root element ` +
      `(expected one of ${Object.keys(ROOTS).join(', ')}).`,
    );
  }

  let siteName: string | undefined;
  let brandingText: string | undefined;
  let firmware: string | undefined;

  const zones = new Map<number, Omit<Zone, 'id' | 'panelId'>>();
  const points: Omit<Point, 'id' | 'panelId'>[] = [];
  const loops = new Map<number, Omit<Loop, 'id' | 'panelId'>>();
  const causeEffect: Omit<CauseEffectRule, 'id' | 'panelId'>[] = [];
  /** Index -> alarm type, the panel's own device-type vocabulary. */
  const alarmTypes = new Map<number, string>();
  /** $NAME -> what it stands for, so an equation can be read. */
  const substitutions = new Map<string, string>();
  const unrecognised = new Map<string, number>();

  /**
   * Responder cards that are actually installed.
   *
   * A blank template carries a row for all 127 possible responders and gives a
   * Type to none of them; the vendor's one-loop sample gives a Type to exactly
   * one. So the Type is the fitted flag, and without it a site would import as
   * 127 loops of empty circuits.
   */
  const fittedResponders = new Set<number>();
  /** Zones something points at, which is what separates a real zone from a slot. */
  const referencedZones = new Set<number>();

  // ---- First pass: the lookups that later records refer to. --------------
  for (const line of lines) {
    const tag = parseTagLine(line);
    if (!tag || tag.closing) continue;

    if (tag.name === 'Responders') {
      const number = intOf(tag.attrs.Resp);
      if (number !== undefined && text(tag.attrs.Type)) fittedResponders.add(number);
    } else if (tag.name === 'Circuits') {
      const mapped = intOf(tag.attrs.MappedZones);
      if (mapped && mapped > 0) referencedZones.add(mapped);
    } else if (tag.name === 'Zones') {
      // The F4000 family points a zone at its circuit rather than the reverse.
      const number = intOf(tag.attrs.ZoneNo) ?? intOf(tag.attrs.Zone);
      if (number !== undefined && number > 0 && text(tag.attrs.CctRly)) referencedZones.add(number);
    } else if (tag.name === 'AlarmTypeText') {
      const index = intOf(tag.attrs.Index);
      // The values are space-padded to a fixed width in the file.
      if (index !== undefined && text(tag.attrs.AlarmTypeText)) {
        alarmTypes.set(index, text(tag.attrs.AlarmTypeText));
      }
    } else if (tag.name === 'LogicSubstitutions') {
      const name = text(tag.attrs.NewName);
      if (name) substitutions.set(name, text(tag.attrs.Substitutedtext));
    }
  }

  // ---- Second pass: the records themselves. ------------------------------
  for (const line of lines) {
    const tag = parseTagLine(line);
    if (!tag || tag.closing) continue;
    if (tag.name === rootTag!.name) continue;

    switch (tag.name) {
      case 'Sys_Info':
        if (text(tag.attrs.Title)) siteName = text(tag.attrs.Title);
        break;

      case 'System':
        // SystemName is the one the technician sets; Sys_Info's Title is the
        // file's own label and is often left at the template default.
        if (text(tag.attrs.SystemName)) siteName = text(tag.attrs.SystemName);
        if (text(tag.attrs.BrandingText)) brandingText = text(tag.attrs.BrandingText);
        if (text(tag.attrs.Version)) firmware = text(tag.attrs.Version);
        break;

      case 'Hardware': {
        // Loops are declared as an equipment address with a function name.
        const fn = text(tag.attrs.AvailableFunctions) || text(tag.attrs.Function);
        const loopNumber = fn.match(/^MX\s*Loop\s*(\d+)$/i);
        if (loopNumber) {
          const number = Number.parseInt(loopNumber[1]!, 10);
          loops.set(number, { number, label: fn, protocol: 'tyco-mx' });
        }
        break;
      }

      case 'Zones': {
        // MX1 numbers the attribute ZoneNo, the F4000 family Zone.
        const number = intOf(tag.attrs.ZoneNo) ?? intOf(tag.attrs.Zone);
        if (number === undefined || number <= 0) break;
        const name = text(tag.attrs.ZoneName);
        // SmartConfig pre-creates every addressable zone — 999 on an MX1, 528
        // on an F4000 — and leaves them blank. Importing all of them buries
        // the handful the building actually uses.
        if (!name && !referencedZones.has(number)) break;
        zones.set(number, {
          number,
          text: name,
          // The zone's own profile is the closest thing to a type the file has.
          type: text(tag.attrs.ZoneTypeProfile) || undefined,
          text2: text(tag.attrs.Notes) || undefined,
          unused: true,
        });
        break;
      }

      // Panel-side points. Each family names its own table, but they share a
      // shape: an address, a type, a subpoint description and the text the
      // technician typed.
      case 'MainboardPoints':
      case 'Equipmentpoints':
      case 'PseudoPoints':
      case 'RZDUPoints':
      case 'KeypadPoints':
      case 'FBPPoints': {
        const ref = text(tag.attrs.Point);
        const label = text(tag.attrs.PtText);
        const type = text(tag.attrs.Type);
        const subpoint = text(tag.attrs.SubpointDesc);
        // A point with no text is a slot the tool pre-created, not a point.
        // The pseudo-point table alone carries 255 of them, of which a blank
        // template programs one.
        if (!label) break;

        // The address is dotted — "2.1" is subpoint 1 of equipment 2.
        const [equipment, subpointNumber] = ref.split('.');
        points.push({
          address: intOf(equipment),
          subAddress: intOf(subpointNumber),
          pointRef: `${POINT_TABLE_PREFIX[tag.name] ?? tag.name}-${ref || label}`,
          text: label,
          text2: subpoint || undefined,
          deviceTypeRaw: type || undefined,
          // The Type here names a board or a function — "Second Loop Card",
          // "GPIN1" — not a detector, so it is only worth normalising when it
          // actually resolves to something.
          deviceType: normaliseDeviceType(`${type} ${subpoint}`),
          unused: false,
        });
        break;
      }

      case 'Responders': {
        // A responder is a loop or zone card. The ones with no Type are empty
        // slots in the template, not hardware, and importing them would put
        // 126 cards that do not exist into the equipment list.
        const number = intOf(tag.attrs.Resp);
        const type = text(tag.attrs.Type);
        if (number === undefined || !type) break;
        loops.set(number, { number, label: `Responder ${number} (${type})`, protocol: 'tyco-mx' });
        points.push({
          address: number,
          pointRef: `RESP-${number}`,
          text: `Responder ${number} (${type})`,
          deviceTypeRaw: type,
          deviceType: 'unknown',
          unused: false,
        });
        break;
      }

      case 'Circuits': {
        const responder = intOf(tag.attrs.Resp);
        const circuit = intOf(tag.attrs.Circuit);
        // A circuit on a card that is not installed is not a spare address —
        // there is nothing there to be spare.
        if (responder === undefined || circuit === undefined) break;
        if (!fittedResponders.has(responder)) break;
        const mapped = intOf(tag.attrs.MappedZones);
        const attrib = text(tag.attrs.CctAttrib);
        points.push({
          loopNumber: responder,
          address: circuit,
          pointRef: `C${responder}/${circuit}`,
          text: text(tag.attrs.PtText),
          deviceTypeRaw: attrib || undefined,
          deviceType: normaliseDeviceType(attrib),
          zoneNumber: mapped && mapped > 0 ? mapped : undefined,
          // "Disabled" is how the tool marks a circuit that is not in use.
          unused: !attrib || /^disabled$/i.test(attrib),
        });
        break;
      }

      case 'Relays': {
        const responder = intOf(tag.attrs.Resp);
        const relay = intOf(tag.attrs.Relay);
        if (responder === undefined || relay === undefined) break;
        if (!fittedResponders.has(responder)) break;
        points.push({
          loopNumber: responder,
          address: relay,
          pointRef: `R${responder}/${relay}`,
          text: text(tag.attrs.PtText),
          deviceTypeRaw: 'Relay',
          deviceType: 'relay',
          unused: false,
        });
        break;
      }

      // Cause and effect, as equations in the panel's own language.
      case 'UserLogic':
      case 'SystemLogic':
      case 'AutomaticLogic':
      case 'Logic': {
        const eqn = text(tag.attrs.eqn);
        if (isLogicComment(eqn)) break;
        causeEffect.push(logicRule(tag.name, eqn, substitutions));
        break;
      }

      default:
        if (!KNOWN_UNINTERESTING.test(tag.name) && !HANDLED.has(tag.name)) {
          unrecognised.set(tag.name, (unrecognised.get(tag.name) ?? 0) + 1);
        }
        break;
    }
  }

  // ---- Tie it together ---------------------------------------------------
  const usedZones = new Set(points.map((p) => p.zoneNumber).filter((z): z is number => z !== undefined));
  for (const [number, zone] of zones) zone.unused = !usedZones.has(number);
  for (const z of usedZones) {
    if (!zones.has(z)) zones.set(z, { number: z, text: '', unused: false });
  }

  const zoneText = new Map([...zones.values()].map((z) => [z.number, z.text]));
  for (const p of points) {
    if (p.zoneNumber !== undefined) p.zoneText = zoneText.get(p.zoneNumber) || undefined;
  }

  for (const p of points) {
    if (p.loopNumber !== undefined && !loops.has(p.loopNumber)) {
      loops.set(p.loopNumber, { number: p.loopNumber, label: `Loop ${p.loopNumber}` });
    }
  }

  // The important warning. A blank vendor template has no loop devices in it,
  // so the element that carries them has never been seen by this reader. If a
  // real site file has one, saying so is the difference between a known gap
  // and a device list that is quietly missing most of the building.
  if (unrecognised.size) {
    const listed = [...unrecognised]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `<${name}> x${n}`)
      .join(', ');
    warnings.push(
      `This file contains record types this reader does not yet handle, and they were not imported: ` +
      `${listed}. Send the file on and they will be added — nothing has been guessed at.`,
    );
  }

  if (!points.some((p) => !p.unused)) {
    warnings.push(
      'Nothing in this file is configured — every zone is unnamed and every card slot empty. ' +
      'This is a blank SmartConfig template rather than a site.',
    );
  }
  if (alarmTypes.size) {
    warnings.push(
      `The panel's alarm-type vocabulary is ${[...alarmTypes.values()].join(', ')}. ` +
      `Circuit types are recorded verbatim and normalised where they match.`,
    );
  }

  const model = brandingText || root.model;

  const panel: ParsedPanel = {
    name: siteName || fileName || root.model,
    brand: 'vigilant',
    model,
    zones: [...zones.values()].sort((a, b) => a.number - b.number),
    points,
    loops: [...loops.values()].sort((a, b) => a.number - b.number),
    causeEffect,
  };

  return {
    brand: 'vigilant',
    model: firmware ? `${model} ${firmware}` : model,
    siteName,
    panels: [panel],
    warnings,
    parser: PARSER_ID,
  };
}

/**
 * Turns one equation into a matrix row.
 *
 * The language is `OUTPUT = INPUT EXPRESSION`, with `$NAME` standing for a
 * named substitution declared elsewhere in the file. The expression is
 * rendered with those names resolved, and kept verbatim as well — the
 * rendering is a convenience, the equation is the thing that was commissioned.
 */
function logicRule(
  source: string,
  eqn: string,
  substitutions: Map<string, string>,
): Omit<CauseEffectRule, 'id' | 'panelId'> {
  // An equation may carry a trailing comment.
  const withoutComment = eqn.split(/\s+[;*]/, 1)[0]!.trim();
  const equals = withoutComment.indexOf('=');
  const output = equals >= 0 ? withoutComment.slice(0, equals).trim() : '';
  const expression = equals >= 0 ? withoutComment.slice(equals + 1).trim() : withoutComment;

  const resolve = (s: string): string =>
    s.replace(/\$([A-Za-z_][\w]*)/g, (m, name: string) => {
      const value = substitutions.get(`$${name}`) ?? substitutions.get(name);
      return value ? `${m} (${value})` : m;
    });

  return {
    causeLabel: resolve(expression) || withoutComment,
    causeKind: 'other',
    effects: output
      ? [{
          id: `${source}-${output}`,
          effectLabel: resolve(output),
          effectKind: 'other',
          state: 'operates' as const,
        }]
      : [],
    sourceLogic: `${source}: ${eqn}`,
  };
}

/** Reads a Vigilant file from its bytes, decoding Windows-1252. */
export function parseVigilantBytes(bytes: Uint8Array, fileName = ''): ParsedConfig {
  return parseVigilant(decodeCp1252(bytes), fileName);
}
