import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { ASSET_TYPES, type AssetTypeDef } from '@/seed/assetTypes';
import { parseAssetRegister } from '@/parsers/assetRegister';
import { SERVICE_ROUTINES, type ServiceRoutine } from '@/seed/serviceRoutines';
import {
  coverageGaps, isServiced, servicedTypeIds, siteCoverageGaps, systemsWithGaps,
} from '@/domain/serviceCoverage';

/**
 * Asset types no routine will ever pick up.
 *
 * The failure is quieter than not being tested. An inaccessible device is
 * attempted, cannot be reached, and lands on the coverage screen with its
 * reason against it. A type that no check anywhere names is never attempted, so
 * it produces no result of any kind — no pass, no failure, no gap. It sits in
 * the register looking like every other asset, and the only way anybody finds
 * out is by noticing an absence.
 *
 * The coverage screen says as much in its own text: "assets that have never
 * been attempted do not appear here — check the register for those." This is
 * what makes that sentence unnecessary.
 */

const type = (over: Partial<AssetTypeDef> = {}): AssetTypeDef => ({
  id: 'thing',
  label: 'Thing',
  system: 'detection',
  icon: 'circle',
  attributes: [],
  codePrefix: 'SQ-THG',
  ...over,
} as AssetTypeDef);

const routine = (assetTypeIds: (string | undefined)[]): ServiceRoutine => ({
  id: 'r1',
  label: 'A routine',
  system: 'detection',
  frequency: 'annual',
  description: '',
  sourceKind: 'standard',
  tests: assetTypeIds.map((assetTypeId, i) => ({
    id: `t${i}`,
    section: '1',
    label: `Check ${i}`,
    assetTypeId,
  })),
} as unknown as ServiceRoutine);

describe('servicedTypeIds', () => {
  it('collects the types the checks actually name', () => {
    expect([...servicedTypeIds([routine(['smoke', 'heat'])])].sort()).toEqual(['heat', 'smoke']);
  });

  it('ignores a check that names no type, because it runs for the system rather than per asset', () => {
    expect([...servicedTypeIds([routine([undefined, 'smoke'])])]).toEqual(['smoke']);
  });

  it('is empty for a routine set that names nothing', () => {
    expect([...servicedTypeIds([routine([undefined])])]).toEqual([]);
  });
});

describe('coverageGaps', () => {
  it('reports a type no check names', () => {
    const gaps = coverageGaps([routine(['smoke'])], [type({ id: 'smoke' }), type({ id: 'blanket' })]);
    expect(gaps.map((g) => g.type.id)).toEqual(['blanket']);
  });

  it('leaves out a container, because a container is not serviced, its contents are', () => {
    /*
     * The whole reason the flag exists. A level, a room, a loop and a fire panel
     * hold other assets rather than being tested themselves, and reporting a
     * floor as unserviced would bury the real ones in noise.
     */
    const gaps = coverageGaps([routine([])], [
      type({ id: 'level', container: true }),
      type({ id: 'blanket' }),
    ]);
    expect(gaps.map((g) => g.type.id)).toEqual(['blanket']);
  });

  it('says why each one matters, rather than listing an id', () => {
    const gaps = coverageGaps([routine([])], [type({ id: 'blanket', label: 'Fire blanket' })]);
    expect(gaps[0]!.because).toContain('fire blanket');
    expect(gaps[0]!.because).toContain('never be attempted'.replace('never be', 'never'));
  });

  it('is stable, so the same list does not reorder between two screens', () => {
    const types = [type({ id: 'z', system: 'gas' }), type({ id: 'a', system: 'detection' })];
    const first = coverageGaps([routine([])], types).map((g) => g.type.id);
    const second = coverageGaps([routine([])], [...types].reverse()).map((g) => g.type.id);
    expect(first).toEqual(second);
  });

  it('reports nothing when every type is covered', () => {
    expect(coverageGaps([routine(['smoke'])], [type({ id: 'smoke' })])).toEqual([]);
  });
});

describe('isServiced', () => {
  it('answers for one type without the caller building the set', () => {
    expect(isServiced('smoke', [routine(['smoke'])])).toBe(true);
    expect(isServiced('blanket', [routine(['smoke'])])).toBe(false);
  });
});

describe('siteCoverageGaps', () => {
  const types = [type({ id: 'smoke' }), type({ id: 'blanket' }), type({ id: 'cylinder', system: 'gas' })];

  it('reports only the gaps this site actually has assets for', () => {
    /*
     * A type nothing services is only a problem where the site has one.
     * Repeating all six at every site is a standing warning nobody reads.
     */
    const gaps = siteCoverageGaps(
      [{ assetTypeId: 'smoke' }, { assetTypeId: 'blanket' }, { assetTypeId: 'blanket' }],
      [routine(['smoke'])],
      types,
    );
    expect(gaps.map((g) => g.type.id)).toEqual(['blanket']);
  });

  it('counts them, because one is a note and forty is a job', () => {
    const gaps = siteCoverageGaps(
      [{ assetTypeId: 'blanket' }, { assetTypeId: 'blanket' }, { assetTypeId: 'blanket' }],
      [routine([])],
      types,
    );
    expect(gaps.find((g) => g.type.id === 'blanket')!.count).toBe(3);
  });

  it('says nothing about a site that has none of them', () => {
    expect(siteCoverageGaps([{ assetTypeId: 'smoke' }], [routine(['smoke'])], types)).toEqual([]);
  });

  it('says nothing about a site with no assets at all', () => {
    expect(siteCoverageGaps([], [routine([])], types)).toEqual([]);
  });
});

describe('against the real routines and asset types', () => {
  it('names the equipment that can be registered and never serviced', () => {
    /*
     * Pinned by id, so adding a routine that covers one of these makes this
     * test fail and somebody has to take it off the list on purpose. That is
     * the point: the list shrinking is good news and should be deliberate.
     */
    expect(coverageGaps().map((g) => g.type.id)).toEqual([
      'fip-battery',
      'smoke-alarm',
      'rcd',
      'speaker',
      'fire-blanket',
      'gas-cylinder',
    ]);
  });

  it('reports no routine naming an asset type that does not exist', () => {
    // A check whose assetTypeId resolves to nothing matches no asset and runs
    // silently against an empty list — a check that looks configured and does
    // nothing at all.
    const known = new Set(ASSET_TYPES.map((t) => t.id));
    const bogus = [...servicedTypeIds(SERVICE_ROUTINES)].filter((id) => !known.has(id));
    expect(bogus).toEqual([]);
  });

  it('has gaps in more than one system, so this is not one forgotten corner', () => {
    expect(systemsWithGaps().length).toBeGreaterThan(1);
  });

  it('does not report a container as a gap', () => {
    const containers = ASSET_TYPES.filter((t) => t.container).map((t) => t.id);
    const reported = coverageGaps().map((g) => g.type.id);
    expect(reported.filter((id) => containers.includes(id))).toEqual([]);
  });
});

/**
 * The same question asked of the real book of work.
 *
 * Skips where the register is not staged, which is every checkout but a
 * developer's — the register is customer data and is not committed. On a
 * machine that has it, this is the number that makes the point: it is not a
 * theoretical gap in a seed file, it is eight and a half per cent of the
 * assets Safe QLD services.
 */
const REGISTER_DIR = '/tmp/safeqld-data';
const registers = existsSync(REGISTER_DIR)
  ? readdirSync(REGISTER_DIR).filter((f) => f.endsWith('.csv'))
  : [];
const describeReal = registers.length ? describe : describe.skip;

describeReal('against the real asset register', () => {
  it('counts how much of the book falls in a type nothing services', () => {
    const gapIds = new Set(coverageGaps().map((g) => g.type.id));
    let total = 0;
    let affected = 0;
    for (const file of registers) {
      const parsed = parseAssetRegister(readFileSync(`${REGISTER_DIR}/${file}`, 'utf8'), file);
      for (const asset of parsed.assets) {
        total++;
        if (gapIds.has(asset.assetTypeId)) affected++;
      }
    }

    /*
     * At the time of writing: 1,077 of 12,553 — five hundred fire blankets,
     * five hundred and seventy-six smoke alarms and one gas cylinder. Asserted
     * as a proportion rather than a count so it survives the next register
     * export, and asserted at all so that covering these types later shows up
     * here as the improvement it is.
     */
    expect(total).toBeGreaterThan(1000);
    expect(affected / total).toBeLessThan(0.2);
    expect(affected).toBeGreaterThan(0);
  });
});
