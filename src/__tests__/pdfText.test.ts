import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PdfError, isEncrypted, isPdf, readPdf } from '@/parsers/pdfText';

/**
 * Reading text out of a PDF without a PDF library.
 *
 * Safe QLD holds licensed copies of about thirty standards. They cannot ship
 * inside the app, but a technician's own copy on their own phone can be
 * imported and searched — offline, in a plant room, with nothing leaving the
 * device. There is no PDF text library in the React Native runtime, so the
 * format is read the way this app already reads SQLite and zip.
 *
 * The failure that matters is not a crash. It is a scanned standard that comes
 * back with four stray characters and looks like a successful import: a
 * technician searches it, finds nothing, and concludes the standard is silent
 * on the subject. So the refusals are tested as hard as the extraction.
 *
 * Where the real documents are staged on this machine they are read and checked
 * against a known-good extraction. They are licensed material and are never
 * committed, so those tests skip when absent — and the fixtures below are built
 * inside this file so the parser has real coverage either way.
 */

const REAL_DIR = '/tmp/safeqld-standards';
const ORACLE_DIR = '/tmp/safeqld-text';

/*
 * The file list is read here rather than inside the describe body, because
 * describe.skip still RUNS its callback — it only marks the tests it collects
 * as skipped. A readdirSync in there throws ENOENT on any machine without the
 * staged documents, which is every machine except the one they were staged on.
 * It passed locally and took CI down four times.
 */
const realPdfs = existsSync(REAL_DIR) && existsSync(ORACLE_DIR)
  ? readdirSync(REAL_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'))
  : [];
const describeReal = realPdfs.length ? describe : describe.skip;

// --- A PDF built here, so the parser is covered with no customer files ------

/** Pads a line out to the length of a real typeset page, so the scan
 *  detector is not tripped by an unrealistically sparse fixture. */
function pageBody(line: string): string {
  const filler = 'the installation shall be inspected and the result recorded against the asset ';
  return `${line} ${filler.repeat(4)}`;
}

function buildPdf(pageTexts: string[], pad = true): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const text of pageTexts) {
    const body = pad ? pageBody(text) : text;
    const stream = `BT /F1 12 Tf 72 720 Td (${body.replace(/([()\\])/g, '\\$1')}) Tj ET`;
    contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(0);
  }
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objects.length + pageTexts.length + 1;
  for (const [i] of pageTexts.entries()) {
    pageIds[i] = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> `
      + `/Contents ${contentIds[i]} 0 R >>`,
    );
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);

  let out = '%PDF-1.4\n';
  objects.forEach((body, i) => { out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  out += 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

describe('isPdf', () => {
  it('recognises a PDF by its header and nothing else by anything', () => {
    expect(isPdf(buildPdf(['x']))).toBe(true);
    expect(isPdf(Uint8Array.from('PKrest', (c) => c.charCodeAt(0)))).toBe(false);
    expect(isPdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('readPdf — a document built here', () => {
  it('recovers the words from every page, in order', () => {
    const doc = readPdf(buildPdf([
      'The hydrant flow test is the substance of the service',
      'Boost pressure and residual pressure are recorded separately',
      'A gauge outside its calibration makes every reading unusable',
    ]));
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages[0]!.text).toContain('hydrant flow test');
    expect(doc.pages[1]!.text).toContain('residual pressure');
    expect(doc.pages[2]!.text).toContain('calibration');
    expect(doc.text).toContain('hydrant flow test');
  });

  it('stops where it is told to, and says that it did', () => {
    const doc = readPdf(buildPdf(['one page here', 'two page here', 'three page here']), { maxPages: 2 });
    expect(doc.pages).toHaveLength(2);
    expect(doc.warnings.join(' ')).toContain('Stopped after 2 pages of 3');
  });

  it('unescapes what the format escapes, rather than printing the backslashes', () => {
    const doc = readPdf(buildPdf(['a (bracketed) note and a back\\slash and enough other words here to count as real text at all']));
    expect(doc.text).toContain('(bracketed)');
    expect(doc.text).toContain('back\\slash');
  });

  it('refuses a file that is not a PDF rather than returning an empty document', () => {
    // An empty result reads as "this standard says nothing", which is worse
    // than an error a technician can act on.
    expect(() => readPdf(Uint8Array.from('PK', (c) => c.charCodeAt(0)))).toThrow(PdfError);
    expect(() => readPdf(new Uint8Array(0))).toThrow(PdfError);
  });

  it('refuses a PDF header with nothing behind it', () => {
    const stub = Uint8Array.from('%PDF-1.4\nnothing here at all\n%%EOF', (c) => c.charCodeAt(0));
    expect(() => readPdf(stub)).toThrow(/truncated|No PDF objects/i);
  });
});

describe('readPdf — a scan', () => {
  it('says there is no text rather than passing off the scraps as a document', () => {
    // This is the failure that matters. A scanned standard returning four
    // stray characters looks like a successful import, and a technician who
    // searches it and finds nothing concludes the standard is silent.
    const doc = readPdf(buildPdf(['a b c'], false));
    expect(doc.text).toBe('');
    expect(doc.pages).toEqual([]);
    expect(doc.warnings.join(' ')).toContain('scan of a paper original');
    expect(doc.warnings.join(' ')).toContain('has not been indexed');
  });
});

// --- The real documents, where they are staged ------------------------------

describeReal('readPdf — against the real standards', () => {
  const pdfs = realPdfs;
  const oracleFor = (pdf: string): string | undefined => {
    const name = pdf.replace(/^[0-9a-f]{8}-/, '').replace(/\.pdf$/i, '.txt');
    const path = join(ORACLE_DIR, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };

  const wordsOf = (s: string) =>
    new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

  it('finds documents to read', () => {
    expect(pdfs.length).toBeGreaterThan(10);
  });

  it('never throws on an unprotected document, whatever shape it is in', () => {
    const failures: string[] = [];
    for (const f of pdfs) {
      const bytes = readFileSync(join(REAL_DIR, f));
      if (isEncrypted(bytes)) continue;
      try {
        readPdf(bytes, { maxPages: 12 });
      } catch (e) {
        failures.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('refuses a publisher-encrypted standard by name rather than failing obscurely', () => {
    /*
     * Every Australian Standard in the library is encrypted with the /Standard
     * handler to stop its text being copied. Without this check the import
     * reports twenty streams that would not inflate and a technician is left
     * to guess why their standard came back blank.
     */
    const encrypted = pdfs.filter((f) => isEncrypted(readFileSync(join(REAL_DIR, f))));
    expect(encrypted.length).toBeGreaterThan(5);
    for (const f of encrypted.slice(0, 5)) {
      expect(() => readPdf(readFileSync(join(REAL_DIR, f))))
        .toThrow(/encrypted by its publisher/);
    }
  });

  it('leaves the Queensland Government documents readable, because they are not locked', () => {
    // QDC parts and the legislation are Crown material, published free and
    // unprotected. They are the half of the library this can actually index.
    const open = pdfs.filter((f) => !isEncrypted(readFileSync(join(REAL_DIR, f))));
    expect(open.length).toBeGreaterThan(5);
  });

  it('recovers most of the vocabulary a known-good extraction found', () => {
    /*
     * Measured as vocabulary overlap rather than character equality. Word
     * order and spacing depend on how a page was typeset, and demanding they
     * match would be testing the typesetter. What matters for a search is
     * whether the words are there to be found.
     */
    const scored: { file: string; overlap: number; words: number }[] = [];

    for (const f of pdfs) {
      const oracle = oracleFor(f);
      if (!oracle) continue;
      const expected = wordsOf(oracle);
      // Only judge documents that actually contain text; a scan has none.
      if (expected.size < 500) continue;

      const bytes = readFileSync(join(REAL_DIR, f));
      // A publisher-locked file is refused by design, not badly parsed.
      if (isEncrypted(bytes)) continue;
      const got = wordsOf(readPdf(bytes, { maxPages: 40 }).text);
      if (!got.size) { scored.push({ file: f, overlap: 0, words: 0 }); continue; }

      let hits = 0;
      for (const w of expected) if (got.has(w)) hits += 1;
      scored.push({ file: f, overlap: hits / expected.size, words: got.size });
    }

    expect(scored.length).toBeGreaterThan(3);
    /*
     * Every unprotected document in the library clears this. Reported by name
     * rather than as a bare count, so a regression says which document broke
     * instead of only that one did.
     */
    const poor = scored.filter((s) => s.overlap < 0.5)
      .map((s) => `${s.file}: ${(s.overlap * 100) | 0}%`);
    expect(poor).toEqual([]);
  });

  it('reports a scanned standard as unreadable rather than silently empty', () => {
    let scans = 0;
    for (const f of pdfs) {
      const bytes = readFileSync(join(REAL_DIR, f));
      if (isEncrypted(bytes)) continue;
      const doc = readPdf(bytes, { maxPages: 8 });
      if (doc.text === '') {
        scans += 1;
        expect(doc.warnings.length).toBeGreaterThan(0);
      }
    }
    // About a third of the library is scans of paper originals.
    expect(scans).toBeGreaterThan(0);
  });
});
