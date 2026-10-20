import type { LoadItem } from './battery';

/**
 * The load schedule as the screen holds it: text, one string per box.
 *
 * A row used to hold numbers and turn each keystroke straight back into one,
 * so "0." became 0 and the point vanished before the 5 could follow it. A
 * detector at 0.05 mA could not be typed at all. Each box now keeps exactly
 * what was typed, and the numbers are read off it only when the battery is
 * worked out.
 */
export interface LoadDraft {
  id: string;
  label: string;
  quantity: string;
  standbyMa: string;
  alarmMa: string;
  /** The alarm signalling equipment line, which the calculation asks after. */
  isAse?: boolean;
  note?: string;
}

/**
 * A figure off a text box.
 *
 * Blank and nonsense are undefined rather than zero, so the caller decides
 * what a missing figure means. A comma is read as a decimal point, for the
 * keyboard that offers one.
 */
export function parseFigure(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const cleaned = text.trim().replace(',', '.');
  if (!cleaned || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** A number as a box shows it: no float noise, no trailing zeros. */
export function figureText(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  return String(Number(n.toFixed(4)));
}

/** A load line for the engine. A blank box counts as nothing drawn. */
export function loadFromDraft(d: LoadDraft): LoadItem {
  return {
    id: d.id,
    label: d.label,
    quantity: Math.max(0, parseFigure(d.quantity) ?? 0),
    standbyMa: Math.max(0, parseFigure(d.standbyMa) ?? 0),
    alarmMa: Math.max(0, parseFigure(d.alarmMa) ?? 0),
    isAse: d.isAse,
    note: d.note,
  };
}

export function loadsFromDrafts(drafts: readonly LoadDraft[]): LoadItem[] {
  return drafts.map(loadFromDraft);
}

/** A draft row from figures, as when a device or a baseline record fills one. */
export function draftFromFigures(
  id: string,
  fields: { label: string; quantity?: number; standbyMa?: number; alarmMa?: number; isAse?: boolean; note?: string },
): LoadDraft {
  return {
    id,
    label: fields.label,
    quantity: figureText(fields.quantity ?? 1),
    standbyMa: figureText(fields.standbyMa),
    alarmMa: figureText(fields.alarmMa),
    isAse: fields.isAse,
    note: fields.note,
  };
}

/**
 * Whether the schedule has anything to size yet.
 *
 * Until a line with a quantity and a current is in, there is no battery to
 * show: an answer worked out from nothing reads as an answer.
 */
export function hasLoadFigures(loads: readonly LoadItem[]): boolean {
  return loads.some((l) => l.quantity > 0 && (l.standbyMa > 0 || l.alarmMa > 0));
}
