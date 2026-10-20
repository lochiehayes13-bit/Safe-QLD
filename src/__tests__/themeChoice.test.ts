import { DEFAULT_PREFS } from '@/app-prefs';
import { THEME_CHOICE_LABEL, migratedThemeChoice, readThemeChoice, resolveMode } from '@/theme/choice';

/**
 * Whether the app follows the phone, or is told.
 *
 * It is built dark-first: the rooms it is used in are switch rooms, risers and
 * basement carparks. It followed the operating system, so on a handset that
 * turns light at sunrise the app went white at exactly the hour somebody walks
 * into the first plant room of the day, and back to dark on the drive home.
 */
describe('reading the stored choice', () => {
  it('takes the two locks', () => {
    expect(readThemeChoice('dark')).toBe('dark');
    expect(readThemeChoice('light')).toBe('light');
  });

  it('falls back to light, the default, for anything it does not know', () => {
    /*
     * A phone that has been through an older build, a value hand-edited into
     * storage, a half-written preferences blob. None of those should leave the
     * app unable to decide what colour to be.
     */
    for (const junk of ['Dark', 'auto', '', null, undefined, 7, {}, []]) {
      expect(readThemeChoice(junk)).toBe('light');
    }
    expect(readThemeChoice('system')).toBe('system');
  });

  it('moves the old default to light once, and keeps a later choice to follow the phone', () => {
    expect(migratedThemeChoice('system', false)).toEqual({ choice: 'light', move: true });
    expect(migratedThemeChoice('system', true)).toEqual({ choice: 'system', move: false });
    expect(migratedThemeChoice('dark', false)).toEqual({ choice: 'dark', move: false });
    expect(migratedThemeChoice(undefined, false)).toEqual({ choice: 'light', move: false });
  });

  it('starts light, the website\u2019s look; dark and following the phone are choices', () => {
    expect(DEFAULT_PREFS.theme).toBe('light');
    expect(readThemeChoice(DEFAULT_PREFS.theme)).toBe('light');
  });

  it('has a label for every choice, in words rather than jargon', () => {
    expect(Object.keys(THEME_CHOICE_LABEL).sort()).toEqual(['dark', 'light', 'system']);
    for (const label of Object.values(THEME_CHOICE_LABEL)) {
      expect(label.length).toBeGreaterThan(3);
      expect(label.toLowerCase()).not.toContain('scheme');
    }
  });
});

describe('the splash screen', () => {
  it('is the colour the app actually opens in', () => {
    /*
     * The app opens on the website's paper colour, and the splash was a
     * near-black, so every launch flashed dark, and the logo's black
     * "FIRE PROTECTION" line could not be seen on it.
     */
    const app = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'app.json'), 'utf8'),
    ) as { expo: { splash: { backgroundColor: string } } };
    expect(app.expo.splash.backgroundColor.toUpperCase()).toBe('#F7F6F2');
  });
});

/**
 * What is drawn before the stored choice has been read off disk.
 *
 * Preferences are on disk, so there is always a frame or two where the app
 * does not yet know. Asking the phone during that window draws white on a
 * handset set to light — including for somebody who locked the app to dark,
 * which is the one case the lock exists for and the one device it matters on.
 * It also lands white immediately after a splash screen that is this app's
 * own near-black.
 */
describe('the frame before the choice is known', () => {
  it('is light, the default look, whatever the phone is set to', () => {
    expect(resolveMode(undefined, 'light')).toBe('light');
    expect(resolveMode(undefined, 'dark')).toBe('light');
    expect(resolveMode(undefined, null)).toBe('light');
  });

  it('follows the phone once the choice is known to be system', () => {
    expect(resolveMode('system', 'light')).toBe('light');
    expect(resolveMode('system', 'dark')).toBe('dark');
    // A phone that will not say gets the default look.
    expect(resolveMode('system', null)).toBe('light');
  });

  it('ignores the phone entirely once it is locked', () => {
    expect(resolveMode('dark', 'light')).toBe('dark');
    expect(resolveMode('light', 'dark')).toBe('light');
  });
});
