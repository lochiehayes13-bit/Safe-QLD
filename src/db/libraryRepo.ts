import { getDb, inTransaction, newId, nowIso } from '@/db';
import { readPdf, isPdf, PdfError } from '@/parsers/pdfText';
import { searchPages, type PageHit, type SearchablePage } from '@/domain/docSearch';

/**
 * The technician's own document library.
 *
 * Import a PDF they already own, extract its text on the device, and make it
 * searchable offline. Nothing is uploaded, nothing is shared, and the original
 * file is left where it was — the app keeps only the text it read.
 *
 * A publisher-encrypted document is refused with its reason rather than stored
 * empty. Every Australian Standard is published that way, so this is the common
 * case and it has to read as a clear answer rather than a failure.
 */

export interface LibraryDoc {
  id: string;
  title: string;
  fileName: string;
  sourceNote?: string;
  /** Catalogue entry this is a copy of, where one matches. */
  standardId?: string;
  pageCount: number;
  wordCount: number;
  warnings: string[];
  importedAt: string;
  updatedAt: string;
}

interface DocRow {
  id: string; title: string; fileName: string; sourceNote: string | null;
  standardId: string | null; pageCount: number; wordCount: number;
  warnings: string; importedAt: string; updatedAt: string;
}

const toDoc = (r: DocRow): LibraryDoc => ({
  id: r.id,
  title: r.title,
  fileName: r.fileName,
  sourceNote: r.sourceNote ?? undefined,
  standardId: r.standardId ?? undefined,
  pageCount: r.pageCount,
  wordCount: r.wordCount,
  warnings: r.warnings ? r.warnings.split('\n').filter(Boolean) : [],
  importedAt: r.importedAt,
  updatedAt: r.updatedAt,
});

export interface ImportResult {
  doc?: LibraryDoc;
  /** Why nothing was imported, in words a technician can act on. */
  refused?: string;
}

/**
 * Reads a PDF and stores its text.
 *
 * The whole document is written in one transaction so a failure part-way
 * through cannot leave half a standard in the library, which would search as
 * though the rest of it said nothing.
 */
export async function importPdf(input: {
  bytes: Uint8Array;
  fileName: string;
  title?: string;
  standardId?: string;
  sourceNote?: string;
  maxPages?: number;
}): Promise<ImportResult> {
  if (!isPdf(input.bytes)) {
    return { refused: 'That file is not a PDF. Only PDFs can be read into the library.' };
  }

  let parsed;
  try {
    parsed = readPdf(input.bytes, { maxPages: input.maxPages ?? 400 });
  } catch (e) {
    return { refused: e instanceof PdfError ? e.message : `Could not read that PDF. ${String(e)}` };
  }

  if (!parsed.pages.length) {
    return {
      refused: parsed.warnings[0]
        ?? 'No readable text in that PDF, so there would be nothing to search.',
    };
  }

  const at = nowIso();
  const doc: LibraryDoc = {
    id: newId(),
    title: input.title?.trim() || parsed.info.Title?.trim() || input.fileName.replace(/\.pdf$/i, ''),
    fileName: input.fileName,
    sourceNote: input.sourceNote,
    standardId: input.standardId,
    pageCount: parsed.pages.length,
    wordCount: parsed.text.split(/\s+/).filter(Boolean).length,
    warnings: parsed.warnings,
    importedAt: at,
    updatedAt: at,
  };

  const db = await getDb();
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO library_doc
         (id, title, fileName, sourceNote, standardId, pageCount, wordCount, warnings, importedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.id, doc.title, doc.fileName, doc.sourceNote ?? null, doc.standardId ?? null,
        doc.pageCount, doc.wordCount, doc.warnings.join('\n'), doc.importedAt, doc.updatedAt,
      ],
    );
    for (const p of parsed.pages) {
      if (!p.text) continue;
      await db.runAsync(
        'INSERT INTO library_page (id, docId, page, text) VALUES (?, ?, ?, ?)',
        [newId(), doc.id, p.number, p.text],
      );
    }
  });

  return { doc };
}

export async function listLibraryDocs(): Promise<LibraryDoc[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DocRow>('SELECT * FROM library_doc ORDER BY title');
  return rows.map(toDoc);
}

export async function getLibraryDoc(id: string): Promise<LibraryDoc | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DocRow>('SELECT * FROM library_doc WHERE id = ?', [id]);
  return row ? toDoc(row) : null;
}

export async function deleteLibraryDoc(id: string): Promise<void> {
  const db = await getDb();
  // Pages cascade, but the pragma is not on by default in every build.
  await db.runAsync('DELETE FROM library_page WHERE docId = ?', [id]);
  await db.runAsync('DELETE FROM library_doc WHERE id = ?', [id]);
}

/**
 * Searches every imported document.
 *
 * SQL narrows the candidates on the longest typed word — cheap, and it keeps a
 * thousand pages out of memory — and the ranking then happens in the pure
 * module, where it is tested. Where the query has no word long enough to
 * narrow on, every page is scanned rather than none.
 */
export async function searchLibrary(query: string, limit = 30): Promise<PageHit[]> {
  const db = await getDb();
  const longest = (query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .sort((a, b) => b.length - a.length)[0];

  const rows = longest
    ? await db.getAllAsync<{ docId: string; title: string; page: number; text: string }>(
      `SELECT p.docId AS docId, d.title AS title, p.page AS page, p.text AS text
       FROM library_page p JOIN library_doc d ON d.id = p.docId
       WHERE p.text LIKE ? COLLATE NOCASE LIMIT 4000`,
      [`%${longest}%`],
    )
    : await db.getAllAsync<{ docId: string; title: string; page: number; text: string }>(
      `SELECT p.docId AS docId, d.title AS title, p.page AS page, p.text AS text
       FROM library_page p JOIN library_doc d ON d.id = p.docId LIMIT 4000`,
    );

  const pages: SearchablePage[] = rows.map((r) => ({
    docId: r.docId, docTitle: r.title, page: r.page, text: r.text,
  }));
  return searchPages(pages, query, { limit });
}

export async function libraryPage(docId: string, page: number): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ text: string }>(
    'SELECT text FROM library_page WHERE docId = ? AND page = ?', [docId, page],
  );
  return row?.text;
}
