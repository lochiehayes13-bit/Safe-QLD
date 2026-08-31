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
 * Device type codes, mapped only where the panel's own vocabulary is
 * unambiguous.
 *
 * `ACF` is the AS 1670 term for an ancillary control facility, so an output.
 * `VES` is mapped to aspirating on the strength of the data rather than the
 * three letters: every VES point in a real file names the aspirating unit it
 * monitors ("MASD 1 ALERT", "MASD 2 ACTION"), and the test method that follows
 * from aspirating — smoke at the sampling point — is the right one for them.
 *
 * Codes not listed here are left unknown and reported, rather than guessed at.
 */
const TYPE_CODES: Record<string, DeviceType> = {
  OPT: 'smoke-photo',
  HEAT: 'heat',
  MCP: 'mcp',
  VES: 'aspirating',
  ACF: 'module-output',
  RLYM: 'relay',
  MON: 'module-input',
  SW: 'module-input',
  // WRN is a warning device but not which kind; the description says whether
  // it is a sounder or a strobe, so it is resolved from there below.
  WRN: 'sounder',
};

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

  for (const r of records) {
    const at = loopAddress(r.key);
    if (!at) continue;
    const ref = canonicalRef(r.key);

    const code = (r.fields.get('TYPE') ?? '').trim().toUpperCase();
    const text = r.fields.get('DESC')?.trim() ?? '';
    const zoneNumber = Number.parseInt(r.fields.get('Z') ?? '', 10);

    // An address with nothing on it is written `TYPE:----`, and the record has
    // no other fields at all. Treated as a type code it becomes the commonest
    // "device" on the panel.
    const fitted = code.length > 0 && !/^-+$/.test(code);

    let deviceType: DeviceType = 'unknown';
    if (fitted) {
      const mapped = TYPE_CODES[code];
      if (DESCRIPTION_WINS.has(code)) {
        const fromText = normaliseDeviceType(text);
        deviceType = fromText !== 'unknown' ? fromText : mapped ?? 'unknown';
      } else if (mapped) {
        deviceType = mapped;
      } else {
        unmappedTypes.set(code, (unmappedTypes.get(code) ?? 0) + 1);
      }
    }

    if (text) labelByRef.set(ref, text);

    points.push({
      loopNumber: at.loop,
      address: at.address,
      pointRef: ref,
      text,
      // The D/M distinction is part of the address, not decoration: a loop can
      // carry both L01D007 and L01M007 and they are different devices.
      deviceTypeRaw: fitted ? `${code} (${at.kind === 'D' ? 'device' : 'module'} address)` : undefined,
      deviceType,
      zoneNumber: Number.isFinite(zoneNumber) && zoneNumber > 0 ? zoneNumber : undefined,
      unused: !fitted,
    });

    const outputs = refList(r.fields.get('Out'));
    if (fitted && outputs.length) deviceOutputs.push({ ref, label: text || ref, outputs });
  }

  if (unmappedTypes.size) {
    const listed = [...unmappedTypes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ');
    warnings.push(
      `Device type codes not in the mapping were left as unknown and kept verbatim: ${listed}. ` +
      `Tell us what they mean on this panel family and they will be recognised.`,
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
