import { readFileSync } from 'node:fs';
import { SECTION_ORDER, SYSTEM_FOR_TYPE, unmappedAssetTypes } from '@/domain/reportSections';
import { ASSET_TYPES } from '@/seed/assetTypes';

/**
 * Every asset type has to belong to a section of the service report.
 *
 * A type with no mapping does not error — it falls into "unknown" and the
 * assets appear under a heading no client recognises, or the section is
 * dropped. Either way work that was done stops appearing on the document that
 * records it, and nothing says so.
 */

describe('the report section every asset type falls into', () => {
  it('leaves nothing unmapped that a technician would service', () => {
    // Structural types are the building, not equipment: a level and a room are
    // not serviced and have no place on a service report.
    const structural = new Set(['level', 'room', 'loop', 'module', 'fip-battery', 'speaker',
      'strobe', 'wip', 'asd', 'sampling-point', 'booster', 'flow-switch', 'pump-controller',
      'penetration', 'fire-damper', 'switchboard', 'rcd']);
    const missing = unmappedAssetTypes().filter((id) => !structural.has(id));
    expect(missing).toEqual([]);
  });

  it('is checked against the real type list, not a copy of it', () => {
    // If this ever reads zero the test above passes vacuously.
    expect(ASSET_TYPES.length).toBeGreaterThan(20);
  });
});

/**
 * Every column the report prints is a column something fills.
 *
 * `RoutineReportAsset.notes` was declared, the renderer gave every asset a
 * "Notes:" row for it because their own report has one, and the repository that
 * builds the report never selected the column or set the field. So the line
 * printed blank under every asset on every report — 453 assets in the real
 * register carry a note, and they are the kind the line exists for:
 * "Switchboard in office, use test switch", "Logbook inside switchboard",
 * "NIL OPERATION".
 *
 * The test that was meant to cover this counted the rows. Four assets, four
 * "Notes:" rows, green — and the rows were empty. Counting a thing is not the
 * same as checking it carries anything, and a field nobody fills is invisible
 * to a renderer test because the renderer was never the half that was broken.
 *
 * So this is checked where the two meet: the shape the document declares
 * against the code that populates it.
 */
describe('the fields the service report declares', () => {
  const TYPES = readFileSync('src/export/routineServiceReport.ts', 'utf8');
  const REPO = readFileSync('src/db/routineReportRepo.ts', 'utf8');

  /**
   * The object literal the repository builds, and nothing else in the file.
   *
   * Searching the whole file was the first attempt and it is useless here: the
   * repository declares a `Row` interface for the query result with a `notes`
   * field of its own, so the missing assignment matched the declaration of the
   * thing it was missing.
   */
  const mapping = REPO.split('const asset: RoutineReportAsset = {')[1]?.split('\n    };')[0] ?? '';

  /** The field names inside `interface RoutineReportAsset { ... }`. */
  const fields = (() => {
    const body = TYPES.split('export interface RoutineReportAsset {')[1]?.split('\n}')[0] ?? '';
    return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
  })();

  it('found the interface and the mapping it is checking', () => {
    // Either half can silently become empty, and an empty one passes forever.
    expect(fields).toEqual(expect.arrayContaining(['assetNumber', 'location', 'result', 'notes']));
    expect(mapping).toContain('assetNumber');
    expect(mapping.length).toBeGreaterThan(200);
  });

  it('are all filled in by the repository that builds one', () => {
    // Anchored to the start of a line so it sees an assignment rather than a
    // mention, and accepts object shorthand — `result,` fills the field as
    // surely as `result: x` does.
    const unfilled = fields.filter((f) => !new RegExp(`^\\s*${f}\\s*[:,]`, 'm').test(mapping));
    // Named rather than counted: the fix is one line in a mapping, and a number
    // does not say which line.
    expect(unfilled).toEqual([]);
  });

  it('reads the asset note out of the column that holds it', () => {
    // The field can be assigned from anything; this is the half that says it
    // comes from the register's own note rather than from something nearer to
    // hand. The SELECT is checked against the real schema in schema.test.ts.
    expect(REPO).toMatch(/SELECT[^`]*\ba\.notes\b/);
  });
});
