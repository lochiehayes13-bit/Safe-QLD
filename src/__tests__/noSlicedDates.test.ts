import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing takes the day off a timestamp before handing it to a date formatter.
 *
 * `formatAuDate` in export/sheets.ts resolves the Queensland calendar day
 * itself. Queensland is UTC+10, so between midnight and 10am the first ten
 * characters of an instant are yesterday's date, and this company starts at
 * seven. The formatter was fixed for exactly that, and it handles a full
 * timestamp correctly.
 *
 * `formatAuDate(x.slice(0, 10))` throws that away before the formatter ever
 * sees it. The fix is present, and defeated at the call site, three lines
 * further on.
 *
 * That is how it survived. Slicing the day off a timestamp reads as tidying up
 * — it is what you would write if you had not thought about the offset, and it
 * looks more careful rather than less. It was doing it on the occupier
 * statement's signature date, on the date the copy went to the Commissioner,
 * on a zone chart, and on the last-serviced date beside an overdue judgement.
 *
 * So this is a rule about call sites rather than a test of any one of them.
 * Three of the four places it was wrong have no test file of their own — two
 * are screens — and a rule catches the next one wherever it is written.
 *
 * A date-only string needs no slice, so the pattern says nothing useful in
 * either case: where the value is already a day the slice is dead code, and
 * where it is an instant the slice is a bug.
 *
 * ---
 *
 * **The formatter rule was too narrow, and the ones it missed were worse.**
 *
 * Nineteen more of these were sitting outside a formatter call, where the
 * sliced day was not printed but counted with. Three of them decided things:
 *
 *  - `assessRunHistory` anchored a site's whole schedule on
 *    `completedAt.slice(0, 10)`. Every scheduled date is derived from that
 *    anchor, so a first service done at half past seven on a Brisbane morning
 *    moved every date at that site a day early for as long as it is on the
 *    books.
 *  - `toleranceStatus` decided early, in-tolerance or late from
 *    `performedIso.slice(0, 10)`, and it is wrong in both directions: a service
 *    carried out on the first day of the window reads as before it and is
 *    reported early — an AS 1851 non-compliance that did not happen — and one
 *    carried out the day after the window closed reads as the last day of it
 *    and is reported in tolerance, which is one that did.
 *  - The 24-hour critical defect notice countdown subtracted a sliced UTC day
 *    from a Queensland day, so the two sides of the subtraction were not the
 *    same kind of day.
 *
 * So the rule is about the value rather than about what is done to it. Every
 * field in this app whose name ends in `At` is an instant — `completedAt`,
 * `signedAt`, `raisedAt`, `noticeDueAt` — and taking its first ten characters
 * is asking for its UTC day. There is nowhere in this app that wants one.
 */

const ROOTS = ['src', 'app'];
const SKIP = new Set(['node_modules', '.git', 'dist', '.expo', 'coverage', '__tests__', '__mocks__']);

/**
 * A formatter's argument, sliced to ten characters on the way in.
 *
 * Deliberately matched on the shape rather than on a list of formatter names:
 * this app has seven functions called formatAuDate and several more named
 * format-something that take a date, and a rule that only knew about the ones
 * that existed tonight would miss the eighth.
 */
const SLICED = /\bformat[A-Za-z]*\([^)]*\.slice\(0,\s*10\)/;

/**
 * An instant, sliced to its UTC day.
 *
 * Matched on the naming convention because that is what actually identifies
 * one here: `...At` is this codebase's name for a stamped instant, and it holds
 * across the schema, the domain and the screens. A rule that listed the field
 * names instead would be a list of the ones that existed tonight.
 *
 * A window's bounds are the exception to the convention: `from`, `to` and
 * `until` are instants that do not end in At, and the routine service report
 * dated itself by the UTC day of `to`. They are matched as whole names, so a
 * photo or a total is not read as one.
 */
const SLICED_INSTANT = /(?:[A-Za-z_]+[Aa]t|\b(?:from|to|until))[!?]?\.slice\(0,\s*10\)/;

/**
 * Today, taken as the UTC day.
 *
 * Nine screens worked out what day it was this way. Between midnight and 10am
 * that is yesterday, so the home screen listed yesterday's jobs, the route
 * planner planned yesterday's run, and a service report was dated the day
 * before the service — every morning until ten, which is the first three hours
 * of this company's working day.
 *
 * `qldIsoDay(nowIso())` is the whole of the fix, and it is short enough that
 * the slice will be written again by somebody in a hurry.
 */
const UTC_TODAY = /(?:new Date\(\)\.toISOString\(\)|nowIso\(\))\.slice\(0,\s*10\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function offences(rule: RegExp): string[] {
  const found: string[] = [];
  for (const file of ROOTS.flatMap((r) => walk(r))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      // A comment may quote the shape it is warning about, and one of them
      // does. The rule is about what the app runs.
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      if (rule.test(line)) found.push(`${file}:${i + 1}`);
    });
  }
  return found;
}

describe('dates handed to a formatter', () => {
  it('are never sliced to a day first', () => {
    // Named with their line numbers rather than counted, so the fix is the
    // file somebody opens rather than a search.
    expect(offences(SLICED)).toEqual([]);
  });

  it('and no instant is sliced to its UTC day anywhere, formatter or not', () => {
    expect(offences(SLICED_INSTANT)).toEqual([]);
  });

  it('and nothing works out what day it is by slicing the clock', () => {
    expect(offences(UTC_TODAY)).toEqual([]);
  });

  it('recognises the ways today was being taken in UTC', () => {
    expect(UTC_TODAY.test('  const today = new Date().toISOString().slice(0, 10);')).toBe(true);
    expect(UTC_TODAY.test('    const today = nowIso().slice(0, 10);')).toBe(true);
    expect(UTC_TODAY.test('lapsedEverywhere(nowIso().slice(0,10))')).toBe(true);

    // And leaves the fix alone, along with slicing something that is not now.
    expect(UTC_TODAY.test("const today = qldIsoDay(nowIso()) ?? '';")).toBe(false);
    expect(UTC_TODAY.test('const day = iso.slice(0, 10);')).toBe(false);
  });

  it('recognises an instant being sliced, and leaves the honest work alone', () => {
    // The three that decided something, as they were written.
    expect(SLICED_INSTANT.test('const anchor = ordered[0]!.completedAt.slice(0, 10);')).toBe(true);
    expect(SLICED_INSTANT.test('  const performed = performedIso.slice(0, 10);')).toBe(false);
    expect(SLICED_INSTANT.test('daysBetween(today, clocks.noticeDueAt.slice(0, 10))')).toBe(true);
    expect(SLICED_INSTANT.test('signedDate: s.signedAt ? s.signedAt.slice(0, 10) : undefined,')).toBe(true);
    expect(SLICED_INSTANT.test('const rectified = d.rectifiedAt?.slice(0, 10);')).toBe(true);

    // A window's bounds are instants too, and they are not named with At: the
    // report's date performed was the UTC day of the window's end.
    expect(SLICED_INSTANT.test('datePerformed: q.to.slice(0, 10),')).toBe(true);
    expect(SLICED_INSTANT.test('const day = from.slice(0, 10);')).toBe(true);
    expect(SLICED_INSTANT.test('until?.slice(0, 10)')).toBe(true);
    // Only as whole names: a photo is not a to.
    expect(SLICED_INSTANT.test('const stamp = photo.slice(0, 10);')).toBe(false);

    // And says nothing about the slices that are not an instant's UTC day:
    // reading a day out of a date-only string, or out of an ISO date inside
    // qldTime itself, which is where that work belongs.
    expect(SLICED_INSTANT.test("return new Date(ms).toISOString().slice(0, 10);")).toBe(false);
    expect(SLICED_INSTANT.test("const day = iso.slice(0, 10);")).toBe(false);
    expect(SLICED_INSTANT.test("if (!realDay(trimmed.slice(0, 10))) return undefined;")).toBe(false);
  });

  it('recognises the shape it is looking for', () => {
    /*
     * The rule above passes on any repository where the pattern never appears,
     * including one where this regex silently stopped matching anything. These
     * are the four call sites it was actually written for, as they were.
     */
    expect(SLICED.test("formatAuDate(s.signedAt.slice(0, 10))")).toBe(true);
    expect(SLICED.test("esc(formatAuDate(input.generatedAt.slice(0, 10)))")).toBe(true);
    expect(SLICED.test("`Last ${formatAuDate(due.lastCompletedAt.slice(0,10))}`")).toBe(true);
    expect(SLICED.test("formatAuMonth(p.at.slice(0, 10))")).toBe(true);

    // And does not fire on the things that are fine: a formatter given the
    // whole instant, or a slice that is not feeding a formatter.
    expect(SLICED.test('formatAuDate(s.signedAt)')).toBe(false);
    expect(SLICED.test("const day = iso.slice(0, 10);")).toBe(false);
    expect(SLICED.test("qldIsoDay(raw).slice(0, 10)")).toBe(false);
  });

  it('is reading the whole app', () => {
    // A walk that stopped finding files would report no offences forever.
    const files = ROOTS.flatMap((r) => walk(r));
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain('src/export/occupierStatement.ts');
    expect(files).toContain('app/work/due.tsx');
  });
});
