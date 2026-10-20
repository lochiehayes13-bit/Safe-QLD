import {
  PAGE_THRESHOLD, checkSearchText, defectSearchText, filterByWords, findRoutines, hasEveryWord,
  markUp, searchPages, type SearchablePage,
} from '@/domain/docSearch';
import { DEFECT_LIBRARY } from '@/seed/defectLibrary';
import { SERVICE_ROUTINES } from '@/seed/serviceRoutines';

/**
 * Searching a technician's own imported documents.
 *
 * A hit with no context is a page number, and nobody walks back to the ute to
 * check a page number. So the snippet is tested as hard as the ranking, and so
 * is the refusal: a page that merely happens to contain a common word is not an
 * answer, and returning it as one teaches a technician to stop reading results.
 */

const page = (n: number, text: string, docId = 'mp61'): SearchablePage => ({
  docId,
  docTitle: 'QDC MP 6.1',
  page: n,
  text,
});

const PAGES: SearchablePage[] = [
  page(1, 'Purpose. To set appropriate performance standards for maintenance of fire safety '
    + 'installations for the safe occupation of buildings and specify the maintenance records required.'),
  page(2, 'Critical defect means a defect in a prescribed fire safety installation for a building '
    + 'where the defect is likely to render the installation inoperable and is reasonably likely to '
    + 'have a significant adverse impact on the safety of occupants.'),
  page(3, 'The occupier must give the commissioner a copy of the statement within 10 business days. '
    + 'The latest version of the form is available from the department.'),
  page(4, 'Detector spacing from walls and partitions shall be measured horizontally. Spacing from '
    + 'air supply openings is measured to the nearest edge of the opening.', 'as1670'),
];

describe('searchPages', () => {
  it('finds the page and shows enough of it to read', () => {
    const [hit] = searchPages(PAGES, 'critical defect');
    expect(hit!.page).toBe(2);
    expect(hit!.snippet).toContain('Critical defect means');
    expect(hit!.snippet.length).toBeGreaterThan(60);
  });

  it('reaches a page through the words the technician did not type', () => {
    // "how far off the wall" never appears; "spacing from walls" does.
    const [hit] = searchPages(PAGES, 'how far off the wall can a detector go');
    expect(hit!.page).toBe(4);
    expect(hit!.snippet.toLowerCase()).toContain('spacing');
  });

  it('ranks a phrase above the same words scattered', () => {
    const hits = searchPages(PAGES, 'fire safety installation');
    // Page 2 has the exact phrase; page 1 has the words spread across a sentence.
    expect(hits[0]!.page).toBe(2);
  });

  it('does not light up inside a longer word', () => {
    /*
     * Page 3 says "the latest version". A search for "test" that matches inside
     * "latest" returns every page of any document with that in its footer, and
     * a technician stops reading results altogether.
     */
    const hits = searchPages(PAGES, 'test');
    expect(hits.map((h) => h.page)).not.toContain(3);
  });

  it('restricts to one document when asked', () => {
    const hits = searchPages(PAGES, 'spacing', { docId: 'mp61' });
    expect(hits).toEqual([]);
    expect(searchPages(PAGES, 'spacing', { docId: 'as1670' }).length).toBe(1);
  });

  it('says nothing rather than returning a coincidence', () => {
    expect(searchPages(PAGES, 'helicopter')).toEqual([]);
    expect(searchPages(PAGES, 'x')).toEqual([]);
    expect(searchPages([], 'critical defect')).toEqual([]);
  });

  it('reports which terms actually matched, so a result can be judged', () => {
    const [hit] = searchPages(PAGES, 'commissioner statement');
    expect(hit!.matched).toContain('commissioner');
    expect(hit!.matched).toContain('statement');
  });

  it('scores every returned hit above the threshold', () => {
    for (const h of searchPages(PAGES, 'maintenance records')) {
      expect(h.score).toBeGreaterThanOrEqual(PAGE_THRESHOLD);
    }
  });

  it('counts repeats with diminishing returns rather than letting one page run away', () => {
    const repeated = page(9, `${'spacing '.repeat(40)}`, 'x');
    const once = page(10, 'spacing from walls and partitions', 'x');
    const hits = searchPages([repeated, once], 'spacing');
    // The repeated page wins, but not by fortyfold.
    expect(hits[0]!.page).toBe(9);
    expect(hits[0]!.score).toBeLessThan(hits[1]!.score * 4);
  });
});

describe('markUp', () => {
  it('marks each term where it appears', () => {
    const marks = markUp('spacing from walls and partitions', ['spacing', 'walls']);
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ from: 0, to: 7 });
  });

  it('merges overlapping marks, which would otherwise render nested', () => {
    const marks = markUp('maintenance', ['maintenance', 'mainten']);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toEqual({ from: 0, to: 11 });
  });

  it('ignores terms too short to be worth marking', () => {
    expect(markUp('a b c spacing', ['a', 'b'])).toEqual([]);
  });
});

describe('hasEveryWord', () => {
  it('finds the words in any order', () => {
    expect(hasEveryWord('Detector head missing from base', 'missing detector')).toBe(true);
    expect(hasEveryWord('Detector head missing from base', 'detector missing')).toBe(true);
  });

  it('needs every word, not just one', () => {
    expect(hasEveryWord('Detector head missing from base', 'detector painted')).toBe(false);
  });

  it('narrows on a half-typed word', () => {
    expect(hasEveryWord('Contaminated detector', 'contam det')).toBe(true);
  });

  it('matches everything on an empty search', () => {
    expect(hasEveryWord('anything at all', '   ')).toBe(true);
  });
});

describe('searching the defect wording', () => {
  it('finds a defect whatever order the words are typed in', () => {
    const forward = filterByWords(DEFECT_LIBRARY, 'detector missing', defectSearchText).map((d) => d.code);
    const reversed = filterByWords(DEFECT_LIBRARY, 'missing detector', defectSearchText).map((d) => d.code);
    expect(forward).toContain('DET-DET-003');
    expect(reversed).toEqual(forward);
  });

  it('finds a defect by its code', () => {
    const found = filterByWords(DEFECT_LIBRARY, 'DET-DET-003', defectSearchText);
    expect(found.map((d) => d.code)).toEqual(['DET-DET-003']);
  });

  it('finds a defect by the name of its system', () => {
    const found = filterByWords(DEFECT_LIBRARY, 'detection contaminated', defectSearchText);
    expect(found.map((d) => d.code)).toContain('DET-DET-002');
  });

  it('keeps the library order and returns everything on an empty search', () => {
    expect(filterByWords(DEFECT_LIBRARY, '', defectSearchText)).toEqual(DEFECT_LIBRARY);
  });
});

describe('searching the service routines', () => {
  it('shows every check of a routine found by its name', () => {
    const [hit] = findRoutines(SERVICE_ROUTINES, 'detection monthly');
    expect(hit?.routine.id).toBe('det-monthly');
    expect(hit?.checks).toEqual(hit?.routine.tests);
  });

  it('shows only the matching checks of a routine found through them', () => {
    // "battery" is in one check of the monthly detection routine, not in its name.
    const hit = findRoutines(SERVICE_ROUTINES, 'detection monthly battery')[0]!;
    expect(hit.routine.id).toBe('det-monthly');
    expect(hit.checks.map((c) => c.id)).toEqual(['det-m-04']);
    expect(hit.checks.length).toBeLessThan(hit.routine.tests.length);
  });

  it('shows a routine whole when the words are spread over several checks', () => {
    const routine = SERVICE_ROUTINES.find((r) => r.id === 'det-monthly')!;
    const hit = findRoutines([routine], 'battery zone chart')[0]!;
    expect(hit.checks).toEqual(routine.tests);
    expect(routine.tests.some((c) => hasEveryWord(checkSearchText(c), 'battery zone chart'))).toBe(false);
  });

  it('finds nothing for words no routine holds', () => {
    expect(findRoutines(SERVICE_ROUTINES, 'zzqx nonsense')).toEqual([]);
  });

  it('lists every routine whole on an empty search', () => {
    const all = findRoutines(SERVICE_ROUTINES, '');
    expect(all.map((r) => r.routine.id)).toEqual(SERVICE_ROUTINES.map((r) => r.id));
    for (const r of all) expect(r.checks).toEqual(r.routine.tests);
  });
});
