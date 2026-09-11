import {
  APK_ASSET, CHECK_EVERY_MS, EMPTY_UPDATE_CHECK, NEWER_BY_AT_LEAST_MS, SNOOZE_MS,
  compareBuild, describeBuild, describeUpdateCheck, formatBuildMoment, offeredRelease, parseRelease, shouldCheck,
  type ReleaseInfo, type RunningBuild, type UpdateCheckRecord,
} from '@/domain/updateCheck';

/**
 * Whether the build on this phone is the one the office last published.
 *
 * The failure this guards is a banner that cries wolf. "A newer build is
 * available" sends a technician through a seventy megabyte download and a
 * reinstall, and the second time it does that for nothing the banner is
 * ignored for good — including the time it matters. So every rule that ends
 * in "newer" is checked from both sides, and every gap in what the release
 * says is checked to come back as unknown rather than as a guess.
 */

/** Noon in Brisbane on a Wednesday. */
const NOW = new Date('2026-09-02T02:00:00Z');
/** 15:41 in Brisbane the same day, as CI stamps it. */
const BUILT = '2026-09-02T05:41:00Z';

const SHA = 'a3bb2b5f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f';
const OTHER = 'b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6';

const minutesAfter = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

const DOWNLOAD = 'https://github.com/lochiehayes13-bit/Safe-QLD/releases/download/android-latest/safe-qld.apk';

/** The release as the GitHub API actually returns it, trimmed to the fields that vary. */
function githubRelease(over: { body?: string; assets?: unknown[] } = {}) {
  return {
    url: 'https://api.github.com/repos/lochiehayes13-bit/Safe-QLD/releases/271828',
    html_url: 'https://github.com/lochiehayes13-bit/Safe-QLD/releases/tag/android-latest',
    id: 271828,
    tag_name: 'android-latest',
    target_commitish: 'main',
    name: 'Safe QLD — latest Android build',
    draft: false,
    prerelease: true,
    created_at: '2026-08-20T01:12:44Z',
    published_at: '2026-08-20T01:12:50Z',
    body: over.body ?? [
      'Sideload build of the Safe QLD field app, rebuilt on every push.',
      '',
      `**[Download safe-qld.apk](${DOWNLOAD})** —`,
      'open this on the phone, tap the file when it finishes, and allow',
      'installing from that source when asked. It appears as **Safe QLD**.',
      '',
      `Built from \`${SHA}\` on main.`,
      '',
      'Signed with the standard Android debug key: fine to sideload, not',
      'accepted by the Play Store.',
    ].join('\n'),
    assets: over.assets ?? [
      {
        id: 314159,
        name: APK_ASSET,
        label: '',
        content_type: 'application/vnd.android.package-archive',
        state: 'uploaded',
        size: 73_400_320,
        download_count: 12,
        created_at: '2026-08-20T01:12:48Z',
        updated_at: '2026-09-02T05:58:12Z',
        browser_download_url: DOWNLOAD,
      },
    ],
  };
}

function release(over: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    sha: OTHER,
    publishedAt: minutesAfter(BUILT, 30),
    apkUrl: DOWNLOAD,
    sizeBytes: 73_400_320,
    ...over,
  };
}

function record(over: Partial<UpdateCheckRecord> = {}): UpdateCheckRecord {
  return { ...EMPTY_UPDATE_CHECK, ...over };
}

describe('parseRelease', () => {
  it('reads the commit, the file, its time and its size off a real release', () => {
    expect(parseRelease(githubRelease())).toEqual({
      sha: SHA,
      publishedAt: '2026-09-02T05:58:12Z',
      apkUrl: DOWNLOAD,
      sizeBytes: 73_400_320,
    });
  });

  it('takes the time from the file, not the release', () => {
    // The release was created once and is updated in place; its own
    // published_at is the first build for good. The file is replaced on
    // every run, so its updated_at is the build the link serves.
    expect(parseRelease(githubRelease()).publishedAt).not.toBe('2026-08-20T01:12:50Z');
  });

  it('has no commit when the notes do not carry the line, and still has the file', () => {
    const body = 'Sideload build of the Safe QLD field app.\n\nSigned with the debug key.';
    expect(parseRelease(githubRelease({ body }))).toEqual({
      sha: null,
      publishedAt: '2026-09-02T05:58:12Z',
      apkUrl: DOWNLOAD,
      sizeBytes: 73_400_320,
    });
  });

  it('reads a short hash in the notes, and lowercases what it reads', () => {
    expect(parseRelease(githubRelease({ body: 'Built from `A3BB2B5` on main.' })).sha).toBe('a3bb2b5');
  });

  it('has no file when nothing is attached, and keeps the commit', () => {
    expect(parseRelease(githubRelease({ assets: [] }))).toEqual({
      sha: SHA, publishedAt: null, apkUrl: null, sizeBytes: null,
    });
  });

  it('only counts the asset with the app’s name', () => {
    // Gradle's own name for the file, or a checksum beside it, is not the download.
    const assets = [
      { name: 'app-release.apk', browser_download_url: 'https://example.invalid/app-release.apk', updated_at: BUILT, size: 1 },
      { name: `${APK_ASSET}.sha256`, browser_download_url: 'https://example.invalid/sum', updated_at: BUILT, size: 64 },
    ];
    expect(parseRelease(githubRelease({ assets })).apkUrl).toBeNull();
  });

  it('reads anything at all without throwing', () => {
    const none = { sha: null, publishedAt: null, apkUrl: null, sizeBytes: null };
    expect(parseRelease(null)).toEqual(none);
    expect(parseRelease('not json')).toEqual(none);
    expect(parseRelease({ message: 'Not Found' })).toEqual(none);
    expect(parseRelease({ body: 42, assets: 'none' })).toEqual(none);
    expect(parseRelease(githubRelease({ assets: [null, 7, { name: APK_ASSET, size: 'big' }] })))
      .toEqual({ sha: SHA, publishedAt: null, apkUrl: null, sizeBytes: null });
  });
});

describe('compareBuild', () => {
  const running: RunningBuild = { sha: SHA, builtAt: BUILT };

  it('is current when the release is this very commit', () => {
    const c = compareBuild(running, release({ sha: SHA }));
    expect(c.verdict).toBe('current');
    expect(c.reason).toMatch(/running the build the office last published/);
  });

  it('matches a short hash in the notes to the full one on the phone', () => {
    expect(compareBuild(running, release({ sha: SHA.slice(0, 7) })).verdict).toBe('current');
    expect(compareBuild({ sha: SHA.slice(0, 7), builtAt: BUILT }, release({ sha: SHA })).verdict).toBe('current');
  });

  it('is newer when a different commit was published well after this build', () => {
    const c = compareBuild(running, release({ publishedAt: minutesAfter(BUILT, 30) }));
    expect(c.verdict).toBe('newer');
    // Both moments in the sentence, in Brisbane time, so the line in
    // Settings can be checked against the release page by eye.
    expect(c.reason).toBe('A build from 2 Sept 2026 16:11 is available; this phone is running one from 2 Sept 2026 15:41.');
  });

  it('does not count a release inside the two-minute guard as newer', () => {
    // Two builds a minute apart are one push seen twice — a cancelled run
    // and its replacement — and the phone should not flap between them.
    expect(compareBuild(running, release({ publishedAt: minutesAfter(BUILT, 1) })).verdict).toBe('current');
    const onTheLine = new Date(Date.parse(BUILT) + NEWER_BY_AT_LEAST_MS).toISOString();
    expect(compareBuild(running, release({ publishedAt: onTheLine })).verdict).toBe('current');
    const justPast = new Date(Date.parse(BUILT) + NEWER_BY_AT_LEAST_MS + 1000).toISOString();
    expect(compareBuild(running, release({ publishedAt: justPast })).verdict).toBe('newer');
  });

  it('is current when the release is a different commit but older than this build', () => {
    // A pull request build on the phone is ahead of main's release.
    const c = compareBuild(running, release({ publishedAt: minutesAfter(BUILT, -90) }));
    expect(c.verdict).toBe('current');
    expect(c.reason).toMatch(/no newer/);
  });

  it('cannot say for a development build', () => {
    const c = compareBuild({ sha: null, builtAt: null }, release());
    expect(c.verdict).toBe('unknown');
    expect(c.reason).toMatch(/development build/i);
  });

  it('cannot say when the notes do not name a commit, however new the file is', () => {
    const c = compareBuild(running, release({ sha: null, publishedAt: minutesAfter(BUILT, 600) }));
    expect(c.verdict).toBe('unknown');
    expect(c.reason).toMatch(/do not say which commit/);
  });

  it('cannot say when there is nothing to download', () => {
    const c = compareBuild(running, release({ apkUrl: null }));
    expect(c.verdict).toBe('unknown');
    expect(c.reason).toContain(APK_ASSET);
  });

  it('never says newer without both times', () => {
    /*
     * A different commit is not the same as a newer one. The build on the
     * phone may be a branch ahead of main, and the only thing that can order
     * the two is a time on each side.
     */
    const cases: [RunningBuild, ReleaseInfo][] = [
      [{ sha: SHA, builtAt: null }, release()],
      [{ sha: SHA, builtAt: '' }, release()],
      [{ sha: SHA, builtAt: 'yesterday' }, release()],
      [running, release({ publishedAt: null })],
      [running, release({ publishedAt: '2/9/2026' })],
      [{ sha: SHA, builtAt: null }, release({ publishedAt: null })],
    ];
    for (const [r, rel] of cases) {
      const c = compareBuild(r, rel);
      expect({ r, rel, verdict: c.verdict }).toEqual({ r, rel, verdict: 'unknown' });
      expect(c.reason).toMatch(/cannot be said which is newer/);
    }
  });
});

describe('describeBuild', () => {
  it('names a development build as one', () => {
    expect(describeBuild({ sha: null, builtAt: null })).toBe('Development build');
    // A time without a commit is not a release build either.
    expect(describeBuild({ sha: null, builtAt: BUILT })).toBe('Development build');
  });

  it('gives the short hash and the Brisbane time', () => {
    expect(describeBuild({ sha: SHA, builtAt: BUILT })).toBe('Build a3bb2b5, 2 Sept 2026 15:41');
  });

  it('gives the hash alone when the time is missing or unreadable', () => {
    expect(describeBuild({ sha: SHA, builtAt: null })).toBe('Build a3bb2b5');
    expect(describeBuild({ sha: SHA, builtAt: 'Tuesday' })).toBe('Build a3bb2b5');
  });

  it('dates the build by the Brisbane day, not the UTC one', () => {
    // Half past nine at night in UTC is half past nine the next morning in
    // Brisbane, and a build made an hour ago should not read as yesterday's.
    expect(describeBuild({ sha: SHA, builtAt: '2026-01-05T23:30:00Z' })).toBe('Build a3bb2b5, 6 Jan 2026 09:30');
    expect(formatBuildMoment('2026-12-31T14:05:00Z')).toBe('1 Jan 2027 00:05');
  });
});

describe('shouldCheck', () => {
  const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

  it('checks a phone that has never had an answer', () => {
    expect(shouldCheck(record(), NOW, false)).toBe(true);
  });

  it('trusts an answer for six hours and no longer', () => {
    expect(shouldCheck(record({ checkedAt: ago(5 * 3_600_000) }), NOW, false)).toBe(false);
    expect(shouldCheck(record({ checkedAt: ago(CHECK_EVERY_MS) }), NOW, false)).toBe(true);
  });

  it('always goes when forced', () => {
    expect(shouldCheck(record({ checkedAt: ago(60_000) }), NOW, true)).toBe(true);
  });

  it('checks again after a failed attempt, since a failure leaves no answer', () => {
    // An offline phone should try again as soon as it is opened with signal,
    // not six hours after the attempt that got nothing.
    expect(shouldCheck(record({ lastError: 'No answer from GitHub — most likely no signal.' }), NOW, false)).toBe(true);
  });

  it('checks when the last answer is in the future', () => {
    expect(shouldCheck(record({ checkedAt: ago(-3_600_000) }), NOW, false)).toBe(true);
  });
});

describe('offeredRelease', () => {
  const newer = record({
    checkedAt: NOW.toISOString(),
    result: { verdict: 'newer', reason: 'A build is available.', release: release() },
  });

  it('offers a newer build', () => {
    expect(offeredRelease(newer, NOW)).toEqual(release());
  });

  it('offers nothing when current or unknown', () => {
    expect(offeredRelease(record({ result: { verdict: 'current', reason: 'Current.', release: release() } }), NOW)).toBeNull();
    expect(offeredRelease(record({ result: { verdict: 'unknown', reason: 'Cannot say.', release: null } }), NOW)).toBeNull();
    expect(offeredRelease(record(), NOW)).toBeNull();
  });

  it('offers nothing while "Not now" is in force for that build', () => {
    const until = new Date(NOW.getTime() + SNOOZE_MS - 60_000).toISOString();
    expect(offeredRelease({ ...newer, snoozedUntil: until, snoozedSha: OTHER }, NOW)).toBeNull();
  });

  it('offers a build that landed after "Not now" was pressed on the last one', () => {
    const until = new Date(NOW.getTime() + SNOOZE_MS - 60_000).toISOString();
    expect(offeredRelease({ ...newer, snoozedUntil: until, snoozedSha: SHA }, NOW)).toEqual(release());
  });

  it('offers the build again once the day is up', () => {
    const until = new Date(NOW.getTime() - 1).toISOString();
    expect(offeredRelease({ ...newer, snoozedUntil: until, snoozedSha: OTHER }, NOW)).toEqual(release());
  });

  it('offers nothing it cannot download, whatever the verdict says', () => {
    const r = { ...newer, result: { ...newer.result!, release: release({ apkUrl: null }) } };
    expect(offeredRelease(r, NOW)).toBeNull();
  });
});

describe('describeUpdateCheck', () => {
  const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
  const answer = { verdict: 'current' as const, reason: 'This phone is running the build the office last published.', release: release() };

  it('says so before anything has been asked', () => {
    expect(describeUpdateCheck(record(), NOW)).toBe('Not checked yet.');
  });

  it('gives the age of the answer and the answer', () => {
    expect(describeUpdateCheck(record({ checkedAt: ago(3 * 3_600_000), result: answer }), NOW))
      .toBe('Checked 3 hours ago — This phone is running the build the office last published.');
    expect(describeUpdateCheck(record({ checkedAt: ago(20_000), result: answer }), NOW))
      .toMatch(/^Checked just now — /);
    expect(describeUpdateCheck(record({ checkedAt: ago(60_000), result: answer }), NOW))
      .toMatch(/^Checked 1 minute ago — /);
    expect(describeUpdateCheck(record({ checkedAt: ago(2 * 24 * 3_600_000), result: answer }), NOW))
      .toMatch(/^Checked 2 days ago — /);
  });

  it('reports a failure that got no answer', () => {
    expect(describeUpdateCheck(record({ lastError: 'No answer from GitHub — most likely no signal.' }), NOW))
      .toBe('Could not check: No answer from GitHub — most likely no signal.');
  });

  it('keeps the last answer beside a later failure', () => {
    // A newer build seen this morning is still waiting this afternoon, and
    // the line should keep saying so.
    const r = record({ checkedAt: ago(3_600_000), result: answer, lastError: 'No answer from GitHub — most likely no signal.' });
    expect(describeUpdateCheck(r, NOW))
      .toBe('Could not check again: No answer from GitHub — most likely no signal. Checked 1 hour ago — This phone is running the build the office last published.');
  });
});
