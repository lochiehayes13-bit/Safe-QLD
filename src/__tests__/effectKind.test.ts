import { effectKindFromLabel } from '@/parsers/effectKind';

/**
 * Classifying an output from its programmed label.
 *
 * A cause-and-effect matrix is a commissioning document. An output classed
 * "other" is a prompt to go and look at it; one confidently classed "brigade
 * signal" when it is a door release is a false record of how a building
 * behaves in a fire. So the tests that matter here are the ones about not
 * matching.
 */

describe('classifying what the label plainly says', () => {
  const cases: [string, ReturnType<typeof effectKindFromLabel>][] = [
    ['BRIGADE SIGNAL', 'brigade-signal'],
    ['EAST BLOCK ASE', 'brigade-signal'],
    ['ALARM SIGNALLING EQUIPMENT', 'brigade-signal'],
    ['EVAC TRIP FT 2-1', 'evacuation'],
    ['EWIS RELAY', 'evacuation'],
    ['STAIR PRESSURISATION FAN', 'pressurisation'],
    ['SMOKE EXHAUST FAN 3', 'smoke-control'],
    ['FIRE DAMPER LEVEL 2', 'damper-close'],
    ['LIFT HOMING', 'lift-homing'],
    ['LV2 SEC DOOR RELEASE', 'door-release'],
    ['ROLLER SHUTTER STAGE', 'door-release'],
    ['AHU 3 SHUTDOWN', 'ahu-shutdown'],
    ['FCU-02', 'ahu-shutdown'],
    ['GAS RELEASE SOLENOID', 'gas-release'],
    ['STAGE ALARM BEACON', 'strobes'],
    ['MEZZ STROBE', 'strobes'],
    ['BELL OUTPUT', 'sounders'],
    ['OCCUPANT WARNING SYSTEM', 'occupant-warning'],
    ['MSSB SHUTDOWN - PLANTROOM', 'plant-shutdown'],
  ];

  for (const [label, expected] of cases) {
    it(`reads "${label}" as ${expected}`, () => {
      expect(effectKindFromLabel(label)).toBe(expected);
    });
  }
});

describe('declining to classify', () => {
  it('returns nothing for a label that names no function', () => {
    expect(effectKindFromLabel('SPARE')).toBeNull();
    expect(effectKindFromLabel('RELAY 01')).toBeNull();
    expect(effectKindFromLabel('OUTPUT 4')).toBeNull();
    expect(effectKindFromLabel('BMS - ALARM')).toBeNull();
  });

  it('returns nothing for an empty or missing label', () => {
    expect(effectKindFromLabel('')).toBeNull();
    expect(effectKindFromLabel('   ')).toBeNull();
    expect(effectKindFromLabel(undefined)).toBeNull();
    expect(effectKindFromLabel(null)).toBeNull();
  });

  it('does not match a word inside a longer one', () => {
    // "ASE" inside "PHASE" or "BASEMENT" must not read as brigade signalling —
    // that is the one output where a wrong classification matters most.
    expect(effectKindFromLabel('BASEMENT CAR PARK')).toBeNull();
    expect(effectKindFromLabel('PHASE MONITOR')).toBeNull();
    expect(effectKindFromLabel('LIFTING STATION')).toBeNull();
  });
});

describe('order between overlapping rules', () => {
  it('puts brigade signalling ahead of anything looser', () => {
    // "BRIGADE ALARM BELL" mentions a bell, but what it is is the brigade
    // signal, and a bell is a thing you can silence.
    expect(effectKindFromLabel('BRIGADE ALARM BELL')).toBe('brigade-signal');
  });

  it('treats a bare shutdown as plant control only once nothing else claims it', () => {
    expect(effectKindFromLabel('SHUTDOWN')).toBe('plant-shutdown');
    expect(effectKindFromLabel('AHU SHUTDOWN')).toBe('ahu-shutdown');
    expect(effectKindFromLabel('SMOKE EXHAUST SHUTDOWN')).toBe('smoke-control');
  });

  it('is insensitive to case and punctuation', () => {
    expect(effectKindFromLabel('evac trip')).toBe('evacuation');
    expect(effectKindFromLabel('A/C  TRIP')).toBe('ahu-shutdown');
    expect(effectKindFromLabel('Door-Release (Level 2)')).toBe('door-release');
  });
});
