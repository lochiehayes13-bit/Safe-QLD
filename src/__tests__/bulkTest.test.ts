import type { AssetRecord } from '@/db/assetRepo';
import {
  NOT_TESTED_REASONS, applyVerdictToAll, assetTestFor, buildServiceNote, candidateDefects, clearSelection,
  clearVerdict, decidedCount, defectFor, describeOutcome, eventFor, failIsComplete, finalWording, isSelected,
  levelsOf, locationOf, selectAll, selectLevel, selectSystem, serviceLevelIdOf, serviceNoteSubject, summarise,
  systemsOf, toggleSelected, withoutWritten, type Batch, type FailDetail,
} from '@/domain/bulkTest';
import { decideAssetTest } from '@/domain/assetTestDecision';
import { SEVERITY_ORDER, defectByCode } from '@/seed/defectLibrary';

/**
 * The batch model behind the bulk test screen.
 *
 * Everything the screen would otherwise decide on the fly is decided here,
 * so it is tested here: which assets a tap picks up, what a verdict turns
 * into on the asset and in the defect list, what the office reads, and
 * which library codes are offered for a few words typed on a ladder.
 */

let n = 0;
const asset = (over: Partial<AssetRecord> = {}): AssetRecord => {
  n++;
  return {
    id: `a${n}`,
    siteId: 'site-1',
    assetTypeId: 'extinguisher',
    name: `Extinguisher ${n}`,
    status: 'in-service',
    attributes: {},
    openDefects: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
};

const SITE = { name: 'Riverbend Community Hall' };

const register = () => [
  asset({ id: 'ext-1', level: 'Ground', room: 'Foyer', code: 'SQ-EXT-0001' }),
  asset({ id: 'ext-2', level: 'Ground', room: 'Kitchen', code: 'SQ-EXT-0002' }),
  asset({ id: 'ext-3', level: 'Level 1', room: 'Hall', code: 'SQ-EXT-0003' }),
  asset({ id: 'el-1', assetTypeId: 'emergency-light', level: 'level 1 ', name: 'Exit sign over stair' }),
  asset({ id: 'det-1', assetTypeId: 'detector', level: 'Level 2', name: 'Detector, plant room' }),
];

beforeEach(() => { n = 0; });

describe('the selection', () => {
  it('toggles one asset in and out', () => {
    let s = clearSelection();
    s = toggleSelected(s, 'ext-1');
    expect(isSelected(s, 'ext-1')).toBe(true);
    s = toggleSelected(s, 'ext-1');
    expect(isSelected(s, 'ext-1')).toBe(false);
  });

  it('selects everything shown without doubling what was already in hand', () => {
    const all = register();
    const s = selectAll(['ext-2'], all);
    expect(s).toEqual(['ext-2', 'ext-1', 'ext-3', 'el-1', 'det-1']);
  });

  it('selects by system through the asset type', () => {
    const s = selectSystem([], register(), 'extinguisher');
    expect(s).toEqual(['ext-1', 'ext-2', 'ext-3']);
  });

  it('selects by level, ignoring case and stray spaces', () => {
    // "Level 1" and "level 1 " are the same floor of the same building.
    const s = selectLevel([], register(), 'LEVEL 1');
    expect(s).toEqual(['ext-3', 'el-1']);
  });

  it('lists the levels and systems a register has, once each', () => {
    const all = register();
    expect(levelsOf(all)).toEqual(['Ground', 'Level 1', 'Level 2']);
    expect(systemsOf(all)).toEqual(['extinguisher', 'emergency-lighting', 'detection']);
  });
});

describe('verdicts', () => {
  it('applies one verdict to every selected asset and leaves the rest alone', () => {
    const batch = applyVerdictToAll({ 'ext-3': { kind: 'pass' } }, ['ext-1', 'ext-2'], { kind: 'not-tested', reason: NOT_TESTED_REASONS[0] });
    expect(batch['ext-1']).toEqual({ kind: 'not-tested', reason: 'No access to the area' });
    expect(batch['ext-2']).toEqual({ kind: 'not-tested', reason: 'No access to the area' });
    expect(batch['ext-3']).toEqual({ kind: 'pass' });
    expect(decidedCount(batch)).toBe(3);
  });

  it('can take a verdict back', () => {
    const batch = clearVerdict({ 'ext-1': { kind: 'pass' } }, 'ext-1');
    expect(decidedCount(batch)).toBe(0);
  });

  it('drops the verdicts already on record so a second Record writes only the rest', () => {
    const batch: Batch = { a: { kind: 'pass' }, b: { kind: 'pass' }, c: { kind: 'not-tested', reason: 'Unsafe to test' } };
    const left = withoutWritten(batch, ['a', 'c']);
    expect(Object.keys(left)).toEqual(['b']);
    // The original is untouched, and nothing written means nothing changes.
    expect(Object.keys(batch)).toHaveLength(3);
    expect(withoutWritten(batch, [])).toBe(batch);
    // An id that was never in the batch is not an error.
    expect(Object.keys(withoutWritten(batch, ['zz']))).toHaveLength(3);
  });

  it('needs a code or an observation before a fail is complete', () => {
    expect(failIsComplete({ observation: '', severity: 'high', photos: [] })).toBe(false);
    expect(failIsComplete({ observation: 'hose perished', severity: 'high', photos: [] })).toBe(true);
    expect(failIsComplete({ observation: '', defectCode: 'EXT-EXT-001', severity: 'high', photos: [] })).toBe(true);
  });
});

describe('what a verdict turns into', () => {
  const fail: FailDetail = { observation: 'hose perished at the nozzle', defectCode: 'EXT-EXT-001', severity: 'critical', photos: ['photos/p1.jpg'] };

  it('writes the same events a routine run does', () => {
    expect(eventFor({ kind: 'pass' })).toEqual({ kind: 'passed', summary: 'Bulk test — passed', photos: [] });
    expect(eventFor({ kind: 'fail', fail })).toEqual({
      kind: 'failed', summary: 'Bulk test — failed (EXT-EXT-001)', detail: 'hose perished at the nozzle', photos: ['photos/p1.jpg'],
    });
    expect(eventFor({ kind: 'not-tested', reason: 'Unsafe to test' })).toEqual({
      kind: 'not-tested', summary: 'Bulk test — not tested: Unsafe to test', photos: [],
    });
  });

  it('words the defect from the code, then the observation, then whatever was typed', () => {
    const code = defectByCode('EXT-EXT-001')!;
    expect(finalWording(fail)).toBe(`${code.reportWording} hose perished at the nozzle`);
    expect(finalWording({ ...fail, wording: 'Hose reel found perished. Replace.' })).toBe('Hose reel found perished. Replace.');
    expect(finalWording({ observation: 'pin missing', severity: 'low', photos: [] })).toBe('pin missing');
    expect(finalWording({ observation: '', severity: 'low', photos: [] })).toBe('Failed on test.');
  });

  it('places the defect the way a routine run does and folds severity to the record\'s two', () => {
    const a = asset({ level: 'Level 3', room: 'East corridor', name: 'Extinguisher by stair 2' });
    expect(locationOf(a)).toBe('Level 3 East corridor Extinguisher by stair 2');
    const d = defectFor(a, fail);
    expect(d.severity).toBe('critical');
    expect(d.defectCode).toBe('EXT-EXT-001');
    expect(d.photos).toEqual(['photos/p1.jpg']);
    expect(d.notes).toContain('EXT-EXT-001 · raised from a bulk test');
    expect(d.notes).toContain('Technician note: hose perished at the nozzle');
    expect(defectFor(a, { ...fail, severity: 'medium' }).severity).toBe('non-critical');
  });

  it('falls back to the type label where the asset has no name', () => {
    expect(locationOf(asset({ name: '', level: 'Ground' }))).toBe('Ground Fire extinguisher');
  });
});

describe('the Simpro result', () => {
  it('reads the service level from the one key the asset sync writes, and nothing else', () => {
    expect(serviceLevelIdOf({ attributes: {} })).toBeUndefined();
    expect(serviceLevelIdOf({ attributes: { simproServiceLevels: '' } })).toBeUndefined();
    // Keys nobody writes are not read: a guess filed against the wrong
    // frequency moves the office's due date for the wrong one.
    expect(serviceLevelIdOf({ attributes: { serviceLevelId: '7', simproServiceLevelId: 12 } })).toBeUndefined();
    expect(serviceLevelIdOf({ attributes: { simproServiceLevels: '4:6 Monthly,9:Yearly' } })).toBe('4');
  });

  it('files the result against the frequency falling due soonest', () => {
    // The yearly is listed first but the six-monthly is what the office is
    // waiting on.
    expect(serviceLevelIdOf({ attributes: { simproServiceLevels: '9:Yearly:2027-05-01,4:6 Monthly:2026-11-01' } })).toBe('4');
    // A level with no date does not beat one with a date, wherever it sits.
    expect(serviceLevelIdOf({ attributes: { simproServiceLevels: '2:Monthly,4:6 Monthly:2026-11-01' } })).toBe('4');
    // No dates anywhere: the first listed.
    expect(serviceLevelIdOf({ attributes: { simproServiceLevels: '2:Monthly,4:6 Monthly' } })).toBe('2');
    // A colon in a name is not a date.
    expect(serviceLevelIdOf({ attributes: { simproServiceLevels: '2:Monthly: pumps,4:6 Monthly:2026-11-01' } })).toBe('4');
  });

  it('refuses honestly when the office has not turned writing on', () => {
    const a = asset({ externalId: '59', externalSource: 'simpro', attributes: { simproServiceLevels: '7:Six monthly:2026-10-01' } });
    expect(decideAssetTest(assetTestFor(a, { kind: 'pass' }, '2026-09-09T01:00:00.000Z'), false))
      .toEqual({ send: false, reason: 'writing-disabled' });
  });

  it('sends only for an asset that came from Simpro, and refuses honestly otherwise', () => {
    const local = asset({ externalId: '55', externalSource: 'register-import', attributes: { simproServiceLevels: '7:Six monthly:2026-10-01' } });
    expect(decideAssetTest(assetTestFor(local, { kind: 'pass' }, '2026-09-09T01:00:00.000Z'), true))
      .toEqual({ send: false, reason: 'no-external-id' });

    const noLevel = asset({ externalId: '56', externalSource: 'simpro' });
    expect(decideAssetTest(assetTestFor(noLevel, { kind: 'pass' }, '2026-09-09T01:00:00.000Z'), true))
      .toEqual({ send: false, reason: 'no-service-level' });

    const ok = asset({ externalId: '57', externalSource: 'simpro', attributes: { simproServiceLevels: '7:Six monthly:2026-10-01' }, level: 'L1', name: 'Foyer' });
    const decision = decideAssetTest(assetTestFor(ok, { kind: 'pass' }, '2026-09-09T01:00:00.000Z'), true);
    expect(decision.send).toBe(true);
    if (decision.send) {
      expect(decision.payload.externalAssetId).toBe('57');
      expect(decision.payload.serviceLevelId).toBe('7');
      expect(decision.payload.result).toBe('Pass');
    }
  });

  it('never turns a not-tested asset into a pass or a fail', () => {
    const a = asset({ externalId: '58', externalSource: 'simpro', attributes: { simproServiceLevels: '7:Six monthly:2026-10-01' } });
    expect(decideAssetTest(assetTestFor(a, { kind: 'not-tested', reason: 'Unsafe to test' }, '2026-09-09T01:00:00.000Z'), true))
      .toEqual({ send: false, reason: 'result-not-expressible' });
  });
});

describe('the summary and the note to the office', () => {
  const batch = (): Batch => ({
    'ext-1': { kind: 'pass' },
    'ext-2': { kind: 'fail', fail: { observation: 'hose perished', defectCode: 'EXT-EXT-001', severity: 'critical', photos: [] } },
    'ext-3': { kind: 'pass' },
    'el-1': { kind: 'not-tested', reason: 'No access to the area' },
    'det-1': { kind: 'fail', fail: { observation: 'dust', defectCode: 'DET-DET-002', severity: 'high', photos: [] } },
    'gone': { kind: 'pass' },
  });

  it('counts in register order and lists the defects to raise', () => {
    const s = summarise(batch(), register());
    expect([s.passed, s.failed, s.notTested]).toEqual([2, 2, 1]);
    expect(s.defects.map((d) => d.asset.id)).toEqual(['ext-2', 'det-1']);
    expect(s.notTestedByReason).toEqual([{ reason: 'No access to the area', assets: [expect.objectContaining({ id: 'el-1' })] }]);
    // A verdict against an asset no longer on the register cannot be written and is not counted as one.
    expect(s.orphaned).toBe(1);
  });

  it('writes a note the office can read in a list, with counts for passes and a line per failure', () => {
    const note = buildServiceNote(batch(), register(), SITE, 'Sam Tech', '2026-09-08T23:30:00.000Z');
    // The Queensland day, not the UTC one: half past eleven UTC is the ninth in Brisbane.
    expect(note).toContain('Riverbend Community Hall — 09/09/2026 — Sam Tech');
    expect(note).toContain('2 passed, 2 failed, 1 not tested.');
    expect(note).toContain('Passed: 2 extinguisher.');
    expect(note).toContain('- SQ-EXT-0002 Ground Kitchen Extinguisher 2 [EXT-EXT-001, CRITICAL]:');
    expect(note).toContain('- Level 2 Detector, plant room [DET-DET-002, high]:');
    expect(note).toContain('Not tested:\n- No access to the area: level 1  Exit sign over stair');
    // One line per failure, not the whole wording.
    const failLine = note.split('\n').find((l) => l.includes('EXT-EXT-001'))!;
    expect(failLine.match(/\./g)!.length).toBeLessThanOrEqual(1);
    expect(serviceNoteSubject(batch(), register())).toBe('Site test: 2 passed, 2 failed, 1 not tested');
  });

  it('leaves out the sections that have nothing in them', () => {
    const note = buildServiceNote({ 'ext-1': { kind: 'pass' } }, register(), SITE, undefined, '2026-09-09T01:00:00.000Z');
    expect(note).not.toContain('Failed:');
    expect(note).not.toContain('Not tested:');
    expect(note).not.toContain('—  —');
  });

  it('says what happened in one line', () => {
    expect(describeOutcome({ passed: 14, failed: 3, notTested: 2, defectsRaised: 3, queued: 17, refused: {}, noteJobId: '1234' }))
      .toBe('14 passed, 3 failed (3 defects raised), 2 not tested; 17 results queued for Simpro; note queued on job 1234');
    expect(describeOutcome({ passed: 1, failed: 0, notTested: 0, defectsRaised: 0, queued: 0, refused: { 'writing-disabled': 1 } }))
      .toBe('1 passed, 0 failed, 0 not tested');
  });
});

describe('candidate defects', () => {
  it('offers the asset type\'s own system only', () => {
    const codes = candidateDefects('extinguisher', 'hose perished at the nozzle');
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.length).toBeLessThanOrEqual(6);
    expect(new Set(codes.map((c) => c.system))).toEqual(new Set(['extinguisher']));
  });

  it('ranks the code whose name matches the words first', () => {
    const detector = candidateDefects('detector', 'painted over by the decorators');
    expect(detector[0]!.code).toBe('DET-DET-005');
    const missing = candidateDefects('detector', 'detector missing from base');
    expect(missing[0]!.code).toBe('DET-DET-003');
  });

  it('finds a word through its stem', () => {
    // "contaminated" typed as "contamination" still finds the contaminated code.
    const codes = candidateDefects('detector', 'heavy dust contamination');
    expect(codes.map((c) => c.code)).toContain('DET-DET-002');
  });

  it('shows the system by severity while nothing has been typed', () => {
    const codes = candidateDefects('detector', '');
    expect(codes[0]!.severity).toBe('critical');
    expect(codes.length).toBe(6);
    const order = codes.map((c) => SEVERITY_ORDER[c.severity]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('searches the whole library for an asset of no known type', () => {
    const codes = candidateDefects('unknown', 'door wedged open');
    expect(codes[0]!.system).toBe('door');
  });
});
