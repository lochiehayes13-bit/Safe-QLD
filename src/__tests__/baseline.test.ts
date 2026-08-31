import {
  CONFIRMATION_ITEMS,
  EQUIPMENT_ITEMS,
  SPEAKER_CIRCUIT_COUNT,
  ZONE_TEST_ROW_COUNT,
  completeness,
  emptyBaseline,
  zoneQtyTotal,
} from '@/domain/baseline';
import { autofillBaseline, describeZoneDevices } from '@/services/baselineAutofill';
import type { Point, Site } from '@/domain/types';

const NOW = '2026-08-31T00:00:00.000Z';

function point(p: Partial<Point>): Point {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    panelId: 'panel-1',
    text: p.text ?? 'Device',
    deviceType: p.deviceType ?? 'smoke',
    zoneNumber: p.zoneNumber,
    unused: p.unused ?? false,
    ...p,
  } as Point;
}

const site: Site = {
  id: 'site-1',
  name: 'BRIC Housing Emsworth St',
  address: '12 Emsworth St',
  suburb: 'Wynnum',
  state: 'QLD',
  postcode: '4178',
  createdAt: NOW,
  updatedAt: NOW,
};

describe('emptyBaseline', () => {
  it('pre-sizes the tables to the form row counts', () => {
    const b = emptyBaseline('site-1', 'b1', NOW);
    expect(b.speakerCircuits).toHaveLength(SPEAKER_CIRCUIT_COUNT);
    expect(b.zoneResults).toHaveLength(ZONE_TEST_ROW_COUNT);
    expect(b.speakerCircuits[0]!.zone).toBe(1);
    expect(b.zoneResults[31]!.zone).toBe(32);
  });

  it('seeds every checklist key so nothing is silently missing', () => {
    const b = emptyBaseline('site-1', 'b1', NOW);
    for (const k of EQUIPMENT_ITEMS) expect(b.equipment[k]).toBe('');
    for (const k of CONFIRMATION_ITEMS) expect(b.confirmations[k]).toBe('');
  });
});

describe('zoneQtyTotal', () => {
  it('sums the quantity column', () => {
    const b = emptyBaseline('s', 'b', NOW);
    b.zoneResults[0]!.qty = '24';
    b.zoneResults[1]!.qty = '3';
    expect(zoneQtyTotal(b.zoneResults)).toBe(27);
  });

  it('ignores non-numeric entries', () => {
    const b = emptyBaseline('s', 'b', NOW);
    b.zoneResults[0]!.qty = 'twenty';
    b.zoneResults[1]!.qty = '5';
    expect(zoneQtyTotal(b.zoneResults)).toBe(5);
  });
});

describe('describeZoneDevices', () => {
  it('summarises the way the form asks for it', () => {
    const pts = [
      ...Array.from({ length: 24 }, () => point({ deviceType: 'smoke' })),
      ...Array.from({ length: 3 }, () => point({ deviceType: 'heat' })),
    ];
    const r = describeZoneDevices(pts);
    expect(r.qty).toBe(27);
    expect(r.description).toBe('24 smoke, 3 heat');
  });

  it('orders initiating devices before outputs', () => {
    const pts = [
      point({ deviceType: 'sounder' }),
      point({ deviceType: 'smoke' }),
      point({ deviceType: 'mcp' }),
    ];
    expect(describeZoneDevices(pts).description).toBe('1 smoke, 1 mcp, 1 sounder');
  });

  it('handles an empty zone', () => {
    expect(describeZoneDevices([])).toEqual({ qty: 0, description: '' });
  });
});

describe('autofillBaseline', () => {
  const points = [
    ...Array.from({ length: 24 }, () => point({ zoneNumber: 1, deviceType: 'smoke' })),
    ...Array.from({ length: 3 }, () => point({ zoneNumber: 1, deviceType: 'heat' })),
    ...Array.from({ length: 8 }, () => point({ zoneNumber: 2, deviceType: 'mcp' })),
  ];

  it('fills premises details from the site', () => {
    const { baseline, filled } = autofillBaseline(emptyBaseline('site-1', 'b1', NOW), { site, zones: [], points: [] });
    expect(baseline.premisesName).toBe('BRIC Housing Emsworth St');
    expect(baseline.premisesAddress).toBe('12 Emsworth St Wynnum QLD 4178');
    expect(filled).toContain('Name of premises');
  });

  it('fills the zone table from the imported device list', () => {
    const { baseline } = autofillBaseline(emptyBaseline('site-1', 'b1', NOW), { site, zones: [], points });
    expect(baseline.zoneResults[0]!.qty).toBe('27');
    expect(baseline.zoneResults[0]!.deviceTypes).toBe('24 smoke, 3 heat');
    expect(baseline.zoneResults[1]!.qty).toBe('8');
    expect(baseline.zoneResults[1]!.deviceTypes).toBe('8 mcp');
  });

  it('never overwrites what the technician already typed', () => {
    const current = emptyBaseline('site-1', 'b1', NOW);
    current.premisesName = 'My own wording';
    current.zoneResults[0] = { zone: 1, qty: '99', deviceTypes: 'hand written' };
    const { baseline } = autofillBaseline(current, { site, zones: [], points });
    expect(baseline.premisesName).toBe('My own wording');
    expect(baseline.zoneResults[0]!.qty).toBe('99');
    expect(baseline.zoneResults[0]!.deviceTypes).toBe('hand written');
  });

  it('excludes unused points from the counts', () => {
    const withUnused = [...points, ...Array.from({ length: 5 }, () => point({ zoneNumber: 1, unused: true }))];
    const { baseline } = autofillBaseline(emptyBaseline('site-1', 'b1', NOW), { site, zones: [], points: withUnused });
    expect(baseline.zoneResults[0]!.qty).toBe('27');
  });

  it('carries currents through from a battery calculation', () => {
    const { baseline } = autofillBaseline(emptyBaseline('site-1', 'b1', NOW), {
      site, zones: [], points: [], quiescentA: 0.5, alarmA: 0.8, batteryAh: 17, standbyHours: 24,
    });
    expect(baseline.quiescentCurrentA).toBe('0.500');
    expect(baseline.fullAlarmCurrentA).toBe('0.800');
    expect(baseline.batteryAh).toBe('17');
    expect(baseline.batteryStandbyHours).toBe('24');
  });

  it('warns about zones beyond the form s 32 rows', () => {
    const far = [point({ zoneNumber: 40, deviceType: 'smoke' })];
    const { filled } = autofillBaseline(emptyBaseline('site-1', 'b1', NOW), { site, zones: [], points: far });
    expect(filled.some((f) => f.includes('not on the form'))).toBe(true);
  });

  it('does not mutate the record it was given', () => {
    const current = emptyBaseline('site-1', 'b1', NOW);
    autofillBaseline(current, { site, zones: [], points });
    expect(current.premisesName).toBe('');
    expect(current.zoneResults[0]!.qty).toBe('');
  });
});

describe('completeness', () => {
  it('reports a new form as barely started', () => {
    // Test date is seeded with today, so a new form legitimately starts at one.
    const c = completeness(emptyBaseline('s', 'b', NOW));
    expect(c.filled).toBe(1);
    expect(c.missing).toContain('Name of premises');
    expect(c.missing).not.toContain('Test date');
  });

  it('counts the zone table once, not 32 times', () => {
    const b = emptyBaseline('s', 'b', NOW);
    b.zoneResults[0] = { zone: 1, qty: '24', deviceTypes: '24 smoke' };
    const c = completeness(b);
    // Zone results plus the seeded test date — one entry, not 32.
    expect(c.filled).toBe(2);
    expect(c.missing).not.toContain('Zone test results');

    // Filling 20 more zone rows must not move the score.
    for (let i = 1; i < 21; i++) b.zoneResults[i] = { zone: i + 1, qty: '5', deviceTypes: '5 smoke' };
    expect(completeness(b).filled).toBe(2);
  });

  it('requires every confirmation to be answered', () => {
    const b = emptyBaseline('s', 'b', NOW);
    b.confirmations[CONFIRMATION_ITEMS[0]] = 'YES';
    expect(completeness(b).missing).toContain('Confirmations');
    for (const k of CONFIRMATION_ITEMS) b.confirmations[k] = 'YES';
    expect(completeness(b).missing).not.toContain('Confirmations');
  });
});
