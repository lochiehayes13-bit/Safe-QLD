import {
  calculateVesda,
  detectorCurrents,
  VESDA_MODELS,
  VESDA_PSUS,
  wattsToMa,
} from '@/calc/vesda';

describe('wattsToMa', () => {
  it('converts published watts to current at the nominal 24 V supply', () => {
    // Xtralis publishes 7.0 W as 0.29 A and 14.7 W as 0.61 A.
    expect(wattsToMa(7.0)).toBeCloseTo(291.67, 1);
    expect(wattsToMa(14.7)).toBeCloseTo(612.5, 1);
    expect(wattsToMa(8.8)).toBeCloseTo(366.67, 1);
  });
});

describe('detectorCurrents', () => {
  it('resolves a published aspirator setting', () => {
    const r = detectorCurrents({ modelId: 'veu-a00', setting: 1, quantity: 1 });
    expect(r.maQuiescent).toBeCloseTo(291.67, 1);
    expect(r.maAlarm).toBeCloseTo(325, 1);
    expect(r.issues).toHaveLength(0);
  });

  it('scales by quantity', () => {
    const one = detectorCurrents({ modelId: 'veu-a00', setting: 1, quantity: 1 });
    const three = detectorCurrents({ modelId: 'veu-a00', setting: 1, quantity: 3 });
    expect(three.maQuiescent).toBeCloseTo(one.maQuiescent * 3, 4);
  });

  it('refuses an unpublished aspirator setting rather than interpolating', () => {
    const r = detectorCurrents({ modelId: 'veu-a00', setting: 7, quantity: 1 });
    expect(r.maQuiescent).toBe(0);
    expect(r.issues[0]?.level).toBe('error');
    expect(r.issues[0]?.title).toContain('not published');
  });

  it('never lets alarm current fall below quiescent', () => {
    // VES-A00-P at setting 10 publishes 14.5 W alarm against 14.8 W quiescent.
    const r = detectorCurrents({ modelId: 'ves-a00-p', setting: 10, quantity: 1 });
    expect(r.maQuiescent).toBeCloseTo(616.67, 1);
    expect(r.maAlarm).toBeGreaterThanOrEqual(r.maQuiescent);
  });

  it('adds accessories for models without a built-in display', () => {
    const bare = detectorCurrents({ modelId: 'veu-a00', setting: 1, quantity: 1 });
    const withDisplay = detectorCurrents({ modelId: 'veu-a00', setting: 1, quantity: 1, accessoryIds: ['display'] });
    expect(withDisplay.maQuiescent - bare.maQuiescent).toBeCloseTo(60, 4);
  });

  it('refuses to double-count a display that is already built in', () => {
    const bare = detectorCurrents({ modelId: 'veu-a10', setting: 1, quantity: 1 });
    const withDisplay = detectorCurrents({ modelId: 'veu-a10', setting: 1, quantity: 1, accessoryIds: ['display'] });
    expect(withDisplay.maQuiescent).toBeCloseTo(bare.maQuiescent, 4);
    expect(withDisplay.issues.some((i) => i.title.includes('twice'))).toBe(true);
  });

  it('reports an unknown model instead of returning zero silently', () => {
    const r = detectorCurrents({ modelId: 'nope', setting: 1, quantity: 1 });
    expect(r.issues[0]?.level).toBe('error');
  });

  it('reports an accessory it has no figures for rather than leaving it out of the load', () => {
    // Skipped silently, the accessory draws nothing on paper and the battery
    // is sized without it.
    const r = detectorCurrents({ modelId: 'veu-a00', setting: 1, quantity: 1, accessoryIds: ['nope'] });
    expect(r.issues.some((i) => i.level === 'error' && i.detail.includes('nope'))).toBe(true);
  });
});

describe('calculateVesda', () => {
  it('reproduces the manufacturer pairing for a VEP at setting 1 over 24 hours', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'vep-a00-p', setting: 1, quantity: 1 }],
      monitored: true,
      alarmHours: 0.5,
    });
    // 1.25 * ((0.29167 * 24) + 2 * (0.325 * 0.5)) = 1.25 * 7.325 = 9.16 Ah
    expect(r.requiredAh).toBeCloseTo(9.16, 1);
    expect(r.recommendedAh).toBe(12);
  });

  it('reproduces the manufacturer pairing for a VEU at setting 10', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'veu-a00', setting: 10, quantity: 1 }],
      monitored: true,
      alarmHours: 0.5,
    });
    // 1.25 * ((14.7/24 * 24) + 2 * (15.5/24 * 0.5)) = 19.18 Ah.
    // Xtralis's own worksheet gives 19.1 because it rounds 14.7 W to 0.61 A;
    // deriving from watts is more accurate and is what the datasheets support.
    expect(r.requiredAh).toBeCloseTo(19.18, 2);
    expect(r.recommendedAh).toBe(24);
  });

  it('shows the standby term dominating, unlike a conventional panel', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'veu-a00', setting: 5, quantity: 1 }],
      monitored: true,
      alarmHours: 0.5,
    });
    expect(r.standbyAh / r.subtotalAh).toBeGreaterThan(0.9);
  });

  it('roughly triples the battery when the supply is not monitored', () => {
    const common = { detectors: [{ modelId: 'vep-a00-p', setting: 1, quantity: 1 }], alarmHours: 0.5 };
    const monitored = calculateVesda({ ...common, monitored: true });
    const unmonitored = calculateVesda({ ...common, monitored: false });
    expect(unmonitored.standbyHours).toBe(72);
    expect(unmonitored.requiredAh).toBeGreaterThan(monitored.requiredAh * 2.5);
    expect(unmonitored.requiredAh).toBeCloseTo(26.5, 0);
  });

  it('flags a supply overloaded by continuous aspirator draw', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'veu-a00', setting: 10, quantity: 2 }],
      monitored: true,
      alarmHours: 0.5,
      psuId: 'vps-220-stx5',
    });
    // 2 x 612 mA = 1.22 A against a 0.5 A supply.
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('overloaded'))).toBe(true);
  });

  it('warns before a supply is fully loaded', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'veu-a00', setting: 5, quantity: 1 }],
      monitored: true,
      alarmHours: 0.5,
      psuId: 'vps-220-stx5',
    });
    // 367 mA of a 500 mA supply is 73%... below the threshold.
    expect(r.psuUtilisation).toBeCloseTo(0.733, 2);
    expect(r.issues.some((i) => i.title.includes('heavily loaded'))).toBe(false);
  });

  it('flags a battery larger than the supply can house', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'vep-a00-p', setting: 1, quantity: 1 }],
      monitored: false,
      alarmHours: 0.5,
      psuId: 'vps-220-stx5',
    });
    // 26.5 Ah required against a 14 Ah maximum.
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('will not fit'))).toBe(true);
  });

  it('does not warn about alarm signalling equipment, which does not apply here', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'vep-a00-p', setting: 1, quantity: 1 }],
      monitored: true,
      alarmHours: 0.5,
    });
    expect(r.issues.some((i) => i.title.includes('alarm signalling'))).toBe(false);
  });

  it('notes when supply figures are not manufacturer-verified', () => {
    const r = calculateVesda({
      detectors: [{ modelId: 'vep-a00-p', setting: 1, quantity: 1 }],
      monitored: true,
      alarmHours: 0.5,
      psuId: 'vps-215-e5',
    });
    expect(r.issues.some((i) => i.title.includes('Unverified'))).toBe(true);
  });
});

describe('catalogue integrity', () => {
  it('gives every VESDA-E variant a power figure', () => {
    for (const m of VESDA_MODELS.filter((x) => x.family === 'VESDA-E')) {
      for (const v of m.variants) {
        expect(v.watts ?? v.ma).toBeDefined();
      }
    }
  });

  it('uses unique ids', () => {
    expect(new Set(VESDA_MODELS.map((m) => m.id)).size).toBe(VESDA_MODELS.length);
    expect(new Set(VESDA_PSUS.map((m) => m.id)).size).toBe(VESDA_PSUS.length);
  });
});
