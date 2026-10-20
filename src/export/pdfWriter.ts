/**
 * A PDF made of page images, written by hand.
 *
 * A browser has no PDF writer, which is why every report the web build made
 * went to the printer instead of to a file — and on an iPhone the printer is a
 * preview that only becomes a PDF if the person knows to pinch it, and in an
 * app added to the home screen it is nothing at all. Chris pressed Produce PDF
 * on a Form 72 and got neither a file nor a reason.
 *
 * So the web build rasterises each page of a document and this turns those
 * images into a real PDF: one image per page, each drawn inside the page box
 * the document asked for. That is a picture of a page rather than a vector
 * one, and it is the honest trade — the only vector route in a browser is the
 * print dialogue, and the print dialogue is the thing that does not work.
 *
 * Two image encodings. A Flate page is lossless: the page's pixels, each row
 * predicted from the one above it the way PNG does, deflated. On a page that
 * is mostly white paper with black type that is both smaller than a JPEG and
 * exact — no ringing around a 7px "kPa". A JPEG page is the fallback for a
 * browser with no deflate of its own, and the right choice for a page of
 * photographs.
 *
 * Written here rather than pulled in, for the same reason the workbook writer
 * is: a PDF of image pages is a catalogue, a page tree, one page object and one
 * image object per page, and a cross-reference table of byte offsets. Forty
 * lines, no dependency, and testable without a browser. The one rule that is
 * easy to get wrong is the cross-reference table: every offset in it is a byte
 * position in the finished file, so the file is assembled as bytes from the
 * start and never as a string that is encoded at the end.
 *
 * Pure. No DOM, no expo, nothing that only exists in one of the two builds.
 */

/** A page's physical box, in millimetres, as a document's `@page` rule states it. */
export interface PageBox {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
}

/** A4 portrait inside the letterhead's default margins, for a document that says nothing. */
export const DEFAULT_PAGE_BOX: PageBox = {
  widthMm: 210, heightMm: 297, marginTopMm: 8, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10,
};

/** One rasterised page: JPEG bytes and the pixel size they encode. */
export interface JpegPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/**
 * One rasterised page, lossless: a zlib stream of the page's RGB rows, each
 * row led by a PNG filter byte (PDF's /Predictor 15), and the pixel size.
 */
export interface FlatePage {
  flate: Uint8Array;
  width: number;
  height: number;
}

export type ImagePage = JpegPage | FlatePage;

const isJpeg = (page: ImagePage): page is JpegPage => 'jpeg' in page;

const PT_PER_MM = 72 / 25.4;

/** The pixel size a JPEG's own header states, or nothing where the bytes are not a JPEG. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at++; continue; }
    const marker = bytes[at + 1]!;
    // Padding and restart markers carry no length.
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    // Every start-of-frame marker but the arithmetic/differential oddities.
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (marker === 0xda) return undefined; // Start of scan with no frame before it.
    at += 2 + length;
  }
  return undefined;
}

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** PDF string syntax for the metadata, which is ASCII only — anything else is dropped rather than mis-encoded. */
/**
 * A PDF literal string. The viewer's title bar and the share sheet read it as
 * PDFDocEncoding, which is near enough ASCII that anything beyond is dropped
 * rather than guessed at; the dashes a title is likely to carry become a
 * hyphen so the words stay apart, and the space left by anything else is
 * closed up.
 */
const pdfString = (s: string): string => `(${s
  .replace(/[\u2012-\u2015\u2212]/g, '-')
  .replace(/[^\x20-\x7e]/g, '')
  .replace(/ {2,}/g, ' ')
  .trim()
  .replace(/[\\()]/g, (c) => `\\${c}`)})`;

/**
 * The PDF.
 *
 * Each image is drawn at the full content width of the page box and scaled
 * to keep its own proportions, top-aligned under the top margin — which is
 * where the paginator put the content, so the page reads exactly as the
 * browser laid it out. An image that would overrun the content height is
 * scaled down to fit instead of running into the margin; the paginator does
 * not produce one, and the writer does not trust that.
 */
export function pdfFromJpegPages(
  pages: readonly ImagePage[],
  box: PageBox = DEFAULT_PAGE_BOX,
  meta: { title?: string; producer?: string } = {},
): Uint8Array {
  if (!pages.length) throw new Error('A PDF needs at least one page.');
  const pageW = box.widthMm * PT_PER_MM;
  const pageH = box.heightMm * PT_PER_MM;
  const contentW = (box.widthMm - box.marginLeftMm - box.marginRightMm) * PT_PER_MM;
  const contentH = (box.heightMm - box.marginTopMm - box.marginBottomMm) * PT_PER_MM;
  if (contentW <= 0 || contentH <= 0) throw new Error('The page margins leave no room for the page.');

  // Object bodies in order of their numbers. Bytes, because the offsets below
  // are byte offsets and a JPEG is not text.
  const objects: Uint8Array[] = [];
  const add = (parts: (Uint8Array | string)[]): number => {
    const chunks = parts.map((p) => (typeof p === 'string' ? ascii(p) : p));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const body = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { body.set(c, at); at += c.length; }
    objects.push(body);
    return objects.length;
  };

  // 1 is the page tree, filled in once the pages exist; 2 the catalogue.
  const PAGES = add(['']);
  const catalog = add([`<< /Type /Catalog /Pages ${PAGES} 0 R >>`]);
  const info = add([`<< /Producer ${pdfString(meta.producer ?? 'Safe QLD')}${meta.title ? ` /Title ${pdfString(meta.title)}` : ''} >>`]);

  const kids: number[] = [];
  pages.forEach((page, i) => {
    if (isJpeg(page)) {
      const size = jpegDimensions(page.jpeg);
      if (!size) throw new Error(`Page ${i + 1} is not a JPEG.`);
      // The page's own header is what the viewer believes, so the declared
      // size has to agree with it or the image is drawn stretched.
      if (size.width !== page.width || size.height !== page.height) {
        throw new Error(`Page ${i + 1} says it is ${page.width}×${page.height} but its JPEG is ${size.width}×${size.height}.`);
      }
    } else {
      // A zlib stream opens with a header byte whose low nibble is 8 (deflate).
      if (page.flate.length < 6 || (page.flate[0]! & 0x0f) !== 8) throw new Error(`Page ${i + 1} is not a zlib stream.`);
      if (!(page.width > 0 && page.height > 0)) throw new Error(`Page ${i + 1} has no size.`);
    }
    const fit = Math.min(contentW / page.width, contentH / page.height);
    const drawW = page.width * fit;
    const drawH = page.height * fit;
    const x = box.marginLeftMm * PT_PER_MM;
    const y = pageH - box.marginTopMm * PT_PER_MM - drawH;

    const data = isJpeg(page) ? page.jpeg : page.flate;
    const filter = isJpeg(page)
      ? '/Filter /DCTDecode'
      : `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${page.width} >>`;
    const image = add([
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB `
      + `/BitsPerComponent 8 ${filter} /Length ${data.length} >>\nstream\n`,
      data,
      '\nendstream',
    ]);
    const draw = `q ${drawW.toFixed(3)} 0 0 ${drawH.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im0 Do Q`;
    const content = add([`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
    kids.push(add([
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${pageW.toFixed(3)} ${pageH.toFixed(3)}] `
      + `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`,
    ]));
  });
  objects[PAGES - 1] = ascii(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);

  // The file, assembled as bytes so every cross-reference offset is a true
  // byte position. The second line of the header is the conventional four
  // high bytes that mark the file as binary to anything that sniffs it.
  const header = new Uint8Array([...ascii('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const chunks: Uint8Array[] = [header];
  const offsets: number[] = [];
  let position = header.length;
  objects.forEach((body, i) => {
    offsets.push(position);
    const head = ascii(`${i + 1} 0 obj\n`);
    const tail = ascii('\nendobj\n');
    chunks.push(head, body, tail);
    position += head.length + body.length + tail.length;
  });
  const xref = ascii(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${position}\n%%EOF\n`,
  );
  chunks.push(xref);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
