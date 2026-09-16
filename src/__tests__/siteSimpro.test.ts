import { siteCustomers } from '@/domain/siteSimpro';

/**
 * The customer a site belongs to, read off its jobs and quotes.
 *
 * The thing to get right is a site that changed hands: the newest record
 * names the customer the office bills now, and the old one still has jobs
 * under the site. A screen that took the first job it found would open the
 * wrong customer for years.
 */
describe('the customer a site belongs to', () => {
  it('is the one on the most recently changed record, whichever list it came from', () => {
    const jobs = [
      { customerExternalId: '100', customerName: 'Old Body Corporate', dateModified: '2025-02-01T09:00:00+10:00' },
    ];
    const quotes = [
      { customerExternalId: '200', customerName: 'New Managing Agent', dateModified: '2026-08-30T15:30:00+10:00' },
    ];
    expect(siteCustomers(jobs, quotes).map((c) => c.externalId)).toEqual(['200', '100']);
  });

  it('lists each customer once, and takes the name from whichever record has one', () => {
    const jobs = [
      { customerExternalId: '100', dateModified: '2026-08-30T15:30:00+10:00' },
      { customerExternalId: '100', customerName: 'Harbourline Holdings', dateModified: '2026-01-01T08:00:00+10:00' },
    ];
    expect(siteCustomers(jobs)).toEqual([{ externalId: '100', name: 'Harbourline Holdings' }]);
  });

  it('puts records the office never stamped after the ones it did, in the order they arrived', () => {
    const jobs = [
      { customerExternalId: '300', customerName: 'Added by hand first' },
      { customerExternalId: '400', customerName: 'Added by hand second' },
      { customerExternalId: '100', customerName: 'Stamped', dateModified: '2024-05-05T10:00:00+10:00' },
    ];
    expect(siteCustomers(jobs).map((c) => c.externalId)).toEqual(['100', '300', '400']);
  });

  it('skips records with no customer number, and is nobody where none has one', () => {
    expect(siteCustomers([{ customerName: 'Name only' }], [])).toEqual([]);
    expect(siteCustomers([], [])).toEqual([]);
  });

  it('treats an empty name as no name rather than a blank one', () => {
    expect(siteCustomers([{ customerExternalId: '5', customerName: '   ' }])).toEqual([{ externalId: '5', name: undefined }]);
  });
});
