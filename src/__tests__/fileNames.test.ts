import { DEFAULT_MIME, isPdfName, mimeTypeFor, safeFileName } from '@/export/fileNames';

/**
 * Naming a file that is about to leave the phone.
 *
 * This logic lived in files.ts, which cannot be loaded in a test at all — it
 * imports expo-file-system, expo-print and expo-sharing — so it sat at zero per
 * cent coverage, not through neglect but because there was no way to reach it.
 * A slash in a site name silently breaks file creation on Android, and nothing
 * checked that the one function guarding against it did.
 */

describe('making a site name into a filename', () => {
  it('replaces the characters that break file creation', () => {
    // The shape the original comment names. A slash is the one that fails
    // silently on Android rather than throwing something a person could read.
    expect(safeFileName('Level 3 / Plant Room')).toBe('Level 3 - Plant Room');
    expect(safeFileName('Wing A: East')).toBe('Wing A- East');
    expect(safeFileName('a\\b?c%d*e|f"g<h>i')).toBe('a-b-c-d-e-f-g-h-i');
  });

  it('keeps the punctuation their register actually uses', () => {
    // Commas, ampersands, hyphens and full stops are legal in a filename and
    // are all over these names. Stripping them would make the file harder to
    // recognise for no gain.
    expect(safeFileName('RQYS - Royal QLD Yacht Squadron - 578 Royal Esplanade, Manly'))
      .toBe('RQYS - Royal QLD Yacht Squadron - 578 Royal Esplanade, Manly');
    expect(safeFileName('Smith & Sons Pty Ltd.')).toBe('Smith & Sons Pty Ltd.');
  });

  it('collapses the whitespace a copied cell brings with it', () => {
    expect(safeFileName('  Logan   DC \n report ')).toBe('Logan DC report');
  });

  it('will not produce a hidden file', () => {
    // A leading dot hides the file on every platform that matters and makes it
    // unfindable in a share sheet.
    expect(safeFileName('...quiet')).toBe('quiet');
    expect(safeFileName('.')).toBe('export');
  });

  it('falls back rather than naming a file nothing', () => {
    expect(safeFileName('')).toBe('export');
    expect(safeFileName('///')).toBe('---');
    expect(safeFileName('', 'service report')).toBe('service report');
  });

  it('keeps both ends of a name too long to fit', () => {
    /*
     * The caller composes the whole name — "<site> service report", "<site>
     * zone chart" — and hands it over as one string, so cutting the tail loses
     * the half that says what the document is. On a site already at the cap
     * every export then lands on one filename, and each write deletes the file
     * before it. One of their 892 sites is long enough for that today.
     */
    const site = 'A'.repeat(94);
    const report = safeFileName(`${site} service report`);
    const chart = safeFileName(`${site} zone chart`);

    expect(report.length).toBeLessThanOrEqual(90);
    expect(report).not.toBe(chart);
    expect(report.endsWith('service report')).toBe(true);
    expect(chart.endsWith('zone chart')).toBe(true);
    // And the front still says which site it was.
    expect(report.startsWith('AAAAAAAAAA')).toBe(true);
  });

  it('leaves a name that fits exactly as it is', () => {
    const ninety = 'B'.repeat(90);
    expect(safeFileName(ninety)).toBe(ninety);
    expect(safeFileName('C'.repeat(91))).toContain('…');
  });
});

describe('telling the share sheet what it is handling', () => {
  it('knows the four types this app writes', () => {
    expect(mimeTypeFor('report.pdf')).toBe('application/pdf');
    expect(mimeTypeFor('register.csv')).toBe('text/csv');
    expect(mimeTypeFor('site.sqld')).toBe(DEFAULT_MIME);
    expect(mimeTypeFor('service.xlsx'))
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('is not confused by a name with no extension', () => {
    /*
     * `name.slice(name.lastIndexOf('.'))` was the original. With no dot,
     * lastIndexOf returns -1 and slice(-1) hands back the last character of the
     * name rather than nothing — so the extension of "report" was "t". Every
     * writer appends an extension so it never fired, which is exactly the kind
     * of thing that fires the first time somebody adds a writer that does not.
     */
    expect(mimeTypeFor('report')).toBe(DEFAULT_MIME);
    expect(mimeTypeFor('')).toBe(DEFAULT_MIME);
  });

  it('is not confused by a dot inside the name', () => {
    expect(mimeTypeFor('Smith & Sons Pty Ltd. service report.pdf')).toBe('application/pdf');
    expect(mimeTypeFor('Smith & Sons Pty Ltd. service report')).toBe(DEFAULT_MIME);
  });

  it('recognises a PDF whatever case it is written in', () => {
    // The UTI is what makes iOS open it in a reader rather than offering to
    // save an unknown blob.
    expect(isPdfName('report.PDF')).toBe(true);
    expect(isPdfName('report.pdf')).toBe(true);
    expect(isPdfName('report.pdfx')).toBe(false);
    expect(mimeTypeFor('report.PDF')).toBe('application/pdf');
  });
});
