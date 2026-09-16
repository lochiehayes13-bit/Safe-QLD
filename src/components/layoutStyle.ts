import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Where a pressable's style has to go.
 *
 * A pressable that animates is two views: the outer one is what the parent
 * lays out, the inner one is what scales under the thumb. A caller passes one
 * style and does not know that. So `flex: 1` handed to the inner view is
 * handed to nothing — the outer view is what the row is dividing between its
 * children, and with no flex on it the row gives it the width of its text.
 * That is the squashed tab bar: six tabs each as wide as one word, jammed
 * against the left edge, the active pill shrunk to a blob around its icon.
 *
 * The split is by what the property is for. Anything that tells the parent
 * how big or where this child is goes outside; anything that draws the child
 * — colour, padding, corners, the transform — stays inside where it scales
 * with the press. When the outside is given a size, the inside is told to
 * fill it, so a card given `flex: 1` in a column is not a strip at its top.
 */

const LAYOUT_KEYS = [
  'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight',
  'alignSelf',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'left', 'right', 'bottom', 'start', 'end', 'zIndex',
] as const;

type LayoutKey = (typeof LAYOUT_KEYS)[number];

const SIZING_KEYS: readonly LayoutKey[] = ['flex', 'flexGrow', 'flexBasis', 'width', 'height', 'minHeight', 'maxHeight'];

/** Flattens the nested arrays and dropped entries React Native's style props allow, without touching the platform. */
export function flattenStyle(style: StyleProp<ViewStyle>): ViewStyle {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<ViewStyle>((acc, part) => ({ ...acc, ...flattenStyle(part as StyleProp<ViewStyle>) }), {});
  }
  return typeof style === 'object' ? { ...(style as ViewStyle) } : {};
}

export function splitLayoutStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle | undefined; inner: ViewStyle } {
  const flat = flattenStyle(style);
  const outer: ViewStyle = {};
  const inner: ViewStyle = {};
  let sized = false;
  for (const [key, value] of Object.entries(flat) as [keyof ViewStyle, unknown][]) {
    if (value === undefined) continue;
    if ((LAYOUT_KEYS as readonly string[]).includes(key)) {
      (outer as Record<string, unknown>)[key] = value;
      if ((SIZING_KEYS as readonly string[]).includes(key)) sized = true;
    } else {
      (inner as Record<string, unknown>)[key] = value;
    }
  }
  if (sized) inner.flex = 1;
  return { outer: Object.keys(outer).length ? outer : undefined, inner };
}
