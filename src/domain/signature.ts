/**
 * A signature, as strokes, and as the SVG the office is sent.
 *
 * The pad captures a finger as points; this turns them into path data and
 * into a complete SVG document. It is a plain string on purpose: there is no
 * view-shot library in the build, react-native-svg draws paths from the same
 * data, and an SVG file is small enough to queue as an ordinary attachment
 * and readable in any browser the office has. Black ink on a transparent
 * ground, so it reads on the dark app screen and on a white printed page.
 */

export interface Point { x: number; y: number }

/** One continuous movement of the finger. */
export type Stroke = Point[];

export const STROKE_WIDTH = 2.4;

/** One decimal is plenty for a signature and keeps the file small. */
export function roundCoord(n: number): number {
  return Math.round(n * 10) / 10;
}

/** SVG path data for one stroke: a dot for a single point, else a polyline. */
export function strokePath(stroke: Stroke): string {
  if (!stroke.length) return '';
  const [first, ...rest] = stroke;
  const head = `M${roundCoord(first!.x)},${roundCoord(first!.y)}`;
  // A tap with no movement still marks the page: a zero-length line with
  // round caps draws a dot, where a bare M draws nothing.
  if (!rest.length) return `${head} L${roundCoord(first!.x)},${roundCoord(first!.y)}`;
  return head + rest.map((p) => ` L${roundCoord(p.x)},${roundCoord(p.y)}`).join('');
}

/** Whether anything was drawn at all: a stroke with no points is not a signature. */
export function hasInk(strokes: readonly Stroke[]): boolean {
  return strokes.some((s) => s.length > 0);
}

/**
 * The SVG document for a signature.
 *
 * Undefined for an empty pad or a pad with no size yet, because a file of
 * nothing attached to a job reads as a signature that was given. The width
 * and height are the pad's, so the file shows the signature at the size it
 * was written.
 */
export function strokesToSvg(strokes: readonly Stroke[], width: number, height: number): string | undefined {
  if (!hasInk(strokes) || !(width > 0) || !(height > 0)) return undefined;
  const w = Math.round(width);
  const h = Math.round(height);
  const paths = strokes
    .filter((s) => s.length > 0)
    .map((s) => `<path d="${strokePath(s)}" stroke="black" stroke-width="${STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}</svg>`;
}

/** The same signature as a data URI, for an <img> in a PDF. */
export function svgDataUri(svg: string | undefined): string | undefined {
  return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : undefined;
}
