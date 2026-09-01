import {
  BARRIERS,
  FREE_FIELD_INDOOR_LIMIT_M,
  NOT_AN_ACOUSTIC_ASSESSMENT,
  QFES_CONCESSION_POSITION,
  SOU_DOOR_CONCESSIONS,
  SPL_REQUIREMENTS,
  addLevels,
  barrier,
  coverageVerdict,
  distanceChangeDb,
  maxDistanceForLevel,
  regimeCautions,
  removeAmbient,
  requiredRatedDb,
  signalPlusAmbient,
  sourceList,
  splAtDistance,
  type CoverageInput,
  type CoverageResult,
} from '@/calc/spl';

/**
 * Sound pressure level for occupant warning.
 *
 * Two failures are being guarded against. The first is arithmetic: decibels do
 * not add, they do not subtract, and a tool that treats them as ordinary
 * numbers will report a room as twice as loud as it is. The second is worse —
 * a confident answer in a room where the physics does not hold. So a good half
 * of what is asserted here is about refusing: no answer at zero metres, no
 * answer through a barrier nobody has a figure for, no signal level teased out
 * of two meter readings a decibel apart, and no verdict that does not carry
 * the confidence of the threshold it was decided against.
 */

/** A device rated 100 dB(A) at one metre — the ordinary case on a job. */
const SOUNDER = { ratedDb: 100, referenceDistanceM: 1 };

function pass(input: CoverageInput): CoverageResult {
  const r = coverageVerdict(input);
  if (!r.ok) throw new Error(`expected a result, got: ${r.error}`);
  return r;
}

describe('distanceChangeDb', () => {
  it('loses six decibels for every doubling of distance', () => {
    // The one number a technician carries in their head. If this is wrong,
    // everything downstream is wrong in the same direction.
    expect(distanceChangeDb(1, 2)).toBeCloseTo(-6.02, 2);
    expect(distanceChangeDb(2, 4)).toBeCloseTo(-6.02, 2);
    expect(distanceChangeDb(1, 4)).toBeCloseTo(-12.04, 2);
  });

  it('loses exactly twenty decibels over ten times the distance', () => {
    expect(distanceChangeDb(1, 10)).toBeCloseTo(-20, 10);
    expect(distanceChangeDb(2, 20)).toBeCloseTo(-20, 10);
  });

  it('gains the same six decibels moving closer', () => {
    expect(distanceChangeDb(2, 1)).toBeCloseTo(6.02, 2);
  });

  it('is zero when the listener stands where the device was rated', () => {
    expect(distanceChangeDb(1, 1)).toBe(0);
  });

  it('refuses zero metres rather than reporting an infinite level', () => {
    // The inverse square law has a pole at the source. "Infinity dB" printed
    // on a service sheet is worse than a blank.
    expect(distanceChangeDb(1, 0)).toBeUndefined();
    expect(distanceChangeDb(0, 1)).toBeUndefined();
    expect(distanceChangeDb(1, -3)).toBeUndefined();
    expect(distanceChangeDb(Number.NaN, 1)).toBeUndefined();
  });
});

describe('splAtDistance', () => {
  it('drops a 100 dB sounder to hand-checkable levels', () => {
    expect(splAtDistance({ ...SOUNDER, distanceM: 1 })!.db).toBe(100);
    expect(splAtDistance({ ...SOUNDER, distanceM: 2 })!.db).toBe(94);
    expect(splAtDistance({ ...SOUNDER, distanceM: 4 })!.db).toBe(88);
    expect(splAtDistance({ ...SOUNDER, distanceM: 8 })!.db).toBe(81.9);
    expect(splAtDistance({ ...SOUNDER, distanceM: 10 })!.db).toBe(80);
  });

  it("honours a rating taken at three metres instead of assuming one", () => {
    // Loudspeaker sensitivity is not always published at 1 m. Reading a 3 m
    // figure as a 1 m figure overstates the level at every point by 9.5 dB,
    // which is the whole margin over ambient.
    const atThree = splAtDistance({ ratedDb: 96, referenceDistanceM: 3, distanceM: 6 })!;
    const assumedOne = splAtDistance({ ratedDb: 96, referenceDistanceM: 1, distanceM: 6 })!;
    expect(atThree.db).toBe(90);
    expect(assumedOne.db).toBe(80.4);
    expect(atThree.db - assumedOne.db).toBeGreaterThan(9);
  });

  it('warns when the listener is inside the distance the device was rated at', () => {
    const r = splAtDistance({ ...SOUNDER, distanceM: 0.5 })!;
    expect(r.db).toBe(106);
    expect(r.cautions.join(' ')).toContain('near field');
  });

  it('says plainly that a corridor is not free field', () => {
    // A corridor channels sound rather than radiating it. A tool that reports
    // a corridor the same way it reports an open floor is confidently wrong.
    const r = splAtDistance({ ...SOUNDER, distanceM: 15, space: 'corridor' })!;
    expect(r.cautions.join(' ')).toContain('not free field');
  });

  it('reports where the free-field assumption runs out indoors', () => {
    const near = splAtDistance({ ...SOUNDER, distanceM: FREE_FIELD_INDOOR_LIMIT_M, space: 'enclosed-room' })!;
    const far = splAtDistance({ ...SOUNDER, distanceM: FREE_FIELD_INDOOR_LIMIT_M + 5, space: 'enclosed-room' })!;
    expect(near.cautions).toHaveLength(0);
    expect(far.cautions.join(' ')).toContain('reverberant field');
  });

  it('returns nothing when the distance cannot be used', () => {
    expect(splAtDistance({ ...SOUNDER, distanceM: 0 })).toBeUndefined();
    expect(splAtDistance({ ratedDb: Number.NaN, referenceDistanceM: 1, distanceM: 4 })).toBeUndefined();
  });
});

describe('regimeCautions', () => {
  it('keeps quiet about an ordinary room at an ordinary distance', () => {
    expect(regimeCautions('enclosed-room', 5, 1)).toEqual([]);
  });

  it('still names the things free field ignores outdoors', () => {
    expect(regimeCautions('outdoors', 40, 1).join(' ')).toContain('air absorption');
  });
});

describe('addLevels', () => {
  it('makes two 85 dB sources 88 dB, not 170 dB', () => {
    // The single most consequential misunderstanding in this whole area. Two
    // sounders in a room are 3 dB louder than one, not twice as loud, and a
    // tool that adds them arithmetically will pass rooms that fail.
    expect(addLevels([85, 85])).toBe(88);
    expect(addLevels([85, 85])).not.toBe(170);
  });

  it('buys three decibels for every doubling of the number of sources', () => {
    expect(addLevels([85, 85, 85, 85])).toBe(91);
    expect(addLevels(new Array(8).fill(85))).toBe(94);
    // Ten sounders for 10 dB. This is why "add another sounder" is a far
    // weaker fix than it sounds when a room is 13 dB short.
    expect(addLevels(new Array(10).fill(85))).toBe(95);
  });

  it('shows a much quieter source adding nothing a meter could see', () => {
    expect(addLevels([90, 60])).toBe(90);
    expect(addLevels([90, 80])).toBe(90.4);
  });

  it('returns a single level unchanged', () => {
    expect(addLevels([85])).toBe(85);
  });

  it('refuses an empty list rather than calling silence zero decibels', () => {
    // 0 dB is a real level — roughly the threshold of hearing — not the
    // absence of one. Returning it for "no sources" would report a silent
    // room as being on the edge of audibility.
    expect(addLevels([])).toBeUndefined();
  });

  it('refuses a list containing something that is not a number', () => {
    expect(addLevels([85, Number.NaN])).toBeUndefined();
    expect(addLevels([85, Number.POSITIVE_INFINITY])).toBeUndefined();
  });
});

describe('signalPlusAmbient and removeAmbient', () => {
  it('shows that a total ten decibels over ambient is only a nine-and-a-half decibel signal', () => {
    // The trap. A meter running while the alarm sounds already contains the
    // ambient, so reading the difference off the meter overstates the margin.
    // Where the requirement is 10 dB, this half-decibel decides the result.
    expect(signalPlusAmbient(75, 65)).toBe(75.4);
    const signal = removeAmbient(75.4, 65);
    expect(signal.ok).toBe(true);
    expect(signal.db).toBe(75);
  });

  it('recovers the signal from a total and an ambient reading', () => {
    const r = removeAmbient(72, 70);
    expect(r.ok).toBe(true);
    expect(r.db).toBe(67.7);
  });

  it('cautions when the signal is close enough to ambient to be unstable', () => {
    expect(removeAmbient(72, 70).caution).toContain('approximate');
    expect(removeAmbient(90, 70).caution).toBeUndefined();
  });

  it('refuses a total at or below the ambient it is supposed to contain', () => {
    // Not a quiet alarm — a measurement that cannot be true. Silently
    // returning a very low number would hide a bad reading.
    const r = removeAmbient(70, 70);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cannot be at or below');
    expect(removeAmbient(68, 70).ok).toBe(false);
  });

  it('refuses two readings too close together to tell a signal from meter error', () => {
    const r = removeAmbient(70.5, 70);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('inside the tolerance');
    // And says why that refusal is itself the finding.
    expect(r.error).toContain('inaudible');
  });
});

describe('maxDistanceForLevel and requiredRatedDb', () => {
  it('puts the 80 dB contour of a 100 dB sounder at ten metres', () => {
    expect(maxDistanceForLevel(100, 1, 80)).toBe(10);
    expect(maxDistanceForLevel(100, 1, 65)).toBe(56.2);
    expect(maxDistanceForLevel(100, 1, 100)).toBe(1);
  });

  it('refuses a target louder than the device is rated at', () => {
    // The honest answer is a distance inside the near field, where the
    // arithmetic does not hold — and it would be read as a spacing figure.
    expect(maxDistanceForLevel(70, 1, 80)).toBeUndefined();
    expect(maxDistanceForLevel(100, 0, 80)).toBeUndefined();
  });

  it('sizes the replacement device for a bedhead behind a closed door', () => {
    // 75 dB(A) wanted at the bedhead, 8 m away, through a 20 dB door.
    expect(requiredRatedDb(75, 1, 8, 20)).toBe(113.1);
    expect(requiredRatedDb(75, 1, 8)).toBe(93.1);
  });

  it('returns nothing when the geometry cannot be used', () => {
    expect(requiredRatedDb(75, 1, 0, 20)).toBeUndefined();
  });
});

describe('barrier figures', () => {
  it('carries a source, a URL and a confidence on every figure', () => {
    for (const b of BARRIERS) {
      expect(b.lossDb.source.length).toBeGreaterThan(10);
      expect(b.lossDb.url).toMatch(/^https:\/\//);
      expect(b.lossDb.confidence).toBe('low');
    }
  });

  it('marks door losses as indicative British practice, not an Australian requirement', () => {
    // AS 1670 publishes no barrier figure. Presenting one as if it did would
    // put a fabricated requirement in front of a client.
    const door = barrier('closed-door')!;
    expect(door.lossDb.value).toBe(20);
    expect(door.lossDb.note).toContain('AS 1670 publishes no equivalent figure');
    expect(barrier('closed-fire-door')!.lossDb.value).toBe(30);
  });

  it('holds no figure at all for a wall, and says so by returning nothing', () => {
    expect(barrier('wall')).toBeUndefined();
    expect(barrier('glazed-partition')).toBeUndefined();
  });
});

describe('requirement thresholds', () => {
  it('sets a higher floor for a sleeping area than a normally occupied one', () => {
    expect(SPL_REQUIREMENTS['non-sleeping'].minimumDb.value).toBe(65);
    expect(SPL_REQUIREMENTS.sleeping.minimumDb.value).toBe(75);
  });

  it('carries a ceiling as well as a floor', () => {
    // A signal loud enough to hurt drives people away from it. Only checking
    // the floor would pass a device that fails for the opposite reason.
    expect(SPL_REQUIREMENTS['non-sleeping'].maximumDb!.value).toBe(105);
    expect(SPL_REQUIREMENTS.sleeping.maximumDb!.value).toBe(105);
  });

  it('requires the signal to sit ten decibels over the ambient', () => {
    expect(SPL_REQUIREMENTS['non-sleeping'].marginAboveAmbientDb!.value).toBe(10);
  });

  it('says the ambient is an average, not whatever the meter caught', () => {
    expect(SPL_REQUIREMENTS['non-sleeping'].ambientAveragingSeconds!.value).toBe(60);
  });

  it('says the bedhead reading is taken with the doors shut', () => {
    // An open-door reading passes rooms that fail at night, which is the only
    // time a sleeping-area requirement matters.
    expect(SPL_REQUIREMENTS.sleeping.measurementPoint).toContain('closed');
    expect(SPL_REQUIREMENTS.sleeping.measurementPoint).toContain('bedhead');
  });

  it('marks every figure taken from trade commentary as low confidence', () => {
    // These agree with each other and with every technician who quotes them,
    // but they are commentary on a standard rather than the standard. Calling
    // them verified would be a false statement about our own evidence.
    for (const req of Object.values(SPL_REQUIREMENTS)) {
      expect(req.minimumDb.confidence).toBe('low');
      expect(req.minimumDb.note).toContain('Confirm against a licensed copy');
      expect(req.maximumDb!.confidence).toBe('low');
    }
  });

  it('cites clause numbers and the publisher, and carries no clause text', () => {
    const req = SPL_REQUIREMENTS['non-sleeping'];
    expect(req.clauses.map((c) => `${c.standard} ${c.clause}`)).toEqual([
      'AS 1670.1:2018 3.22',
      'AS 1670.4:2018 4.7',
    ]);
    for (const c of req.clauses) expect(c.url).toContain('store.standards.org.au');
  });

  it('says how well each clause NUMBER is established, and never on the strength of the shop listing', () => {
    // A store product page proves the standard exists and nothing else. Citing
    // a clause number to a client on the strength of a shop listing is how the
    // wrong clause ends up in a report, so the number carries its own source.
    const [occupantWarning, loudspeakers] = SPL_REQUIREMENTS['non-sleeping'].clauses;

    // AS 1670.1 cl 3.22 is named by number in a Queensland government
    // publication, so this one is genuinely established.
    expect(occupantWarning!.numberConfidence).toBe('high');
    expect(occupantWarning!.numberSourceUrl).toContain('fire.qld.gov.au');

    // The loudspeaker output clause is not. Public references to the 2004
    // edition put it elsewhere and nothing free names it in the 2018 edition.
    expect(loudspeakers!.numberConfidence).toBe('low');
    expect(loudspeakers!.note).toContain('unconfirmed');
    for (const c of SPL_REQUIREMENTS['non-sleeping'].clauses) {
      expect(c.numberSourceUrl ?? '').not.toContain('store.standards.org.au');
    }
  });
});

describe('sole-occupancy unit door concession', () => {
  it('carries the Crown-published figures at high confidence', () => {
    // Read from QFES and the NCC themselves rather than from trade
    // commentary, which is why these are trusted where the AS figures are not.
    const alarms = SOU_DOOR_CONCESSIONS.find((c) => c.id === 'smoke-alarms')!;
    const detectors = SOU_DOOR_CONCESSIONS.find((c) => c.id === 'smoke-detectors')!;
    expect(alarms.atDoorDb.value).toBe(85);
    expect(detectors.atDoorDb.value).toBe(100);
    expect(alarms.atDoorDb.confidence).toBe('high');
    expect(alarms.atDoorDb.url).toContain('fire.qld.gov.au');
  });

  it('cites the concession at clause 7, not the clause 5 the QFES title refers to', () => {
    // The QFES statement is titled "…for NCC Specification E2.2a – clause 5"
    // because clause 5 is the system type it is arguing about. The concession
    // itself is clause 7(a) and (b). Citing clause 5 as the source of the 85
    // and 100 dB(A) figures points a client at the one clause QFES says the
    // concession does NOT reach.
    for (const c of SOU_DOOR_CONCESSIONS) {
      expect(c.atDoorDb.source).toContain('clause 7');
      expect(c.atDoorDb.source).not.toContain('clause 5');
    }
  });

  it("explains the Queensland position by the cross-reference it actually turns on", () => {
    // QFES' reasoning is specific and checkable: the concession is written for
    // a clause 4(b) install, a clause 5 system uses alarms instead of
    // detectors, so it never satisfies clause 4(b). "Not the arrangement it was
    // written for" is a paraphrase a client cannot check.
    expect(QFES_CONCESSION_POSITION).toContain('clause 4(b)');
    expect(QFES_CONCESSION_POSITION).toContain('clause 7(b)');
    expect(QFES_CONCESSION_POSITION).toContain('AS 1670.1 clause 3.22');
  });
});

describe('coverageVerdict', () => {
  it('passes an office ten metres from a 100 dB sounder', () => {
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.signalDb).toBe(80);
    expect(r.verdict).toBe('pass');
    expect(r.bindingThresholdDb).toBe(65);
    expect(r.headroomDb).toBe(15);
  });

  it('passes a signal that exactly meets the pass mark, and fails the one below it', () => {
    /*
     * Nought decibels of headroom is a pass. The threshold is what the signal
     * has to reach, so reaching it is compliance — and read a hair the other
     * way, a system designed exactly to the requirement is condemned and
     * somebody is quoted for sounders it does not need.
     *
     * 100 dB at a metre is 80 dB at ten. With 70 dB ambient and a 10 dB margin
     * the pass mark is exactly 80.
     */
    const exact = pass({ ...SOUNDER, distanceM: 10, ambientDb: 70, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(exact.bindingThresholdDb).toBe(80);
    expect(exact.headroomDb).toBe(0);
    expect(exact.verdict).toBe('pass');

    const short = pass({ ...SOUNDER, distanceM: 10, ambientDb: 71, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(short.headroomDb).toBeLessThan(0);
    expect(short.verdict).toBe('fail');
  });

  it('does not call a signal sitting exactly on the ceiling too loud', () => {
    /*
     * The ceiling exists because a signal loud enough to hurt drives people
     * towards the noise or away from the exit. A signal at the limit is at the
     * limit, not over it, and failing it there sends somebody quieting a
     * system that complies.
     */
    const atCeiling = pass({
      ratedDb: 105, referenceDistanceM: 1, distanceM: 1,
      ambientDb: 45, occupancy: 'non-sleeping', requiredMarginDb: 10,
    });
    expect(atCeiling.signalDb).toBe(105);
    expect(atCeiling.verdict).toBe('pass');

    const overIt = pass({
      ratedDb: 106, referenceDistanceM: 1, distanceM: 1,
      ambientDb: 45, occupancy: 'non-sleeping', requiredMarginDb: 10,
    });
    expect(overIt.verdict).toBe('fail');
  });

  it('says which of the two thresholds actually decided it', () => {
    // A room failing the 65 dB floor needs a louder device; a room failing the
    // margin needs the noise dealt with. Naming the wrong one sends a
    // technician to the wrong fix.
    const quiet = pass({ ...SOUNDER, distanceM: 10, ambientDb: 40, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(quiet.bindingReason).toContain('floor');

    const noisy = pass({ ...SOUNDER, distanceM: 10, ambientDb: 78, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(noisy.bindingReason).toContain('sets the pass mark');
    expect(noisy.bindingReason).toContain('less noise');
  });

  it('fails a plant room on the margin while it clears the floor by fifteen decibels', () => {
    // The case a floor-only check gets wrong: 80 dB(A) is comfortably over 65
    // and completely inaudible next to an 78 dB(A) compressor.
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 78, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.signalDb).toBe(80);
    expect(r.marginDb).toBe(2);
    expect(r.bindingThresholdDb).toBe(88);
    expect(r.headroomDb).toBe(-8);
    expect(r.verdict).toBe('fail');
  });

  it('reports the margin against the signal, not against the meter reading', () => {
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 70, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.signalDb).toBe(80);
    expect(r.marginDb).toBe(10);
    // What the meter would actually show, which is 10.4 dB over ambient.
    expect(r.measuredDb).toBe(80.4);
    expect(r.measuredDb - 70).not.toBeCloseTo(r.marginDb, 1);
  });

  it('turns a passing bedroom into a failing one the moment the door is shut', () => {
    // This is why a bathroom or ensuite with no device of its own is a real
    // finding rather than a pedantic one.
    const open = pass({ ...SOUNDER, distanceM: 8, ambientDb: 35, occupancy: 'sleeping', requiredMarginDb: 10 });
    expect(open.signalDb).toBe(81.9);
    expect(open.verdict).toBe('pass');

    const shut = pass({
      ...SOUNDER, distanceM: 8, ambientDb: 35, occupancy: 'sleeping', requiredMarginDb: 10,
      barrierIds: ['closed-door'],
    });
    expect(shut.barrierLossDb).toBe(20);
    expect(shut.signalDb).toBe(61.9);
    expect(shut.headroomDb).toBe(-13.1);
    expect(shut.verdict).toBe('fail');
  });

  it('holds a sleeping area to the higher floor even in a silent room', () => {
    const common = { ...SOUNDER, distanceM: 12, ambientDb: 30, requiredMarginDb: 10 } as const;
    const awake = pass({ ...common, occupancy: 'non-sleeping' });
    const asleep = pass({ ...common, occupancy: 'sleeping' });
    expect(awake.signalDb).toBe(78.4);
    expect(awake.verdict).toBe('pass');
    expect(asleep.bindingThresholdDb).toBe(75);
    expect(asleep.headroomDb).toBe(3.4);
  });

  it('adds a second device logarithmically rather than arithmetically', () => {
    const one = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    const two = pass({
      ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10,
      otherSourcesDb: [80],
    });
    expect(one.signalDb).toBe(80);
    expect(two.signalDb).toBe(83);
  });

  it('fails a device that is too loud rather than only checking the floor', () => {
    const r = pass({ ratedDb: 120, referenceDistanceM: 1, distanceM: 1, ambientDb: 50, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.tooLoud).toBe(true);
    expect(r.verdict).toBe('fail');
    expect(r.headroomDb).toBeGreaterThan(0);
    expect(r.cautions.join(' ')).toContain('ceiling');
  });

  it('refuses the whole calculation rather than skipping a barrier it has no figure for', () => {
    // Skipping it would silently inflate the level by whatever it would have
    // taken off, which is the failure that puts a pass on a room that fails.
    const r = coverageVerdict({
      ...SOUNDER, distanceM: 8, ambientDb: 35, occupancy: 'sleeping', requiredMarginDb: 10,
      barrierIds: ['brick-wall'],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toContain('No attenuation figure');
    expect(r.error).toContain('Measure through it instead');
  });

  it('refuses an unreadable second source rather than quietly leaving it out', () => {
    // The mirror image of the unknown barrier. A dropped source lowers the
    // answer instead of raising it, but nothing on screen says a device the
    // technician listed has gone missing from the sum.
    const r = coverageVerdict({
      ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10,
      otherSourcesDb: [80, Number.NaN],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toContain('not a source of zero');
  });

  it('does not let rounding to the tenth of a decibel turn a shortfall into a pass', () => {
    // 92 dB(A) at 3.001 m is 82.4959… dB, four hundredths under a 82.5 dB pass
    // mark. Rounded to the tenth first it becomes 82.5 and the room passes on
    // the display format rather than on the sound in it.
    const r = pass({
      ratedDb: 92, referenceDistanceM: 1, distanceM: 3.001,
      ambientDb: 72.5, occupancy: 'non-sleeping', requiredMarginDb: 10,
    });
    expect(r.bindingThresholdDb).toBe(82.5);
    expect(r.verdict).toBe('fail');
    // And the headroom shown agrees with the verdict rather than reading 0.0.
    expect(r.headroomDb).toBeLessThan(0);
  });

  it('rounds real headroom down, never up', () => {
    // A tenth of a decibel of invented headroom is not worth having; a tenth
    // of invented shortfall costs nothing. So the rounding only ever goes one
    // way, and an exact figure is left exactly where it is.
    const exact = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(exact.headroomDb).toBe(15);
  });

  it('says both thresholds decide it when the ambient and margin land on the floor', () => {
    // 55 dB(A) ambient plus a 10 dB margin is exactly the 65 dB(A) floor. The
    // old wording claimed the floor sat "above" a figure identical to it.
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.bindingThresholdDb).toBe(65);
    expect(r.bindingReason).toContain('same number');
    expect(r.bindingReason).not.toContain('above the');
  });

  it('refuses a negative margin, which would let a signal quieter than ambient pass', () => {
    const r = coverageVerdict({ ...SOUNDER, distanceM: 8, ambientDb: 35, occupancy: 'non-sleeping', requiredMarginDb: -5 });
    expect(r.ok).toBe(false);
  });

  it('refuses a listening position at the device itself', () => {
    const r = coverageVerdict({ ...SOUNDER, distanceM: 0, ambientDb: 35, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toContain('inverse square law');
  });

  it('refuses a missing input rather than treating it as zero', () => {
    const r = coverageVerdict({ ...SOUNDER, distanceM: 8, ambientDb: Number.NaN, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.ok).toBe(false);
  });

  it('warns when the technician holds the system to less than the margin understood to apply', () => {
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 5 });
    expect(r.cautions.join(' ')).toContain('below the 10 dB');
    expect(r.cautions.join(' ')).toContain('against your figure');
  });

  it('carries the confidence of its own pass mark into every verdict', () => {
    // A pass decided against an unverified threshold is not the same thing as
    // a pass, and the report has to be able to tell the difference.
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.thresholdConfidence).toBe('low');
    expect(r.cautions.join(' ')).toContain('licensed copy');
  });

  it('states on every result that this is not an acoustic assessment', () => {
    // The same discipline the effectiveness report uses. A number produced by
    // arithmetic must never be read as a measurement or a compliance finding.
    const r = pass({ ...SOUNDER, distanceM: 10, ambientDb: 55, occupancy: 'non-sleeping', requiredMarginDb: 10 });
    expect(r.disclaimer).toBe(NOT_AN_ACOUSTIC_ASSESSMENT);
    expect(r.disclaimer).toContain('not a verification of compliance');
  });

  it('reminds a sleeping-area check that the doors have to be shut', () => {
    const r = pass({ ...SOUNDER, distanceM: 8, ambientDb: 35, occupancy: 'sleeping', requiredMarginDb: 10 });
    expect(r.cautions.join(' ')).toContain('bedhead');
  });

  it('names the barrier figure and its source in the cautions it returns', () => {
    const r = pass({
      ...SOUNDER, distanceM: 8, ambientDb: 35, occupancy: 'sleeping', requiredMarginDb: 10,
      barrierIds: ['closed-door'],
    });
    expect(r.cautions.join(' ')).toContain('Apollo');
    expect(r.cautions.join(' ')).toContain('indicative');
  });
});

describe('sourceList', () => {
  it('gives every published figure a source, a URL and a confidence', () => {
    const list = sourceList();
    expect(list.length).toBeGreaterThan(8);
    for (const row of list) {
      expect(row.fact.length).toBeGreaterThan(0);
      expect(row.source.length).toBeGreaterThan(10);
      expect(row.url).toMatch(/^https:\/\//);
      expect(['high', 'medium', 'low']).toContain(row.confidence);
    }
  });

  it('trusts the Queensland regulator further than it trusts trade commentary', () => {
    const list = sourceList();
    const qfes = list.filter((r) => r.url.includes('fire.qld.gov.au'));
    const trade = list.filter((r) => r.url.includes('firewize'));
    expect(qfes.length).toBeGreaterThan(0);
    expect(trade.length).toBeGreaterThan(0);
    expect(qfes.every((r) => r.confidence === 'high')).toBe(true);
    expect(trade.every((r) => r.confidence === 'low')).toBe(true);
  });
});
