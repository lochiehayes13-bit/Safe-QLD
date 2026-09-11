/**
 * How wide to lay a screen out, given the window it has been handed.
 *
 * This is an Android field app first, and it is also published as a web app
 * the owner opens on a desktop browser. Every screen in it is one full-width
 * column, which is right at 360 points and wrong at 2560: a card stretches the
 * width of the monitor, a line of body text runs so far that the eye loses the
 * start of the next one, and the numbers on a timesheet end up marooned in the
 * middle of a field of empty background.
 *
 * The answer to a wide window is not a wider column. Text has a width it reads
 * well at whatever the monitor does, so the column is capped and centred and
 * the page ground keeps the rest. Where the content is a grid of peers — seven
 * days of a week, all the same shape — the spare width buys more columns
 * rather than fatter ones, which is also what turns a two-metre scroll into
 * something a desktop user can see at once.
 *
 * Pure arithmetic, and tested, because this reaches 114 screens through
 * `Screen`. A layout rule that exists only as magic numbers scattered through
 * components is a rule nobody can check and every new screen re-invents.
 */

export type WidthBand = 'phone' | 'tablet' | 'desktop';

/**
 * Where a phone stops.
 *
 * 700 rather than a tablet's 768, so a phone turned landscape — 800 points on
 * a common handset — is on the wide side of the line. It has the room for two
 * columns and it looks daft without them.
 */
export const TABLET_MIN = 700;

/**
 * Where a browser window is a desktop.
 *
 * The smallest window that holds three cards of a workable width side by side
 * with a gutter left over. Below it there is room for two, which is a tablet.
 */
export const DESKTOP_MIN = 1100;

/**
 * The widest a single column of body text gets.
 *
 * At the app's 17 point body face this is about seventy-five characters to a
 * line inside a card, which is the far end of comfortable. Wider is not more
 * generous, it is harder to read.
 */
export const READING_MAX = 680;

/**
 * The widest a grid of cards gets.
 *
 * Four day cards and their gaps, which is as many as a week wants side by
 * side. Past this the eye has to travel across the desk to compare Monday
 * with Friday.
 */
export const BOARD_MAX = 1280;

/** Which of the three shapes a window of this width is. */
export function widthBand(width: number): WidthBand {
  if (!Number.isFinite(width) || width < TABLET_MIN) return 'phone';
  return width < DESKTOP_MIN ? 'tablet' : 'desktop';
}

export interface PageLayout {
  band: WidthBand;
  /** The width the content column takes. Never more than the window. */
  content: number;
  /** What is left over, on each side. Zero until the column is capped. */
  gutter: number;
  /**
   * Whether the column is narrower than the window, and so has to be centred.
   *
   * This is the flag a component branches on rather than the band, because it
   * is the thing that is actually true: a phone never reaches the cap and gets
   * exactly the layout it always had.
   */
  centred: boolean;
}

/**
 * The column for a window, and the space either side of it.
 *
 * A width of zero or a width that is not a number — which is what a browser
 * can report for a frame that has not been measured yet — comes back as a
 * phone with nothing centred, so the first paint is the ordinary full-width
 * column rather than a column of zero width.
 */
export function pageLayout(width: number, max: number = READING_MAX): PageLayout {
  const band = widthBand(width);
  const window = Number.isFinite(width) && width > 0 ? width : 0;
  const content = Math.min(window, Math.max(0, max));
  return { band, content, gutter: Math.max(0, (window - content) / 2), centred: content < window };
}

/**
 * How many columns of at least `min` points fit across `available`.
 *
 * Always at least one: a card narrower than its minimum is still better than
 * no card, and a screen 320 points wide has to render something.
 */
export function gridColumns(
  available: number,
  { min, gap = 0, max = 0 }: { min: number; gap?: number; max?: number },
): number {
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(min) || min <= 0) return 1;
  const fits = Math.floor((available + gap) / (min + gap));
  return Math.max(1, max > 0 ? Math.min(fits, max) : fits);
}

/**
 * The width of one item, so a full row of them fits.
 *
 * Rounded down rather than to nearest. A fraction of a point over is a row
 * that wraps its last card onto a line of its own, and a grid of seven that
 * meant to break 4/3 breaks 3/3/1 instead — on the web, where the window width
 * is very often a fraction.
 */
export function gridItemWidth(available: number, columns: number, gap = 0): number {
  if (!Number.isFinite(available) || available <= 0) return 0;
  const cols = Math.max(1, Math.floor(columns));
  return Math.max(0, Math.floor((available - gap * (cols - 1)) / cols));
}
