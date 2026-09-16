import Constants from 'expo-constants';
import type { RunningBuild } from '@/domain/updateCheck';

/**
 * Which build this is.
 *
 * CI sets three EXPO_PUBLIC_* variables on the step that bundles the app —
 * the commit, the moment, and the repository whose releases to watch — and
 * Metro inlines each `process.env.EXPO_PUBLIC_…` read at bundle time. They
 * have to be read by that exact spelling: Metro replaces the literal
 * expression, not a variable that happens to hold the name.
 *
 * A development build has none of them, and says so rather than pretending
 * to be a release.
 */

export interface BuildInfo extends RunningBuild {
  /** The repository whose android-latest release is read, as owner/name. */
  repo: string;
  /** The version from app.json, for the About line. */
  version: string | null;
}

/**
 * Where the releases live when the build does not say. The private source
 * repository, which a phone can only read with a token; CI points a release
 * build at the public mirror instead when one is configured.
 */
const DEFAULT_REPO = 'lochiehayes13-bit/Safe-QLD';

function present(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

export function buildInfo(): BuildInfo {
  return {
    sha: present(process.env.EXPO_PUBLIC_BUILD_SHA),
    builtAt: present(process.env.EXPO_PUBLIC_BUILD_TIME),
    repo: present(process.env.EXPO_PUBLIC_UPDATES_REPO) ?? DEFAULT_REPO,
    version: Constants.expoConfig?.version ?? null,
  };
}
