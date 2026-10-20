/**
 * Figures typed into a calculator field.
 *
 * Each field keeps the text the technician typed, and it is read as a number
 * only where the figure is used, so "2." or "-" part way through typing is not
 * rewritten under their thumb. A blank or half-typed field is no figure at all
 * rather than zero, so nothing is worked out from a number nobody entered.
 */

const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/;

/** The number in a field, or undefined while it is blank or not yet a number. */
export function readNumber(text: string): number | undefined {
  const s = text.trim();
  if (!PLAIN_NUMBER.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Flips the sign of a typed figure, for the ± key beside a field that can go
 * negative. The iPhone's decimal keypad has no minus key.
 */
export function toggleSign(text: string): string {
  const s = text.trim();
  if (s.startsWith('-')) return s.slice(1);
  if (s.startsWith('+')) return `-${s.slice(1)}`;
  return `-${s}`;
}
