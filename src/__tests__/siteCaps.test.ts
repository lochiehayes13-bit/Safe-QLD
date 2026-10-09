/**
 * No site list is cut without saying so, and the cuts are not absurd.
 *
 * The other half of "every site appears in every module". A screen can hold
 * every site, search every column of every one of them, and still lose the
 * building a technician wants — by drawing the first four matches and saying
 * nothing. Three of this company's sites are called "Fictional Storage - Sumner
 * Park"; a client with eleven buildings typing their name into a box that
 * offers four of them, with no line to say so, is told the other seven do not
 * exist. That is the same fault as having no search at all, dressed as a
 * result.
 *
 * So every screen that cuts a site list has to do two things: cut at a number
 * that is above what a real search returns, and say so on screen when it bites.
 * These are read off the source text because the screens are components and
 * the suite's react-native mock cannot load one — the house pattern, see
 * timesheetLayout.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

/**
 * The screens that cut a site list, the constant each cuts at, and the words
 * it must show when it does.
 *
 * Listed by hand rather than swept for, because the thing being asserted is
 * that each one discloses its own cut — a sweep that found the caps would
 * still have to be told what counts as disclosing them.
 */
const CAPPED = [
  {
    file: 'src/components/SitePicker.tsx',
    what: 'the shared site picker',
    constant: /const PICKER_MATCHES = (\d+);/,
    least: 50,
    discloses: /matches\.length === PICKER_MATCHES/,
    says: /First \{PICKER_MATCHES\} matches/,
  },
  {
    file: 'app/work/needs.tsx',
    what: 'the “which site?” chips on the needs list',
    constant: /const SITE_SUGGESTIONS = (\d+);/,
    least: 6,
    discloses: /siteMatches > sites\.length/,
    says: /of \{siteMatches\.toLocaleString\(\)\} matches/,
  },
  {
    file: 'app/(tabs)/sites.tsx',
    what: 'the sites tab',
    constant: /const PAGE = (\d+);/,
    least: 100,
    discloses: /page\.capped/,
    says: /First \{PAGE\} of/,
  },
] as const;

describe.each(CAPPED)('$what', ({ file, constant, least, discloses, says }) => {
  const source = read(file);

  it('cuts at a number above what a real search returns', () => {
    const found = source.match(constant);
    expect(found).toBeTruthy();
    expect(Number(found![1])).toBeGreaterThanOrEqual(least);
  });

  it('knows when its own cut bit', () => {
    expect(source).toMatch(discloses);
  });

  it('says so on screen rather than cutting silently', () => {
    expect(source).toMatch(says);
  });
});

describe('a cut list has somewhere to send you for the rest', () => {
  it('the global search hands the words to the sites tab', () => {
    /*
     * The search screen shows the first eight sites of however many matched
     * and said "More may match. Add a word." — true, and nowhere to go. The
     * Sites tab draws three hundred of the same search, so the words go across
     * rather than being typed again.
     */
    const search = read('app/search.tsx');
    expect(search).toContain("group.kind === 'site'");
    expect(search).toMatch(/pathname: '\/\(tabs\)\/sites', params: \{ q: term \}/);
  });

  it('and the sites tab opens on them', () => {
    const sites = read('app/(tabs)/sites.tsx');
    expect(sites).toMatch(/useLocalSearchParams<\{ q\?: string \}>/);
    // Both the box and the query, or the tab opens on a search nobody ran.
    expect(sites).toMatch(/useState\(arrived\)[\s\S]{0,80}useState\(arrived\)/);
  });
});
