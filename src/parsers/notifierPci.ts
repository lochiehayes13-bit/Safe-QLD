import type {
  CauseEffectRule, CauseKind, Loop, ParsedConfig, ParsedPanel, Point, Zone,
} from '@/domain/types';
import { normaliseDeviceType } from './deviceType';
import { parseTagLine } from './lineTags';
import { effectKindFromLabel } from './effectKind';

/**
 * Notifier site files (.pci), as written by the VeriFire toolset.
 *
 * The file looks like XML and is not: there is no root element, and the notes
 * field carries `&vbCrLf` — a Visual Basic constant that leaked into the
 * output — which is not a legal entity and makes a real XML parser reject the
 * whole file. It is, however, rigidly line-oriented: every line is exactly one
 * tag. So it is read a line at a time, which is both simpler and immune to the
 * malformed entity.
 *
 * The structure is a sequence of named sections, each holding <Point/> rows.
 * What a point is depends on its ModuleKey prefix — `dL1FLD3` is the third
 * detector on loop 1, `sZON21` is software zone 21, `zPNT9` is a network
 * programmed point. Only some of those are things a technician can put a hand
 * on; the rest are the panel's logic, and they are read for the
 * cause-and-effect matrix rather than listed as assets.
 *
 * The `Script` attribute is the real prize. Notifier stores its equations as
 * text — `NP240;`, `Z21 OR Z121 OR Z221;` — so the matrix can be reconstructed
 * exactly rather than inferred, and the equation is kept verbatim alongside.
 */

const PARSER_ID = 'notifier-pci@1';

/** One line of a .pci file, read as a tag. Shared with the Vigilant reader. */
export const parsePciLine = parseTagLine;

export function isPci(text: string): boolean {
  const head = text.slice(0, 400);
  // The version tag opens every file this tool writes, and the Point rows are
  // what distinguish it from any other angle-bracket format.
  return /^\s*<Version\s+Name\s*=/.test(head) && /<Point\s+ModuleKey\s*=/.test(text.slice(0, 20000));
}

/**
 * Which ModuleKey prefixes name something physically present.
 *
 * `d`/`o` are loop detectors and modules, `m` a module on a network ring, and
 * the `bDEF`/`xDEF` families the panel's own board terminals and expander
 * relays. Everything else — software zones, virtual points, network programmed
 * points, isolate groups, the node list — is logic, and listing it as an asset
 * would put a hundred things on a test sheet that do not exist in the
 * building.
 */
function physicalKind(moduleKey: string): 'loop' | 'ring' | 'panel' | undefined {
  if (/^dL\d+/.test(moduleKey) || /^oL\d+/.test(moduleKey)) return 'loop';
  if (/^m\d*r\d+MOD/.test(moduleKey)) return 'ring';
  if (/^[bx]DEF[OZ]/.test(moduleKey)) return 'panel';
  return undefined;
}

function intOf(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** The trailing number of a key like `sZON221` or `Node 3`. */
function trailingNumber(s: string): number | undefined {
  const m = s.match(/(\d+)\s*$/);
  return m ? Number.parseInt(m[1]!, 10) : undefined;
}

/** A script the panel wrote to say the point is fixed in firmware. */
const NOT_PROGRAMMABLE = /CAN\s*NOT\s*BE\s*RE-?PROGRAMMED/i;

/**
 * Whether an equation is a single zone reference, e.g. `Z15;`.
 *
 * Only then is the cause honestly a zone alarm. `Z21 OR Z121 OR Z221` is three
 * zones, and recording it as "zone 21" would understate what trips the output.
 */
function soleZone(script: string): number | undefined {
  const m = script.trim().replace(/;$/, '').trim().match(/^Z(\d+)$/i);
  return m ? Number.parseInt(m[1]!, 10) : undefined;
}

export function parsePci(text: string, fileName = ''): ParsedConfig {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  let siteName: string | undefined;
  let nodeNumber: number | undefined;
  let panelName = '';
  let toolVersion: string | undefined;

  const loops = new Map<number, Omit<Loop, 'id' | 'panelId'>>();
  const zones = new Map<number, Omit<Zone, 'id' | 'panelId'>>();
  const points: Omit<Point, 'id' | 'panelId'>[] = [];
  /** ActKey -> Label, so an equation's tokens can be named. */
  const labelByActKey = new Map<string, string>();
  /** Points carrying an equation, kept until the labels are all known. */
  const scripted: { actKey: string; label: string; script: string; trigger?: string; physical: boolean }[] = [];

  const section: string[] = [];
  let currentLoop: number | undefined;

  for (const line of lines) {
    const tag = parsePciLine(line);
    if (!tag) continue;

    if (tag.closing) {
      if (section[section.length - 1] === tag.name) section.pop();
      if (tag.name === 'Loop') currentLoop = undefined;
      continue;
    }

    if (tag.name !== 'Point') {
      if (!tag.selfClosing) section.push(tag.name);

      switch (tag.name) {
        case 'Version':
          toolVersion = tag.attrs.Name;
          break;
        case 'Globals':
          if (tag.attrs.SiteName?.trim()) siteName = tag.attrs.SiteName.trim();
          break;
        case 'Node':
          panelName = tag.attrs.Name?.trim() ?? '';
          nodeNumber = trailingNumber(panelName);
          break;
        case 'Loop': {
          // Named "L 1:LOOP 1" — the number before the colon, the label after.
          const raw = tag.attrs.Name ?? '';
          const colon = raw.indexOf(':');
          const number = intOf((colon >= 0 ? raw.slice(0, colon) : raw).replace(/[^0-9]/g, ''));
          if (number !== undefined) {
            currentLoop = number;
            loops.set(number, { number, label: (colon >= 0 ? raw.slice(colon + 1) : raw).trim() || `Loop ${number}` });
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    // ---- a Point row ------------------------------------------------------
    const moduleKey = tag.attrs.ModuleKey ?? '';
    const actKey = tag.attrs.ActKey ?? '';
    const label = (tag.attrs.Label ?? '').trim();
    const script = (tag.attrs.Script ?? '').trim();
    const kind = physicalKind(moduleKey);

    if (actKey && label) labelByActKey.set(actKey, label);

    if (script && !NOT_PROGRAMMABLE.test(script)) {
      scripted.push({ actKey, label, script, trigger: tag.attrs.Trigger, physical: kind !== undefined });
    }

    // Software zones carry the zone names for the whole site.
    if (/^sZON/.test(moduleKey)) {
      const number = trailingNumber(moduleKey);
      if (number !== undefined) zones.set(number, { number, text: label, unused: true });
      continue;
    }

    if (!kind) continue;

    const zoneNumber = intOf(tag.attrs.Zone);
    const deviceTypeRaw = (tag.attrs.ZoneType ?? '').trim();
    points.push({
      loopNumber: kind === 'loop' ? intOf(tag.attrs.Loop) ?? currentLoop : undefined,
      address: kind === 'loop' ? intOf(tag.attrs.Device) : intOf(tag.attrs.ModuleId),
      pointRef: actKey || moduleKey,
      text: label,
      deviceTypeRaw: deviceTypeRaw || undefined,
      // "Y"/"N" appear in this attribute on non-loop rows, where it is a flag
      // rather than a device type. Passing those to the normaliser would have
      // it matching on a single letter.
      deviceType: deviceTypeRaw && !/^[YN]$/i.test(deviceTypeRaw) ? normaliseDeviceType(deviceTypeRaw) : 'unknown',
      zoneNumber: zoneNumber && zoneNumber > 0 ? zoneNumber : undefined,
      unused: !label || label.toUpperCase() === 'PROGRAMMED POINT',
    });
  }

  if (!points.length) {
    warnings.push(`${fileName || 'The file'} parsed as a Notifier configuration but contained no addressable points.`);
  }

  // ---- Zones -------------------------------------------------------------
  const usedZones = new Set(points.map((p) => p.zoneNumber).filter((z): z is number => z !== undefined));
  for (const z of usedZones) {
    if (!zones.has(z)) zones.set(z, { number: z, text: '', unused: false });
  }
  for (const [number, zone] of zones) zone.unused = !usedZones.has(number);

  const zoneText = new Map([...zones.values()].map((z) => [z.number, z.text]));
  for (const p of points) {
    if (p.zoneNumber !== undefined) p.zoneText = zoneText.get(p.zoneNumber) || undefined;
  }

  // ---- Cause and effect --------------------------------------------------
  // Now that every ActKey has a label, an equation's tokens can be named.
  const nameToken = (token: string): string => {
    const raw = token.replace(/;/g, '').trim();
    // Keep the negation. Stripping it to look the token up turns "not warning
    // isolated" into "warning isolated" — the rendered rule then states the
    // exact opposite of what the panel does, and reads perfectly while doing it.
    const negated = raw.startsWith('!');
    const clean = negated ? raw.slice(1).trim() : raw;
    const known = labelByActKey.get(clean);
    const named = known ? `${clean} (${known})` : clean;
    return negated ? `NOT ${named}` : named;
  };

  const describeScript = (script: string): string =>
    script
      .replace(/;$/, '')
      .split(/\s+(AND|OR)\s+/i)
      .map((part) => (/^(AND|OR)$/i.test(part) ? part.toUpperCase() : nameToken(part)))
      .join(' ');

  const causeEffect: Omit<CauseEffectRule, 'id' | 'panelId'>[] = [];
  for (const s of scripted) {
    // Only outputs that physically do something become matrix rows. The
    // logical points are the wiring between them, and their equations are
    // already visible through the token names above.
    if (!s.physical) continue;

    const zone = soleZone(s.script);
    const kind: CauseKind = zone !== undefined ? 'zone-alarm' : s.trigger ? 'isolate' : 'other';

    causeEffect.push({
      causeLabel: describeScript(s.script),
      causeKind: kind,
      causeZoneNumber: zone,
      effects: [{
        id: `${s.actKey || s.label}-effect`,
        effectLabel: s.label || s.actKey,
        effectKind: effectKindFromLabel(s.label) ?? 'other',
        state: 'operates',
      }],
      // The equation verbatim. Every rendering above is a convenience; this is
      // the thing that was actually commissioned.
      sourceLogic: s.trigger ? `${s.script} (trigger ${s.trigger})` : s.script,
    });
  }

  const panel: ParsedPanel = {
    name: siteName || panelName || 'Notifier panel',
    brand: 'notifier',
    nodeNumber,
    zones: [...zones.values()].sort((a, b) => a.number - b.number),
    points,
    loops: [...loops.values()].sort((a, b) => a.number - b.number),
    causeEffect,
  };

  // The file names the tool that wrote it, never the panel it was written for.
  warnings.push(
    `The panel model is not recorded in this file${toolVersion ? ` (VeriFire ${toolVersion})` : ''}; ` +
    `set it on the panel record after import.`,
  );

  return { brand: 'notifier', siteName, panels: [panel], warnings, parser: PARSER_ID };
}
