import { GST, rateCardFrom, type RateCardPrefs } from '@/domain/rates';
import { bandFor, valueTimesheet } from '@/domain/timesheetValue';
import type { Timesheet, TimesheetEntry } from '@/domain/timesheet';

/**
 * Pricing a week's attendances.
 *
 * The failure that matters here is the one nobody notices: a week that reads as
 * worth something when half of it was never priced, because a rate was missing
 * or an entry had nowhere to attribute the value to. So the assertions are as
 * much about what gets warned as what gets totalled.
 *
 * The figures are shaped like a real card and are not one.
 */

const entry = (p: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  id: p.id ?? 'e1',
  date: p.date ?? '2026-08-12',
  jobNumber: p.jobNumber ?? 'J1001',
  siteName: p.siteName ?? 'Grange Hall',
  serviceReportNumber: p.serviceReportNumber ?? '',
  startTime: p.startTime ?? '08:00',
  finishTime: p.finishTime ?? '12:00',
  hourKind: p.hourKind ?? 'ord',
  hoursOverride: p.hoursOverride,
  sick: p.sick ?? '',
  rdo: p.rdo ?? '',
  annual: p.annual ?? '',
  lwop: p.lwop ?? '',
  comments: p.comments ?? '',
});

const sheet = (entries: TimesheetEntry[]): Timesheet => ({
  id: 't1',
  employeeName: 'A Technician',
  vehicleRego: 'ABC123',
  kilometerReading: '120450',
  weekStarting: '2026-08-12',
  entries,
  managerName: '',
  checkedBy: '',
  status: 'draft',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
});

const PREFS: RateCardPrefs = {
  normalHoursSellCents: 13_000,
  afterHoursSellCents: 18_500,
  attendanceNormalCents: 30_000,
  attendanceNormalMinutes: 120,
  attendanceAfterHoursCents: 57_500,
  attendanceAfterHoursMinutes: 180,
};

describe('rateCardFrom', () => {
  it('builds a labour rate and an attendance fee for each band', () => {
    const { rates, fees } = rateCardFrom(PREFS);
    expect(rates.map((r) => r.hours)).toEqual(['normal', 'after-hours']);
    expect(fees.map((f) => f.hours)).toEqual(['normal', 'after-hours']);
    expect(rates[0]!.sellCentsPerHour).toBe(13_000);
    expect(fees[1]!.includedLabourMinutes).toBe(180);
    expect(rates[0]!.taxRate).toBe(GST);
  });

  it("omits a rate left at zero rather than shipping a free hour", () => {
    const { rates, fees } = rateCardFrom({ ...PREFS, afterHoursSellCents: 0, attendanceNormalCents: 0 });
    expect(rates.map((r) => r.hours)).toEqual(['normal']);
    expect(fees.map((f) => f.hours)).toEqual(['after-hours']);
  });

  it('leaves no rate carrying a cost, so margin is never read off this card', () => {
    const { rates } = rateCardFrom(PREFS);
    expect(rates.every((r) => r.costCentsPerHour === 0)).toBe(true);
  });
});

describe('bandFor', () => {
  it('follows the hour kind when it is overtime', () => {
    expect(bandFor(entry({ hourKind: 'ot', startTime: '09:00' }))).toBe('after-hours');
    expect(bandFor(entry({ hourKind: 'dt', startTime: '09:00' }))).toBe('after-hours');
  });

  it('reads the clock on ordinary time', () => {
    expect(bandFor(entry({ hourKind: 'ord', startTime: '04:00' }))).toBe('after-hours');
    expect(bandFor(entry({ hourKind: 'ord', startTime: '18:30' }))).toBe('after-hours');
    expect(bandFor(entry({ hourKind: 'ord', startTime: '07:00' }))).toBe('normal');
    expect(bandFor(entry({ hourKind: 'ord', startTime: '16:59' }))).toBe('normal');
  });

  it('falls back to normal when the start time is unreadable', () => {
    expect(bandFor(entry({ startTime: 'early', hoursOverride: '3' }))).toBe('normal');
  });
});

describe('valueTimesheet', () => {
  const card = rateCardFrom(PREFS);

  it('charges the attendance fee once and only bills the minutes past it', () => {
    // Four hours at normal rates: $300 covers the first two, the other two
    // bill at $130.
    const v = valueTimesheet(sheet([entry({ startTime: '08:00', finishTime: '12:00' })]), {
      ...card, chargeAttendance: true,
    });
    expect(v.entries).toHaveLength(1);
    expect(v.subtotalCents).toBe(30_000 + 26_000);
    expect(v.gstCents).toBe(5_600);
    expect(v.totalCents).toBe(61_600);
    expect(v.hours).toBe(4);
  });

  it('bills hours only when the attendance is inside a contract visit', () => {
    const v = valueTimesheet(sheet([entry({ startTime: '08:00', finishTime: '12:00' })]), {
      ...card, chargeAttendance: false,
    });
    expect(v.subtotalCents).toBe(52_000);
    expect(v.warnings).toEqual([]);
  });

  it('prices an after-hours entry at the after-hours card', () => {
    const v = valueTimesheet(sheet([entry({ hourKind: 'ot', startTime: '20:00', finishTime: '00:00' })]), {
      ...card, chargeAttendance: true,
    });
    expect(v.entries[0]!.band).toBe('after-hours');
    // $575 covers three of the four hours; the fourth bills at $185.
    expect(v.subtotalCents).toBe(57_500 + 18_500);
  });

  it('treats two visits to the same site in a day as two attendances', () => {
    const v = valueTimesheet(
      sheet([
        entry({ id: 'a', startTime: '08:00', finishTime: '10:00' }),
        entry({ id: 'b', startTime: '14:00', finishTime: '16:00' }),
      ]),
      { ...card, chargeAttendance: true },
    );
    expect(v.entries).toHaveLength(2);
    expect(v.subtotalCents).toBe(60_000);
  });

  it('skips leave, which is not an attendance', () => {
    const v = valueTimesheet(
      sheet([entry({ startTime: '', finishTime: '', siteName: '', jobNumber: '', sick: '8' })]),
      { ...card, chargeAttendance: true },
    );
    expect(v.entries).toEqual([]);
    expect(v.unattributed).toBe(0);
    expect(v.totalCents).toBe(0);
  });

  it('warns rather than silently dropping hours with nowhere to attribute them', () => {
    const v = valueTimesheet(
      sheet([entry({ siteName: '', jobNumber: '', startTime: '08:00', finishTime: '12:00' })]),
      { ...card, chargeAttendance: true },
    );
    expect(v.unattributed).toBe(1);
    expect(v.entries).toEqual([]);
    expect(v.warnings.join(' ')).toContain('nothing to attribute');
  });

  it("says so when a band's rate is missing instead of pricing it at nothing", () => {
    const bare = rateCardFrom({ ...PREFS, afterHoursSellCents: 0, attendanceAfterHoursCents: 0 });
    const v = valueTimesheet(sheet([entry({ hourKind: 'ot', startTime: '20:00', finishTime: '23:00' })]), {
      ...bare, chargeAttendance: true,
    });
    expect(v.subtotalCents).toBe(0);
    expect(v.hours).toBe(3);
    expect(v.warnings.join(' ')).toContain('after hours attendance fee');
    expect(v.warnings.join(' ')).toContain('after hours labour rate');
  });

  it('does not repeat the same warning once per entry', () => {
    const bare = rateCardFrom({ ...PREFS, normalHoursSellCents: 0, attendanceNormalCents: 0 });
    const v = valueTimesheet(
      sheet([
        entry({ id: 'a', startTime: '08:00', finishTime: '12:00' }),
        entry({ id: 'b', startTime: '13:00', finishTime: '15:00' }),
      ]),
      { ...bare, chargeAttendance: true },
    );
    expect(v.warnings.filter((w) => w.includes('attendance fee'))).toHaveLength(1);
  });

  it('adds GST per entry, so the total is the sum of what each attendance shows', () => {
    const v = valueTimesheet(
      sheet([
        entry({ id: 'a', startTime: '08:00', finishTime: '11:30' }),
        entry({ id: 'b', hourKind: 'ot', startTime: '19:00', finishTime: '22:15' }),
      ]),
      { ...card, chargeAttendance: true },
    );
    const summed = v.entries.reduce((n, e) => n + e.charge.totalCents, 0);
    expect(v.totalCents).toBe(summed);
    expect(v.subtotalCents + v.gstCents).toBe(v.totalCents);
  });

  it('uses an hours override, which is how a technician corrects the clock', () => {
    const v = valueTimesheet(
      sheet([entry({ startTime: '08:00', finishTime: '12:00', hoursOverride: '2' })]),
      { ...card, chargeAttendance: true },
    );
    expect(v.hours).toBe(2);
    // Two hours is exactly what the attendance fee covers, so nothing extra.
    expect(v.subtotalCents).toBe(30_000);
  });
});
