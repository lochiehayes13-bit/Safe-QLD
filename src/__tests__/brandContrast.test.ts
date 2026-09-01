import { darkTheme, lightTheme, type Theme } from '@/theme';
import { brand, company } from '@/theme/brand';

/**
 * The brand colours were chosen by measuring, not by eye, and the measurement
 * is the only thing keeping them legible. Brand orange looks like the obvious
 * accent and fails white text at 3.39:1; the deepened orange passes at 5.01:1.
 * Without this test the obvious choice gets made again by whoever next tidies
 * the palette, and nobody notices until a technician cannot read a button in
 * the sun.
 */

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (pair: string): number => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(h.slice(0, 2)) + 0.7152 * channel(h.slice(2, 4)) + 0.0722 * channel(h.slice(4, 6));
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Two significant figures, so a rounding wobble does not fail the build. */
const ratio = (a: string, b: string): number => Math.round(contrast(a, b) * 100) / 100;

/**
 * CIE L*a*b*, for asking whether two colours look different.
 *
 * Contrast ratio cannot answer that: it compares luminance only, so it scores
 * a saturated orange and a saturated red as near-identical (1.11:1) when they
 * are plainly different to the eye, and would equally score blue and orange of
 * the same lightness as identical. Perceptual distance is the right instrument
 * for "could a technician confuse these two chips", and contrast ratio stays
 * where it belongs — text legibility against its own background.
 */
function lab(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const channel = (pair: string): number => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [channel(h.slice(0, 2)), channel(h.slice(2, 4)), channel(h.slice(4, 6))];
  // sRGB to XYZ (D65), then normalised against the D65 white point.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Euclidean distance in Lab. Roughly: under 2 is invisible, over 10 is obvious. */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.round(Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 10) / 10;
}

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    // Anchors from the spec: identical colours are 1:1, black on white is 21:1.
    expect(ratio('#FFFFFF', '#000000')).toBe(21);
    expect(ratio('#7F7F7F', '#7F7F7F')).toBe(1);
    // A known mid-grey, so a sign error in the gamma step cannot pass.
    expect(ratio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 1);
  });
});

describe.each([
  ['dark', darkTheme],
  ['light', lightTheme],
])('%s theme accent', (_name, theme: Theme) => {
  it('carries its own label at 4.5:1 or better', () => {
    // A filled button: the label sits on `accent`, so this is normal-size text.
    const measured = ratio(theme.color.onAccent, theme.color.accent);
    expect({ onAccent: theme.color.onAccent, accent: theme.color.accent, measured, passes: measured >= 4.5 })
      .toEqual({ onAccent: theme.color.onAccent, accent: theme.color.accent, measured, passes: true });
  });

  it('reads as text on both the background and a card at 4.5:1 or better', () => {
    for (const surface of [theme.color.bg, theme.color.surface] as const) {
      const measured = ratio(theme.color.accentText, surface);
      expect({ surface, measured, passes: measured >= 4.5 }).toEqual({ surface, measured, passes: true });
    }
  });

  it.each(['fail', 'warn', 'pass'] as const)('keeps the accent perceptibly apart from %s', (status) => {
    // The brand is orange and a defect is red: adjacent hues, and the app is
    // read in a dark riser cupboard and in full sun. Measured today at 17.5
    // (light) and 27.4 (dark) against `fail`, which is the tightest pair; the
    // floor sits below that so a deliberate tweak has room, but collapsing the
    // two into the same colour fails here rather than in the field.
    const measured = deltaE(theme.color.accentText, theme.color[status]);
    expect({ status, accentText: theme.color.accentText, against: theme.color[status], measured, distinct: measured >= 15 })
      .toEqual({ status, accentText: theme.color.accentText, against: theme.color[status], measured, distinct: true });
  });

  it('keeps body text well clear of the floor', () => {
    const measured = ratio(theme.color.text, theme.color.bg);
    expect({ measured, passes: measured >= 7 }).toEqual({ measured, passes: true });
  });
});

describe('brand constants', () => {
  it('holds the colours sampled from the letterhead', () => {
    // Sampled from word/media/image1.jpeg in the supplied template. If someone
    // "corrects" these, printed documents stop matching the letterhead.
    expect(brand).toEqual({
      red: '#9E1215',
      orange: '#F1592A',
      swoosh: '#F07110',
      charcoal: '#231F20',
      paper: '#FAFAFA',
    });
  });

  it('records the entity exactly as the letterhead states it', () => {
    expect(company.legalName).toBe('SAFE QLD PTY LTD');
    expect(company.abn).toBe('51 130 129 270');
    expect(company.address).toBe('U3, 61-63 Steel St, Capalaba QLD 4157');
    expect(company.phone).toBe('07 3286 6310');
    expect(company.email).toBe('service@safeqld.com.au');
  });

  it('states an ABN that satisfies the ATO checksum', () => {
    // A transposed digit here goes onto every invoice and report, and looks
    // exactly like a valid ABN until someone tries to use it.
    const digits = [...company.abn.replace(/\s/g, '')].map(Number);
    const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const sum = digits.reduce((acc, d, i) => acc + (i === 0 ? d - 1 : d) * weights[i]!, 0);
    expect({ abn: company.abn, remainder: sum % 89 }).toEqual({ abn: company.abn, remainder: 0 });
  });

  it('derives the accent from the brand rather than drifting from it', () => {
    // The deepened fill must still be recognisably the brand orange: same hue
    // family, darker. Compare against the sampled orange, not a literal.
    expect(darkTheme.color.accentText).toBe(brand.orange);
    expect(relativeLuminance(darkTheme.color.accent)).toBeLessThan(relativeLuminance(brand.orange));
  });
});
