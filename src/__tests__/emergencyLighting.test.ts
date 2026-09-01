import {
  BATTERY_DESIGN_LIFE_YEARS,
  KNOWN_CLASSIFICATIONS,
  MAX_TABULATED_PICTOGRAM_MM,
  MINIMUM_DURATION_MINUTES,
  MIN_TABULATED_PICTOGRAM_MM,
  OUTCOME_LABEL,
  SOURCES,
  SPACING_02_LUX,
  TABULATED_HEIGHTS_M,
  assessDischarge,
  batteryAdvice,
  batteryAge,
  checkSignPlacement,
  citeSources,
  classify,
  exitSignViewingDistance,
  formatAuDate,
  maxSpacing,
  parseAuDate,
  requiredDuration,
  spacingSenseCheck,
  strictestReading,
  summariseSite,
  type DischargeInput,
  type FittingResult,
  type SignIllumination,
  type ViewingDistance,
} from '@/domain/emergencyLighting';

/**
 * Emergency lighting — a third of the asset book, and until now no logic at all.
 *
 * What is asserted here is mostly about refusing. The failures that cost money
 * on this system are not arithmetic errors; they are a shortened test written
 * up as a pass, a dead fitting quoted as a flat battery, a whole site called
 * compliant because the fittings someone could reach were fine, and a spacing
 * figure read off the wrong edition of the standard. Every one of those has a
 * test below that fails if the module ever starts guessing.
 */

const TODAY = new Date('2026-09-01T00:00:00Z');

/** A test run to the end, where the fitting illuminated and then went out. */
const ranFull = (minutes: number): DischargeInput => ({ achievedMinutes: minutes, ending: 'extinguished' });

describe('requiredDuration', () => {
  it("uses the fitting's own rating when the register has one", () => {
    const r = requiredDuration(120);
    expect(r.minutes).toBe(120);
    expect(r.fromRating).toBe(true);
  });

  it('falls back to the code minimum but says loudly that it has', () => {
    // 90 minutes is a floor, not a specification. A fitting rated 120 that is
    // only held to 90 will be signed off short, so the note has to travel.
    const r = requiredDuration(undefined);
    expect(r.minutes).toBe(MINIMUM_DURATION_MINUTES);
    expect(r.fromRating).toBe(false);
    expect(r.note).toContain('Rated duration not recorded');
    expect(r.note).toContain('re-assess');
  });

  it('treats a nonsense rating as no rating rather than using it', () => {
    expect(requiredDuration(0).fromRating).toBe(false);
    expect(requiredDuration(-30).fromRating).toBe(false);
    expect(requiredDuration(Number.NaN).fromRating).toBe(false);
  });

  it('will not let a rating below the code minimum lower what the fitting has to achieve', () => {
    // A rating only ever raises the bar. Held to a 30-minute label, a fitting
    // that ran 35 minutes reads as a pass on a life safety system that is
    // required to hold ninety, and the report says so in writing.
    const r = requiredDuration(30);
    expect(r.minutes).toBe(MINIMUM_DURATION_MINUTES);
    expect(r.fromRating).toBe(false);
    expect(r.note).toContain('below the');
    expect(assessDischarge({ achievedMinutes: 35, ending: 'extinguished', ratedMinutes: 30 }).outcome)
      .toBe('failed-early');
  });
});

describe('assessDischarge — the three ways a test can end well', () => {
  it('passes a fitting that held the full duration with reserve to spare', () => {
    const v = assessDischarge(ranFull(104));
    expect(v.outcome).toBe('pass');
    expect(v.passed).toBe(true);
    expect(v.marginMinutes).toBe(14);
    expect(v.percentOfRequired).toBeCloseTo(115.6, 1);
    expect(v.defectCode).toBeUndefined();
  });

  it('calls a pass with almost no reserve marginal rather than clean', () => {
    // A battery that dies at 92 minutes of a 90 minute test is not a defect
    // today and will be one in six months. Recording it as a plain pass is how
    // a return visit gets bought at defect rates instead of scheduled rates.
    const v = assessDischarge(ranFull(92));
    expect(v.outcome).toBe('marginal-pass');
    expect(v.passed).toBe(true);
    expect(v.marginMinutes).toBe(2);
    expect(v.rectification).toContain('before the next service');
  });

  it('counts exactly the required duration as marginal, not comfortable', () => {
    const v = assessDischarge(ranFull(90));
    expect(v.outcome).toBe('marginal-pass');
    expect(v.passed).toBe(true);
    expect(v.marginMinutes).toBe(0);
  });

  it('passes a test that was ended while the fitting was still lit past the duration', () => {
    // The technician came back at 95 minutes and it was still going. That is a
    // pass, and the reserve beyond it is honestly recorded as unknown.
    const v = assessDischarge({ achievedMinutes: 95, ending: 'still-lit' });
    expect(v.outcome).toBe('pass');
    expect(v.passed).toBe(true);
    expect(v.notes.join(' ')).toContain('reserve beyond this point is unknown');
  });
});

describe('assessDischarge — the two failures are not the same failure', () => {
  it('reports a fitting that lit and went out early as a battery at end of life', () => {
    const v = assessDischarge(ranFull(62));
    expect(v.outcome).toBe('failed-early');
    expect(v.passed).toBe(false);
    expect(v.marginMinutes).toBe(-28);
    expect(v.defectCode).toBe('EEL-FIT-001');
    expect(v.statement).toContain('28 minutes short');
  });

  it('reports a fitting that never lit as a different defect with a different fix', () => {
    // The whole point of separating these two. Quoting a battery for a fitting
    // whose lamp is dead buys a part that does not fix it, and quoting a
    // fitting for a flat battery is four times the price it needed to be.
    const v = assessDischarge({ achievedMinutes: 0, ending: 'never-lit' });
    expect(v.outcome).toBe('no-illumination');
    expect(v.passed).toBe(false);
    expect(v.defectCode).toBe('EEL-FIT-002');
    expect(v.rectification).toContain('Not a battery at end of life');
    expect(v.rectification).toContain('normal supply was actually removed');
  });

  it('gives the two failures different defect codes, so the quote differs too', () => {
    expect(assessDischarge(ranFull(10)).defectCode)
      .not.toBe(assessDischarge({ achievedMinutes: 0, ending: 'never-lit' }).defectCode);
  });
});

describe('assessDischarge — refusals', () => {
  it('refuses to call a test stopped early either a pass or a fail', () => {
    // The single most common shortcut on site: an hour is not ninety minutes,
    // and "it was still on when I left" proves the fitting lasts at least an
    // hour and absolutely nothing else.
    const v = assessDischarge({ achievedMinutes: 60, ending: 'still-lit' });
    expect(v.outcome).toBe('inconclusive');
    expect(v.passed).toBeUndefined();
    expect(v.reason).toContain('has not passed and it has not failed');
  });

  it('leaves passed undefined rather than false wherever there is no verdict', () => {
    // A caller writing `if (!v.passed) raiseDefect()` must not manufacture a
    // defect out of a test that was never finished, and a caller writing
    // `if (v.passed)` must not manufacture a pass. Undefined does both.
    for (const input of [
      { achievedMinutes: 60, ending: 'still-lit' } as const,
      { achievedMinutes: Number.NaN, ending: 'extinguished' } as const,
      { achievedMinutes: 5000, ending: 'extinguished' } as const,
    ]) {
      expect(assessDischarge(input).passed).toBeUndefined();
    }
  });

  it('refuses a duration that is not a number of minutes', () => {
    const v = assessDischarge({ achievedMinutes: Number.NaN, ending: 'extinguished' });
    expect(v.outcome).toBe('unreadable');
    expect(v.reason).toContain('not a duration');
  });

  it('refuses a negative duration instead of taking its magnitude', () => {
    expect(assessDischarge({ achievedMinutes: -90, ending: 'extinguished' }).outcome).toBe('unreadable');
  });

  it('refuses a duration longer than a day, because that is a transcription error', () => {
    // 5400 is ninety minutes in seconds typed into a minutes box. Accepting it
    // would print a fitting that ran for three and a half days.
    const v = assessDischarge({ achievedMinutes: 5400, ending: 'extinguished' });
    expect(v.outcome).toBe('unreadable');
    expect(v.reason).toContain('seconds');
  });

  it('refuses a fitting that "extinguished" after no time at all rather than calling it a flat battery', () => {
    // Zero minutes and a lamp that went out cannot both be true. Read as a
    // failed discharge it raises the battery defect against a fitting whose
    // lamp is dead — the exact confusion this module exists to stop — so it is
    // sent back to be recorded as never illuminated instead.
    const v = assessDischarge({ achievedMinutes: 0, ending: 'extinguished' });
    expect(v.outcome).toBe('unreadable');
    expect(v.passed).toBeUndefined();
    expect(v.defectCode).toBeUndefined();
    expect(v.reason).toContain('never came on');
    expect(assessDischarge({ achievedMinutes: 0, ending: 'still-lit' }).outcome).toBe('unreadable');
  });

  it('refuses a record that says the fitting never lit and also ran for an hour', () => {
    const v = assessDischarge({ achievedMinutes: 60, ending: 'never-lit' });
    expect(v.outcome).toBe('unreadable');
    expect(v.statement).toContain('contradicts itself');
    expect(v.reason).toContain('One of the two is wrong');
  });

  it('names every outcome, so nothing can reach a report as a raw enum', () => {
    for (const key of Object.keys(OUTCOME_LABEL)) {
      expect(OUTCOME_LABEL[key as keyof typeof OUTCOME_LABEL].length).toBeGreaterThan(0);
    }
    expect(OUTCOME_LABEL.inconclusive).toContain('No verdict');
  });
});

describe('assessDischarge — the rated duration is what a fitting is held to', () => {
  it('fails a 120-minute fitting that only reached 100, which a 90-minute floor would pass', () => {
    expect(assessDischarge({ achievedMinutes: 100, ending: 'extinguished' }).outcome).toBe('pass');
    expect(assessDischarge({ achievedMinutes: 100, ending: 'extinguished', ratedMinutes: 120 }).outcome)
      .toBe('failed-early');
  });

  it('carries the "rating not recorded" note into the verdict, not just the lookup', () => {
    const v = assessDischarge(ranFull(120));
    expect(v.requiredFromRating).toBe(false);
    expect(v.notes.join(' ')).toContain('code minimum');
  });
});

describe('classify', () => {
  it("warns that a non-sustained fitting cannot be checked by looking at it", () => {
    // The register is full of "condition OK" against fittings that are dark by
    // design. That entry means nothing without a discharge test and the app has
    // to say so rather than let it read as a check.
    const p = classify({ supply: 'single-point', mode: 'non-sustained', role: 'emergency-luminaire' });
    expect(p.visibleFailureOnNormalSupply).toBe(false);
    expect(p.cautions.join(' ')).toContain('cannot be checked by looking at it');
  });

  it('knows a sustained fitting shows its own failure on a walk-through', () => {
    const p = classify({ supply: 'single-point', mode: 'sustained', role: 'exit-sign' });
    expect(p.visibleFailureOnNormalSupply).toBe(true);
  });

  it('refuses to let a battery defect be raised against a centrally-supplied luminaire', () => {
    // It has no battery in it. A quote for one is a quote for a part that is
    // not there, and the real fault is in a plant room somewhere else.
    const p = classify({ supply: 'centrally-supplied', mode: 'non-sustained', role: 'emergency-luminaire' });
    expect(p.commonModeFailureRisk).toBe(true);
    expect(p.cautions.join(' ')).toContain('has no battery');
    expect(p.isolationPoint).toContain('Not at the fitting');
  });

  it('puts the isolation point at the fitting for a single-point unit and at the plant for a central one', () => {
    const single = classify({ supply: 'single-point', mode: 'non-sustained', role: 'emergency-luminaire' });
    const central = classify({ supply: 'centrally-supplied', mode: 'non-sustained', role: 'emergency-luminaire' });
    expect(single.isolationPoint).toContain('own test facility');
    expect(central.isolationPoint).toContain('central emergency lighting unit');
  });

  it('adds the legend and direction check for anything that is a sign', () => {
    const sign = classify({ supply: 'single-point', mode: 'sustained', role: 'combined' });
    expect(sign.whatIsTested.join(' ')).toContain('path of travel');
    expect(sign.howAFailureIsRectified.join(' ')).toContain('no amount of battery work fixes it');
  });

  it('does not add the legend check to a plain emergency luminaire', () => {
    const lum = classify({ supply: 'single-point', mode: 'non-sustained', role: 'emergency-luminaire' });
    expect(lum.whatIsTested.join(' ')).not.toContain('path of travel');
  });
});

describe('exitSignViewingDistance', () => {
  it('reads the sourced bands rather than a ratio, and shows both publications', () => {
    // Legrand Australia and Hochiki Australia both publish 100 mm as a 16 m
    // sign, 150 mm as 24 m and 200 mm as 32 m. Two independent manufacturers
    // agreeing is the only corroboration available for a table this app may not
    // reproduce, so both readings are carried rather than collapsed into one.
    const r = exitSignViewingDistance({ pictogramHeightMm: 150, illumination: 'internally-illuminated' });
    expect(r.known).toBe(true);
    const known = r as ViewingDistance;
    expect(known.maxViewingDistanceM).toBe(24);
    expect(known.candidates.map((c) => c.sourceId)).toEqual(['legrand-exit-viewing', 'hochiki-as2293']);
    expect(known.sourcesAgree).toBe(true);
  });

  it('reads a size between two bands down to its band, not up a straight line', () => {
    // The one that a ratio gets wrong. A 120 mm element is a 16 m sign in both
    // catalogues; multiplying 120 by 160 hands back 19.2 m and puts the sign
    // three metres further from the exit than either publication allows.
    const r = exitSignViewingDistance({ pictogramHeightMm: 120, illumination: 'internally-illuminated' }) as ViewingDistance;
    expect(r.maxViewingDistanceM).toBe(16);
    expect(r.notes.join(' ')).toContain('band, not a ratio');
  });

  it('lands on the sizes signs are actually made in', () => {
    // 100, 150, 200 and 250 mm are the four decal sizes on the market. Both
    // sources print their bands with a strict inequality at each end, which
    // would leave all four in no band at all; they are read inclusive at the
    // lower bound. If this ever stops matching the catalogue the bands have
    // been read the wrong way round.
    const at = (mm: number) =>
      (exitSignViewingDistance({ pictogramHeightMm: mm, illumination: 'internally-illuminated' }) as ViewingDistance)
        .maxViewingDistanceM;
    expect([at(100), at(150), at(200), at(250)]).toEqual([16, 24, 32, 40]);
  });

  it('names a manufacturer publication for every reading, and says the standard governs', () => {
    const r = exitSignViewingDistance({ pictogramHeightMm: 200, illumination: 'internally-illuminated' }) as ViewingDistance;
    expect(r.candidates.every((c) => c.confidence === 'medium')).toBe(true);
    expect(r.governing).toContain('Table 5.1');
    expect(r.notes.join(' ')).toContain("manufacturers' own guides");
  });

  it('refuses an externally illuminated sign rather than borrow a British multiplier', () => {
    // The only factor available for these comes from UK guidance describing
    // BS 5266 and ISO 3864. Applying it here would be presenting a different
    // country's standard as if it were AS/NZS 2293.1.
    const r = exitSignViewingDistance({ pictogramHeightMm: 150, illumination: 'externally-illuminated' });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.reason).toContain('BS 5266');
    expect(r.whatToDo).toContain('Table 5.1');
  });

  it('refuses a sign type it has never heard of instead of answering as though it were internal', () => {
    // Nothing in the type system stops a sign type arriving off a register, and
    // the internally illuminated answer is the most generous of the three. A
    // silent fall-through would put an externally illuminated sign at twice the
    // distance the standard allows.
    const r = exitSignViewingDistance({
      pictogramHeightMm: 150,
      illumination: 'fluorescent' as unknown as SignIllumination,
    });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.reason).toContain('fluorescent');
  });

  it('holds a photoluminescent sign to the regulator’s 24 m ceiling once its size passes it', () => {
    const big = exitSignViewingDistance({ pictogramHeightMm: 400, illumination: 'photoluminescent' }) as ViewingDistance;
    expect(big.maxViewingDistanceM).toBe(24);
    expect(big.cappedBy).toContain('Clause 5');
    expect(big.notes[0]).toContain('ceiling is not a permission');
  });

  it('does not hand a small photoluminescent sign the 24 m cap as though it earned it', () => {
    // The cap is a ceiling on the Table 5.1 distance, not a grant of one. A
    // 200 mm photoluminescent element counts as 153.8 mm once Clause 4(b)'s
    // 1.3 factor is taken off it, which is a 24 m sign; a 150 mm element counts
    // as 115.4 mm, which is a 16 m sign. Answering 24 m for the second would
    // put it eight metres further from the exit than it can be read from.
    const at200 = exitSignViewingDistance({ pictogramHeightMm: 200, illumination: 'photoluminescent' }) as ViewingDistance;
    const at150 = exitSignViewingDistance({ pictogramHeightMm: 150, illumination: 'photoluminescent' }) as ViewingDistance;
    expect(at200.maxViewingDistanceM).toBe(24);
    expect(at150.maxViewingDistanceM).toBe(16);
    expect(at150.cappedBy).toBeUndefined();
  });

  it('reads from closer than an internally illuminated sign of exactly the same size', () => {
    // Which is the whole point of the 1.3 rule, and the thing a technician
    // swapping one sign type for another gets wrong.
    const pl = exitSignViewingDistance({ pictogramHeightMm: 200, illumination: 'photoluminescent' }) as ViewingDistance;
    const internal = exitSignViewingDistance({ pictogramHeightMm: 200, illumination: 'internally-illuminated' }) as ViewingDistance;
    expect(pl.maxViewingDistanceM).toBeLessThan(internal.maxViewingDistanceM);
  });

  it('says what it still cannot check about a photoluminescent sign', () => {
    const r = exitSignViewingDistance({ pictogramHeightMm: 300, illumination: 'photoluminescent' }) as ViewingDistance;
    expect(r.notes.join(' ')).toContain('1.3');
    expect(r.notes.join(' ')).toContain('100 lux');
    expect(r.notes.join(' ')).toContain('15 mm');
  });

  it('refuses a photoluminescent sign too small to survive the 1.3 derating', () => {
    // 100 mm of photoluminescent element is 76.9 mm of Table 5.1 element, which
    // is below anything either catalogue bands. The old answer here was 24 m.
    const r = exitSignViewingDistance({ pictogramHeightMm: 100, illumination: 'photoluminescent' });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.reason).toContain('76.9 mm');
    expect(r.whatToDo).toContain('130 mm');
  });

  it('refuses a pictogram smaller than any band it has, instead of extrapolating a straight line', () => {
    const r = exitSignViewingDistance({ pictogramHeightMm: 60, illumination: 'internally-illuminated' });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.reason).toContain(`${MIN_TABULATED_PICTOGRAM_MM} mm`);
  });

  it('refuses a pictogram above the top band rather than continuing a formula neither source prints', () => {
    const r = exitSignViewingDistance({ pictogramHeightMm: 350, illumination: 'internally-illuminated' });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.reason).toContain(`${MAX_TABULATED_PICTOGRAM_MM} mm`);
    expect(r.whatToDo).toContain('printed on the sign face');
  });

  it('answers with the strictest reading wherever two publications differ', () => {
    // Today both manufacturers agree band for band, so nothing in the bands
    // themselves can prove this rule holds. It is the rule the whole section
    // turns on — a sign inside the strictest reading is inside every reading —
    // so it is asserted directly rather than left to a future disagreement.
    const readings = [
      { maxViewingDistanceM: 30, reading: 'generous', sourceId: 'hochiki-as2293' as const, confidence: 'low' as const },
      { maxViewingDistanceM: 24, reading: 'strict', sourceId: 'legrand-exit-viewing' as const, confidence: 'low' as const },
    ];
    expect(strictestReading(readings)).toBe(24);
    expect(strictestReading([])).toBeUndefined();
  });

  it('refuses a height that is not a measurement', () => {
    for (const h of [0, -150, Number.NaN, 5000]) {
      expect(exitSignViewingDistance({ pictogramHeightMm: h, illumination: 'internally-illuminated' }).known)
        .toBe(false);
    }
  });
});

describe('checkSignPlacement', () => {
  const sign = exitSignViewingDistance({
    pictogramHeightMm: 150,
    illumination: 'internally-illuminated',
  }) as ViewingDistance;

  it('passes a sign inside the strictest reading', () => {
    const c = checkSignPlacement(20, sign);
    if (!c.known) throw new Error('expected a check');
    expect(c.verdict).toBe('within');
    expect(c.statement).toContain('on every reading');
  });

  it('fails a sign outside the most generous reading', () => {
    const c = checkSignPlacement(35, sign);
    if (!c.known) throw new Error('expected a check');
    expect(c.verdict).toBe('exceeds');
    expect(c.statement).toContain('A larger sign, or a second sign');
  });

  it('fails a sign at 27 m rather than declining to call it', () => {
    // This used to answer "uncertain" because a second, unsourced reading of
    // Table 5.1 put a 150 mm sign at 30 m. No Australian publication supports
    // that, and both that do put it at 24 m, so 27 m is simply too far.
    const c = checkSignPlacement(27, sign);
    if (!c.known) throw new Error('expected a check');
    expect(c.verdict).toBe('exceeds');
  });

  it('still says "I do not know" where the readings behind a sign disagree', () => {
    // Kept reachable on purpose. Today both manufacturers agree band for band;
    // the moment a third reading is added that does not, a sign in the disputed
    // range has to be reported as unsettled rather than called either way.
    const disputed = {
      ...sign,
      candidates: [sign.candidates[0]!, { ...sign.candidates[0]!, maxViewingDistanceM: 30 }],
      sourcesAgree: false,
    };
    const c = checkSignPlacement(27, disputed);
    if (!c.known) throw new Error('expected a check');
    expect(c.verdict).toBe('uncertain');
    expect(c.reason).toContain('will not call it either way');
  });

  it('refuses a sign carrying no readings at all rather than calling everything within', () => {
    // Math.min of an empty list is Infinity, and "within the Infinity m limit"
    // is how a sign at the far end of a warehouse passes.
    const empty = { ...sign, candidates: [] };
    expect(checkSignPlacement(999, empty).known).toBe(false);
  });

  it('has no uncertain band on a photoluminescent sign, where the cap is a regulator’s', () => {
    const pl = exitSignViewingDistance({ pictogramHeightMm: 260, illumination: 'photoluminescent' }) as ViewingDistance;
    expect(checkSignPlacement(23.9, pl)).toMatchObject({ verdict: 'within' });
    expect(checkSignPlacement(24.1, pl)).toMatchObject({ verdict: 'exceeds' });
  });

  it('refuses a distance that is not a distance', () => {
    expect(checkSignPlacement(0, sign).known).toBe(false);
    expect(checkSignPlacement(Number.NaN, sign).known).toBe(false);
  });
});

describe('maxSpacing', () => {
  it("matches a second manufacturer's worked example exactly", () => {
    // ABB/Stanilite publish a D40 fitting at 3 m spacing at 18.6 m under the
    // 2005 edition. Clevertronics' table says the same. Two independent makers
    // agreeing is the only corroboration available without the standard itself.
    expect(maxSpacing('D40', 3, '2005')).toBe(18.6);
  });

  it('gives a materially different answer for the two editions of the standard', () => {
    // 22.0 m against 13.2 m for the same fitting at the same height. Defaulting
    // the edition would put fittings eight metres too far apart.
    expect(maxSpacing('D80', 2.4, '2005')).toBe(22.0);
    expect(maxSpacing('D80', 2.4, '2018')).toBe(13.2);
  });

  it('shows that under the 2018 edition a brighter fitting buys nothing low down', () => {
    // Every class clamps to the same figure below about 3.6 m, which is exactly
    // the assumption a like-for-like upgrade gets wrong.
    const at21 = KNOWN_CLASSIFICATIONS.map((c) => maxSpacing(c, 2.1, '2018'));
    expect(new Set(at21).size).toBe(1);
    expect(at21[0]).toBe(11.5);
  });

  it('returns nothing for a height between two rows rather than interpolating', () => {
    expect(maxSpacing('D40', 2.5, '2018')).toBeUndefined();
    expect(maxSpacing('D40', 12, '2018')).toBeUndefined();
  });

  it('returns nothing for a classification it has no data for', () => {
    expect(maxSpacing('C25', 3, '2018')).toBeUndefined();
    expect(maxSpacing('', 3, '2018')).toBeUndefined();
  });

  it('accepts the classification however the datasheet cases it', () => {
    expect(maxSpacing('d40', 3, '2005')).toBe(18.6);
    expect(maxSpacing(' D40 ', 3, '2005')).toBe(18.6);
  });

  it('carries a spacing figure for every height in every row, with no gaps', () => {
    for (const row of SPACING_02_LUX) {
      expect(row.maxSpacingM).toHaveLength(TABULATED_HEIGHTS_M.length);
      expect(row.maxSpacingM.every((v) => v > 0)).toBe(true);
    }
  });
});

describe('spacingSenseCheck', () => {
  const base = {
    mountingHeightM: 3,
    classification: 'D40',
    edition: '2018' as const,
  };

  it('calls out a warehouse with nowhere near enough fittings', () => {
    // 40 m by 30 m at a D40 maximum spacing of 16.5 m needs a 3 by 2 grid.
    // Four fittings is the kind of thing a technician should put in a report.
    const r = spacingSenseCheck({ ...base, roomLengthM: 40, roomWidthM: 30, installedCount: 4 });
    if (!r.known) throw new Error('expected a result');
    expect(r.maxSpacingM).toBe(16.5);
    expect(r.alongLength).toBe(3);
    expect(r.alongWidth).toBe(2);
    expect(r.expectedMinimumCount).toBe(6);
    expect(r.plausible).toBe(false);
    expect(r.shortfall).toBe(2);
  });

  it('accepts a count that meets the grid', () => {
    const r = spacingSenseCheck({ ...base, roomLengthM: 40, roomWidthM: 30, installedCount: 6 });
    if (!r.known) throw new Error('expected a result');
    expect(r.plausible).toBe(true);
    expect(r.shortfall).toBe(0);
  });

  it('never returns without saying it is not a design calculation', () => {
    // The disclaimer lives in the data so no screen or report can drop it on
    // the way out. This app must never be mistaken for a design tool.
    const r = spacingSenseCheck({ ...base, roomLengthM: 20, roomWidthM: 10, installedCount: 2 });
    if (!r.known) throw new Error('expected a result');
    expect(r.isSenseCheckNotDesign).toBe(true);
    expect(r.caveats[0]).toContain('not a lighting design');
    expect(r.caveats.join(' ')).toContain('1 lux');
    expect(r.caveats.join(' ')).toContain('within 2 m of exit doors');
  });

  it('flags a fitting covering more floor than one luminaire may serve', () => {
    const r = spacingSenseCheck({
      ...base, edition: '2005', roomLengthM: 60, roomWidthM: 40, installedCount: 3,
    });
    if (!r.known) throw new Error('expected a result');
    expect(r.areaPerFittingM2).toBe(800);
    expect(r.caveats.join(' ')).toContain('500 m² per luminaire');
  });

  it('refuses a mounting height that is not tabulated instead of interpolating one', () => {
    const r = spacingSenseCheck({ ...base, mountingHeightM: 2.55, roomLengthM: 20, roomWidthM: 10, installedCount: 2 });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.whatToDo).toContain('will not interpolate');
    expect(r.reason).toContain('2.55');
  });

  it('refuses a classification it has no data for and says which it has', () => {
    const r = spacingSenseCheck({ ...base, classification: 'B16', roomLengthM: 20, roomWidthM: 10, installedCount: 2 });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.whatToDo).toContain('D25');
    expect(r.whatToDo).toContain('0.2 lux');
  });

  it('refuses an edition it has no data for rather than picking the newer one', () => {
    const r = spacingSenseCheck({
      ...base,
      edition: '1998' as unknown as '2018',
      roomLengthM: 20,
      roomWidthM: 10,
      installedCount: 2,
    });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.whatToDo).toContain('nine metres');
  });

  it('refuses room dimensions and counts that are not measurements', () => {
    expect(spacingSenseCheck({ ...base, roomLengthM: 0, roomWidthM: 10, installedCount: 2 }).known).toBe(false);
    expect(spacingSenseCheck({ ...base, roomLengthM: 20, roomWidthM: -5, installedCount: 2 }).known).toBe(false);
    expect(spacingSenseCheck({ ...base, roomLengthM: 20, roomWidthM: 10, installedCount: 1.5 }).known).toBe(false);
  });

  it('handles a room with no fittings in it at all without dividing by zero', () => {
    const r = spacingSenseCheck({ ...base, roomLengthM: 20, roomWidthM: 10, installedCount: 0 });
    if (!r.known) throw new Error('expected a result');
    expect(r.plausible).toBe(false);
    expect(Number.isFinite(r.areaPerFittingM2)).toBe(true);
  });
});

describe('parseAuDate', () => {
  it('reads d/m/yyyy the Australian way', () => {
    expect(parseAuDate('4/12/2020')).toEqual({ y: 2020, m: 12, d: 4 });
    expect(parseAuDate('01/02/2019')).toEqual({ y: 2019, m: 2, d: 1 });
  });

  it('refuses an American date rather than silently swapping the fields', () => {
    // 4/13/2020 is the thirteenth month. Reading it as 13 April would put an
    // install date nine months out and a replacement forecast with it.
    expect(parseAuDate('4/13/2020')).toBeUndefined();
    expect(parseAuDate('12/25/2021')).toBeUndefined();
  });

  it('reads ISO, which is how the database stores it', () => {
    expect(parseAuDate('2020-12-04')).toEqual({ y: 2020, m: 12, d: 4 });
  });

  it('refuses a day that does not exist in that month', () => {
    expect(parseAuDate('31/02/2021')).toBeUndefined();
    expect(parseAuDate('29/02/2021')).toBeUndefined();
    expect(parseAuDate('29/02/2020')).toEqual({ y: 2020, m: 2, d: 29 });
  });

  it('refuses anything that is not a date at all', () => {
    for (const s of ['', 'unknown', 'circa 2018', '2020', '4/12']) {
      expect(parseAuDate(s)).toBeUndefined();
    }
  });

  it('prints dates back the only way this app prints them', () => {
    expect(formatAuDate('2020-12-04')).toBe('4/12/2020');
    expect(formatAuDate('2026-01-31')).toBe('31/1/2026');
  });
});

describe('batteryAge', () => {
  it('reports age against the four-year design life and when it was reached', () => {
    const r = batteryAge({ installedOn: '1/3/2020', at: TODAY });
    if (!r.known) throw new Error('expected a result');
    expect(r.designLifeYears).toBe(BATTERY_DESIGN_LIFE_YEARS);
    expect(r.expectedReplacementDate).toBe('2024-03-01');
    expect(r.pastDesignLife).toBe(true);
    expect(r.ageYears).toBeCloseTo(6.5, 1);
  });

  it('never lets a report say age is a defect', () => {
    // Straight out of the same discipline as the detector date code work: a
    // fitting past its design life that still holds ninety minutes is compliant,
    // and saying otherwise sells a client batteries they do not need.
    const r = batteryAge({ installedOn: '1/3/2020', at: TODAY });
    if (!r.known) throw new Error('expected a result');
    expect(r.caveat).toContain('Age alone is not a defect');
    expect(r.caveat).toContain('discharge test decides');
  });

  it('counts years remaining on a battery still inside its life', () => {
    const r = batteryAge({ installedOn: '1/6/2024', at: TODAY });
    if (!r.known) throw new Error('expected a result');
    expect(r.pastDesignLife).toBe(false);
    expect(r.yearsRemaining).toBeGreaterThan(1.5);
    expect(r.expectedReplacementDate).toBe('2028-06-01');
  });

  it("prefers the manufacturer's own design life over the generic figure", () => {
    // Lithium iron phosphate packs are published at eight years and more.
    // Holding them to four would condemn a battery halfway through its life.
    const r = batteryAge({ installedOn: '1/3/2020', at: TODAY, designLifeYears: 8 });
    if (!r.known) throw new Error('expected a result');
    expect(r.designLifeFromManufacturer).toBe(true);
    expect(r.pastDesignLife).toBe(false);
    expect(r.expectedReplacementDate).toBe('2028-03-01');
  });

  it('does not slide a 29 February install into March four years later', () => {
    expect((batteryAge({ installedOn: '29/2/2020', at: TODAY }) as { expectedReplacementDate: string })
      .expectedReplacementDate).toBe('2024-02-29');
    expect((batteryAge({ installedOn: '29/2/2016', at: TODAY, designLifeYears: 5 }) as { expectedReplacementDate: string })
      .expectedReplacementDate).toBe('2021-02-28');
  });

  it('refuses an unreadable install date and says how to enter one', () => {
    const r = batteryAge({ installedOn: '4/13/2020', at: TODAY });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.whatToDo).toContain('d/m/yyyy');
    expect(r.whatToDo).toContain('rejected rather than');
  });

  it('refuses an install date in the future rather than reporting a negative age', () => {
    const r = batteryAge({ installedOn: '1/1/2030', at: TODAY });
    expect(r.known).toBe(false);
    if (r.known) throw new Error('expected a refusal');
    expect(r.reason).toContain('in the future');
  });
});

describe('batteryAdvice', () => {
  const aged = batteryAge({ installedOn: '1/3/2020', at: TODAY });
  const young = batteryAge({ installedOn: '1/3/2025', at: TODAY });

  it('sends nobody to buy a battery for a fitting that never lit', () => {
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 0, ending: 'never-lit' }), aged);
    expect(advice.action).toBe('investigate');
    expect(advice.reasoning).toContain('a new battery fixes none of them');
  });

  it('treats a young battery that failed as a charger problem, not a battery problem', () => {
    // The one case where the obvious action is the wrong one. A two-year-old
    // battery that will not hold ninety minutes has usually been cooked, and
    // the replacement will be back on the defect list next service.
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 40, ending: 'extinguished' }), young);
    expect(advice.action).toBe('investigate');
    expect(advice.reasoning).toContain('charger');
  });

  it('replaces an old battery that failed, without further investigation', () => {
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 40, ending: 'extinguished' }), aged);
    expect(advice.action).toBe('replace-now');
  });

  it('leaves an old battery that still holds the duration alone', () => {
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 110, ending: 'extinguished' }), aged);
    expect(advice.action).toBe('monitor');
    expect(advice.statement).toContain('No action');
  });

  it('plans a battery for a marginal pass rather than waiting for it to be a defect', () => {
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 91, ending: 'extinguished' }), aged);
    expect(advice.action).toBe('replace-planned');
  });

  it('gives no advice at all where the test gave no verdict', () => {
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 60, ending: 'still-lit' }), aged);
    expect(advice.action).toBe('unknown');
    expect(advice.statement).toContain('has not been tested to a result');
  });

  it('still advises on the test result when the install date could not be read', () => {
    const unreadable = batteryAge({ installedOn: 'unknown', at: TODAY });
    const advice = batteryAdvice(assessDischarge({ achievedMinutes: 40, ending: 'extinguished' }), unreadable);
    expect(advice.action).toBe('replace-now');
  });
});

describe('summariseSite', () => {
  const fitting = (id: string, discharge?: DischargeInput, extra: Partial<FittingResult> = {}): FittingResult => ({
    assetId: id,
    classification: { supply: 'single-point', mode: 'non-sustained', role: 'emergency-luminaire' },
    discharge,
    ...extra,
  });

  it('calls a site compliant only when every fitting on the register was tested and passed', () => {
    const s = summariseSite([fitting('a', ranFull(110)), fitting('b', ranFull(120))]);
    expect(s.compliant).toBe(true);
    expect(s.passRatePercent).toBe(100);
  });

  it('refuses to call a site compliant on the strength of a sample', () => {
    // The sentence that matters. Nothing failed, but a third of the register
    // was never touched, and a client reads "compliant" as being about the
    // building rather than about the fittings someone could reach.
    const s = summariseSite([
      fitting('a', ranFull(110)),
      fitting('b', ranFull(120)),
      fitting('c', undefined, { notTestedReason: 'Tenancy locked, no access' }),
    ]);
    expect(s.compliant).toBeUndefined();
    expect(s.compliantStatement).toContain('Cannot be stated');
    expect(s.compliantStatement).toContain('not compliant because a sample of it passed');
    expect(s.caveats.join(' ')).toContain('Tenancy locked');
  });

  it('will not call a site compliant when a test was stopped early, even though nothing failed', () => {
    const s = summariseSite([
      fitting('a', ranFull(110)),
      fitting('b', { achievedMinutes: 60, ending: 'still-lit' }),
    ]);
    expect(s.compliant).toBeUndefined();
    expect(s.noVerdict).toBe(1);
    expect(s.caveats.join(' ')).toContain('untested, not passed');
  });

  it('calls a site non-compliant on a single failure', () => {
    const s = summariseSite([fitting('a', ranFull(110)), fitting('b', ranFull(30))]);
    expect(s.compliant).toBe(false);
    expect(s.failed).toBe(1);
  });

  it('separates the two failure causes so the quote can be built from it', () => {
    const s = summariseSite([
      fitting('a', ranFull(30)),
      fitting('b', ranFull(45)),
      fitting('c', { achievedMinutes: 0, ending: 'never-lit' }),
    ]);
    expect(s.failuresByCause).toHaveLength(2);
    expect(s.failuresByCause.find((c) => c.defectCode === 'EEL-FIT-001')?.count).toBe(2);
    expect(s.failuresByCause.find((c) => c.defectCode === 'EEL-FIT-002')?.count).toBe(1);
  });

  it('omits causes with nothing against them rather than printing zeroes', () => {
    const s = summariseSite([fitting('a', ranFull(30))]);
    expect(s.failuresByCause).toHaveLength(1);
  });

  it('reports the pass rate against fittings tested and separately against the register', () => {
    // Two very different numbers, and quoting the first as though it were the
    // second is how a half-done site reads as a good one.
    const s = summariseSite([
      fitting('a', ranFull(110)),
      fitting('b', ranFull(30)),
      fitting('c'),
      fitting('d'),
    ]);
    expect(s.passRatePercent).toBe(50);
    expect(s.coverageRatePercent).toBe(25);
  });

  it('says it does not know the pass rate when nothing was tested', () => {
    const s = summariseSite([fitting('a'), fitting('b')]);
    expect(s.passRatePercent).toBeUndefined();
    expect(s.compliant).toBeUndefined();
  });

  it('does not read an empty register as a compliant site', () => {
    const s = summariseSite([]);
    expect(s.compliant).toBeUndefined();
    expect(s.compliantStatement).toContain('cannot tell which');
  });

  it('counts a marginal pass as a pass but warns it will not be one next time', () => {
    const s = summariseSite([fitting('a', ranFull(92))]);
    expect(s.compliant).toBe(true);
    expect(s.marginalPasses).toBe(1);
    expect(s.clearPasses).toBe(0);
    expect(s.caveats.join(' ')).toContain('likely to be at the next service');
  });

  it('groups failures on a central system so one fault is not quoted as many', () => {
    // Twelve luminaires off one central unit, three tested and all three dark.
    // That is one battery bank, not three fittings, and the defect belongs
    // against the plant.
    const central = (id: string, discharge?: DischargeInput): FittingResult => ({
      assetId: id,
      classification: { supply: 'centrally-supplied', mode: 'non-sustained', role: 'emergency-luminaire' },
      centralSystemId: 'CEL-01',
      discharge,
    });
    const s = summariseSite([
      central('a', { achievedMinutes: 0, ending: 'never-lit' }),
      central('b', { achievedMinutes: 0, ending: 'never-lit' }),
      central('c', { achievedMinutes: 0, ending: 'never-lit' }),
      central('d'),
    ]);
    expect(s.centralSystemsAffected).toEqual([
      { centralSystemId: 'CEL-01', fittingsOnSystem: 4, failures: 3 },
    ]);
    expect(s.caveats.join(' ')).toContain('one fault with many symptoms');
  });

  it('always fences what the summary covers, even on a clean site', () => {
    const s = summariseSite([fitting('a', ranFull(110))]);
    expect(s.caveats.join(' ')).toContain('not a statement that the emergency lighting design is adequate');
    expect(s.caveats.join(' ')).toContain('register being right is an assumption');
  });
});

describe('sources', () => {
  it('gives every source a URL, a confidence and a reason for that confidence', () => {
    for (const [id, s] of Object.entries(SOURCES)) {
      expect(s.id).toBe(id);
      // Absolute and resolvable rather than https specifically: one of the two
      // manufacturer guides is published over plain HTTP, and citing an https
      // URL that does not resolve would be worse than citing the real one.
      expect(s.url).toMatch(/^https?:\/\/\S+$/);
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(s.basis.length).toBeGreaterThan(20);
      expect(s.ref.length).toBeGreaterThan(0);
    }
  });

  it('marks second-hand trade guidance low and the regulator high', () => {
    // The distinction that stops a supplier's blog being quoted in a report as
    // though it carried the same weight as the code.
    expect(SOURCES['ncc-spec-e48'].confidence).toBe('high');
    expect(SOURCES['atts-intervals'].confidence).toBe('low');
    expect(SOURCES['clevertronics-spacing'].confidence).toBe('medium');
    expect(SOURCES['legrand-exit-viewing'].confidence).toBe('medium');
  });

  it('resolves the ids every result carries, without repeating one', () => {
    const cited = citeSources(['as2293-1', 'as2293-1', 'ncc-e4']);
    expect(cited.map((s) => s.id)).toEqual(['as2293-1', 'ncc-e4']);
  });

  it('lets every result be traced back to a source', () => {
    const results = [
      assessDischarge(ranFull(110)).sourceIds,
      classify({ supply: 'single-point', mode: 'sustained', role: 'exit-sign' }).sourceIds,
      summariseSite([]).sourceIds,
    ];
    for (const ids of results) {
      expect(ids.length).toBeGreaterThan(0);
      expect(citeSources(ids)).toHaveLength(new Set(ids).size);
    }
  });
});
