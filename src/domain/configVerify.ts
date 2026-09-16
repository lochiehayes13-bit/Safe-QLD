import { DEVICE_TYPE_LABEL, isOutputDevice } from '@/parsers/deviceType';
import { protocolById } from '@/calc/dipswitch';
import { canonicalRef } from '@/parsers/pertronicUtil';
import { addressLabel, type ConfigLoop, type ConfigPoint } from '@/domain/configBrowse';
import type { DeviceType, ParsedConfig, ParsedPanel } from '@/domain/types';

/**
 * Checking a configuration, and saying what could not be checked.
 *
 * The second half is what makes the first half worth having. Every one of the
 * seven readers in this app throws something away — Kentec cannot tell a smoke
 * detector from a relay, because Loop Explorer keeps its device types in a
 * library that does not travel with the file; Ampac folds a networked site
 * into one panel, so two nodes' address 34 land on top of each other; Notifier
 * invents a zone record for any number a device names, so "this device reports
 * to a zone that does not exist" can never fire. A verifier that ran every
 * check against every format would report a hundred type problems on a Kentec
 * file, a hundred duplicate addresses on an Ampac one, and nothing at all on a
 * Notifier — and a technician who has been shown a hundred findings that are
 * not true stops opening the screen, which costs more than the tool was ever
 * worth.
 *
 * So a check declares what it needs, the file declares what it can support,
 * and a check whose ground is missing does not run and says so. The screen
 * shows the skipped list beside the findings. "Not checked, because this file
 * does not carry device types" is a useful sentence; a silent absence is not.
 *
 * Two sources decide what a file can support. Most of it is derived from the
 * parse itself — if every point comes back with an unknown type, no
 * type-based check can mean anything, whichever reader produced it. The rest
 * is what a reader is known not to be able to say and the data cannot reveal:
 * that Ampac's addresses repeat once per node, for instance, which looks
 * exactly like a wiring mistake and is not one. Those are listed against the
 * parser id, with the reason beside each.
 *
 * Nothing here reproduces a figure from a Standard, because this repository
 * deliberately holds none. Where a check touches something AS 1670.1 governs,
 * it points a technician at the zone to go and measure rather than declaring a
 * non-conformance it has no grounds for.
 */

export type FindingSeverity = 'fail' | 'warn' | 'note';

export interface Finding {
  /** The check that produced it. Stable, so a screen can key on it. */
  id: string;
  severity: FindingSeverity;
  /** What a technician reads first. */
  title: string;
  /** What it means on site. The consequence, not a restatement of the check. */
  why: string;
  /** How many things it is about. */
  count: number;
  /** A few of them, named. Capped, because forty addresses is not a sentence. */
  examples: string[];
  /** Which panel, where the file holds more than one. */
  panel?: string;
}

export interface SkippedCheck {
  id: string;
  title: string;
  /** Why it did not run. Shown to the technician, so it is a sentence. */
  because: string;
}

export interface VerifyResult {
  findings: Finding[];
  /** Checks that could not run here, with the reason. */
  skipped: SkippedCheck[];
  /** Checks that ran and found nothing, by id. */
  passed: string[];
  gates: ConfigGates;
  /**
   * What there was to look at, across every panel.
   *
   * Needed because a handful of checks pass on an empty file — a loop with
   * nothing on it cannot be reported when there are no loops — and "nothing
   * found by four checks" on a file holding nothing at all is the wrong
   * sentence. It reads as a clean bill.
   */
  subject: { points: number; zones: number; rules: number };
}

// ---------------------------------------------------------------------------
// What this file lets a check see
// ---------------------------------------------------------------------------

export type GateName =
  /** `deviceType` is read from the file rather than left unknown. */
  | 'deviceTypes'
  /** Points carry zone numbers, so anything about zone membership means something. */
  | 'zoneMembership'
  /** The zone list is the panel's table, not a set invented from what points name. */
  | 'zoneTable'
  /** An address identifies one device across the whole file. */
  | 'addressesUnique'
  /** `unused` marks a spare address rather than standing in for blank text. */
  | 'sparesMarked'
  /** An effect names something that can be found among the points. */
  | 'effectsNamePoints'
  /** `effectKind` is worked out from the file rather than left as 'other'. */
  | 'effectKinds';

export interface Gate {
  open: boolean;
  /** Why it is shut. Empty when it is open. */
  because: string;
}

export type ConfigGates = Record<GateName, Gate>;

const OPEN: Gate = { open: true, because: '' };

function shut(because: string): Gate {
  return { open: false, because };
}

/**
 * What a reader is known not to be able to say, where the data cannot show it.
 *
 * Everything else is derived below. These are the cases where the parse looks
 * perfectly healthy and a check would still be wrong — which is exactly the
 * kind of thing that has to be written down rather than inferred.
 */
const READER_LIMITS: Record<string, Partial<Record<GateName, string>>> = {
  /*
   * Ampac and Notifier both fold a networked site into one panel, and for a
   * while this table shut their address gate outright because of it. That was
   * over-suppression, and reading the real files is what showed it: Ampac
   * writes its point references as `N1L1P001` and Notifier as `0.4.O1`, so the
   * node is in the reference on both, and a check keyed on the reference is
   * already safe. What the flattening does cost is said by `network-flattened`
   * below, which is a note rather than a silence.
   */
  'ampac-ffp@1': {
    effectKinds: 'This reader does not work out what an effect does, so every one of them reads as "other".',
    effectsNamePoints:
      'An Ampac function names its outputs by token rather than by a device reference, so an effect cannot be '
      + 'matched back to a device in the list.',
    sparesMarked:
      'Unused slots are dropped as the file is read rather than kept and marked, so nothing here is a spare.',
  },
  'notifier-pci@1': {
    zoneTable:
      'This reader creates a zone record for any zone number a device names, so a device can never report to a '
      + 'zone that is missing.',
    effectsNamePoints:
      'A Notifier equation names an output by its own key rather than by a device reference, so an effect cannot '
      + 'be matched back to a device in the list.',
  },
  'kentec-nle@1': {
    zoneTable:
      'Loop Explorer creates every addressable zone up front — two thousand of them in the file this was checked '
      + 'against — so the zone list here is the ones actually in use, not the panel’s table.',
  },
  'vigilant-smartconfig@1': {
    zoneTable:
      'A Vigilant equation can name a zone the zone table does not carry, so the zone list is not the whole set.',
    effectKinds: 'This reader keeps the equation verbatim rather than deciding what it does, so every effect reads as "other".',
    effectsNamePoints: 'A Vigilant equation names outputs in its own terms, which do not match the device list.',
  },
  'tabular@1': {
    sparesMarked:
      'On a column-mapped import a device counts as spare when it has no text, so "fitted and unnamed" is a '
      + 'contradiction rather than a finding.',
    effectsNamePoints: 'A device list carries no logic at all.',
    effectKinds: 'A device list carries no logic at all.',
  },
  'ncf-site@1': {
    zoneMembership: 'This format gives up the site name and the zone list and nothing else; there are no devices to place.',
  },
};

/**
 * Whether this file is a network that has been read as a single panel.
 *
 * Worth saying out loud rather than leaving as a silence: two devices that
 * look like they share an address are on different panels, a device nobody can
 * find may be on the node down the corridor, and the device count is for the
 * whole network rather than the panel somebody is standing at.
 *
 * Only two readers leave evidence of it, and each leaves a different kind.
 * Notifier keeps the last `<Node>` it saw, so a file that comes back as one
 * panel claiming to be node 3 was a network. Ampac writes the node into every
 * point reference as `N1L1P001`, so more than one `N` prefix is a network.
 * Nothing else carries the fact at all, and the absence of it is never
 * evidence of a single-panel site — which is why this returns a sentence or
 * nothing, and never "this is one panel".
 */
export function flattenedNetwork(config: ParsedConfig): string | undefined {
  if (config.panels.length > 1) return undefined;
  const panel = config.panels[0];
  if (!panel) return undefined;

  if (config.parser === 'notifier-pci@1' && (panel.nodeNumber ?? 1) > 1) {
    return `This file comes back as one panel and says it is node ${panel.nodeNumber} of a network.`;
  }

  if (config.parser === 'ampac-ffp@1') {
    const nodes = new Set<string>();
    for (const p of panel.points) {
      const m = p.pointRef?.match(/^N(\d+)L/i);
      if (m) nodes.add(m[1]!);
    }
    if (nodes.size > 1) {
      return `The device references in this file name ${nodes.size} panels (${[...nodes].sort().map((n) => `node ${n}`).join(', ')}), `
        + 'and they have all been read into one.';
    }
  }

  return undefined;
}

/** Detection and initiating classes: the things that start an alarm. */
const INITIATING = new Set<DeviceType>([
  'smoke', 'smoke-photo', 'smoke-ion', 'heat', 'multi', 'beam', 'aspirating', 'flame', 'duct',
  'mcp', 'sprinkler-flow', 'gas', 'module-input',
]);

/** Detection proper, which is narrower: the classes a zone is sized around. */
const DETECTION = new Set<DeviceType>([
  'smoke', 'smoke-photo', 'smoke-ion', 'heat', 'multi', 'beam', 'aspirating', 'flame', 'duct',
]);

const WARNING_EFFECTS = new Set(['occupant-warning', 'evacuation', 'sounders', 'strobes']);

/** Device text that names a state rather than a place in the building. */
const NOT_A_PLACE = /^(spare|spares|not\s*used|unused|n\/?a|tba|future|reserved|blank)$/i;

function fitted(points: readonly ConfigPoint[]): ConfigPoint[] {
  return points.filter((p) => !p.unused);
}

/**
 * The gates for one configuration.
 *
 * Derived first, then narrowed by whatever the reader is known not to be able
 * to say. Derivation comes first deliberately: a column-mapped CSV with only
 * text and address mapped has no zone numbers in it whoever read it, and a
 * rule written against the parser id would miss that.
 */
export function gatesFor(config: ParsedConfig): ConfigGates {
  const points = config.panels.flatMap((p) => fitted(p.points));
  const rules = config.panels.flatMap((p) => p.causeEffect);
  const effects = rules.flatMap((r) => r.effects);

  const typed = points.filter((p) => p.deviceType !== 'unknown').length;
  const zoned = points.filter((p) => p.zoneNumber !== undefined).length;

  const gates: ConfigGates = {
    // Half is the line because a format that names some of its devices and not
    // others still supports a type check on the ones it names; a format where
    // most are unknown does not, and the finding would be about the reader.
    deviceTypes: points.length && typed * 2 >= points.length
      ? OPEN
      : shut(points.length
        ? `Only ${typed} of ${points.length} devices came back with a type this app recognises, so nothing `
          + 'about device classes can be checked here.'
        : 'There are no devices in this file to check.'),
    zoneMembership: zoned > 0
      ? OPEN
      : shut(points.length
        ? 'No device in this file carries a zone number, so nothing about zones can be checked against them.'
        : 'There are no devices in this file to place in zones.'),
    zoneTable: config.panels.some((p) => p.zones.length)
      ? OPEN
      : shut('This file carries no zone table.'),
    /*
     * Open when there is something that identifies a device. The check below
     * keys on the panel's own point reference where every device has one, and
     * only falls back to loop and address where they do not — so a flattened
     * network is a problem for the fallback and not for the reference.
     */
    addressesUnique: (() => {
      if (!points.some((p) => p.address !== undefined || p.pointRef?.trim())) {
        return shut('No device in this file carries a loop address or a reference.');
      }
      const everyPointHasARef = points.length > 0 && points.every((p) => Boolean(p.pointRef?.trim()));
      const flattened = flattenedNetwork(config);
      if (!everyPointHasARef && flattened) {
        return shut(`${flattened} Without a reference on every device there is nothing left to tell `
          + 'two panels\u2019 address 34 apart from one address used twice.');
      }
      return OPEN;
    })(),
    sparesMarked: config.panels.some((p) => p.points.some((pt) => pt.unused))
      ? OPEN
      : shut('Nothing in this file is marked as a spare address, so fitted and spare cannot be told apart.'),
    effectsNamePoints: effects.length
      ? OPEN
      : shut('There is no cause and effect in this file.'),
    effectKinds: effects.some((e) => e.effectKind !== 'other')
      ? OPEN
      : shut(rules.length
        ? 'Nothing in this file says what its effects actually do — every one of them reads as "other".'
        : 'There is no cause and effect in this file.'),
  };

  for (const [name, because] of Object.entries(READER_LIMITS[config.parser] ?? {})) {
    // Only ever narrows. A reader limit cannot open a gate the data has shut:
    // a file with no zone numbers in it has none whoever read it.
    if (because) gates[name as GateName] = shut(because);
  }

  return gates;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

interface Hit {
  count: number;
  examples: string[];
  /** Replaces the check's own title where the finding reads better with the number in it. */
  title?: string;
}

interface Check {
  id: string;
  title: string;
  severity: FindingSeverity;
  why: string;
  /** Gates that must be open. A shut one skips the check and gives the reason. */
  needs: GateName[];
  /** Parsers this check must not run on, with the reason a technician reads. */
  notOn?: Record<string, string>;
  run: (panel: ParsedPanel, config: ParsedConfig) => Hit | undefined;
}

/**
 * The addressing table's name for a loop protocol.
 *
 * Two vocabularies that look alike and are not the same list. The domain's
 * `AddressProtocol` is what a parser records about a loop; `PROTOCOLS` in
 * `@/calc/dipswitch` is the addressing reference the DIP switch tool works
 * from, and its ids are spelled with underscores. Joining them by turning a
 * hyphen into an underscore would work for four of them and silently invent a
 * match for the rest.
 *
 * So the pairs are written out, and only where both tables plainly name the
 * same thing. `system-sensor` is deliberately absent: the addressing table has
 * two Notifier protocols with different ceilings — FlashScan and CLIP — and
 * picking one of them would be a guess that decides whether a device is
 * reported as unpollable. `conventional` and `generic` are absent because
 * neither has a ceiling to be over.
 */
const PROTOCOL_ID: Partial<Record<NonNullable<ConfigLoop['protocol']>, string>> = {
  'apollo-xp95': 'apollo_xp95',
  'apollo-discovery': 'apollo_discovery',
  'apollo-core': 'apollo_coreprotocol',
  'hochiki-esp': 'hochiki_esp',
  'simplex-idnet': 'simplex_idnet',
  'tyco-mx': 'tyco_mx',
  ampac: 'ampac_firefinder',
};

function ceilingFor(protocol: ConfigLoop['protocol']) {
  if (!protocol) return undefined;
  const id = PROTOCOL_ID[protocol];
  return id ? protocolById(id) : undefined;
}

/**
 * The devices an effect label names, where the format names any.
 *
 * Written per format rather than as one pattern, because one pattern gets both
 * of them wrong. Kentec writes a composite — "Roller Shutter Release O/P (30s
 * Delay) → L2D102.1" — so the target is the half after the arrow and nothing
 * else; a loose search over the whole label would also match the rule's name.
 * And a loose `L\d+D\d+` matches `L2D102` inside `L2D102.1`, which is a
 * different device: that is a dangling target invented by the search rather
 * than found in the file.
 *
 * Pertronic is the other way round. Its labels carry the reference with the
 * device's name beside it — `L01M021 "SECURITY ALARM OFFICE GFA"` — and an
 * output group expands to a list of them, `G001 = L02M064, L02M063, …`, so
 * every reference in the label is a device the rule drives. A bare `G020` or a
 * panel LED like `LED0101` names no loop device and is not a claim about one.
 *
 * Everything else returns nothing and is gated off above: Ampac writes "GS 1",
 * Notifier writes the output's own free text, Vigilant writes equation
 * fragments. None of those is a device reference, and treating one as a
 * missing device would be a finding about the reader.
 */
function effectTargets(parser: string, label: string): string[] {
  if (parser === 'kentec-nle@1') {
    const arrow = label.lastIndexOf(' \u2192 ');
    if (arrow < 0) return [];
    const target = label.slice(arrow + 3).trim();
    return /^L\d+D\d+(\.\d+)?$/i.test(target) ? [target.toUpperCase()] : [];
  }
  if (parser === 'pertronic-util@1') {
    return [...new Set([...label.matchAll(/\bL\d+[DM]\d+\b/gi)].map((m) => canonicalRef(m[0]).toUpperCase()))];
  }
  return [];
}

/** A point reference in the same spelling `effectTargets` produces. */
function canonicalDeviceRef(parser: string, ref: string | undefined): string {
  const trimmed = ref?.trim();
  if (!trimmed) return '';
  // Pertronic is inconsistent with itself about zero padding — a device is
  // defined as L01M001 and referred to from a logic block as L01M21 — and
  // `canonicalRef` is the parser's own fix for it.
  return parser === 'pertronic-util@1' ? canonicalRef(trimmed).toUpperCase() : trimmed.toUpperCase();
}

/** At most six of anything, because a finding is a sentence and not a list. */
const SHOWN = 6;

/**
 * A finding from the things it is about.
 *
 * `count` is how many there are, not how many are shown — a check that lists
 * its top three groups still has to say there were nine, or the title and the
 * body disagree with each other on screen.
 */
function hit(items: string[], title?: string, count = items.length): Hit | undefined {
  if (!items.length) return undefined;
  return { count, examples: items.slice(0, SHOWN), title };
}

/** How a point is named in a finding: its address if it has one, else its text. */
function name(point: ConfigPoint): string {
  const where = addressLabel(point);
  const text = point.text.trim();
  if (where && text) return `${where} ${text}`;
  return where || text || '(unnamed device)';
}

/**
 * The same, with the file's own type string beside it.
 *
 * Used by every finding that turns on a device's class, because the
 * classification is the weakest link under all of them. `normaliseDeviceType`
 * is first-rule-wins and its sounder rule runs before its smoke rule, so a
 * head programmed as "SMOKE DETECTOR SOUNDER BASE" comes back classed as a
 * sounder — and a finding that says so without showing the words it read from
 * is a finding nobody can check. Printing the raw string makes the mistake
 * visible in one glance instead of sending somebody to the loop.
 */
function nameWithType(point: ConfigPoint): string {
  const raw = point.deviceTypeRaw?.trim();
  const label = DEVICE_TYPE_LABEL[point.deviceType] ?? point.deviceType;
  return `${name(point)} — ${raw ? `${label}, read from "${raw}"` : label}`;
}

/** The panel's own filler for a zone that has never been named. */
function isPlaceholderZoneText(text: string, number: number): boolean {
  return new RegExp(`^zone\\s*0*${number}$`, 'i').test(text.trim());
}

const CHECKS: Check[] = [
  {
    id: 'nothing-came-across',
    title: 'This file carries no devices',
    severity: 'note',
    why:
      'It says the device list is empty because the format does not hold one, not because the panel is bare. '
      + 'Without it a screen with no devices, no loops and no logic on it reads as a panel with nothing '
      + 'programmed, which is a completely different thing.',
    needs: [],
    run: (panel, config) => {
      if (panel.points.length) return undefined;
      const held = [
        panel.zones.length ? `${panel.zones.length} zones` : '',
        panel.loops.length ? `${panel.loops.length} loops` : '',
        panel.causeEffect.length ? `${panel.causeEffect.length} rules` : '',
      ].filter(Boolean);
      return hit([
        held.length
          ? `The reader brought across ${held.join(', ')} and no devices at all.`
          : 'The reader brought nothing across from this file.',
      ]);
    },
  },
  {
    id: 'network-flattened',
    title: 'This file is a network and it reads here as one panel',
    severity: 'note',
    why:
      'Two devices that look like they share an address are on different panels, a device you cannot find may be '
      + 'on the node down the corridor, and the device count is for the whole network rather than the panel you '
      + 'are standing at.',
    needs: [],
    run: (_panel, config) => {
      const flattened = flattenedNetwork(config);
      return flattened ? hit([flattened]) : undefined;
    },
  },
  {
    id: 'duplicate-address',
    title: 'Two devices answer to the same address',
    severity: 'fail',
    why:
      'The panel will only ever see one of them. The other sits on the loop, tests fine when you put smoke on '
      + 'it by hand, and has never once reported. It is the defect that hides for years.',
    needs: ['addressesUnique'],
    run: (panel) => {
      const live = fitted(panel.points);
      /*
       * Keyed on the panel's own reference where every device has one, and on
       * loop and address only where they do not.
       *
       * Loop and address alone is wrong on the formats that number devices and
       * modules separately — which is most of them. Pertronic writes L01D001
       * and L01M001 for a detector and a module that both sit at address 1 on
       * loop 1, and keying on the address reported 81 collisions on the real
       * file this was checked against, every one of them a detector paired
       * with a module that is not on the same address at all.
       */
      const refs = live.map((p) => p.pointRef?.trim()).filter(Boolean);
      const byRef = refs.length === live.length;

      const seen = new Map<string, ConfigPoint[]>();
      for (const p of live) {
        const key = byRef
          ? p.pointRef!.trim().toUpperCase()
          : p.address === undefined ? '' : `${p.loopNumber ?? 0}/${p.address}/${p.subAddress ?? ''}`;
        if (!key) continue;
        const list = seen.get(key);
        if (list) list.push(p);
        else seen.set(key, [p]);
      }
      const clashes = [...seen.values()].filter((list) => list.length > 1);
      if (!clashes.length) return undefined;

      /*
       * Past a quarter of the panel, this is not a wiring problem. It is the
       * file holding the configuration twice — which Pertronic's format does
       * by design, live copy then a banner then what the tool last read back
       * off the panel, and which a reader that missed the banner would bring
       * through whole. Listing eighty pairs would bury that; saying it once is
       * the finding.
       */
      const involved = clashes.reduce((n, list) => n + list.length, 0);
      // The floor matters as much as the proportion: two devices out of two is
      // a hundred per cent and says nothing about the file holding two copies
      // of itself. Below a couple of dozen devices the pairs are listed.
      if (live.length >= 24 && involved * 4 > live.length) {
        return hit(
          [`${involved.toLocaleString()} of ${live.length.toLocaleString()} devices are in duplicate pairs`],
          'This file appears to hold the configuration twice',
          involved,
        );
      }

      return hit(clashes.map((list) => `${addressLabel(list[0]!) || list[0]!.pointRef}: ${list.map((p) => p.text.trim() || '(no text)').join(' / ')}`));
    },
  },
  {
    id: 'zone-untexted',
    title: 'A zone has devices on it and no name',
    severity: 'fail',
    why:
      'The zone chart at the panel is built from this text. A blank row gives whoever turns up a number lighting '
      + 'up and nothing about which part of the building to walk to.',
    needs: ['zoneMembership'],
    run: (panel) => {
      const counts = new Map<number, number>();
      for (const p of fitted(panel.points)) {
        if (p.zoneNumber === undefined) continue;
        counts.set(p.zoneNumber, (counts.get(p.zoneNumber) ?? 0) + 1);
      }
      const blank = panel.zones.filter((z) => (counts.get(z.number) ?? 0) > 0 && !z.text.trim());
      // A format that carries no zone names at all would fail every zone, which
      // is a fact about the format and not about the building.
      if (panel.zones.length && blank.length === panel.zones.length) return undefined;
      return hit(blank.map((z) => `Zone ${z.number} — ${counts.get(z.number)} devices`));
    },
  },
  {
    id: 'zone-placeholder-text',
    title: 'Zones still carry the programming tool’s default name',
    severity: 'warn',
    why:
      'A chart reading "ZONE 12" against zone 12 says nothing a responder can use. These are zones somebody '
      + 'programmed and never came back and named.',
    needs: ['zoneMembership'],
    run: (panel) => {
      const counts = new Map<number, number>();
      for (const p of fitted(panel.points)) {
        if (p.zoneNumber === undefined) continue;
        counts.set(p.zoneNumber, (counts.get(p.zoneNumber) ?? 0) + 1);
      }
      const filler = panel.zones.filter((z) => (counts.get(z.number) ?? 0) > 0 && isPlaceholderZoneText(z.text, z.number));
      return hit(
        filler.map((z) => `Zone ${z.number} — ${counts.get(z.number)} devices, still called "${z.text.trim()}"`),
        filler.length === 1
          ? 'A zone still carries the programming tool’s default name'
          : `${filler.length} zones still carry the programming tool’s default name`,
      );
    },
  },
  {
    id: 'zone-not-in-table',
    title: 'Devices report to a zone the panel has no record of',
    severity: 'warn',
    why:
      'Those devices cannot appear on a zone chart — there is no row for them to sit on. At the panel the number '
      + 'lights with nothing against it, and on the test sheet the device has no location.',
    needs: ['zoneMembership', 'zoneTable'],
    run: (panel) => {
      const known = new Set(panel.zones.map((z) => z.number));
      const orphans = new Map<number, number>();
      for (const p of fitted(panel.points)) {
        if (p.zoneNumber === undefined || known.has(p.zoneNumber)) continue;
        orphans.set(p.zoneNumber, (orphans.get(p.zoneNumber) ?? 0) + 1);
      }
      return hit([...orphans.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([zone, n]) => `Zone ${zone} — ${n} device${n === 1 ? '' : 's'} report to it`));
    },
  },
  {
    id: 'duplicate-zone-number',
    title: 'Two zone records share a number',
    severity: 'warn',
    why:
      'Whichever of the two the panel uses, the chart and the register will disagree with it half the time. It '
      + 'is usually a zone added twice under two names.',
    needs: ['zoneTable'],
    run: (panel) => {
      const byNumber = new Map<number, string[]>();
      for (const z of panel.zones) {
        const list = byNumber.get(z.number);
        if (list) list.push(z.text.trim() || '(no text)');
        else byNumber.set(z.number, [z.text.trim() || '(no text)']);
      }
      return hit([...byNumber.entries()]
        .filter(([, texts]) => texts.length > 1)
        .map(([number, texts]) => `Zone ${number}: ${texts.join(' / ')}`));
    },
  },
  {
    id: 'fitted-no-text',
    title: 'A device is fitted and has nothing written against it',
    severity: 'warn',
    why:
      'On the test sheet that row is a bare address. Somebody has to walk the loop to find it, and whatever they '
      + 'write on the day becomes the first description that device has ever had.',
    needs: ['sparesMarked'],
    run: (panel) => hit(fitted(panel.points)
      .filter((p) => !p.text.trim())
      .map((p) => addressLabel(p) || '(no address either)')),
  },
  {
    id: 'point-on-undeclared-loop',
    title: 'Devices are addressed on a loop the panel does not declare',
    severity: 'warn',
    why:
      'Either the loop card is missing from the configuration, or the devices are programmed onto a loop that '
      + 'does not exist. Both come back the same way: the panel does not poll them.',
    needs: [],
    run: (panel) => {
      if (!panel.loops.length) return undefined;
      const declared = new Set(panel.loops.map((l) => l.number));
      const stray = new Map<number, number>();
      for (const p of fitted(panel.points)) {
        if (p.loopNumber === undefined || declared.has(p.loopNumber)) continue;
        stray.set(p.loopNumber, (stray.get(p.loopNumber) ?? 0) + 1);
      }
      return hit([...stray.entries()].map(([loop, n]) => `Loop ${loop} — ${n} device${n === 1 ? '' : 's'} on it`));
    },
  },
  {
    id: 'loop-declared-empty',
    title: 'A loop is declared with nothing on it',
    severity: 'note',
    why:
      'A loop card fitted and not used yet is perfectly normal on a building that is still being built. On one '
      + 'that is finished it is worth a look, because a whole loop that stopped being polled looks exactly like this.',
    needs: [],
    run: (panel) => {
      if (!panel.loops.length) return undefined;
      const used = new Set(panel.points.map((p) => p.loopNumber));
      return hit(panel.loops
        .filter((l) => !used.has(l.number))
        .map((l) => `Loop ${l.number}${l.label ? ` — ${l.label}` : ''}`));
    },
  },
  {
    id: 'address-above-protocol',
    title: 'A device is addressed higher than the loop can poll',
    severity: 'warn',
    why:
      'The panel will not see it at all. It is usually a loop set to the wrong protocol in the configuration '
      + 'rather than a device set wrong on the wall.',
    needs: ['addressesUnique'],
    run: (panel) => {
      const ceilings = new Map<number, { max: number; protocol: string }>();
      for (const loop of panel.loops) {
        const protocol = ceilingFor(loop.protocol);
        if (protocol) ceilings.set(loop.number, { max: protocol.maxAddress, protocol: protocol.label });
      }
      if (!ceilings.size) return undefined;
      const over: string[] = [];
      for (const p of fitted(panel.points)) {
        if (p.loopNumber === undefined || p.address === undefined) continue;
        const ceiling = ceilings.get(p.loopNumber);
        if (ceiling && p.address > ceiling.max) {
          over.push(`${name(p)} — above ${ceiling.protocol}'s ${ceiling.max}`);
        }
      }
      return hit(over);
    },
  },
  {
    id: 'detector-with-no-zone',
    title: 'A detector or call point is in no zone at all',
    severity: 'warn',
    why:
      'When it operates the panel has nowhere to put it: no zone chart row, and a brigade arriving with an '
      + 'address and no part of the building to go to. Most panels write zone 0 for this, which is what a '
      + 'device programmed and never allocated looks like.',
    needs: ['deviceTypes', 'zoneMembership'],
    run: (panel) => hit(fitted(panel.points)
      /*
       * Duct probes are excluded outright. On the real Ipswich Hospital file
       * 14 of the 17 of them carry no zone, and correctly: a duct detector is
       * usually wired as a plant-shutdown input rather than as part of the
       * building's detection, so it has nothing to report to. Leaving them in
       * makes this check fire fourteen times on a configuration that is right.
       */
      .filter((p) => p.deviceType !== 'duct')
      .filter((p) => p.zoneNumber === undefined && (DETECTION.has(p.deviceType) || p.deviceType === 'mcp'))
      .map(nameWithType)),
  },
  {
    id: 'flow-switch-shares-zone',
    title: 'A sprinkler flow switch shares a zone with detectors',
    severity: 'warn',
    why:
      'Nobody reading the panel can tell whether water is moving or a head has gone off. Worth confirming at the '
      + 'panel — the file does not record whether the flow switch is programmed as an alarm or as a supervisory.',
    needs: ['deviceTypes', 'zoneMembership'],
    run: (panel) => {
      const byZone = new Map<number, ConfigPoint[]>();
      for (const p of fitted(panel.points)) {
        if (p.zoneNumber === undefined) continue;
        const list = byZone.get(p.zoneNumber);
        if (list) list.push(p);
        else byZone.set(p.zoneNumber, [p]);
      }
      const shared: string[] = [];
      for (const [zone, points] of byZone) {
        const flow = points.find((p) => p.deviceType === 'sprinkler-flow');
        const detector = points.find((p) => DETECTION.has(p.deviceType));
        if (flow && detector) shared.push(`Zone ${zone}: ${nameWithType(flow)} with ${nameWithType(detector)}`);
      }
      return hit(shared);
    },
  },
  {
    id: 'zone-holds-only-outputs',
    title: 'A zone has nothing in it that can raise an alarm',
    severity: 'note',
    why:
      'It is a zone on the chart that can never go off. Usually a group of sounders or relays that was given a '
      + 'zone number, and at the panel it reads as though it were part of the detection.',
    needs: ['deviceTypes', 'zoneMembership'],
    run: (panel) => {
      const byZone = new Map<number, ConfigPoint[]>();
      for (const p of fitted(panel.points)) {
        if (p.zoneNumber === undefined) continue;
        const list = byZone.get(p.zoneNumber);
        if (list) list.push(p);
        else byZone.set(p.zoneNumber, [p]);
      }
      const outputOnly = [...byZone.entries()]
        .filter(([, points]) => points.length > 0
          && points.every((p) => isOutputDevice(p.deviceType))
          && !points.some((p) => INITIATING.has(p.deviceType)));
      // A panel that deliberately groups its outputs into zones does this on
      // several of them at once, and then it is the design rather than a fault.
      if (outputOnly.length > 3) return undefined;
      return hit(outputOnly.map(([zone, points]) => `Zone ${zone} — ${points.length} output${points.length === 1 ? '' : 's'}, nothing to trigger it`));
    },
  },
  {
    id: 'no-call-point',
    title: 'Nothing in this configuration is programmed as a call point',
    severity: 'note',
    why:
      'Worth confirming before the annual. It is not proof there are none in the building — a call point on a '
      + 'conventional sub-circuit comes into the panel as an input module and looks like any other input.',
    needs: ['deviceTypes'],
    run: (panel) => {
      const live = fitted(panel.points);
      const detection = live.filter((p) => DETECTION.has(p.deviceType)).length;
      if (detection < 5) return undefined;
      if (live.some((p) => p.deviceType === 'mcp')) return undefined;
      // The type map is not the only evidence: a device whose text says call
      // point is one, whatever the file called its type.
      if (live.some((p) => /\b(MCP|CALL\s*POINT|BREAK\s*GLASS|BGA|PULL\s*STATION)\b/i.test(`${p.text} ${p.deviceTypeRaw ?? ''}`))) {
        return undefined;
      }
      /*
       * And not where there is an input module for one to be behind, which is
       * the case that made this a note rather than a warning. Both of the real
       * configurations this was checked against — a 306-device Ampac and a
       * 516-device Pertronic — genuinely carry no call-point device type, and
       * both carry input modules. Asserting the building has no call points
       * there would be an assertion about a conventional circuit this file
       * says nothing about.
       */
      if (live.some((p) => p.deviceType === 'module-input' || p.deviceType === 'module-io')) return undefined;
      return hit([`${detection} detectors, nothing programmed as a call point, and no input module for one to be on`]);
    },
  },
  {
    id: 'nothing-sounds',
    title: 'Nothing in this configuration makes a noise',
    severity: 'note',
    why:
      'On a site with a separate occupant warning system that is exactly right — the warning lives on the other '
      + 'panel and this one only tells it to go. On a site without one, nobody inside gets told.',
    needs: ['deviceTypes'],
    run: (panel, config) => {
      const live = fitted(panel.points);
      if (live.length < 5) return undefined;
      const sounders = live.filter((p) => p.deviceType === 'sounder' || p.deviceType === 'sounder-strobe' || p.deviceType === 'strobe');
      if (sounders.length) return undefined;
      const warns = config.panels
        .flatMap((p) => p.causeEffect)
        .flatMap((r) => r.effects)
        .some((e) => WARNING_EFFECTS.has(e.effectKind));
      if (warns) return undefined;
      return hit(['No sounder, strobe or combined device, and no rule in the logic that sounds one']);
    },
  },
  {
    id: 'effect-drives-missing-device',
    title: 'A rule drives a device that is not in this file',
    severity: 'fail',
    why:
      'The output the logic names is not on the loop. On the day, the cause operates and whatever it was meant to '
      + 'drive does not — and there is nothing at the panel to say why.',
    needs: ['effectsNamePoints'],
    run: (panel, config) => {
      /*
       * The reference set is built across every panel rather than per panel.
       * Kentec hangs a network's whole cause and effect on the first panel
       * while the devices live on the later nodes, so a per-panel set would
       * report every rule on a four-node site as dangling.
       */
      const refs = new Set(
        config.panels.flatMap((p) => p.points)
          .map((p) => canonicalDeviceRef(config.parser, p.pointRef))
          .filter(Boolean),
      );
      if (!refs.size) return undefined;

      const missing: string[] = [];
      for (const rule of panel.causeEffect) {
        for (const effect of rule.effects) {
          for (const target of effectTargets(config.parser, effect.effectLabel)) {
            if (!refs.has(target)) missing.push(`${rule.causeLabel || 'A rule'} drives ${target}`);
          }
        }
      }
      return hit([...new Set(missing)]);
    },
  },
  /*
   * There was a check here called `rule-operates-nothing`: a cause programmed
   * with no effect against it. It is dropped rather than fixed.
   *
   * It fired nine times on the one real configuration whose format could
   * support it, and every one was a Pertronic logic block feeding another
   * logic block through an output group — which is how that panel is
   * programmed, not a rule somebody left half-finished. There is no version of
   * the check that tells those apart from a parsed configuration, and a check
   * that is wrong nine times out of nine on the only file that can run it is
   * worse than no check at all.
   */
  {
    id: 'no-brigade-signal',
    title: 'Nothing in the programmed logic calls the brigade',
    severity: 'note',
    why:
      'On most panels the signalling relay is fixed in the firmware and never appears in the programmable logic, '
      + 'so this is a prompt to confirm it at the panel rather than a defect.',
    needs: ['effectKinds'],
    run: (panel, config) => {
      const anyBrigade = config.panels
        .flatMap((p) => p.causeEffect)
        .flatMap((r) => r.effects)
        .some((e) => e.effectKind === 'brigade-signal');
      if (anyBrigade) return undefined;
      if (!panel.causeEffect.length) return undefined;
      return hit(['No rule in this file signals the brigade']);
    },
  },
  {
    id: 'unrecognised-device-types',
    title: 'Device types this app does not know',
    severity: 'note',
    why:
      'A type this app has never seen gets no default test method, so those devices land on a service sheet '
      + 'with nothing to ask about them and quietly do not get tested. Worth sending the token in — that is how '
      + 'the rest of them got added.',
    /*
     * Deliberately needs no gate. The device-type gate shuts precisely when
     * most types are unknown, which is exactly when this is the one check
     * worth running: it is what explains the silence on every other one.
     */
    needs: [],
    run: (panel) => {
      const tokens = new Map<string, number>();
      for (const p of fitted(panel.points)) {
        if (p.deviceType !== 'unknown') continue;
        // A point with no type string at all says nothing — the real Ipswich
        // file has 915 of them, and they are network and software points
        // rather than devices with an unread type.
        const raw = p.deviceTypeRaw?.trim();
        if (!raw) continue;
        tokens.set(raw, (tokens.get(raw) ?? 0) + 1);
      }
      const sorted = [...tokens.entries()].sort((a, b) => b[1] - a[1]);
      return hit(
        sorted.map(([token, n]) => `${token} — ${n} device${n === 1 ? '' : 's'}`),
        sorted.length === 1
          ? 'One device type this app does not know'
          : `${sorted.length} device types this app does not know`,
      );
    },
  },
  {
    id: 'zones-sharing-a-name',
    title: 'Two zones carry the same name',
    severity: 'note',
    why:
      'The display and the chart cannot tell them apart, so a name on the panel sends whoever is reading it to '
      + 'two places. Common enough on a big site to be worth knowing rather than fixing.',
    needs: ['zoneTable'],
    run: (panel) => {
      const byText = new Map<string, number[]>();
      for (const z of panel.zones) {
        const text = z.text.trim();
        // Blanks, bare numbers and the tool's own filler are not names, and
        // grouping on them collapses the thirty-nine placeholder zones of a
        // real Ampac file into one meaningless finding.
        if (!text || /^\d+$/.test(text) || isPlaceholderZoneText(text, z.number)) continue;
        const key = text.toLowerCase();
        const list = byText.get(key);
        if (list) list.push(z.number);
        else byText.set(key, [z.number]);
      }
      return hit([...byText.entries()]
        .filter(([, numbers]) => numbers.length > 1)
        .map(([text, numbers]) => `"${text}" — zones ${numbers.join(', ')}`));
    },
  },
  {
    id: 'devices-sharing-text',
    title: 'A lot of devices share one description',
    severity: 'note',
    why:
      'The panel names the area rather than the head, so an alarm means walking the whole of it with a torch. It '
      + 'is also the honest basis for quoting a re-text.',
    needs: [],
    run: (panel) => {
      const byText = new Map<string, number>();
      for (const p of fitted(panel.points)) {
        // Outputs are left out: a floor's sounders sharing one description is
        // how they are meant to be programmed, not something to fix.
        if (isOutputDevice(p.deviceType)) continue;
        const text = p.text.trim().toLowerCase();
        // "SPARE" on eight addresses is the panel saying nothing is fitted, not
        // eight devices in one room. The real Pertronic file has exactly that.
        if (!text || NOT_A_PLACE.test(text)) continue;
        byText.set(text, (byText.get(text) ?? 0) + 1);
      }
      const crowded = [...byText.entries()].filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1]);
      if (!crowded.length) return undefined;
      // The top few only. A real hospital file has fifteen groups at a
      // threshold of four, which is a screen of noise rather than a finding.
      return hit(
        crowded.slice(0, 3).map(([text, n]) => `${n} devices all called "${text}"`),
        crowded.length === 1
          ? 'A group of devices shares one description'
          : `${crowded.length} groups of devices share one description`,
        crowded.length,
      );
    },
  },
  {
    id: 'zone-chart-not-derivable',
    title: 'A zone chart cannot be built from this file',
    severity: 'note',
    why:
      'The chart this app prints is only as good as what came out of the file. With no device in a zone it would '
      + 'print every zone empty, which is worse than no chart because it looks like one.',
    needs: ['zoneTable'],
    run: (panel) => {
      if (!panel.zones.length) return undefined;
      const live = fitted(panel.points);
      if (!live.length) return hit([`${panel.zones.length} zones and no devices to put in them`]);
      const zoned = live.filter((p) => p.zoneNumber !== undefined).length;
      if (zoned * 10 >= live.length) return undefined;
      return hit([`${zoned} of ${live.length} devices carry a zone number`]);
    },
  },
  {
    id: 'zone-text-disagrees',
    title: 'A device carries different zone text from the zone table',
    severity: 'note',
    why:
      'The point list and the zone chart will print two different names for the same zone. It is usually a zone '
      + 'renamed after the devices were programmed.',
    needs: ['zoneMembership', 'zoneTable'],
    run: (panel) => {
      const byNumber = new Map(panel.zones.map((z) => [z.number, z.text.trim()]));
      const disagreements = new Map<number, string>();
      for (const p of fitted(panel.points)) {
        if (p.zoneNumber === undefined) continue;
        const onPoint = p.zoneText?.trim();
        const onZone = byNumber.get(p.zoneNumber);
        if (!onPoint || onZone === undefined || !onZone) continue;
        if (onPoint.toLowerCase() !== onZone.toLowerCase()) {
          disagreements.set(p.zoneNumber, `Zone ${p.zoneNumber}: table says "${onZone}", devices say "${onPoint}"`);
        }
      }
      return hit([...disagreements.values()]);
    },
  },
];

/** Every check the verifier knows, for a screen that wants to list them. */
export const CONFIG_CHECKS: readonly { id: string; title: string; severity: FindingSeverity }[] =
  CHECKS.map((c) => ({ id: c.id, title: c.title, severity: c.severity }));

const SEVERITY_ORDER: Record<FindingSeverity, number> = { fail: 0, warn: 1, note: 2 };

/**
 * Runs every check that this file can support.
 *
 * Per panel, because that is what the checks are about, and a file with four
 * panels in it has four zone tables and four sets of addresses. The panel is
 * named on a finding only where there is more than one, since "Panel 1" on
 * every line of a single-panel file is a column of the same word.
 */
export function verifyConfig(config: ParsedConfig): VerifyResult {
  const gates = gatesFor(config);
  const findings: Finding[] = [];
  const skipped: SkippedCheck[] = [];
  const passed: string[] = [];
  const named = config.panels.length > 1;

  for (const check of CHECKS) {
    const blocked = check.needs.map((g) => gates[g]).find((g) => !g.open);
    if (blocked) {
      skipped.push({ id: check.id, title: check.title, because: blocked.because });
      continue;
    }
    const notOn = check.notOn?.[config.parser];
    if (notOn) {
      skipped.push({ id: check.id, title: check.title, because: notOn });
      continue;
    }

    let found = false;
    for (const panel of config.panels) {
      const result = check.run(panel, config);
      if (!result) continue;
      found = true;
      findings.push({
        id: check.id,
        severity: check.severity,
        title: result.title ?? check.title,
        why: check.why,
        count: result.count,
        examples: result.examples,
        panel: named ? (panel.name || undefined) : undefined,
      });
    }
    if (!found) passed.push(check.id);
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || b.count - a.count
    || a.title.localeCompare(b.title));

  return {
    findings,
    skipped,
    passed,
    gates,
    subject: {
      points: config.panels.reduce((n, p) => n + p.points.length, 0),
      zones: config.panels.reduce((n, p) => n + p.zones.length, 0),
      rules: config.panels.reduce((n, p) => n + p.causeEffect.length, 0),
    },
  };
}

/** The one line a screen leads with. */
export function describeVerdict(result: VerifyResult): string {
  const fails = result.findings.filter((f) => f.severity === 'fail').length;
  const warns = result.findings.filter((f) => f.severity === 'warn').length;
  const notes = result.findings.filter((f) => f.severity === 'note').length;

  if (!result.findings.length) {
    const anything = result.subject.points + result.subject.zones + result.subject.rules;
    if (!anything || !result.passed.length) return 'Nothing in this file could be checked.';
    return `Nothing found by the ${result.passed.length} checks this file supports.`;
  }
  const parts: string[] = [];
  if (fails) parts.push(`${fails} to fix`);
  if (warns) parts.push(`${warns} to look at`);
  if (notes) parts.push(`${notes} worth knowing`);
  return parts.join(', ');
}

/** How a device class reads in a finding, for a screen that wants to say it. */
export function deviceLabel(type: DeviceType): string {
  return DEVICE_TYPE_LABEL[type] ?? type;
}
