/**
 * The web build is how this app reaches an iPhone, and a technician who
 * finishes a service on one has to be able to hand over the paperwork. A
 * browser cannot write a file into storage, but it can give the person a file
 * to save and it can put a document in front of the printer — which on an
 * iPhone is how a PDF reaches Files or a mail.
 *
 * These are the decisions behind that, kept pure so they can be held to it.
 */
import { blobTypeFor, deliveryFor, printableDocument, webShareNotice } from '@/export/webFiles';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('how a browser delivers a generated file', () => {
  it('prints a PDF, because a browser has no PDF writer', () => {
    expect(deliveryFor('Service report Fictional Tower 03-09-2026.pdf')).toBe('print');
    expect(deliveryFor('SHOUTING.PDF')).toBe('print');
  });

  it('downloads anything that is already a file', () => {
    expect(deliveryFor('Timesheet 03-09-2026.xlsx')).toBe('download');
    expect(deliveryFor('assets.csv')).toBe('download');
    expect(deliveryFor('site.sqld')).toBe('download');
  });

  it('gives a saved file a type that opens in the right thing', () => {
    expect(blobTypeFor('a.xlsx')).toContain('spreadsheetml');
    expect(blobTypeFor('a.csv')).toContain('text/csv');
    expect(blobTypeFor('a.sqld')).toBe('application/octet-stream');
  });
});

describe('the document the browser prints', () => {
  it('names it, because the title is what "Save as PDF" offers as the file name', () => {
    const out = printableDocument('Service report Fictional Tower', '<html><head><meta charset="utf-8" /></head><body>x</body></html>');
    expect(out).toContain('<title>Service report Fictional Tower</title>');
  });

  it('leaves a document that already names itself alone', () => {
    const html = '<html><head><title>Form 72</title></head><body>x</body></html>';
    expect(printableDocument('Something else', html)).toBe(html);
  });

  it('wraps a fragment, so a bare body still prints', () => {
    const out = printableDocument('Notice', '<p>Critical defect</p>');
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('<p>Critical defect</p>');
  });

  it('does not let a title carry markup into the head', () => {
    expect(printableDocument('<script>x</script>', '<p>y</p>')).not.toContain('<script>x');
  });
});

describe('what the person is told', () => {
  it('says a PDF went to the printer, and how to keep it on an iPhone', () => {
    const notice = webShareNotice('Service report.pdf');
    expect(notice.title).toBe('Sent to print');
    expect(notice.body).toMatch(/Save as PDF/);
    expect(notice.body).toMatch(/iPhone/);
  });

  it('says a spreadsheet is with their downloads, and where that is on an iPhone', () => {
    const notice = webShareNotice('Timesheet.xlsx');
    expect(notice.title).toBe('Downloaded');
    expect(notice.body).toMatch(/Files/);
  });
});

describe('the two file layers', () => {
  /** Every name a screen imports has to exist in both, or the web build breaks. */
  const exportsOf = (file: string): string[] => {
    const source = readFileSync(join(__dirname, '..', 'export', file), 'utf8');
    return [...source.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]!).sort();
  };

  it('offer the screens every function the phone does', () => {
    // A superset is fine — the browser needs a printer and the phone does not
    // — but a name the phone has and the browser lacks is a screen that works
    // on Android and throws on an iPhone.
    const phone = exportsOf('files.ts');
    const browser = new Set(exportsOf('files.web.ts'));
    expect(phone.filter((name) => !browser.has(name))).toEqual([]);
  });

  it('cover every function the screens actually import', () => {
    const app = join(__dirname, '..', '..', 'app');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
      }
      return out;
    };
    const imported = new Set<string>();
    for (const file of [...walk(app), ...walk(join(__dirname, '..', 'services'))]) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/import \{([^}]+)\} from '@\/export\/files'/g)) {
        for (const name of match[1]!.split(',')) imported.add(name.trim());
      }
    }
    expect(imported.size).toBeGreaterThan(3);
    const browser = new Set(exportsOf('files.web.ts'));
    expect([...imported].filter((name) => !browser.has(name)).sort()).toEqual([]);
  });

  it('are the only file layer, so a third one cannot drift from them', () => {
    const files = readdirSync(join(__dirname, '..', 'export')).filter((f) => /^files\./.test(f));
    expect(files.sort()).toEqual(['files.ts', 'files.web.ts']);
  });
});
