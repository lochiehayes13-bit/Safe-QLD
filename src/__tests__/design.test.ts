import { FONT_FAMILIES, familyFor, setFontsReady, darkTheme, lightTheme } from '@/theme';

/**
 * The type system.
 *
 * One rule matters and it is invisible in a test runner: with a face loaded
 * per weight, a component must set the family and not the weight, or Android
 * lays a synthetic bold over a real one. So the mapping is pinned here, and
 * so is the fallback — before the faces load, no family, so the system font
 * carries the weight instead.
 */
describe('the face for a weight', () => {
  afterEach(() => setFontsReady(false));

  it('is nothing until the faces have loaded', () => {
    expect(familyFor('700')).toBeUndefined();
  });

  it('maps every weight to a loaded Manrope face once they have', () => {
    setFontsReady(true);
    for (const w of ['400', '500', '600', '700', '800', '900', 'normal', 'bold'] as const) {
      expect({ w, family: familyFor(w) }).toEqual({ w, family: expect.stringMatching(/^Manrope_\d{3}[A-Za-z]+$/) });
    }
    expect(familyFor('bold')).toBe(FONT_FAMILIES['700']);
    expect(familyFor('normal')).toBe(FONT_FAMILIES['400']);
  });

  it('names only faces the root layout loads', () => {
    // The four files useFonts is handed. A fifth name here would render as
    // the system font with no error anywhere.
    const loaded = new Set(['Manrope_500Medium', 'Manrope_600SemiBold', 'Manrope_700Bold', 'Manrope_800ExtraBold']);
    for (const family of Object.values(FONT_FAMILIES)) expect(loaded.has(family)).toBe(true);
  });
});

describe('the ramps and the shadows', () => {
  it('give both themes a flame ramp of two stops and a ground of two', () => {
    for (const th of [darkTheme, lightTheme]) {
      expect(th.gradient.flame).toHaveLength(2);
      expect(th.gradient.ground).toHaveLength(2);
      expect(th.shadow.card.elevation).toBeGreaterThan(0);
      expect(th.shadow.float.elevation).toBeGreaterThan(th.shadow.card.elevation);
    }
  });

  it('keeps the glow the brand colour, so a glow always means the flame', () => {
    expect(darkTheme.shadow.glow.shadowColor).toBe(darkTheme.color.accent);
    expect(lightTheme.shadow.glow.shadowColor).toBe(lightTheme.color.accent);
  });
});
