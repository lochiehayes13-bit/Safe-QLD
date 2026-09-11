import type {
  CauseEffectRule, DeviceType, Loop, ParsedConfig, ParsedPanel, Point, Zone,
} from '@/domain/types';
import { normaliseDeviceType } from './deviceType';
import { effectKindFromLabel } from './effectKind';
import { ZipError, isZip, readZip } from './zipRead';

/**
 * Pertronic F-series site files (.util).
 *
 * The .util is a zip; the configuration inside is a text file named after the
 * site, and it is unusually pleasant to read — one record per line, each a
 * keyword followed by `key:value` pairs, values quoted where they contain
 * spaces.
 *
 * The one trap is that the file holds the configuration twice. After the live
 * config comes a banner reading "Start of Reference Panel Config" and then a
 * second copy: what the tool last read back off the panel. Parsing straight
 * through would double every device and zone, and the duplicates would look
 * entirely legitimate. So the reference section is found and stopped at.
 */

const PARSER_ID = 'pertronic-util@1';

/** Everything after this banner is the panel's last-read-back state, not the config. */
const REFERENCE_BANNER = /Start of Reference Panel Config/i;

/**
 * The panel's device type vocabulary.
 *
 * `TYPE:` in a device record carries a short mnemonic, and FireUtils shows the
 * same mnemonics in its Device Type Selector with a caption under each one.
 * Those captions are the authority here, so both halves are recorded: the
 * vendor's own name for the device, and the class it maps to.
 *
 * Keeping the name matters even where the class is unknown. "MS12" on a
 * service sheet tells a technician nothing; "MS12 (M210E-CZR)" tells them
 * which module to go and look at. So an unmapped code is still better
 * described than it was.
 *
 * `type: 'unknown'` is a deliberate answer, not a gap to be filled in later.
 * The class drives the default test method, and a wrong one is worse than
 * none — a technician handed "smoke aerosol" against a plant interface has
 * been told something false about the building.
 */
interface TypeCode {
  /** FireUtils' own caption for this device. */
  name: string;
  type: DeviceType;
}

const TYPE_CODES: Record<string, TypeCode> = {
  // --- Detectors -------------------------------------------------------
  // The Australian Detectors tab labels its icons with single letters rather
  // than codes, so these come from the Loop Editor's Type column and the panel
  // LCD rather than from the picker. Five captions on that tab — Ionisation,
  // Filtrex, Beam, FAAST, OMNI — have no code anyone has seen, and are
  // deliberately absent: a guessed key would shadow the unrecognised-code path
  // that would otherwise report them.
  OPT: { name: 'Optical smoke detector', type: 'smoke-photo' },
  // One code covers fixed-temperature and rate-of-rise heads, and the alarm
  // point lives in the sensitivity field rather than here, so neither the grade
  // nor the temperature is recoverable from the type alone.
  HEAT: { name: 'Heat detector (fixed or rate-of-rise)', type: 'heat' },
  ACCL: { name: 'Acclimate multi-criteria detector', type: 'multi' },
  // A high-sensitivity point detector, tested with aerosol at the head. Not
  // aspirating, despite the sensitivity — there is no sampling pipe to test.
  LASR: { name: 'Laser high-sensitivity smoke detector', type: 'smoke-photo' },
  PTIR: { name: 'Photo/thermal infra-red multi-criteria detector', type: 'multi' },

  // --- Input modules, as captioned in the Device Type Selector ---------
  MCP: { name: 'Manual Callpoint', type: 'mcp' },
  // Four flavours of the same thing: a monitored switch. The suffix says how
  // the panel presents it, not what is wired to it.
  SW: { name: 'Switch Input', type: 'module-input' },
  SW3: { name: 'Switch Input (3-way)', type: 'module-input' },
  SW_H: { name: 'Switch Input (Hidden)', type: 'module-input' },
  // Captioned "Switch Input (Disable)": an input that disables the zone it is
  // assigned to. Emphatically not a loop isolator, which is what 'isolator'
  // means in this app — nothing in this vocabulary maps to that class.
  ISO: { name: 'Switch Input (Disable)', type: 'module-input' },
  MON: { name: 'Monitor', type: 'module-input' },
  ZMU: { name: 'Zone Monitor Unit', type: 'module-input' },
  // The picker shows a channel count in front of this whose spelling is not
  // legible, so only the bare mnemonic is claimed and a variant falls through
  // to unrecognised. Its class is unsettled too: the responder carries relay
  // outputs as well as inputs, so module-io may be the better answer once a
  // real file shows the key.
  LPRS: { name: 'Loop Responder', type: 'module-input' },
  SPR: { name: 'Sprinkler Input', type: 'sprinkler-flow' },
  FSW: { name: 'Flow Switch', type: 'sprinkler-flow' },
  // Deliberately not sprinkler-flow. The file never says which pressure: a
  // sprinkler alarm line, a pump start and dry-system air are written
  // identically and are not tested the same way, so "operate input" is the
  // only honest default.
  PSW: { name: 'Pressure Switch', type: 'module-input' },
  VMD: { name: 'Valve Monitor', type: 'sprinkler-valve' },
  BMIF: { name: 'Beam Interface', type: 'beam' },
  VES: { name: 'VESDA', type: 'aspirating' },
  // Input-shaped on purpose: "operate input" is honest against a plant or
  // sub-panel interface, where a smoke-aerosol instruction would be false.
  SIP: { name: 'Sub-Indicator Panel', type: 'module-input' },
  PLNT: { name: 'Plant', type: 'module-input' },
  // Fan control takes a status input and drives the fan, so it is both.
  FANC: { name: 'Fan Controller', type: 'module-io' },
  FCSU: { name: 'Fan Control Switch Unit', type: 'module-io' },

  // --- Output modules --------------------------------------------------
  // "Ancillary Control Function" is Pertronic's own wording; "Facility" appears
  // nowhere in their documents.
  ACF: { name: 'Ancillary Control Function output', type: 'module-output' },
  ACFM: { name: 'Ancillary Control Function output, monitored', type: 'module-output' },
  // The trailing M is Monitored — line-supervised — not Module.
  RLYM: { name: 'Relay output, monitored', type: 'relay' },
  RLY: { name: 'Relay output', type: 'relay' },
  DHR: { name: 'Door Holder Relay', type: 'door-holder' },
  // A warning device, but not which kind. The description decides where it is
  // specific; where it is not, sounder-strobe is wrong less often than sounder,
  // because every one of these in a real file was a strobe.
  WRN: { name: 'Warning device output', type: 'sounder-strobe' },
  WRNM: { name: 'Warning device output, monitored', type: 'sounder-strobe' },

  // --- The US codeset ---------------------------------------------------
  // Carried so a US-configured panel parses rather than warning on every row.
  // Not merged with their Australian counterparts: different hardware families,
  // and neither codeset's strings appear in the other's documents.
  PHO: { name: 'Photoelectric smoke detector (US)', type: 'smoke-photo' },
  HPHO: { name: 'High-sensitivity photoelectric detector (US)', type: 'smoke-photo' },
  MPS: { name: 'Manual Pull Station (US)', type: 'mcp' },
  WFL: { name: 'Waterflow Input (US)', type: 'sprinkler-flow' },
  RLYS: { name: 'Relay, supervised (US)', type: 'relay' },
  NAC: { name: 'NAC relay (US)', type: 'relay' },
  NACS: { name: 'NAC relay, supervised (US)', type: 'relay' },
  DHRS: { name: 'Door Holder, supervised (US)', type: 'door-holder' },
  AUXS: { name: 'Aux relay, supervised (US)', type: 'relay' },
  // AUX alone is genuinely ambiguous: the US output table has it as a relay and
  // the input-module table has it against a two-input module, so the same
  // string means an input there. Left unclassed rather than picked.
  AUX: { name: 'Aux relay or two-input module (US)', type: 'unknown' },

  // --- Named by part number, so the class is not claimed ----------------
  MS12: { name: 'M210E-CZR (M512)', type: 'unknown' },
  M512: { name: 'M210E-CZR (M512)', type: 'unknown' },
  M500DMR: { name: 'M500DMR', type: 'unknown' },
  M221E: { name: 'M221E', type: 'unknown' },
};

/**
 * A virtual detector is a second personality on a head that is already there.
 *
 * The panel writes it with a lower-case v in front of its parent's code, and it
 * sits at the parent's address plus one. There is no separate device: nothing
 * to put a hand on and nothing to test on its own, so it carries its parent's
 * class and says what it is.
 *
 * The lower case matters — a check written against an upper-cased code would
 * never fire, and the point would import as an unrecognised type.
 */
const VIRTUAL_PREFIX = /^v([A-Z][A-Z0-9_]*)$/;

export function virtualParentCode(rawCode: string): string | undefined {
  const m = rawCode.match(VIRTUAL_PREFIX);
  return m ? m[1] : undefined;
}

/** Codes whose description is a better guide than the code itself. */
const DESCRIPTION_WINS = new Set(['WRN']);

interface Record_ {
  /** The bit before the "=", e.g. "L01D001", "Z003", "LB001", "SITEINFO". */
  key: string;
  fields: Map<string, string>;
  raw: string;
}

/**
 * Splits a record body into its key:value pairs.
 *
 * Values are either quoted or run to the next space, and an empty value is
 * meaningful — `Out:` with nothing after it is how the panel says an input
 * drives no output, which is different from the field being absent.
 *
 * Note there is deliberately no whitespace allowed around the colon. Permit it
 * and an empty field reaches across the gap and eats the next one: `Out: AAF:0`
 * reads as an output called "AAF:0", so every unconnected detector in the file
 * appears to drive a plant shutdown. It is a quiet failure — the records still
 * parse, they are just wrong.
 */
export function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const re = /([A-Za-z_][A-Za-z0-9_]*):("[^"]*"|[^\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const value = m[2]!;
    fields.set(m[1]!, value.startsWith('"') ? value.slice(1, -1) : value);
  }
  return fields;
}

export function isPertronicUtilText(text: string): boolean {
  const head = text.slice(0, 500);
  return /^Panel:\s*\S+/m.test(head) && /^Target:/m.test(head) && /^(OPTIONS|SITEINFO)=/m.test(text.slice(0, 5000));
}

/** True for the zip wrapper, which is what a technician actually picks. */
export function isPertronicUtil(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  try {
    return readZip(bytes).some((e) => e.name.endsWith('.txt') && e.bytes.length > 0
      && isPertronicUtilText(new TextDecoder('utf-8').decode(e.bytes.subarray(0, 500))));
  } catch {
    return false;
  }
}

/** Pulls the configuration text out of the .util archive. */
export function unwrapPertronicUtil(bytes: Uint8Array): { name: string; text: string } {
  const entries = readZip(bytes);
  const decode = (b: Uint8Array): string =>
    typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(b) : String.fromCharCode(...b);

  const candidates = entries
    .filter((e) => e.name.toLowerCase().endsWith('.txt') && e.bytes.length > 0)
    .sort((a, b) => b.bytes.length - a.bytes.length);

  for (const entry of candidates) {
    const text = decode(entry.bytes);
    if (isPertronicUtilText(text)) return { name: entry.name, text };
  }
  throw new ZipError(
    'This .util archive has no Pertronic panel configuration in it — expected a .txt entry beginning "Panel:".',
  );
}

/** The loop and address in a key like `L01D001` or `L02M64`. */
function loopAddress(key: string): { loop: number; kind: 'D' | 'M'; address: number } | undefined {
  const m = key.match(/^L(\d+)([DM])(\d+)$/);
  if (!m) return undefined;
  return { loop: Number.parseInt(m[1]!, 10), kind: m[2] as 'D' | 'M', address: Number.parseInt(m[3]!, 10) };
}

/**
 * Rewrites a loop reference into the form the device records use.
 *
 * The file is inconsistent with itself: a device is defined as `L01M001` but
 * referred to from a logic block as `L01M21`. Left alone, every effect in the
 * matrix points at a device reference that exists nowhere in the point list —
 * and since both spellings look perfectly reasonable, nothing flags it.
 */
export function canonicalRef(ref: string): string {
  const m = ref.match(/^L(\d+)([DM])(\d+)$/i);
  if (!m) return ref;
  return `L${m[1]!.padStart(2, '0')}${m[2]!.toUpperCase()}${m[3]!.padStart(3, '0')}`;
}

/** Splits an `Out:` or `In:` list, which is comma-separated. */
function refList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => canonicalRef(s.trim())).filter(Boolean);
}

export function parsePertronicUtilText(text: string, fileName = ''): ParsedConfig {
  const warnings: string[] = [];
  const allLines = text.split(/\r\n|\r|\n/);

  // Stop at the reference copy. Without this every device appears twice.
  const referenceAt = allLines.findIndex((l) => REFERENCE_BANNER.test(l));
  const lines = referenceAt >= 0 ? allLines.slice(0, referenceAt) : allLines;
  if (referenceAt < 0) {
    warnings.push('No reference-config banner found; the whole file was read as the live configuration.');
  }

  let panelModel: string | undefined;
  let firmware: string | undefined;

  const records: Record_[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^[-+]{5,}/.test(trimmed)) continue;

    // The first few lines are `Key: value` rather than `Key=fields`.
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      const colon = trimmed.indexOf(':');
      if (colon < 0) continue;
      const name = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim();
      if (name === 'Panel') panelModel = value;
      else if (name === 'Target') firmware = value;
      continue;
    }
    records.push({ key: trimmed.slice(0, eq).trim(), fields: parseFields(trimmed.slice(eq + 1)), raw: trimmed });
  }

  const byKey = new Map<string, Record_>();
  for (const r of records) if (!byKey.has(r.key)) byKey.set(r.key, r);

  const siteName = byKey.get('SITEINFO')?.fields.get('Name')?.trim() || undefined;

  // ---- Loops -------------------------------------------------------------
  const loops = new Map<number, Omit<Loop, 'id' | 'panelId'>>();
  for (const r of records) {
    const m = r.key.match(/^Loop0*(\d+)$/);
    if (!m) continue;
    const number = Number.parseInt(m[1]!, 10);
    loops.set(number, { number, label: r.fields.get('DESC')?.trim() || `Loop ${number}` });
  }

  // ---- Zones -------------------------------------------------------------
  const zones = new Map<number, Omit<Zone, 'id' | 'panelId'>>();
  const zoneOutputs = new Map<number, string[]>();
  for (const r of records) {
    const m = r.key.match(/^Z0*(\d+)$/);
    if (!m) continue;
    const number = Number.parseInt(m[1]!, 10);
    zones.set(number, { number, text: r.fields.get('DESC')?.trim() ?? '', unused: true });
    const out = refList(r.fields.get('Out'));
    if (out.length) zoneOutputs.set(number, out);
  }

  // ---- Points ------------------------------------------------------------
  const points: Omit<Point, 'id' | 'panelId'>[] = [];
  const labelByRef = new Map<string, string>();
  const deviceOutputs: { ref: string; label: string; outputs: string[] }[] = [];
  const unmappedTypes = new Map<string, number>();
  const virtualPoints: string[] = [];

  for (const r of records) {
    const at = loopAddress(r.key);
    if (!at) continue;
    const ref = canonicalRef(r.key);

    // Kept as written. Upper-casing before the lookup would work for every
    // ordinary code and quietly destroy the one that matters: a virtual
    // detector is written with a lower-case v in front of its parent's code,
    // and uppercased it becomes an unrecognised type instead.
    const rawCode = (r.fields.get('TYPE') ?? '').trim();
    const parentCode = virtualParentCode(rawCode);
    const code = (parentCode ?? rawCode).toUpperCase();
    const text = r.fields.get('DESC')?.trim() ?? '';
    const zoneNumber = Number.parseInt(r.fields.get('Z') ?? '', 10);

    // An address with nothing on it is written `TYPE:----`, and the record has
    // no other fields at all. Treated as a type code it becomes the commonest
    // "device" on the panel.
    const fitted = code.length > 0 && !/^-+$/.test(code);

    const known = fitted ? TYPE_CODES[code] : undefined;
    if (parentCode && fitted) virtualPoints.push(ref);
    let deviceType: DeviceType = 'unknown';
    if (fitted) {
      if (DESCRIPTION_WINS.has(code)) {
        const fromText = normaliseDeviceType(text);
        deviceType = fromText !== 'unknown' ? fromText : known?.type ?? 'unknown';
      } else if (known) {
        deviceType = known.type;
      }
      // A code with no entry at all is reported. One that is known but whose
      // class is deliberately not claimed is not — that is a settled answer,
      // not a gap, and reporting it every import would train the reader to
      // ignore the warning.
      if (!known) unmappedTypes.set(code, (unmappedTypes.get(code) ?? 0) + 1);
    }

    if (text) labelByRef.set(ref, text);

    points.push({
      loopNumber: at.loop,
      address: at.address,
      pointRef: ref,
      text,
      // The D/M distinction is part of the address, not decoration: a loop can
      // carry both L01D007 and L01M007 and they are different devices.
      // The vendor's own caption where there is one, so an unmapped code still
      // names something a technician can go and look at.
      deviceTypeRaw: fitted
        ? `${rawCode}${known ? ` — ${known.name}` : ''}` +
          `${parentCode ? ', virtual — shares the head at the previous address' : ''}` +
          ` (${at.kind === 'D' ? 'device' : 'module'} address)`
        : undefined,
      deviceType,
      zoneNumber: Number.isFinite(zoneNumber) && zoneNumber > 0 ? zoneNumber : undefined,
      unused: !fitted,
    });

    const outputs = refList(r.fields.get('Out'));
    if (fitted && outputs.length) deviceOutputs.push({ ref, label: text || ref, outputs });
  }

  if (virtualPoints.length) {
    warnings.push(
      `${virtualPoints.length} ${virtualPoints.length === 1 ? 'point is' : 'points are'} a virtual detector ` +
      `(${virtualPoints.slice(0, 5).join(', ')}${virtualPoints.length > 5 ? ', …' : ''}) — a second personality ` +
      `on the head at the address below, not a separate device. They carry that head's type and there is ` +
      `nothing extra to test at them.`,
    );
  }

  if (unmappedTypes.size) {
    const listed = [...unmappedTypes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ');
    warnings.push(
      `Device type codes not in the vocabulary were left as unknown and kept verbatim: ${listed}. ` +
      `They appear in FireUtils' Device Type Selector with a caption under each icon — send that ` +
      `and they will be recognised.`,
    );
  }

  // ---- Output groups -----------------------------------------------------
  // A group is a named bundle of outputs. Zones and logic blocks drive groups
  // rather than individual outputs, so resolving them is what makes the matrix
  // readable.
  const groups = new Map<string, { label: string; outputs: string[] }>();
  for (const r of records) {
    if (!/^G\d+$/.test(r.key)) continue;
    const outputs = refList(r.fields.get('Out'));
    const existing = groups.get(r.key);
    // The file repeats a group with and without its DESC; keep both halves.
    groups.set(r.key, {
      label: r.fields.get('DESC')?.trim() || existing?.label || '',
      outputs: outputs.length ? outputs : existing?.outputs ?? [],
    });
  }

  const describeRef = (ref: string): string => {
    const group = groups.get(ref);
    if (group) {
      const members = group.outputs.length ? ` = ${group.outputs.join(', ')}` : '';
      return group.label ? `${ref} "${group.label}"${members}` : `${ref}${members}`;
    }
    const label = labelByRef.get(ref);
    return label ? `${ref} "${label}"` : ref;
  };

  const undefinedGroups = new Set<string>();
  const noteGroup = (ref: string) => {
    if (/^G\d+$/.test(ref) && !groups.has(ref)) undefinedGroups.add(ref);
  };

  // ---- Cause and effect --------------------------------------------------
  const causeEffect: Omit<CauseEffectRule, 'id' | 'panelId'>[] = [];

  for (const [number, outputs] of zoneOutputs) {
    const zone = zones.get(number);
    outputs.forEach(noteGroup);
    causeEffect.push({
      causeLabel: `Zone ${number}${zone?.text ? ` — ${zone.text}` : ''}`,
      causeKind: 'zone-alarm',
      causeZoneNumber: number,
      effects: outputs.map((ref, i) => ({
        id: `Z${number}-${i}`,
        effectLabel: describeRef(ref),
        effectKind: effectKindFromLabel(groups.get(ref)?.label ?? labelByRef.get(ref) ?? '') ?? 'other',
        state: 'operates' as const,
      })),
      sourceLogic: `Z${String(number).padStart(3, '0')} Out:${outputs.join(',')}`,
    });
  }

  for (const block of records) {
    if (!/^LB\d+$/.test(block.key)) continue;
    const label = block.fields.get('DESC')?.trim() || block.key;
    const inputs = refList(block.fields.get('In'));
    const outputs = refList(block.fields.get('Out'));
    const func = block.fields.get('Func')?.trim();
    outputs.forEach(noteGroup);
    inputs.forEach(noteGroup);

    causeEffect.push({
      causeLabel: `${label}${func ? ` (${func})` : ''}: ${inputs.map(describeRef).join(` ${func ?? 'AND'} `) || 'no inputs'}`,
      causeKind: 'other',
      effects: outputs.map((ref, i) => ({
        id: `${block.key}-${i}`,
        effectLabel: describeRef(ref),
        effectKind: effectKindFromLabel(label) ?? 'other',
        state: 'operates' as const,
      })),
      // The whole record verbatim: the flags and inversion mask carry meaning
      // this parser does not claim to decode.
      sourceLogic: block.raw,
    });
  }

  for (const device of deviceOutputs) {
    device.outputs.forEach(noteGroup);
    causeEffect.push({
      causeLabel: `${device.ref} "${device.label}"`,
      causeKind: 'point-alarm',
      causePointRef: device.ref,
      effects: device.outputs.map((ref, i) => ({
        id: `${device.ref}-${i}`,
        effectLabel: describeRef(ref),
        effectKind: effectKindFromLabel(groups.get(ref)?.label ?? labelByRef.get(ref) ?? device.label) ?? 'other',
        state: 'operates' as const,
      })),
      sourceLogic: `${device.ref} Out:${device.outputs.join(',')}`,
    });
  }

  if (undefinedGroups.size) {
    warnings.push(
      `Output ${undefinedGroups.size === 1 ? 'group' : 'groups'} ${[...undefinedGroups].sort().join(', ')} ` +
      `${undefinedGroups.size === 1 ? 'is' : 'are'} referenced but not defined in this file — ` +
      `they are built into the panel, so the matrix shows the reference rather than its members.`,
    );
  }

  // ---- Tie it together ---------------------------------------------------
  const usedZones = new Set(points.filter((p) => !p.unused).map((p) => p.zoneNumber));
  for (const [number, zone] of zones) zone.unused = !usedZones.has(number);

  const zoneText = new Map([...zones.values()].map((z) => [z.number, z.text]));
  for (const p of points) {
    if (p.zoneNumber !== undefined) p.zoneText = zoneText.get(p.zoneNumber) || undefined;
  }

  // A device on a loop the file never declared is still real; add the loop.
  for (const p of points) {
    if (p.loopNumber !== undefined && !loops.has(p.loopNumber)) {
      loops.set(p.loopNumber, { number: p.loopNumber, label: `Loop ${p.loopNumber}` });
    }
  }

  const panel: ParsedPanel = {
    name: siteName || fileName || 'Pertronic panel',
    brand: 'pertronic',
    model: panelModel,
    zones: [...zones.values()].sort((a, b) => a.number - b.number),
    points,
    loops: [...loops.values()].sort((a, b) => a.number - b.number),
    causeEffect,
  };

  return {
    brand: 'pertronic',
    model: panelModel ? `${panelModel}${firmware ? ` ${firmware}` : ''}` : undefined,
    siteName,
    panels: [panel],
    warnings,
    parser: PARSER_ID,
  };
}

/** Reads the .util archive a technician actually picks. */
export function parsePertronicUtil(bytes: Uint8Array, fileName = ''): ParsedConfig {
  const { name, text } = unwrapPertronicUtil(bytes);
  return parsePertronicUtilText(text, fileName || name);
}
