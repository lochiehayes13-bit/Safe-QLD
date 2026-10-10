import { flattenStyle, splitLayoutStyle } from '@/components/layoutStyle';

/**
 * The bottom bar came up on a phone with its six tabs jammed against the
 * left edge, "HomeSitesMapToolsWorkSettings" in one run, and the active tab
 * a blob the width of its icon. Every tab had been given `flex: 1` — on the
 * view the row does not lay out. These pin the split that puts it where the
 * row can see it.
 */

describe('what the parent lays out and what the press scales', () => {
  it('hands flex to the outside and tells the inside to fill it', () => {
    const { outer, inner } = splitLayoutStyle({ flex: 1, padding: 8, backgroundColor: '#fff' });
    expect(outer).toEqual({ flex: 1 });
    expect(inner).toEqual({ padding: 8, backgroundColor: '#fff', flex: 1 });
  });

  it('keeps drawing on the inside where it scales with the thumb', () => {
    const { outer, inner } = splitLayoutStyle({ padding: 12, borderRadius: 16, backgroundColor: '#123' });
    expect(outer).toBeUndefined();
    expect(inner).toEqual({ padding: 12, borderRadius: 16, backgroundColor: '#123' });
  });

  it('positions an absolute pressable from the outside', () => {
    // A floating action button: the parent places it; the circle it draws
    // is the inner view, and it is not asked to stretch — it has a width.
    const { outer, inner } = splitLayoutStyle({ position: 'absolute', right: 16, bottom: 16, width: 56, height: 56, borderRadius: 28, backgroundColor: 'orange' });
    expect(outer).toEqual({ position: 'absolute', right: 16, bottom: 16, width: 56, height: 56 });
    expect(inner).toEqual({ borderRadius: 28, backgroundColor: 'orange', flex: 1 });
  });

  it('flattens the arrays and falsy entries a style prop may carry', () => {
    expect(flattenStyle([{ flex: 1 }, null, undefined, false, [{ padding: 4 }, { padding: 6 }]])).toEqual({ flex: 1, padding: 6 });
    expect(flattenStyle(undefined)).toEqual({});
  });

  it('does not invent a fill when nothing sized the outside', () => {
    // A margin places the pressable but says nothing about its size, so the
    // inner view keeps its natural height rather than being told to grow.
    const { outer, inner } = splitLayoutStyle({ marginTop: 8, opacity: 0.5 });
    expect(outer).toEqual({ marginTop: 8 });
    expect(inner).toEqual({ opacity: 0.5 });
  });

  it('ignores explicit undefineds so an optional style leaves no residue', () => {
    const { outer, inner } = splitLayoutStyle({ flex: undefined, padding: undefined, backgroundColor: 'red' });
    expect(outer).toBeUndefined();
    expect(inner).toEqual({ backgroundColor: 'red' });
  });
});
