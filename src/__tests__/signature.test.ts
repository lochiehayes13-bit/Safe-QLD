import { STROKE_WIDTH, hasInk, roundCoord, strokePath, strokesToSvg, svgDataUri } from '@/domain/signature';

/**
 * The signature file the office receives.
 *
 * The pad draws from the same path data, so what is checked here is the
 * document: one path per stroke, a dot for a tap, nothing at all for an
 * empty pad, and a size the file can be opened at.
 */
describe('stroke path data', () => {
  it('starts with a move and follows with lines, to one decimal', () => {
    expect(strokePath([{ x: 10.04, y: 20.16 }, { x: 30, y: 40.55 }])).toBe('M10,20.2 L30,40.6');
    expect(roundCoord(1.25)).toBe(1.3);
  });

  it('draws a tap as a dot rather than nothing', () => {
    expect(strokePath([{ x: 5, y: 5 }])).toBe('M5,5 L5,5');
    expect(strokePath([])).toBe('');
  });
});

describe('the SVG document', () => {
  const strokes = [[{ x: 1, y: 2 }, { x: 3, y: 4 }], [{ x: 9, y: 9 }]];

  it('has one path per stroke, black ink, round caps, at the pad\'s size', () => {
    const svg = strokesToSvg(strokes, 320.4, 170)!;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="170" viewBox="0 0 320 170">')).toBe(true);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('d="M1,2 L3,4"');
    expect(svg).toContain('d="M9,9 L9,9"');
    expect(svg).toContain(`stroke="black" stroke-width="${STROKE_WIDTH}" fill="none" stroke-linecap="round"`);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('is nothing for an empty pad, or a pad with no size yet', () => {
    expect(strokesToSvg([], 300, 170)).toBeUndefined();
    expect(strokesToSvg([[]], 300, 170)).toBeUndefined();
    expect(strokesToSvg(strokes, 0, 170)).toBeUndefined();
    expect(hasInk([[]])).toBe(false);
    expect(hasInk(strokes)).toBe(true);
  });

  it('leaves an empty stroke out of the document rather than writing an empty path', () => {
    const svg = strokesToSvg([[], [{ x: 1, y: 1 }]], 100, 100)!;
    expect(svg.match(/<path /g)).toHaveLength(1);
  });

  it('wraps as a data URI for the PDF, and wraps nothing as nothing', () => {
    expect(svgDataUri('<svg/>')).toBe('data:image/svg+xml;utf8,%3Csvg%2F%3E');
    expect(svgDataUri(undefined)).toBeUndefined();
  });
});
