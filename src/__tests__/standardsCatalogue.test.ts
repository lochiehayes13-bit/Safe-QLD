import fs from 'node:fs';
import path from 'node:path';

import { STANDARDS } from '@/domain/standardsCatalogue';
import {
  BFSR_2008,
  BFSR_CITATION,
  BFSR_DEFINITIONS,
  BFSR_REPEALED,
  BFSR_VERIFICATION,
  CLAUSE_NOTES,
  CRITICAL_DEFECT_EXAMPLES,
  CRITICAL_DEFECT_TEST,
  NOTE_SOURCES,
  bfsrDefinition,
  bfsrElement,
  bfsrSection,
  bfsrSectionSource,
  bfsrSectionStatus,
  clauseNoteConflicts,
  clauseNoteKey,
  clauseNoteSource,
  normaliseBfsrSection,
  parseClauseNoteKey,
  withClauseNotes,
} from '@/domain/standardsExtra';
import { validateMaintenanceRecord, type MaintenanceRecord } from '@/domain/qldCompliance';

/**
 * The curated half of the standards catalogue.
 *
 * The catalogue itself is a register of clause numbers read out of the
 * documents, and it is trustworthy because nothing in it was recalled. The
 * descriptions in standardsExtra are the opposite kind of artefact — they were
 * written — so they need the checking the register does not.
 *
 * Three failures matter, in this order.
 *
 * A description keyed to a clause that does not exist is invisible: it never
 * renders, nobody notices, and the clause stays blank forever. A description
 * that would overwrite one the catalogue already carries silently destroys
 * curated text. And a description that merely restates the clause title is worse
 * than no description at all, because the library then claims to explain a
 * clause it has not explained — which is exactly the confident-but-empty answer
 * this whole app exists to avoid.
 *
 * The legislation index has its own failure mode. A section number cited on a
 * record of maintenance is read by an inspector, so a wrong one is not a typo,
 * it is a false statement about the law. The section list below was transcribed
 * from the regulation's own contents pages — Queensland Crown material, which
 * may be reproduced — and every indexed section has to match it exactly. It also
 * carries the two sections that were repealed, so citing one of those fails
 * rather than passing as "not in the index yet".
 */

// ---------------------------------------------------------------------------
// The regulation's own contents, transcribed. Queensland Crown material.
// ---------------------------------------------------------------------------

/**
 * Section number to heading, taken from the contents pages of the Building Fire
 * Safety Regulation 2008. Deliberately written out here rather than derived from
 * the module under test — a test that reads its expectations from the thing it
 * is testing proves nothing.
 */
const REGULATION_CONTENTS: Record<string, string> = {
  '1': 'Short title',
  '2': 'Commencement',
  '3': 'Definitions',
  '4': 'Main objects of regulation',
  '5': 'Meaning of evacuation route',
  '6': 'Meaning of common area',
  '7': 'Person not to obstruct an evacuation route',
  '8': 'Occupier not to allow evacuation route to be obstructed',
  '9': 'Occupier not to allow final exit of adjoining building to be obstructed',
  '10': 'Meaning of locking a door',
  '11': 'General obligations about locking doors',
  '12': 'Locking doors—children in education and care service premises or child care centres or persons in custody',
  '13': 'Evacuation routes to be kept isolated',
  '14': 'Meaning of occupancy safety factors',
  '15': 'General obligation about the number of persons in a building',
  '16': 'Limits on the number of persons in a building',
  '17': 'Meaning of evacuation coordination procedures',
  '18': 'Meaning of evacuation diagram',
  '19': 'Meaning of person with special needs',
  '20': 'Application of divs 2, 3, 5 and 6',
  '21': 'General requirements',
  '22': 'Requirements for managing entities',
  '23': 'Requirements for secondary occupiers',
  '24': 'Fire and evacuation plan to include and reflect fire safety management procedure',
  '25': 'Relevant approval documents to be obtained and kept with fire and evacuation plan',
  '26': 'Accessing a fire and evacuation plan',
  '27': 'Changing a fire and evacuation plan',
  '28': 'Reviewing a fire and evacuation plan',
  '29': 'References to an evacuation sign',
  '30': 'Evacuation signs and diagrams to be displayed',
  '31': 'Prescribed time and period for prescribed persons',
  '32': 'Fire and evacuation instructions',
  '33': 'Application of div 6',
  '34': 'Appointment of fire safety advisers for high occupancy buildings',
  '35': 'General evacuation instructions',
  '36': 'General requirements',
  '37': 'Additional requirement for high occupancy buildings',
  '38': 'General requirements',
  '39': 'Requirements for instructing new persons',
  '40': 'Requirements for new occupiers',
  '41': 'Additional requirements for high occupancy buildings',
  '42': 'Compliance by occupiers of particular low occupancy buildings',
  '43': 'Evacuation practice—budget accommodation buildings',
  '44': 'Evacuation practice—other buildings',
  '45': 'Fire and evacuation instruction record',
  '46': 'Evacuation practice record',
  '47': 'Meaning of accommodation unit',
  '48': 'Signs to be displayed in accommodation units',
  '49': 'Meaning of critical defect',
  '50': 'Maintenance of prescribed fire safety installations—QDC, part MP6.1',
  '53': 'Notifying critical defects',
  '54': 'Maintenance of prescribed fire safety installations',
  '55': 'Keeping record of maintenance',
  '55A': 'Occupier statements',
  '55B': 'Record keeping requirements for occupiers of particular buildings',
  '56': 'Meaning of special fire service fee',
  '57': 'Payment of fees and costs for assessment services',
  '70': 'False or misleading documents',
  '71': 'Keeping plans and other particular documents',
  '72': 'Retention and transfer of prescribed documents',
  '74': 'Preliminary meeting fee for proposed building development application',
  '75': 'Fee for fire safety report for a building',
  '76': 'Repeal of regulations',
  '77': 'Definitions for pt 9',
  '85': 'Particular persons taken to be appropriately qualified persons',
  '86': 'Keeping former records',
};

/** Section numbers the regulation does not have. 51 and 52 were repealed. */
const NOT_IN_THE_REGULATION = ['51', '52', '99', '55C', '0'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_DIR = path.resolve(__dirname, '../../app');

/** Words that carry no meaning when comparing a description with a title. */
const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‐-―‘’“”]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Every clause in the catalogue, flattened, keeping its document. */
const allClauses = STANDARDS.flatMap((doc) => doc.clauses.map((clause) => ({ doc, clause })));

function record(over: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    installationDescription: '',
    technicianName: '',
    technicianLicenceNumber: '',
    maintenanceDate: '',
    maintenanceDescription: '',
    qdcCompliance: false,
    inProperWorkingOrder: null,
    supervisorName: 'A supervisor',
    supervisorLicenceNumber: '',
    repairsMade: [{ description: 'Replaced a detector', date: '' }],
    hardcopyLeftOnSite: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Clause notes — do they attach to anything real?
// ---------------------------------------------------------------------------

describe('every curated description attaches to a clause that exists', () => {
  it('reports no conflicts at all against the catalogue', () => {
    // The single check that matters: a note keyed to a document or clause the
    // catalogue does not have never renders, and nobody ever finds out.
    expect(clauseNoteConflicts(STANDARDS)).toEqual([]);
  });

  it('names a document the catalogue actually carries', () => {
    const docIds = new Set(STANDARDS.map((d) => d.id));
    for (const key of Object.keys(CLAUSE_NOTES)) {
      const parsed = parseClauseNoteKey(key);
      expect(parsed).toBeDefined();
      expect(docIds.has(parsed?.docId ?? '')).toBe(true);
    }
  });

  it('names a clause reference exactly as the catalogue prints it', () => {
    const refs = new Set(allClauses.map(({ doc, clause }) => clauseNoteKey(doc.id, clause.ref)));
    for (const key of Object.keys(CLAUSE_NOTES)) {
      expect(refs.has(key)).toBe(true);
    }
  });

  it("refuses to parse something that is not a key", () => {
    expect(parseClauseNoteKey('as-2419-1-2005')).toBeUndefined();
    expect(parseClauseNoteKey('|3.5')).toBeUndefined();
    expect(parseClauseNoteKey('as-2419-1-2005|')).toBeUndefined();
    expect(parseClauseNoteKey('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Clause notes — do they say anything?
// ---------------------------------------------------------------------------

describe('no description is empty or a restatement of the clause title', () => {
  it('says something substantial in every entry', () => {
    for (const [key, note] of Object.entries(CLAUSE_NOTES)) {
      // Anything shorter than a sentence is a label, and the catalogue already
      // has the label — it is called the title. The key is carried into the
      // assertion so a failure names the entry rather than a character count.
      expect({ key, tooShort: note.covers.trim().length <= 60 })
        .toEqual({ key, tooShort: false });
    }
  });

  it('never merely repeats the clause title back', () => {
    for (const { doc, clause } of allClauses) {
      const note = CLAUSE_NOTES[clauseNoteKey(doc.id, clause.ref)];
      if (!note) continue;
      const covers = normalise(note.covers);
      const title = normalise(clause.title);
      expect(covers).not.toBe(title);
      // A description that is the title plus a handful of filler words is a
      // restatement wearing a longer coat.
      expect(covers.length).toBeGreaterThan(title.length + 40);
    }
  });

  it('reads as prose rather than as a transcription', () => {
    // The standards are copyright and are never reproduced. A giveaway of
    // transcription is a clause that opens with the drafting voice, so those
    // openings are barred outright.
    const forbidden = [/^shall\b/, /^the following\b/, /^\(a\)/, /^requirements are\b/];
    for (const [key, note] of Object.entries(CLAUSE_NOTES)) {
      for (const pattern of forbidden) {
        expect({ key, matched: pattern.test(note.covers.trim().toLowerCase()) })
          .toEqual({ key, matched: false });
      }
    }
  });

  it('never repeats itself across two clauses', () => {
    // Two clauses sharing one description means at least one of them was not
    // actually read.
    const seen = new Map<string, string>();
    for (const [key, note] of Object.entries(CLAUSE_NOTES)) {
      const already = seen.get(normalise(note.covers));
      expect({ key, duplicateOf: already ?? null }).toEqual({ key, duplicateOf: null });
      seen.set(normalise(note.covers), key);
    }
  });
});

// ---------------------------------------------------------------------------
// Clause notes — sourcing
// ---------------------------------------------------------------------------

describe('every description can say where it came from', () => {
  it('has recorded provenance for the document it belongs to', () => {
    for (const key of Object.keys(CLAUSE_NOTES)) {
      const source = clauseNoteSource(key);
      expect(source).toBeDefined();
      expect(source?.source.trim()).not.toBe('');
      expect(['high', 'medium', 'low']).toContain(source?.confidence);
    }
  });

  it('lets a note say it is worth less than its document', () => {
    // AS 2293.1 clause 3.5 was read around rather than read, and says so.
    expect(clauseNoteSource('as-2293-set-2005|3.5')?.confidence).toBe('medium');
    expect(clauseNoteSource('as-2293-set-2005|2.2')?.confidence).toBe('high');
  });

  it('has no provenance entry for a document with no notes', () => {
    // A source recorded for a document nobody wrote up is a claim about work
    // that was never done.
    const documented = new Set(
      Object.keys(CLAUSE_NOTES).map((k) => parseClauseNoteKey(k)?.docId ?? ''),
    );
    for (const docId of Object.keys(NOTE_SOURCES)) {
      if (docId === 'as-1851-2012' || docId === 'qdc-mp-6-1') continue; // described in the catalogue itself
      expect({ docId, hasNotes: documented.has(docId) }).toEqual({ docId, hasNotes: true });
    }
  });

  it('says nothing rather than guessing for a key it does not have', () => {
    expect(clauseNoteSource('as-2419-1-2005|99.9')).toBeUndefined();
    expect(clauseNoteSource('not-a-document|1.1')).toBeUndefined();
    expect(clauseNoteSource('rubbish')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Clause notes — coverage
// ---------------------------------------------------------------------------

describe('the documents a technician uses most are actually covered', () => {
  const countFor = (docId: string): number =>
    Object.keys(CLAUSE_NOTES).filter((k) => parseClauseNoteKey(k)?.docId === docId).length;

  it('adds at least eighty new descriptions overall', () => {
    expect(Object.keys(CLAUSE_NOTES).length).toBeGreaterThanOrEqual(80);
  });

  it.each([
    ['as-2419-1-2005', 25],
    ['as-1670-1-2004', 25],
    ['as-1670-4-2018', 25],
    ['as-2293-set-2005', 15],
    ['as-2293-3-2005', 10],
    ['as-2444-2001', 10],
    ['as-2441-2005', 8],
    ['as-1905-1-2005', 12],
    ['as-nzs-2293-2-1995', 3],
  ])('covers %s with at least %i descriptions', (docId, minimum) => {
    expect(countFor(docId as string)).toBeGreaterThanOrEqual(minimum as number);
  });

  it('leaves the superseded AS 1670.4 editions alone rather than guessing at them', () => {
    // Their clause bodies were never read. Inventing summaries from the titles
    // is precisely the failure this module refuses.
    expect(countFor('as-1670-4-2015')).toBe(0);
    expect(countFor('as-1670-4-2004')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

describe('merging the descriptions into the catalogue', () => {
  it('fills in the clauses that had no description', () => {
    const before = STANDARDS.flatMap((d) => d.clauses).filter((c) => c.covers).length;
    const after = withClauseNotes(STANDARDS).flatMap((d) => d.clauses).filter((c) => c.covers).length;
    expect(after).toBeGreaterThan(before);
  });

  it('never overwrites a description the catalogue already carried', () => {
    const merged = withClauseNotes(STANDARDS);
    for (const doc of STANDARDS) {
      const mergedDoc = merged.find((d) => d.id === doc.id);
      expect(mergedDoc).toBeDefined();
      doc.clauses.forEach((clause, i) => {
        if (clause.covers === undefined) return;
        expect(mergedDoc?.clauses[i]?.covers).toBe(clause.covers);
      });
    }
  });

  it('does not mutate the catalogue it was given', () => {
    // The catalogue is imported as a module singleton. A merge that mutated it
    // would change what every other screen sees, once, at whatever moment this
    // module happened to be loaded.
    const snapshot = JSON.stringify(STANDARDS);
    withClauseNotes(STANDARDS);
    expect(JSON.stringify(STANDARDS)).toBe(snapshot);
  });

  it('carries the app feature across with the description', () => {
    const merged = withClauseNotes(STANDARDS);
    const hydrants = merged.find((d) => d.id === 'as-2419-1-2005');
    const commissioning = hydrants?.clauses.find((c) => c.ref === '10.3');
    expect(commissioning?.appFeature).toBe('tools/hydrant');
    expect(commissioning?.covers).toContain('most disadvantaged hydrants');
  });

  it('reports a description keyed to a clause that does not exist', () => {
    expect(clauseNoteConflicts(STANDARDS, { 'as-2419-1-2005|99.9': { covers: 'x' } }))
      .toEqual([{ key: 'as-2419-1-2005|99.9', reason: 'unknown-clause' }]);
    expect(clauseNoteConflicts(STANDARDS, { 'no-such-doc|1.1': { covers: 'x' } }))
      .toEqual([{ key: 'no-such-doc|1.1', reason: 'unknown-document' }]);
  });

  it('reports a description that would overwrite curated text', () => {
    // AS 2419.1 clause 8.4 is already described in the catalogue.
    expect(clauseNoteConflicts(STANDARDS, { 'as-2419-1-2005|8.4': { covers: 'x' } }))
      .toEqual([{ key: 'as-2419-1-2005|8.4', reason: 'already-described' }]);
  });
});

// ---------------------------------------------------------------------------
// App features
// ---------------------------------------------------------------------------

describe('every app feature a description points at is a screen that exists', () => {
  const routeExists = (feature: string): boolean =>
    fs.existsSync(path.join(APP_DIR, `${feature}.tsx`)) ||
    fs.existsSync(path.join(APP_DIR, feature, 'index.tsx')) ||
    (fs.existsSync(path.join(APP_DIR, feature)) &&
      fs.readdirSync(path.join(APP_DIR, feature)).some((f) => f.startsWith('[')));

  it('finds the app directory to check against', () => {
    // If this fails the rest of the block is vacuous, so it is asserted first.
    expect(fs.existsSync(APP_DIR)).toBe(true);
  });

  it('resolves every clause note route', () => {
    for (const [key, note] of Object.entries(CLAUSE_NOTES)) {
      if (!note.appFeature) continue;
      expect({ key, feature: note.appFeature, exists: routeExists(note.appFeature) })
        .toEqual({ key, feature: note.appFeature, exists: true });
    }
  });

  it('resolves every legislation route', () => {
    for (const section of BFSR_2008) {
      if (!section.appFeature) continue;
      expect({ section: section.section, exists: routeExists(section.appFeature) })
        .toEqual({ section: section.section, exists: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The Queensland legislation layer
// ---------------------------------------------------------------------------

describe('the legislation index cites sections that exist in the regulation', () => {
  it('matches the regulation number for number and heading for heading', () => {
    for (const section of BFSR_2008) {
      const heading = REGULATION_CONTENTS[section.section];
      expect({ section: section.section, heading: section.heading })
        .toEqual({ section: section.section, heading });
    }
  });

  it('cites no section that was repealed or never existed', () => {
    const cited = new Set(BFSR_2008.map((s) => s.section));
    for (const missing of NOT_IN_THE_REGULATION) {
      expect({ missing, cited: cited.has(missing) }).toEqual({ missing, cited: false });
    }
  });

  it('indexes the whole of Part 5, which is where the obligations are', () => {
    const partFive = BFSR_2008.filter((s) => s.part.startsWith('Part 5')).map((s) => s.section);
    expect(partFive.sort()).toEqual(['49', '50', '53', '54', '55', '55A', '55B']);
  });

  it('lists no section twice', () => {
    const numbers = BFSR_2008.map((s) => s.section);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('says what every indexed section requires', () => {
    for (const section of BFSR_2008) {
      expect(section.requires.trim().length).toBeGreaterThan(60);
      expect(section.heading.trim()).not.toBe('');
      expect(section.part.trim()).not.toBe('');
    }
  });

  it('records a source and a confidence for every section', () => {
    for (const section of BFSR_2008) {
      const source = bfsrSectionSource(section.section);
      expect(source).toBeDefined();
      expect(source?.source.toLowerCase())
        .toContain(section.verified === 'current-consolidation' ? 'current consolidation' : 'reprint 2c');
      expect(['high', 'medium', 'low']).toContain(source?.confidence);
    }
    expect(BFSR_CITATION.officialUrl).toBe(
      'https://www.legislation.qld.gov.au/view/whole/html/inforce/current/sl-2008-0160',
    );
    expect(BFSR_VERIFICATION['current-consolidation'].asAt).toBe(BFSR_CITATION.currentAsAt);
  });

  it('claims the stronger verification only where the words were checked back', () => {
    // Four sections had their operative wording quoted back from the register
    // and matched. Nothing else may claim it.
    const strong = BFSR_2008.filter((s) => s.verified === 'current-consolidation').map((s) => s.section);
    expect(strong.sort()).toEqual(['49', '53', '54', '55A']);
    for (const section of BFSR_2008) {
      if (section.verified !== 'current-consolidation') continue;
      expect(typeof section.text).toBe('string');
    }
  });
});

describe('looking a section up', () => {
  it('reads a citation however a technician types it', () => {
    expect(normaliseBfsrSection('54')).toBe('54');
    expect(normaliseBfsrSection('s54')).toBe('54');
    expect(normaliseBfsrSection('s 54')).toBe('54');
    expect(normaliseBfsrSection('s.54')).toBe('54');
    expect(normaliseBfsrSection('Section 55A')).toBe('55A');
    expect(normaliseBfsrSection(' sec 55a ')).toBe('55A');
    expect(bfsrSection('s.55A')?.heading).toBe('Occupier statements');
  });

  it('refuses anything that is not a section reference', () => {
    expect(normaliseBfsrSection('AS 1851')).toBeUndefined();
    expect(normaliseBfsrSection('')).toBeUndefined();
    expect(normaliseBfsrSection('clause 6.4.1.4')).toBeUndefined();
    expect(bfsrSection('AS 1851')).toBeUndefined();
    expect(bfsrSectionStatus('AS 1851')).toBe('not-a-section');
  });

  it('distinguishes a repealed section from one this index simply does not carry', () => {
    // Citing s.51 on a record of maintenance cites nothing at all. Citing s.26
    // cites a real section nobody has written up here. Those are different
    // answers and the app must not blur them into "unknown".
    expect(bfsrSectionStatus('49')).toBe('in-force');
    expect(bfsrSectionStatus('51')).toBe('repealed');
    expect(bfsrSectionStatus('52')).toBe('repealed');
    expect(bfsrSectionStatus('26')).toBe('not-indexed');
    expect(bfsrSection('51')).toBeUndefined();
    expect(BFSR_REPEALED['51']).toContain('Repealed');
  });
});

describe('the critical defect test', () => {
  it('keeps both limbs of section 49 and the likelihood in each', () => {
    // The regulation asks whether a defect is LIKELY to render the installation
    // inoperable, not whether it has. A technician answering the stricter
    // question under-reports, and the notice under s.53 is then never given.
    expect(CRITICAL_DEFECT_TEST.section).toBe('49');
    expect(CRITICAL_DEFECT_TEST.bothRequired).toBe(true);
    expect(CRITICAL_DEFECT_TEST.limbA.toLowerCase()).toContain('likely');
    expect(CRITICAL_DEFECT_TEST.limbA.toLowerCase()).toContain('inoperable');
    expect(CRITICAL_DEFECT_TEST.limbB.toLowerCase()).toContain('reasonably likely');
    expect(CRITICAL_DEFECT_TEST.limbB.toLowerCase()).toContain('significant adverse impact');
  });

  it('reproduces section 49 faithfully, because it is Crown material and the words decide it', () => {
    const s49 = bfsrSection('49');
    expect(s49?.text).toBe(
      'A defect in a prescribed fire safety installation for a building is a critical defect if—' +
        '(a) the defect is likely to render the installation inoperable; and ' +
        '(b) the defect is reasonably likely to have a significant adverse impact on the safety of ' +
        'occupants of part or all of the building if a fire or hazardous materials emergency happens.',
    );
  });

  it("carries the regulation's own example of what is NOT a critical defect", () => {
    // The call a technician gets wrong under time pressure: one dead
    // extinguisher out of several is expressly not critical, and writing it up
    // as one starts a 24-hour clock that was never owed.
    expect(CRITICAL_DEFECT_EXAMPLES.areNotCritical).toHaveLength(1);
    expect(CRITICAL_DEFECT_EXAMPLES.areNotCritical[0]).toContain('only 1 of several standard fire extinguishers');
    expect(CRITICAL_DEFECT_EXAMPLES.areCritical.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the deadlines the app runs clocks against', () => {
  it('runs the critical defect notice from the maintenance, not from noticing', () => {
    const s53 = bfsrSection('53');
    expect(s53?.text).toContain('within 24 hours after the person carries out the maintenance');
    expect(s53?.requires).toContain('ought reasonably to be aware');
    expect(s53?.duty).toContain('maintainer');
  });

  it('runs rectification one month from the maintenance date', () => {
    expect(bfsrElement('54', '(4)')?.requires).toContain('one month after the maintenance');
    expect(bfsrSection('54')?.text).toContain('no later than 1 month after the maintenance');
  });

  it("runs the commissioner's copy from when the statement was DUE, not when it was signed", () => {
    // The distinction the regulation draws and the app currently does not: an
    // occupier who prepares a statement late does not thereby earn a later
    // deadline for lodging it.
    const s55a = bfsrSection('55A');
    expect(s55a?.text).toContain('after the occupier is required to prepare an occupier statement');
    expect(s55a?.elements?.map((e) => e.para)).toEqual(['(1)', '(2)', '(3)']);
    expect(bfsrElement('55A', '(2)')?.requires).toContain('two years');
  });

  it('returns nothing for an element that does not exist', () => {
    expect(bfsrElement('55A', '(9)')).toBeUndefined();
    expect(bfsrElement('51', '(1)')).toBeUndefined();
    expect(bfsrElement('AS 1851', '(1)')).toBeUndefined();
  });
});

describe('the record of maintenance field list', () => {
  it('carries every paragraph of section 55 that a record has to satisfy', () => {
    const paragraphs = bfsrSection('55')?.elements?.map((e) => e.para) ?? [];
    expect(paragraphs).toEqual([
      '(2)(a)', '(2)(b)', '(2)(c)', '(2)(d)', '(2)(e)', '(2)(f)', '(2)(g)',
      '(2)(g)(i)', '(2)(g)(ii)', '(2)(g)(iii)', '(3)(a)', '(3)(b)',
    ]);
  });

  it('includes the critical defect notice that has to be attached to the record', () => {
    // s55(3)(b) is the element a service report most often misses, because the
    // notice lives in a different folder from the test results.
    expect(bfsrElement('55', '(3)(b)')?.requires).toContain('critical defect notice');
  });

  it('resolves every statutory reference the compliance checker emits', () => {
    // A cross-check rather than a restatement: whatever qldCompliance tells a
    // technician to fix, it cites a section and paragraph. Every one of those
    // citations has to land on something real in this index, or the app is
    // pointing an inspector at a provision that does not say what it claims.
    const issues = validateMaintenanceRecord(record());
    expect(issues.length).toBeGreaterThan(0);

    for (const issue of issues) {
      const match = /^s(\d+[A-Za-z]?)(\(.*\))$/.exec(issue.legalRef);
      if (!match) {
        // Non-statutory references are allowed, but only to a standard.
        expect(issue.legalRef).toMatch(/^AS /);
        continue;
      }
      const [, section, para] = match;
      expect({ ref: issue.legalRef, status: bfsrSectionStatus(section ?? '') })
        .toEqual({ ref: issue.legalRef, status: 'in-force' });
      expect({ ref: issue.legalRef, element: bfsrElement(section ?? '', para ?? '')?.para })
        .toEqual({ ref: issue.legalRef, element: para });
    }
  });
});

describe('the dictionary entries that decide arguments on site', () => {
  it('says what an appropriately qualified person is, including the scope-of-work limb', () => {
    const entry = bfsrDefinition('appropriately qualified person');
    expect(entry?.source).toBe('schedule 3');
    expect(entry?.meaning).toContain('scope of work');
    expect(entry?.note).toContain('not enough');
  });

  it('anchors maintenance to the original performance level', () => {
    // The reason a missing baseline is a compliance problem rather than a
    // filing one: without it there is no benchmark to maintain against.
    expect(bfsrDefinition('maintenance')?.meaning).toContain('original performance level');
    expect(bfsrDefinition('maintenance')?.note).toContain('baseline');
  });

  it('is case and whitespace forgiving, and refuses a term it does not have', () => {
    expect(bfsrDefinition('  Maintenance ')?.term).toBe('maintenance');
    expect(bfsrDefinition('critical defect')).toBeUndefined();
    expect(bfsrDefinition('')).toBeUndefined();
  });

  it('states every indexed term without leaving one blank', () => {
    for (const entry of BFSR_DEFINITIONS) {
      expect(entry.term).toBe(entry.term.toLowerCase());
      expect(entry.meaning.trim().length).toBeGreaterThan(40);
      expect(entry.source.trim()).not.toBe('');
    }
  });
});
