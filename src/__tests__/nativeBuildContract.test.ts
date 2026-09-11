import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import semver from 'semver';

/**
 * The dependency contract the native build enforces and nothing else does.
 *
 * This app cannot be built into an APK unless the installed packages satisfy
 * each other's peer ranges. Nothing in the rest of this suite can tell: the
 * typecheck reads types, the tests run pure logic, and `expo export` produces
 * a JavaScript bundle. All three pass happily on a tree that Gradle refuses.
 *
 * That happened. react-native-reanimated 4.5.1 peers on react-native-worklets
 * 0.10.x; package.json asked for ^0.12.1; and the .npmrc added to get past
 * npm's ERESOLVE — a real fix for a real problem — meant npm installed the
 * mismatch without complaint. Typecheck, 2,917 tests and the Android bundle
 * all passed. `gradlew assembleRelease` failed on Reanimated's own version
 * assert, which is the only place in the whole pipeline that looks.
 *
 * So the thing that was true and untested is that the tree can actually be
 * built. legacy-peer-deps is still the right setting — without it the first
 * command in RUNNING.md errors out — but it silences the check rather than
 * satisfying it, and this is the check put back where CI can see it.
 */

const require_ = createRequire(`${process.cwd()}/package.json`);

/** A package's manifest, read from where npm actually installed it. */
function manifest(name: string): { version: string; peerDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(require_.resolve(`${name}/package.json`), 'utf8'));
}

const declared: Record<string, string> = {
  ...JSON.parse(readFileSync('package.json', 'utf8')).dependencies,
};

/**
 * The pairs whose disagreement stops a build rather than showing up at
 * runtime. Kept short deliberately: a check over every peer range in the tree
 * would fail on things Expo ships knowingly, and a rule that has to be
 * suppressed is one nobody reads.
 */
const NATIVE_PEERS: [string, string][] = [
  ['react-native-reanimated', 'react-native-worklets'],
];

describe('the dependency tree can actually be built', () => {
  it.each(NATIVE_PEERS)('%s and %s agree on a version', (pkg, peer) => {
    const range = manifest(pkg).peerDependencies?.[peer];
    expect({ pkg, peer, range: typeof range }).toEqual({ pkg, peer, range: 'string' });

    const installed = manifest(peer).version;
    // Named with both versions, because "false" sends somebody to npm ls and
    // the message already knows the answer.
    expect({ installed, range, satisfied: semver.satisfies(installed, range!) })
      .toEqual({ installed, range, satisfied: true });
  });

  it.each(NATIVE_PEERS)('%s pins %s rather than floating past the range', (pkg, peer) => {
    /*
     * The installed version satisfying the range is not enough on its own: it
     * is what npm resolved today, and the check above would keep passing while
     * package.json asked for something that will drift out of it on the next
     * clean install. What has to hold is that every version the declaration
     * permits is a version the build accepts.
     */
    const range = manifest(pkg).peerDependencies?.[peer]!;
    const asked = declared[peer];
    expect({ peer, declared: asked }).toEqual({ peer, declared: expect.any(String) });
    expect({ peer, asked, inRange: semver.subset(asked!, range) })
      .toEqual({ peer, asked, inRange: true });
  });
});
