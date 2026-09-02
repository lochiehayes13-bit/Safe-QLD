import { calculateBattery, type BatteryInput, type BatteryResult, type Issue, type LoadItem } from './battery';

/**
 * VESDA aspirating smoke detection battery sizing.
 *
 * Aspirating detection sizes differently from a conventional panel. The
 * aspirator runs continuously, so alarm current sits only a few percent above
 * standby rather than jumping five- or ten-fold when sounders operate. In
 * practice about 95% of the battery is set by the standby term alone, which
 * makes the aspirator speed and the standby period by far the most important
 * inputs — and the two most often got wrong.
 *
 * VESDA-E figures are published in watts, so current is derived at 24 V rather
 * than stored pre-rounded: rounding early costs up to 1.5% on a number that
 * then gets multiplied by 72 hours.
 */

export const VESDA_SUPPLY_VOLTAGE = 24;

export type VesdaFamily = 'VESDA-E' | 'VESDA';

export interface VesdaVariant {
  /** Aspirator setting, or 'fixed' for models whose aspirator is not configurable. */
  setting: number | 'fixed';
  /** Published quiescent power in watts (VESDA-E). */
  watts?: number;
  wattsAlarm?: number;
  /** Published current in milliamps (legacy VESDA, published directly). */
  ma?: number;
  maAlarm?: number;
}

export interface VesdaModel {
  id: string;
  model: string;
  family: VesdaFamily;
  description: string;
  variants: VesdaVariant[];
  /** True when a display is built in, so a separate display must not be added. */
  displayIncluded?: boolean;
  note?: string;
}

/**
 * Detector catalogue.
 *
 * Only aspirator settings the manufacturer actually publishes are listed;
 * intermediate settings are handled explicitly rather than silently guessed.
 */
export const VESDA_MODELS: VesdaModel[] = [
  {
    id: 'vep-a00-p',
    model: 'VESDA-E VEP-A00-P',
    family: 'VESDA-E',
    description: '4 pipe, LED indicators',
    variants: [
      { setting: 1, watts: 7.0, wattsAlarm: 7.8 },
      { setting: 5, watts: 8.8, wattsAlarm: 9.6 },
    ],
  },
  {
    id: 'vep-a00-1p',
    model: 'VESDA-E VEP-A00-1P',
    family: 'VESDA-E',
    description: '1 pipe, LED indicators',
    variants: [{ setting: 'fixed', watts: 8.8, wattsAlarm: 9.6 }],
    note: 'Aspirator speed is not configurable on this model.',
  },
  {
    id: 'vep-a10-p',
    model: 'VESDA-E VEP-A10-P',
    family: 'VESDA-E',
    description: '4 pipe, 3.5 in display',
    displayIncluded: true,
    variants: [
      { setting: 1, watts: 8.2, wattsAlarm: 10.4 },
      { setting: 5, watts: 10.0, wattsAlarm: 11.6 },
    ],
  },
  {
    id: 'veu-a00',
    model: 'VESDA-E VEU-A00',
    family: 'VESDA-E',
    description: 'LED indicators',
    variants: [
      { setting: 1, watts: 7.0, wattsAlarm: 7.8 },
      { setting: 5, watts: 8.8, wattsAlarm: 9.6 },
      { setting: 10, watts: 14.7, wattsAlarm: 15.5 },
    ],
  },
  {
    id: 'veu-a10',
    model: 'VESDA-E VEU-A10',
    family: 'VESDA-E',
    description: '3.5 in display',
    displayIncluded: true,
    variants: [
      { setting: 1, watts: 8.2, wattsAlarm: 10.4 },
      { setting: 5, watts: 10.0, wattsAlarm: 11.6 },
      { setting: 10, watts: 15.8, wattsAlarm: 16.6 },
    ],
  },
  {
    id: 'ves-a00-p',
    model: 'VESDA-E VES-A00-P',
    family: 'VESDA-E',
    description: 'Sector addressable, LED indicators',
    variants: [
      { setting: 1, watts: 7.9, wattsAlarm: 8.5 },
      { setting: 5, watts: 9.6, wattsAlarm: 10.2 },
      // Alarm power is genuinely below quiescent at this setting; published in
      // two independent documents, so it is carried through as-is.
      { setting: 10, watts: 14.8, wattsAlarm: 14.5 },
    ],
  },
];

export interface VesdaAccessory {
  id: string;
  label: string;
  maQuiescent: number;
  maAlarm: number;
  /** False where the figure was derived from published watts rather than published directly. */
  published: boolean;
  note?: string;
}

/**
 * Accessories are additive for legacy VESDA only. VESDA-E A10 models already
 * include their display in the published figures.
 */
export const VESDA_ACCESSORIES: VesdaAccessory[] = [
  { id: 'display', label: 'Display module (in detector)', maQuiescent: 60, maAlarm: 80, published: true },
  { id: 'display-remote', label: 'Display module, remote box (no relays)', maQuiescent: 90, maAlarm: 110, published: true },
  {
    id: 'programmer',
    label: 'Programmer module',
    maQuiescent: 25,
    maAlarm: 92,
    published: false,
    note: 'Derived from published power (0.6 W / 2.2 W) rather than a published current figure.',
  },
  { id: 'vic-010', label: 'VIC-010 VESDAnet interface card', maQuiescent: 42, maAlarm: 42, published: true },
];

export interface VesdaPsu {
  id: string;
  model: string;
  ratedA: number;
  maxBatteryAh: number;
  note?: string;
  /** False where figures come from distributor listings rather than a manufacturer datasheet. */
  verified: boolean;
}

export const VESDA_PSUS: VesdaPsu[] = [
  { id: 'vps-220-stx5', model: 'VPS-220-STX5', ratedA: 0.5, maxBatteryAh: 14, verified: true, note: 'Battery options 7, 12 or 14 Ah.' },
  { id: 'vps-250-stx5', model: 'VPS-250-STX5', ratedA: 3.0, maxBatteryAh: 24, verified: true },
  { id: 'vps-220-stx', model: 'VPS-220-STX', ratedA: 0.5, maxBatteryAh: 14, verified: true, note: 'Earlier generation than the STX5.' },
  { id: 'vps-250-stx', model: 'VPS-250-STX', ratedA: 2.0, maxBatteryAh: 24, verified: true, note: 'Rated 2 A, not 3 A — do not confuse with the STX5.' },
  { id: 'vps-215-e5', model: 'VPS-215-E5', ratedA: 0.5, maxBatteryAh: 7, verified: false },
  { id: 'vps-220-e5', model: 'VPS-220-E5', ratedA: 0.5, maxBatteryAh: 14, verified: false },
];

/** Converts watts at the nominal supply voltage to milliamps. */
export function wattsToMa(watts: number): number {
  return (watts / VESDA_SUPPLY_VOLTAGE) * 1000;
}

export interface VesdaDetectorSelection {
  modelId: string;
  setting: number | 'fixed';
  quantity: number;
  accessoryIds?: string[];
}

export interface VesdaCurrents {
  maQuiescent: number;
  maAlarm: number;
  issues: Issue[];
}

/**
 * Resolves a detector selection to standby and alarm current.
 *
 * Alarm current is taken as max(quiescent, alarm): on some models at the
 * highest aspirator setting the published alarm figure is genuinely lower than
 * quiescent, and sizing must not benefit from that.
 */
export function detectorCurrents(sel: VesdaDetectorSelection): VesdaCurrents {
  const issues: Issue[] = [];
  const model = VESDA_MODELS.find((m) => m.id === sel.modelId);
  if (!model) {
    return { maQuiescent: 0, maAlarm: 0, issues: [{ level: 'error', title: 'Unknown detector', detail: `No catalogue entry for "${sel.modelId}".` }] };
  }

  const variant = model.variants.find((v) => v.setting === sel.setting);
  if (!variant) {
    const published = model.variants.map((v) => v.setting).join(', ');
    return {
      maQuiescent: 0,
      maAlarm: 0,
      issues: [
        {
          level: 'error',
          title: `Aspirator setting ${sel.setting} is not published`,
          detail: `${model.model} publishes figures for setting ${published} only. Size against the next published setting up — consumption does not rise linearly, so interpolating understates it.`,
        },
      ],
    };
  }

  let q = variant.ma ?? (variant.watts !== undefined ? wattsToMa(variant.watts) : 0);
  let a = variant.maAlarm ?? (variant.wattsAlarm !== undefined ? wattsToMa(variant.wattsAlarm) : q);
  a = Math.max(q, a);

  for (const accId of sel.accessoryIds ?? []) {
    const acc = VESDA_ACCESSORIES.find((x) => x.id === accId);
    if (!acc) {
      // Skipped silently, the accessory draws nothing on paper and the supply
      // is sized without it.
      issues.push({
        level: 'error',
        title: 'Unknown accessory',
        detail: `No catalogue entry for accessory "${accId}", so its current has not been included.`,
      });
      continue;
    }
    if (model.displayIncluded && accId.startsWith('display')) {
      issues.push({
        level: 'warning',
        title: 'Display counted twice',
        detail: `${model.model} already includes its display in the published figures. The separate display module was ignored.`,
      });
      continue;
    }
    q += acc.maQuiescent;
    a += acc.maAlarm;
  }

  const qty = Math.max(0, sel.quantity);
  return { maQuiescent: q * qty, maAlarm: a * qty, issues };
}

export interface VesdaInput {
  detectors: VesdaDetectorSelection[];
  /** Additional loads on the same supply, in milliamps. */
  otherLoadsMa?: { standbyMa: number; alarmMa: number; label: string };
  monitored: boolean;
  alarmHours: number;
  psuId?: string;
  averageTempC?: number;
}

export interface VesdaResult extends BatteryResult {
  /** Continuous load as a fraction of the selected supply's rating. */
  psuUtilisation?: number;
  psuModel?: string;
}

/** Sizes a VESDA standby battery and checks the supply. */
export function calculateVesda(input: VesdaInput): VesdaResult {
  const loads: LoadItem[] = [];
  const extraIssues: Issue[] = [];

  input.detectors.forEach((sel, i) => {
    const { maQuiescent, maAlarm, issues } = detectorCurrents(sel);
    extraIssues.push(...issues);
    const model = VESDA_MODELS.find((m) => m.id === sel.modelId);
    loads.push({
      id: `det-${i}`,
      label: `${model?.model ?? sel.modelId} (setting ${sel.setting}) x${sel.quantity}`,
      quantity: 1,
      standbyMa: maQuiescent,
      alarmMa: maAlarm,
    });
  });

  if (input.otherLoadsMa) {
    loads.push({
      id: 'other',
      label: input.otherLoadsMa.label,
      quantity: 1,
      standbyMa: input.otherLoadsMa.standbyMa,
      alarmMa: input.otherLoadsMa.alarmMa,
    });
  }

  const psu = input.psuId ? VESDA_PSUS.find((p) => p.id === input.psuId) : undefined;

  const batteryInput: BatteryInput = {
    mode: 'design',
    loads,
    monitored: input.monitored,
    alarmHours: input.alarmHours,
    deteriorationFactor: 1.25,
    capacityDerating: 2,
    averageTempC: input.averageTempC,
    panelMaxBatteryAh: psu?.maxBatteryAh,
    psuOutputA: psu?.ratedA,
  };

  const result = calculateBattery(batteryInput);

  // The aspirating-detection case has no alarm signalling equipment of its own,
  // so the panel-oriented warning about it does not apply here.
  const issues = [...result.issues.filter((i) => !i.title.includes('alarm signalling')), ...extraIssues];

  let psuUtilisation: number | undefined;
  if (psu) {
    psuUtilisation = result.quiescentA / psu.ratedA;
    if (psuUtilisation > 1) {
      issues.push({
        level: 'error',
        title: 'Supply is overloaded in standby',
        detail: `Standby draw of ${(result.quiescentA * 1000).toFixed(0)} mA exceeds the ${psu.model}'s ${psu.ratedA} A rating. Aspirating detectors draw this continuously, not just in alarm.`,
      });
    } else if (psuUtilisation > 0.8) {
      issues.push({
        level: 'warning',
        title: 'Supply is heavily loaded in standby',
        detail: `Standby draw is ${(psuUtilisation * 100).toFixed(0)}% of the ${psu.model}'s rating, continuously. Consider the next size up before adding anything else.`,
      });
    }
    if (!psu.verified) {
      issues.push({
        level: 'info',
        title: 'Unverified supply figures',
        detail: `Ratings for the ${psu.model} come from distributor listings rather than a manufacturer datasheet. Confirm before relying on them.`,
      });
    }
  }

  return { ...result, issues, psuUtilisation, psuModel: psu?.model };
}
