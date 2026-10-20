import {
  DEFAULT_TEST_METHOD, DEVICE_TYPE_LABEL, isOutputDevice, normaliseDeviceType,
} from '@/parsers/deviceType';

/**
 * Turning a vendor's spelling into a device class.
 *
 * Every panel writes these differently — PHOTO, Optical, SMOKE (PHOTO), ION,
 * MCP, CALL POINT, BGA — and the class decides what test method lands on the
 * service sheet. So a wrong mapping is not a wrong label: it is a device tested
 * the wrong way, or half-tested, and the sheet comes back looking complete.
 *
 * The half-tested case is the one that bit. A combined device is normally
 * written with a slash — "Sounder/Strobe", "Smoke/Heat" — and the slash used to
 * survive normalisation while every multi-word rule joined with \\s*, which does
 * not match one. So the combined device fell through to whichever single rule
 * matched second, and its sheet asked for one of the two tests it needed.
 */

describe('the slash, which is how combined devices are actually written', () => {
  it('reads a sounder/strobe as both, not as a strobe', () => {
    /*
     * The regression that matters. Falling through to the strobe rule puts
     * "Visual check" on the sheet for a device that also has to be sounded, and
     * nothing on the paperwork says the audible test was skipped.
     */
    expect(normaliseDeviceType('Sounder/Strobe')).toBe('sounder-strobe');
    expect(normaliseDeviceType('Sounder/Beacon')).toBe('sounder-strobe');
    expect(normaliseDeviceType('SND/STR')).toBe('sounder-strobe');
  });

  it('reads a smoke/heat head as a multi-sensor, not as a heat', () => {
    // The same failure in the other direction: the smoke test goes missing.
    expect(normaliseDeviceType('Smoke/Heat')).toBe('multi');
    expect(normaliseDeviceType('Optical/Heat')).toBe('multi');
    expect(normaliseDeviceType('Photo/Thermal')).toBe('multi');
  });

  it('reads the same devices written with a space or a hyphen the same way', () => {
    // Whatever the separator, it is the same device. A mapping that depends on
    // punctuation is a mapping that depends on which vendor exported the file.
    for (const sep of ['/', ' ', '-', ' / ']) {
      expect(normaliseDeviceType(`Sounder${sep}Strobe`)).toBe('sounder-strobe');
      expect(normaliseDeviceType(`Smoke${sep}Heat`)).toBe('multi');
    }
  });

  it('still reads an I/O module, which is the one place the slash was handled', () => {
    for (const s of ['I/O Module', 'IO Module', 'I O Unit', 'IOM', 'Input Output Module']) {
      expect({ s, t: normaliseDeviceType(s) }).toEqual({ s, t: 'module-io' });
    }
  });

  it('keeps the ampersand, because OS&Y is a name rather than two words', () => {
    expect(normaliseDeviceType('OS&Y')).toBe('sprinkler-valve');
    expect(normaliseDeviceType('OS & Y valve monitor')).toBe('sprinkler-valve');
  });
});

describe('detectors', () => {
  it('separates ionisation from photoelectric, however each is spelt', () => {
    expect(normaliseDeviceType('ION')).toBe('smoke-ion');
    expect(normaliseDeviceType('Ionisation')).toBe('smoke-ion');
    expect(normaliseDeviceType('Ionization')).toBe('smoke-ion');
    expect(normaliseDeviceType('PHOTO')).toBe('smoke-photo');
    expect(normaliseDeviceType('Photoelectric')).toBe('smoke-photo');
    expect(normaliseDeviceType('Optical')).toBe('smoke-photo');
  });

  it('falls back to plain smoke where the type says nothing more', () => {
    expect(normaliseDeviceType('SMOKE')).toBe('smoke');
    expect(normaliseDeviceType('SMK')).toBe('smoke');
  });

  it('reads a heat detector however the rise is described', () => {
    for (const s of ['HEAT', 'Thermal', 'Temperature', 'ROR', 'Rate of Rise', 'Fixed Temp']) {
      expect({ s, t: normaliseDeviceType(s) }).toEqual({ s, t: 'heat' });
    }
  });

  it('reads the aspirating brands as aspirating', () => {
    for (const s of ['VESDA', 'Aspirating', 'ASD', 'Laser Plus', 'ICAM']) {
      expect({ s, t: normaliseDeviceType(s) }).toEqual({ s, t: 'aspirating' });
    }
  });

  it('reads a beam, a duct head and a flame detector as their own classes', () => {
    expect(normaliseDeviceType('Beam')).toBe('beam');
    expect(normaliseDeviceType('Fireray')).toBe('beam');
    expect(normaliseDeviceType('Duct')).toBe('duct');
    expect(normaliseDeviceType('Flame')).toBe('flame');
  });
});

describe('call points and outputs', () => {
  it('reads every spelling of a manual call point', () => {
    for (const s of ['MCP', 'Call Point', 'Manual Call Point', 'BGA', 'Break Glass', 'Pull Station']) {
      expect({ s, t: normaliseDeviceType(s) }).toEqual({ s, t: 'mcp' });
    }
  });

  it('reads a bell and a horn as sounders', () => {
    expect(normaliseDeviceType('Bell')).toBe('sounder');
    expect(normaliseDeviceType('Horn')).toBe('sounder');
  });

  it('keeps input, output and combined modules apart', () => {
    expect(normaliseDeviceType('Monitor Module')).toBe('module-input');
    expect(normaliseDeviceType('Control Module')).toBe('module-output');
    expect(normaliseDeviceType('Input Output Module')).toBe('module-io');
  });
});

describe('what it refuses to guess', () => {
  it('says unknown rather than picking the nearest class', () => {
    /*
     * The Pertronic lesson, encoded. "ISO" on that panel is captioned "Switch
     * Input (Disable)", not a loop isolator — and reading those three letters
     * the obvious way would have put short-circuit isolators on a service sheet
     * for a building that has none.
     */
    expect(normaliseDeviceType('ISO')).toBe('unknown');
  });

  it('says unknown for nothing at all', () => {
    expect(normaliseDeviceType(undefined)).toBe('unknown');
    expect(normaliseDeviceType(null)).toBe('unknown');
    expect(normaliseDeviceType('')).toBe('unknown');
    expect(normaliseDeviceType('   ')).toBe('unknown');
  });

  it('says unknown for a part number it has no rule for', () => {
    // A part number is not a device class. Guessing one from it is how an
    // invented test method reaches a sheet.
    expect(normaliseDeviceType('M210E-CZR')).toBe('unknown');
    expect(normaliseDeviceType('----')).toBe('unknown');
  });

  it('does not read CO out of a longer word', () => {
    // "Comms fault" is not a carbon monoxide detector.
    expect(normaliseDeviceType('Comms Module')).not.toBe('gas');
    expect(normaliseDeviceType('CO Detector')).toBe('gas');
  });
});

describe('what each class is for', () => {
  it('labels every class it can produce', () => {
    // A class with no label shows as blank on a chip and an export column.
    const produced = new Set(['unknown', 'smoke', 'smoke-photo', 'smoke-ion', 'multi', 'heat',
      'duct', 'beam', 'aspirating', 'flame', 'mcp', 'sounder', 'sounder-strobe', 'strobe',
      'sprinkler-flow', 'sprinkler-valve', 'gas', 'wip', 'door-holder', 'isolator', 'relay',
      'module-io', 'module-output', 'module-input']);
    for (const t of produced) {
      expect({ t, label: typeof DEVICE_TYPE_LABEL[t as keyof typeof DEVICE_TYPE_LABEL] })
        .toEqual({ t, label: 'string' });
    }
  });

  it('gives a combined device a combined test method', () => {
    /*
     * The consequence of the slash bug, stated as a test. If a sounder/strobe
     * maps to strobe, this is the line on the sheet that quietly loses the
     * audible check.
     */
    expect(DEFAULT_TEST_METHOD['sounder-strobe']).toContain('Audible');
    expect(DEFAULT_TEST_METHOD['sounder-strobe']).toContain('visual');
    expect(DEFAULT_TEST_METHOD.multi).toContain('Smoke');
    expect(DEFAULT_TEST_METHOD.multi).toContain('heat');
  });

  it('proposes no test method for a class nobody has established one for', () => {
    // Better a blank a technician fills in than a default that is wrong for the
    // device in their hand.
    expect(DEFAULT_TEST_METHOD.unknown).toBeUndefined();
  });

  it('knows which classes are outputs rather than initiating devices', () => {
    for (const t of ['sounder', 'sounder-strobe', 'strobe', 'module-output', 'relay', 'door-holder'] as const) {
      expect({ t, out: isOutputDevice(t) }).toEqual({ t, out: true });
    }
    for (const t of ['smoke', 'heat', 'mcp', 'module-input', 'beam'] as const) {
      expect({ t, out: isOutputDevice(t) }).toEqual({ t, out: false });
    }
  });
});

describe('the cache', () => {
  it('gives the same answer for the same string every time', () => {
    // Results are memoised by the raw string. A cache that keyed on the
    // normalised form would collide two different spellings.
    const a = normaliseDeviceType('Sounder/Strobe');
    const b = normaliseDeviceType('Sounder/Strobe');
    expect(a).toBe(b);
    expect(a).toBe('sounder-strobe');
  });

  it('does not let one spelling answer for a different one', () => {
    expect(normaliseDeviceType('Strobe')).toBe('strobe');
    expect(normaliseDeviceType('Sounder/Strobe')).toBe('sounder-strobe');
    expect(normaliseDeviceType('Strobe')).toBe('strobe');
  });
});

/**
 * "MONITOR" on its own.
 *
 * It is Notifier's own name for a monitor module point and there are six of
 * them on the real Ipswich Hospital panel, one labelled "MONITOR MODULE" in as
 * many words. Unmapped, each imported with no type — and a device with no type
 * has no test method, so the routine that should operate the input has nothing
 * to ask about it.
 *
 * The rule has to be anchored to the whole string rather than to a word
 * boundary, because a valve monitor and a duct monitor are different devices
 * with different tests. Their rules run first and would win either way, but a
 * rule that is only correct because of where it sits in a list is one edit away
 * from being wrong.
 */
describe('the bare word MONITOR', () => {
  it('is a monitor module', () => {
    expect(normaliseDeviceType('MONITOR')).toBe('module-input');
    expect(normaliseDeviceType('monitor')).toBe('module-input');
    expect(normaliseDeviceType(' Monitor ')).toBe('module-input');
  });

  it('does not swallow the devices that carry the word', () => {
    expect(normaliseDeviceType('VALVE MONITOR')).toBe('sprinkler-valve');
    expect(normaliseDeviceType('DUCT MONITOR')).toBe('duct');
    expect(normaliseDeviceType('MONITOR RELAY')).toBe('relay');
    // And the compound the rule already knew about still reads the same way.
    expect(normaliseDeviceType('MONITOR MODULE')).toBe('module-input');
    expect(normaliseDeviceType('ZONE MONITOR')).toBe('module-input');
  });
});
