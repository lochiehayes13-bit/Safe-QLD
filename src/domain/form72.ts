/**
 * Form 72 — Fire Hydrant and Sprinkler System Periodic Testing and Maintenance.
 *
 * A Queensland Government form, published by the Department of Housing and
 * Public Works, required for maintenance to water-based fire safety
 * installations under QDC Mandatory Part 6.1, the Building Act 1975 sections 30
 * and 104, and the fire hydrant and sprinkler commissioning and periodic
 * maintenance procedure. A licensee signs it and their licence number goes on
 * it, which is why the app treats it as a statutory document rather than a
 * report: the wording on the page is the department's, not ours.
 *
 * That also makes it a different copyright case from an Australian Standard.
 * Crown material published for the purpose of being filled in and lodged can be
 * reproduced; a standard licensed per copy cannot. The form's structure is
 * therefore modelled faithfully here, part for part, including the parts a
 * particular job does not use.
 *
 * **N/A is a real answer and is not a pass.** Every part carries three states,
 * because a hydrant-only job legitimately does not test sprinklers, and a form
 * that shows a blank where the sprinkler result goes reads as an omission. A
 * part marked N/A says the technician considered it and it did not apply.
 *
 * Nothing here computes hydraulics. The form records what was measured; the
 * arithmetic that decides whether those readings pass lives in the hydrant
 * calculator, and duplicating it would give two answers to one question.
 */

import { qldIsoDay } from '@/domain/qldTime';

export type PartResult = 'na' | 'pass' | 'fail';

/** Which maintenance test this form covers. Both boxes can be ticked. */
export interface MaintenanceTest {
  hydrantAnnual: boolean;
  hydrantFiveYear: boolean;
  sprinklerAnnual: boolean;
  sprinklerFiveYear: boolean;
  combinedAnnual: boolean;
  combinedFiveYear: boolean;
}

/**
 * How long a device's calibration is good for.
 *
 * 'interval' is the ordinary case and the default: a test gauge is calibrated,
 * and twelve months later it is not, whatever anybody says about it.
 *
 * 'service-life' exists because Safe QLD's two flow meters are not gauges. The
 * manufacturer's certificate states that calibration is fixed in software and
 * that the device holds its accuracy for its service life, with recalibration
 * only on repair. Judged on the twelve-month rule those meters would block
 * every Form 72 raised a year after their certificate date — a form refused for
 * a reason the certificate says is not true.
 *
 * It is a per-device claim rather than a global exception, it clears only the
 * staleness check and none of the others, and the printed page says which basis
 * each device was accepted on. Ticked onto a pressure gauge it would be wrong,
 * and the page showing the basis is what makes that visible to a reader.
 */
export type CalibrationBasis = 'interval' | 'service-life';

export interface TestDevice {
  /** "Device/gauge 1" — the column it occupies on the form. */
  slot: string;
  serialNumber: string;
  /** ISO date. */
  dateCalibrated?: string;
  calibrationCertificate?: string;
  /** 65 / 100 / 150 mm, for a gauge. */
  faceSize?: string;
  digitalReader?: boolean;
  /** Gauge increments in kPa. */
  incrementsKpa?: number;
  /** Defaults to 'interval' where absent, which is every form already stored. */
  calibrationBasis?: CalibrationBasis;
  /**
   * What the device is, in the manufacturer's words.
   *
   * Not a field on the department's form. It is what makes a stored device
   * recognisable in a list a year later — "SQF-001" says nothing, "Flowtech
   * Omega Series inline meter" says which instrument was on the hydrant.
   */
  model?: string;
  /**
   * The gauge's correction, as kPa or a percentage.
   *
   * A row the department's form asks for and this model did not hold, which
   * made the Part C note a promise the page could not keep: it told the reader
   * the correction factor must be kPa or a percentage, and then printed no
   * correction factor. A gauge that reads 40 kPa high is usable once the
   * correction is on the page beside its serial number, and unusable without
   * it — the reader cannot tell a corrected figure from an uncorrected one.
   *
   * Free text rather than a number because the unit is part of the answer.
   */
  correctionFactor?: string;
}

export type FlowDeviceKind = 'orifice' | 'mechanical' | 'electromagnetic';

/** Part B — the hydrostatic test on the hydrant pipework. */
export interface HydrostaticTest {
  result: PartResult;
  boostPressureKpa?: number;
  testPressureKpa?: number;
  durationMinutes?: number;
  endPressureKpa?: number;
  lossLpm?: number;
  comments?: string;
}

/**
 * One row of Part D's flow table: a duty, and what was achieved.
 *
 * The department's table runs down the left in one column headed "size/flow
 * rate", and the two things it lists there are not the same kind of thing. The
 * top rows are nozzle bores — a 19, 22 or 25 mm nozzle held open, which is how
 * a hydrant is proved where there is no flow device on the truck. The rows
 * below are metered duties in litres per second. A model that held only the
 * litres-per-second rows could not record a nozzle test at all, and the three
 * nozzle rows are the ones a technician with a pitot and no flow meter
 * actually fills in.
 *
 * So a row is identified by whichever of the two it is, and exactly one is set.
 * Rows stored before the nozzle rows existed carry rateLps alone and read back
 * unchanged, which is why rateLps stayed optional rather than becoming part of
 * a tagged union: a migration of somebody's signed form is not worth a tidier
 * type.
 */
export interface FlowRow {
  /** The duty being proved, in litres per second, on a metered row. */
  rateLps?: number;
  /** The nozzle bore in millimetres, on a nozzle row. */
  nozzleMm?: number;
  devices: string;
  hydrant1Kpa?: number;
  hydrants12Kpa?: number;
  hydrants123Kpa?: number;
  /**
   * Four hydrants running together.
   *
   * The department's table has this fourth column and the model did not, so a
   * four-hydrant reading taken on site had nowhere to go and was either
   * dropped or written into the three-hydrant column, where it reads as a
   * different test than the one that was run.
   */
  hydrants1234Kpa?: number;
}

export interface FlowTest {
  result: PartResult | 'refer-to-report';
  hydrantLocations: string[];
  /**
   * What the system is required to deliver, which is the figure every reading
   * in the table is judged against. Without it the table is a column of
   * pressures and the reader has to know the design to say whether it passed.
   */
  requiredLps?: number;
  requiredKpa?: number;
  staticPressureKpa?: number;
  pressureZone?: string;
  onSitePumpSet?: boolean;
  rows: FlowRow[];
  /**
   * What it actually delivered, as the pair the form asks for.
   *
   * systemAchieved held the same answer as one free-text line and is kept so
   * that forms already signed still print what they said. New forms record the
   * two numbers, because a pair of numbers can be compared with the
   * requirement above and a sentence cannot.
   */
  achievedLps?: number;
  achievedKpa?: number;
  systemAchieved?: string;
  comment?: string;
}

/** The nozzle bores printed down Part D, in millimetres. */
export const PART_D_NOZZLE_SIZES_MM = [19, 22, 25] as const;

/** The metered duties printed down Part D, in litres per second. */
export const PART_D_DEVICE_RATES_LPS = [5, 10, 15, 20, 30] as const;

/** Part D's eight printed rows, in the order the department prints them. */
export const PART_D_ROWS: FlowRow[] = [
  ...PART_D_NOZZLE_SIZES_MM.map((nozzleMm) => ({ nozzleMm, devices: '' })),
  ...PART_D_DEVICE_RATES_LPS.map((rateLps) => ({ rateLps, devices: '' })),
];

/**
 * A row's identity, so the screen and the printed page agree on which line is
 * which without comparing floats in two places.
 */
export function flowRowKey(row: FlowRow): string {
  if (row.nozzleMm !== undefined) return `nozzle-${row.nozzleMm}`;
  if (row.rateLps !== undefined) return `device-${row.rateLps}`;
  return 'unidentified';
}

/**
 * How a row prints down the left of Part D.
 *
 * The department groups the eight rows under two headings — "Nozzles" over the
 * three bores, "Other portable testing devices" over the five metered rates —
 * and labels each row with the size alone. So the printed page carries the
 * group in its own cell and this is the size: "19 mm", "5 L/s".
 */
export function flowRowLabel(row: FlowRow): string {
  if (row.nozzleMm !== undefined) return `${row.nozzleMm} mm`;
  if (row.rateLps !== undefined) return `${row.rateLps} L/s`;
  return 'Unlabelled row';
}

/** The two headings the department groups Part D's rows under. */
export const FLOW_ROW_GROUP_LABEL = {
  nozzle: 'Nozzles',
  device: 'Other portable testing devices',
  unidentified: 'Other',
} as const;

export type FlowRowGroup = keyof typeof FLOW_ROW_GROUP_LABEL;

export function flowRowGroup(row: FlowRow): FlowRowGroup {
  if (row.nozzleMm !== undefined) return 'nozzle';
  if (row.rateLps !== undefined) return 'device';
  return 'unidentified';
}

/**
 * A row's label with its group, for anywhere the two cells are one line.
 *
 * The screen shows one row per card and has no column to put the group in, and
 * "19 mm" on its own card is ambiguous — a bore or a gauge face. The printed
 * table uses flowRowLabel and prints the group beside it.
 */
export function flowRowLongLabel(row: FlowRow): string {
  if (row.nozzleMm !== undefined) return `${row.nozzleMm} mm nozzle`;
  if (row.rateLps !== undefined) return `${row.rateLps} L/s device`;
  return 'Unlabelled row';
}

/** True where the technician put nothing at all on this line. */
export function flowRowUntouched(row: FlowRow): boolean {
  return !row.devices?.trim()
    && row.hydrant1Kpa === undefined
    && row.hydrants12Kpa === undefined
    && row.hydrants123Kpa === undefined
    && row.hydrants1234Kpa === undefined;
}

/** Part E — the pump appliance booster test. */
export interface BoosterTest {
  result: PartResult;
  hydrantLocations?: string;
  highestHydrantAboveBoosterM?: number;
  requiredLps?: number;
  requiredKpa?: number;
  staticPressureKpa?: number;
  pumpInletKpa?: number;
  pumpDischargeKpa?: number;
  boostPressureKpa?: number;
  /** Measured at the hydrant being proved, which the printed form assumes. */
  hydrantResidualKpa?: number;
  /**
   * A frictional loss the technician worked out and wrote down.
   *
   * The department's form has a box for this figure and expects it to be
   * filled in by hand. Where the residual at the hydrant was measured the app
   * can derive it instead and show its working, which is better evidence than
   * a number on its own — but a technician who measured at the booster and not
   * at the hydrant has a loss to record and no way for the app to check it,
   * and the box on the form still has to be filled.
   *
   * So both are held. The page prefers the derived figure and says how it got
   * there; where only this one exists it prints as stated rather than
   * calculated; and where the two disagree the page says so instead of
   * choosing a winner quietly.
   */
  statedFrictionalLossKpa?: number;
  comments?: string;
}

export interface SprinklerHydrostatic {
  result: PartResult;
  pressureKpa?: number;
  timeHeldMinutes?: number;
  comments?: string;
}

export interface SprinklerTestPoint {
  location: string;
  requiredFlowLpm?: number;
  resultFlowLpm?: number;
  requiredPressureKpa?: number;
  resultPressureKpa?: number;
  /**
   * The Pass / Fail boxes the department prints on each of these two lines.
   *
   * The app can work the comparison out from the two figures beside them, and
   * does. These hold what the technician actually ticked, which is not always
   * the same answer — a required flow of 540 L/min achieved at 538 is a fail
   * by subtraction and may be a pass by the standard's tolerance, and the
   * person on the ladder is the one who knows which.
   *
   * Holding both means the page can print the tick and flag the disagreement,
   * rather than silently overruling a licensee on a form they sign.
   */
  flowResult?: 'pass' | 'fail';
  pressureResult?: 'pass' | 'fail';
}

export interface SprinklerFlowTest {
  result: PartResult;
  systemSpec?: string;
  testPoints: SprinklerTestPoint[];
  runningTestGaugeKpa?: number;
  comments?: string;
}

export interface Form72 {
  id: string;
  siteId: string;
  siteName: string;
  siteAddress?: string;
  contractor: string;
  /** ISO date. */
  testDate?: string;
  testTime?: string;
  maintenanceTest: MaintenanceTest;

  hydrostatic: HydrostaticTest;
  flowDeviceKinds: FlowDeviceKind[];
  devices: TestDevice[];
  flowTest: FlowTest;
  booster: BoosterTest;
  sprinklerHydrostatic: SprinklerHydrostatic;
  sprinklerFlow: SprinklerFlowTest;

  criticalDefectsIdentified?: boolean;
  repairsRequired?: boolean;
  systemResult: PartResult;
  systemNotes?: string;

  licenseeName: string;
  licenceNumber: string;
  licenseeReportNumber?: string;
  signature?: string;

  /*
   * What the department's form does not have a box for.
   *
   * Part H asks that repair details be attached to the licensee's report, and
   * the form itself never names the owner, the technician who did the work, or
   * the building's classification. Those belong to the record whatever the
   * printed layout does with them, so they are held here and printed on an
   * attachment page after Part I — added to the department's form rather than
   * written into it, which is the distinction a reader has to be able to make.
   */
  owner?: string;
  ownerContact?: string;
  buildingClassification?: string;
  /** The person who did the work, where that is not the licensee who signs. */
  technician?: string;
  qualification?: string;
  defects: FormDefect[];

  createdAt: string;
  updatedAt: string;
}

/**
 * One defect found on the day.
 *
 * Critical is its own flag rather than a word in the description, because it
 * decides something: a critical defect obliges the owner or occupier to be
 * given a notice, and Part H's first question is whether any were found. A
 * form with a defect flagged critical and that question answered "no"
 * contradicts itself, which the validation can only catch if the flag is a
 * field.
 */
export interface FormDefect {
  description: string;
  critical: boolean;
}

export const PART_RESULT_LABEL: Record<PartResult, string> = {
  na: 'N/A',
  pass: 'Pass',
  fail: 'Fail',
};

/** Water is about 9.81 kPa per metre of head at ordinary temperatures. */
export const KPA_PER_METRE_HEAD = 9.81;

export function elevationHeadKpa(metres: number): number {
  return Math.round(metres * KPA_PER_METRE_HEAD * 10) / 10;
}

/**
 * Part E's "calculated frictional loss".
 *
 * What the brigade puts in at the booster has to get to the hydrant, and two
 * things take from it on the way: the climb, and friction in the pipe. The
 * climb is arithmetic; whatever is left unaccounted for is the friction, and
 * that is the number the form asks for.
 *
 * Returns undefined rather than a figure when a reading is missing. A frictional
 * loss computed from an assumed zero is indistinguishable on the page from one
 * that was measured, and this form is signed.
 */
export function frictionalLossKpa(b: BoosterTest): number | undefined {
  const { boostPressureKpa, highestHydrantAboveBoosterM, hydrantResidualKpa } = b;
  if (boostPressureKpa === undefined || hydrantResidualKpa === undefined) return undefined;
  if (highestHydrantAboveBoosterM === undefined) return undefined;
  const loss = boostPressureKpa - elevationHeadKpa(highestHydrantAboveBoosterM) - hydrantResidualKpa;
  return Math.round(loss * 10) / 10;
}

/**
 * Which frictional loss the page should print, and why.
 *
 * Two figures can exist: one the app derived from the boost, the climb and the
 * residual, and one the technician wrote down. The derived figure is preferred
 * because it carries its own working, but it is not always available, and
 * where both exist and disagree the disagreement is the finding — one of the
 * readings behind it is wrong, and overwriting either with the other hides
 * which.
 *
 * A kilopascal of slack is allowed before calling it a disagreement. Both
 * numbers are rounded to a tenth and the derived one runs through 9.81 kPa per
 * metre, so exact agreement is not something either side can promise.
 */
export const FRICTIONAL_LOSS_TOLERANCE_KPA = 1;

export interface FrictionalLoss {
  kpa?: number;
  source: 'calculated' | 'stated' | 'none';
  /** The stated figure, where one exists and the calculated one was used. */
  disagreesWithKpa?: number;
}

export function resolveFrictionalLoss(b: BoosterTest): FrictionalLoss {
  const calculated = frictionalLossKpa(b);
  const stated = b.statedFrictionalLossKpa;

  if (calculated === undefined) {
    return stated === undefined
      ? { source: 'none' }
      : { kpa: stated, source: 'stated' };
  }

  const disagrees = stated !== undefined
    && Math.abs(stated - calculated) > FRICTIONAL_LOSS_TOLERANCE_KPA;

  return {
    kpa: calculated,
    source: 'calculated',
    disagreesWithKpa: disagrees ? stated : undefined,
  };
}

/**
 * Part A's maintenance test grid, read as the two questions it really asks.
 *
 * The department prints a three-by-two grid — hydrant, sprinkler or combined
 * down the side, annual or five-yearly across the top — and the six booleans
 * model it cell for cell. A technician does not think in six cells; they think
 * "combined system, annual test", which is one choice on each axis.
 *
 * So the screen asks the two questions and this maps the answers onto the grid
 * the form prints. The six booleans stay the stored shape, because a form
 * already on a phone may have ticked two cells that no pair of axes can
 * express, and the grid can still say exactly what was ticked.
 */
export type SystemType = 'hydrant' | 'sprinkler' | 'combined';
export type TestInterval = 'annual' | 'fiveYear';

export const SYSTEM_TYPE_LABEL: Record<SystemType, string> = {
  hydrant: 'Fire hydrant',
  sprinkler: 'Fire sprinkler',
  combined: 'Combined',
};

export const TEST_INTERVAL_LABEL: Record<TestInterval, string> = {
  annual: 'Annual',
  fiveYear: '5 year',
};

const CELL: Record<SystemType, Record<TestInterval, keyof MaintenanceTest>> = {
  hydrant: { annual: 'hydrantAnnual', fiveYear: 'hydrantFiveYear' },
  sprinkler: { annual: 'sprinklerAnnual', fiveYear: 'sprinklerFiveYear' },
  combined: { annual: 'combinedAnnual', fiveYear: 'combinedFiveYear' },
};

export function maintenanceTestCell(
  type: SystemType,
  interval: TestInterval,
): keyof MaintenanceTest {
  return CELL[type][interval];
}

/** The system types with any box ticked across them. */
export function systemTypesTested(m: MaintenanceTest): SystemType[] {
  return (Object.keys(CELL) as SystemType[])
    .filter((t) => m[CELL[t].annual] || m[CELL[t].fiveYear]);
}

/** The intervals with any box ticked down them. */
export function intervalsTested(m: MaintenanceTest): TestInterval[] {
  return (['annual', 'fiveYear'] as TestInterval[])
    .filter((i) => (Object.keys(CELL) as SystemType[]).some((t) => m[CELL[t][i]]));
}

/**
 * Tick the grid from the two axes.
 *
 * Every combination of the chosen types and intervals is set, which for one
 * type and one interval is the single cell a technician meant. Anything
 * previously ticked outside that product is cleared, so the grid always says
 * what the two controls say.
 */
export function maintenanceTestFromAxes(
  types: SystemType[],
  intervals: TestInterval[],
): MaintenanceTest {
  const m: MaintenanceTest = {
    hydrantAnnual: false, hydrantFiveYear: false,
    sprinklerAnnual: false, sprinklerFiveYear: false,
    combinedAnnual: false, combinedFiveYear: false,
  };
  for (const t of types) for (const i of intervals) m[CELL[t][i]] = true;
  return m;
}

/**
 * The 150 per cent duty flow check.
 *
 * Testing a pump at its rated duty proves very little — a pump on the way out
 * still makes its number at the easy end of the curve. The test that finds it
 * runs the pump at 150% of duty flow and requires the discharge pressure to
 * still reach 65% of the duty pressure. Safe QLD's own combined flow test
 * certificate states the rule and works the example: 16 L/s at 700 kPa gives
 * 24 L/s at 455 kPa.
 *
 * That certificate carries a second, contradictory worked example putting the
 * same case at 560 kPa, which is 80% rather than 65%. 455 is what the stated
 * rule gives, and it is what this uses — but the disagreement is reported
 * rather than quietly resolved, because it is the kind of thing that has been
 * copied from certificate to certificate for years.
 */
export const OVERLOAD_FLOW_FRACTION = 1.5;
export const OVERLOAD_PRESSURE_FRACTION = 0.65;

export interface OverloadCheck {
  /** 150% of the duty flow, in litres per second. */
  requiredFlowLps: number;
  /** 65% of the duty pressure, in kPa. */
  requiredPressureKpa: number;
  achieved?: boolean;
  shortfallKpa?: number;
  note: string;
}

export function overloadCheck(
  dutyFlowLps: number,
  dutyPressureKpa: number,
  measured?: { flowLps: number; pressureKpa: number },
): OverloadCheck | undefined {
  if (!(dutyFlowLps > 0) || !(dutyPressureKpa > 0)) return undefined;

  const requiredFlowLps = Math.round(dutyFlowLps * OVERLOAD_FLOW_FRACTION * 100) / 100;
  const requiredPressureKpa = Math.round(dutyPressureKpa * OVERLOAD_PRESSURE_FRACTION);

  const note = `At ${requiredFlowLps} L/s the discharge pressure must still reach `
    + `${requiredPressureKpa} kPa, which is 65% of the ${dutyPressureKpa} kPa duty pressure.`;

  if (!measured) return { requiredFlowLps, requiredPressureKpa, note };

  // A test run below the required flow has not proved the point, whatever
  // pressure it made.
  if (measured.flowLps + 0.001 < requiredFlowLps) {
    return {
      requiredFlowLps,
      requiredPressureKpa,
      achieved: false,
      note: `${note} The test ran at ${measured.flowLps} L/s, below the ${requiredFlowLps} L/s `
        + 'required, so it has not proved the pump at overload whatever pressure it held.',
    };
  }

  const achieved = measured.pressureKpa + 0.001 >= requiredPressureKpa;
  return {
    requiredFlowLps,
    requiredPressureKpa,
    achieved,
    shortfallKpa: achieved ? undefined : requiredPressureKpa - measured.pressureKpa,
    note,
  };
}

export interface FormIssue {
  part: string;
  message: string;
  /** A blocker stops the form being issued; a caution is worth knowing. */
  blocking: boolean;
}

/*
 * The day a form date names, as UTC midnight for the calibration arithmetic.
 *
 * Read through qldIsoDay rather than Date.parse, which takes a slashed date
 * month-first: a gauge calibrated 1/9/2025 was being dated 9 January and
 * judged against the test from there. A date that is not an ISO day or an
 * instant is unreadable here, and the form says so rather than guessing.
 */
const isoDate = (s?: string): number | undefined => {
  const day = qldIsoDay(s);
  return day ? Date.parse(`${day}T00:00:00Z`) : undefined;
};

/** Twelve months is the usual calibration interval for a test gauge. */
export const CALIBRATION_MONTHS = 12;

/** Where a device sits against the test date. */
export type CalibrationState =
  /** Nothing to judge — no serial number, so this is an empty slot on the form. */
  | 'not-a-device'
  | 'no-date'
  | 'unreadable-date'
  /** No test date yet, so there is nothing to measure the calibration against. */
  | 'no-test-date'
  | 'calibrated-after-test'
  | 'out-of-calibration'
  /** Certified by the manufacturer for the device's service life, not an interval. */
  | 'service-life'
  | 'in-calibration';

export interface DeviceCalibration {
  state: CalibrationState;
  /** Months between calibration and test, where both are readable. */
  monthsBefore?: number;
  /** The Part C issue this raises, absent where it raises none. */
  issue?: FormIssue;
}

/**
 * One device, judged against the day it was used.
 *
 * Shared by the validation and by the screen rather than written twice. The
 * screen needs to colour a single device card and the validation needs the list
 * for the whole form, and when those two were separate implementations the
 * screen quietly answered a narrower question — it flagged a gauge past twelve
 * months and said nothing at all about one with no calibration date on it,
 * which is the same unusable reading with less evidence behind it.
 */
export function deviceCalibration(
  device: TestDevice,
  testDate: string | undefined,
): DeviceCalibration {
  if (!device.serialNumber.trim()) return { state: 'not-a-device' };

  if (!device.dateCalibrated) {
    return {
      state: 'no-date',
      issue: {
        part: 'C',
        message: `${device.slot} (${device.serialNumber}) has no calibration date, so its readings `
          + 'cannot be relied on.',
        blocking: false,
      },
    };
  }

  const calAt = isoDate(device.dateCalibrated);
  if (calAt === undefined) {
    return {
      state: 'unreadable-date',
      issue: { part: 'C', message: `${device.slot} has an unreadable calibration date.`, blocking: false },
    };
  }

  const testAt = isoDate(testDate);
  if (testAt === undefined) return { state: 'no-test-date' };

  if (calAt > testAt) {
    return {
      state: 'calibrated-after-test',
      issue: {
        part: 'C',
        message: `${device.slot} was calibrated after the test date. One of the two dates is wrong.`,
        blocking: false,
      },
    };
  }

  const monthsBefore = (testAt - calAt) / (1000 * 60 * 60 * 24 * 30.44);

  // A device whose certificate covers its service life is not stale at twelve
  // months. Everything above still applied to it — a missing date, an
  // unreadable one and one after the test are the same problem whatever the
  // basis — and the age is still reported, so the page can print how old the
  // certificate is alongside the basis it was accepted on.
  if (device.calibrationBasis === 'service-life') return { state: 'service-life', monthsBefore };

  if (monthsBefore > CALIBRATION_MONTHS) {
    return {
      state: 'out-of-calibration',
      monthsBefore,
      issue: {
        part: 'C',
        message: `${device.slot} (${device.serialNumber}) was last calibrated `
          + `${Math.floor(monthsBefore)} months before the test. Every pressure recorded on this `
          + 'form was read with it, and a gauge out of calibration makes all of them unusable.',
        blocking: true,
      },
    };
  }

  return { state: 'in-calibration', monthsBefore };
}

/**
 * What the office sends back, and one thing it cannot see.
 *
 * Part C exists on this form for a single reason: a gauge outside its
 * calibration makes every pressure on the page unusable, and nobody notices
 * until the form is challenged. The app holds both the calibration date and the
 * test date, so it is the one check a person reading the paper cannot do.
 */
export function validateForm72(form: Form72): FormIssue[] {
  const issues: FormIssue[] = [];
  const testAt = isoDate(form.testDate);

  if (!form.testDate) issues.push({ part: 'A', message: 'No test date.', blocking: true });
  else if (testAt === undefined) {
    // Every calibration on the form is judged against this date, so one that
    // cannot be read cannot be issued against.
    issues.push({
      part: 'A',
      message: `The test date "${form.testDate}" cannot be read. Enter it as a calendar date.`,
      blocking: true,
    });
  }
  if (!form.contractor.trim()) issues.push({ part: 'A', message: 'No contractor named.', blocking: true });
  if (!form.licenseeName.trim()) issues.push({ part: 'I', message: 'No licensee name.', blocking: true });
  if (!form.licenceNumber.trim()) {
    issues.push({
      part: 'I',
      message: 'No QBCC or PIC licence number. The form is a statement by a licensed person and is '
        + 'not valid without it.',
      blocking: true,
    });
  }

  const anyTest = Object.values(form.maintenanceTest).some(Boolean);
  if (!anyTest) {
    issues.push({ part: 'A', message: 'No maintenance test ticked, so the form does not say what was done.', blocking: true });
  }

  for (const d of form.devices) {
    const state = deviceCalibration(d, form.testDate);
    if (state.issue) issues.push(state.issue);
  }

  if (form.hydrostatic.result !== 'na') {
    const h = form.hydrostatic;
    if (h.testPressureKpa === undefined || h.durationMinutes === undefined) {
      issues.push({ part: 'B', message: 'Hydrostatic test has no pressure or no duration recorded.', blocking: true });
    }
    if (h.result === 'pass' && h.endPressureKpa !== undefined && h.testPressureKpa !== undefined
      && h.endPressureKpa < h.testPressureKpa) {
      issues.push({
        part: 'B',
        message: `Recorded as a pass but the pressure fell from ${h.testPressureKpa} to `
          + `${h.endPressureKpa} kPa over the test. A drop is a loss, and the loss field is blank.`,
        blocking: h.lossLpm === undefined,
      });
    }
  }

  if (form.flowTest.result === 'fail' && !form.systemNotes?.trim()) {
    issues.push({
      part: 'H',
      message: 'The flow test failed and there is no system note saying what happens next.',
      blocking: false,
    });
  }

  if (form.systemResult === 'fail' && form.criticalDefectsIdentified === undefined) {
    issues.push({
      part: 'H',
      message: 'The system failed but the critical defect question is unanswered. If it is critical, '
        + 'the occupier has to be given a notice.',
      blocking: true,
    });
  }

  if (form.criticalDefectsIdentified && form.systemResult === 'pass') {
    issues.push({
      part: 'H',
      message: 'Critical defects were identified but the system is marked as a pass.',
      blocking: true,
    });
  }

  /*
   * A part that failed, and a system that did not.
   *
   * The parts are the evidence and Part H is the conclusion drawn from them,
   * so a failed part under a passing system is the form disagreeing with
   * itself — and it is the direction of disagreement that matters, because the
   * document says a system is fit when its own readings say it is not. Marked
   * blocking against a pass, and a caution against N/A: a form that records a
   * failure and then declines to say what the system is has at least not
   * claimed anything false.
   */
  const failedParts = failedPartLetters(form);
  if (failedParts.length) {
    const list = failedParts.length === 1
      ? `Part ${failedParts[0]}`
      : `Parts ${failedParts.slice(0, -1).join(', ')} and ${failedParts[failedParts.length - 1]}`;
    if (form.systemResult === 'pass') {
      issues.push({
        part: 'H',
        message: `${list} ${failedParts.length === 1 ? 'is' : 'are'} recorded as a fail while the `
          + 'system is marked as a pass. The parts are the evidence for the system result, so one '
          + 'of the two is wrong.',
        blocking: true,
      });
    } else if (form.systemResult === 'na') {
      issues.push({
        part: 'H',
        message: `${list} ${failedParts.length === 1 ? 'is' : 'are'} recorded as a fail and the `
          + 'system result is not applicable. A form that records a failure should say what that '
          + 'means for the system.',
        blocking: false,
      });
    }
  }

  /*
   * A defect nobody carried up to Part H.
   *
   * Part H's first question decides whether the owner or occupier is handed a
   * critical defect notice. A defect flagged critical on the attachment with
   * that question answered "no" is the one contradiction on this form with a
   * statutory consequence, so it blocks.
   */
  const criticals = form.defects.filter((d) => d.critical).length;
  if (criticals && form.criticalDefectsIdentified !== true) {
    issues.push({
      part: 'H',
      message: `${criticals} defect${criticals === 1 ? ' is' : 's are'} flagged critical, but Part H `
        + `${form.criticalDefectsIdentified === false ? 'says no critical defects were identified'
          : 'does not answer the critical defect question'}. If a defect is critical the owner or `
        + 'occupier has to be given a notice.',
      blocking: true,
    });
  }

  /*
   * A defect with no words in it.
   *
   * An empty row on the attachment reads as a defect somebody began recording
   * and did not finish, which is worse than no row: a reader cannot tell
   * whether something was found.
   */
  if (form.defects.some((d) => !d.description.trim())) {
    issues.push({
      part: 'H',
      message: 'A defect has been added with no description. Describe it or take the row off.',
      blocking: false,
    });
  }

  return issues;
}

/**
 * Which parts recorded a fail.
 *
 * Part D's "refer to report" is deliberately not a fail — it is the department's
 * third box and says the answer is in the licensee's report, not that the test
 * was failed.
 */
export function failedPartLetters(form: Form72): string[] {
  const parts: [string, PartResult | 'refer-to-report'][] = [
    ['B', form.hydrostatic.result],
    ['D', form.flowTest.result],
    ['E', form.booster.result],
    ['F', form.sprinklerHydrostatic.result],
    ['G', form.sprinklerFlow.result],
  ];
  const letters = parts.filter(([, r]) => r === 'fail').map(([p]) => p);

  // Part G's two lines carry their own ticks, and a line ticked Fail under a
  // part the technician left on Pass is the same contradiction one level down.
  const linesFailed = form.sprinklerFlow.testPoints
    .some((p) => p.flowResult === 'fail' || p.pressureResult === 'fail');
  if (linesFailed && !letters.includes('G')) letters.push('G');

  return letters;
}

/** True when the form can be issued: nothing blocking is outstanding. */
export function canIssue(form: Form72): boolean {
  return !validateForm72(form).some((i) => i.blocking);
}

/** A blank form, so a new one starts in a state that validates honestly. */
export function emptyForm72(input: {
  id: string;
  siteId: string;
  siteName: string;
  contractor?: string;
  now: string;
}): Form72 {
  return {
    id: input.id,
    siteId: input.siteId,
    siteName: input.siteName,
    contractor: input.contractor ?? '',
    maintenanceTest: {
      hydrantAnnual: false, hydrantFiveYear: false,
      sprinklerAnnual: false, sprinklerFiveYear: false,
      combinedAnnual: false, combinedFiveYear: false,
    },
    hydrostatic: { result: 'na' },
    flowDeviceKinds: [],
    devices: [],
    flowTest: { result: 'na', hydrantLocations: [], rows: [] },
    booster: { result: 'na' },
    sprinklerHydrostatic: { result: 'na' },
    sprinklerFlow: { result: 'na', testPoints: [] },
    systemResult: 'na',
    defects: [],
    licenseeName: '',
    licenceNumber: '',
    createdAt: input.now,
    updatedAt: input.now,
  };
}
