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

export interface TestDevice {
  /** "Device 1", "Gauge 2" — the column it occupies on the form. */
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

/** One row of Part D's flow table: a duty, and what was achieved. */
export interface FlowRow {
  /** The duty being proved, in litres per second. */
  rateLps: number;
  devices: string;
  hydrant1Kpa?: number;
  hydrants12Kpa?: number;
  hydrants123Kpa?: number;
}

export interface FlowTest {
  result: PartResult | 'refer-to-report';
  hydrantLocations: string[];
  staticPressureKpa?: number;
  pressureZone?: string;
  onSitePumpSet?: boolean;
  rows: FlowRow[];
  systemAchieved?: string;
  comment?: string;
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

  createdAt: string;
  updatedAt: string;
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

const isoDate = (s?: string): number | undefined => {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};

/** Twelve months is the usual calibration interval for a test gauge. */
export const CALIBRATION_MONTHS = 12;

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
    if (!d.serialNumber.trim()) continue;
    if (!d.dateCalibrated) {
      issues.push({
        part: 'C',
        message: `${d.slot} (${d.serialNumber}) has no calibration date, so its readings cannot be relied on.`,
        blocking: false,
      });
      continue;
    }
    const calAt = isoDate(d.dateCalibrated);
    if (calAt === undefined) {
      issues.push({ part: 'C', message: `${d.slot} has an unreadable calibration date.`, blocking: false });
      continue;
    }
    if (testAt === undefined) continue;
    if (calAt > testAt) {
      issues.push({
        part: 'C',
        message: `${d.slot} was calibrated after the test date. One of the two dates is wrong.`,
        blocking: false,
      });
      continue;
    }
    const months = (testAt - calAt) / (1000 * 60 * 60 * 24 * 30.44);
    if (months > CALIBRATION_MONTHS) {
      issues.push({
        part: 'C',
        message: `${d.slot} (${d.serialNumber}) was last calibrated ${Math.floor(months)} months `
          + 'before the test. Every pressure recorded on this form was read with it, and a gauge '
          + 'out of calibration makes all of them unusable.',
        blocking: true,
      });
    }
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

  return issues;
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
    licenseeName: '',
    licenceNumber: '',
    createdAt: input.now,
    updatedAt: input.now,
  };
}
