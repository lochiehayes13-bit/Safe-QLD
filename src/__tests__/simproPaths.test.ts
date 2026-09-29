import { collectionPath, recordPath } from '@/simpro/client';
import { SIMPRO_PATHS, ITEM_KINDS, invoiceWindowStart, dateSinceFilter } from '@/simpro/mirrorResources';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The trailing-slash rule, verified on the live build.
 *
 * A collection takes a slash — `jobs/`, `jobs/{id}/sections/` — and a single
 * record takes none: `jobs/{id}/` is a 404 "Invalid route", and so is every
 * other record path with one. The app had `customerAssets/{id}/` on the PATCH
 * that posts a test result, so every result a technician recorded was being
 * refused. The rule is one function and every path is built through it.
 */

describe('recordPath and collectionPath', () => {
  it('strips every trailing slash off a record path', () => {
    expect(recordPath('jobs/43747/')).toBe('jobs/43747');
    expect(recordPath('jobs/43747//')).toBe('jobs/43747');
    expect(recordPath('jobs/43747')).toBe('jobs/43747');
  });

  it('gives a collection exactly one', () => {
    expect(collectionPath('jobs')).toBe('jobs/');
    expect(collectionPath('jobs/')).toBe('jobs/');
    expect(collectionPath('jobs/43747/sections//')).toBe('jobs/43747/sections/');
  });
});

describe('every path the mirror uses', () => {
  const id = '43747';
  const records: [string, string][] = [
    ['job', SIMPRO_PATHS.job(id)],
    ['jobCostCenter', SIMPRO_PATHS.jobCostCenter(id, '1', '2')],
    ['jobAttachment', SIMPRO_PATHS.jobAttachment(id, 'abc123')],
    ['quote', SIMPRO_PATHS.quote(id)],
    ['quoteAttachment', SIMPRO_PATHS.quoteAttachment(id, 'abc123')],
    ['invoice', SIMPRO_PATHS.invoice(id)],
    ['company', SIMPRO_PATHS.company(id)],
    ['individual', SIMPRO_PATHS.individual(id)],
    ['site', SIMPRO_PATHS.site(id)],
    ['customerAsset', SIMPRO_PATHS.customerAsset(id)],
  ];
  const collections: [string, string][] = [
    ['jobs', SIMPRO_PATHS.jobs()],
    ['jobSections', SIMPRO_PATHS.jobSections(id)],
    ['jobCostCenters', SIMPRO_PATHS.jobCostCenters(id, '1')],
    ['jobItems', SIMPRO_PATHS.jobItems(id, '1', '2', 'catalog')],
    ['jobNotes', SIMPRO_PATHS.jobNotes(id)],
    ['jobAttachments', SIMPRO_PATHS.jobAttachments(id)],
    ['jobTimelines', SIMPRO_PATHS.jobTimelines(id)],
    ['jobTasks', SIMPRO_PATHS.jobTasks(id)],
    ['jobInvoices', SIMPRO_PATHS.jobInvoices(id)],
    ['quotes', SIMPRO_PATHS.quotes()],
    ['quoteSections', SIMPRO_PATHS.quoteSections(id)],
    ['quoteCostCenters', SIMPRO_PATHS.quoteCostCenters(id, '1')],
    ['quoteItems', SIMPRO_PATHS.quoteItems(id, '1', '2', 'labor')],
    ['quoteNotes', SIMPRO_PATHS.quoteNotes(id)],
    ['quoteAttachments', SIMPRO_PATHS.quoteAttachments(id)],
    ['invoices', SIMPRO_PATHS.invoices()],
    ['companies', SIMPRO_PATHS.companies()],
    ['individuals', SIMPRO_PATHS.individuals()],
    ['sites', SIMPRO_PATHS.sites()],
    ['customerAssets', SIMPRO_PATHS.customerAssets()],
    ['tasks', SIMPRO_PATHS.tasks()],
  ];

  it.each(records)('%s is a record and ends without a slash', (_name, path) => {
    expect(path.endsWith('/')).toBe(false);
    expect(path.startsWith('/')).toBe(false);
  });

  it.each(collections)('%s is a collection and ends with one slash', (_name, path) => {
    expect(path).toMatch(/[^/]\/$/);
    expect(path.startsWith('/')).toBe(false);
  });

  it('spells the routes the build verified', () => {
    expect(SIMPRO_PATHS.job(id)).toBe('jobs/43747');
    expect(SIMPRO_PATHS.jobSections(id)).toBe('jobs/43747/sections/');
    expect(SIMPRO_PATHS.jobCostCenters(id, '9')).toBe('jobs/43747/sections/9/costCenters/');
    expect(SIMPRO_PATHS.jobCostCenter(id, '9', '12')).toBe('jobs/43747/sections/9/costCenters/12');
    expect(SIMPRO_PATHS.jobAttachments(id)).toBe('jobs/43747/attachments/files/');
    expect(SIMPRO_PATHS.jobAttachment(id, 'f1')).toBe('jobs/43747/attachments/files/f1');
    expect(SIMPRO_PATHS.companies()).toBe('customers/companies/');
    expect(SIMPRO_PATHS.company(id)).toBe('customers/companies/43747');
    expect(SIMPRO_PATHS.customerAsset(id)).toBe('customerAssets/43747');
  });

  it('spells the five item families as the build does', () => {
    const routes = ITEM_KINDS.map((k) => SIMPRO_PATHS.jobItems(id, '1', '2', k));
    expect(routes).toEqual([
      'jobs/43747/sections/1/costCenters/2/catalogs/',
      'jobs/43747/sections/1/costCenters/2/oneOffs/',
      'jobs/43747/sections/1/costCenters/2/labor/',
      'jobs/43747/sections/1/costCenters/2/prebuilds/',
      'jobs/43747/sections/1/costCenters/2/serviceFees/',
    ]);
  });
});

describe('no record path with a trailing slash survives in the resources', () => {
  /*
   * The bug was in a string literal, and a string literal is where it will
   * come back. Any `${id}/` followed by a closing quote or a `?` in the two
   * resource files is a record path written with a slash.
   */
  const files = ['resources.ts', 'mirrorResources.ts', 'sync.ts'].map((f) =>
    readFileSync(join(__dirname, '..', 'simpro', f), 'utf8'),
  );

  it('has none', () => {
    const offences: string[] = [];
    for (const text of files) {
      for (const m of text.matchAll(/`[^`\n]*\$\{[A-Za-z]*[iI]d\}\/`/g)) offences.push(m[0]);
    }
    expect(offences).toEqual([]);
  });
});

describe('the invoice window', () => {
  it('starts two years before today on the Queensland calendar', () => {
    // 09:00 UTC on 2 September is 7pm the same day in Brisbane.
    expect(invoiceWindowStart('2026-09-02T09:00:00.000Z')).toBe('2024-09-02');
    // 15:00 UTC on 2 September is 1am on 3 September in Brisbane.
    expect(invoiceWindowStart('2026-09-02T15:00:00.000Z')).toBe('2024-09-03');
  });

  it('clamps to the last day of a shorter month rather than rolling over', () => {
    expect(invoiceWindowStart('2026-03-31T09:00:00.000Z', 1)).toBe('2026-02-28');
    expect(invoiceWindowStart('2024-05-31T09:00:00.000Z', 3)).toBe('2024-02-29');
  });

  it('writes the threshold filter in Simpro\'s form', () => {
    expect(dateSinceFilter('2024-09-02')).toBe('gt(2024-09-02)');
  });
});
