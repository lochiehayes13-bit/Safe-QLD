import { DEFAULT_PREFS } from '@/app-prefs';
import { THEME_CHOICE_LABEL, readThemeChoice } from '@/theme/choice';

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

  it('falls back to following the phone for anything it does not know', () => {
    /*
     * A phone that has been through an older build, a value hand-edited into
     * storage, a half-written preferences blob. None of those should leave the
     * app unable to decide what colour to be.
     */
    for (const junk of ['system', 'Dark', 'auto', '', null, undefined, 7, {}, []]) {
      expect(readThemeChoice(junk)).toBe('system');
    }
  });

  it('starts by following the phone, because most people never think about it', () => {
    expect(DEFAULT_PREFS.theme).toBe('system');
    expect(readThemeChoice(DEFAULT_PREFS.theme)).toBe('system');
  });

  it('has a label for every choice, in words rather than jargon', () => {
    expect(Object.keys(THEME_CHOICE_LABEL).sort()).toEqual(['dark', 'light', 'system']);
    for (const label of Object.values(THEME_CHOICE_LABEL)) {
      expect(label.length).toBeGreaterThan(5);
      expect(label.toLowerCase()).not.toContain('scheme');
    }
  });
});

describe('the splash screen', () => {
  it('is the colour the app actually opens in', () => {
    /*
     * It was #FFFFFF while the app opens on #0B0E13, so every launch was a
     * white flash into a dark app — the one moment a technician in a dark
     * plant room is looking straight at the screen.
     */
    const app = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'app.json'), 'utf8'),
    ) as { expo: { splash: { backgroundColor: string } } };
    expect(app.expo.splash.backgroundColor.toUpperCase()).toBe('#0B0E13');
  });
});
