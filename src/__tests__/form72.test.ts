import {
  DECLARATION, DEPARTMENT_NOTE, FORM_72_SOURCES, STANDARD_FLOW_RATES_LPS,
  flowTableRows, form72Html, frictionalLossGaps, hydrantLocationsNeeded, occupierCopyDue,
  occupierCopyDueBy, qldCalendarDate, testPointOutcome, testerCopyKeepUntil,
  type Form72DocumentInput,
} from '@/export/form72';
import { MIGRATION_V12 } from '@/db/schemaForm72';
import {
  deviceCalibration, emptyForm72, overloadCheck, validateForm72, type Form72, type TestDevice,
} from '@/domain/form72';

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

  it('does not add an N/A box to a department part that has none', () => {
    // Part H's System row prints Pass and Fail and nothing else. A third box
    // here would be Safe QLD's, printed inside the department's part, where a
    // reader has no way to tell whose it is.
    const html = form72Html(doc({ form: issuable({ systemResult: 'na' }) }));
    const system = between(html, '<td class="k">System</td>', 'System Notes');
    expect(system).toContain('Pass');
    expect(system).toContain('Fail');
    // The empty System Notes box still says N/A, which is the department's own
    // box answered. What must not appear is a third tick box beside Pass/Fail.
    expect(system).not.toContain('N/A');
    const partH = between(html, 'Part H — Compliance', 'Part I —');
    expect(flat(partH)).toContain(
      "Recorded as not applicable. The department's System row carries only Pass and Fail",
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
    const locations = between(twoProved, 'Hydrant 1 Location', 'Static Pressure');
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
    const three = between(threeProved, 'Hydrant 3 Location', 'Hydrant 4 Location');
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
