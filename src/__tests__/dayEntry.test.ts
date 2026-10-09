import { readFileSync } from 'fs';
import { join } from 'path';
import { DAY_HINT, dayBox, readDayBox } from '@/domain/dayEntry';

/**
 * The date boxes on the test sheet, the occupier statement and the baseline
 * record: dd/mm/yyyy on screen, the ISO day stored, nothing half-typed saved.
 */

describe('what goes in the box', () => {
  it('shows a stored day day first', () => {
    expect(dayBox('2026-10-09')).toBe('09/10/2026');
  });

  it('shows an instant as its Queensland day', () => {
    // 22:30 UTC on the 8th is 08:30 on the 9th in Brisbane.
    expect(dayBox('2026-10-08T22:30:00.000Z')).toBe('09/10/2026');
  });

  it('shows nothing for nothing, and a value that is not a date as it is', () => {
    expect(dayBox('')).toBe('');
    expect(dayBox(null)).toBe('');
    expect(dayBox(undefined)).toBe('');
    expect(dayBox('March 2024')).toBe('March 2024');
  });
});

describe('what is typed', () => {
  it('reads day first, in the ways it is typed on a phone', () => {
    expect(readDayBox('9/10/2026')).toEqual({ day: '2026-10-09' });
    expect(readDayBox('09.10.26')).toEqual({ day: '2026-10-09' });
    expect(readDayBox('09102026')).toEqual({ day: '2026-10-09' });
    expect(readDayBox('2026-10-09')).toEqual({ day: '2026-10-09' });
  });

  it('clears on an empty box', () => {
    expect(readDayBox('  ')).toEqual({ day: null });
  });

  it('stores nothing for a half-typed or impossible date, and says how to write it', () => {
    expect(readDayBox('09/10/202')).toEqual({ why: DAY_HINT });
    expect(readDayBox('31/02/2026')).toEqual({ why: DAY_HINT });
    expect(DAY_HINT).toBe('Write it as dd/mm/yyyy.');
  });
});

describe('the screens that take a date', () => {
  const screens = [
    'app/report/[id].tsx',
    'app/occupier/[id].tsx',
    'app/baseline/[id].tsx',
  ];
  const read = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');

  it.each(screens)('%s asks for dd/mm/yyyy, never YYYY-MM-DD', (f) => {
    expect(read(f)).not.toMatch(/placeholder="YYYY-MM-DD"/);
    expect(read(f)).toMatch(/placeholder="dd\/mm\/yyyy"/);
  });

  it.each([...screens, 'app/occupier/index.tsx', 'app/work/reports.tsx', 'app/work/baselines.tsx'])(
    '%s draws in theme colours, not hex',
    (f) => {
      expect(read(f)).not.toMatch(/color=["']#[0-9a-f]{3,8}["']/i);
    },
  );
});
