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
  };
  space: (n: number) => number;
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  font: {
    size: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; display: number };
    mono: string;
  };
  /** Minimum touch target. 48dp is the Android accessibility floor; gloves want more. */
  touch: number;
}

const shared = {
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 },
  font: {
    size: { xs: 12, sm: 14, md: 17, lg: 20, xl: 24, xxl: 31, display: 42 },
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
  },
  touch: 60,
};

export const darkTheme: Theme = {
  ...shared,
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
  },
};

export const lightTheme: Theme = {
  ...shared,
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
  },
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'light' ? lightTheme : darkTheme;
}
