/**
 * Safe QLD design tokens.
 *
 * Built for the environment the app is actually used in: dark switch rooms and
 * riser cupboards at 2am, and glary rooftops at midday. That means high
 * contrast, large hit targets (techs wear gloves), and a dark default.
 */
import { Platform, useColorScheme } from 'react-native';

import { brand } from './brand';

export type Mode = 'dark' | 'light';

/**
 * Re-exported so screens can pull brand and tokens from one place, while
 * document builders import `@/theme/brand` directly and stay free of React
 * Native.
 */
export { brand, company } from './brand';

const palette = {
  /**
   * Flame orange, and the near-black that rides on it.
   *
   * The first pass at this had to *mute* the brand orange, because a button
   * label is white and white on flame orange is only 2.85:1 — well under the
   * floor. Darkening the fill until white worked meant the app could never be
   * as bright as the brand actually is.
   *
   * Turning the label over solves it the other way round. `onFlame` on `flame`
   * measures 6.92:1, better than the muted fill managed with white, so the
   * accent can be *brighter* than before and more legible at the same time.
   * `flameBright` reads 7.43:1 on the dark background as text and icons.
   *
   * `flameDeep` survives only for the light theme's text, where a flame this
   * bright cannot reach 4.5:1 against near-white paper.
   *
   * All three sit between 44° and 53° in Lab hue — the same warm family as the
   * sampled brand orange at 44.6°, so this reads as the company's colour turned
   * up rather than a different colour.
   */
  flame: '#FF6B1A',
  flameBright: '#FF7A2F',
  flameDeep: '#C4441C',
  onFlame: '#12080A',
  /** Ends the primary gradient. Kept close in hue so the ramp does not band. */
  flameHot: '#FF8C1A',

  // Kept for status colours: a failure must not be mistaken for a brand accent.
  red600: '#E03131',
  red500: '#F03E3E',
  red400: '#FF6B6B',
  red100: '#FFE3E3',

  amber500: '#F59F00',
  amber400: '#FFC93C',

  green500: '#2F9E44',
  green400: '#51CF66',

  blue500: '#1C7ED6',
  blue400: '#4DABF7',

  grey0: '#FFFFFF',
  grey50: '#F8F9FA',
  grey100: '#F1F3F5',
  grey200: '#E9ECEF',
  grey300: '#DEE2E6',
  grey400: '#CED4DA',
  grey500: '#ADB5BD',
  grey600: '#868E96',
  grey700: '#495057',
  grey800: '#343A40',
  grey900: '#212529',

  ink900: '#0B0E13',
  ink850: '#11151C',
  ink800: '#161B24',
  ink750: '#1C222D',
  ink700: '#232B38',
  ink600: '#2E3847',
};

export interface Theme {
  mode: Mode;
  color: {
    bg: string;
    bgElevated: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    borderStrong: string;
    text: string;
    textMuted: string;
    textFaint: string;
    accent: string;
    accentText: string;
    onAccent: string;
    // Semantic status colours used across test results, defects and alarms.
    pass: string;
    fail: string;
    warn: string;
    info: string;
    passBg: string;
    failBg: string;
    warnBg: string;
    infoBg: string;
    /** A wash of the brand colour, for a plate behind an icon rather than a surface to read on. */
    accentBg: string;
  };
  space: (n: number) => number;
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  font: {
    size: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; display: number };
    mono: string;
    /**
     * The face for a weight, or undefined to fall back to the system font.
     *
     * Manrope, loaded at start-up, one file per weight. A file is a weight, so
     * a component that sets a family must not also set fontWeight — Android
     * would synthesise a second bold on top of the real one.
     */
    family: (weight: FontWeight) => string | undefined;
  };
  /** Minimum touch target. 48dp is the Android accessibility floor; gloves want more. */
  touch: number;
  /** The brand ramps, for a hero, a plate behind an icon, or the active tab. */
  gradient: {
    flame: readonly [string, string];
    /** The dark ground the flame sits on, for a hero that is not itself orange. */
    ground: readonly [string, string];
  };
  /** Elevation presets. Soft on purpose: a field app in glare wants edges, not haze. */
  shadow: {
    card: ViewShadow;
    float: ViewShadow;
    glow: ViewShadow;
  };
}

export type FontWeight = '400' | '500' | '600' | '700' | '800' | '900' | 'normal' | 'bold';

export interface ViewShadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

/**
 * Manrope, by weight. The names are the ones expo-font registers from the
 * @expo-google-fonts package, and the root layout loads exactly these.
 */
export const FONT_FAMILIES: Record<Exclude<FontWeight, 'normal' | 'bold'>, string> = {
  '400': 'Manrope_500Medium',
  '500': 'Manrope_500Medium',
  '600': 'Manrope_600SemiBold',
  '700': 'Manrope_700Bold',
  '800': 'Manrope_800ExtraBold',
  '900': 'Manrope_800ExtraBold',
};

/** Whether the faces have been loaded. Flipped once by the root layout; text falls back to the system font until then. */
let fontsReady = false;
export function setFontsReady(ready: boolean): void {
  fontsReady = ready;
}

export function familyFor(weight: FontWeight): string | undefined {
  if (!fontsReady) return undefined;
  const key = weight === 'normal' ? '400' : weight === 'bold' ? '700' : weight;
  return FONT_FAMILIES[key];
}

const shared = {
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 },
  font: {
    size: { xs: 12, sm: 14, md: 17, lg: 20, xl: 24, xxl: 31, display: 42 },
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
    family: familyFor,
  },
  touch: 60,
  gradient: {
    flame: [palette.flame, palette.flameHot] as const,
    ground: [palette.ink750, palette.ink900] as const,
  },
};

const darkShadow = {
  card: { shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  float: { shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  glow: { shadowColor: palette.flame, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
};

const lightShadow = {
  card: { shadowColor: '#1B2430', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  float: { shadowColor: '#1B2430', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  glow: { shadowColor: palette.flame, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
};

export const darkTheme: Theme = {
  ...shared,
  shadow: darkShadow,
  mode: 'dark',
  color: {
    bg: palette.ink900,
    bgElevated: palette.ink850,
    surface: palette.ink800,
    surfaceAlt: palette.ink750,
    border: palette.ink700,
    borderStrong: palette.ink600,
    text: '#EEF2F7',
    textMuted: '#9AA6B6',
    textFaint: '#66748A',
    accent: palette.flame,
    accentText: palette.flameBright,
    onAccent: palette.onFlame,
    pass: palette.green400,
    fail: palette.red400,
    warn: palette.amber400,
    info: palette.blue400,
    passBg: 'rgba(81,207,102,0.14)',
    failBg: 'rgba(255,107,107,0.16)',
    warnBg: 'rgba(255,201,60,0.14)',
    infoBg: 'rgba(77,171,247,0.14)',
    accentBg: 'rgba(255,107,26,0.16)',
  },
};

export const lightTheme: Theme = {
  ...shared,
  shadow: lightShadow,
  gradient: { flame: shared.gradient.flame, ground: [palette.grey0, palette.grey100] as const },
  mode: 'light',
  color: {
    bg: palette.grey50,
    bgElevated: palette.grey0,
    surface: palette.grey0,
    surfaceAlt: palette.grey100,
    border: palette.grey300,
    borderStrong: palette.grey400,
    text: palette.grey900,
    textMuted: palette.grey700,
    textFaint: palette.grey600,
    accent: palette.flame,
    accentText: palette.flameDeep,
    onAccent: palette.onFlame,
    pass: palette.green500,
    fail: palette.red600,
    warn: '#B37500',
    info: palette.blue500,
    passBg: 'rgba(47,158,68,0.10)',
    failBg: 'rgba(224,49,49,0.10)',
    warnBg: 'rgba(245,159,0,0.14)',
    infoBg: 'rgba(28,126,214,0.10)',
    accentBg: 'rgba(255,107,26,0.12)',
  },
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'light' ? lightTheme : darkTheme;
}
