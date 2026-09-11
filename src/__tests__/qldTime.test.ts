import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QLD_UTC_OFFSET_HOURS, qldDay, qldIsoDay, qldMoment } from '@/domain/qldTime';
import {
  qldDay as outboundQldDay, qldIsoDay as outboundQldIsoDay, qldMoment as outboundQldMoment,
} from '@/domain/outboundWork';
import { qldDate as quoteQldDate } from '@/domain/quote';
import { qldDate as planQldDate } from '@/domain/workPlan';
import { qldToday } from '@/domain/portfolio';
import { qldCalendarDate } from '@/export/form72';
import { formatAuDate } from '@/export/sheets';

/**
 * What day it is in Queensland.
 *
 * Everything is stamped as a UTC instant and read by somebody in Brisbane.
 * Between 10am and midnight Queensland time those agree about the date;
 * between midnight and 10am they do not, and a fire service that starts at
 * seven spends the first three hours of every day on the wrong side of it.
 *
 * That is not cosmetic on the documents this app produces. A critical defect
 * notice carries the day the maintenance was done and both statutory clocks
 * run from it — twenty-four hours to give the notice, one month to rectify —
 * so printing the UTC date puts Friday morning's work on Thursday, on a
 * document somebody may later have to defend.
 */

/** The hard case: 8:30am Brisbane, which is the previous day in UTC. */
const EARLY_BRISBANE = '2026-07-02T22:30:00.000Z';
/** 2:30pm Brisbane, where UTC and Queensland agree. */
const AFTERNOON_BRISBANE = '2026-07-03T04:30:00.000Z';

describe('the offset', () => {
  it('is ten hours, all year', () => {
    // No daylight saving in Queensland. A library that applied one would be
    // worse than the arithmetic, because it would be wrong twice a year and
    // right the rest of the time.
    expect(QLD_UTC_OFFSET_HOURS).toBe(10);
  });
});

describe('qldIsoDay', () => {
  it('reads a morning start as the day it actually was', () => {
    expect(qldIsoDay(EARLY_BRISBANE)).toBe('2026-07-03');
  });

  it('agrees with UTC in the afternoon, when they do agree', () => {
    expect(qldIsoDay(AFTERNOON_BRISBANE)).toBe('2026-07-03');
  });

  it('does not shift a date that is already a calendar date', () => {
    /*
     * The same bug in the other direction. "2026-07-03" written on a form means
     * the third of July, not an instant at midnight UTC that happens to land on
     * it — shifting it would move a five-yearly by a day.
     */
    expect(qldIsoDay('2026-07-03')).toBe('2026-07-03');
  });

  it('does not shift for daylight saving, because there is none to shift for', () => {
    // January and July both UTC+10.
    expect(qldIsoDay('2026-01-15T14:00:00.000Z')).toBe('2026-01-16');
    expect(qldIsoDay('2026-07-15T14:00:00.000Z')).toBe('2026-07-16');
  });

  it('crosses a year boundary correctly', () => {
    // New Year's Eve at 10:30am Brisbane is 31 December, not 30.
    expect(qldIsoDay('2026-12-31T00:30:00.000Z')).toBe('2026-12-31');
    // And 11pm on New Year's Eve UTC is already the new year in Brisbane.
    expect(qldIsoDay('2026-12-31T23:00:00.000Z')).toBe('2027-01-01');
  });

  it('refuses what it cannot read rather than returning the epoch', () => {
    expect(qldIsoDay(undefined)).toBeUndefined();
    expect(qldIsoDay('')).toBeUndefined();
    expect(qldIsoDay('   ')).toBeUndefined();
    expect(qldIsoDay('last tuesday')).toBeUndefined();
  });

  it('refuses an Australian date rather than reading it as an American one', () => {
    /*
     * The failure this whole module exists to prevent, arriving by the other
     * door. `Date.parse` is only specified for ISO-8601; everything else it
     * reads by its own rules, and the one shape it gets wrong is the one this
     * app prints on every page. `Date.parse('1/9/2026')` is the ninth of
     * January — not an error, not NaN, a real date eight months out that looks
     * entirely reasonable wherever it lands.
     *
     * "last tuesday" was the only unreadable input tested before this, and it
     * is the easy case: Date.parse refuses it too. A well-formed date in the
     * wrong order is the one that gets through, and the register these dates
     * come from is full of them.
     */
    expect(qldIsoDay('1/9/2026')).toBeUndefined();
    expect(qldIsoDay('01/09/2026')).toBeUndefined();
    expect(qldIsoDay('1/2/23')).toBeUndefined();
    // A month off the register's overhaul column, which Date.parse reads as the
    // twenty-fifth of June 2001.
    expect(qldIsoDay('Jun-25')).toBeUndefined();
    expect(qldIsoDay('Sep 1 2026')).toBeUndefined();
  });

  it('refuses a day the month does not have', () => {
    /*
     * Not an error either. new Date('2026-02-31T00:00:00Z') rolls forward to
     * 3 March, and 2026-02-29 to 1 March because 2026 is not a leap year — so
     * a rectification month counted from one is days out with nothing on the
     * page to show for it.
     */
    expect(qldIsoDay('2026-02-31')).toBeUndefined();
    expect(qldIsoDay('2026-02-29')).toBeUndefined();
    expect(qldIsoDay('2024-02-29')).toBe('2024-02-29');
  });

  it('still reads every instant this app actually stamps', () => {
    // The guard is on the shape, so this is the check that it did not tighten
    // onto the ordinary case.
    expect(qldIsoDay('2026-07-02T22:30:00.000Z')).toBe('2026-07-03');
    expect(qldIsoDay('2026-07-02T22:30:00Z')).toBe('2026-07-03');
    expect(qldIsoDay('2026-07-03T08:30:00+10:00')).toBe('2026-07-03');
    expect(qldIsoDay(new Date('2026-07-02T22:30:00.000Z').toISOString())).toBe('2026-07-03');
  });
});

describe('qldDay', () => {
  it('prints Australian order', () => {
    // 03/07 and 07/03 both look like dates, and for eight months of the year
    // the wrong one still reads fine. That is what makes it survive review.
    expect(qldDay(AFTERNOON_BRISBANE)).toBe('03/07/2026');
  });

  it('carries the morning shift through to the printed date', () => {
    expect(qldDay(EARLY_BRISBANE)).toBe('03/07/2026');
  });

  it('comes back undefined rather than printing a partial date', () => {
    expect(qldDay('not a date')).toBeUndefined();
  });
});

describe('qldMoment', () => {
  it('gives the Queensland wall clock, labelled as Queensland', () => {
    expect(qldMoment(EARLY_BRISBANE)).toBe('03/07/2026 08:30 (Qld)');
  });

  it('refuses to invent a time for a date that has none', () => {
    /*
     * "Notified 03/07/2026 00:00" for a notice nobody recorded a time against
     * is a fact invented by a formatter, and it reads as evidence.
     */
    expect(qldMoment('2026-07-03')).toBeUndefined();
  });

  it('pads to two digits so the column lines up', () => {
    expect(qldMoment('2026-07-02T23:05:00.000Z')).toBe('03/07/2026 09:05 (Qld)');
  });
});

/**
 * One Queensland day, however it is spelled.
 *
 * There were six copies of these ten hours: qldTime, outboundWork, quote,
 * workPlan, form72 and portfolio. Each was written where it was needed, each
 * carried its own comment explaining the offset correctly, and the earlier
 * version of this file held two of them against each other rather than move the
 * tested one.
 *
 * Holding copies to each other only proves they agree about what somebody
 * thought to compare, and what nobody compared was an Australian date. Four of
 * the six read "1/9/2026" as the ninth of January; one of them had no guard at
 * all and would plan a whole month from it. The one that got it right —
 * portfolio's — is the one whose author had been bitten by it, and it says so
 * in its comment.
 *
 * Five of them now delegate. This is what says they still do: a copy that grows
 * back, or a seventh written next to them, fails here rather than in the field.
 */
describe('every spelling of the Queensland day agrees', () => {
  const inputs = [
    EARLY_BRISBANE,
    AFTERNOON_BRISBANE,
    '2026-01-01T13:59:00.000Z',
    '2026-01-01T14:00:00.000Z',
    '2026-12-31T23:59:00.000Z',
    '2026-06-30T14:00:00.000Z',
    '2026-07-03',
    // The ones that separated them.
    '1/9/2026',
    '01/09/2026',
    'Jun-25',
    'Sep 1 2026',
    '2026-02-31',
    'not a date',
    '',
  ];

  it('gives the same calendar day, from every module that asks for one', () => {
    for (const iso of inputs) {
      const day = qldIsoDay(iso);
      expect({ iso, from: 'outboundWork', day: outboundQldIsoDay(iso) }).toEqual({ iso, from: 'outboundWork', day });
      expect({ iso, from: 'quote', day: quoteQldDate(iso) }).toEqual({ iso, from: 'quote', day });
      expect({ iso, from: 'workPlan', day: planQldDate(iso) }).toEqual({ iso, from: 'workPlan', day });
      expect({ iso, from: 'form72', day: qldCalendarDate(iso) }).toEqual({ iso, from: 'form72', day });
      expect({ iso, from: 'portfolio', day: qldToday(iso) }).toEqual({ iso, from: 'portfolio', day });
    }
  });

  it('gives the same printed date and the same moment', () => {
    for (const iso of inputs) {
      expect({ iso, day: qldDay(iso) }).toEqual({ iso, day: outboundQldDay(iso) });
      expect({ iso, at: qldMoment(iso) }).toEqual({ iso, at: outboundQldMoment(iso) });
    }
  });

  it('is comparing something, rather than six functions that all return nothing', () => {
    // The list above is mostly inputs every one of them refuses, so this is the
    // check that the agreement is about answers and not about silence.
    expect(inputs.filter((i) => qldIsoDay(i) !== undefined)).toEqual([
      EARLY_BRISBANE, AFTERNOON_BRISBANE,
      '2026-01-01T13:59:00.000Z', '2026-01-01T14:00:00.000Z',
      '2026-12-31T23:59:00.000Z', '2026-06-30T14:00:00.000Z', '2026-07-03',
    ]);
  });
});

/**
 * Every document that prints a date goes through formatAuDate, so it has to
 * answer the same way.
 */
describe('formatAuDate uses the Queensland day', () => {
  it('prints a morning start as the day it was', () => {
    expect(formatAuDate(EARLY_BRISBANE)).toBe('03/07/2026');
  });

  it('leaves a plain date alone', () => {
    expect(formatAuDate('2026-07-03')).toBe('03/07/2026');
  });

  it('shows an unreadable value rather than an empty box', () => {
    // An empty cell is untraceable. The bad value on the page can be chased
    // back to the record that holds it.
    expect(formatAuDate('last tuesday')).toBe('last tuesday');
  });

  it('is still empty for nothing at all', () => {
    expect(formatAuDate(undefined)).toBe('');
    expect(formatAuDate('')).toBe('');
  });
});

/**
 * Nowhere else declares the offset.
 *
 * The six copies did not arrive by carelessness. Each was written where it was
 * needed by somebody who had just read the bug it prevents, and each one's
 * comment explains the ten hours correctly. Writing ten hours down again is the
 * natural thing to do at the moment you have understood why it matters, and it
 * is exactly then that the seventh copy gets written.
 *
 * So this is a rule about the constant rather than a test of any one use of it.
 * The number itself is not the risk — all six agreed it was ten — the risk is
 * that a module with its own copy also has its own parsing, and that is where
 * they differed.
 */
describe('the Queensland offset is declared once', () => {
  const ROOTS = ['src', 'app'];
  const SKIP = new Set(['node_modules', '.git', 'dist', '.expo', 'coverage', '__tests__', '__mocks__']);
  const HOME = join('src', 'domain', 'qldTime.ts');

  /** Ten hours, or its spellings: as hours, as milliseconds, as minutes. */
  const OFFSET = /QLD[A-Z_]*OFFSET[A-Z_]*\s*=\s*(10|600)\b|(^|[^_0-9])10\s*\*\s*3_?600_?000|600\s*\*\s*60_?000/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
  }

  const files = () => ROOTS.flatMap((r) => walk(r));

  it('and nowhere else spells it out', () => {
    const offenders: string[] = [];
    for (const file of files()) {
      if (file === HOME) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (OFFSET.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    // Named with line numbers rather than counted: the fix is importing from
    // qldTime, and the person doing it needs the file, not a total.
    expect(offenders).toEqual([]);
  });

  it('recognises the spellings it is looking for', () => {
    // Each of these is one of the six, as it was written.
    expect(OFFSET.test('export const QLD_UTC_OFFSET_HOURS = 10;')).toBe(true);
    expect(OFFSET.test('const QLD_OFFSET_MINUTES = 600;')).toBe(true);
    expect(OFFSET.test('  return new Date(t + 10 * 3_600_000).toISOString().slice(0, 10);')).toBe(true);
    expect(OFFSET.test('new Date(ms + 600 * 60_000)')).toBe(true);

    // And leaves alone the uses that go through the one constant, along with
    // the unrelated tens and six hundreds this app is full of.
    expect(OFFSET.test('new Date(ms + QLD_UTC_OFFSET_HOURS * HOUR_MS)')).toBe(false);
    expect(OFFSET.test('export { QLD_UTC_OFFSET_HOURS };')).toBe(false);
    expect(OFFSET.test('const SIX_HOURS_MS = 6 * 3_600_000;')).toBe(false);
    expect(OFFSET.test('const MIN_USEFUL_SECTION = 120;')).toBe(false);
    expect(OFFSET.test('const STANDBY_HOURS = 10;')).toBe(false);
  });

  it('is reading the whole app, so a green result means something', () => {
    const all = files();
    expect(all.length).toBeGreaterThan(150);
    expect(all).toContain(HOME);
    expect(all).toContain(join('src', 'domain', 'outboundWork.ts'));
    expect(all).toContain(join('src', 'export', 'form72.ts'));
  });
});
