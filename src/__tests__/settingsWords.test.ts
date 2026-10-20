import { officeSetupStartsOpen, pastedSummary, storageWords } from '@/domain/settingsWords';

const words = (line: string) => line.trim().split(/\s+/).length;

describe('where Settings says things are kept', () => {
  it('never claims a keystore on the web build, which keeps keys in browser storage', () => {
    const web = storageWords(true, 30);
    expect(web.keyPlace).not.toMatch(/keystore/i);
    expect(web.keyPlace).toMatch(/browser/);
    expect(web.dataKept).toMatch(/browser/);
    expect(web.dataKept).not.toMatch(/phone|database/i);
  });

  it('names the keystore and the phone on the native build', () => {
    const phone = storageWords(false, 30);
    expect(phone.keyPlace).toMatch(/keystore/);
    expect(phone.dataKept).toMatch(/phone/);
  });

  it('says how often it syncs, and that the web build only syncs while open', () => {
    expect(storageWords(true, 30).autoSync).toBe('Syncs every 30 minutes while the app is open.');
    expect(storageWords(false, 30).autoSync).toContain('every 30 minutes');
  });

  it('keeps every line short', () => {
    for (const onWeb of [true, false]) {
      const w = storageWords(onWeb, 30);
      expect(words(`Kept ${w.keyPlace}.`)).toBeLessThan(12);
      expect(words(w.dataKept)).toBeLessThan(12);
      expect(words(w.autoSync)).toBeLessThan(12);
    }
  });
});

describe('the pasted oAuth2 confirmation', () => {
  it('lists what was saved in plain English', () => {
    expect(pastedSummary(['client secret'])).toBe('Saved the client secret.');
    expect(pastedSummary(['client ID', 'client secret'])).toBe('Saved the client ID and client secret.');
    expect(pastedSummary(['build domain', 'client ID', 'client secret']))
      .toBe('Saved the build domain, client ID and client secret.');
  });

  it('does not claim a keystore, which the web build does not have', () => {
    expect(pastedSummary(['client secret'])).not.toMatch(/keystore/i);
  });

  it('says so when nothing was saved', () => {
    expect(pastedSummary([])).toBe('Nothing was saved.');
  });
});

describe('Office setup', () => {
  it('starts shut on a phone that can reach Simpro', () => {
    expect(officeSetupStartsOpen('built-in')).toBe(false);
    expect(officeSetupStartsOpen('keystore')).toBe(false);
    expect(officeSetupStartsOpen('proxy')).toBe(false);
  });

  it('starts shut while the secret source is still being read', () => {
    expect(officeSetupStartsOpen(null)).toBe(false);
  });

  it('starts open when there is no secret, so Connect to Simpro lands on the fix', () => {
    expect(officeSetupStartsOpen('none')).toBe(true);
  });
});
