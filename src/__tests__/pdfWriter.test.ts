/**
 * The PDF the web build writes, read back.
 *
 * A browser has no PDF writer, so one is written by hand: image pages inside
 * the document's own page box. What can go wrong is quiet — a cross-reference
 * offset off by one and a viewer either repairs the file silently or refuses
 * it — so the file is parsed back here by its own rules rather than trusted.
 */
import { deflateSync } from 'zlib';
import { DEFAULT_PAGE_BOX, jpegDimensions, pdfFromJpegPages, type FlatePage, type JpegPage } from '@/export/pdfWriter';

/**
 * The smallest thing that is a JPEG to a parser: SOI, a baseline SOF0 frame
 * header naming the size, and nothing else. No viewer could draw it; this
 * suite is about the file around it.
 */
function fakeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

const page = (width: number, height: number): JpegPage => ({ jpeg: fakeJpeg(width, height), width, height });

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('reading a JPEG’s size off its header', () => {
  it('finds the frame header', () => {
    expect(jpegDimensions(fakeJpeg(1436, 2054))).toEqual({ width: 1436, height: 2054 });
  });

  it('walks past an application segment to reach it', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const bytes = fakeJpeg(10, 20);
    const withApp = new Uint8Array([0xff, 0xd8, ...app0, ...bytes.slice(2)]);
    expect(jpegDimensions(withApp)).toEqual({ width: 10, height: 20 });
  });

  it('answers nothing for bytes that are not a JPEG', () => {
    expect(jpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(jpegDimensions(new Uint8Array([]))).toBeUndefined();
  });
});

describe('the file', () => {
  const pdf = pdfFromJpegPages([page(1436, 2054), page(1436, 1178)], DEFAULT_PAGE_BOX, { title: 'Form 72 — Example' });
  const text = latin1(pdf);

  it('opens as a PDF and closes as one', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('declares one page per image, in order', () => {
    expect(text).toMatch(/\/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2/);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
  });

  it('puts every cross-reference offset on the object it names', () => {
    /*
     * This is the rule a viewer actually relies on. Each entry in the table is
     * the byte position of "n 0 obj" for object n, and startxref is the byte
     * position of the table itself. One offset wrong and the file is either
     * repaired silently or refused.
     */
    const start = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(text).toMatch(new RegExp(`/Size ${entries.length + 1}`));
  });

  it('carries the JPEG bytes whole, with their declared length', () => {
    const jpeg = fakeJpeg(1436, 2054);
    const at = text.indexOf(`/Length ${jpeg.length} >>\nstream\n`);
    expect(at).toBeGreaterThan(-1);
    const streamStart = at + `/Length ${jpeg.length} >>\nstream\n`.length;
    expect(Array.from(pdf.slice(streamStart, streamStart + jpeg.length))).toEqual(Array.from(jpeg));
  });

  it('draws the page on A4 inside the letterhead’s margins at the full content width', () => {
    // 210 × 297 mm in points, and the image 190 mm wide under an 8 mm top margin.
    expect(text).toMatch(/\/MediaBox \[0 0 595\.276 841\.890\]/);
    const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im0 Do Q/.exec(text)!;
    const [w, h, x, y] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    expect(w).toBeCloseTo(190 * 72 / 25.4, 1);
    expect(h).toBeCloseTo(w * 2054 / 1436, 1);
    expect(x).toBeCloseTo(10 * 72 / 25.4, 1);
    expect(y).toBeCloseTo(841.89 - 8 * 72 / 25.4 - h, 1);
  });

  it('names the document, for the viewer’s title bar and the share sheet', () => {
    // The em dash the screens use becomes a hyphen: PDFDocEncoding has no safe
    // spelling of it that every viewer agrees on, and dropping it would run the
    // words together.
    expect(text).toContain('/Title (Form 72 - Example)');
  });
});

describe('what the writer refuses', () => {
  it('a page whose stated size disagrees with its own JPEG, since the viewer would stretch it', () => {
    expect(() => pdfFromJpegPages([{ jpeg: fakeJpeg(100, 200), width: 100, height: 100 }]))
      .toThrow(/says it is 100×100 but its JPEG is 100×200/);
  });

  it('bytes that are not a JPEG', () => {
    expect(() => pdfFromJpegPages([{ jpeg: new Uint8Array([1, 2, 3]), width: 1, height: 1 }])).toThrow(/not a JPEG/);
  });

  it('no pages at all', () => {
    expect(() => pdfFromJpegPages([])).toThrow(/at least one page/);
  });

  it('margins that leave no page', () => {
    expect(() => pdfFromJpegPages([page(10, 10)], { ...DEFAULT_PAGE_BOX, marginLeftMm: 105, marginRightMm: 105 }))
      .toThrow(/no room/);
  });
});

describe('a page taller than the box', () => {
  it('is scaled to fit rather than run into the bottom margin', () => {
    // Twice as tall as wide on a box whose content is 190 × 279 mm: height wins.
    const pdf = pdfFromJpegPages([page(1000, 2000)], DEFAULT_PAGE_BOX);
    const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(latin1(pdf))!;
    const [w, h] = [Number(m[1]), Number(m[2])];
    expect(h).toBeCloseTo(279 * 72 / 25.4, 1);
    expect(w).toBeCloseTo(h / 2, 1);
  });
});

describe('a lossless page', () => {
  /** A 2×2 white page as PDF's FlateDecode with PNG "Up" predictors expects it. */
  const flatePage = (): FlatePage => {
    const rows = Buffer.from([2, 255, 255, 255, 255, 255, 255, 2, 0, 0, 0, 0, 0, 0]);
    return { flate: new Uint8Array(deflateSync(rows)), width: 2, height: 2 };
  };

  it('is written with the predictor the rows were encoded with', () => {
    const text = latin1(pdfFromJpegPages([flatePage()]));
    expect(text).toContain('/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2 >>');
    expect(text).not.toContain('DCTDecode');
  });

  it('carries the stream whole, and mixes with JPEG pages in one file', () => {
    const page = flatePage();
    const pdf = pdfFromJpegPages([page, { jpeg: fakeJpeg(10, 20), width: 10, height: 20 }]);
    const text = latin1(pdf);
    const head = `/Length ${page.flate.length} >>\nstream\n`;
    const at = text.indexOf(head) + head.length;
    expect(Array.from(pdf.slice(at, at + page.flate.length))).toEqual(Array.from(page.flate));
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });

  it('refuses bytes that are not a zlib stream', () => {
    expect(() => pdfFromJpegPages([{ flate: new Uint8Array([1, 2, 3, 4, 5, 6]), width: 2, height: 2 }]))
      .toThrow(/not a zlib stream/);
  });
});
