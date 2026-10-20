/**
 * Sound pressure level for occupant warning systems.
 *
 * The EWIS annual routine carries a line item called "Sound pressure level" and
 * until now there was nothing behind it. A technician stood in a room with a
 * meter, wrote a number on the sheet, and had nothing to check it against —
 * and the effectiveness report Safe QLD issues had to state in writing that no
 * acoustic assessment was performed. That statement is honest, but it leaves
 * the question a client actually asks unanswered on the day: is the back
 * bedroom covered, and by how much?
 *
 * This module is the arithmetic for that question and deliberately nothing
 * more. Three things about it have to stay clear or it does harm:
 *
 *  - **It is a free-field, point-source estimate.** Level falls 6 dB per
 *    doubling of distance, with no reflections, no absorption, and no
 *    allowance for how a particular device radiates. Real rooms are not free
 *    field. Past the critical distance — where reflected sound equals direct
 *    sound — the level stops falling and flattens out, which happens within a
 *    few metres in a hard corridor or stairwell. So this arithmetic reads LOW
 *    in a live room, while saying nothing at all about intelligibility, which
 *    reverberation destroys long before level becomes a problem.
 *  - **Decibels do not add.** Two 85 dB sources make 88 dB, not 170, and a
 *    source 30 dB down adds nothing a meter can see. Every addition here is
 *    logarithmic, and the one place technicians get caught — subtracting
 *    ambient out of a meter reading taken with the alarm running — refuses to
 *    answer when the two readings are too close to tell apart.
 *  - **It is not a compliance verdict.** A pass here means the arithmetic does
 *    not rule coverage out. It does not mean the system complies with anything.
 *
 * Every threshold carries where it came from and how much it is trusted, in
 * the data rather than in a comment — and so does every clause number, because
 * a clause number is a fact from outside this file like any other and the
 * publisher's shop listing is not what establishes it. The Australian
 * Standards themselves are licensed per copy and are not reproduced here: what
 * is recorded is clause numbers, figures as understood from public sources,
 * and our own words. Where the only sources are trade publications, the figure
 * is marked low confidence and says so on screen — a starting point for a
 * check against a licensed copy, not the copy itself.
 */

export type Confidence = 'high' | 'medium' | 'low';

/** A value that came from somewhere other than this file's own arithmetic. */
export interface Sourced<T> {
  value: T;
  /** Who published it, named plainly enough to go looking for. */
  source: string;
  /** The page or document actually used. */
  url: string;
  confidence: Confidence;
  /** Anything that changes how the figure should be read. */
  note?: string;
}

export type SourcedDb = Sourced<number>;

/**
 * A clause reference. The number is a fact; the wording behind it is not ours
 * to carry.
 *
 * The number is a fact that came from somewhere, so it carries its own
 * provenance. A store listing proves the standard exists and nothing else — it
 * is where to buy the document, not evidence that a requirement sits at 4.7
 * rather than 4.3.4. A clause number printed in a client document and later
 * found to be the wrong one reads as carelessness about everything else in the
 * report, so the ones only trade commentary supports say so.
 */
export interface ClauseRef {
  /** How a technician cites it: "AS 1670.1:2018". */
  standard: string;
  /** As printed in the document: "3.22". */
  clause: string;
  /** The clause heading, which is a title rather than the requirement text. */
  title: string;
  /** The publisher's own page for the document. Where to buy it, nothing more. */
  url: string;
  /** How well the clause NUMBER itself is established. */
  numberConfidence: Confidence;
  /** What establishes the number, which is never the store listing. */
  numberSource: string;
  numberSourceUrl?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// What this calculation is and is not
// ---------------------------------------------------------------------------

export const CALCULATION_BASIS =
  'Free field: level drops 6 dB per doubling of distance. No reflections or absorption.';

export const REVERBERANT_LIMIT =
  'In hard rooms and corridors the level stops falling after a few metres. Reads low there.';

export const NOT_AN_ACOUSTIC_ASSESSMENT = 'Estimate only. Confirm with a meter.';

/**
 * Distance beyond which the free-field estimate is reported as out of its depth
 * indoors.
 *
 * Not a figure from any standard, and it is not pretending to be one. It is the
 * distance at which, in ordinary building rooms, reflected sound usually
 * matters more than the direct sound this arithmetic models. It exists so the
 * tool says "I am past the point where I am reliable" rather than printing a
 * number to one decimal place and letting the technician assume it means
 * something.
 */
export const FREE_FIELD_INDOOR_LIMIT_M = 10;

/**
 * Smallest gap between a total reading and an ambient reading that still allows
 * the signal to be worked out from the two.
 *
 * Below this the answer swings wildly on a tenth of a decibel, which is inside
 * the tolerance of any meter carried on a service round. Two readings a
 * half-decibel apart do not establish a signal; they establish that the alarm
 * made no measurable difference.
 */
export const MIN_SEPARATION_FOR_SUBTRACTION_DB = 1;

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Change in level, in dB, on moving from one distance to another.
 *
 * Negative moving away, positive moving closer. Undefined at or through zero
 * metres: the inverse square law has a pole at the source and returning
 * "infinity dB" for a listener standing on the sounder would be worse than
 * returning nothing.
 */
export function distanceChangeDb(fromM: number, toM: number): number | undefined {
  if (!Number.isFinite(fromM) || !Number.isFinite(toM)) return undefined;
  if (fromM <= 0 || toM <= 0) return undefined;
  return 20 * Math.log10(fromM / toM);
}

export type SpaceKind = 'outdoors' | 'enclosed-room' | 'corridor' | 'open-plan';

export const SPACE_LABEL: Record<SpaceKind, string> = {
  outdoors: 'Outdoors / open air',
  'enclosed-room': 'Enclosed room',
  corridor: 'Corridor or stairwell',
  'open-plan': 'Open plan floor',
};

export interface DistanceInput {
  /** The device's published output, in dB(A), at the distance it was rated at. */
  ratedDb: number;
  /** Distance the rating was taken at. Usually 1 m, but never assume it. */
  referenceDistanceM: number;
  /** Distance from the device to the listening position. */
  distanceM: number;
  space?: SpaceKind;
}

export interface DistanceResult {
  /** Estimated level at the listening position, dB(A), to one decimal. */
  db: number;
  /** How much was lost or gained relative to the rating. */
  changeDb: number;
  cautions: string[];
}

/**
 * Level at a distance, from a rated output at a reference distance.
 *
 * The reference distance is a required input rather than assumed to be one
 * metre. Sounder outputs are commonly published at 1 m, but loudspeaker
 * sensitivity is often quoted at 1 W into a nominal distance and some
 * manufacturers publish at 3 m — taking 1 m on faith overstates coverage by
 * nearly 10 dB on a 3 m figure, which is the difference between a pass and a
 * defect.
 */
export function splAtDistance(input: DistanceInput): DistanceResult | undefined {
  const exact = directLevelDb(input);
  if (exact === undefined) return undefined;
  const changeDb = distanceChangeDb(input.referenceDistanceM, input.distanceM)!;

  return {
    db: round1(exact),
    changeDb: round1(changeDb),
    cautions: regimeCautions(input.space ?? 'enclosed-room', input.distanceM, input.referenceDistanceM),
  };
}

/**
 * The same level, unrounded, for anything that goes on to compute with it.
 *
 * Rounding to the tenth a meter reads is right at the point a number is
 * *shown*, and wrong anywhere upstream of a comparison. A direct level of
 * 74.96 dB rounded to 75.0 and then held against a 75 dB floor passes a room
 * that is short — a verdict decided by the display format. Everything internal
 * works from this; round1 is applied once, on the way out.
 */
function directLevelDb(input: DistanceInput): number | undefined {
  if (!Number.isFinite(input.ratedDb)) return undefined;
  const changeDb = distanceChangeDb(input.referenceDistanceM, input.distanceM);
  if (changeDb === undefined) return undefined;
  return input.ratedDb + changeDb;
}

/**
 * Where the free-field assumption stops being worth anything.
 *
 * Returned with every result rather than printed once at the bottom of the
 * screen, because the caution that matters is the one attached to the number a
 * technician is about to write down.
 */
export function regimeCautions(space: SpaceKind, distanceM: number, referenceDistanceM: number): string[] {
  const out: string[] = [];

  if (distanceM < referenceDistanceM) {
    out.push(
      `Closer than the ${referenceDistanceM} m rating distance, in the near field. The estimate won't hold.`,
    );
  }

  if (space === 'corridor') {
    out.push(
      'A corridor is not free field. Expect the meter to read higher and speech to be worse.',
    );
  } else if (space !== 'outdoors' && distanceM > FREE_FIELD_INDOOR_LIMIT_M) {
    out.push(
      `Past ${FREE_FIELD_INDOOR_LIMIT_M} m indoors the reverberant field takes over. Treat this as a floor.`,
    );
  }

  if (space === 'outdoors') {
    out.push(
      'Wind, ground reflection and air absorption cut the level over long runs.',
    );
  }

  return out;
}

/**
 * Furthest a device still delivers a target level, on the same free-field basis.
 *
 * Refuses when the target is above the device’s own rating: the honest answer
 * would be a distance inside the reference distance, which is the near field
 * where this arithmetic does not apply. Returning "0.6 m" there would look like
 * a spacing answer and be used as one.
 */
export function maxDistanceForLevel(
  ratedDb: number,
  referenceDistanceM: number,
  targetDb: number,
): number | undefined {
  if (![ratedDb, referenceDistanceM, targetDb].every(Number.isFinite)) return undefined;
  if (referenceDistanceM <= 0) return undefined;
  if (targetDb > ratedDb) return undefined;
  return round1(referenceDistanceM * 10 ** ((ratedDb - targetDb) / 20));
}

/**
 * Rated output a device would need to hit a target at a distance.
 *
 * What you reach for when the room fails: how much louder does the replacement
 * have to be. Barrier loss is added back in because the device has to overcome
 * it.
 */
export function requiredRatedDb(
  targetDb: number,
  referenceDistanceM: number,
  distanceM: number,
  barrierLossDb = 0,
): number | undefined {
  if (![targetDb, barrierLossDb].every(Number.isFinite)) return undefined;
  const changeDb = distanceChangeDb(referenceDistanceM, distanceM);
  if (changeDb === undefined) return undefined;
  return round1(targetDb - changeDb + barrierLossDb);
}

// ---------------------------------------------------------------------------
// Adding sources
// ---------------------------------------------------------------------------

/**
 * Logarithmic sum of levels.
 *
 * Two 85 dB sounders in the same room make 88 dB, not 170, and doubling the
 * number of identical sources buys 3 dB every time. Ten of them make 95 dB —
 * which is why "add another sounder" is a much weaker fix than it sounds.
 *
 * An empty list returns nothing rather than 0 dB. Zero decibels is a real,
 * very quiet level (it is roughly the threshold of hearing), not the absence
 * of one, and a tool that confuses the two will happily report a silent room
 * as being at the threshold of hearing.
 */
export function addLevels(levels: number[]): number | undefined {
  const exact = addLevelsExact(levels);
  return exact === undefined ? undefined : round1(exact);
}

/** The same sum, unrounded, for anything that goes on to compare against it. */
function addLevelsExact(levels: number[]): number | undefined {
  if (!levels.length) return undefined;
  if (!levels.every(Number.isFinite)) return undefined;
  const total = levels.reduce((sum, db) => sum + 10 ** (db / 10), 0);
  return 10 * Math.log10(total);
}

/** What a meter reads with the alarm running: the signal on top of the ambient. */
export function signalPlusAmbient(signalDb: number, ambientDb: number): number | undefined {
  return addLevels([signalDb, ambientDb]);
}

export interface AmbientRemoval {
  ok: boolean;
  /** The signal on its own, dB(A). */
  db?: number;
  error?: string;
  caution?: string;
}

/**
 * The signal on its own, from a total reading and an ambient reading.
 *
 * This is the step that catches people. A meter reading taken while the alarm
 * is sounding already contains the ambient, so subtracting the two readings
 * arithmetically overstates the margin: a total exactly 10 dB above ambient
 * means a signal only 9.5 dB above it. Where the requirement is a 10 dB margin
 * that half-decibel decides the result.
 *
 * Refuses when the two readings are within {@link MIN_SEPARATION_FOR_SUBTRACTION_DB}
 * of each other, and refuses outright when the total is at or below the
 * ambient — that is not a quiet alarm, it is a measurement that cannot be true.
 */
export function removeAmbient(totalDb: number, ambientDb: number): AmbientRemoval {
  if (![totalDb, ambientDb].every(Number.isFinite)) {
    return { ok: false, error: 'Enter both readings.' };
  }
  if (totalDb <= ambientDb) {
    return {
      ok: false,
      error:
        `${round1(totalDb)} dB with the alarm on cannot be at or below the ${round1(ambientDb)} dB ambient. `
        + 'Re-take both at the same point.',
    };
  }
  if (totalDb - ambientDb < MIN_SEPARATION_FOR_SUBTRACTION_DB) {
    return {
      ok: false,
      error:
        `The alarm only added ${round1(totalDb - ambientDb)} dB, inside the tolerance of a field meter. `
        + 'It is inaudible over the ambient here.',
    };
  }

  const db = round1(10 * Math.log10(10 ** (totalDb / 10) - 10 ** (ambientDb / 10)));
  const caution = totalDb - ambientDb < 3
    ? 'Signal is close to the ambient. Treat this as approximate.'
    : undefined;
  return { ok: true, db, caution };
}

// ---------------------------------------------------------------------------
// What the level has to reach
// ---------------------------------------------------------------------------

export type OccupancyKind = 'non-sleeping' | 'sleeping';

export const OCCUPANCY_LABEL: Record<OccupancyKind, string> = {
  'non-sleeping': 'Normally occupied area',
  sleeping: 'Sleeping area',
};

/**
 * Confirmation that AS 1670.1 clause 3.22 is the clause the sound pressure
 * level requirement lives in comes from the Queensland regulator itself, in a
 * position statement about the NCC concession. That is a Queensland government
 * publication, freely available, and is the strongest source available for the
 * clause pointer without opening a licensed copy of the standard.
 */
const QFES_POSITION_URL =
  'https://www.fire.qld.gov.au/sites/default/files/2021-12/Sound-pressure-level-requirements-for-NCC-Specification.pdf';

/**
 * The trade sources the numeric thresholds come from.
 *
 * They agree with each other and with every technician who has quoted them,
 * but they are commentary on a standard rather than the standard, so
 * everything sourced from here is marked low confidence and says so wherever
 * it is shown. The standard itself is licensed per copy and its text is not in
 * this repository by design.
 */
const TRADE_SOURCE = 'Firewize (Australian fire protection contractor) technical guidance on warning system operation';
const TRADE_SOURCE_URL = 'https://firewize.com.au/help/legislation-codes-standards/operation-warning-system';

const UNVERIFIED_NOTE =
  'Read from published trade commentary, not from the standard itself. Confirm against a licensed '
  + 'copy before relying on it in a report.';

const AS_1670_1: ClauseRef = {
  standard: 'AS 1670.1:2018',
  clause: '3.22',
  title: 'Building occupant warning system',
  url: 'https://store.standards.org.au/product/as-1670-1-2018',
  numberConfidence: 'high',
  numberSource: 'Queensland Fire and Emergency Services position statement, which cites AS 1670.1 clause 3.22 by number',
  numberSourceUrl: QFES_POSITION_URL,
};

/**
 * The loudspeaker output clause, and the one number in this file that could not
 * be pinned down at all.
 *
 * The 2004 edition of AS 1670.4 is cited publicly with the loudspeaker output
 * requirement at 4.3.4, and nothing freely published names the clause in the
 * 2018 edition. 4.7 is what the trade commentary behind the thresholds uses, so
 * it is recorded — as a pointer to check, not as a citation to print. Whoever
 * opens a licensed copy should settle it.
 */
const AS_1670_4: ClauseRef = {
  standard: 'AS 1670.4:2018',
  clause: '4.7',
  title: 'Output from emergency loudspeakers',
  url: 'https://store.standards.org.au/product/as-1670-4-2018',
  numberConfidence: 'low',
  numberSource: TRADE_SOURCE,
  numberSourceUrl: TRADE_SOURCE_URL,
  note:
    'The clause number is unconfirmed. Public references to the 2004 edition put the loudspeaker '
    + 'output requirement at 4.3.4, and no free source names it in the 2018 edition. Confirm before '
    + 'citing it to a client.',
};

const AS_1670_4_INTELLIGIBILITY: ClauseRef = {
  standard: 'AS 1670.4:2018',
  clause: '4.9',
  title: 'Intelligibility',
  url: 'https://store.standards.org.au/product/as-1670-4-2018',
  numberConfidence: 'low',
  numberSource: TRADE_SOURCE,
  numberSourceUrl: TRADE_SOURCE_URL,
  note: 'The clause number comes from trade commentary rather than the standard. Confirm before citing it.',
};

export interface SplRequirement {
  kind: OccupancyKind;
  label: string;
  /** The floor the signal must reach whatever the ambient is. */
  minimumDb: SourcedDb;
  /** The ceiling it must not exceed, where one is sourced. */
  maximumDb?: SourcedDb;
  /** How far above the ambient the signal has to sit. */
  marginAboveAmbientDb?: SourcedDb;
  /** How long the ambient is averaged over before the margin is applied. */
  ambientAveragingSeconds?: Sourced<number>;
  /** Where the measurement is taken. Our words, not the standard's. */
  measurementPoint: string;
  clauses: ClauseRef[];
}

/**
 * The floor, the margin over ambient and the ceiling, as the office confirmed
 * them against a licensed copy of AS 1670.1. Clause number and figures only;
 * the clause text is not reproduced.
 */
const AS_1670_1_SOURCE = 'AS 1670.1:2018 clause 3.22.3';
const AS_1670_1_URL = 'https://store.standards.org.au/product/as-1670-1-2018';

const fromAs16701 = (value: number): SourcedDb => ({
  value,
  source: AS_1670_1_SOURCE,
  url: AS_1670_1_URL,
  confidence: 'high',
});

export const SPL_REQUIREMENTS: Record<OccupancyKind, SplRequirement> = {
  'non-sleeping': {
    kind: 'non-sleeping',
    label: 'Normally occupied area',
    minimumDb: fromAs16701(65),
    maximumDb: fromAs16701(105),
    marginAboveAmbientDb: fromAs16701(10),
    ambientAveragingSeconds: {
      value: 60,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    measurementPoint: 'Anywhere a person would normally be in the zone, at head height.',
    clauses: [AS_1670_1, AS_1670_4],
  },
  sleeping: {
    kind: 'sleeping',
    label: 'Sleeping area',
    minimumDb: fromAs16701(75),
    maximumDb: fromAs16701(105),
    marginAboveAmbientDb: fromAs16701(10),
    ambientAveragingSeconds: {
      value: 60,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    measurementPoint: 'At the bedhead, with the doors on the path closed.',
    clauses: [AS_1670_1, AS_1670_4],
  },
};

/** The one-line source shown under the result. */
export const SPL_SOURCE_NOTE =
  `${AS_1670_1_SOURCE}: ${SPL_REQUIREMENTS['non-sleeping'].minimumDb.value} dB(A) min, or `
  + `${SPL_REQUIREMENTS['non-sleeping'].marginAboveAmbientDb!.value} dB over ambient if higher. `
  + `${SPL_REQUIREMENTS.sleeping.minimumDb.value} dB(A) at the bedhead. `
  + `${SPL_REQUIREMENTS['non-sleeping'].maximumDb!.value} dB(A) max.`;

/** The intelligibility requirement, which level alone does not answer. */
export const INTELLIGIBILITY_CLAUSE = AS_1670_4_INTELLIGIBILITY;

export const INTELLIGIBILITY_NOTE = 'Loud enough is not the same as intelligible. Test speech with an STI meter.';

/**
 * The NCC concession that lets a sole-occupancy unit be assessed from outside
 * its own front door, and the Queensland position on it.
 *
 * Worth carrying because it is the difference between measuring in a corridor
 * and knocking on ninety doors, and because Queensland reads it more narrowly
 * than the NCC text suggests. Both figures are from freely published Crown
 * material and were read from the documents themselves, so they carry higher
 * confidence than anything sourced from trade commentary above.
 */
export interface SouDoorConcession {
  id: string;
  /** The kind of system installed in the units. */
  label: string;
  atDoorDb: SourcedDb;
}

export const SOU_DOOR_CONCESSIONS: SouDoorConcession[] = [
  {
    id: 'smoke-alarms',
    label: 'Smoke alarm based warning system in the units',
    atDoorDb: {
      value: 85,
      source: 'Queensland Fire and Emergency Services position statement, quoting NCC Specification E2.2a clause 7(a) and (b) — NCC 2022 Specification 20 clause S20C7',
      url: QFES_POSITION_URL,
      confidence: 'high',
      note: 'Measured at the door giving access to the sole-occupancy unit, in place of a reading inside it.',
    },
  },
  {
    id: 'smoke-detectors',
    label: 'Smoke detection based warning system in the units',
    atDoorDb: {
      value: 100,
      source: 'Queensland Fire and Emergency Services position statement, quoting NCC Specification E2.2a clause 7(a) and (b) — NCC 2022 Specification 20 clause S20C7',
      url: QFES_POSITION_URL,
      confidence: 'high',
      note: 'Measured at the door giving access to the sole-occupancy unit, in place of a reading inside it.',
    },
  },
];

export const QFES_CONCESSION_POSITION =
  'QFES (12/2021): the clause 7(b) door concession only covers clause 4(b) systems, with detectors in '
  + 'each unit. For a clause 5 system, measure inside the unit to AS 1670.1 clause 3.22.';

// ---------------------------------------------------------------------------
// Barriers
// ---------------------------------------------------------------------------

export interface Barrier {
  id: string;
  label: string;
  lossDb: SourcedDb;
}

/**
 * Indicative loss through a closed door.
 *
 * This is the reason a bathroom or an ensuite with no device of its own is a
 * real finding rather than a pedantic one: a room that measures comfortably at
 * the doorway loses roughly twenty decibels the moment the door shuts, which
 * takes a pass straight through the floor. AS 1670 publishes no barrier figure
 * at all, so the numbers here come from British practice by way of a
 * manufacturer's design guide. They are marked low confidence and are
 * indicative only — they support a conversation about where a device is
 * missing, never a compliance statement.
 */
export const BARRIERS: Barrier[] = [
  {
    id: 'closed-door',
    label: 'Closed ordinary door',
    lossDb: {
      value: 20,
      source: "Apollo Fire Detectors pocket guide to BS 5839-1 system design, section 2 clause 15",
      url: 'https://apollo-fire.co.uk/wp-content/uploads/2025/10/apollo-pocket-guide_BS_5839-1_2025.pdf',
      confidence: 'low',
      note:
        'British practice. AS 1670 publishes no equivalent figure, so this is indicative only and '
        + 'must not be presented as an Australian requirement.',
    },
  },
  {
    id: 'closed-fire-door',
    label: 'Closed fire door',
    lossDb: {
      value: 30,
      source: "Apollo Fire Detectors pocket guide to BS 5839-1 system design, section 2 clause 15",
      url: 'https://apollo-fire.co.uk/wp-content/uploads/2025/10/apollo-pocket-guide_BS_5839-1_2025.pdf',
      confidence: 'low',
      note:
        'British practice. AS 1670 publishes no equivalent figure, so this is indicative only and '
        + 'must not be presented as an Australian requirement.',
    },
  },
];

/**
 * Looks up a barrier.
 *
 * Returns nothing for anything not listed. There is no figure here for a wall,
 * a floor, a glazed partition or a closed roller shutter, because no source was
 * found for one — and a plausible guess at a wall's loss would be used exactly
 * like a sourced figure.
 */
export function barrier(id: string): Barrier | undefined {
  return BARRIERS.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Coverage verdict
// ---------------------------------------------------------------------------

export interface CoverageInput {
  /** Published output of the device, dB(A), at the distance it is rated at. */
  ratedDb: number;
  referenceDistanceM: number;
  /** Device to listening position, in metres. */
  distanceM: number;
  /** Measured ambient with the alarm silent, dB(A), averaged not peak. */
  ambientDb: number;
  occupancy: OccupancyKind;
  /**
   * The margin above ambient the technician is holding the system to.
   *
   * Supplied rather than defaulted. The requirement's own figure is low
   * confidence, and quietly applying it would turn an unverified number into a
   * pass mark nobody chose.
   */
  requiredMarginDb: number;
  /** Barriers on the path, by id. An unknown id refuses the whole calculation. */
  barrierIds?: string[];
  /**
   * Other devices audible at the same point, as levels already at that point.
   * An entry that is not a readable level refuses the whole calculation, the
   * same way an unknown barrier does.
   */
  otherSourcesDb?: number[];
  space?: SpaceKind;
}

export interface CoverageResult {
  ok: true;
  /** The warning system alone at the listening position, dB(A). */
  signalDb: number;
  /** What a meter would read with the alarm running: signal plus ambient. */
  measuredDb: number;
  /** Signal minus ambient. Not the meter reading minus ambient — they differ. */
  marginDb: number;
  /** Total loss taken off for barriers on the path. */
  barrierLossDb: number;
  /** The threshold that actually decides it, and why that one. */
  bindingThresholdDb: number;
  bindingReason: string;
  /**
   * Positive is headroom, negative is shortfall, both in dB. Rounded down to
   * the tenth a meter reads, never up — the verdict is taken on the exact
   * figure first, so a room four hundredths short is reported short.
   */
  headroomDb: number;
  /** Set when the estimate is above the ceiling rather than below the floor. */
  tooLoud: boolean;
  verdict: 'pass' | 'fail';
  requirement: SplRequirement;
  cautions: string[];
  /** The confidence of the threshold this verdict was decided against. */
  thresholdConfidence: Confidence;
  disclaimer: string;
}

export type Coverage = CoverageResult | { ok: false; error: string };

/**
 * Does the room pass, and by how much.
 *
 * Two thresholds apply at once and the higher of them decides: an absolute
 * floor, and a margin over whatever the room's ambient happens to be. Which
 * one binds is reported, because they lead to different fixes — a room failing
 * the floor needs a louder device, a room failing the margin usually needs the
 * plant noise dealt with instead, and a plant room can fail the margin at
 * 95 dB while comfortably clearing the floor.
 *
 * Headroom is reported against the binding threshold and can be negative. It
 * is the number a technician writes on the sheet, so it is never dressed up as
 * a pass by rounding.
 */
export function coverageVerdict(input: CoverageInput): Coverage {
  const { ratedDb, referenceDistanceM, distanceM, ambientDb, requiredMarginDb } = input;

  const missing = (
    [
      ['rated output', ratedDb],
      ['rating distance', referenceDistanceM],
      ['distance', distanceM],
      ['ambient', ambientDb],
      ['margin', requiredMarginDb],
    ] as const
  ).filter(([, v]) => !Number.isFinite(v)).map(([name]) => name);
  if (missing.length) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
    return { ok: false, error: `Enter ${list}.` };
  }
  if (requiredMarginDb < 0) {
    return { ok: false, error: 'Margin cannot be below zero.' };
  }

  const requirement = SPL_REQUIREMENTS[input.occupancy];
  if (!requirement) return { ok: false, error: `No requirement is recorded for "${input.occupancy}".` };

  const directDb = directLevelDb({ ratedDb, referenceDistanceM, distanceM, space: input.space });
  if (directDb === undefined) {
    return { ok: false, error: 'Distances must be above zero. The inverse square law fails at the device.' };
  }
  const directCautions = regimeCautions(input.space ?? 'enclosed-room', distanceM, referenceDistanceM);

  // An unknown barrier refuses the whole answer rather than being skipped. A
  // skipped barrier silently inflates the level by the amount it would have
  // taken off, which is the failure mode that puts a pass on a room that fails.
  let barrierLossDb = 0;
  const barrierNotes: string[] = [];
  for (const id of input.barrierIds ?? []) {
    const b = barrier(id);
    if (!b) {
      return {
        ok: false,
        error:
          `No attenuation figure for "${id}". Measure through it instead.`,
      };
    }
    barrierLossDb += b.lossDb.value;
    barrierNotes.push(`${b.label}: −${b.lossDb.value} dB, indicative only. Source: ${b.lossDb.source}.`);
  }

  // A source the technician entered that could not be read is not a source of
  // zero, and it is not a source that was never mentioned. Dropping it quietly
  // is the same failure as skipping an unknown barrier, only in the opposite
  // direction: the answer comes back missing a device nobody was told about.
  const others = input.otherSourcesDb ?? [];
  if (!others.every(Number.isFinite)) {
    return {
      ok: false,
      error:
        'Another source is not a number. Fix it or remove it; it is not a source of zero.',
    };
  }

  const signalExact = addLevelsExact([directDb - barrierLossDb, ...others]);
  if (signalExact === undefined) return { ok: false, error: 'The signal level could not be resolved.' };
  const signalDb = round1(signalExact);

  const measuredExact = addLevelsExact([signalExact, ambientDb]);
  if (measuredExact === undefined) return { ok: false, error: 'The combined level could not be resolved.' };

  const marginDb = round1(signalExact - ambientDb);

  const floorDb = requirement.minimumDb.value;
  const ambientThresholdDb = ambientDb + requiredMarginDb;
  const bindingExact = Math.max(floorDb, ambientThresholdDb);
  const bindingThresholdDb = round1(bindingExact);
  const bindingReason = ambientThresholdDb > floorDb
    ? `Ambient ${round1(ambientDb)} dB(A) + ${round1(requiredMarginDb)} dB sets the pass mark, above the `
      + `${floorDb} dB(A) floor. Needs more output or less noise.`
    : ambientThresholdDb === floorDb
      ? `The ${floorDb} dB(A) floor and ambient + margin are the same number.`
      : `The ${floorDb} dB(A) floor sets the pass mark.`;

  // The verdict is taken on the exact figures and only then rounded down for
  // display, so a room 0.04 dB short is reported short. Rounding a shortfall to
  // the nearest tenth turns it into a pass at the boundary, which is the number
  // on the sheet deciding the outcome instead of the room.
  const headroomExact = signalExact - bindingExact;
  const headroomDb = floor1(headroomExact);

  const ceiling = requirement.maximumDb?.value;
  const tooLoud = ceiling !== undefined && signalExact > ceiling;
  const verdict: 'pass' | 'fail' = tooLoud || headroomExact < 0 ? 'fail' : 'pass';

  const cautions = [...directCautions, ...barrierNotes];

  if (requiredMarginDb < (requirement.marginAboveAmbientDb?.value ?? 0)) {
    cautions.push(
      `Margin of ${round1(requiredMarginDb)} dB is below the ${requirement.marginAboveAmbientDb!.value} dB required. `
      + 'The verdict is against your figure.',
    );
  }

  if (requirement.ambientAveragingSeconds) {
    cautions.push(`Ambient should be a ${requirement.ambientAveragingSeconds.value} s average, not a peak.`);
  }

  if (input.occupancy === 'sleeping') {
    cautions.push(requirement.measurementPoint);
  }

  if (tooLoud) {
    cautions.push(`Above the ${ceiling} dB(A) ceiling. Fails for being too loud.`);
  }

  return {
    ok: true,
    signalDb,
    measuredDb: round1(measuredExact),
    marginDb,
    barrierLossDb: round1(barrierLossDb),
    bindingThresholdDb,
    bindingReason,
    headroomDb,
    tooLoud,
    verdict,
    requirement,
    cautions,
    thresholdConfidence: requirement.minimumDb.confidence,
    disclaimer: NOT_AN_ACOUSTIC_ASSESSMENT,
  };
}

/**
 * Every source behind the figures, for the screen and for anyone auditing them.
 *
 * Held as data so the tool cannot show a number whose provenance is only in a
 * comment somebody deleted.
 */
export function sourceList(): { fact: string; source: string; url: string; confidence: Confidence }[] {
  const out: { fact: string; source: string; url: string; confidence: Confidence }[] = [];
  for (const req of Object.values(SPL_REQUIREMENTS)) {
    out.push({
      fact: `${req.label}: minimum ${req.minimumDb.value} dB(A)`,
      source: req.minimumDb.source,
      url: req.minimumDb.url,
      confidence: req.minimumDb.confidence,
    });
    if (req.maximumDb) {
      out.push({
        fact: `${req.label}: maximum ${req.maximumDb.value} dB(A)`,
        source: req.maximumDb.source,
        url: req.maximumDb.url,
        confidence: req.maximumDb.confidence,
      });
    }
    if (req.marginAboveAmbientDb) {
      out.push({
        fact: `${req.label}: ${req.marginAboveAmbientDb.value} dB above ambient`,
        source: req.marginAboveAmbientDb.source,
        url: req.marginAboveAmbientDb.url,
        confidence: req.marginAboveAmbientDb.confidence,
      });
    }
    // The averaging period is shown to the technician as the hint under the
    // ambient field, so it is a published figure on screen and belongs here
    // with the rest of them.
    if (req.ambientAveragingSeconds) {
      out.push({
        fact: `${req.label}: ambient averaged over ${req.ambientAveragingSeconds.value} s`,
        source: req.ambientAveragingSeconds.source,
        url: req.ambientAveragingSeconds.url,
        confidence: req.ambientAveragingSeconds.confidence,
      });
    }
  }
  // Clause numbers are facts from outside this file too, and the store listing
  // they link to is not what establishes them.
  for (const c of [AS_1670_1, AS_1670_4, AS_1670_4_INTELLIGIBILITY]) {
    out.push({
      fact: `${c.standard} clause ${c.clause} — ${c.title}`,
      source: c.numberSource,
      url: c.numberSourceUrl ?? c.url,
      confidence: c.numberConfidence,
    });
  }
  for (const b of BARRIERS) {
    out.push({
      fact: `${b.label}: −${b.lossDb.value} dB (indicative)`,
      source: b.lossDb.source,
      url: b.lossDb.url,
      confidence: b.lossDb.confidence,
    });
  }
  for (const c of SOU_DOOR_CONCESSIONS) {
    out.push({
      fact: `${c.label}: ${c.atDoorDb.value} dB(A) at the unit door`,
      source: c.atDoorDb.source,
      url: c.atDoorDb.url,
      confidence: c.atDoorDb.confidence,
    });
  }
  return out;
}

/** A tenth of a decibel is what a field meter reads. Anything finer is invented. */
function round1(n: number): number {
  if (!Number.isFinite(n)) return n;
  // Rounded away from zero on a half, so −13.05 dB reports as −13.1 and not as
  // −13.0. Math.round on its own rounds a negative half towards zero, which
  // shaves a tenth off every shortfall and never off any headroom.
  return (Math.sign(n) || 1) * Math.round(Math.abs(snap(n)) * 10) / 10;
}

/**
 * A tenth of a decibel, rounded down — used for headroom and nothing else.
 *
 * Headroom is the number a technician writes on the sheet, and it is the one
 * number here that must never be flattered. Rounded to nearest, a room 0.04 dB
 * short prints "0.0 dB in hand" beside a fail; rounded down it prints −0.1 and
 * agrees with the verdict. Real headroom loses at most a tenth, which is inside
 * what any of this is worth anyway.
 */
function floor1(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.floor(snap(n) * 10) / 10;
}

/**
 * Clears the float dust before rounding.
 *
 * Without it an exact 15 dB of headroom arriving as 14.999999999999998 floors
 * to 14.9 — a tenth invented by binary arithmetic rather than by acoustics.
 */
function snap(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
