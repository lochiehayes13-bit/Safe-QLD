import {
  BOARD_MAX, DESKTOP_MIN, READING_MAX, TABLET_MIN,
  gridColumns, gridItemWidth, pageLayout, widthBand,
} from '@/domain/layout';

/**
 * The width rule, pinned as arithmetic.
 *
 * This app is used on a handset and opened on a desktop browser, where the
 * same screens were drawing a card the width of a 2560 point monitor. The
 * numbers that fix that are a judgement — where a phone stops, how wide a line
 * of text may run, how many cards fit across — and a judgement spread through
 * components as magic numbers is one nobody can check and every new screen
 * guesses at again.
 *
 * So the cases here are the widths the app actually meets: a 360 point
 * handset, that handset turned over, an iPad either way up, a laptop window
 * and a monitor. The phone case is the one that matters most — it says the
 * rule leaves a handset exactly as it was.
 */

describe('which of the three shapes a window is', () => {
  it('calls a handset a phone, upright and on its side', () => {
    expect(widthBand(360)).toBe('phone');
    expect(widthBand(430)).toBe('phone');
    expect(widthBand(TABLET_MIN - 1)).toBe('phone');
  });

  it('starts a tablet where a second column becomes sensible', () => {
    expect(widthBand(TABLET_MIN)).toBe('tablet');
    expect(widthBand(768)).toBe('tablet');
    expect(widthBand(DESKTOP_MIN - 1)).toBe('tablet');
  });

  it('starts a desktop where a third one does', () => {
    expect(widthBand(DESKTOP_MIN)).toBe('desktop');
    expect(widthBand(1440)).toBe('desktop');
    expect(widthBand(2560)).toBe('desktop');
  });

  it('treats a width it has not been given as a phone', () => {
    // A browser frame that has not been measured reports zero, and NaN is not
    // less than anything — so both are answered explicitly rather than by a
    // comparison that quietly says "desktop".
    expect(widthBand(0)).toBe('phone');
    expect(widthBand(Number.NaN)).toBe('phone');
    expect(widthBand(-1)).toBe('phone');
  });
});

describe('the column, and the ground either side of it', () => {
  it('leaves a phone exactly as it was', () => {
    expect(pageLayout(360)).toEqual({ band: 'phone', content: 360, gutter: 0, centred: false });
  });

  it('caps the column on a monitor and splits the rest evenly', () => {
    const page = pageLayout(2560);
    expect(page.content).toBe(READING_MAX);
    expect(page.gutter).toBe((2560 - READING_MAX) / 2);
    expect(page.centred).toBe(true);
    expect(page.content + page.gutter * 2).toBe(2560);
  });

  it('centres a handset held sideways as well, because what is capped is the column and not the band', () => {
    const page = pageLayout(800);
    expect(page.band).toBe('tablet');
    expect(page.content).toBe(READING_MAX);
    expect(page.centred).toBe(true);
  });

  it('never widens a window to reach the maximum', () => {
    for (const width of [320, 360, 430, 600]) {
      const page = pageLayout(width, BOARD_MAX);
      expect({ width, content: page.content, gutter: page.gutter }).toEqual({ width, content: width, gutter: 0 });
    }
  });

  it('gives a grid of peers more room than a page of text at the same width', () => {
    expect(pageLayout(1920, BOARD_MAX).content).toBe(BOARD_MAX);
    expect(pageLayout(1920).content).toBe(READING_MAX);
    expect(BOARD_MAX).toBeGreaterThan(READING_MAX);
  });

  it('gives a column of nothing rather than a column of zero when the width is not a number', () => {
    // The first paint on the web can arrive before the frame is measured. A
    // content width of zero with nothing centred means the ordinary
    // full-width column, not a blank page.
    expect(pageLayout(0)).toEqual({ band: 'phone', content: 0, gutter: 0, centred: false });
    expect(pageLayout(Number.NaN).centred).toBe(false);
  });
});

describe('how many cards fit across', () => {
  it('counts the gaps as well as the cards', () => {
    // Three 300 point cards need 924 points once the two gaps between them are
    // counted, not 900.
    expect(gridColumns(920, { min: 300, gap: 12 })).toBe(2);
    expect(gridColumns(924, { min: 300, gap: 12 })).toBe(3);
  });

  it('is always at least one, however narrow the room', () => {
    expect(gridColumns(200, { min: 300, gap: 12 })).toBe(1);
    expect(gridColumns(0, { min: 300 })).toBe(1);
    expect(gridColumns(Number.NaN, { min: 300 })).toBe(1);
    expect(gridColumns(1248, { min: 0 })).toBe(1);
  });

  it('stops at a maximum where one is given', () => {
    expect(gridColumns(4000, { min: 300, gap: 12 })).toBe(12);
    expect(gridColumns(4000, { min: 300, gap: 12, max: 4 })).toBe(4);
  });
});

describe('the width of one card in the row', () => {
  it('fills the row exactly, gaps included', () => {
    const width = gridItemWidth(1248, 4, 12);
    expect(width).toBe(303);
    expect(width * 4 + 12 * 3).toBeLessThanOrEqual(1248);
  });

  it('rounds down, because a fraction over wraps the last card onto its own line', () => {
    // A browser reports a fractional width far more often than not.
    expect(gridItemWidth(1000.9, 3, 10)).toBe(326);
    expect(326 * 3 + 10 * 2).toBeLessThanOrEqual(1000.9);
  });

  it('hands the whole row to a single column', () => {
    expect(gridItemWidth(328, 1, 12)).toBe(328);
  });
});

describe('the week, at the widths it is actually opened at', () => {
  /** What the timesheet works out for itself: the room inside the screen's padding, then the grid. */
  const week = (width: number) => {
    const page = pageLayout(width, BOARD_MAX);
    const room = page.content - 16 * 2;
    const columns = page.band === 'phone' ? 1 : gridColumns(room, { min: 300, gap: 12 });
    return { band: page.band, columns, card: gridItemWidth(room, columns, 12) };
  };

  it('is one full-width day at a time on a handset', () => {
    expect(week(360)).toEqual({ band: 'phone', columns: 1, card: 328 });
  });

  it('is two days across on an iPad upright', () => {
    expect(week(768)).toEqual({ band: 'tablet', columns: 2, card: 362 });
  });

  it('is three on that iPad turned over', () => {
    expect(week(1024).columns).toBe(3);
  });

  it('is four on a monitor, and stops at four however big the monitor is', () => {
    expect(week(1440)).toEqual({ band: 'desktop', columns: 4, card: 303 });
    expect(week(2560)).toEqual({ band: 'desktop', columns: 4, card: 303 });
  });

  it('never asks for a card narrower than a job row needs', () => {
    for (const width of [700, 768, 900, 1024, 1100, 1280, 1440, 1920, 2560]) {
      const { columns, card } = week(width);
      expect({ width, wide: card >= 300 || columns === 1 }).toEqual({ width, wide: true });
    }
  });
});
