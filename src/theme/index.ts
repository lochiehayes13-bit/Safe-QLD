/**
 * Safe QLD design tokens.
 *
 * Built for the environment the app is actually used in: dark switch rooms and
 * riser cupboards at 2am, and glary rooftops at midday. That means high
 * contrast, large hit targets (techs wear gloves), and a dark default.
 */
import { Platform, useColorScheme } from 'react-native';

export type Mode = 'dark' | 'light';

const palette = {
  // Fire industry red, desaturated enough to sit on dark without vibrating.
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
  radius: { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 },
  font: {
    size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26, display: 34 },
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
  },
  touch: 52,
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
    accent: palette.red500,
    accentText: palette.red400,
    onAccent: '#FFFFFF',
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
    accent: palette.red600,
    accentText: palette.red600,
    onAccent: '#FFFFFF',
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
