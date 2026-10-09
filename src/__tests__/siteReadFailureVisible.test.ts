/**
 * A site that could not be read says so, rather than disabling the screen in
 * silence.
 *
 * Two screens failed the same way, and both are time-critical.
 *
 * The critical defect notice reads the defect first and the site second, and
 * `failed` is only rendered on the no-defect path. So a site read that threw
 * left the whole screen drawn, with no error anywhere on it and the site null.
 * The button was disabled only on "not critical", so it stayed live — and
 * pressing it returned at `if (!site) return;` before even the spinner. No
 * PDF, no alert, nothing. On the one document in this app with a twenty-four
 * hour statutory clock, which that very screen counts down.
 *
 * Declaring an impairment had no catch on its site read at all, and rendered
 * the picker only above one site. So a read that rejected — a database locked
 * by a sync is the realistic case — left the list empty for ever, the picker
 * absent, and the technician who filled in the scope was told "Which site?
 * Pick the site the system belongs to", pointing at a control that was not on
 * the page. impairment.siteId is NOT NULL REFERENCES site(id): there is no
 * saving it without one.
 *
 * The two panel-configuration screens failed the third way: both wrote an
 * empty list on a read that threw, which on screen is a phone with no sites on
 * it. One of them carried a comment saying the failure "is reported where the
 * picker would have been", and it was reported nowhere — so a database locked
 * by a sync offered an empty picker beside "Create one from the file", and the
 * technician made a second site for a building the phone already held.
 *
 * Worse on the same screen: the count of what the tied site already holds
 * stored a failed read as null and then read null as zero, so the
 * confirmation printed the reassuring half — "this adds panels rather than
 * replacing anything" — about a site it had not managed to look at. That is
 * the one mistake on that screen nothing in the app undoes: importing inserts
 * panels and never replaces them, so the site ends up holding the building
 * twice and the only remedy is deleting the panels by hand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

describe('the critical defect notice', () => {
  const source = read('app/work/notice/[id].tsx');

  it('forgets the site when the read throws, rather than keeping a stale one', () => {
    const at = source.indexOf("setFailed(describeLoadFailure(e, 'this defect'));");
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 1200)).toContain('setSite(null);');
  });

  it('says why it cannot make the notice', () => {
    expect(source).toContain("title={failed ? 'The site could not be read' : 'This defect has no site on this phone'}");
  });

  it('stops the button rather than letting it do nothing', () => {
    // A live button that returns before its own spinner is read as broken,
    // and the twenty-four hours keep running.
    expect(source).toContain('disabled={!isCritical || !site}');
  });

  it('still refuses a defect that is not critical, which was always right', () => {
    expect(source).toContain('!isCritical');
  });
});

describe('declaring an impairment', () => {
  const source = read('app/impairment/new.tsx');

  it('catches a site read that fails', () => {
    expect(source).toContain('await listSitePicks().catch(() => null)');
    expect(source).toContain('if (rows === null) { setSitesFailed(true); return; }');
  });

  it('says so on screen instead of leaving an empty list', () => {
    expect(source).toContain('title="Couldn\'t load sites"');
  });

  it('offers another go without leaving the screen', () => {
    expect(source).toContain('onPress={() => { setSitesFailed(false); setSiteAttempt((n) => n + 1); }}');
    expect(source).toContain('}, [siteAttempt]);');
  });

  it('shows the picker whatever the list holds', () => {
    /*
     * It rendered only above one site. A phone with exactly one never showed
     * which had been chosen, and a phone with none showed nothing — while the
     * button still demanded a site. SitePicker already has the right words for
     * an empty list; the gate stopped them ever being read.
     */
    expect(source).not.toContain('{sites.length > 1 ? (');
    expect(source).toContain('<SitePicker sites={sites} value={siteId} onChange={setSiteId} />');
  });

  it('and the picker it shows is the shared one, which says what it searched', () => {
    expect(source).toContain("import { SitePicker } from '@/components/SitePicker';");
  });
});

describe('opening a panel configuration', () => {
  const source = read('app/config/[id].tsx');

  it('says why the site list is empty instead of looking like a phone with no sites', () => {
    expect(source).toContain("setSitesFailed(describeLoadFailure(e, 'the site list'))");
    expect(source).toContain('title="The site list could not be read"');
  });

  it('puts that where the picker would have been, which its own comment claimed', () => {
    const at = source.indexOf('{tying ? (');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 700);
    expect(block).toContain('sitesFailed ?');
    expect(block.indexOf('sitesFailed')).toBeLessThan(block.indexOf('<SitePicker'));
  });

  it('tells a failed panel count apart from a site with no panels', () => {
    // Two answers were stored as one, and one of them is "nothing is there".
    expect(source).toContain("useState<number | 'failed' | null>(null)");
    expect(source).toContain("setPanelsOnSite('failed')");
  });

  it('and refuses to claim the site is empty when it could not look', () => {
    const at = source.indexOf('showAlert(\n      `Write into ${siteName}?`');
    expect(at).toBeGreaterThan(-1);
    const alert = source.slice(at, at + 1400);
    expect(alert).toContain("panelsOnSite === 'failed'");
    expect(alert).toContain('could not be read');
    expect(alert).toContain('Open the site');
    // The count is only read as a count where it is one.
    expect(source).toContain("typeof panelsOnSite === 'number' ? panelsOnSite : 0");
  });
});

describe('comparing a configuration against a site', () => {
  const source = read('app/config/compare.tsx');

  it('says why there is nothing to compare against', () => {
    expect(source).toContain("setSitesFailed(describeLoadFailure(e, 'the site list'))");
    expect(source).toContain('title="The site list could not be read"');
  });

  it('shows it above the picker it replaces', () => {
    const at = source.indexOf('Which site is this?');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at);
    const picker = block.indexOf('<SitePicker');
    const said = block.indexOf('sitesFailed');
    expect({ picker: picker > -1, said: said > -1 }).toEqual({ picker: true, said: true });
    expect(said).toBeLessThan(picker);
  });
});

describe('no screen swallows a site list read', () => {
  it('nothing left storing an empty list for a read that threw', () => {
    /*
     * The shape that produced three of these: a catch that writes the empty
     * answer. An empty list and a failed read look the same on screen and have
     * different remedies — one is a sync, the other is a retry.
     */
    for (const file of ['app/config/[id].tsx', 'app/config/compare.tsx', 'app/impairment/new.tsx']) {
      expect({ file, swallows: /listSitePicks\(\)\s*\.then\(setSites\)\s*\.catch\(\(\) => setSites\(\[\]\)\)/.test(read(file)) })
        .toEqual({ file, swallows: false });
    }
  });
});
