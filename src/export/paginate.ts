/**
 * Where the pages end, decided from measurements rather than from a browser.
 *
 * The web build rasterises a document page by page, and a raster has no idea
 * what a table row is: a cut at an arbitrary height puts a pressure reading in
 * one page's footer and its units in the next page's header, or slices a line
 * of text through the middle. The print engine never does that, because the
 * documents say where a page may not end — `break-inside: avoid` on every
 * row and every boxed warning, `break-after: avoid` on a part's heading so it
 * keeps its table, `break-before: page` on the attachment — and the engine
 * honours them.
 *
 * This honours the same rules over the same boxes. The web file layer measures
 * the laid-out document, reads each element's computed break rules, and hands
 * the measurements here; what comes back is the list of page cuts. Pure, so
 * the rules can be held to it with rectangles rather than with a browser.
 *
 * The one judgement it makes on its own: a box taller than a page cannot keep
 * itself whole, so it is cut anyway rather than producing a page with nothing
 * on it and the same box on the next.
 */

/** A vertical extent, in the document's own pixels from its top. */
export interface Box {
  top: number;
  bottom: number;
}

export interface PageFlow {
  /** The whole document's height. */
  docHeight: number;
  /** How much of a page the content may use, between the margins. */
  pageHeight: number;
  /** Boxes a page may not cut through: rows, boxed warnings, lines of text, images. */
  unbreakable: readonly Box[];
  /** Boxes that keep whatever follows them on their own page: a part's heading and its note. */
  keepWithNext: readonly { top: number; nextTop: number }[];
  /** Heights at which a new page must start: the attachment, a landscape chart. */
  breakBefore?: readonly number[];
}

/**
 * How close to a page's top a cut may be walked before the page is given up
 * as unfillable. A cut that lands within this of the top means the next thing
 * is taller than a page, and cutting through it beats emitting a blank sheet.
 */
const UNFILLABLE_PX = 40;

/** Measurement noise. Two boxes that touch share an edge, and that is not a cut through either. */
const EPS = 0.5;

/** The pages, as [top, bottom) extents of the document, in order. */
export function pageCuts(flow: PageFlow): Box[] {
  const docHeight = Math.ceil(Math.max(0, flow.docHeight));
  const pageHeight = Math.max(1, flow.pageHeight);
  const forced = [...(flow.breakBefore ?? [])].filter((y) => y > 0 && y < docHeight).sort((a, b) => a - b);
  const pages: Box[] = [];
  let top = 0;
  let guard = 0;
  while (top < docHeight && guard++ < 10_000) {
    let bottom = Math.min(docHeight, top + pageHeight);
    // A forced break inside this page ends the page there, whatever else fits.
    const force = forced.find((y) => y > top + EPS && y <= bottom);
    if (force !== undefined) {
      bottom = force;
    } else if (bottom < docHeight) {
      bottom = walkUp(flow, top, bottom);
    }
    bottom = Math.ceil(bottom);
    if (bottom <= top) bottom = Math.min(docHeight, top + pageHeight);
    pages.push({ top, bottom });
    top = bottom;
  }
  return pages;
}

/**
 * The cut, moved up until nothing straddles it.
 *
 * Every box that spans the cut pulls it up to that box's top; every heading
 * whose follower would start the next page pulls it up to the heading's top.
 * Repeated, because moving the cut up can land it inside something else. A
 * cut that would be walked up to within UNFILLABLE_PX of the page's top is a
 * box taller than the page, and is left where it was.
 */
function walkUp(flow: PageFlow, top: number, limit: number): number {
  let cut = limit;
  for (let i = 0; i < 500; i++) {
    const pulls: number[] = [];
    for (const b of flow.unbreakable) {
      if (b.top < cut - EPS && b.bottom > cut + EPS) pulls.push(b.top);
    }
    for (const k of flow.keepWithNext) {
      if (k.top < cut - EPS && k.nextTop >= cut - EPS) pulls.push(k.top);
    }
    if (!pulls.length) return cut;
    const up = Math.min(...pulls);
    if (up <= top + UNFILLABLE_PX) return limit;
    cut = up;
  }
  return cut;
}
