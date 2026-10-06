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

  it('addresses the week from the chosen route, and still only marks it submitted when it went', () => {
    /*
     * This guard used to quote `to: TIMESHEET_INBOX` because at the time the
     * only thing to hold still was that accounts kept receiving the week. Now
     * that a technician can add Matt or Lachlan, quoting that line would be
     * pinning the diff rather than the behaviour, so it holds the behaviour
     * instead: the draft is addressed from the resolved route, and the route is
     * resolved through `timesheetRoute`, which is what turns an id nobody
     * recognises into accounts alone rather than into nobody.
     *
     * That accounts is on EVERY route is not checkable from this file -- it is a
     * fact about the route table -- so `timesheetEmail.test.ts` owns it.
     */
    expect(timesheet).toContain('to: route.to');
    expect(timesheet).toContain('timesheetRoute(routeId)');
    // Resolved once, so the sentence under the buttons cannot name one set of
    // recipients while the mail app is handed another.
    expect(timesheet.match(/timesheetRoute\(routeId\)/g)).toHaveLength(1);
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
    expect(timesheet).toMatch(/sendMail\([\s\S]{0,400}\[file, page\]/);
  });

  it('sends the readable page beside the workbook, and second', () => {
    /*
     * Fifteen columns is right for payroll and unreadable on the handset the
     * email arrives on, so both go. The workbook stays the FIRST attachment:
     * that is the one the office opens, and an email whose first attachment
     * changed would retrain everybody who handles it.
     */
    expect(timesheet).toContain('timesheetDocumentHtml(sheet)');
    /*
     * The page is allowed to fail without taking the workbook with it: it is
     * rendered through the phone's print engine, which can refuse, and it used
     * to be awaited inside the same try as the send — so a convenience copy
     * that could not be made answered "Could not send" and payroll got
     * nothing. The workbook goes either way.
     */
    expect(timesheet).toMatch(/sendMail\([\s\S]{0,400}page \? \[file, page\] : \[file\]/);
  });

  it('offers the page on its own as well, for somebody who wants only that', () => {
    // "Readable copy" measured 126dp in the 100 this button has at 320, so it
    // broke to two lines beside a one-line "Export".
    expect(timesheet).toContain('title="As a page"');
    expect(timesheet).toContain('const sharePage');
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

/**
 * What fits on the phone the week is filled in on.
 *
 * Measured against the bundled Manrope rather than eyeballed: every number
 * below came off the TTF at the size and weight the screen actually uses, in
 * the space the layout actually leaves.
 */
describe('the controls a gloved hand has to hit', () => {
  /*
   * The theme calls 48dp the Android floor and says gloves want more; Chip,
   * Segmented and Button all assert 44. Four controls on the day card did not,
   * and three of them were a bare line of text with hitSlop around it — which
   * Android clips to the parent's own bounds, so the slop bought nothing.
   */
  it.each([
    ['clearing a day marked as leave', /onPress=\{\(\) => onLeave\(leave\.kind, 0\)\}\s*\n\s*style=\{\{ minHeight: 44/],
    ['the overtime and notes toggle', /setOpen\(\(v\) => !v\)\} style=\{\{ minHeight: 44/],
    ['removing a job from a day', /accessibilityLabel="Remove this job"[\s\S]{0,160}minHeight: 44, minWidth: 44/],
    ['tapping a job title to edit it', /paddingVertical: 2, paddingHorizontal: 0, minHeight: 44/],
  ])('%s is at least 44dp', (_what, shape) => {
    expect(timesheet).toMatch(shape);
  });

  it('none of them leans on hitSlop for its height', () => {
    // Six points around a 17dp line is a 29dp target, and Android will not
    // honour slop that leaves the parent anyway.
    expect(timesheet).not.toMatch(/hitSlop=\{6\}/);
  });
});

describe('the lines that were being cut off', () => {
  it('gives the day summary room for the longest thing it says', () => {
    /*
     * 96dp clipped "12h public holiday" (103dp) and "7.6h annual leave"
     * (101dp) — every public holiday and most leave — and this is the only
     * place the summary names what kind of day off it was.
     */
    expect(timesheet).toContain('style={{ width: 116, textAlign: \'right\' }}');
  });

  it('keeps the status chip out of the headline row', () => {
    /*
     * 82dp of chip plus a 72dp ring left 78dp of a 320dp phone's card for a
     * line reading "of a 40 hour week", which is 101dp. So the one line saying
     * what the big number is a proportion of wrapped on every submitted week.
     * It sits with the week's other facts now, on a row that already wraps.
     */
    const head = timesheet.slice(timesheet.indexOf('<ProgressRing'), timesheet.indexOf('of a ${STANDARD_WEEK_HOURS} hour week'));
    expect(head).not.toContain('<Chip');
  });
});

/**
 * The day card's buttons, measured.
 *
 * Every number here came off the bundled Manrope 700 at the 17dp the label is
 * actually drawn in, in the width the layout actually leaves: a 360dp phone —
 * the width most Android handsets are — minus the Screen's 16dp either side
 * and the Card's 16dp either side is 296dp.
 */
describe('the day card’s actions on the phone the week is filled in on', () => {
  const PHONE = 360;
  const CARD = PHONE - 16 * 2 - 16 * 2; // Screen padding, then Card padding.
  const GAP = 8;

  /** Manrope 700 at 17dp, measured off the TTF. */
  const TEXT = {
    'Add a job': 74.9,
    'Copy previous day': 151.6,
    'Copy a day': 89.4,
    'Day off': 58.0,
    previous: 72.0,
  } as const;

  /** The block of JSX the three actions are laid out in. */
  const tileBlock = () => {
    const from = timesheet.indexOf('Two rows on purpose');
    expect(from).toBeGreaterThan(0);
    return timesheet.slice(from, from + 1200);
  };

  const sized = (label: keyof typeof TEXT) => 14 + 20 + GAP + TEXT[label] + 14;
  const filled = (label: keyof typeof TEXT) => 10 + 20 + GAP + TEXT[label] + 10;

  it('is 296dp of card on a 360dp phone', () => {
    expect(CARD).toBe(296);
  });

  it('shows why the old row could not hold two of them', () => {
    // This is the fault, as arithmetic: the two tiles sized to their own
    // labels came to more than the card had, so the second wrapped — on every
    // day of every week.
    expect(sized('Add a job') + GAP + sized('Copy previous day')).toBeGreaterThan(CARD);
  });

  it('gives the one anybody presses the whole row', () => {
    const tiles = tileBlock();
    expect(tiles).toMatch(/label="Add a job"[\s\S]{0,80}primary fill/);
  });

  it('puts the two occasional ones on a row of their own, each half', () => {
    const tiles = tileBlock();
    expect(tiles).toMatch(/flexDirection: 'row', gap: t\.space\(2\)/);
    expect(tiles).toMatch(/label="Copy a day"[\s\S]{0,80}fill/);
  });

  it('and each half holds its label without wrapping on a 360dp phone', () => {
    const half = (CARD - GAP) / 2;
    expect(filled('Copy a day')).toBeLessThanOrEqual(half);
    expect(filled('Day off')).toBeLessThanOrEqual(half);
    // The label it replaced could not, which is why it was shortened.
    expect(filled('Copy previous day')).toBeGreaterThan(half);
  });

  it('wraps rather than truncating where even a half is too narrow', () => {
    /*
     * On a 320dp phone a half is 124dp, which leaves 76dp of label — less than
     * "Copy a day" at 89.4. It wraps to two lines, which the tile has room for,
     * and the longest word still fits on one of them. An action whose words
     * are cut is an action somebody has to guess at.
     */
    const narrowHalf = (320 - 16 * 2 - 16 * 2 - GAP) / 2;
    expect(narrowHalf).toBe(124);
    expect(filled('Copy a day')).toBeGreaterThan(narrowHalf);
    // Both words of it fit on a line of their own, so the wrap is a wrap and
    // not a hyphenless break through the middle of a word.
    expect(10 + 20 + GAP + 43.0 + 10).toBeLessThanOrEqual(narrowHalf); // "Copy"
    expect(10 + 20 + GAP + 33.0 + 10).toBeLessThanOrEqual(narrowHalf); // "day"
    expect(timesheet).toContain("flexShrink: 1 }}>{label}</Txt>");
    expect(timesheet).not.toMatch(/numberOfLines=\{1\}[\s\S]{0,40}\{label\}/);
  });

  it('a filled tile is still 48dp of target', () => {
    const tile = timesheet.slice(timesheet.indexOf('function TileButton'), timesheet.indexOf('function TileButton') + 1600);
    expect(tile).toContain('minHeight: 48');
  });
});

describe('the job sheet that opens over the week', () => {
  it('sits inside the insets, like every other screen', () => {
    /*
     * presentationStyle="pageSheet" is honoured on iOS and ignored on Android,
     * where this is a full-screen modal — so "Pick a job" sat under the status
     * bar and the end of the list ran under the gesture bar. Screen does this
     * for the rest of the app; this sheet is the one view that does not go
     * through it.
     */
    const sheet = timesheet.slice(timesheet.indexOf('<Modal visible={visible}'), timesheet.indexOf('</Modal>'));
    expect(sheet).toContain('<SafeAreaView');
    expect(sheet).toMatch(/edges=\{\['top', 'bottom', 'left', 'right'\]\}/);
    expect(sheet).not.toMatch(/<Modal[\s\S]{0,400}?\n\s*<View style=\{\{ flex: 1, backgroundColor: t\.color\.bg \}\}>/);
  });

  it('takes it from the same library the rest of the app uses', () => {
    expect(timesheet).toContain("import { SafeAreaView } from 'react-native-safe-area-context';");
  });
});

/**
 * A day that is marked off and has hours on it.
 *
 * The leave and the jobs were the two arms of a ternary, so a day carrying
 * both drew the leave picker and stopped drawing the jobs. The chip above
 * still said "8 h", the workbook still printed the job and the leave, and the
 * hours were invisible on the only device that could correct them — sixteen
 * hours to payroll and a leave picker on the phone.
 *
 * Copy previous day was the way in and no longer brings leave across (see
 * timesheet.test.ts), but it was never the only one: entries are stored, they
 * come off the clock, and a sheet half-filled on another device is the case
 * this app is built around. A view that can hide hours is the fault.
 */
describe('a day the sheet says is both', () => {
  const card = () => {
    const from = timesheet.indexOf('A day that holds both is drawn as both');
    expect(from).toBeGreaterThan(0);
    return timesheet.slice(from, from + 2600);
  };

  it('does not choose between the leave and the jobs', () => {
    // Neither is inside the other's branch any more: the jobs are mapped
    // unconditionally and the leave block is its own test.
    const body = card();
    expect(body).toMatch(/\{jobs\.map\(\(e\) => \(/);
    expect(body).not.toMatch(/\) : \(\s*<>\s*\{jobs\.map/);
  });

  it('says out loud that payroll gets both, and what the day comes to', () => {
    const body = card();
    expect(body).toMatch(/leave && jobs\.length \? \(\s*<Banner/);
    expect(body).toContain('Payroll gets both');
  });

  it('shows both chips in the header rather than one standing in for the day', () => {
    const head = timesheet.slice(timesheet.indexOf('Both chips where the day carries both'), timesheet.indexOf('A day that holds both is drawn as both'));
    expect(head).toMatch(/worked > 0 \? <Chip label=\{`\$\{worked\} h`\}/);
    expect(head).toMatch(/\{leave \? <Chip label=\{LEAVE_LABEL\[leave\.kind\]\}/);
  });

  it('offers a way to take the leave off a day that was worked', () => {
    expect(card()).toContain('I worked this day — take the leave off');
  });

  it('still lets a job be added to a day that is marked off', () => {
    /*
     * Half a day's sick leave and an afternoon on site is an ordinary thing
     * and the sheet had no way to say it: the tiles were inside the else arm,
     * so a day with leave on it offered nothing but the leave picker. The Add
     * tile is unconditional now, and only the two occasional ones are gated.
     */
    const from = timesheet.indexOf('Two rows on purpose');
    const block = timesheet.slice(from, from + 1200);
    expect(block).toMatch(/<TileButton icon="plus" label="Add a job"[\s\S]{0,80}primary fill \/>/);
    // Gated, by name, so this reads as a decision rather than an accident.
    expect(block).toMatch(/\(canDuplicate \|\| !jobs\.length\) && !leave \?/);
  });
});
