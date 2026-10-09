import { createReport, createSite, getReport, updateReport } from '@/db/repo';
import {
  TEST_SHEET_FREQUENCIES, defaultSheetTitle, frequencyLabel, newTestSheetInput, sheetMatches,
  titleAfterFrequencyChange,
} from '@/domain/testSheet';
import { serviceReportHtml } from '@/export/pdf';
import { reportCoverSheet, type ReportBundle } from '@/export/sheets';
import type { ServiceReport, Site } from '@/domain/types';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The test sheet's header: frequency, service date and title.
 *
 * Every sheet was created as 'annual' with nothing on the sheet to change it,
 * so a monthly service printed "Service type: annual". The frequency is now
 * picked on the sheet, saved with it, and printed in words.
 */

describe('the frequencies offered', () => {
  it('are the five service intervals, in order, in the words AS 1851 uses', () => {
    expect(TEST_SHEET_FREQUENCIES.map((f) => f.label))
      .toEqual(['Monthly', 'Three-monthly', 'Six-monthly', 'Yearly', 'Five-yearly']);
  });

  it('use the values the domain already names', () => {
    expect(TEST_SHEET_FREQUENCIES.map((f) => f.value))
      .toEqual(['monthly', 'quarterly', 'six-monthly', 'annual', 'five-yearly']);
  });

  it('print in words, including the ones not offered', () => {
    expect(frequencyLabel('annual')).toBe('Yearly');
    expect(frequencyLabel('quarterly')).toBe('Three-monthly');
    expect(frequencyLabel('commissioning')).toBe('Commissioning');
    expect(frequencyLabel('ad-hoc')).toBe('Ad hoc');
    expect(frequencyLabel(undefined)).toBe('');
  });

  it('show an unknown value as it is rather than blank', () => {
    expect(frequencyLabel('weekly')).toBe('weekly');
  });
});

describe('the title following the frequency', () => {
  it('moves a default title to the new frequency', () => {
    expect(titleAfterFrequencyChange(defaultSheetTitle('annual'), 'annual', 'monthly'))
      .toBe('Monthly service');
  });

  it('moves the old site-screen default and a blank title too', () => {
    expect(titleAfterFrequencyChange('Service report — Fictional Tower', 'annual', 'six-monthly', 'Fictional Tower'))
      .toBe('Six-monthly service');
    expect(titleAfterFrequencyChange('', 'annual', 'monthly')).toBe('Monthly service');
  });

  it('leaves a typed title alone', () => {
    expect(titleAfterFrequencyChange('Level 3 retest after fit-out', 'annual', 'monthly')).toBeUndefined();
  });

  it('does nothing when the frequency does not change', () => {
    expect(titleAfterFrequencyChange('Yearly service', 'annual', 'annual')).toBeUndefined();
  });
});

describe('a sheet started from the list', () => {
  it('goes on the one panel a site has, and site-wide otherwise', () => {
    expect(newTestSheetInput({ siteId: 's1', panelIds: ['p1'], today: '2026-10-09' }).panelId).toBe('p1');
    expect(newTestSheetInput({ siteId: 's1', panelIds: ['p1', 'p2'], today: '2026-10-09' }).panelId).toBeUndefined();
    expect(newTestSheetInput({ siteId: 's1', panelIds: [], today: '2026-10-09' }).panelId).toBeUndefined();
  });

  it('is a dated yearly draft with the default title', () => {
    expect(newTestSheetInput({ siteId: 's1', panelIds: [], today: '2026-10-09' })).toEqual({
      siteId: 's1',
      panelId: undefined,
      title: 'Yearly service',
      frequency: 'annual',
      serviceDate: '2026-10-09',
      status: 'draft',
    });
  });

  it('takes the frequency picked with the site, and titles itself to match', () => {
    const input = newTestSheetInput({ siteId: 's1', panelIds: [], today: '2026-10-09', frequency: 'monthly' });
    expect({ f: input.frequency, t: input.title }).toEqual({ f: 'monthly', t: 'Monthly service' });
  });
});

describe('searching the list', () => {
  const sheet = {
    title: 'Monthly service', jobNumber: '9001', customerName: 'Fictional Body Corporate',
    technicianName: 'A Technician', frequency: 'monthly' as const,
  };
  const site = { name: 'Fictional Tower', suburb: 'Main Beach', address: '1 Main St', postcode: '4217' };

  it('finds a sheet by its own words', () => {
    expect(sheetMatches(sheet, site, '9001')).toBe(true);
    expect(sheetMatches(sheet, site, 'technician')).toBe(true);
    expect(sheetMatches(sheet, site, 'monthly')).toBe(true);
  });

  it('finds a sheet by its site, suburb included', () => {
    expect(sheetMatches(sheet, site, 'fictional tower')).toBe(true);
    expect(sheetMatches(sheet, site, 'main beach')).toBe(true);
  });

  it('matches everything when nothing is typed, and nothing that is not there', () => {
    expect(sheetMatches(sheet, site, '  ')).toBe(true);
    expect(sheetMatches(sheet, site, 'hydrant')).toBe(false);
    expect(sheetMatches(sheet, undefined, 'main beach')).toBe(false);
  });
});

describe('saved with the sheet', () => {
  let db: NodeSqliteDb;
  beforeEach(() => { db = openMigrated(); });
  afterEach(async () => { await db.closeAsync(); });

  it('keeps the frequency, service date and title through a save and a reload', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const r = await createReport(newTestSheetInput({ siteId: site.id, panelIds: [], today: '2026-10-09' }));
    await updateReport(r.id, { frequency: 'six-monthly', serviceDate: '2026-10-07', title: 'Six-monthly service' });
    const back = await getReport(r.id);
    expect({ f: back?.frequency, d: back?.serviceDate, t: back?.title })
      .toEqual({ f: 'six-monthly', d: '2026-10-07', t: 'Six-monthly service' });
  });
});

describe('printed', () => {
  const site: Site = {
    id: 's1', name: 'Fictional Tower', address: '1 Main St', suburb: 'Main Beach', state: 'QLD', postcode: '4217',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const report: ServiceReport = {
    id: 'r1', siteId: 's1', title: 'Six-monthly service', frequency: 'six-monthly',
    serviceDate: '2026-10-07', status: 'draft',
    createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z',
  };
  const bundle: ReportBundle = { site, report, testRows: [], checkRows: [], defects: [] };

  it('on the PDF: the title, the frequency in words and the date day first', () => {
    const html = serviceReportHtml(bundle, '2026-10-07T06:00:00.000Z');
    expect(html).toContain('<h1>Six-monthly service</h1>');
    expect(html).toContain('<td>Service type</td><td>Six-monthly</td>');
    expect(html).toContain('07/10/2026');
    expect(html).not.toContain('<td>six-monthly</td>');
  });

  it('on the spreadsheet cover', () => {
    const rows = reportCoverSheet(bundle).rows;
    const serviceType = rows.find((r) => JSON.stringify(r[0] ?? '').includes('Service type'));
    expect(serviceType?.[1]).toBe('Six-monthly');
  });
});
