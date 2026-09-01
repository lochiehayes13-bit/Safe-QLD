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
 * the data rather than in a comment. The Australian Standards themselves are
 * licensed per copy and are not reproduced here — what is recorded is clause
 * numbers, the official product page, figures as understood from public
 * sources, and our own words. Where the only sources are trade publications,
 * the figure is marked low confidence and says so on screen: it is a starting
 * point for a check against a licensed copy, not the copy itself.
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

/** A clause reference. The number is a fact; the wording behind it is not ours to carry. */
export interface ClauseRef {
  /** How a technician cites it: "AS 1670.1:2018". */
  standard: string;
  /** As printed in the document: "3.22". */
  clause: string;
  /** The clause heading, which is a title rather than the requirement text. */
  title: string;
  /** The publisher's own page for the document. */
  url: string;
}

// ---------------------------------------------------------------------------
// What this calculation is and is not
// ---------------------------------------------------------------------------

export const CALCULATION_BASIS =
  'Free-field, point-source arithmetic. Level is taken to fall by 6 dB for every doubling of '
  + 'distance from the device, with no reflections, no absorption, no directivity and no allowance '
  + 'for the shape of the room. Nothing here is measured.';

export const REVERBERANT_LIMIT =
  'A real room is not free field. Past the critical distance — where reflected sound equals direct '
  + 'sound — level stops falling and flattens out, which in a hard-surfaced corridor or stairwell '
  + 'happens within a few metres. Beyond that point this estimate reads low, and it says nothing '
  + 'about intelligibility, which reverberation ruins long before level does. A corridor can be '
  + 'loud enough and still be a corridor nobody can understand.';

export const NOT_AN_ACOUSTIC_ASSESSMENT =
  'This is a field sense-check, not an acoustic assessment. It is not a design calculation, not a '
  + 'verification of compliance with AS 1670.1 or AS 1670.4, and not a substitute for a measurement '
  + 'taken with a sound level meter at the point that matters. A pass here means the arithmetic does '
  + 'not rule coverage out; it does not mean the system complies.';

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
  const { ratedDb, referenceDistanceM, distanceM } = input;
  if (!Number.isFinite(ratedDb)) return undefined;
  const changeDb = distanceChangeDb(referenceDistanceM, distanceM);
  if (changeDb === undefined) return undefined;

  return {
    db: round1(ratedDb + changeDb),
    changeDb: round1(changeDb),
    cautions: regimeCautions(input.space ?? 'enclosed-room', distanceM, referenceDistanceM),
  };
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
      `The listening position is closer than the ${referenceDistanceM} m the device is rated at. `
      + 'Within a device’s own near field the level does not follow the inverse square law at all, '
      + 'so this figure is an extrapolation the physics does not support.',
    );
  }

  if (space === 'corridor') {
    out.push(
      'A corridor is not free field. Sound is channelled rather than radiated, reflections arrive '
      + 'from every hard surface, and level falls far more slowly than this calculation says. Expect '
      + 'the meter to read higher than this and the speech to be worse.',
    );
  } else if (space !== 'outdoors' && distanceM > FREE_FIELD_INDOOR_LIMIT_M) {
    out.push(
      `Past about ${FREE_FIELD_INDOOR_LIMIT_M} m indoors the reverberant field usually dominates and `
      + 'level stops falling the way this calculation assumes. Treat the result as a floor, not an estimate.',
    );
  }

  if (space === 'outdoors') {
    out.push(
      'Outdoors is the one case free field roughly describes, but wind, ground reflection and '
      + 'distance-dependent air absorption all bite over long runs.',
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
  if (!levels.length) return undefined;
  if (!levels.every(Number.isFinite)) return undefined;
  const total = levels.reduce((sum, db) => sum + 10 ** (db / 10), 0);
  return round1(10 * Math.log10(total));
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
    return { ok: false, error: 'Both a total reading and an ambient reading are needed.' };
  }
  if (totalDb <= ambientDb) {
    return {
      ok: false,
      error:
        `A total of ${round1(totalDb)} dB with the alarm running cannot be at or below the `
        + `${round1(ambientDb)} dB ambient. Either the alarm was not sounding, the ambient reading was `
        + 'taken somewhere else, or the meter moved. Re-take both at the same point.',
    };
  }
  if (totalDb - ambientDb < MIN_SEPARATION_FOR_SUBTRACTION_DB) {
    return {
      ok: false,
      error:
        `The alarm lifted the reading by only ${round1(totalDb - ambientDb)} dB, which is inside the `
        + 'tolerance of a field meter. The signal level cannot be worked out from these two readings — '
        + 'but a difference this small is itself the finding: the alarm is inaudible over the ambient here.',
    };
  }

  const db = round1(10 * Math.log10(10 ** (totalDb / 10) - 10 ** (ambientDb / 10)));
  const caution = totalDb - ambientDb < 3
    ? 'The signal is close to the ambient, so a tenth of a decibel of meter error moves this answer '
      + 'by a decibel or more. Treat it as approximate.'
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

const AS_1670_1: ClauseRef = {
  standard: 'AS 1670.1:2018',
  clause: '3.22',
  title: 'Building occupant warning system',
  url: 'https://store.standards.org.au/product/as-1670-1-2018',
};

const AS_1670_4: ClauseRef = {
  standard: 'AS 1670.4:2018',
  clause: '4.7',
  title: 'Output from emergency loudspeakers',
  url: 'https://store.standards.org.au/product/as-1670-4-2018',
};

const AS_1670_4_INTELLIGIBILITY: ClauseRef = {
  standard: 'AS 1670.4:2018',
  clause: '4.9',
  title: 'Intelligibility',
  url: 'https://store.standards.org.au/product/as-1670-4-2018',
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

export const SPL_REQUIREMENTS: Record<OccupancyKind, SplRequirement> = {
  'non-sleeping': {
    kind: 'non-sleeping',
    label: 'Normally occupied area',
    minimumDb: {
      value: 65,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    maximumDb: {
      value: 105,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note:
        `${UNVERIFIED_NOTE} A ceiling exists because a warning signal loud enough to hurt drives people `
        + 'away from the signal rather than towards the exit.',
    },
    marginAboveAmbientDb: {
      value: 10,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    ambientAveragingSeconds: {
      value: 60,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note:
        `${UNVERIFIED_NOTE} It matters on site: the ambient is an average, not the peak the meter `
        + 'happened to catch when a roller door went up.',
    },
    measurementPoint:
      'Anywhere in the alarm zone a person would normally be, at about head height. Our reading of '
      + 'the requirement, not the standard’s wording.',
    clauses: [AS_1670_1, AS_1670_4],
  },
  sleeping: {
    kind: 'sleeping',
    label: 'Sleeping area',
    minimumDb: {
      value: 75,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note:
        `${UNVERIFIED_NOTE} The higher floor is there because the signal has to wake someone, not `
        + 'merely be heard by someone awake.',
    },
    maximumDb: {
      value: 105,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    marginAboveAmbientDb: {
      value: 10,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    ambientAveragingSeconds: {
      value: 60,
      source: TRADE_SOURCE,
      url: TRADE_SOURCE_URL,
      confidence: 'low',
      note: UNVERIFIED_NOTE,
    },
    measurementPoint:
      'At the bedhead, with every door on the path from the device closed. Closing the doors is the '
      + 'whole point of the check — an open-door reading passes rooms that fail at night.',
    clauses: [AS_1670_1, AS_1670_4],
  },
};

/** The intelligibility requirement, which level alone does not answer. */
export const INTELLIGIBILITY_CLAUSE = AS_1670_4_INTELLIGIBILITY;

export const INTELLIGIBILITY_NOTE =
  'Level and intelligibility are different requirements measured different ways. A speech system '
  + 'that is loud enough can still fail intelligibility, and no amount of level fixes it — '
  + 'reverberation is usually the cause and more output makes it worse. Intelligibility is measured '
  + 'with an STI meter, which this tool does not replace.';

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
      source: 'Queensland Fire and Emergency Services position statement on NCC Specification E2.2a clause 5, and NCC 2022 Specification 20 clause S20C7',
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
      source: 'Queensland Fire and Emergency Services position statement on NCC Specification E2.2a clause 5, and NCC 2022 Specification 20 clause S20C7',
      url: QFES_POSITION_URL,
      confidence: 'high',
      note: 'Measured at the door giving access to the sole-occupancy unit, in place of a reading inside it.',
    },
  },
];

export const QFES_CONCESSION_POSITION =
  'Queensland reads this concession narrowly. QFES’ published position is that it does not extend '
  + 'to a system built on smoke alarms inside the units under NCC Specification E2.2a clause 5, '
  + 'because that is not the arrangement the concession was written for — so in Queensland the level '
  + 'has to be measured inside the unit against AS 1670.1 clause 3.22. QFES states it asked the ABCB '
  + 'to confirm this in writing and had no reply, so it is an interpretation rather than a settled '
  + 'point. Check it is still current before relying on it.';

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
  /** Other devices audible at the same point, as levels already at that point. */
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
  /** Positive is headroom, negative is shortfall, both in dB. */
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

  if (![ratedDb, referenceDistanceM, distanceM, ambientDb, requiredMarginDb].every(Number.isFinite)) {
    return { ok: false, error: 'A rated output, a reference distance, a distance, an ambient level and a required margin are all needed.' };
  }
  if (requiredMarginDb < 0) {
    return { ok: false, error: 'A required margin below zero would let a signal quieter than the ambient pass.' };
  }

  const requirement = SPL_REQUIREMENTS[input.occupancy];
  if (!requirement) return { ok: false, error: `No requirement is recorded for "${input.occupancy}".` };

  const direct = splAtDistance({ ratedDb, referenceDistanceM, distanceM, space: input.space });
  if (!direct) {
    return { ok: false, error: 'Distances must be greater than zero — the inverse square law says nothing at the device itself.' };
  }

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
          `No attenuation figure is held for "${id}". Nothing is assumed for walls, floors, glazing or `
          + 'shutters, because no source was found for them. Measure through it instead.',
      };
    }
    barrierLossDb += b.lossDb.value;
    barrierNotes.push(`${b.label}: −${b.lossDb.value} dB, ${b.lossDb.source} (${b.lossDb.confidence} confidence, indicative).`);
  }

  const others = (input.otherSourcesDb ?? []).filter(Number.isFinite);
  const signalDb = addLevels([direct.db - barrierLossDb, ...others]);
  if (signalDb === undefined) return { ok: false, error: 'The signal level could not be resolved.' };

  const measuredDb = signalPlusAmbient(signalDb, ambientDb);
  if (measuredDb === undefined) return { ok: false, error: 'The combined level could not be resolved.' };

  const marginDb = round1(signalDb - ambientDb);

  const floorDb = requirement.minimumDb.value;
  const ambientThresholdDb = ambientDb + requiredMarginDb;
  const bindingThresholdDb = round1(Math.max(floorDb, ambientThresholdDb));
  const bindingReason = ambientThresholdDb > floorDb
    ? `The ambient of ${round1(ambientDb)} dB(A) plus the ${round1(requiredMarginDb)} dB margin sets the pass mark, `
      + `above the ${floorDb} dB(A) floor for a ${requirement.label.toLowerCase()}. A quieter room would not help; `
      + 'this one needs either more output or less noise.'
    : `The ${floorDb} dB(A) floor for a ${requirement.label.toLowerCase()} sets the pass mark, above the `
      + `${round1(ambientThresholdDb)} dB(A) the ambient and margin would ask for.`;

  const headroomDb = round1(signalDb - bindingThresholdDb);

  const ceiling = requirement.maximumDb?.value;
  const tooLoud = ceiling !== undefined && signalDb > ceiling;
  const verdict: 'pass' | 'fail' = tooLoud || headroomDb < 0 ? 'fail' : 'pass';

  const cautions = [...direct.cautions, ...barrierNotes];

  if (requiredMarginDb < (requirement.marginAboveAmbientDb?.value ?? 0)) {
    cautions.push(
      `The margin used here (${round1(requiredMarginDb)} dB) is below the ${requirement.marginAboveAmbientDb!.value} dB `
      + 'understood to apply. The verdict is against your figure, not that one.',
    );
  }

  if (requirement.ambientAveragingSeconds) {
    cautions.push(
      `The ambient is meant to be an average over about ${requirement.ambientAveragingSeconds.value} seconds. `
      + 'A single reading taken while a compressor was running sets a pass mark the room can never meet.',
    );
  }

  if (input.occupancy === 'sleeping') {
    cautions.push(requirement.measurementPoint);
  }

  if (tooLoud) {
    cautions.push(
      `The estimate is above the ${ceiling} dB(A) ceiling. A signal that loud drives people away from it `
      + 'and can make speech unintelligible, so it fails for being too loud rather than too quiet.',
    );
  }

  cautions.push(
    `The pass mark itself is ${requirement.minimumDb.confidence} confidence: ${requirement.minimumDb.source}. `
    + 'Confirm it against a licensed copy of the standard before it goes in a report.',
  );

  return {
    ok: true,
    signalDb,
    measuredDb,
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
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
