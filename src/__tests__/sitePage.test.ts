import { readFileSync } from 'fs';
import { join } from 'path';
import { showsPanelRows, siteCanBeDeleted, siteListChips } from '@/domain/sitePage';
import { codeOf } from './support/sourceCode';

const read = (...parts: string[]): string =>
  codeOf(readFileSync(join(__dirname, '..', '..', ...parts), 'utf8'));

describe('the chips on a site-list row', () => {
  it('leaves zero panels and points off a site that came from Simpro', () => {
    expect(siteListChips({ panelCount: 0, pointCount: 0, openDefects: 0 })).toEqual([]);
  });

  it('counts what an imported panel brought, in the singular where it is one', () => {
    expect(siteListChips({ panelCount: 1, pointCount: 1, openDefects: 0 }).map((c) => c.label))
      .toEqual(['1 panel', '1 point']);
    expect(siteListChips({ panelCount: 2, pointCount: 1500, openDefects: 0 }).map((c) => c.label))
      .toEqual(['2 panels', '1,500 points']);
  });

  it('says open defects in full and in red', () => {
    expect(siteListChips({ panelCount: 0, pointCount: 0, openDefects: 3 }))
      .toEqual([{ label: '3 open defects', tone: 'fail' }]);
  });

  it('marks an archived site first, however SQLite hands the flag back', () => {
    expect(siteListChips({ panelCount: 0, pointCount: 0, openDefects: 0, archived: 1 })[0])
      .toEqual({ label: 'Archived in Simpro', tone: 'warn' });
    expect(siteListChips({ panelCount: 0, pointCount: 0, openDefects: 0, archived: 0 })).toEqual([]);
    expect(siteListChips({ panelCount: 0, pointCount: 0, openDefects: 0, archived: null })).toEqual([]);
  });
});

describe('deleting a site', () => {
  it('is offered for a site typed in on this device', () => {
    expect(siteCanBeDeleted({})).toBe(true);
    expect(siteCanBeDeleted({ externalId: null })).toBe(true);
    expect(siteCanBeDeleted({ externalId: '  ' })).toBe(true);
  });

  it('is not offered for a site from Simpro, which the next sync brings back empty', () => {
    expect(siteCanBeDeleted({ externalId: '9001' })).toBe(false);
  });

  it('is gated on the site page', () => {
    const page = read('app', 'site', '[id].tsx');
    expect(page).toMatch(/siteCanBeDeleted\(site\) \? \(\s*<Button title="Delete site"/);
  });
});

describe('the site page', () => {
  const page = read('app', 'site', '[id].tsx');

  it('shows the panel rows only once a panel has been imported', () => {
    expect(showsPanelRows(0)).toBe(false);
    expect(showsPanelRows(1)).toBe(true);
    expect(page).toContain('showsPanelRows(panels.length)');
  });

  it('no longer opens the screens that only knew what one phone recorded', () => {
    for (const route of ['/site/due', '/site/history', '/site/coverage', '/site/parts', '/assets/trend']) {
      expect({ route, linked: page.includes(`'${route}'`) }).toEqual({ route, linked: false });
    }
  });

  it('keeps the rows that work on synced data', () => {
    for (const route of [
      '/work/jobs', '/quotes/simpro', '/invoices', '/contacts', '/site/assets', '/site/defects',
      '/site/points', '/site/zones', '/site/cause-effect', '/site/form72', '/site/quote', '/site/bulk-test',
    ]) {
      expect({ route, linked: page.includes(`'${route}'`) }).toEqual({ route, linked: true });
    }
    expect(page).toContain("openRecords('occupier')");
  });

  it('does not promise points added by hand', () => {
    expect(page).not.toMatch(/by hand/);
  });
});

describe('the zone list', () => {
  it('does not promise zones can be added on it', () => {
    expect(read('app', 'site', 'zones.tsx')).not.toMatch(/added on this screen|can be added/);
  });
});

describe('cause and effect', () => {
  const ce = read('app', 'site', 'cause-effect.tsx');

  it('has no test mode whose ticks were thrown away', () => {
    expect(ce).not.toMatch(/'test'/);
    expect(ce).not.toContain('setConfirmed');
    expect(ce).not.toContain('<Segmented');
  });

  it('searches the zones rather than drawing the first sixty', () => {
    expect(ce).not.toContain('slice(0, 60)');
    expect(ce).toContain('searchZones(');
  });
});
