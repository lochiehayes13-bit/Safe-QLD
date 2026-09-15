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

/**
 * Which part of a document a clause sits in, in one line.
 *
 * A search returns eight cards from six standards and they all read alike: a
 * clause number, a heading and a paragraph. Deciding which one is worth
 * opening means knowing what part of the document it came out of — "5.1.7" in
 * the smoke detector section is a different kind of answer from "5.1.7" in the
 * commissioning appendix, and nothing on the card said which.
 *
 * So each answer carries the section above it. The words are the catalogue's
 * own: the section heading is read out of the document like every other
 * heading, and where somebody has written up what that section is for, its
 * first sentence goes on the end. Nothing here is composed or summarised — a
 * line invented to describe a standard is the one thing this library will not
 * do.
 *
 * Returns nothing for a clause that IS a section, which needs no line saying
 * it is itself, and for a document with no sections listed.
 */

/** Longer than this and it is a paragraph, not a line under a card. */
const SECTION_LINE_LIMIT = 120;

/**
 * The heading a reference belongs under, as the catalogue spells it.
 *
 * Three shapes, because the documents use three. "5.1.7" and "Table 13.2.1"
 * belong to a numbered section; "A.4" and "Table K.1" to a lettered appendix.
 * A reference that is already a heading belongs to nothing.
 */
export function sectionRefFor(ref: string): string | null {
  const trimmed = ref.trim();
  if (/^(SECTION|Appendix|Part|Schedule)\b/i.test(trimmed)) return null;

  const numbered = /^(?:Table|Figure|Form)?\s*(\d+)\./i.exec(trimmed);
  if (numbered) return `SECTION ${numbered[1]}`;

  const lettered = /^(?:Table|Figure|Form)?\s*([A-Z])\./.exec(trimmed);
  if (lettered) return `Appendix ${lettered[1]}`;

  return null;
}

/** The first sentence of a description, or the whole of it where it is one. */
function firstSentence(text: string): string {
  const stop = /[.!?](?:\s|$)/.exec(text);
  return stop ? text.slice(0, stop.index + 1).trim() : text.trim();
}

export function sectionLine(doc: StandardDoc, clause: StandardClause): string | undefined {
  const sectionRef = sectionRefFor(clause.ref);
  if (!sectionRef) return undefined;

  const section = doc.clauses.find((c) => c.ref.toLowerCase() === sectionRef.toLowerCase());
  if (!section) return undefined;

  // "SECTION 5" shouts on a card under a heading that does not. The number is
  // the useful half; the document prints the word in capitals and we do not
  // have to.
  const head = sectionRef.replace(/^SECTION\s+/i, 'Section ');
  const named = `${head} · ${section.title}`;

  if (!section.covers) return named;
  const gist = firstSentence(section.covers);
  const full = `${named} — ${gist}`;
  return full.length <= SECTION_LINE_LIMIT ? full : named;
}
