import {
  HIT_ROUTE, KIND_ORDER, SEARCH_HINTS, describeHit, groupHits, isExact, nothingFoundWords, parseQuery, rankHits,
  smsHref, type SearchHit,
} from '@/domain/search';

/**
 * The pure half of find-anything: what a typed search means, and the order
 * its hits come back in.
 *
 * The one that matters is the number. "44501" is a job number, an invoice
 * number, a purchase order number and a customer number all at once, and
 * the exact match has to lead whatever kind it is — a technician who typed
 * a job number and was handed an invoice whose order number contains it
 * stops using the box.
 */

describe('reading what was typed', () => {
  it('reads a bare number, with or without the hash', () => {
    expect(parseQuery('44501')).toMatchObject({ kind: 'number', number: '44501' });
    expect(parseQuery('44501').hint).toBeUndefined();
    expect(parseQuery('#44501')).toMatchObject({ kind: 'number', number: '44501' });
    expect(parseQuery('  1001 ')).toMatchObject({ kind: 'number', number: '1001', text: '1001' });
  });

  it('reads the prefix that says which record the number is', () => {
    expect(parseQuery('job 44501')).toMatchObject({ kind: 'number', number: '44501', hint: 'job' });
    expect(parseQuery('inv 62339')).toMatchObject({ kind: 'number', number: '62339', hint: 'invoice' });
    expect(parseQuery('Invoice #62339')).toMatchObject({ kind: 'number', number: '62339', hint: 'invoice' });
    expect(parseQuery('po 80375')).toMatchObject({ kind: 'number', number: '80375', hint: 'order' });
    expect(parseQuery('order 80375')).toMatchObject({ hint: 'order' });
    expect(parseQuery('purchase order 80375')).toMatchObject({ hint: 'order', number: '80375' });
    expect(parseQuery('quote 1234')).toMatchObject({ kind: 'number', number: '1234', hint: 'quote' });
    expect(parseQuery('cust 812')).toMatchObject({ kind: 'number', number: '812', hint: 'customer' });
    expect(parseQuery('supplier 77')).toMatchObject({ hint: 'vendor' });
  });

  it('does not take an unknown word in front of a number as a prefix', () => {
    // "level 2" is words about a place, not a record number.
    expect(parseQuery('level 2')).toMatchObject({ kind: 'words', words: ['level', '2'] });
  });

  it('needs a space or a hash between the prefix and the number, so a part code is not read as one', () => {
    // "PO1234" and "Q10" are part codes; "PO 1234" and "PO#1234" are orders.
    expect(parseQuery('PO1234')).toMatchObject({ kind: 'code', words: ['PO1234'] });
    expect(parseQuery('Q10')).toMatchObject({ kind: 'code' });
    expect(parseQuery('PO 1234')).toMatchObject({ kind: 'number', number: '1234', hint: 'order' });
    expect(parseQuery('PO#1234')).toMatchObject({ kind: 'number', number: '1234', hint: 'order' });
    expect(parseQuery('po # 1234')).toMatchObject({ kind: 'number', number: '1234', hint: 'order' });
  });

  it('reads a part number as a code, and a plain word as a word', () => {
    expect(parseQuery('DET-OPT-1')).toMatchObject({ kind: 'code', words: ['DET-OPT-1'] });
    expect(parseQuery('FP1000')).toMatchObject({ kind: 'code' });
    expect(parseQuery('SD-1')).toMatchObject({ kind: 'code' });
    expect(parseQuery('tower')).toMatchObject({ kind: 'words', words: ['tower'] });
    expect(parseQuery('Fictional Tower')).toMatchObject({ kind: 'words', words: ['Fictional', 'Tower'] });
  });

  it('reads a phone number as digits, spaces and all', () => {
    expect(parseQuery('0400 000 000')).toMatchObject({ kind: 'phone', digits: '0400000000' });
    expect(parseQuery('(07) 3000-0000')).toMatchObject({ kind: 'phone', digits: '0730000000' });
    // The country code stands for the trunk zero the office typed.
    expect(parseQuery('+61 400 000 000')).toMatchObject({ kind: 'phone', digits: '0400000000' });
    expect(parseQuery('+61 7 3000 0000')).toMatchObject({ kind: 'phone', digits: '0730000000' });
    // A bare run that starts with a zero is a phone: the office's ids never do.
    expect(parseQuery('0400000000')).toMatchObject({ kind: 'phone', digits: '0400000000' });
    // And a bare run that does not is a record number.
    expect(parseQuery('4000000')).toMatchObject({ kind: 'number', number: '4000000' });
  });

  it('reads an email', () => {
    expect(parseQuery('Dana@Example.invalid')).toMatchObject({ kind: 'email', email: 'dana@example.invalid' });
  });

  it('drops a hash off a word and folds the spacing', () => {
    expect(parseQuery('  #fictional   tower ')).toMatchObject({ kind: 'words', words: ['fictional', 'tower'], text: '#fictional tower' });
    expect(parseQuery('')).toEqual({ kind: 'words', text: '', words: [] });
  });
});

const hit = (over: Partial<SearchHit> & Pick<SearchHit, 'kind' | 'id'>): SearchHit => ({
  title: over.id, subtitle: '', route: HIT_ROUTE[over.kind], params: { id: over.id }, ...over,
});

describe('ranking', () => {
  it('puts the record whose number was typed first, whatever kind it is', () => {
    const q = parseQuery('1001');
    const ranked = rankHits([
      hit({ kind: 'job', id: 'simpro-2002', number: '2002', title: 'Job with order no 1001' }),
      hit({ kind: 'invoice', id: '1001', number: '1001', title: 'Invoice 1001' }),
      hit({ kind: 'site', id: 's1', number: '3021' }),
    ], q);
    expect(ranked.map((h) => h.title)).toEqual(['Invoice 1001', 'Job with order no 1001', 's1']);
    expect(isExact(ranked[0]!, q)).toBe(true);
    expect(isExact(ranked[1]!, q)).toBe(false);
  });

  it('then orders by kind — jobs, sites, customers, contacts, quotes, invoices, orders, catalogue, leads, suppliers', () => {
    const shuffled = [...KIND_ORDER].reverse().map((kind) => hit({ kind, id: kind }));
    expect(rankHits(shuffled).map((h) => h.kind)).toEqual(KIND_ORDER);
  });

  it('then newest first, with an undated record after every dated one', () => {
    const ranked = rankHits([
      hit({ kind: 'job', id: 'a', title: 'A' }),
      hit({ kind: 'job', id: 'b', title: 'B', when: '2026-08-01' }),
      hit({ kind: 'job', id: 'c', title: 'C', when: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(ranked.map((h) => h.id)).toEqual(['c', 'b', 'a']);
  });

  it('leads with the catalogue when a part number was typed', () => {
    const ranked = rankHits([hit({ kind: 'job', id: 'j' }), hit({ kind: 'catalog', id: 'c' })], parseQuery('DET-OPT-1'));
    expect(ranked.map((h) => h.kind)).toEqual(['catalog', 'job']);
  });

  it('groups ranked hits by kind in the order they first appear, with the plural label', () => {
    const groups = groupHits(rankHits([
      hit({ kind: 'invoice', id: '1', number: '1' }),
      hit({ kind: 'job', id: 'j1' }), hit({ kind: 'job', id: 'j2' }),
    ], parseQuery('1')));
    expect(groups.map((g) => [g.label, g.hits.length])).toEqual([['Invoices', 1], ['Jobs', 2]]);
  });
});

describe('the line under a hit', () => {
  it('says where a job is, for whom, and where it stands', () => {
    expect(describeHit({ kind: 'job', siteName: 'Fictional Tower', customerName: 'Fictional Body Corporate', state: 'Pending', day: '2026-08-20' }))
      .toBe('Fictional Tower · Fictional Body Corporate · Pending · Issued 20/08/2026');
  });

  it('says whether an invoice is paid, because that is why it was searched for', () => {
    expect(describeHit({ kind: 'invoice', customerName: 'Fictional Body Corporate', isPaid: false, balanceDueCents: 167585, totalIncTaxCents: 167585, day: '2026-08-31' }))
      .toBe('Fictional Body Corporate · $1,675.85 owing · $1,675.85 inc GST · Issued 31/08/2026');
    expect(describeHit({ kind: 'invoice', isPaid: true })).toBe('Paid');
    expect(describeHit({ kind: 'invoice', isPaid: false })).toBe('Unpaid');
  });

  it('names a contact by role and by where they are, and shortens a long list of places', () => {
    expect(describeHit({ kind: 'contact', position: 'Building manager', siteNames: ['Fictional Tower'], mobile: '0400 000 000' }))
      .toBe('Building manager · Fictional Tower · 0400 000 000');
    expect(describeHit({ kind: 'contact', siteNames: ['A', 'B', 'C', 'D'] })).toBe('A, B and 2 more');
  });

  it('prints a part with its sell price and never anything else', () => {
    expect(describeHit({ kind: 'catalog', partNo: 'DET-OPT-1', groupName: 'Detectors', sellExTaxCents: 8495 }))
      .toBe('DET-OPT-1 · Detectors · $84.95 ex GST');
  });

  it('prints an order with its job, status and reference', () => {
    expect(describeHit({ kind: 'order', jobId: '1001', stage: 'Approved', statusName: 'Sent to supplier', reference: 'Riser parts', day: '2026-08-20' }))
      .toBe('Job 1001 · Sent to supplier · Riser parts · Issued 20/08/2026');
  });

  it('leaves out what the record does not have rather than printing a dash', () => {
    expect(describeHit({ kind: 'site' })).toBe('');
    expect(describeHit({ kind: 'site', address: '1 Fictional St', suburb: 'Brisbane', siteRef: 'FT-01' })).toBe('1 Fictional St, Brisbane · Ref FT-01');
    expect(describeHit({ kind: 'vendor', suburb: 'Yatala', archived: true })).toBe('Yatala · Archived');
    expect(describeHit({ kind: 'lead', customerName: 'Fictional Body Corporate', stage: 'Open', day: '2026-08-10' })).toBe('Fictional Body Corporate · Open · Raised 10/08/2026');
    expect(describeHit({ kind: 'quote', siteName: 'Fictional Tower', state: 'Sent', totalIncTaxCents: 264000 })).toBe('Fictional Tower · Sent · $2,640.00 inc GST');
    expect(describeHit({ kind: 'customer', customerKind: 'Company', phone: '07 3000 0000' })).toBe('Company · 07 3000 0000');
  });
});

describe('what an empty result says', () => {
  it('names the kind when a prefix asked for one', () => {
    expect(nothingFoundWords(parseQuery('inv 62339')).title).toBe('No invoice 62339 on this phone');
  });

  it('says nobody has the number or the email', () => {
    expect(nothingFoundWords(parseQuery('0400 000 000')).title).toBe('Nobody has that number');
    expect(nothingFoundWords(parseQuery('x@example.invalid')).title).toBe('Nobody has that email');
    expect(nothingFoundWords(parseQuery('tower')).title).toBe('Nothing matched');
  });

  it('has a hint for each shape that can be typed', () => {
    const kinds = new Set(SEARCH_HINTS.map((h) => parseQuery(h.example).kind));
    expect([...kinds].sort()).toEqual(['code', 'email', 'number', 'phone', 'words']);
  });
});

describe('routes', () => {
  it('has a route for every kind, and every route is a real path', () => {
    for (const kind of KIND_ORDER) expect(HIT_ROUTE[kind]).toMatch(/^\//);
  });
});

describe('texting somebody', () => {
  it('makes an sms link from what the office typed', () => {
    expect(smsHref('0400 000 000')).toBe('sms:0400000000');
    expect(smsHref('+61 400 000 000')).toBe('sms:+61400000000');
  });

  it('refuses what is not a number', () => {
    expect(smsHref('ext 12')).toBeUndefined();
    expect(smsHref(undefined)).toBeUndefined();
  });
});
