import { ASSET_TYPES, SYSTEM_LABELS, assetTypeById, type SystemKind } from '@/seed/assetTypes';
import { DEFECT_LIBRARY, SEVERITY_LABEL, defectByCode } from '@/seed/defectLibrary';
import { FREQUENCY_LABEL, SERVICE_ROUTINES, SOURCE_LABEL } from '@/seed/serviceRoutines';
import { CATEGORY_LABEL } from '@/seed/catalogueCategories';
import { CATALOGUE_CHUNKS, CATALOGUE_SIZE } from '@/seed/catalogue/index';
import { OCCUPIER_STATEMENT_INSTALLATIONS, SYSTEM_TO_INSTALLATION } from '@/domain/qldCompliance';

/**
 * The seed data is three tables that reference each other by string id: a
 * routine check names the defect it raises, and the asset type it applies to.
 * Nothing at compile time checks those strings resolve, and nothing at runtime
 * complains when they do not — a check whose defectCode has a typo simply
 * raises no defect when it fails, silently, on a real job.
 *
 * These are the joins, asserted.
 */

describe('asset types', () => {
  it('has unique ids', () => {
    const ids = ASSET_TYPES.map((a) => a.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('belongs to a labelled system', () => {
    for (const a of ASSET_TYPES) {
      expect(SYSTEM_LABELS[a.system]).toBeTruthy();
    }
  });

  it('gives every attribute a unique key within its type', () => {
    for (const a of ASSET_TYPES) {
      const keys = (a.attributes ?? []).map((x) => x.key);
      expect(keys).toEqual([...new Set(keys)]);
    }
  });

  it('offers options for every select attribute', () => {
    // A select with no options renders an unanswerable field.
    for (const a of ASSET_TYPES) {
      for (const attr of a.attributes ?? []) {
        if (attr.type === 'select') expect(attr.options?.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('defect library', () => {
  it('has unique codes', () => {
    const codes = DEFECT_LIBRARY.map((d) => d.code);
    expect(codes).toEqual([...new Set(codes)]);
  });

  it('resolves every code through the lookup the app uses', () => {
    for (const d of DEFECT_LIBRARY) {
      expect(defectByCode(d.code)?.code).toBe(d.code);
    }
  });

  it('carries a labelled severity and the wording the reports depend on', () => {
    for (const d of DEFECT_LIBRARY) {
      expect(SEVERITY_LABEL[d.severity]).toBeTruthy();
      expect(d.reportWording.trim().length).toBeGreaterThan(0);
      expect(SYSTEM_LABELS[d.system]).toBeTruthy();
    }
  });
});

describe('service routines', () => {
  it('has unique routine ids', () => {
    const ids = SERVICE_ROUTINES.map((r) => r.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('gives every check a unique id within its routine', () => {
    // The runner keys a technician's answers by check id, so a duplicate would
    // make two checks share one answer.
    for (const r of SERVICE_ROUTINES) {
      const ids = r.tests.map((t) => t.id);
      expect({ routine: r.id, ids }).toEqual({ routine: r.id, ids: [...new Set(ids)] });
    }
  });

  it('names a defect code that exists, wherever a check raises one', () => {
    // This is the join the routine runner relies on to raise a defect
    // automatically. A typo here fails silently: the check fails, and nothing
    // is raised.
    for (const r of SERVICE_ROUTINES) {
      for (const t of r.tests) {
        if (!t.defectCode) continue;
        expect({ check: t.id, code: t.defectCode, found: !!defectByCode(t.defectCode) })
          .toEqual({ check: t.id, code: t.defectCode, found: true });
      }
    }
  });

  it('names an asset type that exists, wherever a check targets one', () => {
    for (const r of SERVICE_ROUTINES) {
      for (const t of r.tests) {
        if (!t.assetTypeId) continue;
        expect({ check: t.id, type: t.assetTypeId, found: !!assetTypeById(t.assetTypeId) })
          .toEqual({ check: t.id, type: t.assetTypeId, found: true });
      }
    }
  });

  it('targets asset types belonging to the routine’s own system', () => {
    // A check on an extinguisher inside a detection routine would never find
    // its assets: the runner resolves them by the routine's system.
    for (const r of SERVICE_ROUTINES) {
      for (const t of r.tests) {
        if (!t.assetTypeId) continue;
        const type = assetTypeById(t.assetTypeId);
        expect({ check: t.id, system: type?.system }).toEqual({ check: t.id, system: r.system });
      }
    }
  });

  it('records where every requirement comes from', () => {
    // The app promises never to blur a standard, a manufacturer instruction and
    // an internal procedure. That promise is only kept if each one says which.
    for (const r of SERVICE_ROUTINES) {
      expect(SYSTEM_LABELS[r.system]).toBeTruthy();
      expect(FREQUENCY_LABEL[r.frequency]).toBeTruthy();
      expect(r.tests.length).toBeGreaterThan(0);
      for (const t of r.tests) {
        expect(SOURCE_LABEL[t.sourceKind]).toBeTruthy();
        expect(t.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('gives a unit to every measurement it asks for', () => {
    for (const r of SERVICE_ROUTINES) {
      for (const t of r.tests) {
        if (!t.measurementKey) continue;
        expect({ check: t.id, unit: t.measurementUnit?.trim() || null })
          .not.toEqual({ check: t.id, unit: null });
      }
    }
  });
});

describe('catalogue categories', () => {
  it('labels every category the harvest scripts can produce', () => {
    // The scripts and this table are edited separately; an unlabelled category
    // shows as a blank filter chip.
    for (const key of ['pipe', 'passive', 'cable', 'tool', 'accessory', 'other']) {
      expect(CATEGORY_LABEL[key]).toBeTruthy();
    }
  });
});

describe('occupier statement mapping', () => {
  it('maps only to installations the statement actually lists', () => {
    for (const [system, installation] of Object.entries(SYSTEM_TO_INSTALLATION)) {
      expect({ system, listed: OCCUPIER_STATEMENT_INSTALLATIONS.includes(installation) })
        .toEqual({ system, listed: true });
    }
  });

  it('maps only from systems that exist', () => {
    for (const system of Object.keys(SYSTEM_TO_INSTALLATION)) {
      expect(SYSTEM_LABELS[system as SystemKind]).toBeTruthy();
    }
  });
});

describe('bundled catalogue chunks', () => {
  it('reports a size that matches what the chunks actually hold', () => {
    // The seed version key is built from this number. If it drifts from the
    // real total, the app compares against a version it will never reach and
    // either re-seeds on every launch or never re-seeds at all.
    const actual = CATALOGUE_CHUNKS.reduce((n, load) => n + load().length, 0);
    expect(actual).toBe(CATALOGUE_SIZE);
  });

  it('gives every row a part number and a brand, which the seeder requires', () => {
    // seedCatalogue skips a row missing either, silently. A chunk full of them
    // would seed as zero and look like a load failure.
    for (const load of CATALOGUE_CHUNKS) {
      for (const item of load()) {
        expect(typeof item.partNumber === 'string' && item.partNumber.trim().length > 0).toBe(true);
        expect(typeof item.brand === 'string' && item.brand.trim().length > 0).toBe(true);
      }
    }
  });

  it('keeps brand and part number unique across the whole catalogue', () => {
    // The table has a unique index on the pair, so duplicates would overwrite
    // each other and the seeded count would not match the bundle.
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const load of CATALOGUE_CHUNKS) {
      for (const item of load()) {
        const key = `${item.brand.toLowerCase()} ${item.partNumber.toLowerCase()}`;
        if (seen.has(key)) dupes.push(`${item.brand} ${item.partNumber}`);
        seen.add(key);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('labels every category present in the bundle', () => {
    const unlabelled = new Set<string>();
    for (const load of CATALOGUE_CHUNKS) {
      for (const item of load()) {
        if (item.category && !CATEGORY_LABEL[item.category]) unlabelled.add(item.category);
      }
    }
    expect([...unlabelled]).toEqual([]);
  });
});
