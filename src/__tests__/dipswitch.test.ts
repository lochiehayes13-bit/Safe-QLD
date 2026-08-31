import {
  PROTOCOLS,
  XPERT_PIPS,
  addressToRemovedPips,
  addressToRotary,
  addressToSwitches,
  patternToSwitches,
  protocolById,
  removedPipsToAddress,
  rotaryToAddress,
  switchesToAddress,
  switchesToPattern,
  validateAddress,
} from '@/calc/dipswitch';

/**
 * The patterns below are transcribed from manufacturer address charts, so a
 * failure here means the calculator disagrees with the printed sheet a
 * technician has in front of them.
 */

/** Apollo installation guide, 7-way DIL. Pattern is switches 1..7, 1 = ON. */
const APOLLO_CHART: [number, string][] = [
  [1, '1000000'],
  [2, '0100000'],
  [3, '1100000'],
  [4, '0010000'],
  [8, '0001000'],
  [11, '1101000'],
  [16, '0000100'],
  [32, '0000010'],
  [64, '0000001'],
  [100, '0010011'],
  [125, '1011111'],
  [126, '0111111'],
];

/** Hochiki CHQ module address chart, switches 1..7. */
const HOCHIKI_CHART: [number, string][] = [
  [1, '1000000'],
  [2, '0100000'],
  [3, '1100000'],
  [4, '0010000'],
  [64, '0000001'],
  [96, '0000011'],
  [127, '1111111'],
];

describe('binary DIP switches', () => {
  it.each(APOLLO_CHART)('reads Apollo chart address %i from pattern %s', (address, pattern) => {
    expect(switchesToAddress(patternToSwitches(pattern), 7)).toBe(address);
  });

  it.each(APOLLO_CHART)('writes Apollo chart address %i as pattern %s', (address, pattern) => {
    expect(switchesToPattern(addressToSwitches(address, 7), 7)).toBe(pattern);
  });

  it.each(HOCHIKI_CHART)('matches the Hochiki chart at address %i', (address, pattern) => {
    expect(switchesToAddress(patternToSwitches(pattern), 7)).toBe(address);
    expect(switchesToPattern(addressToSwitches(address, 7), 7)).toBe(pattern);
  });

  it('treats the switch printed 1 as the least significant bit', () => {
    expect(switchesToAddress([true, false, false, false, false, false, false], 7)).toBe(1);
    expect(switchesToAddress([false, false, false, false, false, false, true], 7)).toBe(64);
  });

  it('ignores switches beyond the address width', () => {
    // Hochiki switch 8 is an LED flag, not an address bit.
    const withEighthOn = [...addressToSwitches(10, 7), true];
    expect(switchesToAddress(withEighthOn, 7)).toBe(10);
    // Counting it would wrongly add 128.
    expect(switchesToAddress(withEighthOn, 8)).toBe(138);
  });

  it('round-trips every address an 8-way block can hold', () => {
    for (let a = 0; a <= 255; a++) {
      expect(switchesToAddress(addressToSwitches(a, 8), 8)).toBe(a);
    }
  });
});

describe('Apollo XPERT cards', () => {
  it('takes the address from the pips removed, not the pips remaining', () => {
    // Address 11 punches out 1, 2 and 8.
    expect(removedPipsToAddress([1, 2, 8])).toBe(11);
    expect(addressToRemovedPips(11)).toEqual([1, 2, 8]);
  });

  it('agrees with the DIP switch chart for the same address', () => {
    for (const [address] of APOLLO_CHART) {
      const viaSwitches = switchesToAddress(addressToSwitches(address, 7), 7);
      const viaCard = removedPipsToAddress(addressToRemovedPips(address));
      expect(viaCard).toBe(viaSwitches);
    }
  });

  it('omits the 128 pip on an XPERT 7 card', () => {
    expect(addressToRemovedPips(129, false)).toEqual([1]);
    expect(addressToRemovedPips(129, true)).toEqual([1, 128]);
  });

  it('lays pips out in the printed zigzag of pairs', () => {
    expect(XPERT_PIPS.map((p) => p.value)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(XPERT_PIPS[0]).toMatchObject({ value: 1, column: 0, row: 0 });
    expect(XPERT_PIPS[1]).toMatchObject({ value: 2, column: 0, row: 1 });
    expect(XPERT_PIPS[7]).toMatchObject({ value: 128, column: 3, row: 1, onXpert7: false });
  });
});

describe('rotary decade switches', () => {
  it('combines tens and units', () => {
    expect(rotaryToAddress(0, 1)).toBe(1);
    expect(rotaryToAddress(9, 9)).toBe(99);
  });

  it('reaches 159 because the tens dial has sixteen positions', () => {
    expect(rotaryToAddress(15, 9)).toBe(159);
  });

  it('round-trips', () => {
    for (let a = 1; a <= 159; a++) {
      const { tens, units } = addressToRotary(a);
      expect(rotaryToAddress(tens, units)).toBe(a);
    }
  });
});

describe('validation', () => {
  const apollo = protocolById('apollo_xp95')!;
  const hochiki = protocolById('hochiki_esp')!;

  it('rejects address zero as unaddressed rather than valid', () => {
    const issues = validateAddress(0, apollo, 'dip');
    expect(issues.some((i) => i.level === 'error' && i.message.includes('unaddressed'))).toBe(true);
  });

  it('rejects 127 on Apollo but accepts it on Hochiki', () => {
    expect(validateAddress(127, apollo, 'dip').some((i) => i.level === 'error')).toBe(true);
    expect(validateAddress(127, hochiki, 'dip').some((i) => i.level === 'error')).toBe(false);
  });

  it('warns that Hochiki switch 8 is not an address bit', () => {
    expect(validateAddress(10, hochiki, 'dip').some((i) => i.message.includes('switch 8') || i.message.includes('1 to 7'))).toBe(true);
  });

  it('tells you the Hochiki base sounder address', () => {
    expect(validateAddress(10, hochiki, 'dip').some((i) => i.message.includes('137'))).toBe(true);
  });

  it('warns that XPERT pips are punched out, not left in', () => {
    expect(validateAddress(11, apollo, 'xpert7').some((i) => i.message.includes('punch'))).toBe(true);
  });

  it('warns about the moulded stop above 99 on rotary dials', () => {
    const notifier = protocolById('notifier_flashscan')!;
    expect(validateAddress(120, notifier, 'rotary').some((i) => i.message.includes('stop'))).toBe(true);
  });

  it('rejects an address above the protocol maximum', () => {
    const clip = protocolById('notifier_clip')!;
    expect(validateAddress(120, clip, 'rotary').some((i) => i.level === 'error')).toBe(true);
  });

  it('accepts a valid address without errors', () => {
    expect(validateAddress(64, apollo, 'dip').some((i) => i.level === 'error')).toBe(false);
  });
});

describe('protocol catalogue', () => {
  it('uses unique ids', () => {
    expect(new Set(PROTOCOLS.map((p) => p.id)).size).toBe(PROTOCOLS.length);
  });

  it('gives every protocol a sane address range', () => {
    for (const p of PROTOCOLS) {
      expect(p.minAddress).toBeGreaterThanOrEqual(1);
      expect(p.maxAddress).toBeGreaterThan(p.minAddress);
      expect(p.methods.length).toBeGreaterThan(0);
    }
  });

  it('caps switch-addressed protocols within what the switches can encode', () => {
    for (const p of PROTOCOLS) {
      if (p.switchCount) expect(p.maxAddress).toBeLessThanOrEqual(2 ** p.switchCount - 1);
    }
  });
});
