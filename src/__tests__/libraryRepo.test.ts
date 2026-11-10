import {
  deleteLibraryDoc, getLibraryDoc, importPdf, libraryPage, listLibraryDocs, searchLibrary, webPickedBytes,
} from '@/db/libraryRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The technician's own imported documents, written and read back.
 *
 * An imported document opens on its own page and is searched on its own, so
 * the search has to keep to the one document it was asked about. And the web
 * build, which is how the app reaches an iPhone, has to be able to read the
 * picked file at all.
 */

/** Pads a line out to a real page's length, so the scan check is not tripped. */
function pageBody(line: string): string {
  const filler = 'the installation shall be inspected and the result recorded against the asset ';
  return `${line} ${filler.repeat(4)}`;
}

/** A small text PDF built here, so no real document is needed. */
function buildPdf(pageTexts: string[], title?: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const contentIds: number[] = [];
  for (const text of pageTexts) {
    const stream = `BT /F1 12 Tf 72 720 Td (${pageBody(text)}) Tj ET`;
    contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
  }
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objects.length + pageTexts.length + 1;
  const pageIds = pageTexts.map((_, i) => add(
    `<< /Type /Page /Parent ${pagesId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> `
    + `/Contents ${contentIds[i]} 0 R >>`,
  ));
  add(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  if (title) add(`<< /Title (${title}) >>`);
  let out = '%PDF-1.4\n';
  objects.forEach((body, i) => { out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  out += 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

describe('an imported document', () => {
  it('comes back with its pages, readable one at a time', async () => {
    const { doc, refused } = await importPdf({
      bytes: buildPdf(['Hydrant flow test at Fictional Tower', 'Residual pressure recorded at the outlet']),
      fileName: 'Fictional hydrant manual.pdf',
    });
    expect(refused).toBeUndefined();
    expect(doc?.pageCount).toBe(2);
    expect((await listLibraryDocs()).map((d) => d.id)).toEqual([doc!.id]);
    expect((await getLibraryDoc(doc!.id))?.title).toBe('Fictional hydrant manual');
    expect(await libraryPage(doc!.id, 2)).toContain('Residual pressure');
  });

  it('is searched on its own when opened', async () => {
    const a = (await importPdf({ bytes: buildPdf(['Booster pump churn test on Main St']), fileName: 'a.pdf' })).doc!;
    const b = (await importPdf({ bytes: buildPdf(['Booster pump flow test at job 9001']), fileName: 'b.pdf' })).doc!;

    const everywhere = await searchLibrary('booster pump');
    expect(new Set(everywhere.map((h) => h.docId))).toEqual(new Set([a.id, b.id]));

    const inB = await searchLibrary('booster pump', 30, b.id);
    expect(inB.length).toBeGreaterThan(0);
    expect(inB.every((h) => h.docId === b.id)).toBe(true);
  });

  it('keeps to one document even when no word is long enough to narrow on', async () => {
    const a = (await importPdf({ bytes: buildPdf(['A EOL on Z1']), fileName: 'a.pdf' })).doc!;
    await importPdf({ bytes: buildPdf(['A EOL on Z2']), fileName: 'b.pdf' });
    const hits = await searchLibrary('eol', 30, a.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.docId === a.id)).toBe(true);
  });

  it('is gone, pages and all, once removed', async () => {
    const doc = (await importPdf({ bytes: buildPdf(['Sprinkler valve set inspection']), fileName: 'c.pdf' })).doc!;
    await deleteLibraryDoc(doc.id);
    expect(await getLibraryDoc(doc.id)).toBeNull();
    expect(await libraryPage(doc.id, 1)).toBeUndefined();
    expect(await searchLibrary('sprinkler valve')).toEqual([]);
  });

  it('refuses a file that is not a PDF, in a sentence', async () => {
    const result = await importPdf({ bytes: Uint8Array.from('PK zip', (c) => c.charCodeAt(0)), fileName: 'x.zip' });
    expect(result.refused).toBe('That file is not a PDF.');
    expect(await listLibraryDocs()).toEqual([]);
  });
});

describe('reading a picked file on the web build', () => {
  const pdf = buildPdf(['Exit sign discharge test']);

  it("reads the browser's own File when the picker hands one back", async () => {
    const file = { arrayBuffer: async () => pdf.slice().buffer };
    const fetcher = jest.fn();
    const bytes = await webPickedBytes({ uri: 'blob:whatever', file }, fetcher);
    expect(bytes).toEqual(pdf);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads a data: URL when there is no File', async () => {
    const uri = `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`;
    const bytes = await webPickedBytes({ uri });
    expect(bytes).toEqual(pdf);
    // And the bytes import like any other copy.
    const { doc } = await importPdf({ bytes, fileName: 'exit signs.pdf' });
    expect(doc?.pageCount).toBe(1);
  });

  it('says so when the browser cannot hand the file back', async () => {
    const fetcher = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(webPickedBytes({ uri: 'blob:gone' }, fetcher)).rejects.toThrow('Pick it again');
  });
});
