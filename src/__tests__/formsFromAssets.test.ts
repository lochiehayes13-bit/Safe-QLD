import {
  applyForm72Prefill, assetLocation, assetTag, assetTypeLabel, deviceTypeForAsset, form72FromAssets,
  occupierEvidenceFromAssets, orderForWalk, prefillOccupierRows, registerSystemFor, testRowsFromAssets,
  type RegisterAsset,
} from '@/domain/formsFromAssets';
import { emptyForm72 } from '@/domain/form72';
import { OCCUPIER_STATEMENT_INSTALLATIONS } from '@/domain/qldCompliance';
import { SYSTEM_LABEL } from '@/parsers/assetRegister';

/**
 * The forms, built from the asset register.
 *
 * The office's sites keep their equipment in the register and nowhere else,
 * and the three forms were written against panel imports. What is defended
 * here is the rule the builders share: everything the register holds goes on
 * the form, in the order a technician walks it, and nothing it does not hold
 * is invented — a blank stays blank and is named as not recorded.
 */

/** An invented register for one site, in the shape the Simpro sync writes. */
const asset = (over: Partial<RegisterAsset> & { id: string; assetTypeId: string }): RegisterAsset => ({
  name: '',
  attributes: {},
  status: 'in-service',
  ...over,
});

const REGISTER: RegisterAsset[] = [
  asset({ id: 'ext-2', assetTypeId: 'extinguisher', name: 'Level 1 kitchen', walkOrder: 2,
    attributes: { tag: 'E2', assetNumber: 'E2', 'Extinguisher Type': 'Wet chemical 7L' },
    lastServicedAt: '2026-03-04', nextDueAt: '2026-09-04' }),
  asset({ id: 'ext-1', assetTypeId: 'extinguisher', name: 'Ground floor foyer', walkOrder: 1,
    attributes: { tag: 'E1', assetNumber: 'E1', 'Extinguisher Type': 'ABE 4.5kg' },
    lastServicedAt: '2026-03-04T02:00:00.000Z', nextDueAt: '2026-09-04' }),
  asset({ id: 'hyd-2', assetTypeId: 'hydrant', name: 'Level 3 east', walkOrder: 12,
    attributes: { assetNumber: 'H2' }, lastServicedAt: '2025-11-20', nextDueAt: '2026-11-20' }),
  asset({ id: 'hyd-1', assetTypeId: 'hydrant', name: 'Ground floor riser', walkOrder: 11,
    attributes: { assetNumber: 'H1' }, lastServicedAt: '2025-11-20', nextDueAt: '2026-11-20' }),
  asset({ id: 'bst-1', assetTypeId: 'booster', name: 'Front fence booster cabinet', attributes: { tag: 'B1' } }),
  asset({ id: 'pmp-1', assetTypeId: 'fire-pump', name: 'Pump room', attributes: { ratedFlow: '16', ratedPressure: '700' } }),
  asset({ id: 'tnk-1', assetTypeId: 'water-tank', name: 'Roof tank', attributes: { capacity: '60000' } }),
  asset({ id: 'svs-1', assetTypeId: 'sprinkler-valve', name: 'Basement valve room', attributes: { 'Type & Size': 'Wet 100mm' } }),
  asset({ id: 'det-1', assetTypeId: 'detector', name: 'Plant room', level: 'Level 2', attributes: { detectorType: 'Heat' } }),
  asset({ id: 'eel-1', assetTypeId: 'emergency-light', name: 'Stair 1 landing', level: 'Level 1' }),
  asset({ id: 'gone', assetTypeId: 'hose-reel', name: 'Removed reel', status: 'decommissioned' }),
  asset({ id: 'lvl-1', assetTypeId: 'level', name: 'Level 1' }),
  asset({ id: 'mystery', assetTypeId: 'unknown', name: 'Something the office typed' }),
];

describe('reading an asset', () => {
  it('takes the number off the equipment from whichever key holds it', () => {
    expect(assetTag(asset({ id: 'a', assetTypeId: 'extinguisher', attributes: { assetNumber: '14211' } }))).toBe('14211');
    expect(assetTag(asset({ id: 'a', assetTypeId: 'extinguisher', attributes: { tag: 'T-9' } }))).toBe('T-9');
    expect(assetTag(asset({ id: 'a', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000001' }))).toBe('SQ-EXT-0000001');
    expect(assetTag(asset({ id: 'a', assetTypeId: 'extinguisher' }))).toBeUndefined();
  });

  it('labels the type with the register descriptor under the office heading', () => {
    // The Simpro sync keeps the office's headings verbatim, and they are the
    // same headings the register's report columns already know.
    expect(assetTypeLabel(REGISTER[0]!)).toBe('Fire extinguisher — Wet chemical 7L');
    expect(assetTypeLabel(REGISTER[7]!)).toBe('Sprinkler valve set — Wet 100mm');
    expect(assetTypeLabel(asset({ id: 'a', assetTypeId: 'hydrant' }))).toBe('Fire hydrant');
  });

  it('puts level and room in front of the place only where the name lacks them', () => {
    expect(assetLocation(asset({ id: 'a', assetTypeId: 'detector', name: 'Plant room', level: 'Level 2' }))).toBe('Level 2 — Plant room');
    expect(assetLocation(asset({ id: 'a', assetTypeId: 'detector', name: 'Level 2 plant room', level: 'Level 2' }))).toBe('Level 2 plant room');
    expect(assetLocation(asset({ id: 'a', assetTypeId: 'detector', name: '' }))).toBe('Detector');
  });

  it('finds the panel vocabulary for a loop device and admits it has none for the rest', () => {
    expect(deviceTypeForAsset(REGISTER[8]!)).toBe('heat');
    expect(deviceTypeForAsset(asset({ id: 'a', assetTypeId: 'mcp' }))).toBe('mcp');
    expect(deviceTypeForAsset(asset({ id: 'a', assetTypeId: 'extinguisher' }))).toBe('unknown');
  });

  it('files every serviced type under a report section', () => {
    expect(registerSystemFor('extinguisher')).toBe('extinguisher');
    expect(registerSystemFor('booster')).toBe('hydrant');
    expect(registerSystemFor('flow-switch')).toBe('sprinkler');
    expect(registerSystemFor('no-such-type')).toBe('unknown');
  });
});

describe('the test sheet from the register', () => {
  const rows = testRowsFromAssets(REGISTER);

  it('adds one row per serviceable asset and none for the building or the retired', () => {
    // The level is the building, the decommissioned reel is gone, and the
    // unrecognised type is a row nobody could mark: none of them is a test.
    expect(rows.map((r) => r.assetId)).not.toEqual(expect.arrayContaining(['lvl-1', 'gone']));
    expect(rows).toHaveLength(10);
  });

  it('groups by system in the report order and walks each system in order', () => {
    const systems = rows.map((r) => r.zoneText);
    expect(systems.slice(0, 3)).toEqual([SYSTEM_LABEL.hydrant, SYSTEM_LABEL.hydrant, SYSTEM_LABEL.hydrant]);
    // Walk order inside the system, not the order the register listed them.
    expect(rows.slice(0, 2).map((r) => r.assetId)).toEqual(['hyd-1', 'hyd-2']);
    expect(rows.filter((r) => r.zoneText === SYSTEM_LABEL.extinguisher).map((r) => r.assetId)).toEqual(['ext-1', 'ext-2']);
    expect(rows.map((r) => r.sortIndex)).toEqual(rows.map((_, i) => i));
  });

  it('carries the number, the type and the place onto the row', () => {
    const row = rows.find((r) => r.assetId === 'ext-1')!;
    expect(row).toMatchObject({
      pointRef: 'E1',
      assetType: 'Fire extinguisher — ABE 4.5kg',
      deviceText: 'Ground floor foyer',
      deviceType: 'unknown',
      result: 'untested',
    });
  });

  it('skips what is already on the sheet and the system a panel already lists', () => {
    const again = testRowsFromAssets(REGISTER, {
      skipAssetIds: new Set(['hyd-1', 'ext-1']),
      skipSystems: new Set(['detection']),
      firstSortIndex: 40,
    });
    const ids = again.map((r) => r.assetId);
    expect(ids).not.toContain('hyd-1');
    expect(ids).not.toContain('ext-1');
    expect(ids).not.toContain('det-1');
    expect(again[0]!.sortIndex).toBe(40);
  });

  it('sorts "Level 10" after "Level 2" and blanks last', () => {
    const ordered = orderForWalk([
      asset({ id: 'c', assetTypeId: 'extinguisher', name: 'c' }),
      asset({ id: 'b', assetTypeId: 'extinguisher', level: 'Level 10', name: 'b' }),
      asset({ id: 'a', assetTypeId: 'extinguisher', level: 'Level 2', name: 'a' }),
    ]);
    expect(ordered.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('Form 72 from the register', () => {
  const prefill = form72FromAssets(REGISTER);

  it('lists the hydrants in walk order with their numbers, for Part D', () => {
    expect(prefill.hydrantLocations).toEqual(['Ground floor riser (H1)', 'Level 3 east (H2)']);
  });

  it('finds the booster, the pump with its duty, the tank and the valve set', () => {
    expect(prefill.boosterLocations).toEqual(['Front fence booster cabinet (B1)']);
    expect(prefill.pumps).toEqual([{ location: 'Pump room', ratedFlowLps: 16, ratedPressureKpa: 700 }]);
    expect(prefill.tanks).toEqual([{ location: 'Roof tank', capacityLitres: 60000 }]);
    expect(prefill.sprinklerTestPoints).toEqual(['Basement valve room — Wet 100mm']);
  });

  it('derives the system descriptor only from what the register supports', () => {
    expect(prefill.systemLabel).toBe('Combined Hydrant and Sprinkler System');
    expect(form72FromAssets(REGISTER.filter((a) => a.assetTypeId !== 'sprinkler-valve')).systemLabel).toBe('Boosted Hydrant System');
    expect(form72FromAssets(REGISTER.filter((a) => a.assetTypeId === 'hydrant')).systemLabel).toBe('Fire Hydrant System');
    expect(form72FromAssets([REGISTER[0]!]).systemLabel).toBeUndefined();
  });

  it('names what the register does not hold rather than leaving a silent blank', () => {
    // Test gauges are the technician's instruments; no register holds them.
    expect(prefill.notRecorded.some((n) => n.startsWith('Test gauges'))).toBe(true);
    const bare = form72FromAssets([REGISTER[0]!]);
    expect(bare.notRecorded).toEqual(expect.arrayContaining([
      'Hydrants: none in the register', 'Booster: none in the register', 'Fire pump: none in the register',
    ]));
    expect(bare.filled).toEqual([]);
  });

  it('fills a blank form and leaves a typed one alone', () => {
    const blank = emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', now: '2026-07-03T00:00:00.000Z' });
    const patch = applyForm72Prefill(blank, prefill);
    expect(patch.systemLabel).toBe('Combined Hydrant and Sprinkler System');
    expect(patch.flowTest?.hydrantLocations).toEqual(prefill.hydrantLocations);
    expect(patch.flowTest?.onSitePumpSet).toBe(true);
    expect(patch.flowTest?.comment).toContain('Roof tank (60000 L)');
    expect(patch.booster).toMatchObject({ requiredLps: 16, requiredKpa: 700 });
    expect(patch.booster?.comments).toContain('Front fence booster cabinet');
    expect(patch.sprinklerFlow?.testPoints).toEqual([{ location: 'Basement valve room — Wet 100mm' }]);

    /*
     * The technician's hydrant list and the duty they typed are decisions.
     * A second press, or a press on a form somebody started, must not
     * overwrite either — and a part with nothing to change is not in the
     * patch at all, so the screen writes nothing for it.
     */
    const typed = {
      ...blank,
      systemLabel: 'Towns Main System',
      flowTest: { ...blank.flowTest, hydrantLocations: ['Roof'], onSitePumpSet: false, comment: 'Mains fed' },
      booster: { ...blank.booster, requiredLps: 20, requiredKpa: 800, comments: 'Booster on the street' },
      sprinklerFlow: { ...blank.sprinklerFlow, testPoints: [{ location: 'Valve 1' }] },
    };
    expect(applyForm72Prefill(typed, prefill)).toEqual({});
  });

  it('does not average two pumps into one duty', () => {
    const twoPumps = form72FromAssets([
      ...REGISTER,
      asset({ id: 'pmp-2', assetTypeId: 'fire-pump', name: 'Diesel', attributes: { ratedFlow: '20', ratedPressure: '900' } }),
    ]);
    const blank = emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', now: '2026-07-03T00:00:00.000Z' });
    const patch = applyForm72Prefill(blank, twoPumps);
    expect(patch.booster?.requiredLps).toBeUndefined();
    expect(patch.booster?.comments).toContain('Diesel');
  });
});

describe('the occupier statement from the register', () => {
  const evidence = occupierEvidenceFromAssets(REGISTER);
  const by = (name: string) => evidence.installations.find((e) => e.installation === name);

  it('says which prescribed installations the register holds equipment for', () => {
    expect(by('Fire extinguishers')).toMatchObject({ knowledge: 'present', assetCount: 2 });
    expect(by('Fire hydrants (including boosters)')).toMatchObject({ knowledge: 'present', assetCount: 3 });
    expect(by('Sprinklers')).toMatchObject({ knowledge: 'present', assetCount: 1 });
    expect(by('Fire detection and alarm systems')).toMatchObject({ knowledge: 'present', assetCount: 1 });
    expect(by('Emergency lighting')).toMatchObject({ knowledge: 'present', assetCount: 1 });
  });

  it('says not present only where it could have known, and nothing about the rest', () => {
    // The register lists hose reels when a site has them; this one has only a
    // retired one. It never lists lifts, so it cannot strike them off.
    expect(by('Fire hose reels')).toMatchObject({ knowledge: 'absent', assetCount: 0 });
    expect(by('Emergency lifts')).toBeUndefined();
    expect(by('Fire mains')).toBeUndefined();
  });

  it('carries the latest last-test and the soonest due date, as Queensland days', () => {
    // One extinguisher's last test is an instant stamped on the phone; the
    // other's is Simpro's day. Both are the fourth of March in Brisbane.
    expect(by('Fire extinguishers')).toMatchObject({ lastMaintainedDate: '2026-03-04', nextDueDate: '2026-09-04' });
    expect(by('Fire hydrants (including boosters)')).toMatchObject({ lastMaintainedDate: '2025-11-20', nextDueDate: '2026-11-20' });
    expect(by('Sprinklers')?.lastMaintainedDate).toBeUndefined();
  });

  it('names the equipment it could not place on a row, and the reason', () => {
    const labels = evidence.unplaced.map((u) => u.label);
    expect(labels).toEqual(expect.arrayContaining(['Fire pump', 'Water storage tank']));
    expect(evidence.unplaced.find((u) => u.label === 'Fire pump')?.why).toContain('whichever installation it feeds');
    expect(evidence.unrecognised).toBe(1);
    expect(evidence.total).toBe(10);
  });

  it('proposes nothing from an empty register', () => {
    const none = occupierEvidenceFromAssets([]);
    expect(none.installations).toEqual([]);
    expect(none.total).toBe(0);
  });

  it('lays the evidence onto the rows and leaves the rest as the occupier had it', () => {
    const rows = OCCUPIER_STATEMENT_INSTALLATIONS.map((installation) => ({
      installation,
      present: installation === 'Emergency lifts' || installation === 'Fire hose reels',
      criticalDefectNoticeGiven: false,
    }));
    const filled = prefillOccupierRows(rows, evidence);
    const row = (name: string) => filled.find((r) => r.installation === name)!;
    expect(row('Fire extinguishers')).toMatchObject({ present: true, lastMaintainedDate: '2026-03-04', nextDueDate: '2026-09-04' });
    // Ticked by the occupier, struck by the register: the register's answer
    // is the proposal, and the screen says so.
    expect(row('Fire hose reels').present).toBe(false);
    // The register cannot speak to lifts, so the occupier's tick stands.
    expect(row('Emergency lifts').present).toBe(true);
    expect(filled).toHaveLength(OCCUPIER_STATEMENT_INSTALLATIONS.length);
  });
});
