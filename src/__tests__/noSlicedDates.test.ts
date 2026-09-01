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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function offences(): string[] {
  const found: string[] = [];
  for (const file of ROOTS.flatMap((r) => walk(r))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (SLICED.test(line)) found.push(`${file}:${i + 1}`);
    });
  }
  return found;
}

describe('dates handed to a formatter', () => {
  it('are never sliced to a day first', () => {
    // Named with their line numbers rather than counted, so the fix is the
    // file somebody opens rather than a search.
    expect(offences()).toEqual([]);
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
