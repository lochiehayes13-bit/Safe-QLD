import {
  ISSUED_REFUSAL, createForm72, getForm72, issueForm72, listForm72, recordForm72DefectIds,
  recordOccupierCopy, updateForm72,
} from '@/db/form72Repo';
import { createSite } from '@/db/repo';
import { DEVICE_PRESETS } from '@/domain/form72Devices';
import type { FlowRow, Form72, TestDevice } from '@/domain/form72';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * A Form 72 going into the database and coming back out the same.
 *
 * Everything on this form is either a reading somebody took or a statement
 * somebody signed, so a field that does not survive storage is worse than a
 * field that was never added: the screen shows it, the technician fills it in,
 * and the page prints it absent. Three things in particular had no coverage at
 * all until now — the six attachment columns added in v34, the nested fields
 * that ride inside the JSON parts, and the refusals that stop an issued form
 * being edited — and all three are only provable by running the SQL.
 */

let db: NodeSqliteDb;

beforeEach(async () => {
  db = openMigrated();
  await createSite({ id: 's1', name: 'Baldwin Living', address: '12 Example Street' });
});

afterEach(async () => {
  await db.closeAsync();
});

const start = () => createForm72({
  siteId: 's1',
  siteName: 'Baldwin Living',
  siteAddress: '12 Example Street, Ipswich QLD 4305',
  contractor: 'Safe QLD Pty Ltd',
  systemLabel: 'Towns Main System',
  licenseeName: 'D. McKee',
  licenceNumber: '1310717',
  testDate: '2026-10-02',
});

/** Everything a form needs before it may be issued. */
const completable: Partial<Form72> = {
  testDate: '2026-10-02',
  maintenanceTest: {
    hydrantAnnual: true, hydrantFiveYear: false,
    sprinklerAnnual: false, sprinklerFiveYear: false,
    combinedAnnual: false, combinedFiveYear: false,
  },
  systemResult: 'pass',
  criticalDefectsIdentified: false,
  repairsRequired: false,
  licenseeName: 'D. McKee',
  licenceNumber: '1310717',
  signature: 'data:image/png;base64,AAA',
};

describe('the attachment columns v34 added', () => {
  it('writes all six and reads all six back', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      owner: 'Baldwin Living Pty Ltd',
      ownerContact: '07 3000 0000',
      buildingClassification: 'Class 3',
      technician: 'C. Whitmore',
      qualification: 'FPAS FSA-2',
      defects: [
        { description: 'Booster inlet valve seized', critical: true },
        { description: 'Block plan faded', critical: false },
      ],
    });

    const back = await getForm72(rec.id);
    expect(back).toMatchObject({
      owner: 'Baldwin Living Pty Ltd',
      ownerContact: '07 3000 0000',
      buildingClassification: 'Class 3',
      technician: 'C. Whitmore',
      qualification: 'FPAS FSA-2',
    });
    expect(back!.defects).toEqual([
      { description: 'Booster inlet valve seized', critical: true },
      { description: 'Block plan faded', critical: false },
    ]);
  });

  it('starts a new form with an empty defect list, not an absent one', async () => {
    const rec = await start();
    expect(rec.defects).toEqual([]);
    expect((await getForm72(rec.id))!.defects).toEqual([]);
  });

  it('can take a defect back off, which a skip-on-undefined patch could not', async () => {
    const rec = await start();
    await updateForm72(rec.id, { defects: [{ description: 'Mistyped', critical: true }] });
    await updateForm72(rec.id, { defects: [] });
    expect((await getForm72(rec.id))!.defects).toEqual([]);
  });

  it('can clear an owner somebody entered against the wrong site', async () => {
    const rec = await start();
    await updateForm72(rec.id, { owner: 'Wrong Pty Ltd' });
    await updateForm72(rec.id, { owner: '' });
    expect((await getForm72(rec.id))!.owner).toBeUndefined();
  });

  it('survives a form written before v34, which has those columns null', async () => {
    // The whole reason the six are nullable with no DEFAULT: a form already on
    // a phone reads back as an unnamed owner and an empty defect list rather
    // than failing to read at all.
    const rec = await start();
    await db.runAsync(
      `UPDATE form_72 SET owner = NULL, ownerContact = NULL, buildingClassification = NULL,
       technician = NULL, qualification = NULL, defects = NULL WHERE id = ?`,
      rec.id,
    );
    const back = await getForm72(rec.id);
    expect(back!.defects).toEqual([]);
    expect(back!.owner).toBeUndefined();
    expect(back!.technician).toBeUndefined();
  });

  it('treats a corrupt defect list as empty rather than failing the whole form', async () => {
    const rec = await start();
    await db.runAsync("UPDATE form_72 SET defects = '{not json' WHERE id = ?", rec.id);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const back = await getForm72(rec.id);
    expect(back!.defects).toEqual([]);
    // One corrupt column costs that column, not the form.
    expect(back!.siteName).toBe('Baldwin Living');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the fields that ride inside the JSON parts', () => {
  /*
   * Part C's two "Calibrated:" dates had no column at all.
   *
   * The screen offered both boxes, the renderer printed both, and the write
   * path dropped them on the floor — so the date was there while the form was
   * open and gone the next time it was opened, and a reprint of a form already
   * issued to an occupier said the device had no calibration date. Only
   * running the SQL proves this one: the types were right the whole time.
   */
  it('keeps Part C’s mechanical and electromagnetic calibration dates', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      flowDeviceKinds: ['mechanical', 'electromagnetic'],
      flowDeviceCalibrated: { mechanical: '2026-01-05', electromagnetic: '2026-07-18' },
    });

    const back = await getForm72(rec.id);
    expect(back!.flowDeviceCalibrated).toEqual({
      mechanical: '2026-01-05', electromagnetic: '2026-07-18',
    });
  });

  it('keeps one of the two on its own, because they are answered separately', async () => {
    const rec = await start();
    await updateForm72(rec.id, { flowDeviceCalibrated: { electromagnetic: '2026-07-18' } });

    const back = await getForm72(rec.id);
    expect(back!.flowDeviceCalibrated).toEqual({ electromagnetic: '2026-07-18' });
  });

  it('reads a form that never had the column as nobody having typed a date', async () => {
    const rec = await start();
    const back = await getForm72(rec.id);
    expect(back!.flowDeviceCalibrated).toEqual({});
  });

  it('clears a date that was typed by mistake', async () => {
    const rec = await start();
    await updateForm72(rec.id, { flowDeviceCalibrated: { mechanical: '2026-01-05' } });
    await updateForm72(rec.id, { flowDeviceCalibrated: {} });

    const back = await getForm72(rec.id);
    expect(back!.flowDeviceCalibrated).toEqual({});
  });

  it('keeps a device’s correction factor, calibration basis, kind and model', async () => {
    const rec = await start();
    const devices: TestDevice[] = DEVICE_PRESETS.map((p, i) => ({
      slot: `Device/gauge ${i + 1}`, ...p.device,
    }));
    await updateForm72(rec.id, { devices });

    const back = await getForm72(rec.id);
    expect(back!.devices).toHaveLength(2);
    expect(back!.devices[0]).toMatchObject({
      serialNumber: 'SQF-001',
      correctionFactor: '+0.35 % (MM Error)',
      calibrationBasis: 'service-life',
      kind: 'flow-meter',
      dateCalibrated: '2026-07-18',
    });
    expect(back!.devices[0]!.model).toContain('Flowtech');
  });

  it('keeps a nozzle row and a four-hydrant reading, which the model gained together', async () => {
    const rec = await start();
    const rows: FlowRow[] = [
      { nozzleMm: 19, devices: 'Pitot 1', hydrant1Kpa: 540 },
      {
        rateLps: 20, devices: 'SQF-001', hydrant1Kpa: 380, hydrants12Kpa: 320,
        hydrants123Kpa: 280, hydrants1234Kpa: 255,
      },
    ];
    await updateForm72(rec.id, {
      flowTest: {
        result: 'pass', hydrantLocations: ['Booster', 'Roof'], rows,
        requiredLps: 20, requiredKpa: 250, achievedLps: 21, achievedKpa: 260,
      },
    });

    const back = await getForm72(rec.id);
    expect(back!.flowTest.rows).toEqual(rows);
    expect(back!.flowTest).toMatchObject({
      requiredLps: 20, requiredKpa: 250, achievedLps: 21, achievedKpa: 260,
    });
  });

  it('keeps the stated frictional loss beside the readings it may disagree with', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      booster: {
        result: 'pass', boostPressureKpa: 1400, hydrantResidualKpa: 900,
        highestHydrantAboveBoosterM: 24, statedFrictionalLossKpa: 265,
      },
    });
    expect((await getForm72(rec.id))!.booster.statedFrictionalLossKpa).toBe(265);
  });

  it('keeps a test point’s typed Pass and Fail ticks', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      sprinklerFlow: {
        result: 'pass',
        testPoints: [{
          location: 'Valve room 1', requiredFlowLpm: 540, resultFlowLpm: 538,
          flowResult: 'pass', requiredPressureKpa: 200, resultPressureKpa: 210,
          pressureResult: 'pass',
        }],
      },
    });
    const point = (await getForm72(rec.id))!.sprinklerFlow.testPoints[0]!;
    expect(point.flowResult).toBe('pass');
    expect(point.pressureResult).toBe('pass');
  });

  it('replaces a part’s list wholesale, so a deleted row does not come back', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      flowTest: {
        result: 'pass', hydrantLocations: ['Booster', 'Roof'],
        rows: [{ rateLps: 10, devices: 'a' }, { rateLps: 20, devices: 'b' }],
      },
    });
    await updateForm72(rec.id, {
      flowTest: { result: 'pass', hydrantLocations: ['Booster'], rows: [{ rateLps: 10, devices: 'a' }] },
    });
    const back = await getForm72(rec.id);
    expect(back!.flowTest.rows).toHaveLength(1);
    expect(back!.flowTest.hydrantLocations).toEqual(['Booster']);
  });
});

describe('what an issued form refuses', () => {
  it('refuses to issue a form whose gauge was out of calibration, and says why', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      ...completable,
      devices: [{ slot: 'Device/gauge 1', serialNumber: 'PG-1', dateCalibrated: '2024-01-15' }],
    });
    await expect(issueForm72(rec.id)).rejects.toThrow(/calibrat/i);
  });

  it('issues a form whose meter is certified for its service life', async () => {
    // The same date on the twelve-month rule would have blocked it.
    const rec = await start();
    await updateForm72(rec.id, {
      ...completable,
      testDate: '2028-03-01',
      devices: [{
        slot: 'Device/gauge 1', serialNumber: 'SQF-001', dateCalibrated: '2026-07-18',
        calibrationBasis: 'service-life', kind: 'flow-meter',
      }],
    });
    const issued = await issueForm72(rec.id);
    expect(issued.status).toBe('issued');
    expect(issued.issuedAt).toBeTruthy();
  });

  it('refuses a critical defect listed against a Part H that says there are none', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      ...completable,
      defects: [{ description: 'Booster inlet valve seized', critical: true }],
    });
    await expect(issueForm72(rec.id)).rejects.toThrow(/flagged critical/);
  });

  it('refuses every edit once issued, including the new attachment fields', async () => {
    const rec = await start();
    await updateForm72(rec.id, completable);
    await issueForm72(rec.id);
    await expect(updateForm72(rec.id, { owner: 'Someone else' })).rejects.toThrow(ISSUED_REFUSAL);
    await expect(updateForm72(rec.id, { defects: [] })).rejects.toThrow(ISSUED_REFUSAL);
  });

  it('records the occupier’s copy, which is the one thing an issued form still accepts', async () => {
    const rec = await start();
    await updateForm72(rec.id, completable);
    await issueForm72(rec.id);
    await recordOccupierCopy(rec.id, '2026-10-09T01:00:00.000Z');
    expect((await getForm72(rec.id))!.copyGivenAt).toBe('2026-10-09T01:00:00.000Z');
  });

  it('lists a site’s forms newest test first', async () => {
    const a = await createForm72({ siteId: 's1', siteName: 'Baldwin Living', testDate: '2025-10-02' });
    const b = await createForm72({ siteId: 's1', siteName: 'Baldwin Living', testDate: '2026-10-02' });
    expect((await listForm72('s1')).map((f) => f.id)).toEqual([b.id, a.id]);
  });
});

describe('a defect that became a register row', () => {
  /*
   * A critical defect on a Form 72 obliges the owner or occupier to be given a
   * written notice, and the notice is raised from the defect register rather
   * than from this form. Issuing the form does not discharge that — so a
   * defect on a form signed yesterday still has to reach the office, and
   * recording which register row it became is filing rather than editing.
   */
  it('records the ids on a draft', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      defects: [
        { description: 'Booster inlet valve seized', critical: true },
        { description: 'Block plan faded', critical: false },
      ],
    });
    await recordForm72DefectIds(rec.id, ['def-1', 'def-2']);
    expect((await getForm72(rec.id))!.defects).toEqual([
      { description: 'Booster inlet valve seized', critical: true, defectId: 'def-1' },
      { description: 'Block plan faded', critical: false, defectId: 'def-2' },
    ]);
  });

  it('records them on an issued form, which is the whole reason it exists', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      ...completable,
      criticalDefectsIdentified: true,
      systemResult: 'fail',
      systemNotes: 'Isolated pending repair.',
      defects: [{ description: 'Booster inlet valve seized', critical: true }],
    });
    await issueForm72(rec.id);
    // Every other edit is refused.
    await expect(updateForm72(rec.id, { defects: [] })).rejects.toThrow(ISSUED_REFUSAL);
    await recordForm72DefectIds(rec.id, ['def-1']);
    expect((await getForm72(rec.id))!.defects[0]!.defectId).toBe('def-1');
  });

  it('cannot reach the text of a signed form through that door', async () => {
    // Only the ids move: the descriptions and the critical flags are read back
    // off the stored row and written out untouched, matched by position.
    const rec = await start();
    await updateForm72(rec.id, {
      defects: [{ description: 'Booster inlet valve seized', critical: true }],
    });
    await recordForm72DefectIds(rec.id, ['def-1']);
    const back = await getForm72(rec.id);
    expect(back!.defects[0]).toEqual({
      description: 'Booster inlet valve seized', critical: true, defectId: 'def-1',
    });
  });

  it('never replaces an id already there, which would orphan a register row', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      defects: [{ description: 'Seized', critical: true, defectId: 'def-first' }],
    });
    await recordForm72DefectIds(rec.id, ['def-second']);
    expect((await getForm72(rec.id))!.defects[0]!.defectId).toBe('def-first');
  });

  it('drops an id for a position the form no longer holds', async () => {
    const rec = await start();
    await updateForm72(rec.id, { defects: [{ description: 'One', critical: false }] });
    await recordForm72DefectIds(rec.id, ['def-1', 'def-2', 'def-3']);
    const back = await getForm72(rec.id);
    expect(back!.defects).toHaveLength(1);
    expect(back!.defects[0]!.defectId).toBe('def-1');
  });

  it('leaves a defect alone where no id was given for it', async () => {
    const rec = await start();
    await updateForm72(rec.id, {
      defects: [{ description: 'One', critical: false }, { description: 'Two', critical: true }],
    });
    await recordForm72DefectIds(rec.id, [undefined, 'def-2']);
    const back = await getForm72(rec.id);
    expect(back!.defects[0]!.defectId).toBeUndefined();
    expect(back!.defects[1]!.defectId).toBe('def-2');
  });

  it('refuses a form that is gone', async () => {
    await expect(recordForm72DefectIds('nope', ['x'])).rejects.toThrow('no longer exists');
  });
});
