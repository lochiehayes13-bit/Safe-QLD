import { readFileSync, existsSync } from 'node:fs';
import { CONFIG_CHECKS, describeVerdict, gatesFor, verifyConfig } from '@/domain/configVerify';
import { classifyBytes } from '@/parsers';
import type { CauseEffectRule, ParsedConfig, ParsedPanel, Point, Zone } from '@/domain/types';

/**
 * Checking a configuration.
 *
 * The failure that would sink this feature is not a missed finding, it is a
 * confident wrong one. A technician shown a hundred duplicate addresses that
 * are two network nodes, or a hundred unknown device types that are one
 * reader's blind spot, stops opening the screen — and then the real findings
 * go unread as well.
 *
 * So most of what is pinned here is the refusal: which checks must not run on
 * which formats, and why. Three of these are regressions against real
 * customer files. They are named in the comments rather than shipped as
 * fixtures, because those files are not ours to put in a repository.
 */

type ConfigPoint = Omit<Point, 'id' | 'panelId'>;
type ConfigZone = Omit<Zone, 'id' | 'panelId'>;
type ConfigRule = Omit<CauseEffectRule, 'id' | 'panelId'>;

function point(over: Partial<ConfigPoint> = {}): ConfigPoint {
  return { text: 'DEVICE', deviceType: 'smoke-photo', unused: false, ...over };
}

function zone(number: number, text: string, unused = false): ConfigZone {
  return { number, text, unused };
}

function panel(over: Partial<ParsedPanel> = {}): ParsedPanel {
  return {
    name: 'MAIN', brand: 'ampac', loops: [], zones: [], points: [], causeEffect: [], ...over,
  };
}

function config(over: Partial<ParsedConfig> = {}): ParsedConfig {
  return { brand: 'ampac', parser: 'test@1', warnings: [], panels: [panel()], ...over };
}

/** The finding with that id, or a failure that lists the ones there were. */
function finding(result: ReturnType<typeof verifyConfig>, id: string) {
  const found = result.findings.find((f) => f.id === id);
  if (!found) {
    throw new Error(`No finding "${id}". Found: ${result.findings.map((f) => f.id).join(', ') || '(none)'}`);
  }
  return found;
}

function skipReason(result: ReturnType<typeof verifyConfig>, id: string): string {
  const found = result.skipped.find((s) => s.id === id);
  if (!found) throw new Error(`"${id}" was not skipped. Skipped: ${result.skipped.map((s) => s.id).join(', ')}`);
  return found.because;
}

describe('the gates', () => {
  it('shut the type gate when most devices came back unknown', () => {
    const gates = gatesFor(config({
      panels: [panel({
        points: [point({ deviceType: 'unknown' }), point({ deviceType: 'unknown' }), point()],
      })],
    }));
    expect(gates.deviceTypes.open).toBe(false);
    expect(gates.deviceTypes.because).toContain('1 of 3');
  });

  it('leave the type gate open when most devices are named', () => {
    const gates = gatesFor(config({
      panels: [panel({ points: [point(), point(), point({ deviceType: 'unknown' })] })],
    }));
    expect(gates.deviceTypes.open).toBe(true);
  });

  it('shut the zone gate when nothing carries a zone number', () => {
    const gates = gatesFor(config({ panels: [panel({ points: [point()] })] }));
    expect(gates.zoneMembership.open).toBe(false);
    expect(gates.zoneMembership.because).toContain('zone number');
  });

  it('give a different reason when there are no devices at all', () => {
    // "No device carries a zone number" is true of an empty file and useless.
    const gates = gatesFor(config({ panels: [panel()] }));
    expect(gates.zoneMembership.because).toContain('no devices');
  });

  it('are narrowed by what a reader cannot say, even where the data looks fine', () => {
    /*
     * Nothing in this parse shows the problem: there are effects, and they
     * have kinds, and none of them is 'other'. What the data cannot show is
     * that the Ampac reader does not work one out at all — the parse below is
     * not one this reader could produce, which is exactly why the fact has to
     * be written down rather than inferred.
     */
    const gates = gatesFor(config({
      parser: 'ampac-ffp@1',
      panels: [panel({
        points: [point()],
        causeEffect: [{
          causeLabel: 'Zone 1',
          causeKind: 'zone-alarm',
          effects: [{ id: 'e', effectLabel: 'SOUNDERS', effectKind: 'sounders', state: 'operates' }],
        }],
      })],
    }));
    expect(gates.effectKinds.open).toBe(false);
    expect(gates.effectKinds.because).toContain('does not work out what an effect does');
  });

  it('are never opened by a reader limit, only narrowed', () => {
    // Kentec's entry says nothing about zone membership, and the data here has
    // none, so the gate stays shut rather than being reopened by the lookup.
    const gates = gatesFor(config({ parser: 'kentec-nle@1', panels: [panel({ points: [point()] })] }));
    expect(gates.zoneMembership.open).toBe(false);
  });
});

describe('two devices on one address', () => {
  it('is found where the addresses really do collide', () => {
    const result = verifyConfig(config({
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 12, text: 'LOBBY SMOKE' }),
          point({ loopNumber: 1, address: 12, text: 'STORE SMOKE' }),
        ],
      })],
    }));
    expect(finding(result, 'duplicate-address').count).toBe(1);
    expect(finding(result, 'duplicate-address').examples[0]).toContain('LOBBY SMOKE / STORE SMOKE');
  });

  it('is keyed on the panel’s own reference where every device has one', () => {
    /*
     * The regression. Pertronic writes L01D001 for a detector and L01M001 for
     * a module, and both sit at loop 1 address 1 — they are different devices
     * in different numbering spaces. Keyed on loop and address this reported
     * 81 collisions on the real Vaxxas file and every one was wrong.
     */
    const result = verifyConfig(config({
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 1, pointRef: 'L01D001', text: 'OFFICE SMOKE' }),
          point({ loopNumber: 1, address: 1, pointRef: 'L01M001', text: 'PLANT ROOM STROBE', deviceType: 'strobe' }),
        ],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'duplicate-address')).toBeUndefined();
  });

  it('still finds a reference that really is written twice', () => {
    const result = verifyConfig(config({
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 1, pointRef: 'L01D001', text: 'A' }),
          point({ loopNumber: 1, address: 1, pointRef: 'L01D001', text: 'B' }),
        ],
      })],
    }));
    expect(finding(result, 'duplicate-address').count).toBe(1);
  });

  it('says the file holds two copies rather than listing eighty pairs', () => {
    // Which is what a reader that missed Pertronic's "Start of Reference Panel
    // Config" banner would produce: the live configuration and the panel's
    // last read-back, both brought through as devices.
    const twice = Array.from({ length: 40 }, (_, i) => point({
      loopNumber: 1, address: (i % 20) + 1, text: `DEVICE ${(i % 20) + 1}`,
    }));
    const result = verifyConfig(config({ panels: [panel({ points: twice })] }));
    const found = finding(result, 'duplicate-address');
    expect(found.title).toBe('This file appears to hold the configuration twice');
    expect(found.count).toBe(40);
  });

  it('lists the pairs on a panel too small for a proportion to mean anything', () => {
    const result = verifyConfig(config({
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 1, text: 'A' }),
          point({ loopNumber: 1, address: 1, text: 'B' }),
        ],
      })],
    }));
    expect(finding(result, 'duplicate-address').title).toBe('Two devices answer to the same address');
  });

  it('leaves spare addresses out of it', () => {
    const result = verifyConfig(config({
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 12, text: 'LOBBY' }),
          point({ loopNumber: 1, address: 12, text: '', unused: true }),
        ],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'duplicate-address')).toBeUndefined();
  });

  it('still runs on a flattened network, because the node is in the reference', () => {
    /*
     * Ampac reads a whole network into one panel, which for a while was reason
     * enough here to skip this check altogether. It was not: the reader writes
     * the node into every reference as `N1L1P001`, so node 1 address 12 and
     * node 2 address 12 are two different keys and the check is safe. What the
     * flattening costs is said separately, by `network-flattened`.
     */
    const result = verifyConfig(config({
      parser: 'ampac-ffp@1',
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 12, pointRef: 'N1L1P012', text: 'NORTH LOBBY' }),
          point({ loopNumber: 1, address: 12, pointRef: 'N2L1P012', text: 'SOUTH LOBBY' }),
        ],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'duplicate-address')).toBeUndefined();
    expect(finding(result, 'network-flattened').examples[0]).toContain('node 1, node 2');
  });

  it('is skipped where the network is flattened and there is no reference to fall back on', () => {
    const result = verifyConfig(config({
      parser: 'ampac-ffp@1',
      panels: [panel({
        points: [
          point({ loopNumber: 1, address: 12, pointRef: 'N1L1P012' }),
          point({ loopNumber: 1, address: 12, pointRef: 'N2L1P012' }),
          point({ loopNumber: 1, address: 13 }),
        ],
      })],
    }));
    expect(skipReason(result, 'duplicate-address')).toContain('nothing left to tell');
  });

  it('says so when a Notifier file is one node of a network', () => {
    const result = verifyConfig(config({
      parser: 'notifier-pci@1',
      panels: [panel({ nodeNumber: 3, points: [point({ pointRef: '0.4.O1' })] })],
    }));
    expect(finding(result, 'network-flattened').examples[0]).toContain('node 3');
  });

  it('never claims a file is a single-panel site', () => {
    // The absence of the fact is not evidence of the opposite: Pertronic,
    // Vigilant and a column-mapped CSV carry no node at all.
    const result = verifyConfig(config({
      parser: 'pertronic-util@1',
      panels: [panel({ points: [point({ pointRef: 'L01D001' })] })],
    }));
    expect(result.findings.find((f) => f.id === 'network-flattened')).toBeUndefined();
  });
});

describe('zones', () => {
  const withZones = (zones: ConfigZone[], points: ConfigPoint[]) =>
    verifyConfig(config({ panels: [panel({ zones, points })] }));

  it('reports a zone that has devices on it and no name', () => {
    const result = withZones(
      [zone(1, 'LEVEL 1'), zone(2, '')],
      [point({ zoneNumber: 1 }), point({ zoneNumber: 2 })],
    );
    expect(finding(result, 'zone-untexted').examples[0]).toContain('Zone 2');
  });

  it('says nothing where the format carries no zone names at all', () => {
    // An F4000 has no zone text anywhere. Reporting every zone would be a
    // statement about the format, not about the building.
    const result = withZones([zone(1, ''), zone(2, '')], [point({ zoneNumber: 1 }), point({ zoneNumber: 2 })]);
    expect(result.findings.find((f) => f.id === 'zone-untexted')).toBeUndefined();
  });

  it('reports the programming tool’s own filler as its own thing', () => {
    // 39 of 54 zones on a real Ampac file still read "ZONE n". It is not a
    // blank and it is not a name, and it needs its own sentence.
    const result = withZones([zone(7, 'ZONE 7')], [point({ zoneNumber: 7 })]);
    expect(finding(result, 'zone-placeholder-text').title).toContain('default name');
  });

  it('does not call a real name filler because it has a number in it', () => {
    const result = withZones([zone(7, 'LEVEL 7 EAST')], [point({ zoneNumber: 7 })]);
    expect(result.findings.find((f) => f.id === 'zone-placeholder-text')).toBeUndefined();
  });

  it('reports devices reporting to a zone the table does not hold', () => {
    const result = withZones([zone(1, 'LEVEL 1')], [point({ zoneNumber: 1 }), point({ zoneNumber: 9 })]);
    expect(finding(result, 'zone-not-in-table').examples[0]).toContain('Zone 9');
  });

  it('does not run that check on a reader that invents the missing zone', () => {
    const result = verifyConfig(config({
      parser: 'notifier-pci@1',
      panels: [panel({ zones: [zone(1, 'A')], points: [point({ zoneNumber: 9 })] })],
    }));
    expect(skipReason(result, 'zone-not-in-table')).toContain('creates a zone record');
  });

  it('reports two zone records sharing a number', () => {
    const result = withZones([zone(3, 'PLANT'), zone(3, 'PLANT ROOM')], [point({ zoneNumber: 3 })]);
    expect(finding(result, 'duplicate-zone-number').examples[0]).toBe('Zone 3: PLANT / PLANT ROOM');
  });

  it('reports two zones sharing a name, ignoring filler', () => {
    const result = withZones(
      [zone(1, 'ZONE 1'), zone(2, 'ZONE 2'), zone(40, 'Tynan Level 1'), zone(41, 'Tynan Level 1')],
      [point({ zoneNumber: 40 })],
    );
    const shared = finding(result, 'zones-sharing-a-name');
    expect(shared.count).toBe(1);
    expect(shared.examples[0]).toContain('zones 40, 41');
  });
});

describe('devices with no zone', () => {
  it('reports a detector that is in none', () => {
    const result = verifyConfig(config({
      panels: [panel({
        zones: [zone(1, 'LEVEL 1')],
        points: [point({ zoneNumber: 1 }), point({ text: 'STAIR SMOKE' })],
      })],
    }));
    expect(finding(result, 'detector-with-no-zone').examples[0]).toContain('STAIR SMOKE');
  });

  it('leaves duct probes out of it', () => {
    /*
     * The regression. On the real Ipswich Hospital file 14 of the 17 duct
     * probes carry no zone, and correctly — a duct detector is usually a
     * plant-shutdown input rather than part of the building's detection, so it
     * has nothing to report to.
     */
    const result = verifyConfig(config({
      panels: [panel({
        zones: [zone(1, 'LEVEL 1')],
        points: [point({ zoneNumber: 1 }), point({ deviceType: 'duct', text: 'AHU 3 DUCT' })],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'detector-with-no-zone')).toBeUndefined();
  });
});

describe('call points', () => {
  const detectors = (n: number) => Array.from({ length: n }, (_, i) => point({ text: `SMOKE ${i}` }));

  it('are reported missing where nothing could be hiding one', () => {
    const result = verifyConfig(config({ panels: [panel({ points: detectors(10) })] }));
    expect(finding(result, 'no-call-point').severity).toBe('note');
  });

  it('are not reported where there is an input module for one to be behind', () => {
    /*
     * Both real configurations this was checked against — a 306-device Ampac
     * and a 516-device Pertronic — carry no call-point device type and do
     * carry input modules. A call point on a conventional sub-circuit arrives
     * at the panel as an input module and looks like any other input, so
     * asserting the building has none would be an assertion about a circuit
     * the file says nothing about.
     */
    const result = verifyConfig(config({
      panels: [panel({ points: [...detectors(10), point({ deviceType: 'module-input', text: 'CONV ZONE 1' })] })],
    }));
    expect(result.findings.find((f) => f.id === 'no-call-point')).toBeUndefined();
  });

  it('are not reported where a device says it is one whatever its type says', () => {
    const result = verifyConfig(config({
      panels: [panel({ points: [...detectors(10), point({ deviceType: 'unknown', text: 'LEVEL 2 BREAK GLASS' })] })],
    }));
    expect(result.findings.find((f) => f.id === 'no-call-point')).toBeUndefined();
  });
});

describe('device types this app does not know', () => {
  it('names the token and how many carry it', () => {
    const result = verifyConfig(config({
      panels: [panel({
        points: [
          point({ deviceType: 'unknown', deviceTypeRaw: 'FAN SWITCH' }),
          point({ deviceType: 'unknown', deviceTypeRaw: 'FAN SWITCH' }),
          point({ deviceType: 'unknown', deviceTypeRaw: 'FAN STATUS' }),
        ],
      })],
    }));
    const found = finding(result, 'unrecognised-device-types');
    expect(found.count).toBe(2);
    expect(found.examples[0]).toBe('FAN SWITCH — 2 devices');
  });

  it('runs even when the type gate is shut, because it is what explains the silence', () => {
    const result = verifyConfig(config({
      panels: [panel({ points: [point({ deviceType: 'unknown', deviceTypeRaw: 'X' })] })],
    }));
    expect(result.gates.deviceTypes.open).toBe(false);
    expect(result.findings.some((f) => f.id === 'unrecognised-device-types')).toBe(true);
  });

  it('ignores points that carry no type string at all', () => {
    // The real Ipswich file has 915 of them and they are network and software
    // points, not devices with an unread type.
    const result = verifyConfig(config({ panels: [panel({ points: [point({ deviceType: 'unknown' })] })] }));
    expect(result.findings.find((f) => f.id === 'unrecognised-device-types')).toBeUndefined();
  });
});

describe('devices sharing one description', () => {
  const many = (text: string, n: number) => Array.from({ length: n }, () => point({ text }));

  it('reports a crowded description and counts the groups, not the examples', () => {
    const result = verifyConfig(config({
      panels: [panel({ points: [...many('LEVEL 1 CAR PARK', 14), ...many('CORRIDOR', 9)] })],
    }));
    const found = finding(result, 'devices-sharing-text');
    expect(found.count).toBe(2);
    expect(found.examples[0]).toBe('14 devices all called "level 1 car park"');
  });

  it('ignores a description that names a state rather than a place', () => {
    const result = verifyConfig(config({ panels: [panel({ points: many('SPARE', 12) })] }));
    expect(result.findings.find((f) => f.id === 'devices-sharing-text')).toBeUndefined();
  });

  it('ignores outputs, which are meant to share one', () => {
    const result = verifyConfig(config({
      panels: [panel({ points: Array.from({ length: 12 }, () => point({ text: 'LEVEL 3 SOUNDERS', deviceType: 'sounder' })) })],
    }));
    expect(result.findings.find((f) => f.id === 'devices-sharing-text')).toBeUndefined();
  });
});

describe('loops', () => {
  it('reports devices on a loop the panel never declares', () => {
    const result = verifyConfig(config({
      panels: [panel({ loops: [{ number: 1 }], points: [point({ loopNumber: 2, address: 1 })] })],
    }));
    expect(finding(result, 'point-on-undeclared-loop').examples[0]).toContain('Loop 2');
  });

  it('says nothing where the file declares no loops at all', () => {
    // Silence there is the reader not having read them, not a fault.
    const result = verifyConfig(config({ panels: [panel({ points: [point({ loopNumber: 2, address: 1 })] })] }));
    expect(result.findings.find((f) => f.id === 'point-on-undeclared-loop')).toBeUndefined();
  });

  it('notes a declared loop with nothing on it', () => {
    const result = verifyConfig(config({
      panels: [panel({ loops: [{ number: 1 }, { number: 2 }], points: [point({ loopNumber: 1, address: 1 })] })],
    }));
    expect(finding(result, 'loop-declared-empty').examples[0]).toContain('Loop 2');
  });

  it('reports an address the loop protocol cannot poll', () => {
    const result = verifyConfig(config({
      panels: [panel({
        loops: [{ number: 1, protocol: 'apollo-xp95' }],
        points: [point({ loopNumber: 1, address: 200, text: 'PLANT' })],
      })],
    }));
    expect(finding(result, 'address-above-protocol').examples[0]).toContain('126');
  });

  it('says nothing about a protocol the addressing tables do not cover', () => {
    // 'system-sensor' maps to two Notifier protocols with different ceilings,
    // and picking one would decide whether a device reads as unpollable.
    const result = verifyConfig(config({
      panels: [panel({
        loops: [{ number: 1, protocol: 'system-sensor' }],
        points: [point({ loopNumber: 1, address: 240 })],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'address-above-protocol')).toBeUndefined();
  });
});

describe('cause and effect', () => {
  const rule = (over: Partial<ConfigRule> = {}): ConfigRule => ({
    causeLabel: 'Zone 1 alarm', causeKind: 'zone-alarm', effects: [], ...over,
  });

  it('reports an effect that drives a device the file does not hold', () => {
    const result = verifyConfig(config({
      parser: 'pertronic-util@1',
      panels: [panel({
        points: [point({ pointRef: 'L01M001', loopNumber: 1, address: 1 })],
        causeEffect: [rule({
          effects: [{ id: 'e1', effectLabel: 'L02M099', effectKind: 'relay-output', state: 'operates' }],
        })],
      })],
    }));
    expect(finding(result, 'effect-drives-missing-device').examples[0]).toContain('L02M099');
  });

  it('says nothing about an effect that is a name rather than a device reference', () => {
    const result = verifyConfig(config({
      parser: 'pertronic-util@1',
      panels: [panel({
        points: [point({ pointRef: 'L01M001', loopNumber: 1, address: 1 })],
        causeEffect: [rule({
          effects: [{ id: 'e1', effectLabel: 'WARNING SYSTEM', effectKind: 'sounders', state: 'operates' }],
        })],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'effect-drives-missing-device')).toBeUndefined();
  });

  it('reads a Kentec target out of the composite label and nothing else from it', () => {
    /*
     * Kentec writes "<rule name> → L2D103". Searching the whole label would
     * also match anything in the rule's own name, and a loose L\d+D\d+ matches
     * L2D102 inside L2D102.1 — a different device, and a dangling target
     * invented by the search rather than found in the file.
     */
    const clean = verifyConfig(config({
      parser: 'kentec-nle@1',
      panels: [panel({
        points: [point({ pointRef: 'L2D102.1', loopNumber: 2, address: 102, subAddress: 1 })],
        causeEffect: [rule({
          effects: [{
            id: 'e1',
            effectLabel: 'Roller Shutter Release O/P (30s Delay) \u2192 L2D102.1',
            effectKind: 'other',
            state: 'operates',
          }],
        })],
      })],
    }));
    expect(clean.findings.find((f) => f.id === 'effect-drives-missing-device')).toBeUndefined();

    const dangling = verifyConfig(config({
      parser: 'kentec-nle@1',
      panels: [panel({
        points: [point({ pointRef: 'L2D102.1', loopNumber: 2, address: 102, subAddress: 1 })],
        causeEffect: [rule({
          effects: [{ id: 'e1', effectLabel: 'Stage alarm \u2192 L2D103', effectKind: 'other', state: 'operates' }],
        })],
      })],
    }));
    expect(finding(dangling, 'effect-drives-missing-device').examples[0]).toContain('L2D103');
  });

  it('ignores a Kentec target that is not a loop device', () => {
    // "Panel I/O 3" and "I/O module 2 channel 1" are written into a namespace
    // the point references cannot match, and "unresolved target" is a sentinel
    // rather than a device.
    for (const target of ['Zone 4', 'Panel I/O 3', 'I/O module 2 channel 1', 'unresolved target']) {
      const result = verifyConfig(config({
        parser: 'kentec-nle@1',
        panels: [panel({
          points: [point({ pointRef: 'L1D1' })],
          causeEffect: [rule({
            effects: [{ id: 'e1', effectLabel: `Something \u2192 ${target}`, effectKind: 'other', state: 'operates' }],
          })],
        })],
      }));
      expect(result.findings.find((f) => f.id === 'effect-drives-missing-device')).toBeUndefined();
    }
  });

  it('reads every device out of a Pertronic output group expansion', () => {
    const result = verifyConfig(config({
      parser: 'pertronic-util@1',
      panels: [panel({
        points: [point({ pointRef: 'L02M064' }), point({ pointRef: 'L02M063' })],
        causeEffect: [rule({
          effects: [{
            id: 'e1',
            effectLabel: 'G001 = L02M064, L02M063, L02M099',
            effectKind: 'relay-output',
            state: 'operates',
          }],
        })],
      })],
    }));
    const found = finding(result, 'effect-drives-missing-device');
    expect(found.count).toBe(1);
    expect(found.examples[0]).toContain('L02M099');
  });

  it('is not troubled by Pertronic spelling the same device two ways', () => {
    // A device is defined as L01M001 and referred to from a logic block as
    // L01M1. Both are the same device and the parser's own canonicalisation
    // says so.
    const result = verifyConfig(config({
      parser: 'pertronic-util@1',
      panels: [panel({
        points: [point({ pointRef: 'L01M001' })],
        causeEffect: [rule({
          effects: [{ id: 'e1', effectLabel: 'L01M1 "STROBE"', effectKind: 'sounders', state: 'operates' }],
        })],
      })],
    }));
    expect(result.findings.find((f) => f.id === 'effect-drives-missing-device')).toBeUndefined();
  });

  it('does not run on a reader whose effects cannot name a device', () => {
    const result = verifyConfig(config({
      parser: 'ampac-ffp@1',
      panels: [panel({ points: [point()], causeEffect: [rule()] })],
    }));
    expect(skipReason(result, 'effect-drives-missing-device')).toContain('token');
  });
});

describe('the result', () => {
  it('puts what to fix before what to look at before what to know', () => {
    const result = verifyConfig(config({
      panels: [panel({
        zones: [zone(1, ''), zone(2, 'ZONE 2')],
        points: [
          point({ loopNumber: 1, address: 1, zoneNumber: 1, text: 'A' }),
          point({ loopNumber: 1, address: 1, zoneNumber: 2, text: 'B' }),
        ],
      })],
    }));
    const severities = result.findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) =>
      ['fail', 'warn', 'note'].indexOf(a) - ['fail', 'warn', 'note'].indexOf(b)));
  });

  it('names the panel only where the file has more than one', () => {
    const zones = [zone(1, ''), zone(2, 'LEVEL 2')];
    const points = [point({ zoneNumber: 1 }), point({ zoneNumber: 2 })];

    const one = verifyConfig(config({ panels: [panel({ zones, points })] }));
    expect(finding(one, 'zone-untexted').panel).toBeUndefined();

    const two = verifyConfig(config({
      panels: [panel({ name: 'NORTH', zones, points }), panel({ name: 'SOUTH' })],
    }));
    expect(finding(two, 'zone-untexted').panel).toBe('NORTH');
  });

  it('every skipped check carries a reason somebody can read', () => {
    const result = verifyConfig(config({ parser: 'ncf-site@1', panels: [panel({ zones: [zone(1, 'A')] })] }));
    expect(result.skipped.length).toBeGreaterThan(0);
    for (const s of result.skipped) {
      expect(s.because.length).toBeGreaterThan(20);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it('never counts a check as both run and skipped', () => {
    const result = verifyConfig(config({
      panels: [panel({ zones: [zone(1, '')], points: [point({ zoneNumber: 1, loopNumber: 1, address: 1 })] })],
    }));
    const ran = new Set([...result.passed, ...result.findings.map((f) => f.id)]);
    for (const s of result.skipped) expect(ran.has(s.id)).toBe(false);
    expect(ran.size + result.skipped.length).toBe(CONFIG_CHECKS.length);
  });

  it('leads with the reason a file looks empty, rather than with a clean verdict', () => {
    // A screen with no devices, no loops and no logic on it reads as a panel
    // with nothing programmed, which is a completely different thing from a
    // format that carries no device list.
    const empty = verifyConfig(config({ parser: 'ncf-site@1', panels: [panel({ zones: [zone(1, 'FOYER')] })] }));
    expect(finding(empty, 'nothing-came-across').examples[0]).toContain('1 zones and no devices');
  });

  it('says nothing could be checked where there is not even a panel', () => {
    // The two read the same on a screen and mean opposite things.
    const nothing = verifyConfig(config({ parser: 'ncf-site@1', panels: [] }));
    expect(describeVerdict(nothing)).toBe('Nothing in this file could be checked.');
  });

  it('counts the checks that ran when it says nothing was found', () => {
    const clean = verifyConfig(config({
      panels: [panel({
        loops: [{ number: 1 }],
        zones: [zone(1, 'LEVEL 1')],
        points: [point({ loopNumber: 1, address: 1, zoneNumber: 1, zoneText: 'LEVEL 1' })],
      })],
    }));
    expect(clean.findings).toEqual([]);
    expect(describeVerdict(clean)).toMatch(/^Nothing found by the \d+ checks/);
  });
});

describe('every check', () => {
  it('has a unique id', () => {
    const ids = CONFIG_CHECKS.map((c) => c.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('is worth having, rather than being a list of one', () => {
    expect(CONFIG_CHECKS.length).toBeGreaterThan(10);
  });
});

/**
 * Against the real files, when they are on the machine.
 *
 * Customer configurations are not ours to commit, so these skip on CI and run
 * for whoever has the samples. What they hold to is the thing the unit tests
 * above cannot: that on four real buildings the verifier is quiet, and every
 * finding it does raise is one a technician would act on. The first pass of it
 * reported 81 duplicate addresses and two missing call points across those
 * four files, and every one of the 83 was wrong.
 */
const REAL = ['ampac.ffp', 'notifier.pci', 'taktis.nle', 'pertronic-f220.util'];

describe('real configurations', () => {
  for (const fileName of REAL) {
    const path = `/tmp/panels/${fileName}`;
    (existsSync(path) ? it : it.skip)(`${fileName} raises nothing a technician would dismiss`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const kind = classifyBytes(fileName, bytes);
      const parsed = kind.parser?.parseBytes
        ? kind.parser.parseBytes(bytes, fileName)
        : kind.parser?.parse?.(new TextDecoder().decode(bytes), fileName);
      expect(parsed).toBeDefined();
      const result = verifyConfig(parsed!);

      // Nothing on a working building should read as something to fix.
      expect(result.findings.filter((f) => f.severity === 'fail')).toEqual([]);
      // And the answer has to be short enough to read standing up.
      expect(result.findings.length).toBeLessThanOrEqual(6);
      // Every skipped check says why, on a real file as much as a made-up one.
      for (const s of result.skipped) expect(s.because.length).toBeGreaterThan(20);
    });
  }
});
