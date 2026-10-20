import { defectByCode, type QuoteItem } from '@/seed/defectLibrary';
import type { Defect } from '@/domain/types';

/**
 * Working out what has to be ordered to clear a site's defects.
 *
 * Every coded defect already carries its quote items, so the parts follow from
 * the defect list rather than from someone reading it and remembering. Two
 * things this deliberately does not do:
 *
 * It does not order labour. A quote line priced in hours belongs on the quote,
 * not on a purchase order, and putting it on one produces a request the
 * supplier cannot fill.
 *
 * It does not invent a part number. The library says "replacement detector
 * head" because the right head depends on the panel and the protocol, which the
 * library cannot know. Lines come out unresolved and the technician attaches the
 * catalogue part, or the office does — either way it is visible that nobody has
 * chosen yet.
 */

export interface NeededPart {
  /** The quote line's own wording, which is what the library knows. */
  description: string;
  unit: QuoteItem['unit'];
  quantity: number;
  /** Defect codes that contributed, so a quantity can be traced back. */
  fromCodes: string[];
  /** How many defects contributed, for the same reason. */
  defectCount: number;
}

/** A quote line priced by time is labour, not something a supplier ships. */
export function isMaterial(item: QuoteItem): boolean {
  return item.unit !== 'hr';
}

/**
 * Aggregates the material lines across a set of defects.
 *
 * Quantities add up across defects that need the same thing: three failed
 * detectors is one line for three heads, not three lines for one. Ordering by
 * quantity puts the bulk of the order at the top, which is the order someone
 * checking it against a van wants.
 */
export function partsNeededFor(defects: Defect[]): NeededPart[] {
  const byDescription = new Map<string, NeededPart>();

  for (const defect of defects) {
    if (!defect.defectCode) continue;
    const code = defectByCode(defect.defectCode);
    if (!code) continue;

    // quoteItems is optional on a code: some defects are diagnostic and have
    // no priced work at all.
    for (const item of code.quoteItems ?? []) {
      if (!isMaterial(item)) continue;
      const key = `${item.description.toLowerCase()}|${item.unit}`;
      const existing = byDescription.get(key);
      if (existing) {
        existing.quantity += item.qtyPerDefect;
        existing.defectCount += 1;
        if (!existing.fromCodes.includes(code.code)) existing.fromCodes.push(code.code);
      } else {
        byDescription.set(key, {
          description: item.description,
          unit: item.unit,
          quantity: item.qtyPerDefect,
          fromCodes: [code.code],
          defectCount: 1,
        });
      }
    }
  }

  return [...byDescription.values()].sort(
    (a, b) => b.quantity - a.quantity || a.description.localeCompare(b.description),
  );
}

/**
 * Defects that will not contribute a part, and why.
 *
 * Reported rather than skipped: a request that silently covers eleven of
 * fourteen defects looks complete, and the three it missed are the ones someone
 * finds out about on the return visit.
 */
export interface UncoveredDefect {
  defectId: string;
  reason: 'no-code' | 'unknown-code' | 'labour-only';
}

export function uncoveredDefects(defects: Defect[]): UncoveredDefect[] {
  const out: UncoveredDefect[] = [];
  for (const defect of defects) {
    if (!defect.defectCode) {
      out.push({ defectId: defect.id, reason: 'no-code' });
      continue;
    }
    const code = defectByCode(defect.defectCode);
    if (!code) {
      out.push({ defectId: defect.id, reason: 'unknown-code' });
      continue;
    }
    if (!(code.quoteItems ?? []).some(isMaterial)) {
      out.push({ defectId: defect.id, reason: 'labour-only' });
    }
  }
  return out;
}

export const UNCOVERED_REASON: Record<UncoveredDefect['reason'], string> = {
  'no-code': 'Raised as free text, so there is no coded parts list behind it',
  'unknown-code': 'Carries a code this build does not know',
  'labour-only': 'Needs labour only — nothing to order',
};

/**
 * The labour the same defects call for.
 *
 * Deliberately separate from the parts. A purchase order goes to a supplier and
 * has no labour on it, which is why partsNeededFor drops it — but the quote to
 * the client does, and dropping it there means quoting a job at the cost of its
 * materials.
 */
export interface NeededLabour {
  description: string;
  hours: number;
  defectCount: number;
  fromCodes: string[];
}

export function labourNeededFor(defects: Defect[]): NeededLabour[] {
  const byDescription = new Map<string, NeededLabour>();

  for (const defect of defects) {
    if (!defect.defectCode) continue;
    const code = defectByCode(defect.defectCode);
    if (!code) continue;

    for (const item of code.quoteItems ?? []) {
      if (isMaterial(item)) continue;
      const key = item.description.toLowerCase();
      const existing = byDescription.get(key);
      if (existing) {
        existing.hours += item.qtyPerDefect;
        existing.defectCount += 1;
        if (!existing.fromCodes.includes(code.code)) existing.fromCodes.push(code.code);
      } else {
        byDescription.set(key, {
          description: item.description,
          hours: item.qtyPerDefect,
          defectCount: 1,
          fromCodes: [code.code],
        });
      }
    }
  }

  return [...byDescription.values()].sort((a, b) => b.hours - a.hours);
}

/** Total hours across the defects, which is what gets priced. */
export function totalLabourHours(defects: Defect[]): number {
  return labourNeededFor(defects).reduce((n, l) => n + l.hours, 0);
}
