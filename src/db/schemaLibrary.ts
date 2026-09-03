/**
 * v11 — documents the technician imported themselves.
 *
 * The clause index that ships with the app says which clause covers a subject.
 * This holds the other half: the actual pages of a document the technician
 * already owns, extracted on the device so they can be searched in a plant room
 * with no signal.
 *
 * Pages are stored separately rather than as one blob per document because a
 * search result has to cite a page. "It is in AS 2441 somewhere" is not an
 * answer anybody can act on.
 *
 * The original file is not stored here. It stays where the technician put it —
 * the app holds the text it extracted and a note of where the file came from,
 * which keeps a 12 MB standard out of the app's own database.
 */
export const MIGRATION_V11 = `
CREATE TABLE IF NOT EXISTS library_doc (
  id            TEXT PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  /* The filename as imported, so a technician recognises their own document. */
  fileName      TEXT NOT NULL DEFAULT '',
  /* Where it came from, for their own reference. Never a URL we fetch. */
  sourceNote    TEXT,
  /* Links the import to a catalogue entry where one matches, so a clause
     reference can open the page in the technician's own copy. */
  standardId    TEXT,
  pageCount     INTEGER NOT NULL DEFAULT 0,
  /* Words extracted. Zero means a scan, which is recorded rather than hidden. */
  wordCount     INTEGER NOT NULL DEFAULT 0,
  /* What the reader could not do, kept so the library can show it later. */
  warnings      TEXT NOT NULL DEFAULT '',
  importedAt    TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_doc_standard ON library_doc(standardId);

CREATE TABLE IF NOT EXISTS library_page (
  id            TEXT PRIMARY KEY NOT NULL,
  docId         TEXT NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL,
  text          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_page_doc ON library_page(docId, page);
`;
