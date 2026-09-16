/**
 * What day it is in Queensland.
 *
 * Everything this app records is stamped as a UTC instant, and everything it
 * prints is read by somebody in Brisbane. Between 10am and midnight Queensland
 * time those two agree on the date. Between midnight and 10am they do not, and
 * a fire service that starts at seven in the morning spends the first three
 * hours of every day on the wrong side of that line.
 *
 * The consequence is not cosmetic. A critical defect notice carries the date
 * the maintenance was carried out, and both statutory clocks run from it: the
 * occupier has to be given the notice within twenty-four hours, and the defect
 * rectified within a month. Printing the UTC date puts a notice for work done
 * on Friday morning on Thursday's date — a day earlier on a document somebody
 * may later have to defend.
 *
 * Queensland is UTC+10 and does not observe daylight saving. That is the whole
 * rule, and it is why this is arithmetic rather than a timezone library: there
 * is no transition to get wrong, and a library that silently applied one would
 * be worse than the offset.
 */

/** Queensland's offset from UTC, all year. No daylight saving, no exceptions. */
export const QLD_UTC_OFFSET_HOURS = 10;

const HOUR_MS = 3_600_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ISO instant, which is the only shape `Date.parse` is specified to read.
 *
 * Everything else it reads by its own rules, and the shape it gets wrong is the
 * one this app prints on every page: `Date.parse('1/9/2026')` is 9 January, not
 * the first of September. It does not throw and it does not return NaN — it
 * returns a real date, eight months out, that looks entirely reasonable
 * wherever it lands. "Jun-25" off the register's overhaul column comes back as
 * the 25th of June 2001.
 *
 * So a value that is not an instant is refused here rather than guessed at.
 * Refusing is safe by design: every caller in this app already has an answer
 * for a date it cannot read. `formatAuDate` prints it back as it arrived, so a
 * bad value stays visible on the page and traceable to the record holding it;
 * the planner says it cannot read the day it was asked for. What none of them
 * can do is notice a date that is wrong but well-formed.
 *
 * The register reader, the panel parsers and the standards library all read
 * their own date formats, and each returns an ISO date. This is the boundary
 * they hand across, not a general date reader.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T/;

/**
 * A calendar date, or nothing where it is a day the month does not have.
 *
 * The round trip is the whole check. `new Date('2026-02-31T00:00:00Z')` does
 * not fail — it rolls forward to 3 March, and 2026-02-29 to 1 March, because
 * 2026 is not a leap year. A rectification month counted from a rolled date is
 * days out with nothing on the page to show for it.
 *
 * Only date-only strings are checked this way. A full instant carries an offset
 * that its UTC day legitimately differs from, so the same comparison would
 * refuse a perfectly good timestamp written in Brisbane time.
 */
function realDay(day: string): string | undefined {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10) === day ? day : undefined;
}

/**
 * The Queensland calendar date of an instant, as yyyy-mm-dd.
 *
 * A date-only string is already a calendar date and is returned untouched.
 * Shifting one would be the same bug in the other direction: "2026-07-03"
 * written on a form means the third of July, not an instant at midnight UTC
 * that happens to fall on the third.
 */
export function qldIsoDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const trimmed = iso.trim();
  if (!trimmed) return undefined;
  if (DATE_ONLY.test(trimmed)) return realDay(trimmed);
  if (!INSTANT.test(trimmed)) return undefined;
  // The date it was written with has to be a real one. Checked on the literal
  // rather than on the parsed result, because an instant carrying an offset has
  // a UTC day that legitimately differs from the day it was written with.
  if (!realDay(trimmed.slice(0, 10))) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms + QLD_UTC_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * The Queensland calendar date as d/m/yyyy.
 *
 * Australian order, always. 03/07 and 07/03 are both valid-looking dates and
 * only one of them is the day the work was done; for eight months of the year
 * the wrong one still reads like a date, which is what makes the mistake
 * survive review.
 */
export function qldDay(iso: string | undefined): string | undefined {
  const day = qldIsoDay(iso);
  if (!day) return undefined;
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * The Queensland date and time, for the clocks a critical defect starts.
 *
 * Undefined for a date with no time in it, rather than midnight or ten in the
 * morning. "Notified 03/07/2026 00:00" for a notice nobody recorded a time
 * against is a fact invented by a formatter, and it reads as evidence.
 */
export function qldMoment(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const trimmed = iso.trim();
  if (!trimmed || DATE_ONLY.test(trimmed) || !INSTANT.test(trimmed)) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return undefined;
  const shifted = new Date(ms + QLD_UTC_OFFSET_HOURS * HOUR_MS);
  const day = qldDay(trimmed);
  if (!day) return undefined;
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm} (Qld)`;
}
