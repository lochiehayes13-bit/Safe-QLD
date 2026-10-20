import { minimumCableSize, voltageDrop, type Conductor, type VoltDropResult } from './electrical';
import { readNumber } from './fieldNumber';

/**
 * The volt drop screen's four typed figures, read into a result.
 *
 * Nothing is worked out until supply, load and length are all typed, and no
 * pass or fail is given until the device minimum is typed too. A blank field is
 * no figure at all, so the screen never shows a verdict built from a number the
 * technician did not enter.
 */

export type Circuit = 'dc' | 'single-phase' | 'three-phase';

export interface VoltDropFields {
  supply: string;
  load: string;
  length: string;
  minimum: string;
}

export const BLANK_VOLT_DROP: VoltDropFields = { supply: '', load: '', length: '', minimum: '' };

export interface VoltDropChoices {
  areaMm2: number;
  conductor: Conductor;
  circuit: Circuit;
}

export type VoltDropReading =
  /** Supply, load or length not typed yet. */
  | { kind: 'blank' }
  /** Typed, but not figures that can be worked. */
  | { kind: 'check'; problem: string }
  | {
    kind: 'result';
    result: VoltDropResult;
    /** The device minimum, where one was typed. Without it there is no verdict. */
    minimumVolts?: number;
    /** Smallest standard size that keeps the device above its minimum; null when none does. Absent without a minimum. */
    smallestMm2?: number | null;
  };

/** Whether any field holds something, for showing a Clear button. */
export function anyTyped(fields: VoltDropFields): boolean {
  return Object.values(fields).some((v) => v.trim() !== '');
}

export function readVoltDrop(fields: VoltDropFields, choices: VoltDropChoices): VoltDropReading {
  const sourceVolts = readNumber(fields.supply);
  const amps = readNumber(fields.load);
  const lengthM = readNumber(fields.length);
  if (sourceVolts === undefined || amps === undefined || lengthM === undefined) return { kind: 'blank' };
  if (sourceVolts <= 0 || amps <= 0 || lengthM <= 0) {
    return { kind: 'check', problem: 'Supply, load and length must be above zero.' };
  }

  // Half typed ("" or "-") reads as no minimum yet, so no verdict.
  const minimumVolts = readNumber(fields.minimum);
  if (minimumVolts !== undefined && (minimumVolts <= 0 || minimumVolts >= sourceVolts)) {
    return { kind: 'check', problem: 'Device minimum must be above zero and below the supply.' };
  }

  const base = { sourceVolts, amps, lengthM, conductor: choices.conductor, circuit: choices.circuit };
  const result = voltageDrop({ ...base, areaMm2: choices.areaMm2, minimumVolts });
  if (!result) return { kind: 'check', problem: 'Check the figures.' };
  if (minimumVolts === undefined) return { kind: 'result', result };
  return {
    kind: 'result',
    result,
    minimumVolts,
    smallestMm2: minimumCableSize({ ...base, minimumVolts }),
  };
}
