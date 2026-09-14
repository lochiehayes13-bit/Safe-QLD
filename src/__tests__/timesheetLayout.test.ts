import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the width rule was wired into, which arithmetic cannot see.
 *
 * `src/domain/layout.ts` is tested on its own, and it is worth nothing unless
 * the container every screen sits in actually asks it. The same goes the other
 * way: the timesheet is the screen the owner looks at on a desktop, and the
 * fault he reported — a weekend folded into a dashed line that had to be
 * tapped before it was a day — is a shape rather than a value.
 *
 * So these read the two files. It is the way `icons.test.ts` holds the empty
 * states: a check on the arrangement, for the things that only exist as an
 * arrangement.
 */

const REPO = join(__dirname, '..', '..');
const ui = readFileSync(join(REPO, 'src/components/ui.tsx'), 'utf8');
const timesheet = readFileSync(join(REPO, 'app/timesheet/[id].tsx'), 'utf8');

/** Screen alone. The rest of the file is primitives that lay out nothing. */
const screen = ui.slice(ui.indexOf('export function Screen('), ui.indexOf('export function Card('));

describe('the container 114 screens sit in', () => {
  it('found the component it means to check', () => {
    expect(screen).toContain('export function Screen(');
    expect(screen.length).toBeGreaterThan(400);
  });

  it('asks the window how wide it is rather than measuring once', () => {
    // A desktop browser window gets dragged wider and narrower all day.
    expect(screen).toContain('useWindowDimensions()');
  });

  it('takes the column from the shared rule, not from a number written here', () => {
    expect(screen).toContain('pageLayout(');
    expect(screen).not.toMatch(/maxWidth:\s*\d/);
  });

  it('does nothing at all to a phone', () => {
    // The centring style is absent below the cap rather than set to the same
    // values a longer way round, so a handset renders what it always did.
    expect(screen).toMatch(/page\.centred[\s\S]{0,160}maxWidth/);
    expect(screen).toContain('padding: t.space(4), gap: t.space(3)');
    expect(screen).toContain('paddingBottom: t.space(28)');
  });

  it('gives the narrow column to a screen that does not ask for the wide one', () => {
    // 113 of the 114 are a page to read down, and they say nothing at all.
    expect(screen).toMatch(/wide = false/);
  });

  it('caps a screen that scrolls itself, because a list is a document too', () => {
    /*
     * Thirty-five screens turn scrolling off and all but one of them is a
     * list that does its own scrolling — jobs, defects, the catalogue, the
     * staff list. Reading the cap off `scroll` left every one of them
     * full-bleed at 2560, which is the complaint this was built to answer.
     */
    expect(screen).toContain('<View style={[{ flex: 1 }, inner, column]}>{children}</View>');
  });

  it('lets a canvas keep the whole window, and only the canvas does', () => {
    // A 680 point map in the middle of a monitor is not a layout.
    expect(screen).toContain('page.centred && !full');
    const map = readFileSync(join(REPO, 'app/(tabs)/map.tsx'), 'utf8');
    expect(map).toContain('<Screen scroll={false} padded={false} full>');
  });
});

describe('the timesheet at whatever width it is given', () => {
  it('has no folded weekend left to open', () => {
    expect(timesheet).not.toContain('WeekendRow');
    expect(timesheet).not.toContain('openWeekend');
    expect(timesheet).not.toContain('Tap to add');
  });

  it('draws every day of the week through the one card', () => {
    expect(timesheet.match(/days\.map\(/g)).toHaveLength(1);
    expect(timesheet.match(/<DayCard\b/g)).toHaveLength(1);
  });

  it('answers an empty Saturday with a quieter card rather than a shorter week', () => {
    expect(timesheet).toContain('quiet={isWeekendDay(date) && onDay.length === 0}');
  });

  it('lays the week across the screen once there is room for it', () => {
    expect(timesheet).toContain('<Screen wide>');
    expect(timesheet).toContain('gridColumns(');
    expect(timesheet).toContain('gridItemWidth(');
    expect(timesheet).toContain("flexWrap: 'wrap'");
  });

  it('puts the summary and the paperwork at the top of a wide screen', () => {
    // Not at the bottom of a two-metre column, which is where a phone layout
    // stretched across a monitor leaves them.
    const wide = timesheet.slice(timesheet.indexOf('{spread ? ('), timesheet.indexOf('</Screen>'));
    expect(wide.indexOf('{summary}')).toBeLessThan(wide.indexOf('{week}'));
    expect(wide.indexOf('{yourDetails}')).toBeLessThan(wide.indexOf('{week}'));
  });

  it('sends the office the same workbook, whichever button is pressed', () => {
    // Email and Export were each building the file. Two copies of a file name
    // and a sheet list is how they come to disagree, so there is one now.
    expect(timesheet).toContain('writeXlsx(');
    expect(timesheet.match(/writeXlsx\(/g)).toHaveLength(1);
    expect(timesheet).toContain('[timesheetSheet(sheet), timesheetSummarySheet(sheet)]');
    expect(timesheet.match(/workbook\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('still goes to accounts, and still only marks a week submitted when it went', () => {
    expect(timesheet).toContain('to: TIMESHEET_INBOX');
    expect(timesheet).toContain("persist({ status: 'submitted' })");
    // On the one outcome that means the mail app said so, and no other. A
    // browser answers `handed-over`, and a week marked submitted on that is a
    // week nobody sent.
    const marked = timesheet.slice(0, timesheet.indexOf("persist({ status: 'submitted' })"));
    expect(marked.lastIndexOf("outcome === 'sent'")).toBeGreaterThan(marked.lastIndexOf('const emailSheet'));
  });

  it('puts the workbook on the email itself, not only on Export', () => {
    // The whole point of the button: accounts should not have to ask for the
    // spreadsheet after reading the summary.
    expect(timesheet).toMatch(/sendMail\([\s\S]{0,400}\[file\]/);
  });

  it('gives the summary card the week, so it stands beside the paperwork', () => {
    // A four line card next to an eight line column left a hole the height of
    // a hand on every desktop.
    expect(timesheet).toContain('weekSummary(sheet)');
    expect(timesheet).toContain('<DayBar');
    expect(timesheet).toContain('byDay.map(');
  });

  it('runs the two top columns to the same height, so neither ends in background', () => {
    // `flex-start` is what left the hole: the short column kept its natural
    // height and the row was as tall as the other one.
    const wide = timesheet.slice(timesheet.indexOf('{spread ? ('), timesheet.indexOf('</Screen>'));
    expect(wide).toContain('align="stretch"');
    expect(wide).not.toContain('align="flex-start"');
    // And the card fills what it is given rather than floating at the top of it.
    expect(timesheet).toMatch(/spread \? \{ flex: 1 \}/);
  });
});
