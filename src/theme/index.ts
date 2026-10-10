/**
 * Safe QLD design tokens.
 *
 * Built for the environment the app is actually used in: dark switch rooms and
 * riser cupboards at 2am, and glary rooftops at midday. That means high
 * contrast, large hit targets (techs wear gloves), and a dark default.
 */
import { Platform } from 'react-native';
import { useThemeChoice } from './choice';


export type Mode = 'dark' | 'light';

/**
 * Re-exported so screens can pull brand and tokens from one place, while
 * document builders import `@/theme/brand` directly and stay free of React
 * Native.
 */
export { brand, company } from './brand';

/**
 * The company website's palette (safeqldfire.com.au), so the app and the site
 * read as one company.
 *
 * Crimson is the primary — buttons, links, the active tab — with white on it
 * (7.8:1). Orange is the accent the site uses for a rule or an eyebrow bar,
 * never for text: it is 2.7:1 on white. The neutrals are warm: paper behind
 * everything, white cards with a hairline, ink for text.
 *
 * The dark theme keeps the same family for switch rooms at night: the site's
 * own dark sections (ink and charcoal), crimson buttons unchanged, and a
 * lighter crimson for text and icons where crimson itself would not read.
 */
const palette = {
  crimson: '#9B2335',
  /** Pressed and hover, as the site's buttons do. */
  brick: '#AB4644',
  /** Crimson for text and icons on the dark theme: 5.7:1 on ink. */
  crimsonLight: '#E8868F',
  orange: '#E8833A',

  ink: '#232928',
  charcoal: '#303636',
  slate: '#526664',
  faint: '#5A6762',
  mist: '#8F9992',
  cream: '#E5E3DC',
  paper: '#F7F6F2',
  line: '#D8D5CC',
  lineStrong: '#B9C1BA',
  white: '#FFFFFF',

  // The site's dark sections, darkest first.
  night: '#1A1F1E',
  night2: '#1F2524',
  night3: '#2B3231',
  night4: '#3C4544',
  night5: '#4A5453',

  // Status. Green is the site's own; the failure red sits apart from crimson
  // in hue and is always paired with a word, never colour alone.
  green: '#1C6B3A',
  greenLight: '#5CC285',
  red: '#C0261A',
  redLight: '#FF8A7A',
  amber: '#8A5A00',
  amberLight: '#F2B84B',
  blue: '#1F5F99',
  blueLight: '#7DB7EA',
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
    /** The edge of something you type in or press: 3:1 against its ground, so a field does not vanish in sunlight. */
    borderInput: string;
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
     * The website's two faces, loaded at start-up, one file per weight: Inter
     * for body text, Archivo for headings, labels and buttons. A file is a
     * weight, so a component that sets a family must not also set fontWeight —
     * Android would synthesise a second bold on top of the real one.
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
 * The website's faces, by weight: Inter carries body text, Archivo the
 * structural type — headings, labels, buttons, figures — as on the site. The
 * names are the ones expo-font registers, and the root layout loads exactly
 * these.
 */
export const FONT_FAMILIES: Record<Exclude<FontWeight, 'normal' | 'bold'>, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Archivo_700Bold',
  '800': 'Archivo_800ExtraBold',
  '900': 'Archivo_800ExtraBold',
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
  // The site's corners: 14 for a card, 10–11 for a button or a field.
  radius: { sm: 6, md: 10, lg: 14, xl: 14, pill: 999 },
  font: {
    size: { xs: 12, sm: 14, md: 16, lg: 19, xl: 22, xxl: 28, display: 34 },
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
    family: familyFor,
  },
  touch: 56,
};

const darkShadow = {
  card: { shadowColor: '#000000', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  float: { shadowColor: '#000000', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  glow: { shadowColor: palette.crimson, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
};

// The site's shadows: ink at a tenth, wide and soft.
const lightShadow = {
  card: { shadowColor: palette.ink, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  float: { shadowColor: palette.ink, shadowOpacity: 0.16, shadowRadius: 25, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  glow: { shadowColor: palette.crimson, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
};

export const darkTheme: Theme = {
  ...shared,
  shadow: darkShadow,
  // Solid, as the site's buttons are. Two equal stops so a component that
  // still draws a gradient draws a flat fill.
  gradient: { flame: [palette.crimson, palette.crimson] as const, ground: [palette.night3, palette.night3] as const },
  mode: 'dark',
  color: {
    bg: palette.night,
    bgElevated: palette.night2,
    surface: palette.night2,
    surfaceAlt: palette.night3,
    border: palette.night4,
    borderStrong: palette.night5,
    borderInput: '#7C8783',
    text: '#F1F0EC',
    textMuted: '#B9C1BA',
    textFaint: '#8F9992',
    accent: palette.crimson,
    accentText: palette.crimsonLight,
    onAccent: palette.white,
    pass: palette.greenLight,
    fail: palette.redLight,
    warn: palette.amberLight,
    info: palette.blueLight,
    passBg: 'rgba(92,194,133,0.14)',
    failBg: 'rgba(255,138,122,0.14)',
    warnBg: 'rgba(242,184,75,0.14)',
    infoBg: 'rgba(125,183,234,0.14)',
    accentBg: 'rgba(232,134,143,0.14)',
  },
};

export const lightTheme: Theme = {
  ...shared,
  shadow: lightShadow,
  gradient: { flame: [palette.crimson, palette.crimson] as const, ground: [palette.white, palette.white] as const },
  mode: 'light',
  color: {
    bg: palette.paper,
    bgElevated: palette.white,
    surface: palette.white,
    surfaceAlt: '#EFEDE7',
    border: palette.line,
    borderStrong: palette.lineStrong,
    borderInput: '#7E8782',
    text: palette.ink,
    textMuted: palette.slate,
    textFaint: palette.faint,
    accent: palette.crimson,
    accentText: palette.crimson,
    onAccent: palette.white,
    pass: palette.green,
    fail: palette.red,
    warn: palette.amber,
    info: palette.blue,
    passBg: '#EAF6EE',
    failBg: '#FBEAE8',
    warnBg: '#FBF1DD',
    infoBg: '#E7F0F9',
    accentBg: '#F6E7E9',
  },
};

/**
 * The theme to draw in.
 *
 * The phone's own setting, unless a technician has locked it. See
 * ./choice for why locking it matters on this app in particular.
 */
export function useTheme(): Theme {
  return useThemeChoice().mode === 'light' ? lightTheme : darkTheme;
}
