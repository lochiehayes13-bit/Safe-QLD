import html2canvas from 'html2canvas';
import { pageCuts, type Box } from './paginate';
import { DEFAULT_PAGE_BOX, pdfFromJpegPages, type JpegPage, type PageBox } from './pdfWriter';

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
 * at twice resolution is already past it. One page at twice resolution is
 * three million, which is the same picture Chris's screenshot was of.
 *
 * Browser only: the phone build never loads this file.
 */

/** Pixels per CSS millimetre, by definition. */
const PX_PER_MM = 96 / 25.4;

/** Twice the CSS pixel, which is what a phone screen is and what prints as 192 dpi. */
export const RASTER_SCALE = 2;

/** Legible on a dense form at about 350 KB a page; a lower figure smudges the 7.5px notes. */
export const RASTER_JPEG_QUALITY = 0.82;

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

    // Fonts and images first: a page rasterised before its swoosh decoded
    // prints a white band where the swoosh was.
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) await fonts.ready.catch(() => undefined);
    await Promise.all(Array.from(doc.images).map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())));

    const docHeight = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    const flow = measureFlow(doc, win);
    const cuts = pageCuts({ docHeight, pageHeight: contentH, ...flow });
    if (!cuts.length) throw new Error('The document laid out to nothing.');

    const pages: JpegPage[] = [];
    for (const cut of cuts) {
      const canvas = await html2canvas(doc.body, {
        x: 0,
        y: cut.top,
        width: contentW,
        height: cut.bottom - cut.top,
        scale,
        windowWidth: contentW,
        windowHeight: Math.ceil(docHeight),
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      pages.push({ jpeg: await jpegOf(canvas, quality), width: canvas.width, height: canvas.height });
      // Give the bitmap back before the next page takes one.
      canvas.width = 0;
      canvas.height = 0;
    }
    return { bytes: pdfFromJpegPages(pages, box, { title: options.title }), pages: pages.length, box };
  } finally {
    frame.remove();
  }
}
