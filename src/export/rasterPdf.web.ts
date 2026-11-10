import html2canvas from 'html2canvas';
import { pageCuts, type Box } from './paginate';
import { DEFAULT_PAGE_BOX, pdfFromJpegPages, type ImagePage, type PageBox } from './pdfWriter';

/**
 * A real PDF out of a browser, for the iPhone in the company.
 *
 * There is no iOS build, so every iPhone runs the web build — and the web
 * build's "Produce PDF" went to the printer, because a browser has no PDF
 * writer. On an iPhone the printer is a preview that only becomes a file if
 * the person knows to pinch it; in an app added to the home screen it is
 * nothing at all. Chris pressed the button, got nothing, and found the pinch
 * by asking an assistant. Nothing could go onto the Simpro job either, since
 * there were no bytes to queue.
 *
 * This produces the bytes. The document the app already builds is laid out in
 * a hidden frame at the width its own `@page` rule leaves between the margins,
 * cut into pages by the same rules the print engine honours — every element's
 * computed `break-inside`, `break-after` and `break-before`, every line of
 * text, every image — rasterised a page at a time, and written as a PDF of
 * page images. A page image is a scanned-looking page rather than a vector
 * one, and that is the trade: the only vector route in a browser is the print
 * dialogue, which is the thing that does not work.
 *
 * Page by page rather than the whole document at once, because an iPhone's
 * canvas has a ceiling of about sixteen million pixels and a three-page form
 * at print resolution is far past it. One page at three times the CSS pixel
 * is about seven million, which fits.
 *
 * Browser only: the phone build never loads this file.
 */

/** Pixels per CSS millimetre, by definition. */
const PX_PER_MM = 96 / 25.4;

/**
 * Three times the CSS pixel, which prints as 288 dpi.
 *
 * Twice was a phone screen's density and read well on one, but the form's
 * smallest type — the privacy notice and the entity line at 6.5px, units at
 * 7px — is five-point text, and at 192 dpi through a lossy JPEG it was a grey
 * smudge a reader would call a broken PDF. At three times it is print
 * resolution. A page is about seven million pixels, under an iPhone's canvas
 * ceiling, and the cost is a second or so a page and a larger file.
 */
export const RASTER_SCALE = 3;

/** High enough that fine type keeps its edges; the page is mostly white and compresses well regardless. */
export const RASTER_JPEG_QUALITY = 0.9;

/** How long the frame is given to lay the document out before the attempt is abandoned. */
const LAYOUT_TIMEOUT_MS = 20_000;

/** Named page sizes a document's `@page { size }` may use, in millimetres. */
const PAGE_SIZES: Record<string, [number, number]> = {
  a3: [297, 420], a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4], legal: [215.9, 355.6],
};

/** A CSS length in millimetres, or nothing for one that is not a length. */
function lengthMm(value: string | undefined): number | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(mm|cm|in|pt|px|pc)\s*$/i.exec(value ?? '');
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case 'mm': return n;
    case 'cm': return n * 10;
    case 'in': return n * 25.4;
    case 'pt': return n * 25.4 / 72;
    case 'pc': return n * 25.4 / 6;
    default: return n / PX_PER_MM;
  }
}

/**
 * The page box the document asked for, read off its own stylesheet.
 *
 * `letterheaded` writes an `@page` rule into every document, and the Form 72
 * overrides it with its own. The CSSOM exposes those as page rules with a
 * style of their own, so this reads the last one in document order — which is
 * the one the print engine would honour — rather than carrying a second copy
 * of each document's margins. A document that cannot be read falls back to
 * the letterhead's default, which is what every document without a rule of
 * its own already prints on.
 */
export function pageBoxOf(doc: Document): PageBox {
  const box: PageBox = { ...DEFAULT_PAGE_BOX };
  const PAGE_RULE = 6; // CSSRule.PAGE_RULE, by number so a frame without the constant still reads.
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (rule.type !== PAGE_RULE) continue;
      const style = (rule as CSSPageRule).style;
      const size = style.getPropertyValue('size').trim().toLowerCase();
      if (size) {
        const words = size.split(/\s+/);
        const named = words.find((w) => PAGE_SIZES[w]);
        const lengths = words.map(lengthMm).filter((n): n is number => n !== undefined);
        let [w, h] = named ? PAGE_SIZES[named]! : lengths.length === 2 ? [lengths[0]!, lengths[1]!] : [box.widthMm, box.heightMm];
        if (words.includes('landscape') && w < h) [w, h] = [h, w];
        if (words.includes('portrait') && w > h) [w, h] = [h, w];
        box.widthMm = w;
        box.heightMm = h;
      }
      // The shorthand is expanded by the CSSOM in every browser this runs in;
      // the shorthand itself is read where it is not.
      const side = (name: 'top' | 'right' | 'bottom' | 'left'): number | undefined => lengthMm(style.getPropertyValue(`margin-${name}`));
      const shorthand = style.getPropertyValue('margin').trim().split(/\s+/).map(lengthMm);
      const fromShorthand = (i: number): number | undefined => {
        if (!shorthand.length || shorthand.some((n) => n === undefined)) return undefined;
        const [a, b = a, c = a, d = b] = shorthand as number[];
        return [a, b, c, d][i];
      };
      box.marginTopMm = side('top') ?? fromShorthand(0) ?? box.marginTopMm;
      box.marginRightMm = side('right') ?? fromShorthand(1) ?? box.marginRightMm;
      box.marginBottomMm = side('bottom') ?? fromShorthand(2) ?? box.marginBottomMm;
      box.marginLeftMm = side('left') ?? fromShorthand(3) ?? box.marginLeftMm;
    }
  }
  return box;
}

/**
 * The boxes a page may not cut through, and the ones that keep their follower.
 *
 * Read from each element's computed style, so the documents' own rules decide
 * — the same `break-inside: avoid` on a row that the print engine honours —
 * rather than this file keeping a list of class names that would go stale the
 * first time a document was written. Two things the print engine never splits
 * without being told are added: an image, and a single line of text, which is
 * measured line by line through a Range so a paragraph can still break between
 * its lines but never through one.
 */
/**
 * Every shared table border drawn once.
 *
 * In the collapsing border model two neighbouring cells share one line, and
 * the browser draws it once. html2canvas does not know the model: it paints
 * each cell's own four borders at the edges of that cell's box, so every line
 * between two cells came out as two lines a hair apart — a form whose grid
 * looked hand-ruled twice. So, in the raster frame only, each collapsing
 * table is switched to separate borders with no spacing and each line is
 * given to exactly one cell: a cell keeps its top and left (or takes the
 * line its neighbour above or to the left drew), and keeps its bottom and
 * right only on the table's outer edge. The layout is the same to the pixel,
 * because n+1 lines of the same width is what both models draw.
 */
export function singleBorders(doc: Document, win: Window): void {
  const NEAR = 1.5;
  type Side = { width: string; style: string; color: string };
  const side = (cs: CSSStyleDeclaration, s: 'Top' | 'Right' | 'Bottom' | 'Left'): Side => ({
    width: cs.getPropertyValue(`border-${s.toLowerCase()}-width`),
    style: cs.getPropertyValue(`border-${s.toLowerCase()}-style`),
    color: cs.getPropertyValue(`border-${s.toLowerCase()}-color`),
  });
  const drawn = (x: Side): boolean => x.style !== 'none' && x.style !== 'hidden' && parseFloat(x.width) > 0;
  const none: Side = { width: '0px', style: 'none', color: 'transparent' };

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (win.getComputedStyle(table).borderCollapse !== 'collapse') continue;
    const outer = table.getBoundingClientRect();
    const cells = Array.from(table.rows).flatMap((r) => Array.from(r.cells));
    const seen = cells.map((cell) => {
      const cs = win.getComputedStyle(cell);
      return {
        cell,
        rect: cell.getBoundingClientRect(),
        top: side(cs, 'Top'), right: side(cs, 'Right'), bottom: side(cs, 'Bottom'), left: side(cs, 'Left'),
      };
    });
    const overlapsX = (a: DOMRect, b: DOMRect): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > NEAR;
    const overlapsY = (a: DOMRect, b: DOMRect): boolean => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > NEAR;
    const finals = seen.map((c) => {
      const above = seen.find((o) => o !== c && Math.abs(o.rect.bottom - c.rect.top) <= NEAR && overlapsX(o.rect, c.rect));
      const before = seen.find((o) => o !== c && Math.abs(o.rect.right - c.rect.left) <= NEAR && overlapsY(o.rect, c.rect));
      return {
        top: drawn(c.top) ? c.top : above && drawn(above.bottom) ? above.bottom : none,
        left: drawn(c.left) ? c.left : before && drawn(before.right) ? before.right : none,
        bottom: Math.abs(c.rect.bottom - outer.bottom) <= NEAR ? c.bottom : none,
        right: Math.abs(c.rect.right - outer.right) <= NEAR ? c.right : none,
      };
    });
    table.style.borderCollapse = 'separate';
    table.style.borderSpacing = '0';
    seen.forEach((c, i) => {
      const f = finals[i]!;
      for (const [name, v] of [['top', f.top], ['right', f.right], ['bottom', f.bottom], ['left', f.left]] as const) {
        c.cell.style.setProperty(`border-${name}-width`, v.width, 'important');
        c.cell.style.setProperty(`border-${name}-style`, v.style, 'important');
        c.cell.style.setProperty(`border-${name}-color`, v.color, 'important');
      }
    });
  }
}

export function measureFlow(doc: Document, win: Window): {
  unbreakable: Box[]; keepWithNext: { top: number; nextTop: number }[]; breakBefore: number[];
} {
  const unbreakable: Box[] = [];
  const keepWithNext: { top: number; nextTop: number }[] = [];
  const breakBefore: number[] = [];
  const top = (r: DOMRect): number => r.top + win.scrollY;
  const bottom = (r: DOMRect): number => r.bottom + win.scrollY;

  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>('*'))) {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const cs = win.getComputedStyle(el) as CSSStyleDeclaration & { pageBreakInside?: string; pageBreakAfter?: string; pageBreakBefore?: string };
    const inside = cs.breakInside || cs.pageBreakInside || '';
    const after = cs.breakAfter || cs.pageBreakAfter || '';
    const before = cs.breakBefore || cs.pageBreakBefore || '';
    const tag = el.tagName;
    if (/avoid/.test(inside) || tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG') {
      unbreakable.push({ top: top(rect), bottom: bottom(rect) });
    }
    if (/avoid/.test(after)) {
      const next = el.nextElementSibling;
      if (next) keepWithNext.push({ top: top(rect), nextTop: top(next.getBoundingClientRect()) });
    }
    if (/^(page|always|left|right)$/.test(before)) breakBefore.push(top(rect));
    if (/^(page|always|left|right)$/.test(after)) breakBefore.push(bottom(rect));
  }

  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent || !node.textContent.trim()) continue;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.height > 0) unbreakable.push({ top: top(r), bottom: bottom(r) });
    }
  }
  return { unbreakable, keepWithNext, breakBefore };
}

export interface RasterisedPdf {
  bytes: Uint8Array;
  pages: number;
  box: PageBox;
}

/** Waits for a frame to load, or gives up: a frame that never loads must not hang the button for ever. */
function loaded(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The document took too long to lay out in this browser.')), LAYOUT_TIMEOUT_MS);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.onerror = () => { clearTimeout(timer); reject(new Error('The browser would not lay the document out.')); };
  });
}

/** JPEG bytes off a canvas, through toBlob so a large page is not held twice as a string. */
function jpegOf(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('The browser could not encode a page.')); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, 'image/jpeg', quality);
  });
}

/** Whether this browser can deflate — every current one can; an old iOS cannot, and gets JPEG. */
function canDeflate(): boolean {
  return typeof CompressionStream === 'function';
}

/**
 * The page's pixels, lossless, as PDF's FlateDecode with PNG predictors.
 *
 * Each row is written as PNG's "Up" filter — every byte less the byte above
 * it — behind a filter byte of 2, which is what /Predictor 15 tells a viewer
 * to expect. A page of black type on white paper is then almost entirely
 * zeros, and deflate makes short work of it: smaller than the JPEG, and every
 * glyph edge exactly as the browser drew it.
 */
async function flateOf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The browser gave the page no drawing context.');
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const stride = width * 3;
  const rows = new Uint8Array((stride + 1) * height);
  let out = 0;
  for (let y = 0; y < height; y++) {
    rows[out++] = 2; // Up
    const row = y * width * 4;
    const above = row - width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (y === 0) {
        rows[out++] = rgba[i]!;
        rows[out++] = rgba[i + 1]!;
        rows[out++] = rgba[i + 2]!;
      } else {
        const j = above + x * 4;
        rows[out++] = (rgba[i]! - rgba[j]!) & 0xff;
        rows[out++] = (rgba[i + 1]! - rgba[j + 1]!) & 0xff;
        rows[out++] = (rgba[i + 2]! - rgba[j + 2]!) & 0xff;
      }
    }
  }
  // 'deflate' is the zlib-wrapped stream FlateDecode expects; 'deflate-raw' is not.
  const stream = new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One page off its canvas, lossless where the browser allows and JPEG where it does not. */
async function encodePage(canvas: HTMLCanvasElement, quality: number): Promise<ImagePage> {
  const { width, height } = canvas;
  if (canDeflate()) {
    try {
      return { flate: await flateOf(canvas), width, height };
    } catch {
      // A page too big to read back, or a stream the browser refused: the
      // JPEG route still produces the page.
    }
  }
  return { jpeg: await jpegOf(canvas, quality), width, height };
}

/**
 * The document as a PDF of page images.
 *
 * `html` is the complete document the app already builds for the printer.
 */
export async function rasterPdfFromHtml(
  html: string,
  options: { scale?: number; quality?: number; title?: string } = {},
): Promise<RasterisedPdf> {
  if (typeof document === 'undefined') throw new Error('There is no page to lay the document out in.');
  const scale = options.scale ?? RASTER_SCALE;
  const quality = options.quality ?? RASTER_JPEG_QUALITY;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  // Off the screen but not display:none, which would stop the layout; sized
  // once the page box is known.
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:800px;height:1200px;border:0;visibility:hidden;';
  frame.srcdoc = html;
  const ready = loaded(frame);
  document.body.appendChild(frame);
  try {
    await ready;
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win || !doc.body) throw new Error('The browser gave the document no frame.');

    const box = pageBoxOf(doc);
    const contentW = Math.round((box.widthMm - box.marginLeftMm - box.marginRightMm) * PX_PER_MM);
    const contentH = (box.heightMm - box.marginTopMm - box.marginBottomMm) * PX_PER_MM;
    if (contentW <= 0 || contentH <= 0) throw new Error('The document asks for a page its margins leave no room on.');

    // The frame is the paper between the margins. No scrollbar, or a desktop
    // browser takes fifteen pixels off the column and the layout no longer
    // matches the print engine's.
    frame.style.width = `${contentW}px`;
    frame.style.height = `${Math.ceil(contentH)}px`;
    const fit = doc.createElement('style');
    fit.textContent = `html{overflow:hidden !important;width:${contentW}px}body{width:${contentW}px}`;
    doc.head.appendChild(fit);

    // Fonts and images first: a page rasterised before its masthead decoded
    // prints a white band where the masthead was.
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) await fonts.ready.catch(() => undefined);
    await Promise.all(Array.from(doc.images).map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())));

    // Before anything is measured, so the cuts are taken off the layout that
    // is drawn.
    singleBorders(doc, win);

    const docHeight = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    const flow = measureFlow(doc, win);
    const cuts = pageCuts({ docHeight, pageHeight: contentH, ...flow });
    if (!cuts.length) throw new Error('The document laid out to nothing.');

    const pages: ImagePage[] = [];
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i]!;
      // A pixel shaved off every page but the last: a cut that lands exactly
      // on the next block's top edge otherwise draws a hairline of it along
      // the foot of the page.
      const height = Math.max(1, Math.floor(cut.bottom - cut.top) - (i < cuts.length - 1 ? 1 : 0));
      const canvas = await html2canvas(doc.body, {
        x: 0,
        y: cut.top,
        width: contentW,
        height,
        scale,
        windowWidth: contentW,
        windowHeight: Math.ceil(docHeight),
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      pages.push(await encodePage(canvas, quality));
      // Give the bitmap back before the next page takes one.
      canvas.width = 0;
      canvas.height = 0;
    }
    return { bytes: pdfFromJpegPages(pages, box, { title: options.title }), pages: pages.length, box };
  } finally {
    frame.remove();
  }
}
