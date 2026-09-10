import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { loadPrefs, patchPrefs } from '@/app-prefs';

/**
 * Whether the app follows the phone, or is told.
 *
 * This is built dark-first: the rooms it is used in are switch rooms, risers,
 * plant rooms and basement carparks, and a white screen in one of those is
 * genuinely worse than a dark one. But it followed the operating system, and
 * on a phone that switches to light at sunrise the app goes light at exactly
 * the hour a technician walks into the first plant room of the day — and then
 * back to dark on the drive home, when it does not matter.
 *
 * So it can be locked. 'system' stays the default, because most people never
 * think about this and the operating system is a reasonable guess for them.
 *
 * The choice lives in preferences with everything else, but it is held in a
 * context as well because the theme has to change the moment somebody picks
 * it, not on the next screen that happens to reload its preferences.
 */
export type ThemeChoice = 'system' | 'dark' | 'light';

export const THEME_CHOICE_LABEL: Record<ThemeChoice, string> = {
  system: 'Follow the phone',
  dark: 'Always dark',
  light: 'Always light',
};

/** A stored value this build does not recognise falls back to following the phone. */
export function readThemeChoice(value: unknown): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system';
}

interface ChoiceContext {
  choice: ThemeChoice;
  /** The mode to actually draw in, once the phone has been consulted. */
  mode: 'dark' | 'light';
  setChoice: (next: ThemeChoice) => void;
}

/*
 * The default is what useTheme falls back on outside a provider — in a test,
 * or in a screen mounted before the root layout. Dark, because that is this
 * app's own default, and because the alternative is a white flash.
 */
const Ctx = createContext<ChoiceContext>({
  choice: 'system',
  mode: 'dark',
  setChoice: () => {},
});

export function ThemeChoiceProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const scheme = useColorScheme();
  const [choice, setLocal] = useState<ThemeChoice>('system');

  useEffect(() => {
    // Preferences are on disk, so the first frame is drawn on the default and
    // corrected a moment later. Dark-to-dark is invisible; light is the one
    // somebody chose and it arrives fast enough not to read as a flash.
    void loadPrefs().then((p) => setLocal(readThemeChoice(p.theme))).catch(() => {});
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setLocal(next);
    void patchPrefs({ theme: next })
      .catch(() => {
        /*
         * The screen has already changed colour. A failure to write means it
         * is back to whatever it was on the next launch, which is visible and
         * self-explaining in a way an error box about a colour scheme is not.
         */
      });
  }, []);

  const value = useMemo<ChoiceContext>(() => ({
    choice,
    mode: choice === 'system' ? (scheme === 'light' ? 'light' : 'dark') : choice,
    setChoice,
  }), [choice, scheme, setChoice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeChoice(): ChoiceContext {
  return useContext(Ctx);
}
