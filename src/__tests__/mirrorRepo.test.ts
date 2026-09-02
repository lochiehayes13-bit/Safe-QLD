import { getJob, listJobs, setJobStatus, upsertJob } from '@/db/opsRepo';
import {
  customerStats, getCustomer, getInvoice, getJobFull, getQuoteFull, heldJobExternalIds, jobDetailIsStale,
  jobRowFromSimpro, jobsWantingDetail, listInvoices, listJobsFor, listQuotes, listTasks, localJobId,
  pruneCustomersNotSyncedAt, quotesWantingDetail, replaceJobChildren, replaceQuoteChildren, scheduledJobExternalIds,
  searchCustomers, setJobAttachmentLocalUri, siteStats, upsertCustomer, upsertInvoice, upsertQuote, upsertTasks,
} from '@/db/mirrorRepo';
import type {
  SimproCustomer, SimproInvoice, SimproJob, SimproJobDetail, SimproQuote, SimproSection, SimproTask,
} from '@/simpro/mirrorResources';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The mirror's repository, run against the schema on Node's SQLite.
 *
 * Reading the SQL as text catches a column that does not exist. It does not
 * catch a conflict clause that blanks a detail-level field on a list-level
 * pull, a replace that loses the attachment somebody already opened, or a
 * stats query that counts an invoice twice because it bills two jobs on the
 * same site. Those only show when the statements run.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

const AT = '2026-09-02T00:30:00.000Z';

const job = (over: Partial<SimproJob> = {}): SimproJob => ({
  DateModified: '2026-08-30T09:12:44+10:00',
  id: '43747',
  title: 'Six monthly routine',
  description: 'Six monthly service.',
  customerId: '812',
  customerName: 'Harbourline Body Corporate',
  siteId: '3021',
  siteName: 'Harbourline Apartments',
  siteContact: { id: '55', name: 'Dana Reyes', email: 'dana@example.invalid' },
  stage: 'Progress',
  status: 'In Progress',
  statusColor: '#f5a623',
  issuedAt: '2026-08-28',
  type: 'Service',
  orderNo: 'PO-7781',
  tags: ['Strata'],
  technicians: [{ id: '12', name: 'Sam Okafor' }],
  totalExTaxCents: 152350,
  totalIncTaxCents: 167585,
  ...over,
});

const sections = (): SimproSection[] => [{
  id: '5', name: 'Section 1', displayOrder: 0,
  costCenters: [{
    id: '77', name: 'Fire Service', setupCostCenterId: '3', setupCostCenterName: 'Fire Service', displayOrder: 1,
    totalExTaxCents: 50000, totalIncTaxCents: 55000, percentComplete: 40,
    items: [
      { id: '501', kind: 'catalog', description: 'Optical smoke detector', partNo: 'SD-OPT-01', catalogId: '9001', qty: 3, unitSellExTaxCents: 5562, unitSellIncTaxCents: 6118, sellExTaxCents: 16686, sellIncTaxCents: 18355, billableStatus: 'Billable', discountPercent: 0 },
      { id: '501', kind: 'oneOff', description: 'Site attendance', qty: 1, sellExTaxCents: 12000, sellIncTaxCents: 13200 },
    ],
  }],
}];

async function seedSite(id: string, name: string): Promise<void> {
  await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES (?,?,'','')", id, name);
}

describe('a job row from the office', () => {
  it('writes the full column set and reads it back', async () => {
    await seedSite('site-1', 'Harbourline Apartments');
    await upsertJob(jobRowFromSimpro(job(), 'site-1'));
    const held = await getJob(localJobId('43747'));
    expect(held).toMatchObject({
      id: 'simpro-43747', externalId: '43747', siteId: 'site-1', siteExternalId: '3021', siteName: 'Harbourline Apartments',
      customerExternalId: '812', customerName: 'Harbourline Body Corporate', title: 'Six monthly routine',
      stage: 'Progress', stageRaw: 'Progress', jobType: 'Service', jobTypeRaw: 'Service', status: 'scheduled',
      orderNo: 'PO-7781', statusName: 'In Progress', statusColor: '#f5a623', technician: 'Sam Okafor',
      descriptionText: 'Six monthly service.', totalExTaxCents: 152350, totalIncTaxCents: 167585,
      dateModified: '2026-08-30T09:12:44+10:00', scheduledFor: '2026-08-28',
    });
    expect(JSON.parse(held!.techniciansJson!)).toEqual([{ id: '12', name: 'Sam Okafor' }]);
    expect(JSON.parse(held!.tagsJson!)).toEqual(['Strata']);
    expect(JSON.parse(held!.siteContactJson!)).toMatchObject({ name: 'Dana Reyes' });
    expect(await heldJobExternalIds()).toEqual(new Set(['43747']));
  });

  it('keeps the status the technician set when the office re-sends the job with its new columns', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    await setJobStatus('simpro-43747', 'in-progress');
    await upsertJob(jobRowFromSimpro(job({ status: 'Awaiting parts', orderNo: 'PO-7782' }), undefined));
    const held = await getJob('simpro-43747');
    expect(held?.status).toBe('in-progress');
    // The office's own fields still move.
    expect(held?.statusName).toBe('Awaiting parts');
    expect(held?.orderNo).toBe('PO-7782');
  });

  it('does not let a list-level pull blank what only the record carries', async () => {
    const detail: SimproJobDetail = {
      ...job(), notes: 'Panel is on level 1.',
      customerContract: { id: '31', name: 'Harbourline annual', contractNo: 'C-31' },
      technician: { id: '12', name: 'Sam Okafor' },
    };
    await upsertJob(jobRowFromSimpro(detail, undefined));
    await replaceJobChildren('simpro-43747', {}, AT);
    // The list row, which knows nothing of notes or the contract.
    await upsertJob(jobRowFromSimpro(job(), undefined));
    const held = await getJob('simpro-43747');
    expect(held?.notesText).toBe('Panel is on level 1.');
    expect(JSON.parse(held!.customerContractJson!)).toMatchObject({ contractNo: 'C-31' });
    expect(held?.detailSyncedAt).toBe(AT);
  });

  it('files invoiced and archived jobs as complete, not as open work from years ago', async () => {
    // Every job on the books is held now, and the screens count anything not
    // complete as open. Only Complete used to map, which would have put every
    // invoiced and archived job since 2019 on the open list.
    for (const [id, stage] of [['1', 'Pending'], ['2', 'Progress'], ['3', 'Complete'], ['4', 'Invoiced'], ['5', 'Archived']]) {
      await upsertJob(jobRowFromSimpro(job({ id, stage }), undefined));
    }
    const open = (await listJobs({ limit: 10 })).filter((j) => j.status !== 'complete').map((j) => j.externalId);
    expect(open.sort()).toEqual(['1', '2']);
    // And the raw stage is kept for anything that wants the office's word.
    expect((await getJob('simpro-4'))?.stageRaw).toBe('Invoiced');
  });

  it('lists open work first and finished work newest first, so a cap does not hide this week', async () => {
    await upsertJob(jobRowFromSimpro(job({ id: '1', stage: 'Complete', issuedAt: '2019-03-01' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '2', stage: 'Complete', issuedAt: '2026-08-28' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '3', stage: 'Pending', issuedAt: '2026-09-09' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '4', stage: 'Progress', issuedAt: '2026-09-02' }), undefined));
    expect((await listJobs({ limit: 3 })).map((j) => j.externalId)).toEqual(['4', '3', '2']);
    expect((await listJobs({ status: 'complete', limit: 10 })).map((j) => j.externalId)).toEqual(['2', '1']);
  });

  it('lists jobs by site, by customer and by stage', async () => {
    await seedSite('site-1', 'A');
    await upsertJob(jobRowFromSimpro(job(), 'site-1'));
    await upsertJob(jobRowFromSimpro(job({ id: '43748', stage: 'Complete', customerId: '900' }), 'site-1'));
    await upsertJob(jobRowFromSimpro(job({ id: '43749', siteId: '9', customerId: '812' }), undefined));
    expect((await listJobsFor({ siteId: 'site-1' })).map((j) => j.externalId).sort()).toEqual(['43747', '43748']);
    expect((await listJobsFor({ customerExternalId: '812' })).map((j) => j.externalId).sort()).toEqual(['43747', '43749']);
    expect((await listJobsFor({ stages: ['Pending', 'Progress'] })).map((j) => j.externalId).sort()).toEqual(['43747', '43749']);
  });
});

describe('what sits under a job', () => {
  it('assembles the children the way the screen reads them', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    const tasks: SimproTask[] = [{ id: 't1', subject: 'Chase PO', assignees: ['Office'], dueDate: '2026-09-05' }];
    await replaceJobChildren('simpro-43747', {
      sections: sections(),
      notes: [{ id: 'n1', subject: 'Access', note: 'Key in lockbox', createdAt: '2026-08-29T08:00:00+10:00', createdBy: 'Sam Okafor', visibleToCustomer: false }],
      attachments: [{ id: 'a1', filename: 'panel.jpg', mimeType: 'image/jpeg', sizeBytes: 20480, dateAdded: '2026-08-29 08:00:00+10', addedBy: 'Sam Okafor', public: true }],
      timeline: [
        { type: 'Mobile Status', message: 'Started', staffId: '12', staffName: 'Sam Okafor', at: '2026-08-30T07:31:00+10:00' },
        { type: 'Mobile Status', message: 'Finished', staffId: '12', staffName: 'Sam Okafor', at: '2026-08-30T09:10:00+10:00' },
      ],
      tasks,
    }, AT);

    const full = await getJobFull('simpro-43747');
    expect(full).not.toBeNull();
    expect(full!.detailSynced).toBe(true);
    expect(full!.job.detailSyncedAt).toBe(AT);
    expect(full!.technicians).toEqual([{ id: '12', name: 'Sam Okafor' }]);
    expect(full!.tags).toEqual(['Strata']);
    expect(full!.siteContact?.name).toBe('Dana Reyes');

    expect(full!.sections).toHaveLength(1);
    const cc = full!.sections[0]!.costCenters[0]!;
    expect(cc).toMatchObject({ id: '77', name: 'Fire Service', totalExTaxCents: 50000, percentComplete: 40 });
    // Two lines with the same id in different families both survive.
    expect(cc.items.map((i) => `${i.kind}:${i.id}`)).toEqual(['catalog:501', 'oneOff:501']);
    expect(cc.items[0]).toMatchObject({ partNo: 'SD-OPT-01', qty: 3, sellExTaxCents: 16686, unitSellIncTaxCents: 6118 });

    expect(full!.notes).toEqual([{
      id: 'n1', subject: 'Access', note: 'Key in lockbox', createdAt: '2026-08-29T08:00:00+10:00', createdBy: 'Sam Okafor',
      visibleToCustomer: false, referenceType: undefined, referenceNumber: undefined,
    }]);
    expect(full!.attachments[0]).toMatchObject({ id: 'a1', filename: 'panel.jpg', sizeBytes: 20480, public: true, localUri: undefined });
    // Newest first.
    expect(full!.timeline.map((t) => t.message)).toEqual(['Finished', 'Started']);
    expect(full!.tasks).toHaveLength(1);
    expect(full!.tasks[0]).toMatchObject({ id: 't1', jobId: 'simpro-43747', subject: 'Chase PO', assignees: ['Office'] });
  });

  it('replaces the children whole, so a section deleted in the office goes here too', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    await replaceJobChildren('simpro-43747', { sections: sections(), notes: [{ id: 'n1', subject: 'old' }] }, AT);
    await replaceJobChildren('simpro-43747', { sections: [], notes: [{ id: 'n2', subject: 'new' }] }, AT);
    const full = await getJobFull('simpro-43747');
    expect(full!.sections).toEqual([]);
    expect(full!.notes.map((n) => n.subject)).toEqual(['new']);
    // And the lines under the removed section went with it.
    expect(await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM job_item')).toEqual({ n: 0 });
  });

  it('leaves a family alone when the read did not include it', async () => {
    // A key that cannot read notes must not cost the notes read last week.
    await upsertJob(jobRowFromSimpro(job(), undefined));
    await replaceJobChildren('simpro-43747', { sections: sections(), notes: [{ id: 'n1', subject: 'kept' }] }, AT);
    await replaceJobChildren('simpro-43747', { sections: [] }, '2026-09-02T01:00:00.000Z');
    const full = await getJobFull('simpro-43747');
    expect(full!.notes.map((n) => n.subject)).toEqual(['kept']);
    expect(full!.sections).toEqual([]);
    expect(full!.job.detailSyncedAt).toBe('2026-09-02T01:00:00.000Z');
  });

  it('keeps where an attachment was saved on this phone across a re-read', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    const attachments = [{ id: 'a1', filename: 'panel.jpg' }, { id: 'a2', filename: 'pump.jpg' }];
    await replaceJobChildren('simpro-43747', { attachments }, AT);
    await setJobAttachmentLocalUri('simpro-43747', 'a1', 'file:///photos/a1.jpg');
    await replaceJobChildren('simpro-43747', { attachments }, AT);
    const full = await getJobFull('simpro-43747');
    expect(full!.attachments.find((a) => a.id === 'a1')?.localUri).toBe('file:///photos/a1.jpg');
    expect(full!.attachments.find((a) => a.id === 'a2')?.localUri).toBeUndefined();
  });

  it('goes with the job when the job is deleted', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    await replaceJobChildren('simpro-43747', { sections: sections(), timeline: [{ message: 'x' }] }, AT);
    await db.runAsync('DELETE FROM job WHERE id = ?', 'simpro-43747');
    for (const table of ['job_section', 'job_cost_center', 'job_item', 'job_timeline']) {
      expect(await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual({ n: 0 });
    }
  });

  it('returns null for a job it does not hold', async () => {
    expect(await getJobFull('simpro-1')).toBeNull();
  });
});

describe('deciding which jobs to read in full', () => {
  it('reads a job never read, and one read too long ago, and skips a fresh one', () => {
    const now = Date.parse(AT);
    expect(jobDetailIsStale({ detailSyncedAt: undefined }, 15 * 60_000, now)).toBe(true);
    expect(jobDetailIsStale({ detailSyncedAt: '2026-09-02T00:10:00.000Z' }, 15 * 60_000, now)).toBe(true);
    expect(jobDetailIsStale({ detailSyncedAt: '2026-09-02T00:20:00.000Z' }, 15 * 60_000, now)).toBe(false);
    expect(jobDetailIsStale({ detailSyncedAt: 'last tuesday' }, 15 * 60_000, now)).toBe(true);
  });

  it('puts the booked jobs first, in booking order, then the recently changed, newest first', async () => {
    await upsertJob(jobRowFromSimpro(job({ id: '1', DateModified: '2026-08-01T00:00:00+10:00' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '2', DateModified: '2026-08-31T00:00:00+10:00' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '3', DateModified: '2026-08-29T00:00:00+10:00' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '4', DateModified: '2026-09-01T00:00:00+10:00' }), undefined));
    // Read a moment ago: skipped however it ranks.
    await replaceJobChildren('simpro-4', {}, AT);

    const wanted = await jobsWantingDetail({
      preferExternalIds: ['3', '1'], modifiedSince: '2026-08-20', maxAgeMs: 15 * 60_000, limit: 10, now: Date.parse(AT),
    });
    expect(wanted.map((w) => w.externalId)).toEqual(['3', '1', '2']);
  });

  it('cuts the list at the cap and asks nothing when it has nothing to go on', async () => {
    for (const id of ['1', '2', '3']) await upsertJob(jobRowFromSimpro(job({ id }), undefined));
    expect(await jobsWantingDetail({ preferExternalIds: ['1', '2', '3'], maxAgeMs: 1, limit: 2 })).toHaveLength(2);
    expect(await jobsWantingDetail({ maxAgeMs: 1, limit: 2 })).toEqual([]);
  });

  it('reads the booked job numbers off the schedule, soonest first, for one person or everyone', async () => {
    const rows: [string, string, string, string][] = [
      ['s1', '43749', '12', '2026-09-04'], ['s2', '43747', '12', '2026-09-02'], ['s3', '43748', '15', '2026-09-03'],
      ['s4', '43747', '12', '2026-09-05'],
    ];
    for (const [id, jobId, staffId, date] of rows) {
      await db.runAsync(
        "INSERT INTO schedule (id, jobId, staffId, staffName, date, syncedAt) VALUES (?,?,?,?,?,'')", id, jobId, staffId, `Staff ${staffId}`, date,
      );
    }
    expect(await scheduledJobExternalIds({ from: '2026-09-02', to: '2026-09-30' })).toEqual(['43747', '43748', '43749']);
    expect(await scheduledJobExternalIds({ from: '2026-09-02', to: '2026-09-30', staffId: '12' })).toEqual(['43747', '43749']);
    expect(await scheduledJobExternalIds({ from: '2026-09-02', to: '2026-09-30', staffName: 'staff 15' })).toEqual(['43748']);
    expect(await scheduledJobExternalIds({ from: '2026-09-03', to: '2026-09-03' })).toEqual(['43748']);
  });
});

describe('quotes', () => {
  const quote = (over: Partial<SimproQuote> = {}): SimproQuote => ({
    DateModified: '2026-08-02T10:00:00+10:00',
    id: '990', name: 'Detector replacement L2', customerId: '812', customerName: 'Harbourline Body Corporate',
    siteId: '3021', siteName: 'Harbourline Apartments', stage: 'InProgress', customerStage: 'Pending',
    status: 'Quote : Sent', dateIssued: '2026-08-01', validityDays: 30, isClosed: false,
    totalExTaxCents: 240000, totalIncTaxCents: 264000, technicians: [], salesperson: 'Jo Marsh', tags: [],
    ...over,
  });

  it('writes a quote, its children and reads them back whole', async () => {
    await seedSite('site-1', 'Harbourline Apartments');
    await upsertQuote(quote(), 'site-1', AT);
    await replaceQuoteChildren('990', { sections: sections(), notes: [{ id: 'q1', subject: 'Scope' }], attachments: [{ id: 'f1', filename: 'scope.pdf' }] }, AT);
    const full = await getQuoteFull('990');
    expect(full!.quote).toMatchObject({
      externalId: '990', name: 'Detector replacement L2', siteId: 'site-1', siteExternalId: '3021', stage: 'InProgress',
      isClosed: false, totalExTaxCents: 240000, salesperson: 'Jo Marsh', detailSyncedAt: AT,
    });
    expect(full!.sections[0]!.costCenters[0]!.items).toHaveLength(2);
    expect(full!.notes.map((n) => n.subject)).toEqual(['Scope']);
    expect(full!.attachments.map((a) => a.filename)).toEqual(['scope.pdf']);
    expect(await getQuoteFull('991')).toBeNull();
  });

  it('keeps the record-only fields across a list-level write, and lists by site, customer and openness', async () => {
    await upsertQuote({ ...quote(), notes: 'Approved by phone', customerContact: { name: 'Pat Singh' } }, undefined, AT);
    await upsertQuote(quote(), undefined, AT);
    const held = (await listQuotes({ customerExternalId: '812' }))[0]!;
    expect(held.notes).toBe('Approved by phone');
    expect(held.customerContact?.name).toBe('Pat Singh');

    await upsertQuote(quote({ id: '991', isClosed: true }), undefined, AT);
    await upsertQuote(quote({ id: '992', jobId: '43747' }), undefined, AT);
    await upsertQuote(quote({ id: '993', siteId: '9', customerId: '5' }), undefined, AT);
    expect((await listQuotes({ openOnly: true })).map((q) => q.externalId).sort()).toEqual(['990', '993']);
    expect((await listQuotes({ siteExternalId: '3021' })).map((q) => q.externalId).sort()).toEqual(['990', '991', '992']);
    expect((await listQuotes({ stage: 'InProgress', customerExternalId: '5' })).map((q) => q.externalId)).toEqual(['993']);
  });

  it('names the quotes changed lately whose children have not been read', async () => {
    await upsertQuote(quote({ id: '1', DateModified: '2026-08-30T00:00:00+10:00' }), undefined, AT);
    await upsertQuote(quote({ id: '2', DateModified: '2026-08-01T00:00:00+10:00' }), undefined, AT);
    await upsertQuote(quote({ id: '3', DateModified: '2026-09-01T00:00:00+10:00' }), undefined, AT);
    await replaceQuoteChildren('3', {}, AT);
    expect(await quotesWantingDetail({ modifiedSince: '2026-08-20', maxAgeMs: 15 * 60_000, limit: 10, now: Date.parse(AT) })).toEqual(['1']);
    expect(await quotesWantingDetail({ maxAgeMs: 1, limit: 10 })).toEqual([]);
  });
});

describe('invoices', () => {
  const invoice = (over: Partial<SimproInvoice> = {}): SimproInvoice => ({
    DateModified: '2026-08-31T16:00:00+10:00',
    id: '7001', type: 'TaxInvoice', customerId: '812', customerName: 'Harbourline Body Corporate',
    jobs: [{ id: '43747', type: 'Service', description: 'Six monthly', totalExTaxCents: 152350, totalIncTaxCents: 167585 }],
    dateIssued: '2026-08-31', stage: 'Approved', status: 'Invoice : Sent', isPaid: false, dueDate: '2026-09-30',
    totalExTaxCents: 152350, totalIncTaxCents: 167585, amountAppliedCents: 0, balanceDueCents: 167585,
    ...over,
  });

  it('writes an invoice with the jobs it bills and lists it by job, customer, and unpaid', async () => {
    await upsertInvoice(invoice(), AT);
    await upsertInvoice(invoice({ id: '7002', isPaid: true, balanceDueCents: 0, jobs: [{ id: '43748' }], dateIssued: '2025-01-15' }), AT);
    const held = await getInvoice('7001');
    expect(held).toMatchObject({ externalId: '7001', isPaid: false, balanceDueCents: 167585, dueDate: '2026-09-30' });
    expect(held!.jobs).toEqual([{ id: '43747', type: 'Service', description: 'Six monthly', totalExTaxCents: 152350, totalIncTaxCents: 167585 }]);

    expect((await listInvoices({ jobExternalId: '43747' })).map((i) => i.externalId)).toEqual(['7001']);
    expect((await listInvoices({ customerExternalId: '812' })).map((i) => i.externalId)).toEqual(['7001', '7002']);
    expect((await listInvoices({ unpaidOnly: true })).map((i) => i.externalId)).toEqual(['7001']);
    expect((await listInvoices({ since: '2026-01-01' })).map((i) => i.externalId)).toEqual(['7001']);
    expect(await getInvoice('9')).toBeNull();
  });

  it('re-points the job links when an invoice is re-issued against another job', async () => {
    await upsertInvoice(invoice(), AT);
    await upsertInvoice(invoice({ jobs: [{ id: '43750' }] }), AT);
    expect((await getInvoice('7001'))!.jobs.map((j) => j.id)).toEqual(['43750']);
    expect(await listInvoices({ jobExternalId: '43747' })).toEqual([]);
  });

  it('shows up under the job it bills', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    await upsertInvoice(invoice(), AT);
    expect((await getJobFull('simpro-43747'))!.invoices.map((i) => i.externalId)).toEqual(['7001']);
  });
});

describe('customers', () => {
  const company = (over: Partial<SimproCustomer> = {}): SimproCustomer => ({
    DateModified: '2026-07-10T09:00:00+10:00',
    id: '812', type: 'Company', name: 'Harbourline Body Corporate', phone: '07 3000 0000', email: 'office@example.invalid',
    address: { address: '1 Quay St', suburb: 'Brisbane', state: 'QLD', postcode: '4000', country: 'Australia' },
    customerType: 'Body Corporate', archived: false, tags: [], sites: [{ id: '3021', name: 'Harbourline Apartments' }], contacts: [],
    ...over,
  });

  it('writes the list row, then the record on top, and a later list row does not blank the record', async () => {
    await upsertCustomer(company(), AT);
    await upsertCustomer(company({
      notes: 'Call before attending', customerGroup: 'Strata',
      contacts: [{ id: '60', name: 'Pat Singh', email: 'pat@example.invalid' }],
      billingAddress: { address: 'PO Box 9', suburb: 'Brisbane', state: 'QLD', postcode: '4001' },
    }), AT, { fromDetail: true });
    await upsertCustomer(company(), '2026-09-02T01:00:00.000Z');
    const held = await getCustomer('812');
    expect(held).toMatchObject({
      externalId: '812', kind: 'Company', name: 'Harbourline Body Corporate', phone: '07 3000 0000',
      address: { address: '1 Quay St', suburb: 'Brisbane', state: 'QLD', postcode: '4000', country: 'Australia' },
      billingAddress: { address: 'PO Box 9', suburb: 'Brisbane', state: 'QLD', postcode: '4001' },
      notes: 'Call before attending', customerGroup: 'Strata', detailSyncedAt: AT, syncedAt: '2026-09-02T01:00:00.000Z',
    });
    expect(held!.contacts).toEqual([{ id: '60', name: 'Pat Singh', email: 'pat@example.invalid' }]);
    expect(held!.sites).toEqual([{ id: '3021', name: 'Harbourline Apartments' }]);
  });

  it('finds customers by name, email or phone, current ones first', async () => {
    await upsertCustomer(company(), AT);
    await upsertCustomer(company({ id: '813', name: 'Old Harbour Pty Ltd', archived: true, email: 'x@example.invalid' }), AT);
    await upsertCustomer(company({ id: '814', name: 'Riverline Holdings', email: 'accounts@riverline.invalid', phone: '0400 111 222' }), AT);
    expect((await searchCustomers('harbour')).map((c) => c.externalId)).toEqual(['812', '813']);
    expect((await searchCustomers('riverline.invalid')).map((c) => c.externalId)).toEqual(['814']);
    expect((await searchCustomers('0400 111')).map((c) => c.externalId)).toEqual(['814']);
    expect((await searchCustomers('813')).map((c) => c.externalId)).toEqual(['813']);
    expect((await searchCustomers('')).map((c) => c.externalId)).toEqual(['812', '814', '813']);
  });

  it('prunes the ones a full pull did not see', async () => {
    await upsertCustomer(company(), AT);
    await upsertCustomer(company({ id: '813' }), '2026-08-01T00:00:00.000Z');
    expect(await pruneCustomersNotSyncedAt(AT)).toBe(1);
    expect((await searchCustomers('')).map((c) => c.externalId)).toEqual(['812']);
  });

  it('counts a customer\'s jobs, open jobs, open quotes and unpaid balance', async () => {
    await upsertCustomer(company(), AT);
    await upsertJob(jobRowFromSimpro(job({ id: '1', stage: 'Progress', issuedAt: '2026-08-01' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '2', stage: 'Complete', issuedAt: '2026-08-28' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '3', stage: 'Pending', issuedAt: '2026-07-01' }), undefined));
    await upsertJob(jobRowFromSimpro(job({ id: '4', customerId: '999' }), undefined));
    await upsertQuote({ id: 'q1', name: 'Open', customerId: '812', isClosed: false, technicians: [], tags: [] }, undefined, AT);
    await upsertQuote({ id: 'q2', name: 'Closed', customerId: '812', isClosed: true, technicians: [], tags: [] }, undefined, AT);
    await upsertQuote({ id: 'q3', name: 'Became a job', customerId: '812', isClosed: false, jobId: '1', technicians: [], tags: [] }, undefined, AT);
    await upsertInvoice({ id: 'i1', customerId: '812', jobs: [], isPaid: false, balanceDueCents: 10000 }, AT);
    await upsertInvoice({ id: 'i2', customerId: '812', jobs: [], isPaid: false, balanceDueCents: 2550 }, AT);
    await upsertInvoice({ id: 'i3', customerId: '812', jobs: [], isPaid: true, balanceDueCents: 0 }, AT);
    await upsertInvoice({ id: 'i4', customerId: '999', jobs: [], isPaid: false, balanceDueCents: 99999 }, AT);
    expect(await customerStats('812')).toEqual({
      jobsTotal: 3, jobsOpen: 2, lastJobAt: '2026-08-28', quotesOpen: 1, invoicesUnpaidCents: 12550,
    });
    expect(await customerStats('none')).toEqual({ jobsTotal: 0, jobsOpen: 0, lastJobAt: undefined, quotesOpen: 0, invoicesUnpaidCents: 0 });
  });

  it('counts the same for a site, without counting an invoice twice for billing two of its jobs', async () => {
    await seedSite('site-1', 'A');
    await seedSite('site-2', 'B');
    await upsertJob(jobRowFromSimpro(job({ id: '1', stage: 'Progress', issuedAt: '2026-08-01' }), 'site-1'));
    await upsertJob(jobRowFromSimpro(job({ id: '2', stage: 'Complete', issuedAt: '2026-08-28' }), 'site-1'));
    await upsertJob(jobRowFromSimpro(job({ id: '3', stage: 'Pending' }), 'site-2'));
    await upsertQuote({ id: 'q1', name: 'Open', isClosed: false, technicians: [], tags: [] }, 'site-1', AT);
    await upsertInvoice({ id: 'i1', jobs: [{ id: '1' }, { id: '2' }], isPaid: false, balanceDueCents: 10000 }, AT);
    await upsertInvoice({ id: 'i2', jobs: [{ id: '3' }], isPaid: false, balanceDueCents: 500 }, AT);
    expect(await siteStats('site-1')).toEqual({
      jobsTotal: 2, jobsOpen: 1, lastJobAt: '2026-08-28', quotesOpen: 1, invoicesUnpaidCents: 10000,
    });
  });
});

describe('tasks', () => {
  it('upserts the company list without losing the job a detail read linked', async () => {
    await upsertJob(jobRowFromSimpro(job(), undefined));
    await replaceJobChildren('simpro-43747', { tasks: [{ id: 't1', subject: 'Chase PO', assignees: [] }] }, AT);
    await upsertTasks([
      { id: 't1', subject: 'Chase PO (renamed)', assignees: ['Office'], percentComplete: 50 },
      { id: 't2', subject: 'Order parts', assignees: [], completedBy: 'Office', percentComplete: 100 },
    ], AT);
    const all = await listTasks();
    expect(all.map((t) => [t.id, t.jobId, t.subject])).toEqual([
      ['t1', 'simpro-43747', 'Chase PO (renamed)'],
      ['t2', undefined, 'Order parts'],
    ]);
    expect((await listTasks({ openOnly: true })).map((t) => t.id)).toEqual(['t1']);
    expect((await listTasks({ jobId: 'simpro-43747' })).map((t) => t.id)).toEqual(['t1']);
  });
});
