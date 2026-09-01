import { QLD_UTC_OFFSET_HOURS, qldDay, qldIsoDay, qldMoment } from '@/domain/qldTime';
import {
  qldDay as outboundQldDay, qldIsoDay as outboundQldIsoDay, qldMoment as outboundQldMoment,
} from '@/domain/outboundWork';
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
 * The same arithmetic exists in outboundWork, where it was written first and is
 * heavily tested against the office push.
 *
 * Two copies of a rule is how the two drift, and this one has a wrong answer
 * that looks right. Rather than move the tested copy and risk what depends on
 * it, the two are held to each other here: if either changes, this fails.
 */
describe('the two copies of the Queensland day agree', () => {
  const instants = [
    EARLY_BRISBANE,
    AFTERNOON_BRISBANE,
    '2026-01-01T13:59:00.000Z',
    '2026-01-01T14:00:00.000Z',
    '2026-12-31T23:59:00.000Z',
    '2026-06-30T14:00:00.000Z',
    '2026-07-03',
    'not a date',
    '',
  ];

  it('gives the same calendar day', () => {
    for (const iso of instants) {
      expect({ iso, day: qldIsoDay(iso) }).toEqual({ iso, day: outboundQldIsoDay(iso) });
    }
  });

  it('gives the same printed date', () => {
    for (const iso of instants) {
      expect({ iso, day: qldDay(iso) }).toEqual({ iso, day: outboundQldDay(iso) });
    }
  });

  it('gives the same moment, including refusing the same inputs', () => {
    for (const iso of instants) {
      expect({ iso, at: qldMoment(iso) }).toEqual({ iso, at: outboundQldMoment(iso) });
    }
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
