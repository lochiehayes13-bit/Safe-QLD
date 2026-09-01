/**
 * Emergency lighting — the discharge test, and what may honestly be said about it.
 *
 * Emergency lighting is a third of Safe QLD's book: 4,203 of 12,553 assets. Up
 * to now the app has carried one six-monthly routine for all of them and no
 * logic at all, which means every judgement about a fitting has been made in a
 * technician's head at the top of a ladder and written down as a tick.
 *
 * Four field failures are what this module exists to stop.
 *
 *  1. **"It ran for an hour, near enough."** A discharge test that is stopped
 *     before the required duration has proved nothing whatsoever, and recording
 *     it as a pass is a false statement about a life safety system. This module
 *     will not turn a shortened test into a verdict — it returns no verdict and
 *     says why.
 *  2. **A dead fitting written up as a failed battery.** "Did not illuminate at
 *     all" and "went out early" are different defects with different causes and
 *     different fixes: the first is usually a lamp, a driver, a disconnected
 *     battery lead, or a fitting that never saw the supply removed; the second
 *     is a battery at the end of its life. They are separate outcomes here and
 *     they map to separate defect codes, because a quote for a battery does not
 *     fix a fitting whose lamp is dead.
 *  3. **A fitting that "looks fine".** A non-sustained fitting is dark until the
 *     supply fails, so a visual check finds nothing. A sustained one is lit all
 *     the time, so a walk-through does find a dead one. The classification is
 *     what decides whether looking at a fitting means anything, and it decides
 *     where the failure is rectified — a centrally-supplied luminaire has no
 *     battery in it at all, and its "failure" may be one central battery bank
 *     taking out two hundred fittings at once.
 *  4. **"The site's emergency lighting is compliant."** Said on the strength of
 *     a sample, that sentence is worthless. A site is only called compliant here
 *     when every fitting on the register was tested and every one passed, and
 *     even then the claim is fenced to what a discharge test actually covers.
 *
 * On sources: nothing in this file reproduces the text of AS/NZS 2293. Clause
 * and table numbers, frequencies, and figures published by manufacturers and
 * regulators are recorded with the URL they came from and a confidence, in the
 * DATA rather than in a comment, so a figure can never be quoted in a report
 * without its provenance. Where the sources contradict each other — and on exit
 * sign viewing distance they do — every reading is carried, the conservative one
 * is answered with, and the disagreement is reported rather than hidden.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type SourceId =
  | 'ncc-e4'
  | 'ncc-spec-e48'
  | 'as2293-1'
  | 'as2293-2'
  | 'clevertronics-spacing'
  | 'abb-stanilite-class'
  | 'iec-60598-2-22'
  | 'atts-intervals'
  | 'exiting-viewing'
  | 'elecas-design';

export interface Source {
  id: SourceId;
  /** What this source is relied on for, in one line. */
  what: string;
  /** The document, and the clause or table within it. Numbers only, never text. */
  ref: string;
  url: string;
  confidence: Confidence;
  /**
   * Why the confidence is what it is. A regulator's own page is not the same
   * kind of fact as a supplier's blog, and a report should never treat them
   * alike.
   */
  basis: string;
}

export const SOURCES: Record<SourceId, Source> = {
  'ncc-e4': {
    id: 'ncc-e4',
    what: 'Which buildings must have emergency lighting and exit signs, and that AS/NZS 2293.1 governs them',
    ref: 'NCC 2022 Volume One, Part E4 (E4D2 emergency lighting, E4D5 exit signs, E4D8 design and operation)',
    url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/8-south-australia/e4-visibility-emergency-exit-signs-and-warning-systems',
    confidence: 'high',
    basis: "The regulator's own published code text.",
  },
  'ncc-spec-e48': {
    id: 'ncc-spec-e48',
    what: 'Photoluminescent exit signs: the 24 m viewing distance cap, the 1.3× pictorial element rule, and the 90-minute luminance requirement',
    ref: 'NCC Specification E4.8 (NCC 2022 Specification 25), Clauses 3(a), 3(b), 4(b), 4(c), 5',
    url: 'https://ncc.abcb.gov.au/editions/2019/ncc-2019-volume-one/section-e-services-and-equipment/specification-e48',
    confidence: 'high',
    basis: "The regulator's own published specification, with clause numbers.",
  },
  'as2293-1': {
    id: 'as2293-1',
    what: 'System design: exit sign requirements sit in Section 5, with pictorial element dimensions in Table 5.1; spacing tables are keyed to luminaire classification and mounting height',
    ref: 'AS/NZS 2293.1:2018 (and :2005), Section 5, Table 5.1; spacing tables Section 5 / Appendices E and F',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-nzs-2293-1-2018',
    confidence: 'high',
    basis:
      'Clause and table numbers only, corroborated by the NCC citing clauses 5.5, 5.6 and 5.8 and Table 5.1 of this standard. '
      + 'Safe QLD holds a purchased copy; no text or table content is reproduced in this app.',
  },
  'as2293-2': {
    id: 'as2293-2',
    what: 'Routine service and maintenance: the six-monthly discharge test for the full rated duration, and the annual inspection',
    ref: 'AS/NZS 2293.2 (routine service and maintenance)',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-nzs-2293-2-2019',
    confidence: 'high',
    basis: 'The existence and interval of the activity, not its wording. Transcribe the method from the purchased copy.',
  },
  'clevertronics-spacing': {
    id: 'clevertronics-spacing',
    what: 'Maximum spacing in metres for a given luminaire classification and mounting height, on the 0.2 lux basis, under each edition of AS/NZS 2293.1',
    ref: 'Clevertronics ANZ Spacing Tables, 2022',
    url: 'https://clevertronics.com.au/sites/default/files/2022-02/2022_Clevertronics_ANZ_Spacing_Tables.pdf',
    confidence: 'medium',
    basis:
      "A manufacturer's own published photometric data for its own luminaires. Reliable for those products; another "
      + "maker's fitting of the same class may be tabulated differently, so the fitting's own datasheet governs.",
  },
  'abb-stanilite-class': {
    id: 'abb-stanilite-class',
    what: 'How luminaire classifications (Class A to E, per axis C0/C90) are assigned and used, and that replacing a fitting with a lesser class can make a building non-compliant',
    ref: 'ABB / Stanilite, "Emergency lighting classification and spacing tables", 9AKK106930A3720, September 2018',
    url: 'https://library.e.abb.com/public/236d816924fb4b838757d6792fd8c639/Information_Emergency-lighting-classification-and-spacing-tables_B.pdf',
    confidence: 'medium',
    basis:
      "A manufacturer's own published information sheet. Its worked example (a D40 fitting at 3 m spacing at 18.6 m "
      + 'under the 2005 edition) matches the Clevertronics tables exactly, which is why both are carried.',
  },
  'iec-60598-2-22': {
    id: 'iec-60598-2-22',
    what: 'The four-year operational design life of the battery in a self-contained emergency luminaire',
    ref: 'IEC 60598-2-22 / AS 60598.2.22, adopted in the UK as BS EN 60598-2-22:2014+A1:2020',
    url: 'https://store.accuristech.com/products/preview/2076925',
    confidence: 'medium',
    basis:
      'The figure is quoted consistently across trade and manufacturer guidance for the BS EN adoption of the same IEC '
      + 'standard; the Australian adoption was not read directly. It is a product design life, not a replacement date.',
  },
  'atts-intervals': {
    id: 'atts-intervals',
    what: 'The 90-minute discharge test and the six-monthly / twelve-monthly service intervals as the trade applies them',
    ref: 'ATTS Facilities Maintenance, testing intervals, citing AS/NZS 2293.2 clauses 3.2.2 and 3.2.3',
    url: 'https://www.atts.com.au/help/what-are-the-testing-intervals',
    confidence: 'low',
    basis: 'Second-hand trade guidance. Corroborates the interval; confirm the method against the purchased standard.',
  },
  'exiting-viewing': {
    id: 'exiting-viewing',
    what: 'Exit sign viewing distance as a multiple of pictogram height, and the minimum sign dimensions',
    ref: 'Exiting (Australian supplier), exit and emergency lighting guidance referencing AS 2293.1:2018',
    url: 'https://www.exiting.com.au/viewing-distance-to-size-of-an-emergency-light.html',
    confidence: 'low',
    basis:
      'Second-hand trade guidance, and it does not agree with other trade guidance on the multiplier. Carried as one '
      + 'reading of AS/NZS 2293.1 Table 5.1, not as the answer.',
  },
  'elecas-design': {
    id: 'elecas-design',
    what: 'Design conventions: the 0.2 lux general and 1 lux stairway bases, and that one luminaire may not serve more than 500 m²',
    ref: 'Elecas emergency lighting design guide, referencing AS/NZS 2293.1',
    url: 'https://elecas.com.au/design-guide/emergency-lighting',
    confidence: 'low',
    basis: 'Second-hand trade guidance. Used only for a sense-check, never for a design.',
  },
};

/** Every source behind a result, in the order a report should list them. */
export function citeSources(ids: SourceId[]): Source[] {
  const seen = new Set<SourceId>();
  const out: Source[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = SOURCES[id];
    if (s) out.push(s);
  }
  return out;
}

// ===========================================================================
// Classification
// ===========================================================================

/** Where the battery lives. It decides what a failure means and who fixes it. */
export type SupplyType = 'single-point' | 'centrally-supplied';

/**
 * Whether the lamp is lit while normal supply is present.
 *
 * A sustained fitting is lit all the time; a non-sustained one is dark until
 * the supply fails. Exit signs are sustained by their nature — an unlit exit
 * sign is no sign at all.
 */
export type OperatingMode = 'sustained' | 'non-sustained';

export type FittingRole = 'emergency-luminaire' | 'exit-sign' | 'combined';

export interface Classification {
  supply: SupplyType;
  mode: OperatingMode;
  role: FittingRole;
}

export interface ClassificationProfile extends Classification {
  label: string;
  /**
   * True where a dead fitting shows itself without any test — the lamp is
   * supposed to be lit right now, so a walk-through finds it.
   */
  visibleFailureOnNormalSupply: boolean;
  /**
   * True where one failure can be many fittings. A central battery bank that
   * cannot hold up takes every luminaire on it with it, so the defect belongs
   * against the central system and the fitting count has to be stated.
   */
  commonModeFailureRisk: boolean;
  /** Where the technician removes normal supply to start the test. */
  isolationPoint: string;
  /** What is actually done at this fitting, beyond the discharge itself. */
  whatIsTested: string[];
  /** How a discharge failure on this kind of fitting is put right. */
  howAFailureIsRectified: string[];
  /** What a technician has to be told before working on it. */
  cautions: string[];
  sourceIds: SourceId[];
}

const ROLE_LABEL: Record<FittingRole, string> = {
  'emergency-luminaire': 'Emergency luminaire',
  'exit-sign': 'Exit sign',
  combined: 'Combined exit sign and emergency luminaire',
};

const SUPPLY_LABEL: Record<SupplyType, string> = {
  'single-point': 'single-point (self-contained)',
  'centrally-supplied': 'centrally supplied',
};

/**
 * What this fitting is, and what follows from it.
 *
 * The interpretation is Safe QLD's own, written in its own words. It is held
 * as data rather than left to the technician because the two distinctions that
 * matter most — is a visual check worth anything, and is this one asset or two
 * hundred — are exactly the ones that get collapsed on a busy day.
 */
export function classify(c: Classification): ClassificationProfile {
  const central = c.supply === 'centrally-supplied';
  const sustained = c.mode === 'sustained';
  const isSign = c.role === 'exit-sign' || c.role === 'combined';

  const whatIsTested: string[] = [
    'Remove normal supply and time how long the fitting stays illuminated, to the full duration required of it.',
  ];
  const rectify: string[] = [];
  const cautions: string[] = [];

  if (central) {
    whatIsTested.push(
      'Confirm the luminaire itself illuminates on the emergency supply — it holds no battery, so what is being '
      + 'proved here is the sub-circuit and the lamp, not a battery.',
    );
    whatIsTested.push(
      'Test the central unit separately: its battery, charger and changeover are one asset serving many luminaires.',
    );
    rectify.push(
      'A luminaire that stays dark while others on the same central system light is a fault at that luminaire — lamp, '
      + 'driver, or its sub-circuit.',
    );
    rectify.push(
      'A whole group going dark together is the central unit, not the fittings. Raise the defect against the central '
      + 'system and record how many luminaires it serves.',
    );
    cautions.push(
      'Do not raise a battery defect against a centrally-supplied luminaire. It has no battery, and the quote will be '
      + 'for a part that is not there.',
    );
  } else {
    whatIsTested.push(
      "Check the fitting's own charge indicator is lit once normal supply is restored, and again at the end of the "
      + 'recharge period.',
    );
    rectify.push('Replace the battery, or the whole fitting where the battery is not a serviceable part.');
    rectify.push(
      'A battery that fails well inside its design life points at the charger or at a fitting left sitting on test, '
      + 'not at the battery. Replacing the battery alone will put the same fitting back on the defect list.',
    );
  }

  if (sustained) {
    whatIsTested.push('Confirm the fitting is illuminated on normal supply before the test begins.');
    rectify.push(
      'A sustained fitting has a lamp that runs on normal supply as well as on emergency. One of the two can fail on '
      + 'its own, so confirm both states after any repair.',
    );
  } else {
    cautions.push(
      'Non-sustained: this fitting is dark by design until the supply fails. It cannot be checked by looking at it, '
      + 'and a register entry of "condition OK" against one of these means nothing without a discharge test.',
    );
  }

  if (isSign) {
    whatIsTested.push(
      'Confirm the legend is legible and unobscured, and that the direction shown matches the actual path of travel.',
    );
    rectify.push(
      'A sign pointing the wrong way is a defect of the sign, not of the lighting, and is rectified by changing the '
      + 'legend or the sign — no amount of battery work fixes it.',
    );
  }

  return {
    ...c,
    label: `${ROLE_LABEL[c.role]} — ${SUPPLY_LABEL[c.supply]}, ${c.mode}`,
    visibleFailureOnNormalSupply: sustained,
    commonModeFailureRisk: central,
    isolationPoint: central
      ? 'At the central emergency lighting unit, or the sub-circuit it feeds. Not at the fitting.'
      : "At the fitting's own test facility or its local sub-circuit.",
    whatIsTested,
    howAFailureIsRectified: rectify,
    cautions,
    sourceIds: ['as2293-1', 'as2293-2'],
  };
}

// ===========================================================================
// The discharge test
// ===========================================================================

/**
 * The minimum duration the building code requires of emergency lighting.
 *
 * A floor, not a specification. A fitting rated for longer must achieve its own
 * rating, and this number must never be substituted for a rating that is simply
 * unknown without saying so — which `requiredDuration` below does.
 */
export const MINIMUM_DURATION_MINUTES = 90;

export const DEFAULT_MARGIN_MINUTES = 9;

export interface RequiredDuration {
  minutes: number;
  /** True where this is the fitting's own rating rather than the code minimum. */
  fromRating: boolean;
  note: string;
  sourceIds: SourceId[];
}

/**
 * How long this fitting has to stay lit.
 *
 * When the rating is unknown the code minimum is used and the result says so.
 * That is not a guess dressed up as an answer: 90 minutes is the least any
 * required fitting may achieve, so a fitting that fails against 90 has failed
 * whatever its rating turns out to be. A fitting that *passes* against 90 has
 * only been shown to meet the floor, and the note says that too.
 */
export function requiredDuration(ratedMinutes?: number): RequiredDuration {
  if (ratedMinutes !== undefined && Number.isFinite(ratedMinutes) && ratedMinutes > 0) {
    return {
      minutes: ratedMinutes,
      fromRating: true,
      note: `The fitting's own rated duration of ${ratedMinutes} minutes.`,
      sourceIds: ['as2293-2'],
    };
  }
  return {
    minutes: MINIMUM_DURATION_MINUTES,
    fromRating: false,
    note:
      `Rated duration not recorded, so the ${MINIMUM_DURATION_MINUTES}-minute code minimum has been used. A fail `
      + 'against this is a fail on any rating; a pass only shows the fitting met the floor. Record the rating off the '
      + 'fitting and re-assess.',
    sourceIds: ['ncc-e4', 'atts-intervals'],
  };
}

/**
 * How the test ended.
 *
 * `still-lit` exists because it is the honest record of the most common shortcut
 * on site: the technician came back at sixty minutes, the fitting was still
 * going, and the job moved on. That is not a pass and it is not a fail.
 */
export type TestEnding = 'extinguished' | 'still-lit' | 'never-lit';

export interface DischargeInput {
  /** Minutes the fitting was observed illuminated. Zero where it never lit. */
  achievedMinutes: number;
  ending: TestEnding;
  /** The fitting's own rated duration, where the register or the label has it. */
  ratedMinutes?: number;
  /**
   * How much reserve past the required duration still counts as a clear pass.
   * A fitting that goes out the moment it reaches 90 minutes has none, and will
   * not reach 90 again in six months' time.
   */
  marginMinutes?: number;
}

export type DischargeOutcome =
  /** Reached the required duration with reserve to spare. */
  | 'pass'
  /** Reached it, but only just. Not a defect today; a defect at the next service. */
  | 'marginal-pass'
  /** Illuminated, then went out before the required duration. A battery at end of life. */
  | 'failed-early'
  /** Never illuminated when the supply was removed. A different defect entirely. */
  | 'no-illumination'
  /** The test was stopped before the required duration with the fitting still lit. */
  | 'inconclusive'
  /** The record cannot be read at all. */
  | 'unreadable';

export interface DischargeVerdict {
  outcome: DischargeOutcome;
  /**
   * Deliberately optional. `undefined` is the answer where the test does not
   * support one either way, and a caller that treats undefined as false will
   * fail a fitting that was never properly tested — which is why it is not a
   * boolean with a default.
   */
  passed?: boolean;
  requiredMinutes: number;
  requiredFromRating: boolean;
  achievedMinutes?: number;
  /** Minutes past the required duration; negative is a shortfall. */
  marginMinutes?: number;
  /** Achieved as a percentage of required, to one decimal. */
  percentOfRequired?: number;
  /** The line that belongs in the service report. */
  statement: string;
  /** Present whenever there is no verdict, and it explains what to do about it. */
  reason?: string;
  /** The defect library code this outcome raises, where it raises one. */
  defectCode?: string;
  rectification?: string;
  notes: string[];
  sourceIds: SourceId[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The verdict on one fitting's discharge test.
 *
 * Unlike the other calculators here this one always returns a result rather
 * than refusing, because a service report has a row for this fitting either
 * way. The refusal is expressed as an outcome — `inconclusive` or `unreadable`
 * — with `passed` left undefined and `reason` filled in. Nothing downstream may
 * read a missing `passed` as a pass.
 */
export function assessDischarge(input: DischargeInput): DischargeVerdict {
  const required = requiredDuration(input.ratedMinutes);
  const margin = input.marginMinutes ?? DEFAULT_MARGIN_MINUTES;
  const base = {
    requiredMinutes: required.minutes,
    requiredFromRating: required.fromRating,
    notes: required.fromRating ? [] : [required.note],
    sourceIds: ['as2293-2', 'atts-intervals'] as SourceId[],
  };

  const achieved = input.achievedMinutes;
  if (!Number.isFinite(achieved) || achieved < 0) {
    return {
      ...base,
      outcome: 'unreadable',
      statement: 'Discharge test not assessed — the duration recorded is not a number of minutes.',
      reason: `"${String(achieved)}" is not a duration. Re-enter the minutes the fitting stayed illuminated.`,
    };
  }
  // A day of run time is a transcription error — seconds typed into a minutes
  // box, or a clock time written where a duration belongs. Guessing which would
  // put an invented number in a report.
  if (achieved > 1440) {
    return {
      ...base,
      outcome: 'unreadable',
      achievedMinutes: achieved,
      statement: 'Discharge test not assessed — the duration recorded is longer than a day.',
      reason: `${achieved} minutes is over 24 hours. Check whether seconds or a clock time was entered instead of a duration.`,
    };
  }

  if (input.ending === 'never-lit') {
    if (achieved > 0) {
      return {
        ...base,
        outcome: 'unreadable',
        achievedMinutes: achieved,
        statement: 'Discharge test not assessed — the record contradicts itself.',
        reason:
          `The fitting is recorded as never illuminating, but with ${achieved} minutes of run time against it. `
          + 'One of the two is wrong.',
      };
    }
    return {
      ...base,
      outcome: 'no-illumination',
      passed: false,
      achievedMinutes: 0,
      marginMinutes: -required.minutes,
      percentOfRequired: 0,
      statement: 'Fitting did not illuminate on loss of normal supply.',
      defectCode: 'EEL-FIT-002',
      rectification:
        'Not a battery at end of life. Check the lamp or LED module, the driver, the battery connection, and that '
        + 'normal supply was actually removed from this fitting before the test was called. Replace the fitting where '
        + 'the cause is internal to it.',
      notes: [
        ...base.notes,
        'This is a different defect from a fitting that lit and went out early, and it is quoted differently.',
      ],
    };
  }

  const marginMinutes = round1(achieved - required.minutes);
  const percentOfRequired = round1((achieved / required.minutes) * 100);

  if (input.ending === 'still-lit') {
    if (achieved >= required.minutes) {
      return {
        ...base,
        outcome: 'pass',
        passed: true,
        achievedMinutes: achieved,
        marginMinutes,
        percentOfRequired,
        statement:
          `Illuminated for ${achieved} minutes against ${required.minutes} required, and still illuminated when the `
          + 'test was ended.',
        notes: [...base.notes, 'The fitting was still lit at the end, so the reserve beyond this point is unknown but positive.'],
      };
    }
    return {
      ...base,
      outcome: 'inconclusive',
      achievedMinutes: achieved,
      marginMinutes,
      percentOfRequired,
      statement:
        `Discharge test stopped at ${achieved} minutes of the ${required.minutes} required, with the fitting still `
        + 'illuminated. No verdict.',
      reason:
        `Stopping at ${achieved} minutes proves the fitting lasts at least that long and nothing more. It has not `
        + `passed and it has not failed. Re-run the test for the full ${required.minutes} minutes.`,
      notes: [
        ...base.notes,
        'Recording this as a pass would be a false statement about a life safety system on the strength of a test that '
        + 'was never finished.',
      ],
    };
  }

  // Extinguished.
  if (achieved < required.minutes) {
    return {
      ...base,
      outcome: 'failed-early',
      passed: false,
      achievedMinutes: achieved,
      marginMinutes,
      percentOfRequired,
      statement:
        `Illuminated for ${achieved} minutes and extinguished, ${round1(required.minutes - achieved)} minutes short of `
        + `the ${required.minutes} required (${percentOfRequired}% of the required duration).`,
      defectCode: 'EEL-FIT-001',
      rectification:
        'The fitting works but will not hold up. Replace the battery, or the fitting where the battery is not a '
        + 'serviceable part, then re-test for the full duration.',
      notes: base.notes,
    };
  }

  if (marginMinutes < margin) {
    return {
      ...base,
      outcome: 'marginal-pass',
      passed: true,
      achievedMinutes: achieved,
      marginMinutes,
      percentOfRequired,
      statement:
        `Illuminated for ${achieved} minutes against ${required.minutes} required, then extinguished — a pass with `
        + `${marginMinutes} minutes in hand.`,
      rectification:
        'No defect today. Flag the fitting for battery replacement at or before the next service: a battery with this '
        + 'little reserve will be short of the duration in six months.',
      notes: [
        ...base.notes,
        `Counted as marginal because the reserve is under the ${margin}-minute margin used here.`,
      ],
    };
  }

  return {
    ...base,
    outcome: 'pass',
    passed: true,
    achievedMinutes: achieved,
    marginMinutes,
    percentOfRequired,
    statement:
      `Illuminated for ${achieved} minutes against ${required.minutes} required, then extinguished — a pass with `
      + `${marginMinutes} minutes in hand.`,
    notes: base.notes,
  };
}

export const OUTCOME_LABEL: Record<DischargeOutcome, string> = {
  pass: 'Pass',
  'marginal-pass': 'Marginal pass',
  'failed-early': 'Failed — extinguished early',
  'no-illumination': 'Failed — did not illuminate',
  inconclusive: 'No verdict — test not completed',
  unreadable: 'No verdict — record cannot be read',
};

// ===========================================================================
// Exit sign viewing distance
// ===========================================================================

export type SignIllumination = 'internally-illuminated' | 'externally-illuminated' | 'photoluminescent';

/**
 * The smallest pictorial element height any source tabulates.
 *
 * Below this the app has nothing to read from. It will not extrapolate a
 * straight line off the bottom of a table it has never seen.
 */
export const MIN_TABULATED_PICTOGRAM_MM = 100;

export interface ViewingCandidate {
  /** Maximum viewing distance in metres per metre of pictogram height. */
  factor: number;
  maxViewingDistanceM: number;
  reading: string;
  sourceId: SourceId;
  confidence: Confidence;
}

export interface ViewingDistance {
  known: true;
  pictogramHeightMm: number;
  illumination: SignIllumination;
  /**
   * The answer: the smallest of the sourced readings. A sign inside this is
   * inside every reading, so the check cannot pass a sign that one reading of
   * the standard would fail.
   */
  maxViewingDistanceM: number;
  /** Every sourced reading, so a technician can see what is in dispute. */
  candidates: ViewingCandidate[];
  /** False where the sourced readings do not agree with each other. */
  sourcesAgree: boolean;
  /** Set where a regulator's cap, rather than the sign's size, decides the answer. */
  cappedBy?: string;
  /** The clause and table that actually govern, for the report. */
  governing: string;
  notes: string[];
  sourceIds: SourceId[];
}

export interface Refused {
  known: false;
  reason: string;
  /** What the technician should do to get an answer. */
  whatToDo: string;
  sourceIds: SourceId[];
}

/**
 * Two readings of AS/NZS 2293.1 Table 5.1 for an internally illuminated sign.
 *
 * They do not agree, and pretending otherwise would be the whole problem. One
 * Australian supplier's worked example gives 30 m for a 150 mm pictogram, a
 * ratio of 200. Another set of trade guidance tabulates 100 mm at 16 m, 150 mm
 * at 24 m and 200 mm at 32 m, a ratio of 160 throughout, with the same ratio
 * given as a formula above 32 m. Both are second-hand; Table 5.1 itself is the
 * only thing that settles it, and it is not reproducible here.
 */
const INTERNAL_READINGS: { factor: number; reading: string; sourceId: SourceId }[] = [
  {
    factor: 160,
    reading:
      'Trade guidance tabulating 100 mm at 16 m, 150 mm at 24 m and 200 mm at 32 m, and viewing distance ÷ 160 above '
      + 'that — a ratio of 160 throughout.',
    sourceId: 'exiting-viewing',
  },
  {
    factor: 200,
    reading:
      "An Australian supplier's worked example putting a 150 mm pictogram at 30 m — a ratio of 200, which also matches "
      + 'the 24 m, 32 m and 40 m ratings signs are sold under for 120 mm, 160 mm and 200 mm pictograms.',
    sourceId: 'exiting-viewing',
  },
];

/**
 * The furthest a sign of this size may be relied on to be read from.
 *
 * Refuses rather than guesses in three cases: a pictogram smaller than anything
 * tabulated, a sign whose illumination is not one of the three kinds handled,
 * and — the one that will surprise people — any externally illuminated sign.
 * The only multiplier this app could find for externally illuminated signs came
 * from United Kingdom guidance describing BS 5266 and ISO 3864, which is not
 * AS/NZS 2293.1 and must not be presented as if it were.
 */
export function exitSignViewingDistance(args: {
  pictogramHeightMm: number;
  illumination: SignIllumination;
}): ViewingDistance | Refused {
  const h = args.pictogramHeightMm;

  if (!Number.isFinite(h) || h <= 0) {
    return {
      known: false,
      reason: `"${String(h)}" is not a pictogram height in millimetres.`,
      whatToDo: 'Measure the green running-man element itself, top to bottom, not the whole sign or its housing.',
      sourceIds: ['as2293-1'],
    };
  }
  if (h > 1000) {
    return {
      known: false,
      reason: `${h} mm is larger than any exit sign pictogram this app has a source for.`,
      whatToDo: 'Check the measurement is the pictorial element in millimetres. If it really is that size, read Table 5.1 directly.',
      sourceIds: ['as2293-1'],
    };
  }

  if (args.illumination === 'photoluminescent') {
    // The cap is the regulator's, not a ratio, and it applies whatever the sign
    // measures — so the answer here does not depend on the height at all.
    return {
      known: true,
      pictogramHeightMm: h,
      illumination: args.illumination,
      maxViewingDistanceM: 24,
      candidates: [
        {
          factor: 0,
          maxViewingDistanceM: 24,
          reading: 'A flat cap of 24 m set by the NCC for photoluminescent signs, regardless of the size of the sign.',
          sourceId: 'ncc-spec-e48',
          confidence: 'high',
        },
      ],
      sourcesAgree: true,
      cappedBy: 'NCC Specification E4.8 Clause 5 (NCC 2022 Specification 25) — 24 m for photoluminescent exit signs',
      governing: 'NCC Specification E4.8, Clauses 4(b), 4(c) and 5, with AS/NZS 2293.1 Table 5.1 behind Clause 4(b)',
      notes: [
        'This is a ceiling, not a permission. The sign must separately satisfy the requirement that its pictorial '
        + 'elements are 1.3 times the AS/NZS 2293.1 Table 5.1 dimensions, with a photoluminescent border of at least '
        + '15 mm around them. This app cannot check that — Table 5.1 is not reproduced here.',
        'A photoluminescent sign also depends on being charged: the NCC requires at least 100 lux at the face from a '
        + 'dedicated source of at least 4000 K. A sign in a dark corridor fails on that before viewing distance matters.',
      ],
      sourceIds: ['ncc-spec-e48', 'as2293-1'],
    };
  }

  if (args.illumination === 'externally-illuminated') {
    return {
      known: false,
      reason:
        'No Australian source for the viewing distance of an externally illuminated sign could be found. The only '
        + 'multiplier available (100 × pictogram height) comes from United Kingdom guidance describing BS 5266 and '
        + 'ISO 3864, which is not AS/NZS 2293.1.',
      whatToDo:
        'Read Table 5.1 of AS/NZS 2293.1 in the office copy and enter the tabulated distance directly. Do not apply '
        + 'the internally illuminated figure to an externally illuminated sign — it is roughly double, and would put a '
        + 'sign twice as far from the exit as the standard allows.',
      sourceIds: ['as2293-1', 'ncc-e4'],
    };
  }

  if (h < MIN_TABULATED_PICTOGRAM_MM) {
    return {
      known: false,
      reason:
        `A ${h} mm pictogram is below the ${MIN_TABULATED_PICTOGRAM_MM} mm smallest element any source consulted `
        + 'tabulates.',
      whatToDo:
        'Read Table 5.1 of AS/NZS 2293.1 directly. A sign this small is very likely not a compliant exit sign at all, '
        + 'which is a finding in its own right.',
      sourceIds: ['as2293-1', 'exiting-viewing'],
    };
  }

  const candidates: ViewingCandidate[] = INTERNAL_READINGS.map((r) => ({
    factor: r.factor,
    maxViewingDistanceM: round1((h / 1000) * r.factor),
    reading: r.reading,
    sourceId: r.sourceId,
    confidence: SOURCES[r.sourceId].confidence,
  })).sort((a, b) => a.maxViewingDistanceM - b.maxViewingDistanceM);

  const smallest = candidates[0]!;
  const largest = candidates[candidates.length - 1]!;
  const agree = smallest.maxViewingDistanceM === largest.maxViewingDistanceM;

  const notes: string[] = [];
  if (!agree) {
    notes.push(
      `The sources disagree: ${smallest.maxViewingDistanceM} m on one reading and ${largest.maxViewingDistanceM} m on `
      + `the other. The smaller is answered with, so a sign inside ${smallest.maxViewingDistanceM} m is inside both. `
      + `Between ${smallest.maxViewingDistanceM} m and ${largest.maxViewingDistanceM} m this app cannot say.`,
    );
  }
  notes.push(
    'Both readings are second-hand trade guidance. AS/NZS 2293.1 Table 5.1 governs and is the only thing that settles '
    + 'it — check the office copy before this goes in a report.',
  );

  return {
    known: true,
    pictogramHeightMm: h,
    illumination: args.illumination,
    maxViewingDistanceM: smallest.maxViewingDistanceM,
    candidates,
    sourcesAgree: agree,
    governing: 'AS/NZS 2293.1 Table 5.1 (pictorial element dimensions), cited by NCC Part E4 clause E4D8',
    notes,
    sourceIds: ['exiting-viewing', 'as2293-1', 'ncc-e4'],
  };
}

export type PlacementVerdict = 'within' | 'exceeds' | 'uncertain';

export interface PlacementCheck {
  known: true;
  verdict: PlacementVerdict;
  distanceM: number;
  /** The strictest sourced limit. */
  strictestLimitM: number;
  /** The most generous sourced limit. Equal to the strictest where sources agree. */
  mostGenerousLimitM: number;
  statement: string;
  /** Present on `uncertain`, which is the honest answer inside the disputed band. */
  reason?: string;
}

/**
 * Whether a sign is close enough to be read from where a person stands.
 *
 * The three-way answer is the point. Inside every reading it passes, outside
 * every reading it fails, and in the band the sources argue about it says so
 * instead of picking a side — because on this one figure the app genuinely does
 * not know, and a technician who is told that will go and read Table 5.1.
 */
export function checkSignPlacement(distanceM: number, sign: ViewingDistance): PlacementCheck | Refused {
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    return {
      known: false,
      reason: `"${String(distanceM)}" is not a distance in metres.`,
      whatToDo: 'Measure from the furthest point a person needs to see the sign from, along the path of travel.',
      sourceIds: sign.sourceIds,
    };
  }
  const limits = sign.candidates.map((c) => c.maxViewingDistanceM);
  const strictest = Math.min(...limits);
  const generous = Math.max(...limits);

  if (distanceM <= strictest) {
    return {
      known: true,
      verdict: 'within',
      distanceM,
      strictestLimitM: strictest,
      mostGenerousLimitM: generous,
      statement: `${distanceM} m is within the ${strictest} m limit on every reading consulted.`,
    };
  }
  if (distanceM > generous) {
    return {
      known: true,
      verdict: 'exceeds',
      distanceM,
      strictestLimitM: strictest,
      mostGenerousLimitM: generous,
      statement:
        `${distanceM} m exceeds the ${generous} m limit on every reading consulted. A larger sign, or a second sign, `
        + 'is needed.',
    };
  }
  return {
    known: true,
    verdict: 'uncertain',
    distanceM,
    strictestLimitM: strictest,
    mostGenerousLimitM: generous,
    statement: `${distanceM} m falls between the ${strictest} m and ${generous} m limits the sources give.`,
    reason:
      'The sources consulted disagree over this range, so this app will not call it either way. Read AS/NZS 2293.1 '
      + 'Table 5.1 for this pictogram height.',
  };
}

// ===========================================================================
// Spacing sense-check — NOT a design calculation
// ===========================================================================

export type SpacingEdition = '2005' | '2018';

/** The mounting heights the sourced tables carry. Nothing between them is known. */
export const TABULATED_HEIGHTS_M = [2.1, 2.4, 2.7, 3, 3.3, 3.6, 4, 4.5, 5] as const;

export interface SpacingRow {
  /** The luminaire's classification, as printed on its datasheet: D40, D80. */
  classification: string;
  edition: SpacingEdition;
  /** Maximum spacing in metres at each height in TABULATED_HEIGHTS_M, in order. */
  maxSpacingM: number[];
}

/**
 * Maximum spacing on the 0.2 lux basis, as one manufacturer publishes it.
 *
 * These are Clevertronics' own figures for their own luminaires, and they are
 * carried for two reasons. The first is that a technician on site has the class
 * off the datasheet and nothing else. The second is the thing the table makes
 * visible: the two editions of AS/NZS 2293.1 do not give the same answer. A D80
 * fitting at 2.4 m could sit 22.0 m from the next one under the 2005 edition
 * and only 13.2 m under 2018. Below about 3.6 m the 2018 figures are identical
 * across every class, so a brighter fitting buys nothing at low mounting
 * heights — which is exactly the assumption a like-for-like replacement makes.
 *
 * The edition is therefore never defaulted. It has to be stated.
 */
export const SPACING_02_LUX: SpacingRow[] = [
  { classification: 'D25', edition: '2005', maxSpacingM: [14.2, 14.7, 15.3, 15.7, 16.1, 16.5, 16.9, 17.3, 17.7] },
  { classification: 'D32', edition: '2005', maxSpacingM: [15.4, 16.1, 16.7, 17.2, 17.6, 18.0, 18.5, 19.1, 19.5] },
  { classification: 'D40', edition: '2005', maxSpacingM: [16.7, 17.4, 18.0, 18.6, 19.1, 19.6, 20.1, 20.8, 21.3] },
  { classification: 'D50', edition: '2005', maxSpacingM: [18.0, 18.7, 19.4, 20.1, 20.7, 21.2, 21.8, 22.5, 23.2] },
  { classification: 'D63', edition: '2005', maxSpacingM: [19.4, 20.3, 21.1, 21.8, 22.4, 23.0, 23.7, 24.5, 25.2] },
  { classification: 'D80', edition: '2005', maxSpacingM: [21.1, 22.0, 22.8, 23.6, 24.3, 25.0, 25.8, 26.7, 27.5] },
  { classification: 'D25', edition: '2018', maxSpacingM: [11.5, 13.2, 14.8, 15.7, 16.1, 16.4, 16.8, 17.3, 17.6] },
  { classification: 'D32', edition: '2018', maxSpacingM: [11.5, 13.2, 14.8, 16.5, 17.6, 18.0, 18.5, 19.0, 19.5] },
  { classification: 'D40', edition: '2018', maxSpacingM: [11.5, 13.2, 14.8, 16.5, 18.1, 19.5, 20.1, 20.7, 21.2] },
  { classification: 'D50', edition: '2018', maxSpacingM: [11.5, 13.2, 14.8, 16.5, 18.1, 19.8, 21.8, 22.5, 23.1] },
  { classification: 'D63', edition: '2018', maxSpacingM: [11.5, 13.2, 14.8, 16.5, 18.1, 19.8, 22.0, 24.5, 25.2] },
  { classification: 'D80', edition: '2018', maxSpacingM: [11.5, 13.2, 14.8, 16.5, 18.1, 19.8, 22.0, 24.7, 27.5] },
];

/** The classifications the sourced tables cover, for a picker or an error message. */
export const KNOWN_CLASSIFICATIONS = ['D25', 'D32', 'D40', 'D50', 'D63', 'D80'] as const;

/**
 * Maximum spacing for a class at a tabulated mounting height.
 *
 * Returns nothing at any height that is not tabulated. Interpolating between
 * two rows of a photometric table is not arithmetic, it is design, and this app
 * does not do design.
 */
export function maxSpacing(
  classification: string,
  mountingHeightM: number,
  edition: SpacingEdition,
): number | undefined {
  const wanted = classification.trim().toUpperCase();
  const row = SPACING_02_LUX.find((r) => r.classification === wanted && r.edition === edition);
  if (!row) return undefined;
  const idx = TABULATED_HEIGHTS_M.findIndex((h) => h === mountingHeightM);
  if (idx < 0) return undefined;
  return row.maxSpacingM[idx];
}

/**
 * One luminaire may not serve more than this floor area, whatever the spacing
 * tables allow. Trade guidance, so a prompt to check rather than a verdict.
 */
export const MAX_AREA_PER_LUMINAIRE_M2 = 500;

export interface SpacingSenseCheck {
  known: true;
  /**
   * Always true, and always surfaced. This is a plausibility check on a count
   * that already exists on site. It is not a design, it does not consider
   * obstructions, ceiling voids, reflectances, room shape, paths of travel,
   * changes of level, or the 1 lux stairway requirement, and no design decision
   * may be made from it.
   */
  isSenseCheckNotDesign: true;
  roomLengthM: number;
  roomWidthM: number;
  areaM2: number;
  mountingHeightM: number;
  classification: string;
  edition: SpacingEdition;
  maxSpacingM: number;
  /** Fittings along each axis on a grid at the tabulated maximum spacing. */
  alongLength: number;
  alongWidth: number;
  /** The fewest fittings a grid at maximum spacing would need. */
  expectedMinimumCount: number;
  installedCount: number;
  plausible: boolean;
  shortfall: number;
  /** Floor area each installed fitting is covering. */
  areaPerFittingM2: number;
  statement: string;
  caveats: string[];
  sourceIds: SourceId[];
}

/**
 * Does the number of fittings in this room look anything like enough?
 *
 * The honest use of this is a walk-in sanity check: a 30 m by 15 m warehouse
 * with two emergency lights in it is wrong and a technician should say so in the
 * report. It is deliberately crude — a rectangular grid at the tabulated
 * maximum spacing — and it carries its own disclaimer in the data so that
 * disclaimer cannot be dropped on the way to the screen or the report.
 *
 * It refuses on anything it cannot look up, rather than interpolating, because
 * a plausible-looking number here would be read as a design figure no matter
 * how it was labelled.
 */
export function spacingSenseCheck(args: {
  roomLengthM: number;
  roomWidthM: number;
  mountingHeightM: number;
  classification: string;
  edition: SpacingEdition;
  installedCount: number;
}): SpacingSenseCheck | Refused {
  const { roomLengthM, roomWidthM, mountingHeightM, installedCount } = args;
  const classification = args.classification.trim().toUpperCase();

  for (const [name, value] of [['length', roomLengthM], ['width', roomWidthM]] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      return {
        known: false,
        reason: `"${String(value)}" is not a room ${name} in metres.`,
        whatToDo: 'Enter the room as a rectangle in metres. An irregular space has to be broken into rectangles first.',
        sourceIds: ['clevertronics-spacing'],
      };
    }
  }
  if (!Number.isInteger(installedCount) || installedCount < 0) {
    return {
      known: false,
      reason: `"${String(installedCount)}" is not a number of fittings.`,
      whatToDo: 'Count the emergency luminaires in this room. Exit signs on their own do not count towards it.',
      sourceIds: ['clevertronics-spacing'],
    };
  }
  if (args.edition !== '2005' && args.edition !== '2018') {
    return {
      known: false,
      reason: `"${String(args.edition)}" is not an edition of AS/NZS 2293.1 this app has spacing data for.`,
      whatToDo:
        'State which edition the installation was designed to — 2005 or 2018. They give different answers, by up to '
        + 'nine metres at low mounting heights, so this cannot be assumed.',
      sourceIds: ['clevertronics-spacing'],
    };
  }
  if (!KNOWN_CLASSIFICATIONS.some((c) => c === classification)) {
    return {
      known: false,
      reason: `No spacing data for classification "${args.classification}".`,
      whatToDo:
        `Read the classification off the luminaire's datasheet. This app has ${KNOWN_CLASSIFICATIONS.join(', ')} only, `
        + 'from one manufacturer, on the 0.2 lux basis. Anything else has to come from the fitting’s own tables.',
      sourceIds: ['clevertronics-spacing', 'abb-stanilite-class'],
    };
  }
  const spacing = maxSpacing(classification, mountingHeightM, args.edition);
  if (spacing === undefined) {
    return {
      known: false,
      reason: `No spacing figure for ${classification} at a mounting height of ${mountingHeightM} m.`,
      whatToDo:
        `The tables carry ${TABULATED_HEIGHTS_M.join(', ')} m and nothing between. Measure the mounting height to the `
        + 'nearest tabulated value and use that, or read the fitting’s own table. This app will not interpolate.',
      sourceIds: ['clevertronics-spacing'],
    };
  }

  const alongLength = Math.ceil(roomLengthM / spacing);
  const alongWidth = Math.ceil(roomWidthM / spacing);
  const expectedMinimumCount = alongLength * alongWidth;
  const areaM2 = round1(roomLengthM * roomWidthM);
  const shortfall = Math.max(0, expectedMinimumCount - installedCount);
  const areaPerFittingM2 = installedCount > 0 ? round1(areaM2 / installedCount) : areaM2;

  const caveats = [
    'A sense-check only. This is not a lighting design, it has no standing, and no fitting may be added, moved or '
    + 'omitted on the strength of it.',
    'It assumes an empty rectangle on a regular grid. Obstructions, room shape, ceiling voids, surface reflectances '
    + 'and the actual paths of travel are all ignored, and every one of them changes the answer.',
    'It uses the 0.2 lux general-area basis. Stairways, flights and landings are assessed at 1 lux and need closer '
    + 'spacing than anything here.',
    'It says nothing about the fittings within 2 m of exit doors, direction changes, intersections and changes of '
    + 'level that are required regardless of spacing.',
  ];
  if (installedCount > 0 && areaPerFittingM2 > MAX_AREA_PER_LUMINAIRE_M2) {
    caveats.push(
      `Each fitting is covering about ${areaPerFittingM2} m². Trade guidance puts a ceiling of `
      + `${MAX_AREA_PER_LUMINAIRE_M2} m² per luminaire regardless of what the spacing tables allow — worth checking `
      + 'against the design.',
    );
  }

  return {
    known: true,
    isSenseCheckNotDesign: true,
    roomLengthM,
    roomWidthM,
    areaM2,
    mountingHeightM,
    classification,
    edition: args.edition,
    maxSpacingM: spacing,
    alongLength,
    alongWidth,
    expectedMinimumCount,
    installedCount,
    plausible: installedCount >= expectedMinimumCount,
    shortfall,
    areaPerFittingM2,
    statement:
      installedCount >= expectedMinimumCount
        ? `${installedCount} fittings in ${areaM2} m² is plausible: a grid at the ${spacing} m maximum spacing for a `
          + `${classification} fitting at ${mountingHeightM} m would need at least ${expectedMinimumCount}.`
        : `${installedCount} fittings in ${areaM2} m² looks short by ${shortfall}: a grid at the ${spacing} m maximum `
          + `spacing for a ${classification} fitting at ${mountingHeightM} m would need at least `
          + `${expectedMinimumCount}. Worth raising for a designer to look at.`,
    caveats,
    sourceIds: ['clevertronics-spacing', 'abb-stanilite-class', 'elecas-design', 'as2293-1'],
  };
}

// ===========================================================================
// Battery age and replacement
// ===========================================================================

/**
 * The design life of the battery in a self-contained emergency luminaire.
 *
 * A product design life from the luminaire standard, not a replacement date and
 * not a requirement of AS/NZS 2293. Reaching it obliges nothing at all. What
 * replaces a battery is a discharge test it cannot pass — which is why this
 * module reports age beside the test result and never instead of it.
 */
export const BATTERY_DESIGN_LIFE_YEARS = 4;

export const BATTERY_LIFE_CAVEAT =
  'Age alone is not a defect. A battery past its design life that still holds the full duration is compliant, and a '
  + 'battery inside its design life that does not is not. The discharge test decides; the age only says what to '
  + 'expect.';

/**
 * Reads a date the Australian way, and refuses anything else.
 *
 * Accepts d/m/yyyy and ISO yyyy-mm-dd. It will not read 4/13/2020 as April the
 * thirteenth: a first field over twelve is a month that does not exist, and the
 * only safe thing to do with an American date in an Australian app is to reject
 * it loudly. Silently swapping the fields would put an install date eleven
 * months out into a replacement forecast.
 */
export function parseAuDate(text: string): { y: number; m: number; d: number } | undefined {
  const s = text.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return validDate(y, m, d) ? { y, m, d } : undefined;
  }
  const au = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (!au) return undefined;
  const d = Number(au[1]);
  const m = Number(au[2]);
  const raw = Number(au[3]);
  // A two-digit year in a field register is this century. A fitting installed in
  // 1925 is not a thing anyone is testing.
  const y = au[3]!.length === 2 ? 2000 + raw : raw;
  return validDate(y, m, d) ? { y, m, d } : undefined;
}

function validDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO for storage; the screen and the report format it d/m/yyyy. */
export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** d/m/yyyy, which is the only date format this app prints. */
export function formatAuDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

export interface BatteryAge {
  known: true;
  installedOn: string;
  /** Whole years to one decimal, which is the precision worth quoting. */
  ageYears: number;
  designLifeYears: number;
  /** True where the design life figure came from the caller rather than the default. */
  designLifeFromManufacturer: boolean;
  expectedReplacementDate: string;
  pastDesignLife: boolean;
  /** Years remaining, or 0 once past. */
  yearsRemaining: number;
  statement: string;
  caveat: string;
  sourceIds: SourceId[];
}

/**
 * How old the battery is and when it was expected to need replacing.
 *
 * Deliberately shaped like `serviceLife` in src/calc/deviceAge.ts, and for the
 * same reason: the sentence a report prints about age has to make clear that
 * age is a prompt, not a finding.
 */
export function batteryAge(args: {
  installedOn: string;
  at: Date;
  /** The manufacturer's own figure for this fitting, where it is known. */
  designLifeYears?: number;
}): BatteryAge | Refused {
  const parsed = parseAuDate(args.installedOn);
  if (!parsed) {
    return {
      known: false,
      reason: `"${args.installedOn}" is not a date this app will read.`,
      whatToDo:
        'Enter the install date as d/m/yyyy or yyyy-mm-dd. A date with the month first is rejected rather than '
        + 'guessed at — 4/13/2020 has no thirteenth month, and 4/12/2020 would be read as 4 December.',
      sourceIds: ['iec-60598-2-22'],
    };
  }
  const installedMs = Date.UTC(parsed.y, parsed.m - 1, parsed.d);
  if (installedMs > args.at.getTime()) {
    return {
      known: false,
      reason: `An install date of ${formatAuDate(isoDate(parsed.y, parsed.m, parsed.d))} is in the future.`,
      whatToDo: 'Check the date on the fitting or in the register. A future date is usually a year typed wrong.',
      sourceIds: ['iec-60598-2-22'],
    };
  }

  const fromManufacturer = args.designLifeYears !== undefined
    && Number.isFinite(args.designLifeYears)
    && args.designLifeYears > 0;
  const life = fromManufacturer ? args.designLifeYears! : BATTERY_DESIGN_LIFE_YEARS;

  const ageYears = round1((args.at.getTime() - installedMs) / (365.25 * 24 * 3_600_000));

  // Calendar arithmetic, not 365.25 days times the life — a replacement date
  // that lands on the 29th of February in a year without one has to fall back
  // to the 28th rather than slide into March.
  const whole = Math.floor(life);
  const extraMonths = Math.round((life - whole) * 12);
  const targetYear = parsed.y + whole + Math.floor((parsed.m - 1 + extraMonths) / 12);
  const targetMonth = ((parsed.m - 1 + extraMonths) % 12) + 1;
  const targetDay = Math.min(parsed.d, new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate());
  const expected = isoDate(targetYear, targetMonth, targetDay);

  const past = args.at.getTime() >= Date.UTC(targetYear, targetMonth - 1, targetDay);
  const remaining = past ? 0 : round1(life - ageYears);

  return {
    known: true,
    installedOn: isoDate(parsed.y, parsed.m, parsed.d),
    ageYears,
    designLifeYears: life,
    designLifeFromManufacturer: fromManufacturer,
    expectedReplacementDate: expected,
    pastDesignLife: past,
    yearsRemaining: remaining,
    statement: past
      ? `${ageYears} years old — past the ${life}-year design life, which was reached on ${formatAuDate(expected)}.`
      : `${ageYears} years old — ${remaining} years inside the ${life}-year design life, which is reached on `
        + `${formatAuDate(expected)}.`,
    caveat: BATTERY_LIFE_CAVEAT,
    sourceIds: fromManufacturer ? ['as2293-2'] : ['iec-60598-2-22', 'as2293-2'],
  };
}

export type BatteryAction = 'none' | 'monitor' | 'replace-planned' | 'replace-now' | 'investigate' | 'unknown';

export interface BatteryAdvice {
  action: BatteryAction;
  statement: string;
  /** Why this and not something else, for the technician and for the report. */
  reasoning: string;
}

/**
 * Age and test result together, which is the only way either means anything.
 *
 * The case worth having code for is the last one: a battery that fails well
 * inside its design life. Replacing it is the obvious move and the wrong one —
 * a two-year-old battery that will not hold ninety minutes has usually been
 * cooked by a faulty charger or left sitting on test, and the replacement will
 * be back on the defect list next service.
 */
export function batteryAdvice(verdict: DischargeVerdict, ageResult?: BatteryAge | Refused): BatteryAdvice {
  // A refused age is the same as no age at all for the purposes of advice: the
  // test result still stands on its own, and the reason for the refusal belongs
  // beside the date field, not buried in a recommendation.
  const age = ageResult?.known ? ageResult : undefined;

  if (verdict.outcome === 'no-illumination') {
    return {
      action: 'investigate',
      statement: 'Find out why it did not light before ordering anything.',
      reasoning:
        'A fitting that never illuminated has not shown a battery problem. Lamp, driver, battery connection, or a '
        + 'supply that was never actually removed are all more likely, and a new battery fixes none of them.',
    };
  }
  if (verdict.outcome === 'inconclusive' || verdict.outcome === 'unreadable') {
    return {
      action: 'unknown',
      statement: 'No advice — the fitting has not been tested to a result.',
      reasoning: verdict.reason ?? 'The discharge test did not produce a verdict.',
    };
  }
  if (verdict.outcome === 'failed-early') {
    if (age && !age.pastDesignLife) {
      return {
        action: 'investigate',
        statement:
          `Replace the battery, and find out why a ${age.ageYears}-year-old battery failed inside its `
          + `${age.designLifeYears}-year design life.`,
        reasoning:
          'Premature failure is usually the charger, a fitting left on test, or heat — not the battery. Replacing the '
          + 'battery alone will put this fitting back on the defect list at the next service.',
      };
    }
    return {
      action: 'replace-now',
      statement: 'Replace the battery, or the fitting where the battery is not serviceable, and re-test in full.',
      reasoning: age
        ? `The battery is ${age.ageYears} years old, past its ${age.designLifeYears}-year design life, and no longer `
          + 'holds the required duration. Both facts point the same way.'
        : 'The battery no longer holds the required duration. That is the defect, whatever its age.',
    };
  }
  if (verdict.outcome === 'marginal-pass') {
    return {
      action: 'replace-planned',
      statement: 'Not a defect today. Plan the battery replacement before the next service.',
      reasoning:
        `The fitting reached the required duration with ${verdict.marginMinutes ?? 0} minutes in hand. Six months of `
        + 'further ageing will take that away, so this is cheaper to do with the next scheduled attendance than as a '
        + 'return visit for a defect.',
    };
  }
  // A clear pass.
  if (age && age.pastDesignLife) {
    return {
      action: 'monitor',
      statement: 'No action. Past design life but holding the full duration.',
      reasoning: BATTERY_LIFE_CAVEAT,
    };
  }
  return {
    action: 'none',
    statement: 'No action.',
    reasoning: 'The fitting holds the required duration and the battery is inside its design life.',
  };
}

// ===========================================================================
// Whole-site summary
// ===========================================================================

export interface FittingResult {
  assetId: string;
  location?: string;
  classification: Classification;
  /** Absent where the fitting was not tested at this attendance. */
  discharge?: DischargeInput;
  /** Why it was not tested — no access, tenancy locked, ladder needed. */
  notTestedReason?: string;
  /** Where the fitting is fed from a central unit, which one. */
  centralSystemId?: string;
}

export interface SiteEmergencyLightingSummary {
  /** Fittings on the register for this site. */
  total: number;
  tested: number;
  notTested: number;
  /** Clear passes plus marginal passes. */
  passed: number;
  clearPasses: number;
  marginalPasses: number;
  failed: number;
  /** Tests that produced no verdict, which are neither passes nor failures. */
  noVerdict: number;
  byOutcome: Record<DischargeOutcome, number>;
  /** Failed fittings by cause, in the words a report uses. */
  failuresByCause: { cause: string; count: number; defectCode?: string }[];
  /** Passes as a percentage of fittings tested, to one decimal. Undefined where nothing was tested. */
  passRatePercent?: number;
  /** Passes as a percentage of the whole register. Undefined where the register is empty. */
  coverageRatePercent?: number;
  /**
   * Three-valued on purpose. `undefined` means it cannot be said, which is the
   * answer whenever part of the register went untested — a sample proves
   * nothing about a site.
   */
  compliant?: boolean;
  compliantStatement: string;
  /** Central systems with a failure against them, and how many fittings each serves. */
  centralSystemsAffected: { centralSystemId: string; fittingsOnSystem: number; failures: number }[];
  /** What this summary does not cover. Always populated; never optional. */
  caveats: string[];
  sourceIds: SourceId[];
}

/**
 * What may honestly be said about a site's emergency lighting.
 *
 * The compliance answer is three-valued and the middle value is the important
 * one. `true` needs every fitting on the register tested and every one passed.
 * `false` follows from a single failure. Everything else — an untested fitting,
 * a test stopped early, a record that will not read — is `undefined`, because
 * "we tested most of them and they were fine" is not a compliance statement and
 * a client will read it as one.
 *
 * The caveats are part of the data rather than prose added by whatever screen
 * or report renders it, so that a summary can never travel without them.
 */
export function summariseSite(fittings: FittingResult[]): SiteEmergencyLightingSummary {
  const byOutcome: Record<DischargeOutcome, number> = {
    pass: 0,
    'marginal-pass': 0,
    'failed-early': 0,
    'no-illumination': 0,
    inconclusive: 0,
    unreadable: 0,
  };

  let tested = 0;
  const failuresOnCentral = new Map<string, number>();
  const fittingsOnCentral = new Map<string, number>();

  for (const f of fittings) {
    if (f.centralSystemId) {
      fittingsOnCentral.set(f.centralSystemId, (fittingsOnCentral.get(f.centralSystemId) ?? 0) + 1);
    }
    if (!f.discharge) continue;
    tested += 1;
    const verdict = assessDischarge(f.discharge);
    byOutcome[verdict.outcome] += 1;
    if (verdict.passed === false && f.centralSystemId) {
      failuresOnCentral.set(f.centralSystemId, (failuresOnCentral.get(f.centralSystemId) ?? 0) + 1);
    }
  }

  const total = fittings.length;
  const notTested = total - tested;
  const clearPasses = byOutcome.pass;
  const marginalPasses = byOutcome['marginal-pass'];
  const passed = clearPasses + marginalPasses;
  const failed = byOutcome['failed-early'] + byOutcome['no-illumination'];
  const noVerdict = byOutcome.inconclusive + byOutcome.unreadable;

  const failuresByCause = [
    {
      cause: 'Extinguished before the required duration — battery at end of life',
      count: byOutcome['failed-early'],
      defectCode: 'EEL-FIT-001',
    },
    {
      cause: 'Did not illuminate at all — lamp, driver, connection, or supply not removed',
      count: byOutcome['no-illumination'],
      defectCode: 'EEL-FIT-002',
    },
  ].filter((c) => c.count > 0);

  let compliant: boolean | undefined;
  let compliantStatement: string;
  if (total === 0) {
    compliantStatement =
      'No emergency lighting is recorded against this site. That is either a site with none, or a register that was '
      + 'never populated, and this app cannot tell which.';
  } else if (failed > 0) {
    compliant = false;
    compliantStatement =
      `Not compliant. ${failed} of ${total} fittings failed the discharge test and each is a defect requiring `
      + 'rectification.';
  } else if (notTested > 0 || noVerdict > 0) {
    const parts: string[] = [];
    if (notTested > 0) parts.push(`${notTested} not tested`);
    if (byOutcome.inconclusive > 0) parts.push(`${byOutcome.inconclusive} stopped before the required duration`);
    if (byOutcome.unreadable > 0) parts.push(`${byOutcome.unreadable} with a result that cannot be read`);
    compliantStatement =
      `Cannot be stated. Nothing failed, but ${parts.join(', ')} of ${total} fittings. A site is not compliant `
      + 'because a sample of it passed, and this report must not be written as though it were.';
  } else {
    compliant = true;
    compliantStatement =
      `Every one of the ${total} fittings on the register was tested and passed the discharge test. That is the whole `
      + 'of what has been established — see the caveats.';
  }

  const caveats: string[] = [
    'Covers the discharge test and what was observed at this attendance. It is not a statement that the emergency '
    + 'lighting design is adequate: coverage, spacing, illuminance and exit sign placement are design matters and none '
    + 'of them were assessed.',
    'A fitting missing from the register was not tested and does not appear in these numbers at all. The register '
    + 'being right is an assumption, not a finding.',
  ];
  if (marginalPasses > 0) {
    caveats.push(
      `${marginalPasses} ${marginalPasses === 1 ? 'fitting' : 'fittings'} passed with very little reserve. They are `
      + 'not defects today and are likely to be at the next service — quote the batteries now rather than returning.',
    );
  }
  if (byOutcome.inconclusive > 0) {
    caveats.push(
      `${byOutcome.inconclusive} discharge ${byOutcome.inconclusive === 1 ? 'test was' : 'tests were'} stopped before `
      + 'the required duration. Those fittings are untested, not passed.',
    );
  }
  if (notTested > 0) {
    const reasons = fittings
      .filter((f) => !f.discharge && f.notTestedReason)
      .map((f) => f.notTestedReason!);
    caveats.push(
      reasons.length
        ? `${notTested} fittings were not tested. Reasons recorded: ${[...new Set(reasons)].join('; ')}.`
        : `${notTested} fittings were not tested and no reason was recorded against them.`,
    );
  }

  const centralSystemsAffected = [...failuresOnCentral.entries()]
    .map(([centralSystemId, failures]) => ({
      centralSystemId,
      fittingsOnSystem: fittingsOnCentral.get(centralSystemId) ?? 0,
      failures,
    }))
    .sort((a, b) => b.failures - a.failures);

  for (const c of centralSystemsAffected) {
    caveats.push(
      `${c.failures} of the ${c.fittingsOnSystem} luminaires on central system ${c.centralSystemId} failed. A central `
      + 'system failure is one fault with many symptoms — test the central unit before raising a defect against each '
      + 'luminaire.',
    );
  }

  return {
    total,
    tested,
    notTested,
    passed,
    clearPasses,
    marginalPasses,
    failed,
    noVerdict,
    byOutcome,
    failuresByCause,
    passRatePercent: tested > 0 ? round1((passed / tested) * 100) : undefined,
    coverageRatePercent: total > 0 ? round1((passed / total) * 100) : undefined,
    compliant,
    compliantStatement,
    centralSystemsAffected,
    caveats,
    sourceIds: ['as2293-2', 'ncc-e4', 'atts-intervals'],
  };
}
