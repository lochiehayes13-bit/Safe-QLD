import {
  ADDED_BOX_NOTE,
  DECLARATION, DEPARTMENT_DEVICE_SLOTS, DEPARTMENT_NOTE, DEPARTMENT_PRIVACY, DEPARTMENT_RTI,
  FORM_72_SOURCES, FORM_SUBTITLE, FORM_TITLE, PART_D_LOCATION_SLOTS, STANDARD_FLOW_RATES_LPS,
  flowTableRows, form72Html, frictionalLossGaps, hydrantLocationsNeeded, occupierCopyDue,
  occupierCopyDueBy, qldCalendarDate, testPointOutcome, testerCopyKeepUntil,
  type Form72DocumentInput,
} from '@/export/form72';
import { MIGRATION_V12 } from '@/db/schemaForm72';
import { DEVICE_PRESETS, DEVICE_PRESET_SOURCE, unusedDevicePresets } from '@/domain/form72Devices';
import {
  CALIBRATED_FLOW_DEVICE_KINDS, CALIBRATION_MONTHS, FLOW_ROW_COLUMNS,
  flowCellState, flowRowColumnsRun,
  PART_D_NOZZLE_SIZES_MM, PART_D_ROWS, deviceCalibration, emptyForm72, intervalsTested,
  maintenanceTestCell, maintenanceTestFromAxes, overloadCheck, resolveFrictionalLoss,
  systemTypesTested, validateForm72,
  type FlowRow, type Form72, type MaintenanceTest, type TestDevice,
} from '@/domain/form72';
import { MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { MIGRATION_V34 } from '@/db/schemaV34';

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
      'Part B — Hydrant hydrostatic test',
      'Part C — Hydrant test equipment/pressure gauges',
      'Part D — Hydrant system flow test',
      'Part E — Pump appliance booster test',
      'Part F — Sprinkler hydrostatic test',
      'Part G — Sprinkler system flow test',
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
    expect(flat(html)).toContain('Building Act 1975, section 30');
    expect(flat(html)).toContain('this form does not comprise all maintenance requirements');
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
    const partF = between(html, 'Part F — Sprinkler hydrostatic test', 'Part G —');
    // The N/A box carries a + because the department prints only PASS and FAIL.
    expect(partF).toContain('<span class="rl">N/A<sup>+</sup></span><span class="rb on">');
    expect(partF).not.toContain('<span class="rl">PASS</span><span class="rb on">');
  });

  it('prints N/A in the boxes of an N/A part instead of leaving them empty', () => {
    const html = form72Html(doc());
    const partF = between(html, 'Part F — Sprinkler hydrostatic test', 'Part G —');
    expect(partF).toContain('<span class="na">N/A</span>');
    expect(partF).not.toContain('Not recorded');
  });

  it('prints "Not recorded" where a live part has an empty box, because a blank reads as an omission', () => {
    const html = form72Html(doc({
      form: issuable({ hydrostatic: { result: 'pass', testPressureKpa: 1700, durationMinutes: 120 } }),
    }));
    const partB = between(html, 'Part B — Hydrant hydrostatic test', 'Part C —');
    expect(partB).toContain('1700');
    // Boost pressure, end of test pressure and loss were never written down.
    expect(partB).toContain('<span class="missing">Not recorded</span>');
    expect(partB).not.toContain('<span class="na">N/A</span>');
  });

  it('says why Part D has nothing ticked, because the department prints no N/A box there', () => {
    const html = form72Html(doc());
    const partD = between(html, 'Part D — Hydrant system flow test', 'Part E —');
    expect(flat(partD)).toContain(
      "Recorded as not applicable. Part D of the department's form carries no N/A box",
    );
  });

  it('does not add an N/A box to a department part that has none', () => {
    // Part H's System row prints Pass and Fail and nothing else. A third box
    // here would be Safe QLD's, printed inside the department's part, where a
    // reader has no way to tell whose it is.
    const html = form72Html(doc({ form: issuable({ systemResult: 'na' }) }));
    const system = between(html, '<td class="k">System</td>', 'System notes');
    expect(system).toContain('Pass');
    expect(system).toContain('Fail');
    // The empty System notes box still says N/A, which is the department's own
    // box answered. What must not appear is a third tick box beside Pass/Fail.
    expect(system).not.toContain('N/A');
    const partH = between(html, 'Part H — Compliance', 'Part I —');
    expect(flat(partH)).toContain(
      "Recorded as not applicable. The department's System row carries only Pass and Fail",
    );
  });

  it('marks an unanswered Part H question as unanswered rather than as a No', () => {
    const html = form72Html(doc({ form: issuable({ criticalDefectsIdentified: undefined }) }));
    const partH = between(html, 'Critical defects identified', 'Repairs/corrective actions taken');
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
    const partC = between(stale, 'Part C — Hydrant test equipment', 'Part D —');
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

describe('dates written the Australian way', () => {
  it('refuses to read 1/9/2025 as a January calibration', () => {
    /*
     * Date.parse reads a slashed date month-first, so a gauge calibrated on
     * 1 September 2025 was dated 9 January and judged from there. The date is
     * unreadable to this form, and saying so is the only answer that does not
     * put a calibration finding on a date nobody wrote.
     */
    const out = deviceCalibration(
      { slot: 'Gauge 1', serialNumber: 'BFS-02', dateCalibrated: '1/9/2025' },
      '2026-07-03',
    );
    expect(out.state).not.toBe('in-calibration');
    expect(out.state).toBe('unreadable-date');
    expect(out.issue?.message).toMatch(/unreadable calibration date/);
  });

  it('blocks a form whose test date it cannot read, rather than dating it by guesswork', () => {
    // 3/7/2026 read month-first is 7 March, and every calibration on the form
    // is judged against it.
    const issues = validateForm72(issuable({ testDate: '3/7/2026' }));
    const partA = issues.filter((i) => i.part === 'A' && i.blocking);
    expect(partA.length).toBeGreaterThan(0);
    expect(partA.map((i) => i.message).join(' ')).toMatch(/test date/i);
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

  it('says a complete form is still only a draft, because a draft can still be edited', () => {
    // Nothing is outstanding, so the page prints clean — and a clean print of a
    // draft is indistinguishable from the statutory record. Hand it over, edit
    // a figure tomorrow, and the occupier's copy and ours disagree.
    const html = form72Html(doc({ status: 'draft' }));
    expect(html).not.toContain('DRAFT — NOT FOR ISSUE');
    expect(flat(html)).toContain('Draft copy — this form has not been issued');
    expect(flat(html)).toContain("the occupier's copy is the one that counts");
  });

  it('says an issued form was issued, and when', () => {
    const html = form72Html(doc({ status: 'issued', issuedAt: '2026-07-06T02:00:00.000Z' }));
    expect(flat(html)).toContain('Issued 06/07/2026, and held unaltered since.');
    expect(html).not.toContain('Draft copy');
  });

  it('claims neither when the caller did not say which it is', () => {
    const html = form72Html(doc());
    expect(html).not.toContain('Draft copy');
    expect(html).not.toContain('held unaltered since');
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
    /*
     * Both are blanks on paper and they mean opposite things, and the
     * distinction is per cell rather than per row.
     *
     * A row proved at two hydrants and nothing further is an ordinary complete
     * test: its third and fourth columns were not run. A row with readings at
     * one and at three hydrants and nothing at two is a gap somebody has to
     * answer for — the technician ran it and the figure is missing — and that
     * is the only blank on this table that should be red.
     */
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Booster', 'Roof', 'Level 3'],
          rows: [
            { rateLps: 20, devices: 'DG1, DG2', hydrant1Kpa: 320, hydrants12Kpa: 280 },
            { rateLps: 30, devices: 'DG1', hydrant1Kpa: 240, hydrants123Kpa: 180 },
          ],
        },
      }),
    }));
    const partD = between(html, 'Size/flow rate', 'System achieved');

    const twenty = between(partD, '>20 L/s<', '>30 L/s<');
    expect(twenty).toContain('Not run');
    expect(twenty).not.toContain('Not recorded');

    const thirty = between(partD, '>30 L/s<', 'System achieved');
    expect(thirty).toContain('Not recorded');
    expect(thirty).toContain('Not run');

    // And a row nobody touched at all is not run, start to finish.
    const fifteen = between(partD, '>15 L/s<', '>20 L/s<');
    expect(fifteen).not.toContain('Not recorded');
  });

  it('prints the unit with the reading, not with the words standing in for one', () => {
    // Printing it unconditionally produced "Not recorded kPa".
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Booster'],
          rows: [{ nozzleMm: 19, devices: 'Pitot 1', hydrant1Kpa: 540 }],
        },
      }),
    }));
    const partD = between(html, 'Size/flow rate', 'System achieved');
    expect(flat(partD)).toContain('540 <span class="u">kPa</span>');
    expect(flat(partD)).not.toContain('Not run</span> <span class="u">kPa');
    expect(flat(partD)).not.toContain('Not recorded</span> <span class="u">kPa');
  });

  it('does not flag the three columns a one-hydrant nozzle test never ran', () => {
    // A 19 mm nozzle proved at one hydrant is an ordinary complete test. Red in
    // its other three columns is the same mistake as flagging the five rates
    // nobody ran, one level down — and red where nothing is wrong teaches a
    // reader to skip the red that matters.
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Booster'],
          rows: [{ nozzleMm: 19, devices: 'Pitot 1', hydrant1Kpa: 540 }],
        },
      }),
    }));
    const partD = between(html, 'Size/flow rate', 'System achieved');
    const nozzle = between(partD, '>19 mm<', '>22 mm<');
    expect(nozzle).toContain('540');
    expect(nozzle).not.toContain('Not recorded');
    expect((nozzle.match(/Not run/g) ?? [])).toHaveLength(3);
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
    expect(flat(html)).toContain("that the department's table does not print (25 L/s device)");
    // Its row prints under "Other", not under one of the department's two groups.
    expect(flat(html)).toContain('<span class="extra">added</span>');
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
    expect(rows).toHaveLength(PART_D_ROWS.length + 1);
    expect(rows.filter((r) => r.row.rateLps === 20)).toHaveLength(2);
    expect(rows[rows.length - 1]!.standard).toBe(false);
  });

  it('flags a hydrant location the readings depend on, and lets go of the ones they do not', () => {
    // Two hydrants proved, two locations given: nothing is missing, and red on
    // those rows is red the reader learns to skip. Pressures in the three
    // hydrant column with no third location is a different thing entirely.
    const twoProved = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Main entry', 'Loading dock'],
          rows: [{ rateLps: 20, devices: 'DG1', hydrant1Kpa: 320, hydrants12Kpa: 240 }],
        },
      }),
    }));
    const locations = between(twoProved, 'Hydrant 1 location', 'System requirements');
    expect(locations).toContain('Main entry');
    expect(locations).not.toContain('Not recorded');
    expect(locations).toContain('Not used');

    const threeProved = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Main entry', 'Loading dock'],
          rows: [{ rateLps: 20, devices: 'DG1', hydrant1Kpa: 320, hydrants12Kpa: 240, hydrants123Kpa: 200 }],
        },
      }),
    }));
    const three = between(threeProved, 'Hydrant 3 location', 'Hydrant 2 location');
    expect(three).toContain('Not recorded');
    expect(hydrantLocationsNeeded({ result: 'pass', hydrantLocations: [], rows: [] })).toBe(0);
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

  it('shows an overload run recorded against a part marked N/A rather than dropping it', () => {
    // The run is stored beside the parts, so an N/A booster would otherwise
    // take a reading somebody took on site off the page without a word.
    const html = form72Html(doc({
      form: issuable({ booster: { result: 'na' } }), overload: { flowLps: 24, pressureKpa: 470 },
    }));
    expect(flat(html)).toContain('an overload run is recorded against this form (24 L/s at 470 kPa)');
    expect(flat(html)).toContain('One of the two is wrong');
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
    const pressure = between(html, 'Required pressure (kPa)', 'Test point 2');
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
    // The department writes litres per minute as L/min, not l/m.
    expect(html).toContain('950 L/min at 180 kPa');

    const halfMeasured = form72Html(doc({
      form: issuable({
        sprinklerFlow: {
          result: 'pass', systemSpec: '900 l/m @ 200 kPa',
          testPoints: [{ location: 'Valve room 1', resultFlowLpm: 950 }],
        },
      }),
    }));
    expect(halfMeasured).not.toContain('950 L/min at');
  });

  it('says a second test point was not used, rather than flagging four missing readings', () => {
    const html = form72Html(doc({ form: issuable({ sprinklerFlow }) }));
    const second = between(html, 'Test point 2', 'Running test');
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
    expect(html).toContain('Test point 3');
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

  it('skips Queensland public holidays, so a December job is not given a New Year deadline', () => {
    // Counting weekends only, a test on Friday 18 December 2026 comes out due
    // on 1 January 2027 — a public holiday, and wrong by three days. The count
    // is the app's own, against the holidays the state has appointed, which is
    // also the count the occupier statement uses for its ten business days.
    expect(occupierCopyDueBy('2026-12-18')).toBe('2027-01-06');
    const html = form72Html(doc({ form: issuable({ testDate: '2026-12-18' }) }));
    expect(flat(html)).toContain('by 06/01/2027');
    expect(flat(html)).toContain('Christmas Day 25/12/2026');
    expect(flat(html)).toContain("New Year's Day 01/01/2027");
  });

  it('names the business day definition it counted under, and what it could not account for', () => {
    const html = flat(form72Html(doc()));
    expect(html).toContain('Acts Interpretation Act 1954 (Qld), sch 1 (business day)');
    expect(html).toContain('No public holiday falls inside that count.');
    expect(html).toContain('District show and special holidays are appointed per local government area');
  });

  it('refuses a deadline it would have to invent holidays for, rather than printing one', () => {
    // The appointed holidays run out at the end of 2029. A date past that is a
    // guess wearing a date's clothes, and this document is handed to a client.
    const due = occupierCopyDue('2030-03-02');
    expect(due.date).toBeUndefined();
    expect(due.reason).toContain('Queensland public holidays are only known here');
    const html = form72Html(doc({ form: issuable({ testDate: '2030-03-02' }) }));
    expect(flat(html)).toContain('The date a copy is due to the occupier cannot be given.');
    expect(flat(html)).toContain('only known here for 1/1/2025 to 31/12/2029');
  });

  it('cannot give a deadline for a form with no test date, and says so', () => {
    expect(occupierCopyDueBy(undefined)).toBeUndefined();
    const html = form72Html(doc({ form: issuable({ testDate: undefined }) }));
    expect(flat(html)).toContain(
      'The date a copy is due to the occupier cannot be given. The form has no test date, and the '
      + 'ten business days run from the day the work was completed.',
    );
  });

  it('dates the document by the Queensland calendar, not by UTC', () => {
    // Produced at eight on a Brisbane morning, which is 22:00 the previous day
    // in UTC. Slicing the timestamp dates the form a day before it existed.
    expect(qldCalendarDate('2026-07-06T22:00:00.000Z')).toBe('2026-07-07');
    const html = form72Html(doc({ generatedAt: '2026-07-06T22:00:00.000Z' }));
    expect(flat(html)).toContain('from the readings recorded on site, 07/07/2026');
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
    const partI = between(html, 'Licence no. (QBCC/PIC)', '</table>');
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

/**
 * One device against the day it was used.
 *
 * Pulled out of the validation so the screen and the form ask the same
 * question. When they were separate the screen answered a narrower one: it
 * flagged a gauge past twelve months and said nothing at all about a gauge with
 * no calibration date on it — the same unusable reading, with less evidence
 * behind it, shown to a technician as though it were fine.
 */
describe('Part H — what a failure obliges', () => {
  const msgs = (over: Partial<Form72>) =>
    validateForm72(issuable(over)).map((i) => i.message).join('\n');

  it('asks what happens next where the flow test failed', () => {
    // A failed flow test with no note is a form that records a problem and
    // nothing about it. The note is what the next person reads.
    expect(msgs({ flowTest: { result: 'fail', hydrantLocations: [], rows: [] }, systemNotes: '' }))
      .toContain('no system note saying what happens next');
  });

  it('is satisfied once the note is there', () => {
    expect(msgs({
      flowTest: { result: 'fail', hydrantLocations: [], rows: [] },
      systemNotes: 'Booster inlet restricted. Quoted to replace, occupier notified 3 July.',
    })).not.toContain('no system note saying what happens next');
  });

  it('does not ask for a note where the flow test passed', () => {
    expect(msgs({ flowTest: { result: 'pass', hydrantLocations: [], rows: [] }, systemNotes: '' }))
      .not.toContain('no system note saying what happens next');
  });

  it('will not let a failed system leave the critical defect question blank', () => {
    /*
     * The question that decides whether the occupier has to be given a notice
     * within 24 hours. Unanswered on a failed system, nobody is told anything.
     */
    expect(msgs({ systemResult: 'fail', criticalDefectsIdentified: undefined, systemNotes: 'x' }))
      .toContain('critical defect question is unanswered');
  });

  it('accepts a plain No to the critical defect question', () => {
    // No is an answer. Only a blank is not.
    expect(msgs({ systemResult: 'fail', criticalDefectsIdentified: false, systemNotes: 'x' }))
      .not.toContain('critical defect question is unanswered');
  });

  it('does not raise it where the system passed', () => {
    expect(msgs({ systemResult: 'pass', criticalDefectsIdentified: undefined }))
      .not.toContain('critical defect question is unanswered');
  });
});

describe('Part B — a hydrostatic test that says it passed', () => {
  /*
   * The pressure test on a main. It is signed off on the department's form,
   * and three of the checks that guard it were untested — including the one
   * that catches a test recorded as a pass while the gauge fell.
   */
  const msgs = (over: Partial<Form72>) =>
    validateForm72(issuable(over)).map((i) => i.message).join('\n');

  it('is content where the pressure and the duration are both recorded', () => {
    const out = msgs({ hydrostatic: { result: 'pass', testPressureKpa: 1700, durationMinutes: 120 } });
    expect(out).not.toContain('no pressure or no duration');
  });

  it('asks for the duration where only the pressure is recorded', () => {
    const out = msgs({ hydrostatic: { result: 'pass', testPressureKpa: 1700 } });
    expect(out).toContain('no pressure or no duration');
  });

  it('asks for the pressure where only the duration is recorded', () => {
    const out = msgs({ hydrostatic: { result: 'pass', durationMinutes: 120 } });
    expect(out).toContain('no pressure or no duration');
  });

  it('asks for neither where the test does not apply', () => {
    // N/A is a real answer on this form. Demanding figures for a test nobody
    // ran is how a blank gets filled in with something invented.
    expect(msgs({ hydrostatic: { result: 'na' } })).not.toContain('no pressure or no duration');
  });

  it('challenges a pass where the pressure fell over the test', () => {
    /*
     * A drop is a loss, and a hydrostatic recorded as a pass while the gauge
     * went down is either a leak nobody wrote up or a mistyped figure. It
     * blocks while the loss field is blank, because the form has a column for
     * exactly this.
     */
    const issues = validateForm72(issuable({
      hydrostatic: { result: 'pass', testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1650 },
    }));
    const drop = issues.find((i) => i.message.includes('A drop is a loss'))!;
    expect(drop.part).toBe('B');
    expect(drop.blocking).toBe(true);
    expect(drop.message).toContain('1700');
    expect(drop.message).toContain('1650');
  });

  it('stops blocking once the loss is written down', () => {
    const issues = validateForm72(issuable({
      hydrostatic: {
        result: 'pass', testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1650, lossLpm: 0.4,
      },
    }));
    expect(issues.find((i) => i.message.includes('A drop is a loss'))?.blocking).toBe(false);
  });

  it('says nothing where the pressure held exactly', () => {
    // Held is a pass, and it is the answer a good test gives.
    const out = msgs({
      hydrostatic: { result: 'pass', testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1700 },
    });
    expect(out).not.toContain('A drop is a loss');
  });

  it('does not challenge a test already recorded as a fail', () => {
    // The pressure falling is the reason it failed. Saying so twice is noise.
    const out = msgs({
      hydrostatic: { result: 'fail', testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1200 },
    });
    expect(out).not.toContain('A drop is a loss');
  });
});

describe('the pump at overload', () => {
  /*
   * The combined flow test certificate requires the pump to still make 65% of
   * its duty pressure while delivering 150% of its duty flow. That single
   * pass or fail is what says a fire pump is adequate for the building, and
   * none of it was tested.
   *
   * Its worked example is 16 L/s at 700 kPa giving 24 L/s at 455 kPa, so that
   * is the case held here — the same numbers a person can check against the
   * certificate in front of them.
   */
  it('works the certificate\'s own example', () => {
    const c = overloadCheck(16, 700)!;
    expect(c.requiredFlowLps).toBe(24);
    expect(c.requiredPressureKpa).toBe(455);
    expect(c.note).toContain('24 L/s');
    expect(c.note).toContain('455 kPa');
    expect(c.note).toContain('65%');
  });

  it('passes a run that lands exactly on both figures', () => {
    /*
     * Exactly on the requirement is a pass. Both comparisons deciding it could
     * have been a hair the wrong way, and either would condemn a pump that
     * meets the standard — which means a building told to replace a pumpset
     * that is fine.
     */
    const c = overloadCheck(16, 700, { flowLps: 24, pressureKpa: 455 })!;
    expect(c.achieved).toBe(true);
    expect(c.shortfallKpa).toBeUndefined();
  });

  it('fails a run a single kilopascal short, and says by how much', () => {
    const c = overloadCheck(16, 700, { flowLps: 24, pressureKpa: 454 })!;
    expect(c.achieved).toBe(false);
    expect(c.shortfallKpa).toBe(1);
  });

  it('refuses to call a run below the required flow a pass, whatever pressure it held', () => {
    /*
     * The one that would flatter a bad pump. Held at 24 L/s a pump might make
     * 455 kPa; at 20 L/s making 600 is not the same test and proves nothing
     * about the pump at overload.
     */
    const c = overloadCheck(16, 700, { flowLps: 20, pressureKpa: 600 })!;
    expect(c.achieved).toBe(false);
    expect(c.note).toContain('has not proved the pump at overload');
  });

  it('accepts a run a whisker over, rather than losing it to floating point', () => {
    // 150% of 16.1 is 24.150000000000002 in binary floating point. A gauge
    // reading of exactly that must not read as short of itself.
    const c = overloadCheck(16.1, 700, { flowLps: 16.1 * 1.5, pressureKpa: 455 })!;
    expect(c.achieved).toBe(true);
  });

  it('says nothing at all where there is no duty to work from', () => {
    /*
     * The dangerous default. With a duty of nought the required figures are
     * nought too, and every test ever run passes — a pump nobody has recorded
     * a duty for would certify itself.
     */
    expect(overloadCheck(0, 700)).toBeUndefined();
    expect(overloadCheck(16, 0)).toBeUndefined();
    expect(overloadCheck(0, 0, { flowLps: 0, pressureKpa: 0 })).toBeUndefined();
  });

  it('gives the requirement before any test has been run', () => {
    // What the technician needs on the way to the pump room.
    const c = overloadCheck(16, 700)!;
    expect(c.achieved).toBeUndefined();
    expect(c.shortfallKpa).toBeUndefined();
  });
});

describe('deviceCalibration', () => {
  const gauge = (over: Partial<TestDevice> = {}): TestDevice => ({
    slot: 'Gauge 1', serialNumber: 'G-1', dateCalibrated: '2026-01-15', ...over,
  });

  it('accepts a gauge calibrated on the morning of the test', () => {
    /*
     * The ordinary way a gauge gets used: calibrated and taken straight out.
     * Read as calibrated after the test it produces "one of the two dates is
     * wrong" against a form where neither is.
     */
    expect(deviceCalibration(gauge({ dateCalibrated: '2026-07-03' }), '2026-07-03').state)
      .toBe('in-calibration');
  });

  it('holds the line at a year either side of it', () => {
    // A day under the twelve months is still good; a day over is not. This is
    // the question a technician asks of the sticker on the gauge.
    expect(deviceCalibration(gauge({ dateCalibrated: '2025-07-03' }), '2026-07-03').state)
      .toBe('in-calibration');
    expect(deviceCalibration(gauge({ dateCalibrated: '2025-07-02' }), '2026-07-03').state)
      .toBe('out-of-calibration');
  });

  it('passes a gauge calibrated inside twelve months', () => {
    const c = deviceCalibration(gauge(), '2026-07-03');
    expect(c.state).toBe('in-calibration');
    expect(c.issue).toBeUndefined();
  });

  it('blocks a gauge past twelve months, because every pressure was read with it', () => {
    const c = deviceCalibration(gauge({ dateCalibrated: '2024-01-15' }), '2026-07-03');
    expect(c.state).toBe('out-of-calibration');
    expect(c.issue!.blocking).toBe(true);
    expect(c.issue!.part).toBe('C');
    expect(c.issue!.message).toContain('makes all of them unusable');
  });

  it('does not let a gauge with no calibration date pass silently', () => {
    // The gap the screen used to have. No date is not the same as fine.
    const c = deviceCalibration(gauge({ dateCalibrated: undefined }), '2026-07-03');
    expect(c.state).toBe('no-date');
    expect(c.issue!.message).toContain('cannot be relied on');
  });

  it('reports a calibration date after the test date rather than a negative age', () => {
    const c = deviceCalibration(gauge({ dateCalibrated: '2027-01-01' }), '2026-07-03');
    expect(c.state).toBe('calibrated-after-test');
    expect(c.issue!.message).toContain('One of the two dates is wrong');
  });

  it('says nothing about calibration while there is no test date to judge against', () => {
    // A form being filled in from the top has no test date yet, and colouring
    // every gauge red until one is typed trains people to ignore the colour.
    const c = deviceCalibration(gauge(), undefined);
    expect(c.state).toBe('no-test-date');
    expect(c.issue).toBeUndefined();
  });

  it('ignores an empty slot rather than reporting the form for having one', () => {
    const c = deviceCalibration(gauge({ serialNumber: '  ' }), '2026-07-03');
    expect(c.state).toBe('not-a-device');
    expect(c.issue).toBeUndefined();
  });

  it('reports an unreadable date as unreadable rather than as out of calibration', () => {
    const c = deviceCalibration(gauge({ dateCalibrated: 'last winter' }), '2026-07-03');
    expect(c.state).toBe('unreadable-date');
    expect(c.issue!.blocking).toBe(false);
  });

  it('agrees with the form-wide validation, which is the point of sharing it', () => {
    const form = { ...emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', now: '2026-07-03T00:00:00.000Z' }),
      testDate: '2026-07-03',
      devices: [gauge({ dateCalibrated: '2024-01-15' })] };
    const fromForm = validateForm72(form).filter((i) => i.part === 'C');
    expect(fromForm).toHaveLength(1);
    expect(fromForm[0]).toEqual(deviceCalibration(form.devices[0]!, form.testDate).issue);
  });
});

describe('Part D — the nozzle rows and the fourth hydrant', () => {
  it('prints the three nozzle bores the department prints, which the table used to drop', () => {
    const html = form72Html(doc());
    const partD = between(html, 'Size/flow rate', 'System achieved');
    // The department groups them: "Nozzles" in its own cell, the bore beside it.
    expect(partD).toContain('Nozzles');
    expect(partD).toContain('Other portable testing devices');
    for (const mm of PART_D_NOZZLE_SIZES_MM) expect(partD).toContain(`${mm} mm`);
    // Eight printed lines, three of them nozzles: a table that showed only the
    // five metered rates looked complete with three of its rows missing.
    expect(PART_D_ROWS).toHaveLength(PART_D_NOZZLE_SIZES_MM.length + STANDARD_FLOW_RATES_LPS.length);
  });

  it('keeps a four-hydrant reading in its own column instead of the three-hydrant one', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass',
          hydrantLocations: ['Main entry', 'Loading dock', 'Level 3', 'Roof'],
          rows: [{
            rateLps: 20, devices: 'DG1', hydrant1Kpa: 320, hydrants12Kpa: 280,
            hydrants123Kpa: 240, hydrants1234Kpa: 190,
          }],
        },
      }),
    }));
    expect(flat(html)).toContain('Hydrants 1, 2, 3 and 4');
    const row = between(html, '>20 L/s<', '>30 L/s<');
    expect(row).toContain('240');
    expect(row).toContain('190');
    // Four pressures proved means four locations are wanted, not three.
    expect(hydrantLocationsNeeded({
      result: 'pass', hydrantLocations: [], rows: [{ rateLps: 20, devices: '', hydrants1234Kpa: 190 }],
    })).toBe(4);
  });

  it('prints a nozzle reading against its bore rather than inventing a flow rate for it', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Main entry'],
          rows: [{ nozzleMm: 22, devices: 'Pitot 1', hydrant1Kpa: 310 }],
        },
      }),
    }));
    const row = between(html, '>22 mm<', '>25 mm<');
    expect(row).toContain('Pitot 1');
    expect(row).toContain('310');
    // Not flagged as a rate the department does not print — it is one of its own.
    expect(flat(html)).not.toContain('does not print (22 mm nozzle)');
  });

  it('prints the requirement and the achieved pair, so the table can be judged on the page', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass', hydrantLocations: ['Main entry'], rows: [],
          requiredLps: 20, requiredKpa: 250, achievedLps: 21, achievedKpa: 260,
        },
      }),
    }));
    expect(flat(html)).toContain('System requirements (L/s at kPa)');
    const partD = between(html, 'System requirements', 'Static pressure');
    expect(partD).toContain('20 L/s at 250 kPa');
    expect(html).toContain('21 L/s at 260 kPa');
  });
});

describe('Part C — the correction factor the note already promised', () => {
  it('prints a row for it, which the page used to describe without asking for', () => {
    const html = form72Html(doc({
      form: issuable({
        devices: [{ slot: 'Gauge 1', serialNumber: 'BFS-02', dateCalibrated: '2025-07-20', correctionFactor: '+5 kPa' }],
      }),
    }));
    expect(flat(html)).toContain('The correction factor must be kPa or a percentage');
    const partC = between(html, 'Correction factor (kPa or %)', '65/100/150 mm face');
    expect(partC).toContain('+5 kPa');
  });

  it('reports it as not recorded rather than leaving the box blank', () => {
    const html = form72Html(doc());
    const partC = between(html, 'Correction factor (kPa or %)', '65/100/150 mm face');
    expect(partC).toContain('Not recorded');
  });
});

describe('a frictional loss worked out two ways', () => {
  const measured = {
    result: 'pass' as const,
    highestHydrantAboveBoosterM: 12,
    boostPressureKpa: 1400,
    hydrantResidualKpa: 900,
  };

  it('prefers the figure it can show the working for', () => {
    const loss = resolveFrictionalLoss({ ...measured, statedFrictionalLossKpa: 382.3 });
    expect(loss).toEqual({ kpa: 382.3, source: 'calculated', disagreesWithKpa: undefined });
  });

  it('falls back to the typed figure and prints it marked as stated', () => {
    const loss = resolveFrictionalLoss({ result: 'pass', statedFrictionalLossKpa: 350 });
    expect(loss).toEqual({ kpa: 350, source: 'stated' });
    const html = form72Html(doc({
      form: issuable({ booster: { result: 'pass', statedFrictionalLossKpa: 350 } }),
    }));
    expect(flat(html)).toContain('350 kPa <span class="extra">(stated)</span>');
    expect(flat(html)).toContain('Stated by the technician as 350 kPa');
  });

  it('says so on the face of the form when the two disagree, rather than picking one quietly', () => {
    const html = form72Html(doc({
      form: issuable({ booster: { ...measured, statedFrictionalLossKpa: 300 } }),
    }));
    expect(flat(html)).toContain('Frictional loss — two different figures');
    expect(flat(html)).toContain('The readings give 382.3 kPa; 300 kPa was entered');
  });

  it('treats a difference inside a kilopascal as rounding and says nothing', () => {
    const loss = resolveFrictionalLoss({ ...measured, statedFrictionalLossKpa: 382 });
    expect(loss.disagreesWithKpa).toBeUndefined();
    const html = form72Html(doc({
      form: issuable({ booster: { ...measured, statedFrictionalLossKpa: 382 } }),
    }));
    expect(flat(html)).not.toContain('two different figures');
  });

  it('reports neither figure when the form holds neither', () => {
    expect(resolveFrictionalLoss({ result: 'na' })).toEqual({ source: 'none' });
  });
});

describe('Part G — the tick and the subtraction', () => {
  const point = {
    location: 'Valve room 1', requiredFlowLpm: 540, requiredPressureKpa: 200,
    resultFlowLpm: 538, resultPressureKpa: 210,
  };

  it('prints the technician’s tick rather than the arithmetic, where they disagree', () => {
    const html = form72Html(doc({
      form: issuable({
        sprinklerFlow: {
          result: 'pass',
          testPoints: [{ ...point, flowResult: 'pass', pressureResult: 'pass' }],
        },
      }),
    }));
    const flow = between(html, 'Required flow rate (L/min)', 'Required pressure (kPa)');
    expect(flow).toContain('<span class="cb on">&#10007;</span>Pass');
    expect(flow).not.toContain('<span class="cb on">&#10007;</span>Fail');
  });

  it('writes the disagreement onto the page, because the next reader will do the subtraction', () => {
    const html = form72Html(doc({
      form: issuable({
        sprinklerFlow: {
          result: 'pass',
          testPoints: [{ ...point, flowResult: 'pass', pressureResult: 'pass' }],
        },
      }),
    }));
    expect(flat(html)).toContain('Ticked result against the figures');
    expect(flat(html)).toContain(
      'Test point 1 flow is ticked Pass against 538 of 540 required, which reads Fail on the figures alone',
    );
    // The pressure line agrees, so it is not reported.
    expect(flat(html)).not.toContain('Test point 1 pressure is ticked');
  });

  it('marks a box it filled in itself, so a tick is never attributed to the technician', () => {
    const html = form72Html(doc({
      form: issuable({ sprinklerFlow: { result: 'pass', testPoints: [point] } }),
    }));
    const flow = between(html, 'Required flow rate (L/min)', 'Required pressure (kPa)');
    expect(flow).toContain('<span class="cb on">&#10007;</span>Fail');
    expect(flow).toContain('from the figures');
    expect(flat(html)).not.toContain('Ticked result against the figures');
  });
});

describe('the attachment page', () => {
  it('is left off entirely by a form that holds none of it', () => {
    const html = form72Html(doc());
    expect(html).not.toContain('Attachment —');
  });

  it('prints after Part I, headed so it is never read as part of the department’s form', () => {
    const html = form72Html(doc({
      form: issuable({
        owner: 'Baldwin Living Pty Ltd',
        ownerContact: '07 3000 0000',
        buildingClassification: 'Class 3',
        technician: 'C. Whitmore',
        qualification: 'FPAS FSA-2',
      }),
    }));
    expect(html.indexOf('Attachment —')).toBeGreaterThan(html.indexOf('Part I — Signature'));
    expect(flat(html)).toContain("Attachment — not part of the department's form");
    expect(html).toContain('Baldwin Living Pty Ltd');
    expect(html).toContain('Class 3');
    expect(html).toContain('C. Whitmore');
    expect(html).toContain('FPAS FSA-2');
  });

  it('prints the defect list Part H sends to a report that does not travel with the form', () => {
    const html = form72Html(doc({
      form: issuable({
        criticalDefectsIdentified: true,
        systemResult: 'fail',
        systemNotes: 'Booster isolated pending repair.',
        defects: [
          { description: 'Booster inlet valve seized', critical: true },
          { description: 'Block plan faded', critical: false },
        ],
      }),
    }));
    expect(html).toContain('Booster inlet valve seized');
    expect(html).toContain('Block plan faded');
    expect(flat(html)).toContain('2 defects recorded, 1 of them critical');
    expect(flat(html)).toContain('critical defect notice');
  });

  it('says plainly that no defects were found, rather than printing an empty table', () => {
    const html = form72Html(doc({ form: issuable({ technician: 'C. Whitmore' }) }));
    expect(flat(html)).toContain('No defects were recorded against this test.');
  });
});

describe('a form that contradicts itself about its own defects', () => {
  it('refuses to be issued while a critical defect is listed and Part H says there are none', () => {
    const form = issuable({
      defects: [{ description: 'Booster inlet valve seized', critical: true }],
      criticalDefectsIdentified: false,
    });
    const issue = validateForm72(form).find((i) => i.message.includes('flagged critical'));
    expect(issue).toBeDefined();
    expect(issue!.blocking).toBe(true);
    expect(issue!.message).toContain('says no critical defects were identified');
  });

  it('says the same thing when nobody answered Part H at all', () => {
    const form = issuable({
      defects: [{ description: 'Booster inlet valve seized', critical: true }],
      criticalDefectsIdentified: undefined,
    });
    const issue = validateForm72(form).find((i) => i.message.includes('flagged critical'));
    expect(issue!.message).toContain('does not answer the critical defect question');
  });

  it('lets a non-critical defect stand against a No, because that is not a contradiction', () => {
    const form = issuable({ defects: [{ description: 'Block plan faded', critical: false }] });
    expect(validateForm72(form).some((i) => i.message.includes('flagged critical'))).toBe(false);
  });

  it('cautions about a defect row with nothing written in it', () => {
    const form = issuable({ defects: [{ description: '   ', critical: false }] });
    const issue = validateForm72(form).find((i) => i.message.includes('no description'));
    expect(issue).toBeDefined();
    expect(issue!.blocking).toBe(false);
  });
});

describe('a failed part under a passing system', () => {
  it('blocks the form, naming the part, because the parts are the evidence', () => {
    const form = issuable({
      booster: { result: 'fail' },
      systemResult: 'pass',
    });
    const issue = validateForm72(form).find((i) => i.message.includes('while the system is marked'));
    expect(issue).toBeDefined();
    expect(issue!.blocking).toBe(true);
    expect(issue!.message).toContain('Part E is recorded as a fail');
  });

  it('names every failed part, not the first one', () => {
    const form = issuable({
      hydrostatic: { result: 'fail', testPressureKpa: 1700, endPressureKpa: 1700, lossLpm: 0 },
      booster: { result: 'fail' },
      systemResult: 'pass',
    });
    const issue = validateForm72(form).find((i) => i.message.includes('while the system is marked'));
    expect(issue!.message).toContain('Parts B and E are recorded as a fail');
  });

  it('cautions rather than blocks where the system result is not applicable', () => {
    const form = issuable({ booster: { result: 'fail' }, systemResult: 'na' });
    const issue = validateForm72(form).find((i) => i.message.includes('system result is not applicable'));
    expect(issue!.blocking).toBe(false);
  });

  it('does not treat Part D’s refer-to-report as a fail, because it is the department’s third box', () => {
    const form = issuable({
      flowTest: { result: 'refer-to-report', hydrantLocations: [], rows: [] },
      systemResult: 'pass',
    });
    expect(validateForm72(form).some((i) => i.message.includes('while the system is marked'))).toBe(false);
  });
});

describe('Part A as the two questions it really is', () => {
  const grid = (over: Partial<MaintenanceTest> = {}): MaintenanceTest => ({
    hydrantAnnual: false, hydrantFiveYear: false,
    sprinklerAnnual: false, sprinklerFiveYear: false,
    combinedAnnual: false, combinedFiveYear: false,
    ...over,
  });

  it('reads the six cells back as a system type and an interval', () => {
    const m = grid({ combinedAnnual: true });
    expect(systemTypesTested(m)).toEqual(['combined']);
    expect(intervalsTested(m)).toEqual(['annual']);
  });

  it('ticks the cell the two answers point at, and only that one', () => {
    expect(maintenanceTestFromAxes(['hydrant'], ['fiveYear']))
      .toEqual(grid({ hydrantFiveYear: true }));
    expect(maintenanceTestCell('sprinkler', 'annual')).toBe('sprinklerAnnual');
  });

  it('clears what the two answers no longer cover, so the grid never says more than they do', () => {
    expect(maintenanceTestFromAxes(['hydrant'], ['annual']))
      .toEqual(grid({ hydrantAnnual: true }));
  });

  /*
   * The reason the six booleans stay the stored shape. This grid is a real
   * thing a paper form can say and no pair of axes can: picking hydrant and
   * sprinkler, annual and five-yearly, ticks all four cells, not these two. A
   * control that rewrote it would change what a signed form says it covered,
   * so the screen steps aside and the cells are edited directly.
   */
  it('cannot express every grid, and the round trip proves which ones', () => {
    const mixed = grid({ hydrantAnnual: true, sprinklerFiveYear: true });
    const rebuilt = maintenanceTestFromAxes(systemTypesTested(mixed), intervalsTested(mixed));
    expect(rebuilt).not.toEqual(mixed);
    expect(rebuilt.hydrantFiveYear).toBe(true);
  });

  it('reports nothing ticked as neither axis answered', () => {
    expect(systemTypesTested(grid())).toEqual([]);
    expect(intervalsTested(grid())).toEqual([]);
  });
});

describe('the columns the department’s form has no box for', () => {
  it('adds all six, nullable, so a form already on a phone reads back unchanged', () => {
    for (const column of [
      'owner', 'ownerContact', 'buildingClassification', 'technician', 'qualification', 'defects',
    ]) {
      expect({ column, added: MIGRATION_V34.includes(`ADD COLUMN ${column} TEXT;`) })
        .toEqual({ column, added: true });
    }
    expect(MIGRATION_V34).not.toContain('NOT NULL');
    expect(MIGRATION_V34).not.toContain('DEFAULT');
  });

  it('is the next migration in the list rather than a number picked by hand', () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(MIGRATION_V34);
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('starts a blank form with an empty defect list, not an absent one', () => {
    const form = emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', now: NOW });
    expect(form.defects).toEqual([]);
  });
});

describe('a site with more hydrants than the form has fields', () => {
  it('lists the ones past the fourth rather than dropping them off the page', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: {
          result: 'pass',
          hydrantLocations: ['Booster', 'Level 3 east', 'Level 6 east', 'Roof', 'Carpark B2', 'Plant room'],
          rows: [],
        },
      }),
    }));
    expect(flat(html)).toContain('2 further hydrant locations are recorded against this test');
    expect(flat(html)).toContain('Carpark B2; Plant room');
    expect(flat(html)).toContain('the four fields above are the ones the pressure columns refer to');
  });

  it('says nothing where the four fields are enough', () => {
    const html = form72Html(doc({
      form: issuable({
        flowTest: { result: 'pass', hydrantLocations: ['Booster', 'Roof'], rows: [] },
      }),
    }));
    expect(flat(html)).not.toContain('further hydrant location');
    expect(PART_D_LOCATION_SLOTS).toBe(4);
  });
});

describe('the company’s own test equipment', () => {
  it('carries every field the certificates state, transcribed once', () => {
    for (const serial of ['SQF-001', 'SQF-002']) {
      const preset = DEVICE_PRESETS.find((p) => p.device.serialNumber === serial);
      expect(preset).toBeDefined();
      expect(preset!.device).toMatchObject({
        serialNumber: serial,
        dateCalibrated: '2026-07-18',
        calibrationCertificate: `CR-${serial}-IN-01`,
        // The certificate's own label travels with the number: it says
        // "MM Error: + 0.35 %", not "correction factor".
        correctionFactor: '+0.35 % (MM Error)',
        calibrationBasis: 'service-life',
        digitalReader: true,
      });
    }
  });

  it('leaves the gauge-only fields off a flow meter rather than filling them', () => {
    // Face size and increments describe a pressure gauge's dial. A flow meter
    // has neither, and anything written there reads as a measured specification.
    for (const preset of DEVICE_PRESETS) {
      expect(preset.device.faceSize).toBeUndefined();
      expect(preset.device.incrementsKpa).toBeUndefined();
    }
  });

  it('does not tick a measuring element the certificate never names', () => {
    // The certificate says "microprocessor based" and nothing about orifice,
    // mechanical or electromagnetic. The three Part C ticks are a statement
    // about the instrument on a document somebody signs.
    for (const preset of DEVICE_PRESETS) {
      expect(preset.flowDeviceKind).toBeUndefined();
      expect(preset.flowDeviceKindNote).toContain('yours to make');
    }
  });

  it('will not offer a meter the form already holds, matched on serial not on id', () => {
    const [first] = DEVICE_PRESETS;
    expect(unusedDevicePresets([])).toHaveLength(DEVICE_PRESETS.length);
    // Typed by hand with the same serial is the same meter: offering it again
    // would put one instrument in two Part C columns.
    const byHand = [{ slot: 'Device/gauge 1', serialNumber: first!.device.serialNumber.toLowerCase() }];
    expect(unusedDevicePresets(byHand).map((p) => p.id)).not.toContain(first!.id);
  });

  it('names where it was transcribed from, so the next person can check it', () => {
    expect(DEVICE_PRESET_SOURCE).toContain('CR-SQF-001.pdf');
    expect(DEVICE_PRESET_SOURCE).toContain('Lawrence Coomber');
  });
});

describe('a meter certified for its service life', () => {
  const meter = (over: Partial<TestDevice> = {}): TestDevice => ({
    slot: 'Device/gauge 1',
    serialNumber: 'SQF-001',
    dateCalibrated: '2026-07-18',
    calibrationBasis: 'service-life',
    ...over,
  });

  it('is not stale a year later, because its certificate says it is not', () => {
    // On the twelve-month rule this blocked every form raised after 18/07/2027,
    // for a reason the manufacturer's certificate contradicts.
    const c = deviceCalibration(meter(), '2028-03-01');
    expect(c.state).toBe('service-life');
    expect(c.issue).toBeUndefined();
    expect(c.monthsBefore).toBeGreaterThan(CALIBRATION_MONTHS);
  });

  it('still reports a missing date, an unreadable one and one after the test', () => {
    expect(deviceCalibration(meter({ dateCalibrated: undefined }), '2028-03-01').state).toBe('no-date');
    expect(deviceCalibration(meter({ dateCalibrated: 'last winter' }), '2028-03-01').state)
      .toBe('unreadable-date');
    expect(deviceCalibration(meter(), '2026-01-01').state).toBe('calibrated-after-test');
  });

  it('leaves a pressure gauge on the twelve-month rule', () => {
    const gauge = deviceCalibration(meter({ calibrationBasis: undefined }), '2028-03-01');
    expect(gauge.state).toBe('out-of-calibration');
    expect(gauge.issue!.blocking).toBe(true);
  });

  it('does not block the form, which is the whole point', () => {
    const form = issuable({
      testDate: '2028-03-01',
      devices: [meter({ calibrationCertificate: 'CR-SQF-001-IN-01' })],
    });
    expect(validateForm72(form).filter((i) => i.part === 'C')).toEqual([]);
  });

  it('prints which basis each device was accepted on, marked as ours', () => {
    const html = form72Html(doc({
      form: issuable({ devices: [meter({ calibrationCertificate: 'CR-SQF-001-IN-01' })] }),
    }));
    expect(flat(html)).toContain('Calibration basis <span class="extra">added</span>');
    expect(flat(html)).toContain("Manufacturer certifies for the device's service life");

    const onInterval = form72Html(doc({
      form: issuable({ devices: [meter({ calibrationBasis: 'interval' })] }),
    }));
    expect(flat(onInterval)).toContain('12 month interval');
  });

  it('prints the conditions the certificate attaches, so the basis is not read as a guarantee', () => {
    // The certificate holds "excepting if a fault or damage has occurred" and
    // "a periodic meter calibration service and recertification may be
    // stipulated by Councils or other authorities". Both are things only the
    // person holding the meter can answer.
    const html = form72Html(doc({
      form: issuable({ devices: [meter({ calibrationCertificate: 'CR-SQF-001-IN-01' })] }),
    }));
    expect(flat(html)).toContain('absent fault or damage');
    expect(flat(html)).toContain('unless an authority stipulates recertification');
  });
});

describe('Part C as the department prints it', () => {
  it('heads the four columns Device/gauge 1 to 4, not two devices and two gauges', () => {
    const html = form72Html(doc({ form: issuable({ devices: [] }) }));
    for (const head of DEPARTMENT_DEVICE_SLOTS) expect(html).toContain(head);
    expect(DEPARTMENT_DEVICE_SLOTS).toHaveLength(4);
  });

  it('calls the row Correction certificate, which is the department’s label', () => {
    const html = form72Html(doc());
    expect(html).toContain('Correction certificate');
    expect(html).not.toContain('Calibration Certificate');
  });

  it('marks the correction factor row as ours, because the printed grid has no such row', () => {
    const html = form72Html(doc());
    expect(flat(html)).toContain('Correction factor (kPa or %) <span class="extra">added</span>');
  });

  it('keeps a technician’s own slot name under the department’s head rather than replacing it', () => {
    const html = form72Html(doc({
      form: issuable({ devices: [{ slot: 'Pitot gauge', serialNumber: 'PG-1' }] }),
    }));
    const head = between(html, 'Device/gauge 1', 'Serial number');
    expect(head).toContain('Pitot gauge');
  });

  it('appends a fifth device rather than dropping it off the four printed columns', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ slot: `D${i}`, serialNumber: `S-${i}` }));
    const html = form72Html(doc({ form: issuable({ devices: five }) }));
    expect(html).toContain('S-4');
    expect(flat(html)).toContain('<span class="extra">added</span>');
  });
});

describe('the department’s own words, label for label', () => {
  const html = form72Html(doc());

  it('heads the page the way the published form heads it', () => {
    expect(FORM_TITLE).toBe('Form 72 — fire hydrant and sprinkler system');
    expect(FORM_SUBTITLE).toBe('periodic testing and maintenance');
    expect(html).toContain('Version 1 – July 2014');
  });

  it('bands each part in the department’s casing', () => {
    for (const band of [
      'Part A — Test details',
      'Part B — Hydrant hydrostatic test',
      'Part C — Hydrant test equipment/pressure gauges',
      'Part D — Hydrant system flow test',
      'Part E — Pump appliance booster test',
      'Part F — Sprinkler hydrostatic test',
      'Part G — Sprinkler system flow test',
      'Part H — Compliance',
      'Part I — Signature',
    ]) {
      expect({ band, found: html.includes(band) }).toEqual({ band, found: true });
    }
  });

  it('writes every field label the way the published form writes it', () => {
    for (const label of [
      'Site name', 'Site address', 'Contractor', 'Test date', 'Maintenance test',
      'fire hydrant', 'fire sprinkler', 'combined', 'Annual', '5 year',
      'Boost pressure (kPa)', 'Test pressure (kPa)', 'Duration of test (mins)',
      'End of test pressure (kPa)', 'Loss (if any) (L/min)',
      'Flow measuring device', 'Orifice', 'Mechanical', 'Electro magnetic',
      'Part C not required for orifice testing',
      'Serial number', 'Date calibrated', 'Correction certificate',
      '65/100/150 mm face', 'Digital reader', 'Increments (kPa)',
      'Hydrant 1 location', 'Hydrant 2 location', 'Hydrant 3 location', 'Hydrant 4 location',
      'System requirements (L/s at kPa)', 'Static pressure (kPa)',
      'On-site pump set installed', 'Pressure zone number',
      'Size/flow rate', 'Device/gauge no. (Part C)', 'Hydrant 1 only',
      'System achieved (L/s at kPa)',
      'Height of highest hydrant above booster (m)', 'Pump inlet pressure (kPa)',
      'Pump discharge pressure (kPa)', 'Calculated frictional loss (kPa)',
      'Time held (mins)',
      'System specifications (block plan)', 'Test results', 'Test point 1', 'Location',
      'Required flow rate (L/min)', 'Required pressure (kPa)',
      'Running test — installation gauge pressure (kPa)',
      'Critical defects identified', 'Repairs/corrective actions taken',
      'Licensee name', 'Licensee signature', 'Licence no. (QBCC/PIC)', 'Licensee report no.',
    ]) {
      expect({ label, found: html.includes(label) }).toEqual({ label, found: true });
    }
  });

  it('prints Part H’s two sentences in the department’s words', () => {
    expect(flat(html)).toContain('Give owner/occupier a critical defect notice');
    expect(flat(html)).toContain(
      "Attach details (including action and date taken) as part of Licensee's report",
    );
    expect(flat(html)).toContain('No action required in relation to critical defects at this time');
    expect(flat(html)).toContain(
      'No action required in relation to repairs/corrective actions at this time',
    );
  });

  it('prints the privacy and right-to-information notices, which are part of the form', () => {
    // They say what the information on the page may be used for and who it may
    // be given to. A reproduction that drops them hands somebody a document
    // that collects their details and does not tell them that.
    expect(flat(html)).toContain(flat(DEPARTMENT_PRIVACY));
    expect(flat(html)).toContain(flat(DEPARTMENT_RTI));
    expect(flat(html)).toContain('Plumbing and Drainage Act 2002');
    expect(flat(html)).toContain('Right to Information Act 2009');
    expect(flat(html)).toContain('buildingcodes@qld.gov.au');
    expect(flat(html)).toContain('© The State of Queensland (Department of Housing and Public Works) 2014.');
  });

  it('prints the department’s own imprint', () => {
    expect(html).toContain('Building Codes Queensland');
    expect(html).toContain('Department of Housing and Public Works');
  });

  it('marks every row Safe QLD added inside the department’s parts, and adds no others', () => {
    // Everything else the app adds goes on the attachment page after Part I.
    // These three sit inside a department part because each belongs beside the
    // figure it qualifies, so each has to say it is ours. A fourth appearing
    // here without a reason recorded in this test is a row that slipped in.
    const inParts = between(html, 'Part A — Test details', 'Part I — Signature');
    const marked = inParts.match(/<span class="extra">added<\/span>/g) ?? [];
    expect(marked.length).toBe(5);
    // Part C's note promises a correction factor and the printed grid has no row for it.
    expect(flat(inParts)).toContain('Correction factor (kPa or %) <span class="extra">added</span>');
    // One of our flow meters is certified for its service life, not for twelve
    // months, so the date alone would read as a year out of calibration.
    expect(flat(inParts)).toContain('Calibration basis <span class="extra">added</span>');
    // Part H prints the System Pass/Fail pair and no note field.
    expect(flat(inParts)).toContain('System notes <span class="extra">added</span>');
    // Parts B, E, F and G carry a Comments field; the department's Part D does
    // not, and ends at the pressure zone number.
    expect(flat(inParts)).toContain('Comment <span class="extra">added</span>');
    // The department asks for a calculated frictional loss and gives no box for
    // the residual it is calculated from, which the working beside it cites.
    expect(flat(inParts)).toContain('Residual at the hydrant (kPa) <span class="extra">added</span>');
  });
});

describe('a box the department does not print says so', () => {
  const html = form72Html(doc());

  it('marks the N/A box on every part the department bands PASS and FAIL', () => {
    // The band is the first place a reader's eye lands, and an extra box there
    // reads as the department's. The box is kept — three empty boxes are
    // indistinguishable from a part nobody filled in, which is the ambiguity
    // this document exists to remove — and marked.
    for (const part of [
      'Part B — Hydrant hydrostatic test',
      'Part E — Pump appliance booster test',
      'Part F — Sprinkler hydrostatic test',
    ]) {
      const band = between(html, part, '</div>');
      expect({ part, marked: band.includes('N/A<sup>+</sup>') }).toEqual({ part, marked: true });
      expect({ part, pass: band.includes('<span class="rl">PASS</span>') })
        .toEqual({ part, pass: true });
    }
  });

  it('marks Part D’s "Refer to Report", which is not a box the department prints either', () => {
    const band = between(html, 'Part D — Hydrant system flow test', '</div>');
    expect(band).toContain('Refer to Report<sup>+</sup>');
    expect(band).toContain('<span class="rl">PASS</span>');
  });

  it('marks all three of Part G’s, because the department bands it with none', () => {
    const band = between(html, 'Part G — Sprinkler system flow test', '</div>');
    expect(band).toContain('N/A<sup>+</sup>');
    expect(band).toContain('PASS<sup>+</sup>');
    expect(band).toContain('FAIL<sup>+</sup>');
  });

  it('says once what the marker means, rather than leaving a reader to guess', () => {
    expect(flat(html)).toContain(flat(ADDED_BOX_NOTE));
    expect(ADDED_BOX_NOTE).toContain("not on the department's form");
  });
});

describe('the one field on the form that cannot be a string', () => {
  it('prints the signature as an image', () => {
    // It is stored as a data URI and was going through the ordinary cell
    // renderer, which escapes it: a signed form came out with
    // "data:image/png;base64,iVBORw0KG…" in the signature box.
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const html = form72Html(doc({ form: issuable({ signature: png }) }));
    expect(html).toContain(`<img class="sig" src="${png}"`);
    expect(html).not.toContain(`>${png}<`);
  });

  it('says a form is not signed rather than leaving the box ambiguous', () => {
    const html = form72Html(doc({ form: issuable({ signature: undefined }) }));
    const partI = between(html, 'Licensee signature', '</tr>');
    expect(partI).toContain('Not signed');
  });

  it('prints a typed name in the signature box as written, rather than dropping it', () => {
    // Not an image, but it is a fact about the document.
    const html = form72Html(doc({ form: issuable({ signature: 'D. McKee (typed)' }) }));
    expect(html).toContain('D. McKee (typed)');
  });
});

describe('what an empty cell in a Part D row means', () => {
  const row = (over: Partial<FlowRow> = {}): FlowRow => ({ rateLps: 20, devices: '', ...over });

  it('counts how many hydrants the row was actually run on', () => {
    expect(flowRowColumnsRun(row())).toBe(0);
    expect(flowRowColumnsRun(row({ hydrant1Kpa: 300 }))).toBe(1);
    expect(flowRowColumnsRun(row({ hydrant1Kpa: 300, hydrants12Kpa: 260 }))).toBe(2);
    // The rightmost reading wins, gaps and all.
    expect(flowRowColumnsRun(row({ hydrant1Kpa: 300, hydrants1234Kpa: 200 }))).toBe(4);
  });

  it('calls a cell to the right of the last reading not run', () => {
    const proved = row({ devices: 'DG1', hydrant1Kpa: 300, hydrants12Kpa: 260 });
    expect(flowCellState(proved, 'hydrant1Kpa')).toBe('read');
    expect(flowCellState(proved, 'hydrants12Kpa')).toBe('read');
    expect(flowCellState(proved, 'hydrants123Kpa')).toBe('not-run');
    expect(flowCellState(proved, 'hydrants1234Kpa')).toBe('not-run');
  });

  it('calls a cell with readings on both sides of it missing', () => {
    // The technician ran one hydrant and then three. The two-hydrant figure is
    // genuinely absent, and on paper that blank is indistinguishable from the
    // two above it.
    const gap = row({ devices: 'DG1', hydrant1Kpa: 300, hydrants123Kpa: 200 });
    expect(flowCellState(gap, 'hydrants12Kpa')).toBe('missing');
    expect(flowCellState(gap, 'hydrants1234Kpa')).toBe('not-run');
  });

  it('calls every cell of an untouched row not run, including a row with only a device on it', () => {
    for (const col of FLOW_ROW_COLUMNS) {
      expect({ col, state: flowCellState(row(), col) }).toEqual({ col, state: 'not-run' });
    }
    // A device typed with no reading against it is a row somebody started, so
    // its first column is the gap.
    const started = row({ devices: 'DG1' });
    expect(flowCellState(started, 'hydrant1Kpa')).toBe('missing');
  });

  it('keeps the four columns in the order the department prints them', () => {
    expect(FLOW_ROW_COLUMNS).toEqual([
      'hydrant1Kpa', 'hydrants12Kpa', 'hydrants123Kpa', 'hydrants1234Kpa',
    ]);
  });
});

describe('a Part C row that describes a dial, on a device that has none', () => {
  const meter = { slot: 'Device/gauge 1', serialNumber: 'SQF-001', kind: 'flow-meter' as const };

  it('answers the two gauge rows rather than printing them as missing readings', () => {
    const html = form72Html(doc({ form: issuable({ devices: [meter] }) }));
    const face = between(html, '65/100/150 mm face', '</tr>');
    expect(face).toContain('N/A for a flow meter');
    const increments = between(html, 'Increments (kPa)', '</tr>');
    expect(increments).toContain('N/A for a flow meter');
    // And nothing on the row reads as a reading somebody failed to record.
    expect(face).not.toContain('Not recorded');
    expect(increments).not.toContain('Not recorded');
  });

  it('still flags them on a gauge, which is what the rows are for', () => {
    const html = form72Html(doc({
      form: issuable({ devices: [{ slot: 'Device/gauge 1', serialNumber: 'PG-1' }] }),
    }));
    const face = between(html, '65/100/150 mm face', '</tr>');
    expect(face).toContain('Not recorded');
    expect(face).not.toContain('flow meter');
    // The three columns nobody used say so rather than joining in.
    expect((face.match(/Not used/g) ?? [])).toHaveLength(3);
  });

  it('treats a device with no kind as a gauge, because that is every form already stored', () => {
    const html = form72Html(doc({
      form: issuable({ devices: [{ slot: 'Device/gauge 1', serialNumber: 'PG-1', faceSize: '100 mm' }] }),
    }));
    expect(between(html, '65/100/150 mm face', '</tr>')).toContain('100 mm');
  });

  it('leaves an empty column alone, so an unused slot is not answered about a meter', () => {
    const html = form72Html(doc({ form: issuable({ devices: [] }) }));
    expect(html).not.toContain('N/A for a flow meter');
  });

  it('records our own meters as meters', () => {
    for (const preset of DEVICE_PRESETS) expect(preset.device.kind).toBe('flow-meter');
  });
});

describe('the three Part C columns most tests do not use', () => {
  it('says they were not used, rather than filling them with missing readings', () => {
    // The department prints four and a hydrant test uses one or two, so three
    // columns of red was the usual state of this part — red on every row of
    // every form is red a reader learns to ignore.
    const html = form72Html(doc({
      form: issuable({
        devices: [{ slot: 'Device/gauge 1', serialNumber: 'SQF-001', dateCalibrated: '2026-07-20' }],
      }),
    }));
    const partC = between(html, 'Device/gauge 1', 'Part D —');
    expect(partC).toContain('Not used');
    // The one live column still answers every row.
    expect(partC).toContain('SQF-001');
  });

  it('is red about the one blank that is the point: a column started with no serial', () => {
    const html = form72Html(doc({
      form: issuable({ devices: [{ slot: 'Device/gauge 1', serialNumber: '  ' }] }),
    }));
    const serial = between(html, 'Serial number', '</tr>');
    expect(serial).toContain('Not recorded');
    expect((serial.match(/Not used/g) ?? [])).toHaveLength(3);
  });

  it('says every column is unused on a form with no equipment on it at all', () => {
    const html = form72Html(doc({ form: issuable({ devices: [] }) }));
    const serial = between(html, 'Serial number', '</tr>');
    expect((serial.match(/Not used/g) ?? [])).toHaveLength(4);
    expect(serial).not.toContain('Not recorded');
  });
});

describe('a part nobody looked at, reading as a part that did not apply', () => {
  const grid = (over: Partial<MaintenanceTest>): MaintenanceTest => ({
    hydrantAnnual: false, hydrantFiveYear: false,
    sprinklerAnnual: false, sprinklerFiveYear: false,
    combinedAnnual: false, combinedFiveYear: false,
    ...over,
  });
  const naPart = { result: 'na' as const };

  it('cautions where Part A says hydrant and every hydrant part is N/A', () => {
    /*
     * 'na' is the stored default, so a form opened and signed without Part D
     * being touched prints N/A ticked against the hydrant flow test — a
     * positive statement nobody made. There is no fourth state to tell the two
     * apart, but Part A says which test this was, and that is checkable.
     */
    const form = issuable({
      maintenanceTest: grid({ hydrantAnnual: true }),
      hydrostatic: naPart,
      flowTest: { result: 'na', hydrantLocations: [], rows: [] },
      booster: naPart,
    });
    const issue = validateForm72(form).find((i) => i.message.includes('Parts B, D and E'));
    expect(issue).toBeDefined();
    expect(issue!.part).toBe('A');
    expect(issue!.blocking).toBe(false);
    expect(issue!.message).toContain('not a record of anything');
  });

  it('says nothing where one hydrant part is answered, because N/A is legitimate on the others', () => {
    // A hydrostatic test is not always due, so only every one of them being
    // N/A says nobody looked.
    const form = issuable({
      maintenanceTest: grid({ hydrantAnnual: true }),
      hydrostatic: naPart,
      flowTest: { result: 'pass', hydrantLocations: ['Booster'], rows: [] },
      booster: naPart,
    });
    expect(validateForm72(form).some((i) => i.message.includes('Parts B, D and E'))).toBe(false);
  });

  it('cautions where Part A says sprinkler and both sprinkler parts are N/A', () => {
    const form = issuable({
      maintenanceTest: grid({ sprinklerAnnual: true }),
      sprinklerHydrostatic: naPart,
      sprinklerFlow: { result: 'na', testPoints: [] },
    });
    const issue = validateForm72(form).find((i) => i.message.includes('Parts F and G'));
    expect(issue).toBeDefined();
    expect(issue!.blocking).toBe(false);
  });

  it('checks both halves of a combined test, because combined means both systems', () => {
    const form = issuable({
      maintenanceTest: grid({ combinedAnnual: true }),
      hydrostatic: naPart,
      flowTest: { result: 'na', hydrantLocations: [], rows: [] },
      booster: naPart,
      sprinklerHydrostatic: naPart,
      sprinklerFlow: { result: 'na', testPoints: [] },
    });
    const messages = validateForm72(form).map((i) => i.message).join(' ');
    expect(messages).toContain('Parts B, D and E');
    expect(messages).toContain('Parts F and G');
  });

  it('says nothing about sprinkler parts on a hydrant-only test', () => {
    // The commonest form in the company. N/A on F and G is exactly right there,
    // and a caution would be noise on nearly every form raised.
    const form = issuable({
      maintenanceTest: grid({ hydrantAnnual: true }),
      flowTest: { result: 'pass', hydrantLocations: ['Booster'], rows: [] },
      sprinklerHydrostatic: naPart,
      sprinklerFlow: { result: 'na', testPoints: [] },
    });
    expect(validateForm72(form).some((i) => i.message.includes('Parts F and G'))).toBe(false);
  });

  it('says nothing where Part A is not answered, which has its own blocker', () => {
    const form = issuable({ maintenanceTest: grid({}) });
    expect(validateForm72(form).some((i) => i.message.includes('not applicable. One of the two')))
      .toBe(false);
  });
});

describe('the two calibration dates on Part C’s flow device line', () => {
  it('prints both, which the page did not print at all', () => {
    const html = form72Html(doc({
      form: issuable({
        flowDeviceKinds: ['electromagnetic'],
        flowDeviceCalibrated: { electromagnetic: '2026-07-18' },
      }),
    }));
    const line = between(html, 'Part C not required for orifice testing', '</tr>');
    expect(line).toContain('Electro magnetic calibrated:');
    expect(line).toContain('18/07/2026');
    // Mechanical was not the device used, so its date is not a missing reading.
    expect(line).toContain('Mechanical calibrated:');
    expect(line).toContain('Not used');
  });

  it('flags a ticked device with no calibration date', () => {
    const html = form72Html(doc({ form: issuable({ flowDeviceKinds: ['mechanical'] }) }));
    const line = between(html, 'Part C not required for orifice testing', '</tr>');
    expect(line).toContain('Not recorded');
  });

  it('asks for no date against an orifice plate, which has nothing to calibrate', () => {
    expect(CALIBRATED_FLOW_DEVICE_KINDS).toEqual(['mechanical', 'electromagnetic']);
    const html = form72Html(doc({ form: issuable({ flowDeviceKinds: ['orifice'] }) }));
    const line = between(html, 'Part C not required for orifice testing', '</tr>');
    expect(line).not.toContain('Not recorded');
  });

  it('says the device type question is unanswered rather than showing three empty boxes', () => {
    const html = form72Html(doc({ form: issuable({ flowDeviceKinds: [] }) }));
    const row = between(html, 'Flow measuring device', '</tr>');
    expect(row).toContain('Not answered');
  });
});

describe('Part G in the department’s column order', () => {
  const point = {
    location: 'Valve room 1', requiredFlowLpm: 540, resultFlowLpm: 560,
    requiredPressureKpa: 200, resultPressureKpa: 210,
  };

  it('puts the requirement, then the boxes, then what was achieved', () => {
    // Ours put the achieved value before the boxes, which reads as a box
    // ticked about the figure to its left rather than the one to its right.
    const html = form72Html(doc({
      form: issuable({ sprinklerFlow: { result: 'pass', testPoints: [point] } }),
    }));
    const row = between(html, 'Required flow rate (L/min)', '</tr>');
    expect(row.indexOf('540')).toBeLessThan(row.indexOf('Pass'));
    expect(row.indexOf('Pass')).toBeLessThan(row.indexOf('560'));
  });

  it('prints the achieved value with its unit, as the department annotates it', () => {
    const html = form72Html(doc({
      form: issuable({ sprinklerFlow: { result: 'pass', testPoints: [point] } }),
    }));
    expect(flat(html)).toContain('560 <span class="u">L/min</span>');
    expect(flat(html)).toContain('210 <span class="u">kPa</span>');
  });

  it('marks a third test point as added, because the department prints two', () => {
    const html = form72Html(doc({
      form: issuable({
        sprinklerFlow: {
          result: 'pass',
          testPoints: [point, { ...point, location: 'Valve room 2' }, { ...point, location: 'Roof tank' }],
        },
      }),
    }));
    expect(flat(html)).toContain('Test point 3 <span class="extra">added</span>');
    expect(flat(html)).not.toContain('Test point 1 <span class="extra">added</span>');
  });
});
