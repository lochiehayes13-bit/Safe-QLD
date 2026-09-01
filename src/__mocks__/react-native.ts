/**
 * The narrowest possible stand-in for React Native under Jest.
 *
 * The test runner is a plain Node environment, so importing the real package
 * fails on ESM. Only the design-token module reaches for React Native outside a
 * component, and it only wants two things, so only those two are provided.
 *
 * Kept deliberately small: a broad mock would let a test pass against a shape
 * React Native does not actually have. If something else here starts needing
 * React Native in a test, add it explicitly rather than widening this.
 */

type PlatformSpec<T> = { ios?: T; android?: T; native?: T; default?: T };

export const Platform = {
  OS: 'android' as const,
  /** Mirrors the real precedence: the platform key, then `native`, then `default`. */
  select<T>(spec: PlatformSpec<T>): T | undefined {
    if ('android' in spec) return spec.android;
    if ('native' in spec) return spec.native;
    return spec.default;
  },
};

/**
 * Fixed to 'dark', which is the app's default when the OS expresses no
 * preference. Tests that care about the light theme import `lightTheme`
 * directly rather than trying to steer this.
 */
export function useColorScheme(): 'light' | 'dark' {
  return 'dark';
}
