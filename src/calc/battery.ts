/**
 * Fire indicator panel standby battery sizing.
 *
 * Implements the Australian capacity formula:
 *
 *   C20 = L x [ (Iq x Tq) + Fc x (Ia x Ta) ]
 *
 * where the result is amp-hours at the 20-hour discharge rate — the figure
 * printed on a VRLA battery's label.
 *
 * Two things here are worth more than the arithmetic:
 *
 *  - Tq defaults to 72 h. The familiar "24 hours plus 30 minutes" applies only
 *    where the power-supply-failure signal is continuously monitored. That is
 *    common (any brigade-monitored building) but it is not universal, and
 *    assuming it silently undersizes the battery by roughly three times.
 *  - Standby and alarm current are modelled per load, independently. Door
 *    holders are the classic trap: energised in standby, de-energised in alarm,
 *    so they dominate Iq and contribute nothing to Ia.
 */

export type CalcMode = 'design' | 'service';

/** Deterioration compensation factor L. */
export const L_DESIGN = 1.25;
/** Permitted only when assessing an installed battery over 12 months old. */
export const L_IN_SERVICE = 1.1;

/** High-rate alarm discharge de-rating factor Fc — 2 is the deemed-to-satisfy value. */
export const FC_DEFAULT = 2;

/** Standby hours: base requirement, and the reduced figure for monitored systems. */
export const TQ_UNMONITORED = 72;
export const TQ_MONITORED = 24;

/** Alarm load duration in hours (30 minutes). */
export const TA_DEFAULT = 0.5;

/** The formula is stated for an average battery temperature in this window. */
export const TEMP_MIN_C = 15;
export const TEMP_MAX_C = 30;

/** Common Australian VRLA sizes. A 24 V system is always two 12 V units in series. */
export const STANDARD_SLA_AH = [
  1.2, 2.3, 3.2, 4.5, 7, 9, 12, 17, 24, 26, 33, 40, 50, 65, 100,
] as const;

/**
 * Fraction of C20 nameplate capacity actually available at higher discharge
 * rates. Used only to explain why Fc exists — sizing always uses Fc.
 */
export const CAPACITY_VS_RATE: { rate: number; fraction: number }[] = [
  { rate: 0.05, fraction: 1.0 },
  { rate: 0.1, fraction: 0.9 },
  { rate: 0.2, fraction: 0.8 },
  { rate: 0.5, fraction: 0.65 },
  { rate: 1.0, fraction: 0.55 },
  { rate: 2.0, fraction: 0.4 },
  { rate: 3.0, fraction: 0.36 },
];

/**
 * A current-consuming line item.
 *
 * Standby and alarm are entered separately and never derived from one another.
 */
export interface LoadItem {
  id: string;
  label: string;
  /** How many of this item. */
  quantity: number;
  /** Per-unit standby current in milliamps. */
  standbyMa: number;
  /** Per-unit alarm current in milliamps. */
  alarmMa: number;
  /** Marks the alarm signalling equipment line, which must be answered explicitly. */
  isAse?: boolean;
  note?: string;
}

export interface BatteryInput {
  mode: CalcMode;
  loads: LoadItem[];
  /** True when the PSE power-supply-failure signal is continuously monitored. */
  monitored: boolean;
  /** Alarm duration in hours. */
  alarmHours: number;
  /** Deterioration factor. Forced to 1.25 in design mode. */
  deteriorationFactor: number;
  /** High-rate de-rating factor. */
  capacityDerating: number;
  /** Average battery temperature in Celsius, for the validity check. */
  averageTempC?: number;
  /** Nameplate capacity of the battery actually installed, for service mode. */
  installedBatteryAh?: number;
  /** Panel's maximum battery capacity, for the fit check. */
  panelMaxBatteryAh?: number;
  /** PSU continuous output rating in amps. */
  psuOutputA?: number;
  /** PSU charging current in amps. */
  psuChargeCurrentA?: number;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  title: string;
  detail: string;
}

export interface BatteryResult {
  /** Total standby current in amps. */
  quiescentA: number;
  /** Total alarm current in amps. */
  alarmA: number;
  standbyHours: number;
  alarmHours: number;
  /** The standby term of the formula, in Ah. */
  standbyAh: number;
  /** The de-rated alarm term, in Ah. */
  alarmAh: number;
  /** Capacity before the deterioration factor. */
  subtotalAh: number;
  /** Required capacity at the 20 h rate. */
  requiredAh: number;
  /** Next standard size at or above requiredAh, or null when off the top of the range. */
  recommendedAh: number | null;
  /** Service mode: does the installed battery meet the requirement. */
  installedPasses?: boolean;
  issues: Issue[];
  /** Alarm discharge expressed as a multiple of C, for the explanatory panel. */
  alarmCRate?: number;
  /** De-rating the discharge curve actually implies, versus the mandated Fc. */
  effectiveDerating?: number;
  charger?: ChargerResult;
}

export interface ChargerResult {
  /** Minimum charge current to restore 80% of capacity within 24 h. */
  minimumChargeA: number;
  /** Whether the PSU's charge current meets that minimum. */
  rechargeOk: boolean | null;
  /** Continuous PSU output needed to carry quiescent load and charge at once. */
  requiredContinuousA: number;
  simultaneousOk: boolean | null;
}

/** Charge-acceptance allowance for VRLA. Engineering practice, not a standard figure. */
const CHARGE_INEFFICIENCY = 1.2;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Sums a load list into total amps for each state. */
export function totalCurrents(loads: LoadItem[]): { quiescentA: number; alarmA: number } {
  let q = 0;
  let a = 0;
  for (const l of loads) {
    const qty = Number.isFinite(l.quantity) ? l.quantity : 0;
    q += (Number.isFinite(l.standbyMa) ? l.standbyMa : 0) * qty;
    a += (Number.isFinite(l.alarmMa) ? l.alarmMa : 0) * qty;
  }
  return { quiescentA: q / 1000, alarmA: a / 1000 };
}

/** Next standard SLA size at or above the required capacity. */
export function nextStandardSize(requiredAh: number): number | null {
  for (const s of STANDARD_SLA_AH) {
    if (s >= requiredAh - 1e-9) return s;
  }
  return null;
}

/** Interpolates the capacity-vs-rate curve, clamping outside the tabulated range. */
export function availableFractionAtRate(cRate: number): number {
  const pts = CAPACITY_VS_RATE;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (cRate <= first.rate) return first.fraction;
  if (cRate >= last.rate) return last.fraction;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (cRate <= b.rate) {
      const span = b.rate - a.rate;
      const ratio = span === 0 ? 0 : (cRate - a.rate) / span;
      return a.fraction + ratio * (b.fraction - a.fraction);
    }
  }
  return last.fraction;
}

/** Sizes the standby battery and runs the supporting compliance checks. */
export function calculateBattery(input: BatteryInput): BatteryResult {
  const issues: Issue[] = [];
  const { quiescentA, alarmA } = totalCurrents(input.loads);

  const standbyHours = input.monitored ? TQ_MONITORED : TQ_UNMONITORED;
  const alarmHours = input.alarmHours > 0 ? input.alarmHours : TA_DEFAULT;

  // Design sizing is always against a new battery; 1.1 is a service-only allowance.
  const L = input.mode === 'design' ? L_DESIGN : input.deteriorationFactor;
  const Fc = input.capacityDerating > 0 ? input.capacityDerating : FC_DEFAULT;

  const standbyAh = quiescentA * standbyHours;
  const alarmAh = Fc * alarmA * alarmHours;
  const subtotalAh = standbyAh + alarmAh;
  const requiredAh = L * subtotalAh;
  const recommendedAh = nextStandardSize(requiredAh);

  if (input.mode === 'service' && input.deteriorationFactor === L_IN_SERVICE) {
    issues.push({
      level: 'info',
      title: 'Reduced deterioration factor in use',
      detail:
        'L = 1.1 applies only when assessing a battery already in service for more than 12 months. A new battery, or any design or commissioning calculation, uses 1.25.',
    });
  }

  if (!input.monitored) {
    issues.push({
      level: 'info',
      title: '72 hour standby applied',
      detail:
        'The power-supply-failure signal is not continuously monitored, so the full 72 hour standby period applies. This is roughly three times the battery of a monitored system.',
    });
  }

  if (!input.loads.some((l) => l.isAse)) {
    issues.push({
      level: 'warning',
      title: 'No alarm signalling equipment load entered',
      detail:
        'Brigade monitoring equipment draws current in both standby and alarm and is routinely left out. Add it, or add a line recording that the site has none.',
    });
  }

  if (quiescentA <= 0) {
    issues.push({
      level: 'error',
      title: 'No standby current entered',
      detail: 'Add the panel and its connected loads before relying on this result.',
    });
  }

  if (alarmA > 0 && alarmA < quiescentA) {
    issues.push({
      level: 'warning',
      title: 'Alarm current is below standby current',
      detail:
        'That is possible on a system with many door holders, which drop out in alarm — but it is more often a data entry error. Check the alarm figures.',
    });
  }

  const temp = input.averageTempC;
  if (temp !== undefined && (temp < TEMP_MIN_C || temp > TEMP_MAX_C)) {
    issues.push({
      level: 'warning',
      title: `Battery temperature outside ${TEMP_MIN_C}–${TEMP_MAX_C} °C`,
      detail:
        'The capacity formula is stated for this temperature window and no numeric correction is given outside it. Apply the battery manufacturer’s own derating curve for this environment.',
    });
  }

  if (recommendedAh === null) {
    issues.push({
      level: 'warning',
      title: 'Capacity exceeds common battery sizes',
      detail: `${round(requiredAh, 1)} Ah is beyond the largest standard size in the list. Expect a purpose-built battery set and a separate battery cabinet.`,
    });
  }

  const chosen = recommendedAh ?? requiredAh;

  if (input.panelMaxBatteryAh && chosen > input.panelMaxBatteryAh) {
    issues.push({
      level: 'error',
      title: 'Battery will not fit this panel',
      detail: `The calculation calls for ${round(chosen, 1)} Ah but the selected panel accepts at most ${input.panelMaxBatteryAh} Ah. An external power supply and battery cabinet is required.`,
    });
  }

  let installedPasses: boolean | undefined;
  if (input.mode === 'service' && input.installedBatteryAh !== undefined) {
    installedPasses = input.installedBatteryAh + 1e-9 >= requiredAh;
    issues.push(
      installedPasses
        ? {
            level: 'info',
            title: 'Installed battery meets the required capacity',
            detail: `${input.installedBatteryAh} Ah installed against ${round(requiredAh, 1)} Ah required.`,
          }
        : {
            level: 'error',
            title: 'Installed battery is undersized',
            detail: `${input.installedBatteryAh} Ah installed against ${round(requiredAh, 1)} Ah required. Record this as a defect.`,
          },
    );
  }

  // Explanatory only: what the discharge curve implies versus the mandated Fc.
  let alarmCRate: number | undefined;
  let effectiveDerating: number | undefined;
  if (chosen > 0 && alarmA > 0) {
    alarmCRate = alarmA / chosen;
    const fraction = availableFractionAtRate(alarmCRate);
    effectiveDerating = fraction > 0 ? 1 / fraction : undefined;
  }

  const charger = calculateCharger(chosen, quiescentA, input.psuOutputA, input.psuChargeCurrentA, issues);

  return {
    quiescentA: round(quiescentA, 4),
    alarmA: round(alarmA, 4),
    standbyHours,
    alarmHours,
    standbyAh: round(standbyAh, 3),
    alarmAh: round(alarmAh, 3),
    subtotalAh: round(subtotalAh, 3),
    requiredAh: round(requiredAh, 2),
    recommendedAh,
    installedPasses,
    issues,
    alarmCRate: alarmCRate !== undefined ? round(alarmCRate, 3) : undefined,
    effectiveDerating: effectiveDerating !== undefined ? round(effectiveDerating, 2) : undefined,
    charger,
  };
}

/**
 * Checks the charger against the two requirements that matter: restoring 80% of
 * capacity within 24 hours, and carrying the quiescent load while charging.
 */
export function calculateCharger(
  capacityAh: number,
  quiescentA: number,
  psuOutputA: number | undefined,
  psuChargeA: number | undefined,
  issues: Issue[],
): ChargerResult {
  const minimumChargeA = (0.8 * capacityAh * CHARGE_INEFFICIENCY) / 24;
  const requiredContinuousA = quiescentA + minimumChargeA;

  const rechargeOk = psuChargeA === undefined ? null : psuChargeA + 1e-9 >= minimumChargeA;
  const simultaneousOk =
    psuOutputA === undefined || psuChargeA === undefined
      ? null
      : psuOutputA + 1e-9 >= quiescentA + psuChargeA;

  if (rechargeOk === false) {
    issues.push({
      level: 'error',
      title: 'Charger cannot recharge in time',
      detail: `Restoring 80% of ${round(capacityAh, 1)} Ah within 24 hours needs about ${round(minimumChargeA, 2)} A, but the supply charges at ${psuChargeA} A.`,
    });
  }

  if (simultaneousOk === false) {
    issues.push({
      level: 'error',
      title: 'Power supply cannot charge and carry the load together',
      detail: `Quiescent load ${round(quiescentA, 2)} A plus charge current ${psuChargeA} A exceeds the supply's ${psuOutputA} A continuous rating.`,
    });
  }

  return {
    minimumChargeA: round(minimumChargeA, 3),
    rechargeOk,
    requiredContinuousA: round(requiredContinuousA, 3),
    simultaneousOk,
  };
}

/**
 * The battery and power fields Appendix F baseline data asks for.
 *
 * Emitting these verbatim is what lets a tech transcribe straight onto the
 * commissioning form instead of re-deriving everything.
 */
export function appendixFFields(r: BatteryResult, mains = '240 V a.c.'): { item: string; field: string; value: string }[] {
  return [
    { item: '14a', field: 'Power supply source (mains), nominal voltage', value: mains },
    {
      item: '14b',
      field: 'Standby power source type, nominal voltage and capacity required',
      value: `Sealed lead acid, 24 V (2 x 12 V), ${r.recommendedAh ?? round(r.requiredAh, 1)} Ah`,
    },
    { item: '14c', field: 'System quiescent current, including ASE loads', value: `${round(r.quiescentA * 1000, 0)} mA` },
    {
      item: '14d',
      field: 'System alarm current, including ASE and occupant warning loads',
      value: `${round(r.alarmA * 1000, 0)} mA`,
    },
    { item: '14e', field: 'Load current of each ancillary circuit', value: 'See load schedule' },
    { item: '14f', field: 'Standby time', value: `${r.standbyHours} h` },
    { item: '14g', field: 'Alarm time', value: `${Math.round(r.alarmHours * 60)} min` },
  ];
}
