import { mergeSwms, type SwmsRecord, type SwmsTemplate } from '@/domain/swms';
import { SWMS_TEMPLATES } from '@/seed/swms';
import {
  DEFAULT_SWMS_INBOX, SWMS_INBOX_ADDRESS, SWMS_INBOX_OPTIONS, SWMS_PROJECTS_INBOX, SWMS_SERVICE_INBOX,
  swmsBody, swmsInboxFrom, swmsNotReady, swmsSubject,
} from '@/domain/swmsEmail';

/**
 * The statement, in the office's inbox.
 *
 * Two things are worth testing here and they are both about honesty. The
 * subject has to say when a statement is a draft, because a draft that reaches
 * the office looking finished is filed as finished. And the body has to say
 * when the PDF is not on the email, because a body that reads as complete with
 * no attachment is how a statement gets recorded as received when nothing was.
 */

const template = (): SwmsTemplate => ({
  ...SWMS_TEMPLATES[0]!,
  review: { cleared: true, reason: 'Reviewed and cleared.', findings: [] },
});

function record(over: Partial<SwmsRecord> = {}): SwmsRecord {
  return {
    id: 'r1',
    templateIds: [template().id],
    title: 'Coring the slab at Fictional Tower',
    siteId: 's1',
    siteName: 'Fictional Tower',
    jobExternalId: '42823',
    jobTitle: 'Detection annual',
    date: '2026-09-16',
    supervisor: 'Sam Supervisor',
    supervisorPhone: '0400 000 000',
    answers: {},
    addedHazards: [],
    ticked: [],
    notApplicable: [],
    crewRisk: {},
    ppeChecked: [],
    permits: [],
    workers: [{ name: 'Alex Technician', signature: 'data:sig', signedAt: '2026-09-16T07:00:00Z' }],
    status: 'signed',
    notes: 'Core drilling the slab to run pipe',
    createdAt: '2026-09-16T06:00:00Z',
    updatedAt: '2026-09-16T07:00:00Z',
    ...over,
  };
}

const merged = () => mergeSwms([template()]);

describe('the two inboxes', () => {
  it('are the addresses the owner named, exactly', () => {
    // The assertion that catches a typo in an address nobody ever reads back.
    expect(SWMS_PROJECTS_INBOX).toBe('projects@safeqld.com.au');
    expect(SWMS_SERVICE_INBOX).toBe('service@safeqld.com.au');
  });

  it('maps each choice to its address', () => {
    expect(SWMS_INBOX_ADDRESS.projects).toBe(SWMS_PROJECTS_INBOX);
    expect(SWMS_INBOX_ADDRESS.service).toBe(SWMS_SERVICE_INBOX);
  });

  it('offers both, and only both', () => {
    expect(SWMS_INBOX_OPTIONS.map((o) => o.value).sort()).toEqual(['projects', 'service']);
  });

  it('falls back to service for anything it does not recognise', () => {
    // Held as a plain string in preferences so an older build does not fail to
    // parse the whole settings blob over one field it has never heard of.
    expect(swmsInboxFrom(undefined)).toBe(DEFAULT_SWMS_INBOX);
    expect(swmsInboxFrom('')).toBe('service');
    expect(swmsInboxFrom('nonsense')).toBe('service');
    expect(swmsInboxFrom('projects')).toBe('projects');
  });
});

describe('the subject', () => {
  it('leads with the job number, which is what the office files by', () => {
    const s = swmsSubject(record());
    expect(s).toContain('job 42823');
    expect(s).toContain('Fictional Tower');
    expect(s).toContain('16/09/2026');
  });

  it('says DRAFT, first, on a statement nobody has signed', () => {
    expect(swmsSubject(record({ status: 'draft' }))).toMatch(/^DRAFT/);
  });

  it('says nothing about a draft when it is signed', () => {
    expect(swmsSubject(record())).not.toContain('DRAFT');
  });

  it('still has a subject with no job and no site on it', () => {
    const s = swmsSubject(record({ jobExternalId: undefined, siteName: undefined }));
    expect(s).toContain('SWMS');
    expect(s).toContain('16/09/2026');
  });
});

describe('the body', () => {
  it('names the job, the site and the supervisor', () => {
    const b = swmsBody(record(), merged());
    expect(b).toContain('42823');
    expect(b).toContain('Fictional Tower');
    expect(b).toContain('Sam Supervisor');
  });

  it('says plainly when there is no job rather than leaving the line off', () => {
    const b = swmsBody(record({ jobExternalId: undefined }), merged());
    expect(b).toContain('not linked to a Simpro job');
  });

  it('carries what the technician typed the work was', () => {
    expect(swmsBody(record(), merged())).toContain('Core drilling the slab to run pipe');
  });

  it('names every statement used', () => {
    const m = merged();
    const b = swmsBody(record(), m);
    for (const t of m.templates) expect(b).toContain(t.title);
  });

  it('states the risk in words, never as a number out of twenty-five', () => {
    const b = swmsBody(record(), merged());
    expect(b).not.toMatch(/\b\d+\s*\/\s*25\b/);
    expect(b).toMatch(/Worst risk after controls\s+\w+/);
  });

  it('says NOT SIGNED in the body as well as the subject, because bodies get forwarded', () => {
    const b = swmsBody(record({ status: 'draft', workers: [] }), merged());
    expect(b).toContain('NOT SIGNED');
    expect(b).toContain('No worker has signed it.');
  });

  it('counts the steps nobody has read on a draft', () => {
    const m = merged();
    const b = swmsBody(record({ status: 'draft' }), m);
    expect(b).toContain(`of ${m.steps.length} steps have not been read`);
  });

  it('carries a hazard the crew added, with its control and its rating', () => {
    const b = swmsBody(record({
      addedHazards: [{ hazard: 'Live busway above the ceiling', control: 'Isolated at the board', risk: 'high' }],
    }), merged());
    expect(b).toContain('Live busway above the ceiling');
    expect(b).toContain('Isolated at the board');
    expect(b).toContain('High');
  });

  it('says when the PDF could not be attached, rather than reading as complete', () => {
    // A browser cannot attach the PDF: it holds the document for the print
    // dialogue instead of writing a file. A body that does not say so is how a
    // statement gets filed as received when nothing was received.
    const b = swmsBody(record(), merged(), { attached: false });
    expect(b).toContain('could not be attached');
    expect(b).not.toContain('The full statement is attached');
  });

  it('says the PDF is attached when it is', () => {
    expect(swmsBody(record(), merged())).toContain('The full statement is attached');
  });

  it('names any statement no reviewer has cleared', () => {
    const uncleared: SwmsTemplate = {
      ...SWMS_TEMPLATES[0]!,
      review: { cleared: false, reason: 'A reviewer would not sign it.', findings: ['A hazard with no control'] },
    };
    const b = swmsBody(record(), mergeSwms([uncleared]));
    expect(b).toContain('no reviewer has cleared');
    expect(b).toContain('A reviewer would not sign it.');
  });
});

describe('refusing to send', () => {
  it('refuses a statement with no method statement on it', () => {
    expect(swmsNotReady(record({ templateIds: [] }), mergeSwms([]))).toMatch(/nothing to send/);
  });

  it('refuses one the office cannot file against anything', () => {
    const r = record({ jobExternalId: undefined, siteName: undefined });
    expect(swmsNotReady(r, merged())).toMatch(/no job and no site/);
  });

  it('allows one with a site but no job, which is an ordinary day', () => {
    expect(swmsNotReady(record({ jobExternalId: undefined }), merged())).toBeNull();
  });

  it('allows a complete one', () => {
    expect(swmsNotReady(record(), merged())).toBeNull();
  });
});
