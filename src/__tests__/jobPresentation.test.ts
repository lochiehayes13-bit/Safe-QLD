import {
  applyJobFilter, applyQuoteFilter, attachmentIcon, contactActions, contrastRatio, formatAddress, formatFileSize, formatQty,
  invoiceMatchesQuery, invoiceState, itemHeading, itemPrice, jobDates, jobIsMine, jobMatchesQuery, jobStatusWord,
  orderInvoices, parseHexColor, quoteState, relativeQldTime, sectionLineCount, sellTotalLine, stageLabel, stageTone,
  statusSwatch, sumExTax, taskState, technicianLine, telHref, mailHref,
} from '@/domain/jobPresentation';

/**
 * How the office's records read on the phone.
 *
 * Three things here can go quietly wrong on a real handset: a status dot the
 * office coloured for a white screen vanishing on a dark card, a note stamped
 * at ten to midnight Brisbane time filed under the day before, and a filter
 * that shows a technician five years of finished jobs under "Mine".
 */

// 8:30am on 2 September in Brisbane, still 1 September in UTC.
const NOW = '2026-09-01T22:30:00.000Z';
const TODAY = '2026-09-02';

const DARK_SURFACE = '#161B24';
const LIGHT_SURFACE = '#FFFFFF';

describe('stages and statuses', () => {
  it('turns Simpro stages into words and tones', () => {
    expect(stageLabel('Progress')).toBe('In progress');
    expect(stageLabel('Invoiced')).toBe('Invoiced');
    expect(stageLabel('Something New')).toBe('Something New');
    expect(stageLabel(undefined)).toBe('');
    expect(['Pending', 'Progress', 'Complete', 'Invoiced', 'Archived'].map(stageTone))
      .toEqual(['info', 'warn', 'pass', 'pass', 'muted']);
  });

  it("prefers the office's status name, then the stage, then the phone's own state", () => {
    expect(jobStatusWord({ statusName: 'Booked', stage: 'Pending', status: 'scheduled' })).toEqual({ label: 'Booked', tone: 'info' });
    expect(jobStatusWord({ stageRaw: 'Progress', status: 'scheduled' })).toEqual({ label: 'In progress', tone: 'warn' });
    expect(jobStatusWord({ status: 'in-progress' })).toEqual({ label: 'Running', tone: 'warn' });
  });
});

describe("the office's status colour on our surfaces", () => {
  it('reads three- and six-digit hex, with or without the hash', () => {
    expect(parseHexColor('#f5a623')).toEqual({ r: 245, g: 166, b: 35 });
    expect(parseHexColor('FA3')).toEqual({ r: 255, g: 170, b: 51 });
    expect(parseHexColor('orange')).toBeUndefined();
    expect(parseHexColor('rgb(1,2,3)')).toBeUndefined();
    expect(parseHexColor(undefined)).toBeUndefined();
  });

  it('measures contrast the WCAG way', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 })).toBe(1);
  });

  it('rings a dot the card would otherwise swallow', () => {
    // The office's amber is fine on a dark card; a navy status is a dot
    // nobody can find, and gets a hairline. On paper it is the other way.
    expect(statusSwatch('#f5a623', DARK_SURFACE)).toEqual({ fill: '#f5a623', outlined: false });
    expect(statusSwatch('#1c2a44', DARK_SURFACE)).toEqual({ fill: '#1c2a44', outlined: true });
    expect(statusSwatch('#fff7cc', LIGHT_SURFACE)).toEqual({ fill: '#fff7cc', outlined: true });
    expect(statusSwatch('#1c2a44', LIGHT_SURFACE)).toEqual({ fill: '#1c2a44', outlined: false });
  });

  it('normalises the fill so the same colour is the same string', () => {
    expect(statusSwatch('FA3', DARK_SURFACE)?.fill).toBe('#ffaa33');
    expect(statusSwatch('not a colour', DARK_SURFACE)).toBeUndefined();
  });
});

describe('whose job', () => {
  const booked = { techniciansJson: JSON.stringify([{ id: '12', name: 'Sam Okafor' }, { id: '19', name: 'Priya Nair' }]), technician: 'Sam Okafor, Priya Nair' };

  it('matches by employee id when the phone knows one', () => {
    expect(jobIsMine(booked, { by: 'id', staffId: '12', label: 'x' })).toBe(true);
    expect(jobIsMine(booked, { by: 'id', staffId: '99', label: 'x' })).toBe(false);
  });

  it('falls back to the name, case-insensitively, including a hand-typed row', () => {
    expect(jobIsMine(booked, { by: 'name', staffName: 'priya nair', label: 'x' })).toBe(true);
    expect(jobIsMine({ technician: 'Sam Okafor' }, { by: 'name', staffName: 'Sam Okafor', label: 'x' })).toBe(true);
    expect(jobIsMine({ techniciansJson: 'not json' }, { by: 'name', staffName: 'Sam Okafor', label: 'x' })).toBe(false);
  });

  it('is nobody when the phone knows nobody', () => {
    expect(jobIsMine(booked, null)).toBe(false);
  });
});

describe('the job list', () => {
  const job = (id: string, over: Record<string, unknown> = {}) => ({
    externalId: id, siteName: 'Harbourline Apartments', customerName: 'Harbourline Body Corporate',
    title: 'Six monthly', address: '12 Wharf St', orderNo: 'PO-7781', status: 'scheduled', scheduledFor: '2026-08-28',
    techniciansJson: JSON.stringify([{ id: '12', name: 'Sam Okafor' }]), technician: 'Sam Okafor', ...over,
  });

  it('searches by number, site, customer, title, address and order number, one word at a time', () => {
    const j = job('43747');
    expect(jobMatchesQuery(j, '#43747')).toBe(true);
    expect(jobMatchesQuery(j, 'harbour six')).toBe(true);
    expect(jobMatchesQuery(j, 'wharf')).toBe(true);
    expect(jobMatchesQuery(j, 'PO-7781')).toBe(true);
    expect(jobMatchesQuery(j, 'harbour weekly')).toBe(false);
    expect(jobMatchesQuery(j, '   ')).toBe(true);
  });

  it("takes today from the schedule first and the issue date second", () => {
    const rows = [job('1', { scheduledFor: '2026-08-01' }), job('2', { scheduledFor: TODAY }), job('3', { scheduledFor: '2026-08-01' })];
    const shown = applyJobFilter(rows, { filter: 'today', today: TODAY, who: null, scheduledToday: new Set(['1']), query: '' });
    expect(shown.map((r) => r.externalId)).toEqual(['1', '2']);
  });

  it('shows only open work under Mine, because finished work is years of rows', () => {
    const rows = [job('1'), job('2', { status: 'complete' }), job('3', { techniciansJson: '[]', technician: 'Someone Else' })];
    const shown = applyJobFilter(rows, { filter: 'mine', today: TODAY, who: { by: 'id', staffId: '12', label: 'x' }, scheduledToday: new Set(), query: '' });
    expect(shown.map((r) => r.externalId)).toEqual(['1']);
  });

  it('keeps the search across every filter', () => {
    const rows = [job('1', { siteName: 'Alpha' }), job('2', { siteName: 'Beta' })];
    expect(applyJobFilter(rows, { filter: 'all', today: TODAY, who: null, scheduledToday: new Set(), query: 'beta' }).map((r) => r.externalId)).toEqual(['2']);
    expect(applyJobFilter(rows, { filter: 'open', today: TODAY, who: null, scheduledToday: new Set(), query: '' }).length).toBe(2);
  });
});

describe('when something happened', () => {
  it('counts minutes and hours within the Queensland day', () => {
    expect(relativeQldTime('2026-09-01T22:29:30+00:00', NOW)).toBe('just now');
    expect(relativeQldTime('2026-09-01T22:05:00+00:00', NOW)).toBe('25 min ago');
    // Ten past midnight Brisbane time: this morning, however UTC files it.
    expect(relativeQldTime('2026-09-02T00:10:00+10:00', NOW)).toBe('8 h ago');
  });

  it('files ten to midnight under yesterday, with the Brisbane clock', () => {
    expect(relativeQldTime('2026-09-01T23:50:00+10:00', NOW)).toBe('Yesterday 23:50');
  });

  it('falls back to days and then to the date', () => {
    expect(relativeQldTime('2026-08-29T08:00:00+10:00', NOW)).toBe('4 days ago');
    expect(relativeQldTime('2026-07-10T08:00:00+10:00', NOW)).toBe('10/07/2026');
    expect(relativeQldTime(undefined, NOW)).toBe('');
    expect(relativeQldTime('never', NOW)).toBe('never');
  });

  it('lists a job’s dates in the order they happen, only where set', () => {
    expect(jobDates({ scheduledFor: '2026-08-28', completedDate: '2026-09-01' }))
      .toEqual([{ label: 'Issued', value: '28/08/2026' }, { label: 'Completed', value: '01/09/2026' }]);
  });
});

describe('money and lines', () => {
  it('shows both sides of GST, and nothing where the office sent nothing', () => {
    expect(sellTotalLine(152350, 167585)).toBe('$1,523.50 ex GST · $1,675.85 inc GST');
    expect(sellTotalLine(152350, undefined)).toBe('$1,523.50 ex GST');
    expect(sellTotalLine(undefined, undefined)).toBeUndefined();
  });

  it('writes a quantity with the unit that tells a price from a rate', () => {
    expect(formatQty({ kind: 'catalog', qty: 3 })).toBe('3 ×');
    expect(formatQty({ kind: 'labor', qty: 2.5 })).toBe('2.5 h');
    expect(formatQty({ kind: 'oneOff', qty: 0.333333 })).toBe('0.33 ×');
  });

  it('names a line by description, then part number, then family', () => {
    expect(itemHeading({ kind: 'catalog', description: 'Photoelectric detector', partNo: 'PD-1' })).toBe('Photoelectric detector');
    expect(itemHeading({ kind: 'catalog', description: '  ', partNo: 'PD-1' })).toBe('PD-1');
    expect(itemHeading({ kind: 'labor', description: '' })).toBe('Labour');
  });

  it('prices a line from its total, or from unit by quantity, and shows the unit only when it says something', () => {
    expect(itemPrice({ qty: 3, unitSellExTaxCents: 4500, sellExTaxCents: 13500 })).toEqual({ line: '$135.00', unit: '$45.00 each' });
    expect(itemPrice({ qty: 1, unitSellExTaxCents: 4500, sellExTaxCents: 4500 })).toEqual({ line: '$45.00' });
    expect(itemPrice({ qty: 2, unitSellExTaxCents: 2729 })).toEqual({ line: '$54.58', unit: '$27.29 each' });
    expect(itemPrice({ qty: 2 })).toEqual({});
  });

  it('counts lines across a section', () => {
    expect(sectionLineCount({ costCenters: [{ items: [1, 2] }, { items: [] }, { items: [3] }] })).toBe(3);
    expect(sumExTax([{ totalExTaxCents: 100 }, {}, { totalExTaxCents: 250 }])).toBe(350);
  });
});

describe('attachments', () => {
  it('picks an icon by type, and by extension where the list has no type', () => {
    expect(attachmentIcon('application/pdf', 'x.bin')).toBe('file-pdf-box');
    expect(attachmentIcon(undefined, 'Site plan.PDF')).toBe('file-pdf-box');
    expect(attachmentIcon('image/jpeg', undefined)).toBe('file-image');
    expect(attachmentIcon(undefined, 'report.docx')).toBe('file-word-box');
    expect(attachmentIcon(undefined, 'register.xlsx')).toBe('file-excel-box');
    expect(attachmentIcon(undefined, 'thread.eml')).toBe('email-outline');
    expect(attachmentIcon(undefined, 'whatever')).toBe('file-outline');
  });

  it('sizes a file in the unit a person would use', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(15_360)).toBe('15.0 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatFileSize(undefined)).toBeUndefined();
  });
});

describe('invoices', () => {
  it('says paid, overdue, due or unpaid against the Queensland day', () => {
    expect(invoiceState({ isPaid: true, datePaid: '2026-08-20' }, TODAY)).toEqual({ label: 'Paid 20/08/2026', tone: 'pass' });
    expect(invoiceState({ isPaid: false, dueDate: '2026-09-01' }, TODAY)).toEqual({ label: 'Overdue since 01/09/2026', tone: 'fail' });
    expect(invoiceState({ isPaid: false, dueDate: TODAY }, TODAY)).toEqual({ label: 'Due 02/09/2026', tone: 'warn' });
    expect(invoiceState({ isPaid: false, statusName: 'Awaiting payment' }, TODAY)).toEqual({ label: 'Awaiting payment', tone: 'warn' });
  });

  it('puts the unpaid first, most overdue first, then the rest newest first', () => {
    const rows = [
      { externalId: 'a', isPaid: true, dateIssued: '2026-08-01' },
      { externalId: 'b', isPaid: false, dueDate: '2026-09-10', dateIssued: '2026-08-10' },
      { externalId: 'c', isPaid: false, dueDate: '2026-08-01', dateIssued: '2026-07-01' },
      { externalId: 'd', isPaid: true, dateIssued: '2026-08-15' },
    ];
    expect(orderInvoices(rows).map((r) => r.externalId)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('finds an invoice by its number, the job it bills, the customer or the order', () => {
    const inv = { externalId: '9001', customerName: 'Harbourline', orderNo: 'PO-1', description: 'Annual', jobs: [{ id: '43747' }] };
    expect(invoiceMatchesQuery(inv, '43747')).toBe(true);
    expect(invoiceMatchesQuery(inv, 'harbour po-1')).toBe(true);
    expect(invoiceMatchesQuery(inv, '9002')).toBe(false);
  });
});

describe('quotes', () => {
  it('leads with the job a quote became, then whether it is closed, then the stage', () => {
    expect(quoteState({ isClosed: true, jobExternalId: '43747', stage: 'Approved' })).toEqual({ label: 'Job 43747', tone: 'pass' });
    expect(quoteState({ isClosed: true, statusName: 'Lost', stage: 'Declined' })).toEqual({ label: 'Lost', tone: 'muted' });
    expect(quoteState({ isClosed: false, stage: 'Approved', statusName: 'Approved' })).toEqual({ label: 'Approved', tone: 'pass' });
    expect(quoteState({ isClosed: false, stage: 'Progress' })).toEqual({ label: 'In progress', tone: 'warn' });
    expect(quoteState({ isClosed: false })).toEqual({ label: 'Open', tone: 'info' });
  });

  it('filters open, approved, converted and closed apart', () => {
    const rows = [
      { externalId: '1', name: 'A', isClosed: false, stage: 'Pending' },
      { externalId: '2', name: 'B', isClosed: false, stage: 'Approved' },
      { externalId: '3', name: 'C', isClosed: true, stage: 'Approved', jobExternalId: '500' },
      { externalId: '4', name: 'D', isClosed: true, stage: 'Declined' },
    ];
    const ids = (f: Parameters<typeof applyQuoteFilter>[1]) => applyQuoteFilter(rows, f, '').map((r) => r.externalId);
    expect(ids('open')).toEqual(['1', '2']);
    expect(ids('approved')).toEqual(['2']);
    expect(ids('converted')).toEqual(['3']);
    expect(ids('closed')).toEqual(['4']);
    expect(ids('all').length).toBe(4);
    expect(applyQuoteFilter(rows, 'all', '500').map((r) => r.externalId)).toEqual(['3']);
  });
});

describe('tasks', () => {
  it('reads done, overdue, due or open with the percentage where there is one', () => {
    expect(taskState({ completedBy: 'Sam' }, TODAY)).toEqual({ label: 'Done', tone: 'pass' });
    expect(taskState({ percentComplete: 100 }, TODAY)).toEqual({ label: 'Done', tone: 'pass' });
    expect(taskState({ dueDate: '2026-08-30', percentComplete: 40 }, TODAY)).toEqual({ label: 'Overdue 30/08/2026 · 40%', tone: 'fail' });
    expect(taskState({ dueDate: '2026-09-05' }, TODAY)).toEqual({ label: 'Due 05/09/2026', tone: 'warn' });
    expect(taskState({}, TODAY)).toEqual({ label: 'Open', tone: 'info' });
  });
});

describe('people and places', () => {
  it('joins technicians and falls back to the row', () => {
    expect(technicianLine([{ id: '1', name: 'Sam' }, { id: '2', name: 'Priya' }])).toBe('Sam, Priya');
    expect(technicianLine([], 'Sam Okafor')).toBe('Sam Okafor');
    expect(technicianLine([])).toBe('');
  });

  it('writes an address the Australian way', () => {
    expect(formatAddress({ address: '12 Wharf St', suburb: 'Newstead', state: 'QLD', postcode: '4006' })).toBe('12 Wharf St, Newstead QLD 4006');
    expect(formatAddress({ suburb: 'Newstead' })).toBe('Newstead');
    expect(formatAddress({})).toBeUndefined();
  });

  it('dials only what is a number and mails only what is an address', () => {
    expect(telHref('(07) 3000 1234')).toBe('tel:0730001234');
    expect(telHref('+61 400 000 000')).toBe('tel:+61400000000');
    expect(telHref('ext 12')).toBeUndefined();
    expect(mailHref(' dana@example.invalid ')).toBe('mailto:dana@example.invalid');
    expect(mailHref('none')).toBeUndefined();
  });

  it('offers the mobile first, then the desk, then email', () => {
    expect(contactActions({ mobile: '0400 000 000', workPhone: '07 3000 1234', email: 'dana@example.invalid' }).map((a) => a.kind))
      .toEqual(['mobile', 'phone', 'email']);
    expect(contactActions({ email: 'x' })).toEqual([]);
    expect(contactActions(undefined)).toEqual([]);
  });
});
