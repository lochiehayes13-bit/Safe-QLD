import { solveOhms, type OhmsResult } from './electrical';
import { readNumber } from './fieldNumber';

/**
 * Which two of the four Ohm's law fields to solve from.
 *
 * The screen has four fields and the arithmetic wants two. Solving from the
 * two most recently edited means a third figure typed in takes over from the
 * oldest, instead of being ignored because a fixed order preferred another
 * pair.
 */

export type OhmsField = 'volts' | 'amps' | 'ohms' | 'watts';

export const OHMS_FIELDS: readonly OhmsField[] = ['volts', 'amps', 'ohms', 'watts'];

/** The edit order with `field` moved to the front. */
export function touchField(order: readonly OhmsField[], field: OhmsField): OhmsField[] {
  return [field, ...order.filter((f) => f !== field)];
}

/** The fields holding a number, most recently edited first. */
export function filledFields(texts: Record<OhmsField, string>, order: readonly OhmsField[]): OhmsField[] {
  const sequence = [...order, ...OHMS_FIELDS.filter((f) => !order.includes(f))];
  return sequence.filter((f) => readNumber(texts[f]) !== undefined);
}

/** Solves from the two most recently edited fields that hold a number. */
export function solveFromLatest(texts: Record<OhmsField, string>, order: readonly OhmsField[]): OhmsResult | null {
  const pair = filledFields(texts, order).slice(0, 2);
  if (pair.length < 2) return null;
  const input: Partial<Record<OhmsField, number>> = {};
  for (const f of pair) input[f] = readNumber(texts[f]);
  return solveOhms(input);
}
