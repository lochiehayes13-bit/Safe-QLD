import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { loadPrefs, patchPrefs } from '@/app-prefs';

/**
 * Light, dark, or whatever the phone is set to.
 *
 * Light is the default, the company website's look. Dark is there for switch
 * rooms and risers, and following the phone for anyone who wants it.
 *
 * The choice lives in preferences with everything else, but it is held in a
 * context as well because the theme has to change the moment somebody picks
 * it, not on the next screen that happens to reload its preferences.
 */
export type ThemeChoice = 'system' | 'dark' | 'light';

export const THEME_CHOICE_LABEL: Record<ThemeChoice, string> = {
  system: 'Follow the phone',
  dark: 'Dark',
  light: 'Light',
};

/** A stored value this build does not recognise falls back to light, the default. */
export function readThemeChoice(value: unknown): ThemeChoice {
  return value === 'dark' || value === 'system' ? value : 'light';
}

/**
 * The stored choice, moved once from the old default to the new one.
 *
 * Every phone that saved its settings under the old build holds 'system',
 * because that was the default and settings are saved whole. Left alone, those
 * phones would go dark at night and never show the new look. So 'system' is
 * read as light once, and the flag records it, so somebody who picks 'Follow
 * the phone' after this keeps it.
 */
export function migratedThemeChoice(stored: unknown, alreadyMoved: boolean): { choice: ThemeChoice; move: boolean } {
  const choice = readThemeChoice(stored);
  if (!alreadyMoved && choice === 'system') return { choice: 'light', move: true };
  return { choice, move: false };
}

/**
 * The mode to draw in, given the stored choice and what the phone says.
 *
 * Pulled out of the provider so the one rule that decides every colour in the
 * app can be checked without mounting anything. `undefined` is the window
 * before preferences have been read: dark, deliberately.
 */
export function resolveMode(
  choice: ThemeChoice | undefined,
  /* Anything the platform might hand back, including its 'unspecified'. */
  scheme: string | null | undefined,
): 'dark' | 'light' {
  // Before preferences are read: the default look, so there is no dark flash.
  if (choice === undefined) return 'light';
  if (choice === 'system') return scheme === 'dark' ? 'dark' : 'light';
  return choice;
}

interface ChoiceContext {
  choice: ThemeChoice;
  /** The mode to actually draw in, once the phone has been consulted. */
  mode: 'dark' | 'light';
  setChoice: (next: ThemeChoice) => void;
}

/*
 * The default is what useTheme falls back on outside a provider — in a test,
 * or in a screen mounted before the root layout. Light, the app's default.
 */
const Ctx = createContext<ChoiceContext>({
  choice: 'light',
  mode: 'light',
  setChoice: () => {},
});

export function ThemeChoiceProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const scheme = useColorScheme();
  // Undefined until the stored choice is read, and light (the splash's own
  // paper) while it is unknown.
  const [choice, setLocal] = useState<ThemeChoice | undefined>(undefined);

  useEffect(() => {
    void loadPrefs()
      .then((p) => {
        const read = migratedThemeChoice(p.theme, p.themeMovedToLight === true);
        setLocal(read.choice);
        if (read.move) void patchPrefs({ theme: read.choice, themeMovedToLight: true }).catch(() => {});
      })
      .catch(() => setLocal('light'));
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
    // What the settings screen shows while the read is in flight is the
    // default, not a guess at what is stored.
    choice: choice ?? 'light',
    mode: resolveMode(choice, scheme),
    setChoice,
  }), [choice, scheme, setChoice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeChoice(): ChoiceContext {
  return useContext(Ctx);
}
