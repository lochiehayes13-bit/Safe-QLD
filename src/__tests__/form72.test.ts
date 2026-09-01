import {
  DECLARATION, DEPARTMENT_NOTE, FORM_72_SOURCES, STANDARD_FLOW_RATES_LPS,
  flowTableRows, form72Html, frictionalLossGaps, occupierCopyDueBy, testPointOutcome,
  testerCopyKeepUntil, type Form72DocumentInput,
} from '@/export/form72';
import { MIGRATION_V12 } from '@/db/schemaForm72';
import { emptyForm72, type Form72 } from '@/domain/form72';

/**
 * Form 72 as the document that gets handed over.
 *
 * A Form 72 is not a report. It is the record QDC MP 6.1 requires a licensee to
 * complete, sign and give to the building occupier, and it is read years later
 * by somebody arguing about a fire. So the assertions here are about what the
 * page must never let that reader conclude:
 *
 *  - that a part was overlooked, when the technician decided it did not apply;
 *  - that a reading was taken, when the box was left empty;
 *  - that the pressures on the page mean anything, when the gauge that read
 *    them was out of calibration;
 *  - that the form is a valid statutory record, when it cannot be issued.
 *
 * Each of those is the page's fault if it does not say otherwise, so it says
 * otherwise in its own text and these tests hold it to that.
 */

const NOW = '2026-07-03T00:00:00.000Z';

/** A form with nothing blocking it, so a test can spoil exactly one thing. */
const issuable = (over: Partial<Form72> = {}): Form72 => ({
  ...emptyForm72({
    id: 'f1', siteId: 's1', siteName: 'Baldwin Living', contractor: 'Safe QLD Pty Ltd', now: NOW,
  }),
  siteAddress: '12 Example Street, Ipswich QLD 4305',
  testDate: '2026-07-03',
  testTime: '09:30',
  maintenanceTest: {
    hydrantAnnual: true, hydrantFiveYear: false,
    sprinklerAnnual: false, sprinklerFiveYear: false,
    combinedAnnual: false, combinedFiveYear: false,
  },
  devices: [
    {
      slot: 'Device 1', serialNumber: 'BFS-01', dateCalibrated: '2025-07-20',
      calibrationCertificate: 'CR-BFS-03', digitalReader: true,
    },
    { slot: 'Gauge 1', serialNumber: 'BFS-02', dateCalibrated: '2025-07-20', faceSize: '100mm', incrementsKpa: 50 },
  ],
  systemResult: 'pass',
  criticalDefectsIdentified: false,
  repairsRequired: false,
  licenseeName: 'D. McKee',
  licenceNumber: '1310717',
  ...over,
});

const doc = (over: Partial<Form72DocumentInput> = {}): Form72DocumentInput => ({
  form: issuable(),
  systemLabel: 'Towns Main System',
  generatedAt: '2026-07-06T02:00:00.000Z',
  ...over,
});

const flat = (html: string): string => html.replace(/\s+/g, ' ');

/** The markup between two anchors, so an assertion can be scoped to one part. */
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = to ? html.indexOf(to, start) : html.length;
  return html.slice(start, end < 0 ? html.length : end);
}

describe('the form reproduces the department’s document', () => {
  const html = form72Html(doc());

  it('prints all nine parts, in the order the department prints them', () => {
    const parts = [
      'Part A — Test details',
      'Part B — Hydrant Hydrostatic Test',
      'Part C — Hydrant Test Equipment / Pressure Gauges',
      'Part D — Hydrant System Flow Test',
      'Part E — Pump Appliance Booster Test',
      'Part F — Sprinkler Hydrostatic Test',
      'Part G — Sprinkler System Flow Test',
      'Part H — Compliance',
      'Part I — Signature',
    ];
    let cursor = -1;
    for (const part of parts) {
      const at = html.indexOf(part);
      expect({ part, found: at >= 0 }).toEqual({ part, found: true });
      expect({ part, inOrder: at > cursor }).toEqual({ part, inOrder: true });
      cursor = at;
    }
  });

  it('carries the form version and the system it covers, because one site needs a form for each', () => {
    expect(html).toContain('Version 1 – July 2014');
    expect(html).toContain('Towns Main System');
  });

  it('states the statutory basis in the department’s own words rather than summarising it', () => {
    expect(flat(html)).toContain('Queensland Development Code – Mandatory Part (MP) 6.1');
    expect(flat(html)).toContain('Building Act 1975, s.30');
    expect(flat(html)).toContain('This form does not comprise all maintenance requirements');
  });

  it('prints the department’s closing note and its Crown copyright line', () => {
    expect(flat(html)).toContain(flat(DEPARTMENT_NOTE));
    expect(html).toContain('© The State of Queensland (Department of Housing and Public Works) 2014.');
  });

  it('prints the Part I declaration in full, because that sentence is what is signed', () => {
    expect(flat(html)).toContain(flat(DECLARATION));
    expect(DECLARATION).toContain('correct to the best of my knowledge');
    expect(DECLARATION).toContain('in accordance with the relevant standards, codes and regulations');
  });

  it('writes dates the Australian way, so 07/03 is never read as March', () => {
    expect(html).toContain('03/07/2026');
    expect(html).not.toContain('2026-07-03');
  });

  it('cites where the wording came from, with a confidence on each', () => {
    expect(FORM_72_SOURCES.length).toBeGreaterThan(0);
    for (const s of FORM_72_SOURCES) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(s.fact.length).toBeGreaterThan(20);
    }
    // The declaration is the one line taken from a transcription rather than
    // from a copy the company holds, and it is recorded as such.
    const declaration = FORM_72_SOURCES.find((s) => s.fact.includes('Part I declaration'));
    expect(declaration?.confidence).toBe('medium');
  });
});

describe('N/A is a real answer and a blank is not', () => {
  it('ticks the N/A box of a part the job did not use', () => {
    const html = form72Html(doc());
    const partF = between(html, 'Part F — Sprinkler Hydrostatic Test', 'Part G —');
    expect(partF).toContain('<span class="rl">N/A</span><span class="rb on">');
    expect(partF).not.toContain('<span class="rl">PASS</span><span class="rb on">');
  });

  it('prints N/A in the boxes of an N/A part instead of leaving them empty', () => {
    const html = form72Html(doc());
    const partF = between(html, 'Part F — Sprinkler Hydrostatic Test', 'Part G —');
    expect(partF).toContain('<span class="na">N/A</span>');
    expect(partF).not.toContain('Not recorded');
  });

  it('prints "Not recorded" where a live part has an empty box, because a blank reads as an omission', () => {
    const html = form72Html(doc({
      form: issuable({ hydrostatic: { result: 'pass', testPressureKpa: 1700, durationMinutes: 120 } }),
    }));
    const partB = between(html, 'Part B — Hydrant Hydrostatic Test', 'Part C —');
    expect(partB).toContain('1700');
    // Boost pressure, end of test pressure and loss were never written down.
    expect(partB).toContain('<span class="missing">Not recorded</span>');
    expect(partB).not.toContain('<span class="na">N/A</span>');
  });

  it('says why Part D has nothing ticked, because the department prints no N/A box there', () => {
    const html = form72Html(doc());
    const partD = between(html, 'Part D — Hydrant System Flow Test', 'Part E —');
    expect(flat(partD)).toContain(
      "Recorded as not applicable. Part D of the department's form carries no N/A box",
    );
  });

  it('marks an unanswered Part H question as unanswered rather than as a No', () => {
    const html = form72Html(doc({ form: issuable({ criticalDefectsIdentified: undefined }) }));
    const partH = between(html, 'Critical Defects Identified', 'Repairs/Corrective Actions');
    expect(partH).toContain('Not answered');
    expect(partH).not.toContain('<span class="cb on">&#10007;</span>No');
  });
});

describe('the gauge nobody reading the paper can check', () => {
  const stale = form72Html(doc({
    form: issuable({
      devices: [{
        slot: 'Device 1', serialNumber: 'BFS-01', dateCalibrated: '2024-01-04',
        calibrationCertificate: 'CR-BFS-03',
      }],
    }),
  }));

  it('stamps the form NOT FOR ISSUE when the test equipment is out of calibration', () => {
    expect(stale).toContain('DRAFT — NOT FOR ISSUE');
    expect(flat(stale)).toContain('Part C — Device 1 (BFS-01) was last calibrated');
  });

  it('says why a stale gauge matters, rather than just flagging the date', () => {
    expect(flat(stale)).toContain(
      'Every pressure recorded on this form was read with it, and a gauge out of calibration makes '
      + 'all of them unusable.',
    );
  });

  it('repeats the finding beside Part C, where the equipment is listed', () => {
    const partC = between(stale, 'Part C — Hydrant Test Equipment', 'Part D —');
    expect(partC).toContain('<li class="blocking">');
    expect(partC).toContain('was last calibrated');
  });

  it('does not stamp a form whose gauge is inside its twelve months', () => {
    const html = form72Html(doc());
    expect(html).not.toContain('DRAFT — NOT FOR ISSUE');
  });

  it('cautions without blocking when a device has no calibration date at all', () => {
    // Worth knowing, but not the same thing as a gauge known to be stale: the
    // date may simply be back at the office.
    const html = form72Html(doc({
      form: issuable({ devices: [{ slot: 'Device 1', serialNumber: 'BFS-01' }] }),
    }));
    expect(html).not.toContain('DRAFT — NOT FOR ISSUE');
    expect(html).toContain('Check before issue');
    expect(flat(html)).toContain('has no calibration date, so its readings cannot be relied on');
  });
});

describe('a form that cannot be issued says why, on its face', () => {
  const blank = form72Html(doc({
    form: emptyForm72({ id: 'f2', siteId: 's1', siteName: 'Baldwin Living', now: NOW }),
  }));

  it('refuses to look like a valid record when nothing has been filled in', () => {
    expect(blank).toContain('DRAFT — NOT FOR ISSUE');
    expect(flat(blank)).toContain(
      'This form is not complete enough to be given to an occupier or relied on as a record under '
      + 'QDC MP 6.1.',
    );
  });

  it('lists every blocking reason, so nobody is sent back twice', () => {
    expect(flat(blank)).toContain('Part A — No test date.');
    expect(flat(blank)).toContain('Part A — No contractor named.');
    expect(flat(blank)).toContain('Part I — No licensee name.');
    expect(flat(blank)).toContain('Part I — No QBCC or PIC licence number.');
    expect(flat(blank)).toContain('No maintenance test ticked, so the form does not say what was done.');
  });

  it('blocks a form that failed while leaving the critical defect question unanswered', () => {
    // The answer decides whether the occupier is handed a statutory notice, so
    // it cannot be left to be inferred from the fail.
    const html = form72Html(doc({
      form: issuable({ systemResult: 'fail', criticalDefectsIdentified: undefined, systemNotes: 'Investigating.' }),
    }));
    expect(html).toContain('DRAFT — NOT FOR ISSUE');
    expect(flat(html)).toContain('the occupier has to be given a notice');
  });

  it('blocks a form that claims a pass with critical defects identified', () => {
    const html = form72Html(doc({ form: issuable({ criticalDefectsIdentified: true }) }));
    expect(html).toContain('DRAFT — NOT FOR ISSUE');
    expect(flat(html)).toContain('Critical defects were identified but the system is marked as a pass.');
  });
});

describe('Part D — the flow table', () => {
  it('prints all five of the department’s rates even where only one was run', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Main entry', 'Loading dock'], staticPressureKpa: 620,
          rows: [{ rateLps: 20, devices: 'DG1, DG2', hydrant1Kpa: 320, hydrants12Kpa: 240, hydrants123Kpa: 200 }],
          systemAchieved: '20 L/s @ 200 kPa',
        },
      }),
    }));
    const partD = between(html, 'Size/flow rate', 'System achieved');
    for (const rate of STANDARD_FLOW_RATES_LPS) expect(partD).toContain(`${rate} L/s`);
    expect(partD).toContain('320');
    // A rate that was not run is stated as not run, not left to look like a pass.
    expect(partD).toContain('Not run');
  });

  it('separates a rate that was never run from a reading that was never written down', () => {
    // Both are blanks on paper and they mean opposite things: three untouched
    // rates are normal, a half-filled row is a gap somebody has to answer for.
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: [],
          rows: [{ rateLps: 20, devices: 'DG1, DG2', hydrant1Kpa: 320 }],
        },
      }),
    }));
    const partD = between(html, 'Size/flow rate', 'System achieved');
    const twenty = between(partD, '20 L/s', '30 L/s');
    expect(twenty).toContain('Not recorded');
    expect(twenty).not.toContain('Not run');
    const thirty = between(partD, '30 L/s', 'System achieved');
    expect(thirty).toContain('Not run');
    expect(thirty).not.toContain('Not recorded');
  });

  it('keeps a reading taken at a rate the printed form has no row for', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: [],
          rows: [{ rateLps: 25, devices: 'DG1', hydrant1Kpa: 280 }],
        },
      }),
    }));
    expect(html).toContain('25 L/s');
    expect(flat(html)).toContain("that the department's table does not print (25 L/s)");
    expect(flat(html)).toContain('rather than dropped to fit the printed layout');
  });

  it('never drops a second reading taken at the same rate', () => {
    const rows = flowTableRows({
      result: 'pass',
      hydrantLocations: [],
      rows: [
        { rateLps: 20, devices: 'DG1', hydrant1Kpa: 320 },
        { rateLps: 20, devices: 'DG1', hydrant1Kpa: 260 },
      ],
    });
    expect(rows).toHaveLength(STANDARD_FLOW_RATES_LPS.length + 1);
    expect(rows.filter((r) => r.row.rateLps === 20)).toHaveLength(2);
    expect(rows[rows.length - 1]!.standard).toBe(false);
  });

  it('records that the on-site pump set question was not answered', () => {
    const html = form72Html(doc({
      form: issuable({ flowTest: { result: 'pass', hydrantLocations: [], rows: [] } }),
    }));
    const partD = between(html, 'On-site pump set installed', 'Comment');
    expect(partD).toContain('Not answered');
  });
});

describe('Part E — the arithmetic the form asks for', () => {
  const booster = {
    result: 'pass' as const,
    hydrantLocations: 'Level 8 riser',
    highestHydrantAboveBoosterM: 12,
    requiredLps: 16,
    requiredKpa: 700,
    boostPressureKpa: 1400,
    hydrantResidualKpa: 900,
  };

  it('calculates the frictional loss and shows the working, so it can be checked', () => {
    const html = form72Html(doc({ form: issuable({ booster }) }));
    // 1400 kPa boost, less 12 m of head at 9.81 kPa/m, less 900 kPa residual.
    expect(html).toContain('382.3 kPa');
    expect(flat(html)).toContain('less 117.7 kPa of elevation head over 12 m');
  });

  it('refuses to state a frictional loss when a reading is missing, and names the reading', () => {
    const html = form72Html(doc({
      form: issuable({ booster: { result: 'pass', boostPressureKpa: 1400 } }),
    }));
    expect(html).toContain('Not calculated');
    expect(flat(html)).toContain('the height of the highest hydrant above the booster');
    expect(flat(html)).toContain('the residual pressure at the hydrant');
    expect(flat(html)).toContain(
      'A frictional loss worked out from an assumed figure is indistinguishable on the page from a '
      + 'measured one',
    );
    expect(html).not.toContain('382.3');
  });

  it('names exactly the readings that are absent and no others', () => {
    expect(frictionalLossGaps({ result: 'pass', boostPressureKpa: 1400 })).toEqual([
      'the height of the highest hydrant above the booster',
      'the residual pressure at the hydrant',
    ]);
    expect(frictionalLossGaps(booster)).toEqual([]);
  });

  it('states the 150% overload requirement from the duty on the form', () => {
    const html = form72Html(doc({ form: issuable({ booster }) }));
    expect(flat(html)).toContain('At 24 L/s the discharge pressure must still reach 455 kPa');
    expect(flat(html)).toContain('No overload run is recorded on this form, so the requirement is stated rather than answered');
  });

  it('answers the overload check when the run was actually made', () => {
    const html = form72Html(doc({
      form: issuable({ booster }), overload: { flowLps: 24, pressureKpa: 470 },
    }));
    expect(html).toContain('150% overload check — achieved.');
    expect(flat(html)).toContain('Measured 24 L/s at 470 kPa');
  });

  it('reports the shortfall rather than rounding a near miss up to a pass', () => {
    const html = form72Html(doc({
      form: issuable({ booster }), overload: { flowLps: 24, pressureKpa: 400 },
    }));
    expect(html).toContain('150% overload check — not achieved.');
    expect(flat(html)).toContain('short by 55 kPa');
  });

  it('rejects an overload run made below the required flow, whatever pressure it held', () => {
    const html = form72Html(doc({
      form: issuable({ booster }), overload: { flowLps: 18, pressureKpa: 900 },
    }));
    expect(html).toContain('150% overload check — not achieved.');
    expect(flat(html)).toContain('has not proved the pump at overload whatever pressure it held');
  });

  it('says the check cannot be stated at all when Part E has no duty on it', () => {
    const html = form72Html(doc({
      form: issuable({ booster: { result: 'pass', boostPressureKpa: 1400 } }),
    }));
    expect(flat(html)).toContain('150% overload check</b> — cannot be stated');
  });
});

describe('Part G — the sprinkler test points', () => {
  const sprinklerFlow = {
    result: 'pass' as const,
    systemSpec: '900 l/m @ 200 kPa',
    testPoints: [
      {
        location: 'Valve room 1', requiredFlowLpm: 900, resultFlowLpm: 950,
        requiredPressureKpa: 200, resultPressureKpa: 180,
      },
    ],
    runningTestGaugeKpa: 640,
  };

  it('decides each line from the figures rather than asking for the subtraction again', () => {
    const html = form72Html(doc({ form: issuable({ sprinklerFlow }) }));
    const flow = between(html, 'Required flow rate (L/min)', 'Required pressure (kPa)');
    expect(flow).toContain('<span class="cb on">&#10007;</span>Pass');
    const pressure = between(html, 'Required pressure (kPa)', 'Test Point 2');
    expect(pressure).toContain('<span class="cb on">&#10007;</span>Fail');
  });

  it('leaves a line undecided when there is nothing to compare the result against', () => {
    expect(testPointOutcome(900, undefined)).toBeUndefined();
    expect(testPointOutcome(undefined, 950)).toBeUndefined();
    expect(testPointOutcome(900, 900)).toBe('pass');
    expect(testPointOutcome(900, 899.9)).toBe('fail');
  });

  it('prints the achieved pair opposite the block plan figure only when both halves were measured', () => {
    const html = form72Html(doc({ form: issuable({ sprinklerFlow }) }));
    expect(html).toContain('950 l/m @ 180 kPa');

    const halfMeasured = form72Html(doc({
      form: issuable({
        sprinklerFlow: {
          result: 'pass', systemSpec: '900 l/m @ 200 kPa',
          testPoints: [{ location: 'Valve room 1', resultFlowLpm: 950 }],
        },
      }),
    }));
    expect(halfMeasured).not.toContain('950 l/m @');
  });

  it('says a second test point was not used, rather than flagging four missing readings', () => {
    const html = form72Html(doc({ form: issuable({ sprinklerFlow }) }));
    const second = between(html, 'Test Point 2', 'Running Test');
    expect(second).toContain('Not used');
    expect(second).not.toContain('Not recorded');
    expect(second).not.toContain('Not decided');
  });

  it('keeps a third test point the printed form has no room for', () => {
    const html = form72Html(doc({
      form: issuable({
        sprinklerFlow: {
          result: 'pass',
          testPoints: [
            { location: 'Valve room 1' }, { location: 'Valve room 2' }, { location: 'Roof tank' },
          ],
        },
      }),
    }));
    expect(html).toContain('Test Point 3');
    expect(html).toContain('Roof tank');
    expect(flat(html)).toContain("The department's form prints two; the rest are added above rather than left off.");
  });
});

describe('the obligations that follow the form', () => {
  it('gives the date the occupier’s copy is due, counting business days from the test', () => {
    // Friday 3 July 2026 plus ten business days is Friday 17 July 2026.
    expect(occupierCopyDueBy('2026-07-03')).toBe('2026-07-17');
    const html = form72Html(doc());
    expect(flat(html)).toContain('A copy is due to the building occupier by 17/07/2026');
    expect(flat(html)).toContain('under QDC MP 6.1 acceptable solution A4(b)');
  });

  it('says the deadline is optimistic, because public holidays are not modelled', () => {
    expect(flat(form72Html(doc()))).toContain('Public holidays are not counted');
  });

  it('cannot give a deadline for a form with no test date, and says so', () => {
    expect(occupierCopyDueBy(undefined)).toBeUndefined();
    const html = form72Html(doc({ form: issuable({ testDate: undefined }) }));
    expect(flat(html)).toContain(
      'The date a copy is due to the occupier cannot be given, because the form has no test date.',
    );
  });

  it('states the five years the tester keeps their own copy', () => {
    expect(testerCopyKeepUntil('2026-07-03')).toBe('2031-07-03');
    expect(flat(form72Html(doc()))).toContain('until at least 03/07/2031');
  });

  it('separates everything Safe QLD added from the department’s form', () => {
    // A reader must never take our deadline arithmetic for the department's
    // printed wording.
    const html = form72Html(doc());
    expect(html).toContain("Not part of the department's form.");
    expect(html.indexOf('Part I — Signature')).toBeLessThan(html.indexOf("Not part of the department's form."));
  });
});

describe('the storage the form lives in', () => {
  it('creates the form_72 table against the site, so a deleted site takes its forms with it', () => {
    expect(MIGRATION_V12).toContain('CREATE TABLE IF NOT EXISTS form_72');
    expect(MIGRATION_V12).toContain('REFERENCES site(id) ON DELETE CASCADE');
  });

  it('leaves the Part H answers nullable, because unanswered is not a No', () => {
    expect(MIGRATION_V12).toMatch(/criticalDefectsIdentified\s+INTEGER,/);
    expect(MIGRATION_V12).toMatch(/repairsRequired\s+INTEGER,/);
    expect(MIGRATION_V12).not.toMatch(/criticalDefectsIdentified\s+INTEGER\s+NOT NULL/);
  });

  it('gives every part of the form somewhere to be stored', () => {
    for (const column of [
      'maintenanceTest', 'hydrostatic', 'flowDeviceKinds', 'devices', 'flowTest', 'booster',
      'sprinklerHydrostatic', 'sprinklerFlow', 'systemResult', 'systemNotes', 'licenseeName',
      'licenceNumber', 'licenseeReportNumber', 'signature',
    ]) {
      expect({ column, present: MIGRATION_V12.includes(column) }).toEqual({ column, present: true });
    }
  });

  it('keeps the overload run nullable, so a test not done is never stored as zero pressure', () => {
    expect(MIGRATION_V12).toMatch(/overloadFlowLps\s+REAL,/);
    expect(MIGRATION_V12).toMatch(/overloadPressureKpa\s+REAL,/);
  });

  it('records when the occupier was given their copy, separately from when the form was issued', () => {
    expect(MIGRATION_V12).toContain('copyGivenAt');
    expect(MIGRATION_V12).toContain('issuedAt');
  });

  it('indexes the two questions the office actually asks of it', () => {
    // Matched on what the index covers rather than on its name: a rename is
    // cosmetic, a missing index on the outstanding-copy query is not.
    expect(MIGRATION_V12).toMatch(/CREATE INDEX[^;]+ON form_72\(siteId/);
    expect(MIGRATION_V12).toMatch(/CREATE INDEX[^;]+ON form_72\(status, copyGivenAt\)/);
  });
});

describe('the page itself', () => {
  it('answers a missing licensee report number instead of flagging it, because not every job has one', () => {
    const html = form72Html(doc());
    const partI = between(html, 'Licence No. (QBCC/PIC)', '</table>');
    expect(partI).toContain('<span class="na">None</span>');
    expect(partI).not.toContain('Not recorded');
  });

  it('escapes what a technician types, so a site called "Smith & Co <East>" cannot break the page', () => {
    const html = form72Html(doc({ form: issuable({ siteName: 'Smith & Co <East>' }) }));
    expect(html).toContain('Smith &amp; Co &lt;East&gt;');
    expect(html).not.toContain('<East>');
  });

  it('keeps a technician’s line breaks in a comment, because a run-on paragraph loses the second point', () => {
    const html = form72Html(doc({
      form: issuable({
        hydrostatic: {
          result: 'fail', testPressureKpa: 1700, durationMinutes: 120,
          comments: 'Held 1700 kPa for 120 minutes.\nWeep at the level 3 landing valve.',
        },
      }),
    }));
    expect(html).toContain('Held 1700 kPa for 120 minutes.<br />Weep at the level 3 landing valve.');
  });
});
