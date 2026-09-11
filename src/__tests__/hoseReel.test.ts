import {
  ACTIVITIES_ARE_INDEPENDENT,
  ACTIVITY_ROUTINE_ID,
  ACTIVITY_SPECS,
  AS1851_SECTION_NOT_ESTABLISHED,
  COVERAGE_IS_NOT_A_DESIGN,
  HOSE_RULES,
  MAX_HOSE_LENGTH_M,
  NOMINAL_THROW_M,
  PUBLISHED_DUTIES,
  SOURCES,
  assessHose,
  checkFlow,
  citeSources,
  coverage,
  discharges,
  estimateReels,
  formatAuDate,
  isRefused,
  nextDue,
  publishedDuty,
  rollupSite,
  toSpan,
  type HoseFinding,
  type HoseReelActivity,
  type RegisterEntry,
  type SourceId,
} from '@/domain/hoseReel';

/**
 * Fire hose reels — a thousand assets that nobody argues about.
 *
 * What is asserted here is mostly the four ways a tick on a hose reel sheet
 * goes wrong: the five-yearly absorbed into the six-monthly, drift off the
 * anchor, a day invented out of "Jun-25", and a flow figure with nothing behind
 * it. Each of those has a test written as the situation it comes from rather
 * than as a unit of arithmetic, because each of them is something a technician
 * has actually done on a Friday afternoon.
 *
 * The coverage arithmetic is tested to the metre because it is the one thing
 * here a client will re-do on the back of an envelope, and the refusals are
 * tested hardest of all — a refusal that quietly becomes a plausible number is
 * the failure this whole app is built against.
 */

const TODAY = '2026-09-01';

// ===========================================================================

describe('the sources behind every figure', () => {
  it('gives every source a URL, a confidence and a reason the confidence is what it is', () => {
    for (const id of Object.keys(SOURCES) as SourceId[]) {
      const s = SOURCES[id];
      expect(s.url).toMatch(/^https:\/\//);
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(s.basis.length).toBeGreaterThan(40);
      expect(s.what.length).toBeGreaterThan(20);
      expect(s.ref.length).toBeGreaterThan(5);
    }
  });

  it('cites each source once however many results named it, so a report does not list AS 2441 four times', () => {
    const cited = citeSources(['as2441', 'alexon-reels', 'as2441', 'as2441', 'alexon-reels']);
    expect(cited.map((s) => s.id)).toEqual(['as2441', 'alexon-reels']);
  });

  it("refuses to print an AS 1851 section number for hose reels, because the sources reached disagree about it", () => {
    // A wrong section number on a record of maintenance is a wrong citation on
    // a statutory document. The honest answer is that this app does not know.
    expect(SOURCES.as1851.confidence).not.toBe('high');
    expect(SOURCES.as1851.basis).toMatch(/section number is NOT established/i);
    expect(AS1851_SECTION_NOT_ESTABLISHED).toMatch(/does not print an AS 1851-2012 section or item number/i);
  });

  it('marks the two trade pages low confidence and the government code high, and never the other way round', () => {
    expect(SOURCES['alexon-reels'].confidence).toBe('low');
    expect(SOURCES['firehosereels-au'].confidence).toBe('low');
    expect(SOURCES['ncc-e1d3'].confidence).toBe('high');
    expect(SOURCES['qdc-mp61'].confidence).toBe('high');
  });
});

// ===========================================================================

describe('what one reel reaches', () => {
  it('adds the hose stream to the hose run, because the reach is the jet and not the hose', () => {
    const c = coverage(36);
    if (isRefused(c)) throw new Error(c.reason);
    expect(c.throwM).toBe(NOMINAL_THROW_M);
    expect(c.radiusM).toBe(40);
  });

  it('works out both the bare-floor disc and the square that actually tiles, because circles do not tessellate', () => {
    const c = coverage(36);
    if (isRefused(c)) throw new Error(c.reason);
    // π × 40² = 5026.548…, and the largest square inside that circle is 2r².
    expect(c.discAreaM2).toBe(5026.5);
    expect(c.gridAreaM2).toBe(3200);
  });

  it('scales the whole way down to a short hose without any special case', () => {
    const c = coverage(18);
    if (isRefused(c)) throw new Error(c.reason);
    expect(c.radiusM).toBe(22);
    expect(c.discAreaM2).toBe(1520.5); // π × 484
    expect(c.gridAreaM2).toBe(968);
  });

  it('never lets a coverage figure leave without the sentence saying it is not a design', () => {
    const c = coverage(30);
    if (isRefused(c)) throw new Error(c.reason);
    expect(c.notes).toContain(COVERAGE_IS_NOT_A_DESIGN);
    expect(COVERAGE_IS_NOT_A_DESIGN).toMatch(/straight line/i);
  });

  it('flags a hose longer than the maximum as a finding but still says what it reaches', () => {
    // A technician measuring 40 m of hose needs to be told it is over length,
    // not stonewalled — the reach is real whether or not it is permitted.
    const c = coverage(40);
    if (isRefused(c)) throw new Error(c.reason);
    expect(c.overLength).toBe(true);
    expect(c.radiusM).toBe(44);
    expect(c.notes.join(' ')).toMatch(new RegExp(`${MAX_HOSE_LENGTH_M} m maximum`));
  });

  it('treats a hose at exactly the maximum as compliant, because 36 is not longer than 36', () => {
    const c = coverage(MAX_HOSE_LENGTH_M);
    if (isRefused(c)) throw new Error(c.reason);
    expect(c.overLength).toBe(false);
  });

  it('drops its confidence and says so when a hose stream other than the sourced one is used', () => {
    const c = coverage(36, 6);
    if (isRefused(c)) throw new Error(c.reason);
    expect(c.confidence).toBe('low');
    expect(c.notes.join(' ')).toMatch(/Nothing here supports that figure/);
  });

  it('refuses a hose length it was not given rather than assuming the common one', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const c = coverage(bad);
      expect(isRefused(c)).toBe(true);
      if (isRefused(c)) expect(c.whatToDo).toMatch(/Read the length/);
    }
  });

  it('refuses a negative hose stream instead of taking its absolute value', () => {
    const c = coverage(36, -4);
    expect(isRefused(c)).toBe(true);
  });
});

// ===========================================================================

describe('how many reels a floor plausibly needs', () => {
  it('brackets the count between the bare-floor minimum and a grid that leaves no gap', () => {
    // 10,000 m² with 36 m hose: 10000/5026.5 = 1.99 discs, 10000/3200 = 3.13
    // squares. The gap between 2 and 4 is the honest width of this answer.
    const e = estimateReels(10_000, 36);
    if (isRefused(e)) throw new Error(e.reason);
    expect(e.idealMinimum).toBe(2);
    expect(e.gridEstimate).toBe(4);
  });

  it('never returns a grid estimate below the ideal minimum, at any length or any area', () => {
    for (const hose of [12, 18, 24, 30, 36]) {
      for (const area of [80, 500, 1200, 5000, 20_000, 91_337]) {
        const e = estimateReels(area, hose);
        if (isRefused(e)) throw new Error(e.reason);
        expect(e.gridEstimate).toBeGreaterThanOrEqual(e.idealMinimum);
      }
    }
  });

  it('says plainly when the reels installed cannot reach the floor even on a bare slab', () => {
    const e = estimateReels(20_000, 18, { installed: 1 });
    if (isRefused(e)) throw new Error(e.reason);
    expect(e.shortfallStatement).toMatch(/cannot reach the whole floor/);
  });

  it('will not call a site over-provided, because that is second-guessing a design it has not seen', () => {
    const e = estimateReels(400, 36, { installed: 6 });
    if (isRefused(e)) throw new Error(e.reason);
    expect(e.shortfallStatement).toBeUndefined();
    expect(e.notes.join(' ')).toMatch(/depends on where they are/);
  });

  it('prompts the NCC threshold on a compartment over 500 m² without calling it a defect', () => {
    const e = estimateReels(900, 36);
    if (isRefused(e)) throw new Error(e.reason);
    const notes = e.notes.join(' ');
    expect(notes).toMatch(/E1D3/);
    expect(notes).toMatch(/not a defect/);
  });

  it('counts reels off the areas it printed, so the client redoing the division gets the same answer', () => {
    // The areas are rounded for display. A count worked out from an unrounded
    // radius alongside them can come out a reel lower than the one the printed
    // numbers give, and lower is the flattering direction.
    for (const hose of [17.55, 24.05, 30.05, 36]) {
      for (const area of [3650, 5027, 9999, 40_000]) {
        const e = estimateReels(area, hose);
        if (isRefused(e)) throw new Error(e.reason);
        expect(e.idealMinimum).toBe(Math.ceil(area / e.coverage.discAreaM2));
        expect(e.gridEstimate).toBe(Math.ceil(area / e.coverage.gridAreaM2));
      }
    }
  });

  it('calls only the disc count a lower bound, because a hexagonal layout beats a square grid', () => {
    // A square grid gets 2r² out of a reel; offsetting the rows gets 3√3/2 r²,
    // which is more. Calling the grid figure a lower bound would be asserting
    // that no layout does better, and one does.
    const e = estimateReels(10_000, 36);
    if (isRefused(e)) throw new Error(e.reason);
    const notes = e.notes.join(' ');
    expect(notes).toMatch(/bare-floor minimum is a true lower bound/);
    expect(notes).toMatch(/grid figure is not a lower bound/);
    const hexagonal = Math.ceil(10_000 / ((3 * Math.sqrt(3)) / 2) / (40 * 40));
    expect(hexagonal).toBeLessThan(e.gridEstimate);
    expect(hexagonal).toBeGreaterThanOrEqual(e.idealMinimum);
  });

  it('writes a single installed reel as one reel and not as "1 reels"', () => {
    const e = estimateReels(400, 36, { installed: 1 });
    if (isRefused(e)) throw new Error(e.reason);
    expect(e.notes.join(' ')).toMatch(/1 reel is installed/);
  });

  it('refuses a floor area it does not have, and points at the compartment rather than the building', () => {
    const e = estimateReels(0, 36);
    expect(isRefused(e)).toBe(true);
    if (isRefused(e)) expect(e.whatToDo).toMatch(/fire compartment/);
  });

  it('passes a bad hose length straight through as the coverage refusal it already is', () => {
    const e = estimateReels(1000, 0);
    expect(isRefused(e)).toBe(true);
  });
});

// ===========================================================================

describe('the duty a reel has to deliver', () => {
  it('offers the 19 mm figure only because a public Australian source states it as well', () => {
    const d = publishedDuty(19);
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.minimumFlowLitresPerSecond).toBe(0.33);
    expect(d.atInletPressureKpa).toBe(220);
    // The figure is worth exactly as much as the page it came from.
    expect(d.confidence).toBe('low');
    expect(d.sourceIds).toContain('alexon-reels');
  });

  it('records that one trade source states a different flow figure rather than resolving the disagreement', () => {
    const d = publishedDuty(19);
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.disagreement).toMatch(/0\.45 L\/s/);
    expect(d.sourceIds).toContain('firehosereels-au');
  });

  it("refuses the DN 25 figure rather than transcribing a row of the standard's own table", () => {
    const d = publishedDuty(25);
    expect(isRefused(d)).toBe(true);
    if (isRefused(d)) {
      expect(d.reason).toMatch(/Table 6\.1/);
      expect(d.whatToDo).toMatch(/purchased copy/);
    }
  });

  it('backs every offered duty with sources that actually exist and carry a URL', () => {
    for (const duty of PUBLISHED_DUTIES) {
      expect(duty.sourceIds.length).toBeGreaterThan(0);
      for (const id of duty.sourceIds) expect(SOURCES[id]?.url).toMatch(/^https:\/\//);
    }
  });
});

// ===========================================================================

describe('checking a measured flow against a supplied duty', () => {
  it('refuses to test against a duty nobody supplied, because a tick with nothing behind it is worse than no tick', () => {
    const r = checkFlow({ measuredFlowLitresPerMinute: 24 });
    expect(isRefused(r)).toBe(true);
    if (isRefused(r)) expect(r.whatToDo).toMatch(/will not assume one/);
  });

  it('refuses when nothing was measured, and says the test is taken with the hose run out', () => {
    const r = checkFlow({ dutyFlowLitresPerSecond: 0.33 });
    expect(isRefused(r)).toBe(true);
    if (isRefused(r)) expect(r.whatToDo).toMatch(/still on the reel is not the test/);
  });

  it('converts the duty to the unit the gauge reads in: 0.33 L/s is 19.8 L/min', () => {
    const r = checkFlow({ measuredFlowLitresPerMinute: 24, dutyFlowLitresPerSecond: 0.33 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.flow.required).toBe(19.8);
    expect(r.flow.margin).toBe(4.2);
    expect(r.measuredFlowLitresPerSecond).toBe(0.4);
  });

  it('passes a reel delivering exactly its duty, in flow and in pressure', () => {
    /*
     * Exactly on the duty is a pass. A reel is designed to that figure, so
     * meeting it is the intended outcome rather than a near miss, and reading
     * it as a failure condemns a reel that does what it was installed to do —
     * across 804 of them on this company's books.
     *
     * 0.33 L/s is 19.8 L/min.
     */
    const exact = checkFlow({
      measuredFlowLitresPerMinute: 19.8,
      dutyFlowLitresPerSecond: 0.33,
      measuredRunningPressureKpa: 220,
      dutyPressureKpa: 220,
    });
    if (isRefused(exact)) throw new Error(exact.reason);
    expect(exact.flow.verdict).toBe('pass');
    expect(exact.flow.margin).toBe(0);
    expect(exact.pressure.verdict).toBe('pass');
    expect(exact.pressure.margin).toBe(0);
  });

  it('fails a reel a hair under its duty on either measurement', () => {
    const lowFlow = checkFlow({
      measuredFlowLitresPerMinute: 19.7,
      dutyFlowLitresPerSecond: 0.33,
      measuredRunningPressureKpa: 220,
      dutyPressureKpa: 220,
    });
    if (isRefused(lowFlow)) throw new Error(lowFlow.reason);
    expect(lowFlow.flow.verdict).toBe('fail');

    const lowPressure = checkFlow({
      measuredFlowLitresPerMinute: 19.8,
      dutyFlowLitresPerSecond: 0.33,
      measuredRunningPressureKpa: 219,
      dutyPressureKpa: 220,
    });
    if (isRefused(lowPressure)) throw new Error(lowPressure.reason);
    expect(lowPressure.pressure.verdict).toBe('fail');
  });

  it('fails a reel reading 0.4 on a gauge marked L/min against a duty of 0.33 L/s, instead of passing it', () => {
    // The sixty-times mix-up, written as the field failure it is: 0.4 L/min is
    // a dripping tap and the number looks like a comfortable pass next to 0.33.
    const r = checkFlow({ measuredFlowLitresPerMinute: 0.4, dutyFlowLitresPerSecond: 0.33 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
    expect(r.flow.margin).toBe(-19.4);
    expect(r.notes.join(' ')).toMatch(/factor of sixty/);
  });

  it('fails a reel that flowed nothing, instead of filing zero as "not measured"', () => {
    // A stop valve shut somewhere upstream reads zero at the nozzle. Zero is
    // the worst result on the sheet and the one most easily lost: treated as an
    // empty field it becomes "undetermined" and the reel keeps its tag.
    const r = checkFlow({ measuredFlowLitresPerMinute: 0, dutyFlowLitresPerSecond: 0.33 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.flow.verdict).toBe('fail');
    expect(r.verdict).toBe('fail');
    expect(r.measuredFlowLitresPerSecond).toBe(0);
  });

  it('fails a reel with no pressure behind it for the same reason', () => {
    const r = checkFlow({ measuredRunningPressureKpa: 0, dutyPressureKpa: 220 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
    expect(r.pressure.margin).toBe(-220);
  });

  it('still treats a duty of zero as a duty nobody entered, because no reel has one', () => {
    const r = checkFlow({ measuredFlowLitresPerMinute: 24, dutyFlowLitresPerSecond: 0 });
    expect(isRefused(r)).toBe(true);
  });

  it('passes only when every figure it had a duty for was measured and met', () => {
    const r = checkFlow({
      measuredFlowLitresPerMinute: 24,
      measuredRunningPressureKpa: 260,
      dutyFlowLitresPerSecond: 0.33,
      dutyPressureKpa: 220,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('pass');
    expect(r.pressure.margin).toBe(40);
  });

  it('will not call a flow-only test a pass when a pressure duty was set and no gauge was read', () => {
    // The duty is a flow held at a pressure. Half the test is not a pass, and
    // this is the single most likely way a hose reel gets a green tick.
    const r = checkFlow({
      measuredFlowLitresPerMinute: 24,
      dutyFlowLitresPerSecond: 0.33,
      dutyPressureKpa: 220,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('undetermined');
    expect(r.pressure.verdict).toBe('not-measured');
    expect(r.statement).toMatch(/not the same thing/);
  });

  it('still fails a measured shortfall even when the other half of the test was skipped', () => {
    // No missing reading can turn 12 L/min into 20, so a gap holds back a pass
    // and never a fail.
    const r = checkFlow({
      measuredFlowLitresPerMinute: 12,
      dutyFlowLitresPerSecond: 0.33,
      dutyPressureKpa: 220,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
  });

  it('warns that a flow duty on its own does not prove the reel holds pressure', () => {
    const r = checkFlow({ measuredFlowLitresPerMinute: 24, dutyFlowLitresPerSecond: 0.33 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('pass');
    expect(r.notes.join(' ')).toMatch(/Only a flow duty was supplied/);
  });

  it('says the pressure figure belongs at the reel inlet, because the published duty is quoted there', () => {
    // 220 kPa is the supply condition the discharge is measured under, not a
    // number the nozzle has to beat. Read at the far end of 36 m of 19 mm hose
    // it fails a reel for the friction loss the flow test already measures.
    const duty = publishedDuty(19);
    if (isRefused(duty)) throw new Error(duty.reason);
    expect(duty.pressureMeasuredAt).toMatch(/inlet to the reel assembly, not at the nozzle/);

    const r = checkFlow({ measuredRunningPressureKpa: 300, dutyPressureKpa: 220 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.pressure.label).toMatch(/at the reel inlet/);
    expect(r.notes.join(' ')).toMatch(/read at the inlet to the reel/);
  });

  it('tells the technician to test the worst reel, not the one by the riser', () => {
    const r = checkFlow({ measuredFlowLitresPerMinute: 24, dutyFlowLitresPerSecond: 0.33 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.notes.join(' ')).toMatch(/hydraulically most disadvantaged/);
  });

  it('says a pressure reading has to be taken with water flowing, not with the nozzle shut', () => {
    const r = checkFlow({ measuredRunningPressureKpa: 300, dutyPressureKpa: 220 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.notes.join(' ')).toMatch(/Static pressure with the nozzle/);
  });
});

// ===========================================================================

describe('what condemns a hose and what a person still has to decide', () => {
  it('gives every rule a reason, an action and sources that resolve', () => {
    for (const id of Object.keys(HOSE_RULES) as HoseFinding[]) {
      const rule = HOSE_RULES[id];
      expect(rule.reason.length).toBeGreaterThan(40);
      expect(rule.action.length).toBeGreaterThan(20);
      expect(rule.sourceIds.length).toBeGreaterThan(0);
      for (const s of rule.sourceIds) expect(SOURCES[s]).toBeDefined();
    }
  });

  it('has no verdict at all for a reel nobody ran off the drum', () => {
    // Almost all of a hose lives wound out of sight. No findings from a reel
    // nobody deployed is a statement about the afternoon, not about the hose.
    const a = assessHose({ findings: [], fullyDeployed: false });
    expect(a.verdict).toBe('undetermined');
    expect(a.statement).toMatch(/is not a pass/);
    expect(a.openQuestions[0]).toMatch(/Run the full length off the reel/);
  });

  it('calls a hose that was run out and found clean serviceable, and says it was run out', () => {
    const a = assessHose({ findings: [], fullyDeployed: true });
    expect(a.verdict).toBe('serviceable');
    expect(a.statement).toMatch(/Run out in full/);
  });

  it('condemns the hose and not the reel, so a bracket and a drum are not quoted for', () => {
    const a = assessHose({ findings: ['perished-or-cracked'], fullyDeployed: true });
    expect(a.verdict).toBe('unserviceable');
    expect(a.statement).toMatch(/quote the hose/);
    expect(a.replaceHose.map((r) => r.id)).toEqual(['perished-or-cracked']);
  });

  it('still condemns a hose found perished even though the inspection was incomplete', () => {
    // A finding already made does not become less true because the rest of the
    // check was skipped.
    const a = assessHose({ findings: ['failed-pressure-test'], fullyDeployed: false });
    expect(a.verdict).toBe('unserviceable');
  });

  it('leaves the depth of a cut to the person holding the hose rather than deciding it from a checkbox', () => {
    const a = assessHose({ findings: ['surface-abrasion'], fullyDeployed: true });
    expect(a.verdict).toBe('undetermined');
    expect(a.needsJudgement.map((r) => r.id)).toEqual(['surface-abrasion']);
    expect(a.openQuestions.join(' ')).toMatch(/reinforcement shows/);
  });

  it('does not round a judgement up to serviceable just because the rest of the reel was fine', () => {
    const a = assessHose({ findings: ['sun-crazing', 'access-obstructed'], fullyDeployed: true });
    expect(a.verdict).toBe('undetermined');
    expect(a.repairable.map((r) => r.id)).toEqual(['access-obstructed']);
  });

  it('treats a missing nozzle as a defect to fix rather than a hose to replace', () => {
    const a = assessHose({ findings: ['nozzle-missing-or-damaged'], fullyDeployed: true });
    expect(a.verdict).toBe('serviceable');
    expect(a.repairable.map((r) => r.id)).toEqual(['nozzle-missing-or-damaged']);
    expect(a.replaceHose).toHaveLength(0);
  });

  it('condemns a hose someone has repaired with a clamp, because the assembly is certified as a whole', () => {
    const a = assessHose({ findings: ['coupling-non-standard-repair'], fullyDeployed: true });
    expect(a.verdict).toBe('unserviceable');
  });

  it('reports a finding it has no rule for instead of dropping it on the floor', () => {
    const a = assessHose({ findings: ['hose-smells-odd'], fullyDeployed: true });
    expect(a.unrecognised).toEqual(['hose-smells-odd']);
  });
});

// ===========================================================================

describe('the three routines a hose reel carries are three different jobs', () => {
  it('never lets one activity discharge the obligation for any other', () => {
    const all = Object.keys(ACTIVITY_SPECS) as HoseReelActivity[];
    for (const performed of all) {
      for (const obligation of all) {
        expect(discharges(performed, obligation)).toBe(performed === obligation);
      }
    }
  });

  it('carries the yearly the register actually runs, and not only the two that are easy to name', () => {
    // Safe QLD's own hose reel export of 1/9/2026 has 804 reels on it: 802 with
    // a six-monthly date, 791 with a yearly and 630 with a five-yearly. A module
    // that models two of the three reports a site as clear with a whole
    // routine missing from the page, which is the same failure as absorbing one
    // routine into another and is harder to see.
    expect(Object.keys(ACTIVITY_SPECS).sort()).toEqual(['five-yearly', 'six-monthly', 'yearly']);
    expect(ACTIVITY_SPECS.yearly.intervalMonths).toBe(12);
  });

  it('holds the intervals in months so nothing has to guess what "five-yearly" means', () => {
    expect(ACTIVITY_SPECS['six-monthly'].intervalMonths).toBe(6);
    expect(ACTIVITY_SPECS['five-yearly'].intervalMonths).toBe(60);
  });

  it('says of each activity what the others cannot find, and what says it runs at that interval', () => {
    expect(ACTIVITY_SPECS['six-monthly'].doesNotCover).toMatch(/no test pressure/i);
    expect(ACTIVITY_SPECS['five-yearly'].doesNotCover).toMatch(/stop valve/);
    for (const id of Object.keys(ACTIVITY_SPECS) as HoseReelActivity[]) {
      expect(ACTIVITY_SPECS[id].evidence.length).toBeGreaterThan(40);
    }
  });

  it('admits the yearly has no seeded routine rather than pointing it at the six-monthly one', () => {
    // Aiming it at the nearest routine would put six-monthly test items on a
    // yearly record, which is the conflation this module exists to stop one
    // level down.
    expect(ACTIVITY_ROUTINE_ID['six-monthly']).toBe('fhr-six-monthly');
    expect(ACTIVITY_ROUTINE_ID['five-yearly']).toBe('hose-reel-five-yearly');
    expect(ACTIVITY_ROUTINE_ID.yearly).toBeUndefined();
    expect(ACTIVITY_SPECS.yearly.confidence).toBe('low');
  });
});

// ===========================================================================

describe('when the next one falls due', () => {
  it('counts from the anchor, so a service done late does not move the schedule', () => {
    // Anchor 1/1/2020. Occurrence 13 was due 1/7/2026 and was done on 20/8/2026,
    // seven weeks late. The next one is still on the anchor grid at 1/1/2027 —
    // scheduling from the last service would say 20/2/2027 and would keep the
    // seven weeks forever.
    const d = nextDue({
      activity: 'six-monthly',
      commissioned: '01/01/2020',
      lastDone: '20/08/2026',
      today: TODAY,
    });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.due.earliest).toBe('2027-01-01');
    expect(d.due.earliest).not.toBe('2027-02-20');
    expect(d.anchoredTo).toBe('commissioning');
    expect(d.occurrence).toBe(14);
    expect(d.state).toBe('upcoming');
  });

  it('reads today as the Queensland day when it is handed an instant', () => {
    // 22:30 UTC on 2 July is the morning of 3 July in Brisbane, and the
    // days-until figures have to agree with a caller who passed the day.
    const asDay = nextDue({ activity: 'six-monthly', commissioned: '01/01/2020', today: '2026-07-03' });
    const asInstant = nextDue({
      activity: 'six-monthly', commissioned: '01/01/2020', today: '2026-07-02T22:30:00.000Z',
    });
    expect(isRefused(asDay)).toBe(false);
    expect(asInstant).toEqual(asDay);
  });

  it('reports every occurrence still outstanding, not just the most recent one', () => {
    // Last done January 2024 on a 2020 anchor: five six-monthlies have fallen
    // due since, and the date shown is the oldest one still owed.
    const d = nextDue({
      activity: 'six-monthly',
      commissioned: '01/01/2020',
      lastDone: '10/01/2024',
      today: TODAY,
    });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.state).toBe('overdue');
    expect(d.due.earliest).toBe('2024-07-01');
    expect(d.missedOccurrences).toBe(5);
    expect(d.notes.join(' ')).toMatch(/oldest one still outstanding/);
  });

  it('keeps "never recorded" separate from "overdue" so the worse fact survives', () => {
    const d = nextDue({ activity: 'five-yearly', commissioned: '01/03/2015', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.everRecorded).toBe(false);
    expect(d.state).toBe('overdue');
    expect(d.due.earliest).toBe('2020-03-01');
    expect(d.missedOccurrences).toBe(2);
  });

  it('counts a five-yearly in sixty months and not in six, on the same anchor', () => {
    const six = nextDue({ activity: 'six-monthly', commissioned: '01/03/2024', today: '2024-04-01' });
    const five = nextDue({ activity: 'five-yearly', commissioned: '01/03/2024', today: '2024-04-01' });
    if (isRefused(six) || isRefused(five)) throw new Error('both should schedule');
    expect(six.due.earliest).toBe('2024-09-01');
    expect(five.due.earliest).toBe('2029-03-01');
  });

  it('gives a month-precision anchor a month-precision due date and invents no day', () => {
    // "Jun-25" is how a register actually writes it. Read as 1 June it moves
    // the next service by up to a month and the asset reports compliant.
    const d = nextDue({ activity: 'six-monthly', commissioned: 'Jun-25', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.due.precision).toBe('month');
    expect(d.due.earliest).toBe('2025-12-01');
    expect(d.due.latest).toBe('2025-12-30');
    expect(d.due.label).toBe('December 2025');
    expect(d.notes.join(' ')).toMatch(/No day has been invented/);
  });

  it('carries a bare year through as a year-wide span rather than snapping it to January', () => {
    const d = nextDue({ activity: 'five-yearly', commissioned: '2015', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.due.precision).toBe('year');
    expect(d.due.earliest).toBe('2020-01-01');
    expect(d.due.latest).toBe('2020-12-31');
    expect(d.due.label).toMatch(/January 2020 to December 2020/);
  });

  it('applies no tolerance window, and says so rather than leaving it to be discovered', () => {
    const d = nextDue({ activity: 'six-monthly', commissioned: '01/01/2020', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.notes.join(' ')).toMatch(/No tolerance window has been applied/);
  });

  it('falls back to the last service when there is no anchor, and marks the answer as the weaker one it is', () => {
    const d = nextDue({ activity: 'six-monthly', lastDone: '20/08/2026', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.anchoredTo).toBe('last-service');
    expect(d.confidence).toBe('low');
    expect(d.due.earliest).toBe('2027-02-20');
    expect(d.notes.join(' ')).toMatch(/drift the anchor rule exists to prevent/);
  });

  it('uses the first recorded service as the anchor where commissioning is unknown', () => {
    const d = nextDue({
      activity: 'six-monthly',
      firstService: '01/01/2020',
      lastDone: '20/08/2026',
      today: TODAY,
    });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.anchoredTo).toBe('first-service');
    expect(d.due.earliest).toBe('2027-01-01');
  });

  it('refuses when there is nothing to count from, and points at the commissioning tag', () => {
    const d = nextDue({ activity: 'five-yearly', today: TODAY });
    expect(isRefused(d)).toBe(true);
    if (isRefused(d)) expect(d.whatToDo).toMatch(/Clause 12/);
  });

  it('refuses a blank or unreadable register cell instead of scheduling off it', () => {
    for (const cell of ['', '   ', 'N/A', 'not recorded']) {
      const d = nextDue({ activity: 'six-monthly', commissioned: cell, today: TODAY });
      expect(isRefused(d)).toBe(true);
    }
  });

  it('refuses an anchor in the future rather than reporting a reel due in 2031', () => {
    const d = nextDue({ activity: 'six-monthly', commissioned: '01/01/2030', today: TODAY });
    expect(isRefused(d)).toBe(true);
    if (isRefused(d)) expect(d.reason).toMatch(/in the future/);
  });

  it('refuses a service recorded before the reel was commissioned instead of picking one of the two', () => {
    const d = nextDue({
      activity: 'five-yearly',
      commissioned: '01/01/2020',
      lastDone: '01/01/2018',
      today: TODAY,
    });
    expect(isRefused(d)).toBe(true);
    if (isRefused(d)) expect(d.whatToDo).toMatch(/reads as compliant for years/);
  });

  it('does not credit a service four months late with the occurrence that had not fallen due yet', () => {
    // Anchor 1/1/2020, six-monthly. Occurrence 1 fell due 1/7/2020 and was done
    // on 1/11/2020. Crediting the nearest occurrence instead of the ones that
    // had actually fallen due hands the reel the January 2021 service as well,
    // and on 1/2/2021 it reads "next due July 2021, nothing outstanding" — a
    // whole six-monthly skipped and twelve months between services, with every
    // line of the record compliant.
    const d = nextDue({
      activity: 'six-monthly',
      commissioned: '01/01/2020',
      lastDone: '01/11/2020',
      today: '2021-02-01',
    });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.occurrence).toBe(2);
    expect(d.due.earliest).toBe('2021-01-01');
    expect(d.state).toBe('overdue');
  });

  it("does not say a reel has never been serviced when the date it is counting from is a service", () => {
    // The anchor here IS the first recorded six-monthly. Reading "ever
    // recorded" off the last-service field alone printed a flat contradiction
    // on a document a client reads.
    const d = nextDue({ activity: 'six-monthly', firstService: '01/01/2020', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.anchoredTo).toBe('first-service');
    expect(d.everRecorded).toBe(true);
    expect(d.notes.join(' ')).not.toMatch(/has ever been recorded/);
  });

  it('reminds the reader on every due date that the other activity is not covered by this one', () => {
    const d = nextDue({ activity: 'six-monthly', commissioned: '01/01/2020', today: TODAY });
    if (isRefused(d)) throw new Error(d.reason);
    expect(d.notes).toContain(ACTIVITIES_ARE_INDEPENDENT);
  });
});

// ===========================================================================

describe('reading dates the way the register wrote them', () => {
  it('shows a date the Australian way round, always', () => {
    expect(formatAuDate('2026-03-04')).toBe('4/3/2026');
  });

  it('turns a month cell into the span of days it could be, not into the first of the month', () => {
    const span = toSpan('Feb-24');
    expect(span?.precision).toBe('month');
    expect(span?.earliest).toBe('2024-02-01');
    // 2024 is a leap year and the span has to know it.
    expect(span?.latest).toBe('2024-02-29');
  });

  it('gives nothing back for a cell it cannot read, so nothing downstream can schedule off it', () => {
    expect(toSpan('')).toBeUndefined();
    expect(toSpan(undefined)).toBeUndefined();
    expect(toSpan('sometime last winter')).toBeUndefined();
  });
});

// ===========================================================================

describe('the site rollup', () => {
  const entries: RegisterEntry[] = [
    {
      assetId: 'FHR-01',
      location: 'Level 1 lobby',
      hoseLengthM: 36,
      commissioned: '01/01/2015',
      lastSixMonthly: '01/07/2026',
      lastYearly: '01/07/2026',
      lastFiveYearly: '01/01/2020',
      findings: [],
      fullyDeployed: true,
    },
    {
      assetId: 'FHR-02',
      location: 'Loading dock',
      hoseLengthM: 30,
      commissioned: '01/01/2015',
      lastSixMonthly: '01/07/2026',
      lastYearly: '01/07/2026',
      // Never pressure tested. This is the reel the whole module is about.
      findings: ['access-obstructed'],
      fullyDeployed: true,
    },
    {
      assetId: 'FHR-03',
      location: 'Plant room',
      commissioned: '01/01/2015',
      lastSixMonthly: '01/07/2026',
      lastYearly: '01/07/2026',
      lastFiveYearly: '01/01/2020',
      findings: ['perished-or-cracked'],
      fullyDeployed: true,
    },
    {
      assetId: 'FHR-04',
      location: 'Car park',
      hoseLengthM: 36,
      // Nothing to schedule from at all.
      findings: [],
      fullyDeployed: false,
    },
  ];

  it('never infers a five-yearly from a six-monthly, which is the whole reason it exists', () => {
    // FHR-02 was serviced two months ago and has never been pressure tested.
    // A rollup that fell back to the six-monthly column would report it current.
    const r = rollupSite(entries, TODAY);
    const five = r.byActivity.find((b) => b.activity === 'five-yearly')!;
    expect(five.neverRecorded).toBe(1);
    expect(five.overdue).toBeGreaterThanOrEqual(1);
  });

  it('reads today as the Queensland day when it is handed an instant', () => {
    expect(rollupSite(entries, '2026-07-02T22:30:00.000Z')).toEqual(rollupSite(entries, '2026-07-03'));
  });

  it('keeps every activity in its own bucket instead of adding them into one number', () => {
    const r = rollupSite(entries, TODAY);
    expect(r.byActivity.map((b) => b.activity)).toEqual(['six-monthly', 'yearly', 'five-yearly']);
    const six = r.byActivity.find((b) => b.activity === 'six-monthly')!;
    expect(six.overdue).toBe(0);
    expect(six.dueWithinHorizon).toBe(3);
  });

  it('rolls up every activity the module knows about, because a routine missing from a rollup reads as a clean site', () => {
    // The failure this guards is not arithmetic. A rollup that iterates two of
    // three routines produces a page with nothing outstanding on it, and the
    // routine that is not on the page is the one nobody does.
    const r = rollupSite(entries, TODAY);
    const rolled = r.byActivity.map((b) => b.activity).sort();
    const known = (Object.keys(ACTIVITY_SPECS) as HoseReelActivity[]).sort();
    expect(rolled).toEqual(known);
  });

  it('schedules the yearly off the yearly column, so a reel serviced last month is not reported as owing nothing', () => {
    // Every reel here was six-monthlied in July 2026. The yearly is a separate
    // column and a separate schedule, and dropping it would take a routine that
    // 791 of the 804 reels on this book carry off the page entirely.
    const yearly = rollupSite(entries, TODAY).byActivity.find((b) => b.activity === 'yearly')!;
    expect(yearly.overdue + yearly.dueWithinHorizon + yearly.later + yearly.unknown).toBe(4);

    const noYearlyRecord = rollupSite(
      [{ ...entries[0]!, lastYearly: undefined }],
      TODAY,
    ).byActivity.find((b) => b.activity === 'yearly')!;
    expect(noYearlyRecord.neverRecorded).toBe(1);
    expect(noYearlyRecord.overdue).toBe(1);
  });

  it('counts a reel it cannot schedule as unknown with its reason, never as compliant', () => {
    const r = rollupSite(entries, TODAY);
    expect(r.unknown).toBe(3); // FHR-04, all three activities
    const six = r.byActivity.find((b) => b.activity === 'six-monthly')!;
    expect(six.unknownReasons[0]!.count).toBe(1);
    expect(six.unknownReasons[0]!.reason).toMatch(/Nothing readable to count from/);
  });

  it('lists the reel whose hose has to come off, by asset and by location', () => {
    const r = rollupSite(entries, TODAY);
    expect(r.unserviceable).toEqual([
      { assetId: 'FHR-03', location: 'Plant room', reason: 'Perished — cracking through the wall of the hose' },
    ]);
  });

  it('lists the cheap defect separately from the hose replacement, because they are different jobs', () => {
    const r = rollupSite(entries, TODAY);
    expect(r.repairable.map((x) => x.assetId)).toEqual(['FHR-02']);
  });

  it('counts a reel nobody ran out and refuses to let it read as a reel with nothing wrong', () => {
    const r = rollupSite(entries, TODAY);
    expect(r.notDeployed).toBe(1);
    expect(r.caveats.join(' ')).toMatch(/not a clean bill of health/);
  });

  it('carries its caveats in the returned data so the numbers cannot travel without them', () => {
    const r = rollupSite(entries, TODAY);
    expect(r.caveats).toContain(ACTIVITIES_ARE_INDEPENDENT);
    expect(r.caveats).toContain(AS1851_SECTION_NOT_ESTABLISHED);
    expect(r.caveats.join(' ')).toMatch(/QDC MP 6\.1/);
    expect(r.caveats.join(' ')).toMatch(/no hose length recorded/);
  });

  it('is honest about an empty site rather than reporting it as compliant', () => {
    const r = rollupSite([], TODAY);
    expect(r.total).toBe(0);
    expect(r.overdue).toBe(0);
    expect(r.unserviceable).toEqual([]);
    expect(r.caveats.length).toBeGreaterThan(0);
  });
});
