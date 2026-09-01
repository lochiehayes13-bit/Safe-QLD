import { scheduledDate, type Frequency } from '@/domain/qldCompliance';
import { parseImpreciseDate, type ImpreciseDate } from '@/parsers/assetRegister';

/**
 * Fire hose reels — about a thousand assets, two routines, and no logic at all.
 *
 * A hose reel is the simplest thing Safe QLD services and that is exactly why
 * it goes wrong. Nobody argues about a hose reel. It gets a tick at six months
 * and a tick at five years, and the four ways that ticking goes wrong are what
 * this module exists to stop.
 *
 *  1. **The five-yearly quietly absorbed into the six-monthly.** They are
 *     different activities. The six-monthly is an operational check — run it
 *     out, flow it, look at it. The five-yearly puts the hose under test
 *     pressure, which is the only activity that finds a hose about to split
 *     under a person's hands. A scheduler that treats "serviced in March" as
 *     satisfying both puts an untested hose on a wall for a decade, and every
 *     line of the record looks compliant. Nothing here lets one discharge the
 *     other: see `discharges()`, which is deliberately as blunt as it looks.
 *
 *  2. **Drift.** Scheduling from the last service instead of from the anchor
 *     makes lateness compound. Six-monthlies drift fastest of anything on the
 *     book because there are two a year to slip. The anchor rule from
 *     src/domain/schedule.ts is enforced here.
 *
 *  3. **A day invented out of a month.** Registers record a five-yearly as
 *     "Jun-25". Read as 1 June that moves the next test by up to a month.
 *     Imprecise anchors produce imprecise due *spans*, never a false date.
 *
 *  4. **A flow figure asserted with no source.** "0.33" is a number every
 *     technician in the country can recite and almost nobody can cite. The
 *     duty a reel has to meet is an **input** here — the technician or the
 *     baseline data supplies it — and the only figures this module offers are
 *     ones it can put a URL and a confidence against. The DN 25 figure is in
 *     the standard's own table and could not be found published anywhere this
 *     app can cite, so it is refused rather than transcribed. See
 *     `publishedDuty()`.
 *
 * On coverage: the radius arithmetic in here is a **sense-check**, not a
 * design. A disc drawn round a reel is a straight-line figure and the standard
 * measures the run along the floor, so every wall between the reel and the far
 * corner makes the disc a lie in the optimistic direction. This module says so
 * in its returned data rather than trusting a screen to say it.
 *
 * On sources: no clause text, table or schedule from any Australian Standard is
 * reproduced. Clause numbers, catalogue URLs and this app's own wording only.
 * Queensland Government material — QDC MP 6.1 and the Building Fire Safety
 * Regulation 2008 — is Crown material and is quoted where it is useful.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type SourceId =
  | 'as2441'
  | 'as-nzs-1221'
  | 'as1851'
  | 'ncc-e1d3'
  | 'qdc-mp61'
  | 'alexon-reels'
  | 'firehosereels-au';

export interface Source {
  id: SourceId;
  /** What this source is relied on for, in one line. */
  what: string;
  /** The document, and the clause or part within it. Numbers only, never text. */
  ref: string;
  url: string;
  confidence: Confidence;
  /**
   * Why the confidence is what it is. The Australian Building Codes Board
   * publishing its own code is not the same kind of fact as a supplier's
   * product page, and a service report must never treat the two alike.
   */
  basis: string;
}

export const SOURCES: Record<SourceId, Source> = {
  as2441: {
    id: 'as2441',
    what:
      'That fire hose reel coverage is worked out as the hose run plus a hose stream, that the hose has a maximum '
      + 'length, and that a minimum discharge is specified against an inlet pressure and a nominal hose diameter',
    ref: 'AS 2441-2005 (incorporating Amendment No. 1), Installation of fire hose reels — Clause 10.2 (system coverage), Table 6.1 (the minimum discharge and supply pipe size table), Clause 12 (commissioning)',
    url: 'https://store.standards.org.au/product/as-2441-2005',
    confidence: 'high',
    basis:
      'Safe QLD holds a purchased copy and the clause and table numbers were read from it. Nothing of its text, and '
      + 'no row of Table 6.1, is reproduced in this app — the figures offered below are the ones that could also be '
      + 'cited to a public source, and the rest are refused. AS 2441:2022 supersedes this edition; check which one '
      + 'the building was designed under before quoting a clause at a client.',
  },
  'as-nzs-1221': {
    id: 'as-nzs-1221',
    what: 'That the reel, hose and nozzle are a certified product assembly and that the unwind test belongs to the product standard rather than to the installation standard',
    ref: 'AS/NZS 1221, Fire hose reels',
    url: 'https://store.standards.org.au/product/as-nzs-1221-1997',
    confidence: 'medium',
    basis:
      'Named as the product standard by AS 2441 Clauses 5, 7 and 12. Taken from a catalogue listing rather than from '
      + 'the standard itself, so it is relied on for scope only. Nothing in this module decides whether a reel is a '
      + 'compliant product; that is a certification question and not a service one.',
  },
  as1851: {
    id: 'as1851',
    what: 'That fire hose reels carry a routine service regime with a six-monthly and a five-yearly activity',
    ref: 'AS 1851-2012, Routine service of fire protection systems and equipment',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-1851-2012',
    confidence: 'medium',
    basis:
      'The existence and the frequency of the two activities is corroborated by the routines Safe QLD already runs '
      + 'against these assets. The section number is NOT established: the public sources reached disagree about which '
      + 'section of AS 1851-2012 fire hose reels sit in, and several of them place the flow test annually rather than '
      + 'six-monthly. This module therefore prints no section number and no item number — see '
      + 'AS1851_SECTION_NOT_ESTABLISHED — and the method is transcribed from the purchased copy by the licence holder.',
  },
  'ncc-e1d3': {
    id: 'ncc-e1d3',
    what:
      'When a hose reel system is required at all: where internal fire hydrants are installed, or where they are not, '
      + 'in a fire compartment over 500 m²; that a reel is located within 4 m of an exit; that coverage is to AS 2441; '
      + 'and which classes are exempt',
    ref: 'National Construction Code 2022, Volume One, Part E1, Clause E1D3 (fire hose reels)',
    url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/e-services-and-equipment/part-e1-fire-fighting-equipment',
    confidence: 'high',
    basis:
      "The Australian Building Codes Board's own code, published free to read. This is the reason a reel is on a wall "
      + 'at all, which makes it the right thing to sense-check a reel count against. It is a design provision: it says '
      + 'what a new building must have, not what an existing one must keep, and an older building may lawfully differ '
      + 'from it under the approval it was built to.',
  },
  'qdc-mp61': {
    id: 'qdc-mp61',
    what: 'That fire hose reels are a prescribed fire safety installation in Queensland and appear by name on the annual occupier statement',
    ref: 'Queensland Development Code, Mandatory Part 6.1 — Maintenance of fire safety installations, Schedules 1 and 2',
    url: 'https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code/current-parts',
    confidence: 'high',
    basis:
      'Queensland Government material, published free and reproducible. This is the statutory hook: a hose reel that '
      + 'is not maintained is not merely an open defect, it is a row the occupier has to sign a statement about every '
      + 'year, and an overdue five-yearly is what makes that signature false.',
  },
  'alexon-reels': {
    id: 'alexon-reels',
    what: 'The 0.33 L/s minimum discharge, the 4 m hose stream, the 36 m fully extended hose length, siting within 4 m of an exit and the spindle mounting height range',
    ref: 'Alexon (Australian fire contractor), fire hose reel testing and requirements',
    url: 'https://www.alexon.com.au/fire-hose-reels',
    confidence: 'low',
    basis:
      "A contractor's own page and second-hand throughout. It is cited because it is the only public Australian source "
      + 'reached that states the 0.33 L/s figure, and the whole point of this module is that a figure without a URL '
      + 'does not get used. Its figures agree with the licensed copy of AS 2441 on every point checked, which is why '
      + 'it is relied on at all — but it is a web page, and a web page is not a standard.',
  },
  'firehosereels-au': {
    id: 'firehosereels-au',
    what: 'The competing claim that the minimum discharge is 0.45 L/s at 220 kPa, and that hose is supplied in 30 m and 36 m lengths at 19 mm bore',
    ref: 'firehosereels.com.au, information about fire hose reels',
    url: 'https://www.firehosereels.com.au/firehosereels.htm',
    confidence: 'low',
    basis:
      'A trade page that states a materially different flow figure from every other source reached, and from the '
      + 'licensed copy of AS 2441. It is carried because the disagreement is real and a technician arguing about a '
      + 'marginal flow result needs to know that a number they may be quoted at exists and where it comes from. This '
      + 'module does not test against it.',
  },
};

/** Every source behind a result, in the order a report should list them, without repeats. */
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

/**
 * What the section number of AS 1851-2012 for fire hose reels is not.
 *
 * Two public sources reached put fire hose reels in different sections, and
 * more than one puts the flow test at a yearly frequency rather than the
 * six-monthly Safe QLD runs. A wrong section number on a record of maintenance
 * is a wrong citation on a statutory document, so none is printed.
 */
export const AS1851_SECTION_NOT_ESTABLISHED =
  'This app does not print an AS 1851-2012 section or item number for fire hose reels. The public sources it can '
  + 'reach disagree on which section they sit in, and some of them place the flow test yearly rather than '
  + 'six-monthly. Cite the section from the purchased copy, not from here.';

/**
 * The Queensland consequence of an overdue hose reel routine.
 *
 * Reproduced in the sense that matters: hose reels are named in QDC MP 6.1
 * Schedule 1, and Schedule 2 is the statement the occupier signs each year
 * declaring the named installations have been maintained.
 */
export const QLD_PRESCRIBED_NOTE =
  'Fire hose reels are a prescribed fire safety installation under QDC MP 6.1 and appear by name on the Schedule 2 '
  + 'occupier statement. An outstanding routine is not only an open defect on this register — it is a line the '
  + 'occupier is signing a declaration about, and the declaration is annual whether or not the work was done.';

// ===========================================================================
// Refusals
// ===========================================================================

export interface Refused {
  known: false;
  reason: string;
  whatToDo: string;
  sourceIds: SourceId[];
}

export function isRefused(v: unknown): v is Refused {
  return !!v && typeof v === 'object' && (v as Refused).known === false;
}

const isFinitePositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * A measurement, which may legitimately be zero.
 *
 * Kept apart from `isFinitePositive` because zero means opposite things on the
 * two sides of a duty check. A duty of zero is a duty nobody entered; a reading
 * of zero is a reel with no water in it, which is the worst result on the sheet
 * and must never be filed as "not measured".
 */
const isMeasurement = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ===========================================================================
// Coverage
// ===========================================================================

/**
 * The hose stream allowance added to the hose run.
 *
 * The reach of a reel is not the hose; it is the hose plus the jet off the end
 * of it. Four metres is the figure AS 2441 Clause 10.2 works to and the figure
 * the trade source states independently.
 */
export const NOMINAL_THROW_M = 4;

/** The longest hose AS 2441 Clause 10.2 permits. Longer is a finding, not an error. */
export const MAX_HOSE_LENGTH_M = 36;

/** Lengths a reel is actually supplied in, offered as a picker convenience only. */
export const COMMON_HOSE_LENGTHS_M = [18, 24, 30, 36];

/**
 * The sentence that has to travel with every number in this section.
 *
 * Held as data rather than as prose inside a screen so that the coverage
 * arithmetic cannot be rendered anywhere without it.
 */
export const COVERAGE_IS_NOT_A_DESIGN =
  'This is a sense-check, not a design. The radius is a straight line and the standard measures the hose run along '
  + 'the floor, so every wall, doorway, partition and rack between the reel and the far corner makes this figure '
  + 'optimistic. A reel count from a floor area is an order-of-magnitude check on what is already installed; the real '
  + 'number comes off a plan with the obstructions drawn on it, and that is a hydraulic design task, not a service one.';

export interface Coverage {
  hoseLengthM: number;
  throwM: number;
  /** Hose plus stream. The straight-line reach of one reel. */
  radiusM: number;
  /** π r² — the area covered on a bare floor with nothing in the way. */
  discAreaM2: number;
  /**
   * 2r² — the largest square that fits inside the disc.
   *
   * This is the honest number for spacing reels out on a grid, because circles
   * laid out to leave no gap have to overlap. Using the disc area to count
   * reels assumes the discs tessellate, and discs do not tessellate.
   */
  gridAreaM2: number;
  /** True where the hose is longer than the maximum. A finding, and the reach is still real. */
  overLength: boolean;
  notes: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

/**
 * How far one reel reaches, and how much floor that is worth.
 *
 * Two areas are returned and the difference between them is the whole value of
 * this function. The disc is what a reel covers; the inscribed square is what a
 * reel covers when it has to share a floor with other reels and leave no gap.
 * On a 36 m hose that is 5,026 m² against 3,200 m² — a 57% difference, and a
 * reel count taken off the wrong one is short by a third.
 */
export function coverage(hoseLengthM: number, throwM: number = NOMINAL_THROW_M): Coverage | Refused {
  if (!isFinitePositive(hoseLengthM)) {
    return {
      known: false,
      reason: 'No usable hose length was supplied, so there is no radius to work out.',
      whatToDo:
        'Read the length off the reel or off the register. Do not estimate it by eye from a wound reel — a 30 m and a '
        + '36 m reel look the same on the wall and the difference is 84 m² of floor.',
      sourceIds: ['as2441'],
    };
  }
  if (typeof throwM !== 'number' || !Number.isFinite(throwM) || throwM < 0) {
    return {
      known: false,
      reason: 'The hose stream allowance supplied is not a usable distance.',
      whatToDo: `Leave it at the ${NOMINAL_THROW_M} m default unless you have a reason and a source for a different one.`,
      sourceIds: ['as2441', 'alexon-reels'],
    };
  }

  const radiusM = hoseLengthM + throwM;
  const discRaw = Math.PI * radiusM * radiusM;
  const gridRaw = 2 * radiusM * radiusM;

  const notes: string[] = [COVERAGE_IS_NOT_A_DESIGN];
  const overLength = hoseLengthM > MAX_HOSE_LENGTH_M;
  if (overLength) {
    notes.push(
      `The hose measures ${round1(hoseLengthM)} m, which is longer than the ${MAX_HOSE_LENGTH_M} m maximum AS 2441 `
      + 'Clause 10.2 allows. The reach below is what it physically covers, not what it is permitted to cover. Raise it '
      + 'as a finding: an over-length hose is a pressure loss problem as well as a compliance one.',
    );
  }
  if (throwM !== NOMINAL_THROW_M) {
    notes.push(
      `A hose stream allowance of ${round1(throwM)} m has been used instead of the ${NOMINAL_THROW_M} m this app is `
      + 'sourced for. Nothing here supports that figure — record where it came from before it reaches a report.',
    );
  }

  return {
    hoseLengthM: round1(hoseLengthM),
    throwM: round1(throwM),
    radiusM: round1(radiusM),
    discAreaM2: round1(discRaw),
    gridAreaM2: round1(gridRaw),
    overLength,
    notes,
    // The rule and the two figures are corroborated by a public source and by
    // the licensed copy. The arithmetic on top of them is this app's own.
    confidence: throwM === NOMINAL_THROW_M ? 'high' : 'low',
    sourceIds: ['as2441', 'alexon-reels', 'ncc-e1d3'],
  };
}

export interface ReelEstimate {
  coverage: Coverage;
  floorAreaM2: number;
  /**
   * Area divided by the disc. The absolute floor: unreachable in a real
   * building because it assumes circles tessellate and no wall exists.
   */
  idealMinimum: number;
  /**
   * Area divided by the inscribed square. What a grid of reels laid out to
   * leave no gap actually needs, before obstructions.
   */
  gridEstimate: number;
  /** How many reels are actually installed, where the caller knows. */
  installed?: number;
  /** Set only where the installed count is below even the ideal minimum. */
  shortfallStatement?: string;
  notes: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

/**
 * A plausible reel count for a floor area, given as a range and never as an answer.
 *
 * The two numbers bracket the truth from below. If a floor of 4,000 m² has one
 * reel on it, both numbers say so and the conversation with the client is easy.
 * If it has four, this function has nothing useful to say and admits it — the
 * question is then about where they are, which needs a plan.
 *
 * The comparison against what is installed is only ever made in the shortfall
 * direction. Reporting a site as "over-provided" would be this app second-
 * guessing a design it has not seen, and there is no safe version of that.
 */
export function estimateReels(
  floorAreaM2: number,
  hoseLengthM: number,
  options: { throwM?: number; installed?: number } = {},
): ReelEstimate | Refused {
  const cov = coverage(hoseLengthM, options.throwM ?? NOMINAL_THROW_M);
  if (isRefused(cov)) return cov;

  if (!isFinitePositive(floorAreaM2)) {
    return {
      known: false,
      reason: 'No usable floor area was supplied, so no reel count can be sense-checked against it.',
      whatToDo:
        'Use the area of the fire compartment the reels serve, not the whole building. Coverage is a per-compartment '
        + 'question and a building-wide area produces a number that means nothing.',
      sourceIds: ['ncc-e1d3', 'as2441'],
    };
  }

  const radius = cov.radiusM;
  const idealMinimum = Math.ceil(floorAreaM2 / (Math.PI * radius * radius));
  const gridEstimate = Math.ceil(floorAreaM2 / (2 * radius * radius));

  const notes = [...cov.notes];
  notes.push(
    'Both counts are lower bounds. Neither accounts for a wall, a doorway, a rack or a change of level, and every one '
    + 'of those adds reels rather than removing them.',
  );
  if (floorAreaM2 > 500) {
    notes.push(
      'This compartment is over 500 m². Under NCC 2022 Clause E1D3 that is the floor area at which a hose reel system '
      + 'is required in a new building even with no internal hydrants installed. An existing building may lawfully '
      + 'differ under the approval it was built to — this is a prompt to check the approval, not a defect.',
    );
  }

  let shortfallStatement: string | undefined;
  const installed = options.installed;
  if (typeof installed === 'number' && Number.isFinite(installed) && installed >= 0) {
    if (installed < idealMinimum) {
      shortfallStatement =
        `${installed} reel${installed === 1 ? '' : 's'} on ${round1(floorAreaM2)} m² cannot reach the whole floor even `
        + 'on a bare slab with the reels placed perfectly. This is arithmetic rather than a judgement about the '
        + 'building, and it holds however the reels are arranged.';
    } else {
      notes.push(
        `${installed} reels are installed, which is at or above the bare-floor minimum. That is not a finding either `
        + 'way: whether they actually cover the floor depends on where they are, which needs a plan.',
      );
    }
  }

  return {
    coverage: cov,
    floorAreaM2: round1(floorAreaM2),
    idealMinimum,
    gridEstimate,
    installed,
    shortfallStatement,
    notes,
    confidence: 'low',
    sourceIds: ['as2441', 'ncc-e1d3', 'alexon-reels'],
  };
}

// ===========================================================================
// Flow and pressure at the nozzle
// ===========================================================================

/** L/s to L/min. Stated once, named, and used everywhere rather than typed as 60. */
export const SECONDS_PER_MINUTE = 60;

export interface DutySpec {
  /** Nominal hose diameter, which is what the published figures are indexed by. */
  nominalHoseDiameterMm: number;
  minimumFlowLitresPerSecond: number;
  /** The inlet pressure the flow figure is quoted at. Flow without a pressure is not a duty. */
  atInletPressureKpa: number;
  confidence: Confidence;
  sourceIds: SourceId[];
  /** Set where the sources reached do not agree about this figure. */
  disagreement?: string;
}

/**
 * The only duty figures this app will offer.
 *
 * One row. AS 2441 Table 6.1 has more, and this app holds a licensed copy of
 * it, and that copy is not what this table is built from — reproducing the row
 * would be reproducing the standard. What is here is the figure that a public
 * Australian source also states, which is why it can be cited. The DN 25 row is
 * not offered at all: see `publishedDuty()`.
 *
 * A duty is a pair. The flow figure alone is meaningless — a reel will deliver
 * almost any flow if you put enough pressure behind it, and the whole point of
 * the test is that it delivers the flow *while* the pressure holds up.
 */
export const PUBLISHED_DUTIES: DutySpec[] = [
  {
    nominalHoseDiameterMm: 19,
    minimumFlowLitresPerSecond: 0.33,
    atInletPressureKpa: 220,
    confidence: 'low',
    sourceIds: ['alexon-reels', 'as2441', 'firehosereels-au'],
    disagreement:
      'One Australian trade source reached states 0.45 L/s at 220 kPa rather than 0.33 L/s. It agrees with no other '
      + 'source and with neither the licensed copy of AS 2441 nor the figure the industry quotes. It is recorded so '
      + 'that a technician who is quoted 0.45 knows where it comes from. Test against the figure in the building’s '
      + 'own baseline data, and where there is none, against 0.33 L/s.',
  },
];

/**
 * The published duty for a nominal hose diameter, or a refusal.
 *
 * DN 25 reels exist on this book and this function will not give a figure for
 * one. The number is in AS 2441 Table 6.1, Safe QLD owns that table, and no
 * public source this app can cite states it — so transcribing it here would put
 * a row of a copyright table into the codebase to save a technician looking at
 * a document they already have. It is refused, and the refusal says exactly
 * where to find the answer.
 */
export function publishedDuty(nominalHoseDiameterMm: number): DutySpec | Refused {
  const found = PUBLISHED_DUTIES.find((d) => d.nominalHoseDiameterMm === nominalHoseDiameterMm);
  if (found) return found;
  return {
    known: false,
    reason:
      `No publicly citable minimum discharge figure was found for a ${nominalHoseDiameterMm} mm hose reel. AS 2441 `
      + 'Table 6.1 specifies one, but this app will not transcribe a row of a copyright table it cannot also cite to a '
      + 'public source.',
    whatToDo:
      'Read the figure from the purchased copy of AS 2441 Table 6.1, or from the building’s baseline data, and enter '
      + 'it as the duty. The duty is an input to this tool by design.',
    sourceIds: ['as2441'],
  };
}

export type ComponentVerdict = 'pass' | 'fail' | 'not-measured' | 'no-duty';

export interface ComponentCheck {
  label: string;
  unit: string;
  measured?: number;
  required?: number;
  /** Measured minus required. Negative is a shortfall. Absent where either side is missing. */
  margin?: number;
  verdict: ComponentVerdict;
}

export type FlowVerdict = 'pass' | 'fail' | 'undetermined';

export interface FlowCheck {
  flow: ComponentCheck;
  pressure: ComponentCheck;
  /** The measured flow restated in L/s, because the duty is quoted in L/s and the gauge reads L/min. */
  measuredFlowLitresPerSecond?: number;
  verdict: FlowVerdict;
  statement: string;
  notes: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

export interface FlowCheckInput {
  /** Measured at the nozzle with the hose fully run out. Litres per minute, which is what the routine records. */
  measuredFlowLitresPerMinute?: number;
  /** Running pressure at the same moment, not static pressure with the nozzle shut. */
  measuredRunningPressureKpa?: number;
  /** The duty the reel has to meet. Supplied by the technician — this module never assumes one. */
  dutyFlowLitresPerSecond?: number;
  dutyPressureKpa?: number;
}

/**
 * Whether the reel met its duty.
 *
 * Three disciplines, and all three are about not turning a partial test into a
 * pass.
 *
 * **The duty is an input.** A check against an assumed duty is worse than no
 * check, because it produces a green tick with nothing behind it. Supply no
 * duty and this refuses.
 *
 * **Flow and pressure are one duty, not two.** The reel has to hold the
 * pressure while it delivers the flow. A flow that passes with the pressure
 * unmeasured is therefore `undetermined`, not `pass` — the test was half done.
 *
 * **A fail outranks a gap.** The asymmetry is deliberate: a measured shortfall
 * is a fail whatever else was left unmeasured, because no missing reading can
 * turn 12 L/min into 20. Only passes are held back for want of evidence.
 *
 * The unit conversion is done here and shown in the result. L/s and L/min on
 * the same job is how 0.33 L/s becomes a reel that "flowed 0.4" and passed —
 * the gauge was reading L/min and 0.4 L/min is a dripping tap.
 */
export function checkFlow(input: FlowCheckInput): FlowCheck | Refused {
  const hasDuty = isFinitePositive(input.dutyFlowLitresPerSecond) || isFinitePositive(input.dutyPressureKpa);
  const hasMeasurement =
    isMeasurement(input.measuredFlowLitresPerMinute) || isMeasurement(input.measuredRunningPressureKpa);

  if (!hasDuty) {
    return {
      known: false,
      reason: 'No duty was supplied, so there is nothing to test the reel against.',
      whatToDo:
        'Take the duty from the building’s baseline data, or from AS 2441 Table 6.1 for the nominal hose diameter '
        + 'fitted. This app will not assume one — a pass against an assumed duty is a tick with nothing behind it.',
      sourceIds: ['as2441', 'alexon-reels'],
    };
  }
  if (!hasMeasurement) {
    return {
      known: false,
      reason: 'Nothing was measured, so no verdict can be given.',
      whatToDo:
        'Run the hose out fully and measure at the nozzle. A flow taken with the hose still on the reel is not the '
        + 'test — the friction loss of the wound hose is the thing being checked.',
      sourceIds: ['as2441'],
    };
  }

  const notes: string[] = [];
  const requiredFlowLpm = isFinitePositive(input.dutyFlowLitresPerSecond)
    ? round2(input.dutyFlowLitresPerSecond * SECONDS_PER_MINUTE)
    : undefined;
  // A reel with the stop valve shut reads zero. That is a measurement and a
  // fail, not an absence — see isMeasurement().
  const measuredLpm = isMeasurement(input.measuredFlowLitresPerMinute)
    ? input.measuredFlowLitresPerMinute
    : undefined;

  const flow: ComponentCheck = {
    label: 'Flow at the nozzle',
    unit: 'L/min',
    measured: measuredLpm !== undefined ? round2(measuredLpm) : undefined,
    required: requiredFlowLpm,
    margin:
      measuredLpm !== undefined && requiredFlowLpm !== undefined
        ? round2(measuredLpm - requiredFlowLpm)
        : undefined,
    verdict:
      requiredFlowLpm === undefined
        ? 'no-duty'
        : measuredLpm === undefined
          ? 'not-measured'
          : measuredLpm >= requiredFlowLpm
            ? 'pass'
            : 'fail',
  };

  const measuredKpa = isMeasurement(input.measuredRunningPressureKpa)
    ? input.measuredRunningPressureKpa
    : undefined;
  const requiredKpa = isFinitePositive(input.dutyPressureKpa) ? input.dutyPressureKpa : undefined;

  const pressure: ComponentCheck = {
    label: 'Running pressure',
    unit: 'kPa',
    measured: measuredKpa !== undefined ? round1(measuredKpa) : undefined,
    required: requiredKpa !== undefined ? round1(requiredKpa) : undefined,
    margin: measuredKpa !== undefined && requiredKpa !== undefined ? round1(measuredKpa - requiredKpa) : undefined,
    verdict:
      requiredKpa === undefined
        ? 'no-duty'
        : measuredKpa === undefined
          ? 'not-measured'
          : measuredKpa >= requiredKpa
            ? 'pass'
            : 'fail',
  };

  const components = [flow, pressure];
  const failed = components.filter((c) => c.verdict === 'fail');
  const missing = components.filter((c) => c.verdict === 'not-measured');

  let verdict: FlowVerdict;
  let statement: string;
  if (failed.length) {
    verdict = 'fail';
    statement = `${failed.map((c) => c.label.toLowerCase()).join(' and ')} below the duty supplied.`;
  } else if (missing.length) {
    verdict = 'undetermined';
    statement =
      `${missing.map((c) => c.label.toLowerCase()).join(' and ')} was not measured, so this reel has not been proved `
      + 'against its duty. What was measured passed; that is not the same thing.';
  } else {
    verdict = 'pass';
    statement = 'Met the duty supplied, on every figure measured against it.';
  }

  if (flow.verdict === 'pass' && pressure.verdict === 'no-duty') {
    notes.push(
      'Only a flow duty was supplied. The duty is a flow held at a pressure — a reel can pass on flow and still be '
      + 'unable to hold pressure with a second reel running, which is the case the supply is sized for.',
    );
  }
  if (measuredLpm !== undefined) {
    notes.push(
      `${round2(measuredLpm)} L/min is ${round2(measuredLpm / SECONDS_PER_MINUTE)} L/s. Duties for hose reels are `
      + 'published in L/s and gauges read L/min; getting the two the wrong way round is a factor of sixty.',
    );
  }
  if (measuredKpa !== undefined) {
    notes.push(
      'The pressure figure must be the running pressure taken while water is flowing. Static pressure with the nozzle '
      + 'shut proves nothing about a reel and is usually much higher.',
    );
  }
  notes.push(
    'Test at the hydraulically most disadvantaged reel. A reel next to the riser will pass on almost any supply and '
    + 'says nothing about the one at the end of the run.',
  );

  return {
    flow,
    pressure,
    measuredFlowLitresPerSecond: measuredLpm !== undefined ? round2(measuredLpm / SECONDS_PER_MINUTE) : undefined,
    verdict,
    statement,
    notes,
    confidence: 'high',
    sourceIds: ['as2441', 'alexon-reels'],
  };
}

// ===========================================================================
// Hose condition — condemn, repair, or hand it back to a person
// ===========================================================================

export type HoseFinding =
  | 'perished-or-cracked'
  | 'cut-through-to-reinforcement'
  | 'surface-abrasion'
  | 'sun-crazing'
  | 'kink-set-permanently'
  | 'kinks-when-run-out'
  | 'leaks-along-hose'
  | 'leaks-at-coupling'
  | 'failed-pressure-test'
  | 'coupling-corroded'
  | 'coupling-non-standard-repair'
  | 'hose-shortened-in-service'
  | 'nozzle-missing-or-damaged'
  | 'nozzle-will-not-shut-off'
  | 'reel-binds'
  | 'access-obstructed'
  | 'no-water-supply';

/**
 * What a finding means for the asset.
 *
 * `replace-hose` — the hose is finished. On a reel this is a different verb
 * from an extinguisher's "condemn": the reel, the drum, the valve and the
 * bracket are all fine and it is the hose that comes off. Saying "condemned"
 * about a hose reel gets a whole assembly quoted for when a hose was needed.
 *
 * `repairable` — a defect, and a serviceable one. A nozzle, a coupling, a
 * binding reel and an obstruction are all in this bucket.
 *
 * `judgement` — a person with hands on the hose decides, and this app will not
 * decide it from a checkbox. How deep is that cut. Is that surface crazing or
 * is the wall perished through. Does that kink come out. Those are the three
 * questions that actually decide whether a hose stays on the wall, and none of
 * them survives being turned into a tickbox by someone who is not standing
 * there.
 */
export type HoseOutcome = 'replace-hose' | 'repairable' | 'judgement';

export interface HoseRule {
  id: HoseFinding;
  label: string;
  outcome: HoseOutcome;
  reason: string;
  /** What has to happen next. On a judgement, the question the technician has to answer. */
  action: string;
  confidence: Confidence;
  sourceIds: SourceId[];
}

export const HOSE_RULES: Record<HoseFinding, HoseRule> = {
  'failed-pressure-test': {
    id: 'failed-pressure-test',
    label: 'Failed the five-yearly pressure test',
    outcome: 'replace-hose',
    reason:
      'The pressure test is the only activity that loads the hose the way a fire does. A hose that would not hold '
      + 'test pressure on a bench will not hold it in a corridor with somebody on the nozzle.',
    action: 'Replace the hose, then re-test and record the new hose as the anchor for the next five-yearly.',
    confidence: 'high',
    sourceIds: ['as1851', 'as-nzs-1221'],
  },
  'perished-or-cracked': {
    id: 'perished-or-cracked',
    label: 'Perished — cracking through the wall of the hose',
    outcome: 'replace-hose',
    reason:
      'Perishing is the rubber itself failing, not a surface mark. It does not stop, it is not local to the part you '
      + 'can see, and it cannot be repaired.',
    action:
      'Replace the hose. Check the reels either side of it — perishing is usually an environment problem and rarely '
      + 'affects one reel alone.',
    confidence: 'high',
    sourceIds: ['as-nzs-1221', 'as1851'],
  },
  'cut-through-to-reinforcement': {
    id: 'cut-through-to-reinforcement',
    label: 'Cut or gouge deep enough to expose the reinforcement',
    outcome: 'replace-hose',
    reason:
      'Once the reinforcement is exposed the hose has lost the layer that holds the pressure at that point, and that '
      + 'is where it will burst.',
    action: 'Replace the hose. Do not cut and re-couple to save the good length — see the shortening rule.',
    confidence: 'medium',
    sourceIds: ['as-nzs-1221'],
  },
  'leaks-along-hose': {
    id: 'leaks-along-hose',
    label: 'Weeping or leaking anywhere along the hose under pressure',
    outcome: 'replace-hose',
    reason: 'A leak in the body of a non-percolating hose is the lining failed. There is no patch for it.',
    action:
      'Replace the hose. Note where along the length it wept — a leak at the drum end usually means the hose has been '
      + 'left charged, which will have done the same thing to the next one.',
    confidence: 'high',
    sourceIds: ['as-nzs-1221', 'as2441'],
  },
  'hose-shortened-in-service': {
    id: 'hose-shortened-in-service',
    label: 'Hose has been cut back and re-coupled in service',
    outcome: 'judgement',
    reason:
      'A shortened hose no longer reaches what it was installed to reach, and the coverage on the plan is now wrong '
      + 'by however much came off. Whether that matters depends on what is at the far end of the room.',
    action:
      'Measure the hose that is actually on the reel and re-run the coverage check with the measured length. If the '
      + 'far corner is now out of reach it is a coverage defect, not a hose defect.',
    confidence: 'medium',
    sourceIds: ['as2441'],
  },
  'surface-abrasion': {
    id: 'surface-abrasion',
    label: 'Surface abrasion or scuffing',
    outcome: 'judgement',
    reason:
      'A scuff on the cover and a cut into the carcass look identical from two metres away, and the difference decides '
      + 'whether the hose stays on the wall. This app cannot see it.',
    action:
      'Flex the hose at the mark and look into it. If the reinforcement shows anywhere, it is a replacement; if it is '
      + 'cover only, record it and watch it at the next service.',
    confidence: 'medium',
    sourceIds: ['as-nzs-1221'],
  },
  'sun-crazing': {
    id: 'sun-crazing',
    label: 'Fine crazing on a sun-exposed or externally mounted reel',
    outcome: 'judgement',
    reason:
      'UV attacks the cover first and the carcass later. Early crazing is cosmetic; the same hose two summers on is '
      + 'perished. Which one is in front of you is not a question a form can answer.',
    action:
      'Bend a section back on itself. If the crazing opens into cracks, treat it as perished and replace. Either way '
      + 'raise the exposure: an unprotected external reel needs a cabinet, which is the actual fix.',
    confidence: 'medium',
    sourceIds: ['as2441', 'as-nzs-1221'],
  },
  'kink-set-permanently': {
    id: 'kink-set-permanently',
    label: 'Kink that stays in the hose after it is run out',
    outcome: 'judgement',
    reason:
      'A set kink is a permanent reduction in bore at the one point the water has to get through, and it is also where '
      + 'the wall has been worked hardest. Whether it still passes flow is a measurement, not an opinion.',
    action:
      'Run the reel out fully and flow it. If it will not make its duty with the kink in it, replace the hose; if it '
      + 'will, record the kink and its position so the next technician can see whether it is getting worse.',
    confidence: 'medium',
    sourceIds: ['as2441', 'as-nzs-1221'],
  },
  'kinks-when-run-out': {
    id: 'kinks-when-run-out',
    label: 'Hose kinks when run out, or will not run out in its intended direction',
    outcome: 'repairable',
    reason:
      'Usually the hose is wound badly or the reel is sited so the hose has to turn a corner immediately. Both are '
      + 'fixable and both stop an occupant getting water on a fire in the first minute.',
    action:
      'Rewind in even layers with the stop valve open, and check nothing has been installed since that blocks the '
      + 'direction the reel was sited to pull in.',
    confidence: 'medium',
    sourceIds: ['as2441'],
  },
  'leaks-at-coupling': {
    id: 'leaks-at-coupling',
    label: 'Leaking at a coupling or at the hose tail',
    outcome: 'repairable',
    reason: 'A coupling is a serviceable item. A leak at one is a seal or a swage, not the end of the hose.',
    action: 'Re-make or replace the coupling, then re-pressurise and confirm it is dry before rewinding.',
    confidence: 'medium',
    sourceIds: ['as-nzs-1221', 'as2441'],
  },
  'coupling-corroded': {
    id: 'coupling-corroded',
    label: 'Coupling corroded, seized or loose on the hose',
    outcome: 'repairable',
    reason:
      'A corroded coupling is the first thing that fails on an external reel, and a loose one lets go under pressure '
      + 'with a nozzle in someone’s hands.',
    action:
      'Replace the coupling. If it is corroded, the environment is aggressive and the reel needs a cabinet as well as '
      + 'a coupling.',
    confidence: 'medium',
    sourceIds: ['as2441', 'as-nzs-1221'],
  },
  'coupling-non-standard-repair': {
    id: 'coupling-non-standard-repair',
    label: 'Hose repaired with a non-standard joiner, clamp or tape',
    outcome: 'replace-hose',
    reason:
      'The reel is a certified assembly of reel, hose and nozzle. A worm-drive clamp in the middle of the hose is not '
      + 'part of that assembly and the certification does not survive it.',
    action:
      'Replace the hose with one supplied for the reel. Do not re-use the joiner on the new hose, and record who did '
      + 'the original repair if the site knows.',
    confidence: 'medium',
    sourceIds: ['as-nzs-1221'],
  },
  'nozzle-missing-or-damaged': {
    id: 'nozzle-missing-or-damaged',
    label: 'Nozzle missing, cracked or the wrong pattern',
    outcome: 'repairable',
    reason: 'The nozzle makes the stream. Without the right one the four-metre reach the coverage depends on does not exist.',
    action: 'Fit the correct nozzle for the reel and confirm the shut-off works before it goes back on the interlock.',
    confidence: 'high',
    sourceIds: ['as2441', 'as-nzs-1221'],
  },
  'nozzle-will-not-shut-off': {
    id: 'nozzle-will-not-shut-off',
    label: 'Nozzle will not shut off',
    outcome: 'repairable',
    reason:
      'A nozzle that will not close cannot be carried to a fire, and the hose cannot be depressurised to rewind it. '
      + 'It also means the reel has probably been left charged and dribbling since the last person used it.',
    action: 'Replace the nozzle and check the hose for the damage a permanently charged reel does.',
    confidence: 'medium',
    sourceIds: ['as2441'],
  },
  'reel-binds': {
    id: 'reel-binds',
    label: 'Reel binds, will not turn freely, or the swing arm is seized',
    outcome: 'repairable',
    reason:
      'An occupant pulling a hose off a binding reel gets a few metres and gives up. The pull needed to unwind is a '
      + 'commissioning check for exactly this reason (AS 2441 Clause 12, referring to the unwind test in AS/NZS 1221).',
    action: 'Free and lubricate the spindle and swing arm, then run the full length off by hand and confirm it comes freely.',
    confidence: 'medium',
    sourceIds: ['as2441', 'as-nzs-1221'],
  },
  'access-obstructed': {
    id: 'access-obstructed',
    label: 'Access obstructed, or the reel cannot be run out in its intended direction',
    outcome: 'repairable',
    reason:
      'The most common hose reel defect on any book, and the cheapest to fix. A reel behind a pallet is a reel that '
      + 'does not exist.',
    action:
      'Clear the obstruction and photograph it. If it is storage inside the cabinet, say so to the occupier in '
      + 'writing — a cabinet is not a broom cupboard.',
    confidence: 'high',
    sourceIds: ['as2441', 'qdc-mp61'],
  },
  'no-water-supply': {
    id: 'no-water-supply',
    label: 'No water at the reel, or the stop valve is shut',
    outcome: 'repairable',
    reason:
      'A shut isolating valve is the failure that makes every other check on the sheet irrelevant, and it is invisible '
      + 'until somebody opens a nozzle.',
    action:
      'Find the valve, open it, and secure it open. Then work out who shut it and when, because everything downstream '
      + 'of it has been out of service since.',
    confidence: 'high',
    sourceIds: ['as2441'],
  },
};

export type HoseVerdict = 'unserviceable' | 'serviceable' | 'undetermined';

export interface HoseAssessment {
  verdict: HoseVerdict;
  /** Findings that take the hose off the reel. */
  replaceHose: HoseRule[];
  /** Findings a person has to rule on. Present means the verdict cannot be "serviceable". */
  needsJudgement: HoseRule[];
  /** Defects that are fixable without a new hose. */
  repairable: HoseRule[];
  /** Findings passed in that this app has no rule for. Reported, never ignored. */
  unrecognised: string[];
  statement: string;
  /** The questions the technician has to answer before this asset has a verdict. */
  openQuestions: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

export interface HoseConditionInput {
  findings: (HoseFinding | string)[];
  /**
   * Whether anybody actually ran the hose out and looked at it.
   *
   * A hose reel is the one asset where this flag earns its keep. Almost all of
   * a hose lives wound on a drum where nothing can be seen, so "no findings"
   * from a reel nobody unwound is a statement about the technician's afternoon
   * and not about the hose.
   */
  fullyDeployed: boolean;
}

/**
 * Replace it, fix it, or send the question back to the person holding it.
 *
 * The two refusals are the point. A hose that was never run off the drum cannot
 * be assessed at all, and any finding whose outcome is a judgement leaves the
 * asset `undetermined` with the question named. Rounding either to
 * "serviceable" is how a perished hose gets a green tag and stays on a wall for
 * another five years.
 */
export function assessHose(input: HoseConditionInput): HoseAssessment {
  const replaceHose: HoseRule[] = [];
  const needsJudgement: HoseRule[] = [];
  const repairable: HoseRule[] = [];
  const unrecognised: string[] = [];

  for (const f of input.findings) {
    const rule = HOSE_RULES[f as HoseFinding];
    if (!rule) {
      unrecognised.push(String(f));
      continue;
    }
    if (rule.outcome === 'replace-hose') replaceHose.push(rule);
    else if (rule.outcome === 'judgement') needsJudgement.push(rule);
    else repairable.push(rule);
  }

  const sourceIds = [
    ...replaceHose.flatMap((r) => r.sourceIds),
    ...needsJudgement.flatMap((r) => r.sourceIds),
    ...repairable.flatMap((r) => r.sourceIds),
  ];
  const openQuestions = needsJudgement.map((r) => r.action);

  // A hose that has failed outright is unserviceable whether or not anybody
  // deployed it properly — a finding that is already made does not become less
  // true because the inspection was incomplete.
  if (replaceHose.length) {
    return {
      verdict: 'unserviceable',
      replaceHose,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        `Hose to be replaced: ${replaceHose.map((r) => r.label.toLowerCase()).join('; ')}. ${replaceHose[0]!.action} `
        + 'The reel, drum, valve and bracket are not condemned by this — quote the hose.',
      openQuestions,
      confidence: 'high',
      sourceIds: sourceIds.length ? sourceIds : ['as1851'],
    };
  }

  if (!input.fullyDeployed) {
    return {
      verdict: 'undetermined',
      replaceHose,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        'The hose was not run out, so nothing can be said about it. Almost all of a hose reel hose is wound out of '
        + 'sight, and an absence of findings from a reel nobody deployed is not a pass.',
      openQuestions: [
        'Run the full length off the reel, walk it, and re-assess.',
        ...openQuestions,
      ],
      confidence: 'high',
      sourceIds: ['as1851', 'as2441'],
    };
  }

  if (needsJudgement.length) {
    return {
      verdict: 'undetermined',
      replaceHose,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        `${needsJudgement.length} finding${needsJudgement.length === 1 ? '' : 's'} on this hose cannot be decided from `
        + 'a form: ' + needsJudgement.map((r) => r.label.toLowerCase()).join('; ') + '. A technician with hands on the '
        + 'hose answers them, and until then this asset has no verdict.',
      openQuestions,
      confidence: 'high',
      sourceIds: sourceIds.length ? sourceIds : ['as-nzs-1221'],
    };
  }

  if (repairable.length) {
    return {
      verdict: 'serviceable',
      replaceHose,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        `The hose itself is serviceable. ${repairable.length} defect${repairable.length === 1 ? '' : 's'} to rectify: `
        + repairable.map((r) => r.label.toLowerCase()).join('; ') + '.',
      openQuestions,
      confidence: 'medium',
      sourceIds,
    };
  }

  return {
    verdict: 'serviceable',
    replaceHose,
    needsJudgement,
    repairable,
    unrecognised,
    statement: 'Run out in full and found serviceable, with no defects recorded.',
    openQuestions,
    confidence: 'medium',
    sourceIds: ['as1851', 'as2441'],
  };
}

// ===========================================================================
// Dates carried at the precision they were written at
// ===========================================================================

export type DatePrecision = 'day' | 'month' | 'year';

/**
 * A date the register recorded, as the span of days it could actually be.
 *
 * The answer to the "Jun-25" problem. A month-precision record is not the first
 * of the month and it is not the fifteenth; it is a span, and the arithmetic
 * carries the span rather than collapsing it.
 *
 * The *reading* is delegated to parseImpreciseDate so there stays one
 * Australian date reader in this codebase. The span type lives here with the
 * scheduling that consumes it rather than being imported from the extinguisher
 * module, which has its own source vocabulary and no business in this one.
 */
export interface DateSpan {
  earliest: string;
  latest: string;
  precision: DatePrecision;
  /** How it was written on the register. */
  raw: string;
  /** d/m/yyyy for a day, "June 2025" for a month, "2025" for a year. */
  label: string;
}

const MONTH_LABEL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Days in a month, UTC, so February behaves in a leap year. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Australian display. Never m/d/y, anywhere, for any reason. */
export function formatAuDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/**
 * Turns whatever the register said into the span of days it could be.
 *
 * A blank cell and an unreadable cell both come back undefined, because neither
 * can be scheduled from and pretending otherwise is how an asset ends up
 * permanently and wrongly overdue.
 */
export function toSpan(value: string | ImpreciseDate | undefined): DateSpan | undefined {
  if (value === undefined) return undefined;
  const d = typeof value === 'string' ? parseImpreciseDate(value) : value;
  if (!d || d.year === undefined) return undefined;

  if (d.precision === 'day' && d.iso && d.month !== undefined && d.day !== undefined) {
    return { earliest: d.iso, latest: d.iso, precision: 'day', raw: d.raw, label: formatAuDate(d.iso) };
  }
  if (d.precision === 'month' && d.month !== undefined) {
    return {
      earliest: isoDate(d.year, d.month, 1),
      latest: isoDate(d.year, d.month, daysInMonth(d.year, d.month)),
      precision: 'month',
      raw: d.raw,
      label: `${MONTH_LABEL[d.month - 1]} ${d.year}`,
    };
  }
  if (d.precision === 'year') {
    return {
      earliest: isoDate(d.year, 1, 1),
      latest: isoDate(d.year, 12, 31),
      precision: 'year',
      raw: d.raw,
      label: String(d.year),
    };
  }
  return undefined;
}

/** Whole months between two ISO dates, ignoring the day. Negative when b precedes a. */
function monthsBetween(aIso: string, bIso: string): number {
  const [ay, am] = aIso.split('-').map(Number);
  const [by, bm] = bIso.split('-').map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ===========================================================================
// The two routines, and the rule that they are two
// ===========================================================================

export type HoseReelActivity = 'six-monthly' | 'five-yearly';

export const ACTIVITY_LABEL: Record<HoseReelActivity, string> = {
  'six-monthly': 'Six-monthly',
  'five-yearly': 'Five-yearly',
};

/** The routine ids these correspond to in the seeded routine list. */
export const ACTIVITY_ROUTINE_ID: Record<HoseReelActivity, string> = {
  'six-monthly': 'fhr-six-monthly',
  'five-yearly': 'hose-reel-five-yearly',
};

const ACTIVITY_FREQUENCY: Record<HoseReelActivity, Frequency> = {
  'six-monthly': 'six-monthly',
  'five-yearly': 'five-yearly',
};

export interface ActivitySpec {
  activity: HoseReelActivity;
  label: string;
  intervalMonths: number;
  /** What this activity is for, in one line, in this app's words. */
  purpose: string;
  /** What it does NOT cover. The reason this module exists in this shape. */
  doesNotCover: string;
  confidence: Confidence;
  sourceIds: SourceId[];
}

/**
 * The two activities, described by what each one finds that the other cannot.
 *
 * No item numbers, no schedule table, no clause text — the frequencies and the
 * shape of each activity, which is what a scheduler needs and all this app can
 * cite. The method is transcribed from the licence holder's purchased copy.
 */
export const ACTIVITY_SPECS: Record<HoseReelActivity, ActivitySpec> = {
  'six-monthly': {
    activity: 'six-monthly',
    label: 'Six-monthly',
    intervalMonths: 6,
    purpose:
      'The operational check: water at the nozzle, flow against the duty, hose and nozzle condition over its length, '
      + 'the reel turning freely, and the reel accessible and signed. It answers "would an occupant get water on a '
      + 'fire with this today".',
    doesNotCover:
      'It puts no test pressure into the hose. A hose can pass every six-monthly for five years and still fail the '
      + 'moment it is pressure tested, because running pressure is not test pressure.',
    confidence: 'medium',
    sourceIds: ['as1851', 'as2441'],
  },
  'five-yearly': {
    activity: 'five-yearly',
    label: 'Five-yearly',
    intervalMonths: 60,
    purpose:
      'The integrity check: the hose run out to its full length, inspected along the whole run, and pressure tested. '
      + 'It answers "will this hose still hold pressure", which is a question about the hose itself rather than about '
      + 'the water supply.',
    doesNotCover:
      'It is not a substitute for the six-monthlies either. A hose tested in March says nothing about a stop valve '
      + 'somebody shuts in July.',
    confidence: 'medium',
    sourceIds: ['as1851', 'as-nzs-1221'],
  },
};

export function activitySpec(activity: HoseReelActivity): ActivitySpec {
  return ACTIVITY_SPECS[activity];
}

/**
 * Whether carrying out one activity discharges the obligation for another.
 *
 * It never does, and this function exists to be the single place that says so.
 * It looks trivial because it is: the failure it prevents is not a subtle bug,
 * it is somebody deciding in a scheduler that a five-yearly "includes" the
 * six-monthly due the same week, or that a reel serviced last month does not
 * need its five-yearly this month. The five-yearly puts the hose under test
 * pressure and the six-monthly does not; they find different failures and
 * neither can stand in for the other.
 */
export function discharges(performed: HoseReelActivity, obligation: HoseReelActivity): boolean {
  return performed === obligation;
}

export const ACTIVITIES_ARE_INDEPENDENT =
  'The six-monthly and the five-yearly are separate activities with separate records. Attending a reel for one does '
  + 'not satisfy the other, and a five-yearly carried out on the same day as a six-monthly is two records, not one.';

// ===========================================================================
// When the next one falls due
// ===========================================================================

/**
 * Where a routine stands against the calendar, and nothing else.
 *
 * Deliberately does not carry "never recorded". Whether a reel has a service
 * history is a different fact from whether it is late, they can both be true at
 * once, and collapsing them loses the worse one — a reel with no record at all
 * bucketed as merely "overdue" reads like a job that slipped, when it is a reel
 * nobody has ever touched. `everRecorded` carries that separately.
 */
export type DueState = 'overdue' | 'due' | 'upcoming';

export const DUE_STATE_LABEL: Record<DueState, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  upcoming: 'Upcoming',
};

export interface DueAssessment {
  activity: HoseReelActivity;
  intervalMonths: number;
  /**
   * Whether the schedule was counted from the installation anchor or from the
   * last service. The first cannot drift; the second carries forward whatever
   * drift is already in the record, and says so.
   */
  anchoredTo: 'commissioning' | 'first-service' | 'last-service';
  anchorNote: string;
  /** Occurrence number counted from the anchor. Occurrence 1 is the first recurrence. */
  occurrence: number;
  /** The span of days the next one falls in. One day wide where every input was to the day. */
  due: DateSpan;
  state: DueState;
  /**
   * Whether this activity has ever been carried out here. False and `overdue`
   * together is the worst reading on the book and the two are kept apart so it
   * cannot be softened into one.
   */
  everRecorded: boolean;
  /** Days to the start and the end of the due span. Negative once past. */
  daysUntil: { earliest: number; latest: number };
  /** Scheduled occurrences that have fallen due with no record against them. */
  missedOccurrences: number;
  notes: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

export interface DueInput {
  activity: HoseReelActivity;
  /**
   * When the reel was commissioned. The best anchor there is: AS 2441 Clause 12
   * requires the month and year of commissioning to be tagged on the reel, so
   * on a compliant installation this is readable off the asset itself.
   */
  commissioned?: string | ImpreciseDate;
  /**
   * The earliest recorded service of THIS activity, where commissioning is not
   * known. Second best, and still drift-free from that point on.
   */
  firstService?: string | ImpreciseDate;
  /** When this activity — and only this activity — was last carried out. */
  lastDone?: string | ImpreciseDate;
  /** ISO date. Queensland is UTC+10 with no daylight saving, so "today" is unambiguous here. */
  today: string;
}

/** Adds whole months to both ends of a span using the app's own anchor arithmetic. */
function advance(span: DateSpan, frequency: Frequency, occurrence: number): DateSpan | undefined {
  const earliest = scheduledDate(span.earliest, frequency, occurrence);
  const latest = scheduledDate(span.latest, frequency, occurrence);
  if (!earliest || !latest) return undefined;
  if (span.precision === 'day') {
    return { earliest, latest, precision: 'day', raw: span.raw, label: formatAuDate(earliest) };
  }
  const [ey, em] = earliest.split('-').map(Number);
  const [ly, lm] = latest.split('-').map(Number);
  const sameMonth = ey === ly && em === lm;
  return {
    earliest,
    latest,
    precision: span.precision,
    raw: span.raw,
    label: sameMonth
      ? `${MONTH_LABEL[em! - 1]} ${ey}`
      : `${MONTH_LABEL[em! - 1]} ${ey} to ${MONTH_LABEL[lm! - 1]} ${ly}`,
  };
}

/**
 * When the next occurrence of one activity falls due.
 *
 * The **anchor rule**, inherited from src/domain/schedule.ts: occurrences are
 * counted from the anchor and never from the last service. On a six-monthly
 * that is the difference between a schedule and a slide — two services a year,
 * each a fortnight late, is a month of drift a year, and after five years the
 * "six-monthly" is running at eight and every individual record looks fine.
 * Where there is no anchor the schedule is counted from the last service and
 * `anchoredTo` says so, because that is a materially weaker answer and a reader
 * is entitled to know.
 *
 * The **precision rule**: an imprecise anchor produces an imprecise due span.
 * Nothing here turns "Jun-25" into a day.
 *
 * **No tolerance window is applied.** The tolerance tables this app holds are
 * the AS 1851 Section 6 ones and they govern detection and alarm systems. What
 * tolerance applies to a hose reel routine is not established here, so none is
 * assumed. That reports "due" slightly earlier than a tolerance would, which is
 * the safe direction to be wrong in, and it is in the notes rather than left
 * for somebody to discover.
 */
export function nextDue(input: DueInput): DueAssessment | Refused {
  const spec = ACTIVITY_SPECS[input.activity];
  const frequency = ACTIVITY_FREQUENCY[input.activity];
  const today = input.today.slice(0, 10);
  const notes: string[] = [];

  const commissioned = toSpan(input.commissioned);
  const firstService = toSpan(input.firstService);
  const lastDone = toSpan(input.lastDone);

  if (!commissioned && !firstService && !lastDone) {
    return {
      known: false,
      reason:
        `Nothing readable to count from: no commissioning date, no first service and no record of the last `
        + `${spec.label.toLowerCase()}.`,
      whatToDo:
        'Read the commissioning tag on the reel — AS 2441 Clause 12 requires the month and year of commissioning to be '
        + 'marked on an accessible fixed part of the assembly. Where there is no tag, that absence is itself a finding.',
      sourceIds: ['as2441', 'as1851'],
    };
  }

  const anchor = commissioned ?? firstService ?? lastDone!;
  const anchoredTo: DueAssessment['anchoredTo'] = commissioned
    ? 'commissioning'
    : firstService
      ? 'first-service'
      : 'last-service';

  if (anchor.earliest > today) {
    return {
      known: false,
      reason: `The anchor date reads ${anchor.label}, which is in the future.`,
      whatToDo:
        'Re-read it. A two-digit year read as the wrong century is the usual cause, and the register needs correcting '
        + 'at the source system rather than here.',
      sourceIds: ['as2441'],
    };
  }

  if (lastDone && lastDone.latest < anchor.earliest) {
    return {
      known: false,
      reason:
        `The last ${spec.label.toLowerCase()} reads ${lastDone.label}, which is before the anchor of ${anchor.label}.`,
      whatToDo:
        'One of the two dates is wrong. Do not schedule from either until the register is corrected — an asset '
        + 'scheduled off a bad anchor reads as compliant for years.',
      sourceIds: ['as1851'],
    };
  }

  if (anchoredTo === 'last-service') {
    notes.push(
      'No commissioning date and no first service were readable, so this is counted forward from the last service. Any '
      + 'lateness already in the record is carried forward with it, which is exactly the drift the anchor rule exists '
      + 'to prevent. Read the commissioning tag off the reel and re-assess.',
    );
  }

  // Which occurrence has already been done. Rounding in whole intervals is
  // right for a schedule whose services land within weeks of their date; a
  // service more than half an interval from any scheduled date shows up as a
  // missed occurrence below instead of being quietly absorbed.
  let doneOccurrence = 0;
  if (anchoredTo !== 'last-service' && lastDone) {
    const elapsed = monthsBetween(anchor.earliest, lastDone.earliest);
    doneOccurrence = Math.max(0, Math.round(elapsed / spec.intervalMonths));
  }

  // The occurrence that ought to have been done by now, from the anchor alone.
  let dueByNow = 0;
  while (dueByNow < 500) {
    const span = advance(anchor, frequency, dueByNow + 1);
    if (!span || span.latest > today) break;
    dueByNow += 1;
  }

  const occurrence = doneOccurrence + 1;
  const due = advance(anchor, frequency, occurrence);
  if (!due) {
    return {
      known: false,
      reason: 'The due date could not be worked out from the anchor.',
      whatToDo: 'Check the anchor is a real date and re-run.',
      sourceIds: ['as1851'],
    };
  }

  const state: DueState = today > due.latest ? 'overdue' : today >= due.earliest ? 'due' : 'upcoming';

  const missedOccurrences = Math.max(0, dueByNow - occurrence + 1);
  if (missedOccurrences > 1) {
    notes.push(
      `${missedOccurrences} occurrences of the ${spec.label.toLowerCase()} have fallen due since the last recorded `
      + 'one. The date given is the oldest one still outstanding, not the most recent.',
    );
  }
  if (!lastDone) {
    notes.push(
      `No ${spec.label.toLowerCase()} has ever been recorded against this reel. The date given is the first one due `
      + 'after the anchor, which on an old installation will be a long way in the past — and it is.',
    );
  }
  if (due.precision !== 'day') {
    notes.push(
      `The anchor was recorded as "${anchor.raw}" — ${anchor.precision === 'month' ? 'a month' : 'a year'} with no day `
      + `— so the next one falls due within ${due.label} rather than on a particular date. No day has been invented.`,
    );
  }
  notes.push(
    'No tolerance window has been applied. The AS 1851 Section 6 tolerances this app holds are for detection and alarm '
    + 'systems; what a hose reel routine is allowed is not established here, so none is assumed.',
  );
  notes.push(ACTIVITIES_ARE_INDEPENDENT);

  return {
    activity: input.activity,
    intervalMonths: spec.intervalMonths,
    anchoredTo,
    anchorNote:
      anchoredTo === 'commissioning'
        ? `Counted from commissioning, ${anchor.label}. Occurrence ${occurrence} since the reel went in.`
        : anchoredTo === 'first-service'
          ? `Counted from the first recorded ${spec.label.toLowerCase()}, ${anchor.label}. Occurrence ${occurrence} since.`
          : `Counted from the last service, ${anchor.label}, because no earlier anchor was readable.`,
    occurrence,
    due,
    state,
    everRecorded: !!lastDone,
    daysUntil: { earliest: daysBetween(today, due.earliest), latest: daysBetween(today, due.latest) },
    missedOccurrences,
    notes,
    confidence: anchoredTo === 'last-service' ? 'low' : spec.confidence,
    sourceIds: [...spec.sourceIds, 'qdc-mp61'],
  };
}

// ===========================================================================
// The site rollup
// ===========================================================================

export interface RegisterEntry {
  assetId: string;
  location?: string;
  /** Metres of hose on the reel, where it is known. */
  hoseLengthM?: number;
  commissioned?: string | ImpreciseDate;
  lastSixMonthly?: string | ImpreciseDate;
  /** The register's own five-yearly column. Never inferred from the six-monthly. */
  lastFiveYearly?: string | ImpreciseDate;
  /** Findings recorded at the last attendance. */
  findings?: (HoseFinding | string)[];
  /** Whether the hose was run off the drum at that attendance. */
  fullyDeployed?: boolean;
}

export interface ActivityRollup {
  activity: HoseReelActivity;
  label: string;
  overdue: number;
  dueWithinHorizon: number;
  later: number;
  /**
   * Reels with no record of this activity at all. Counted alongside the due
   * states rather than instead of them, because a reel can be both never
   * recorded and years overdue and both facts have to survive the rollup.
   */
  neverRecorded: number;
  /** Reels whose position could not be worked out, with the reasons and their counts. */
  unknown: number;
  unknownReasons: { reason: string; count: number }[];
}

export interface SiteRollup {
  total: number;
  horizonMonths: number;
  /** The last day inside the horizon, for the covering note on a proposal. */
  horizonEnds: string;
  byActivity: ActivityRollup[];
  overdue: number;
  dueWithinHorizon: number;
  /** Activity records that have never happened at all, across both activities. */
  neverRecorded: number;
  unknown: number;
  /** Reels whose hose has to come off, with the reason. */
  unserviceable: { assetId: string; location?: string; reason: string }[];
  /** Reels a technician has to rule on before they have a verdict at all. */
  needsJudgement: { assetId: string; location?: string; question: string }[];
  /** Reels with a defect that is not the hose. */
  repairable: { assetId: string; location?: string; reason: string }[];
  /** Reels nobody deployed, which is not the same as reels with nothing wrong. */
  notDeployed: number;
  caveats: string[];
  sourceIds: SourceId[];
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return isoDate(ty, tm, Math.min(d!, daysInMonth(ty, tm)));
}

const ROLLUP_ACTIVITIES: HoseReelActivity[] = ['six-monthly', 'five-yearly'];

/**
 * What this site owes, split by activity and never merged.
 *
 * The one thing a rollup of hose reels must not do is add the six-monthlies to
 * the five-yearlies and report a number of "services due". They are different
 * jobs with different times against them, and a site with forty reels all due a
 * five-yearly is a different day's work from forty six-monthlies with a
 * pressure test rig left in the van.
 *
 * Three disciplines carried over from the rest of the app:
 *
 *  - A reel whose schedule cannot be worked out is counted as unknown with its
 *    reason, never as compliant. A silent asset is the one that bites.
 *  - A reel nobody deployed is counted separately from a reel with nothing
 *    wrong, because they are not the same finding.
 *  - The caveats are returned data rather than prose a screen adds, so the
 *    numbers cannot travel without them.
 */
export function rollupSite(entries: RegisterEntry[], todayIso: string, horizonMonths = 12): SiteRollup {
  const today = todayIso.slice(0, 10);
  const horizonEnds = addMonthsIso(today, horizonMonths);

  const byActivity: ActivityRollup[] = ROLLUP_ACTIVITIES.map((activity) => ({
    activity,
    label: ACTIVITY_LABEL[activity],
    overdue: 0,
    dueWithinHorizon: 0,
    later: 0,
    neverRecorded: 0,
    unknown: 0,
    unknownReasons: [],
  }));

  const unserviceable: SiteRollup['unserviceable'] = [];
  const needsJudgement: SiteRollup['needsJudgement'] = [];
  const repairable: SiteRollup['repairable'] = [];
  let notDeployed = 0;
  let noHoseLength = 0;

  for (const entry of entries) {
    for (const activity of ROLLUP_ACTIVITIES) {
      const bucket = byActivity.find((b) => b.activity === activity)!;
      // The five-yearly is assessed from the five-yearly column alone. Falling
      // back to the six-monthly here would be the exact conflation this module
      // exists to prevent, and it would report every reel on the book as
      // current.
      const lastDone = activity === 'six-monthly' ? entry.lastSixMonthly : entry.lastFiveYearly;
      const assessment = nextDue({
        activity,
        commissioned: entry.commissioned,
        lastDone,
        today,
      });

      if (isRefused(assessment)) {
        bucket.unknown += 1;
        const found = bucket.unknownReasons.find((r) => r.reason === assessment.reason);
        if (found) found.count += 1;
        else bucket.unknownReasons.push({ reason: assessment.reason, count: 1 });
        continue;
      }

      if (!assessment.everRecorded) bucket.neverRecorded += 1;
      if (assessment.state === 'overdue') bucket.overdue += 1;
      else if (assessment.due.earliest <= horizonEnds) bucket.dueWithinHorizon += 1;
      else bucket.later += 1;
    }

    if (entry.hoseLengthM === undefined) noHoseLength += 1;

    const deployed = entry.fullyDeployed ?? false;
    if (!deployed) notDeployed += 1;

    const condition = assessHose({ findings: entry.findings ?? [], fullyDeployed: deployed });
    if (condition.verdict === 'unserviceable') {
      unserviceable.push({
        assetId: entry.assetId,
        location: entry.location,
        reason: condition.replaceHose.map((r) => r.label).join('; '),
      });
    } else if (condition.needsJudgement.length) {
      needsJudgement.push({
        assetId: entry.assetId,
        location: entry.location,
        question: condition.needsJudgement.map((r) => r.label).join('; '),
      });
    }
    if (condition.repairable.length) {
      repairable.push({
        assetId: entry.assetId,
        location: entry.location,
        reason: condition.repairable.map((r) => r.label).join('; '),
      });
    }
  }

  const caveats: string[] = [
    ACTIVITIES_ARE_INDEPENDENT,
    'No tolerance window has been applied to any of these dates.',
    AS1851_SECTION_NOT_ESTABLISHED,
    QLD_PRESCRIBED_NOTE,
  ];
  if (notDeployed) {
    caveats.push(
      `${notDeployed} reel${notDeployed === 1 ? ' was' : 's were'} not run out at the last attendance, so ` +
      `${notDeployed === 1 ? 'its hose has' : 'their hoses have'} no condition verdict. That is not a clean bill of health.`,
    );
  }
  if (noHoseLength) {
    caveats.push(
      `${noHoseLength} reel${noHoseLength === 1 ? ' has' : 's have'} no hose length recorded, so no coverage `
      + 'sense-check can be run against them.',
    );
  }

  return {
    total: entries.length,
    horizonMonths,
    horizonEnds,
    byActivity,
    overdue: byActivity.reduce((n, b) => n + b.overdue, 0),
    dueWithinHorizon: byActivity.reduce((n, b) => n + b.dueWithinHorizon, 0),
    neverRecorded: byActivity.reduce((n, b) => n + b.neverRecorded, 0),
    unknown: byActivity.reduce((n, b) => n + b.unknown, 0),
    unserviceable,
    needsJudgement,
    repairable,
    notDeployed,
    caveats,
    sourceIds: ['as1851', 'as2441', 'qdc-mp61'],
  };
}
