import { STANDARDS, type StandardClause, type StandardDoc } from '@/domain/standardsCatalogue';
import {
  CLAUSE_NOTES, clauseNoteKey, clauseNoteSource, withClauseNotes,
  type NoteConfidence, type NoteProvenance,
} from '@/domain/standardsExtra';

/**
 * The catalogue as a technician should see it: register plus explanations.
 *
 * These are two different kinds of artefact and the split is deliberate.
 *
 * `standardsCatalogue` is a register — clause numbers and titles read out of the
 * documents themselves, nothing recalled. It is trustworthy precisely because
 * nobody wrote it.
 *
 * `standardsExtra` is the opposite: two hundred and thirty-odd descriptions of
 * what each clause is FOR, written in Safe QLD's own words because a clause
 * number with no explanation tells a technician in a plant room nothing about
 * whether it is the clause they want. Written means fallible, so each carries
 * where the reading came from and what it is worth.
 *
 * Merging them anywhere but here would mean two screens doing it differently,
 * and the number of clauses that carry an explanation is a figure the library
 * prints on its own front page. Two answers to that would be one too many.
 *
 * The register wins on conflict. Where a clause already carries a description
 * from the extraction, the curated note does not overwrite it — the extraction
 * came from the document and the note came from a person reading it.
 */

/** Every document, with the curated descriptions merged in. */
export const LIBRARY: StandardDoc[] = withClauseNotes(STANDARDS);

/** How many clauses now say what they are for, across the whole library. */
export const EXPLAINED_CLAUSES = LIBRARY.reduce(
  (n, doc) => n + doc.clauses.filter((c) => c.covers).length,
  0,
);

export const TOTAL_CLAUSES = LIBRARY.reduce((n, doc) => n + doc.clauses.length, 0);

export function libraryDoc(id: string): StandardDoc | undefined {
  return LIBRARY.find((d) => d.id === id);
}

export interface ClauseProvenance {
  /** Where the description came from, in a sentence. */
  source: string;
  confidence: NoteConfidence;
  /** True where the description was read out of the document by the extraction. */
  fromExtraction: boolean;
}

/**
 * Where one clause's description came from, and what it is worth.
 *
 * Returns nothing for a clause with no description, which is the honest answer
 * — the library says "nobody has written up what this covers" rather than
 * showing an empty confidence badge that reads as low confidence.
 *
 * A per-note confidence overrides the document's. It is set only where a note
 * is worth less than its document's default: a clause read around rather than
 * read, usually because the extracted text lost a figure or a table the clause
 * turns on. Taking the document default in that case would overstate it.
 */
export function clauseProvenance(docId: string, clause: StandardClause): ClauseProvenance | undefined {
  if (!clause.covers) return undefined;

  const key = clauseNoteKey(docId, clause.ref);
  const note = CLAUSE_NOTES[key];
  const docSource: NoteProvenance | undefined = clauseNoteSource(key);

  if (!note || !docSource) {
    return {
      source: 'Read from the document during extraction, alongside the clause number and title.',
      confidence: 'high',
      fromExtraction: true,
    };
  }

  return {
    source: docSource.source,
    confidence: note.confidence ?? docSource.confidence,
    fromExtraction: false,
  };
}

/** Documents that carry at least one written explanation, most-explained first. */
export function bestExplained(limit = 5): { doc: StandardDoc; explained: number }[] {
  return LIBRARY
    .map((doc) => ({ doc, explained: doc.clauses.filter((c) => c.covers).length }))
    .filter((d) => d.explained > 0)
    .sort((a, b) => b.explained - a.explained)
    .slice(0, limit);
}
