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
    expect(source).toContain("title=\"The site list could not be read\"");
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
