import { STANDARDS } from '@/domain/standardsCatalogue';
import { CLAUSE_NOTES, clauseNoteKey } from '@/domain/standardsExtra';
import {
  EXPLAINED_CLAUSES, LIBRARY, TOTAL_CLAUSES, bestExplained, clauseProvenance, libraryDoc,
} from '@/domain/standardsLibrary';

/**
 * The register and the explanations, joined in one place.
 *
 * Two different kinds of artefact. The register was read out of the documents
 * and is trustworthy because nobody wrote it; the explanations were written, and
 * a written thing has to say so. The whole point of doing the merge here rather
 * than in each screen is that "how many clauses say what they are for" is a
 * number the library prints on its own front page, and two screens computing it
 * differently would give two answers.
 */

describe('the merged library', () => {
  it('carries every document the register does, and no extra', () => {
    expect(LIBRARY.map((d) => d.id).sort()).toEqual(STANDARDS.map((d) => d.id).sort());
  });

  it('changes no clause number or title, because those came from the document', () => {
    for (const doc of LIBRARY) {
      const source = STANDARDS.find((d) => d.id === doc.id)!;
      expect(doc.clauses.map((c) => `${c.ref}|${c.title}`))
        .toEqual(source.clauses.map((c) => `${c.ref}|${c.title}`));
    }
  });

  it('explains far more clauses than the register alone did', () => {
    /*
     * The reason this module exists. The notes were written and merged by a
     * function nothing called, so the app showed the register's handful and the
     * other two hundred were invisible.
     */
    const registerOnly = STANDARDS.reduce(
      (n, d) => n + d.clauses.filter((c) => c.covers).length, 0,
    );
    expect(EXPLAINED_CLAUSES).toBeGreaterThan(registerOnly * 3);
  });

  it('counts clauses the same way the front page prints them', () => {
    expect(TOTAL_CLAUSES).toBe(LIBRARY.reduce((n, d) => n + d.clauses.length, 0));
    expect(EXPLAINED_CLAUSES).toBe(
      LIBRARY.reduce((n, d) => n + d.clauses.filter((c) => c.covers).length, 0),
    );
  });

  it('lets the register win where both have something to say', () => {
    // The extraction read the document; the note is a person reading it.
    const clash = STANDARDS.flatMap((doc) =>
      doc.clauses
        .filter((c) => c.covers && CLAUSE_NOTES[clauseNoteKey(doc.id, c.ref)])
        .map((c) => ({ doc: doc.id, ref: c.ref, original: c.covers })));

    for (const c of clash) {
      const merged = libraryDoc(c.doc)!.clauses.find((x) => x.ref === c.ref)!;
      expect(merged.covers).toBe(c.original);
    }
  });

  it('finds a document by id and nothing by a made-up one', () => {
    expect(libraryDoc('as-2419-1-2005')?.designation).toBe('AS 2419.1:2005');
    expect(libraryDoc('as-9999-1-2099')).toBeUndefined();
  });
});

describe('clauseProvenance', () => {
  const doc = () => libraryDoc('as-2419-1-2005')!;

  it('says nothing for a clause nobody has written up', () => {
    /*
     * The honest answer. An empty confidence badge on an unexplained clause
     * reads as low confidence in something, when in fact there is nothing there
     * to have confidence in.
     */
    const bare = doc().clauses.find((c) => !c.covers);
    if (bare) expect(clauseProvenance(doc().id, bare)).toBeUndefined();
  });

  it('marks a written explanation as ours, with where the reading came from', () => {
    const explained = doc().clauses.find((c) => CLAUSE_NOTES[clauseNoteKey(doc().id, c.ref)])!;
    const p = clauseProvenance(doc().id, explained)!;
    expect(p.fromExtraction).toBe(false);
    expect(p.source).toMatch(/AS 2419\.1/);
    expect(['high', 'medium', 'low']).toContain(p.confidence);
  });

  it('never claims more for a note than the note claims for itself', () => {
    /*
     * A per-note confidence is set only where the note is worth less than its
     * document's default — a clause read around rather than read, because the
     * extracted text lost a figure the clause turns on. Taking the document
     * default there would overstate it.
     */
    const rank = { low: 0, medium: 1, high: 2 };
    for (const d of LIBRARY) {
      for (const clause of d.clauses) {
        const note = CLAUSE_NOTES[clauseNoteKey(d.id, clause.ref)];
        if (!note?.confidence) continue;
        const p = clauseProvenance(d.id, clause);
        if (!p || p.fromExtraction) continue;
        expect(rank[p.confidence]).toBeLessThanOrEqual(rank[note.confidence]);
      }
    }
  });

  it('gives every explanation a source sentence somebody can weigh', () => {
    const thin = LIBRARY.flatMap((d) =>
      d.clauses
        .map((c) => ({ d, c, p: clauseProvenance(d.id, c) }))
        .filter((x) => x.p && x.p.source.trim().length < 30)
        .map((x) => `${x.d.designation} ${x.c.ref}`));
    expect(thin).toEqual([]);
  });
});

describe('bestExplained', () => {
  it('ranks by how much has been written up, most first', () => {
    const top = bestExplained(5);
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1]!.explained).toBeGreaterThanOrEqual(top[i]!.explained);
    }
  });

  it('never lists a document with nothing written up', () => {
    expect(bestExplained(50).every((d) => d.explained > 0)).toBe(true);
  });

  it('honours the limit it was given', () => {
    expect(bestExplained(3)).toHaveLength(3);
  });
});
