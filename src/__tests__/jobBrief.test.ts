import { __reset, setItemAsync } from '../__mocks__/expo-secure-store';
import {
  BRIEF_SYSTEM_PROMPT, JOB_RECORDS_PRIVACY_NOTE, MAX_NOTES, buildBriefPrompt, checkBrief, draftJobBrief,
  worthBriefing, type JobBriefInput,
} from '@/ai/jobBrief';
import { DEFAULT_PREFS } from '@/app-prefs';

/**
 * The brief before a job, and the switch in front of it.
 *
 * This is the one model feature that sends customer data, so the first thing
 * tested is that nothing is sent — not built, not fetched — while the switch
 * is off, and that the switch ships off. The second is the same check the
 * other features get: a number that is not on the job card does not reach
 * the technician.
 */

const CARD: JobBriefInput = {
  jobNumber: '31240',
  title: 'Six monthly routine',
  jobType: 'Service',
  description: 'Six monthly service of extinguishers, hose reels and exit lights across both buildings.',
  officeNotes: 'Sign in at the office on arrival. Roof access needs the caretaker.',
  notes: [
    { subject: 'Access', note: 'Caretaker on site Tuesdays only.', createdAt: '2026-08-30T23:10:00.000Z' },
  ],
  siteNotes: 'Park in the loading bay, not the visitor spots.',
  openDefects: [
    { location: 'Level 2 plant room', description: 'Detector contaminated.', severity: 'non-critical' },
    { location: 'Ground foyer', description: 'Extinguisher failed to discharge.', severity: 'critical' },
  ],
  lastServicedAt: '2026-03-03T22:00:00.000Z',
  lastServiceSummary: 'Six monthly, 2 defects raised',
  scheduledFor: '2026-09-10T00:00:00.000Z',
};

describe('the switch', () => {
  it('ships off', () => {
    expect(DEFAULT_PREFS.aiShareJobRecords).toBe(false);
  });

  it('sends nothing while it is off, key or no key', async () => {
    __reset();
    await setItemAsync('safeqld.anthropic.key', 'test-key');
    let called = 0;
    const realFetch = global.fetch;
    global.fetch = (async () => { called++; throw new Error('must not be reached'); }) as unknown as typeof fetch;
    try {
      const r = await draftJobBrief(CARD, { readPrefs: async () => ({ aiShareJobRecords: false }) });
      expect(r.text).toBeUndefined();
      expect(r.refusal).toContain('off');
      expect(r.refusal).toContain('Settings');
      expect(called).toBe(0);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('reads the switch from the phone\'s own settings, so a caller cannot pass it on', async () => {
    // No reader handed in: the module asks the settings itself, and on a
    // phone that has never had the switch touched they say off.
    __reset();
    await setItemAsync('safeqld.anthropic.key', 'test-key');
    let called = 0;
    const realFetch = global.fetch;
    global.fetch = (async () => { called++; throw new Error('must not be reached'); }) as unknown as typeof fetch;
    try {
      const r = await draftJobBrief(CARD);
      expect(r.text).toBeUndefined();
      expect(r.refusal).toContain('off');
      expect(called).toBe(0);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('says exactly what leaves the phone', () => {
    for (const item of ['description', 'notes', 'open defects', 'last', "customer's name", 'Nothing is sent until']) {
      expect(JOB_RECORDS_PRIVACY_NOTE).toContain(item);
    }
    expect(JOB_RECORDS_PRIVACY_NOTE).toContain('not the asset');
  });
});

describe('what goes up', () => {
  it('is built only from the fields handed in, dated the Queensland way', () => {
    const prompt = buildBriefPrompt(CARD);
    expect(prompt).toContain('Job number: 31240');
    expect(prompt).toContain('Six monthly service of extinguishers');
    expect(prompt).toContain('Caretaker on site Tuesdays only.');
    expect(prompt).toContain('CRITICAL — Ground foyer');
    // 22:00 UTC on the third is the fourth in Brisbane.
    expect(prompt).toContain('Last serviced: 04/03/2026 — Six monthly, 2 defects raised');
    expect(prompt).not.toMatch(/2026-03-03/);
  });

  it('says what is missing rather than leaving a gap the model would fill', () => {
    const prompt = buildBriefPrompt({ title: 'Call out' });
    expect(prompt).toContain('Description: (none)');
    expect(prompt).toContain('Open defects at the site:\n(none on record)');
    expect(prompt).toContain('Last serviced: (no service on record)');
  });

  it('caps the notes rather than sending a year of them', () => {
    const notes = Array.from({ length: 20 }, (_, i) => ({ subject: `Note ${i}` }));
    const prompt = buildBriefPrompt({ ...CARD, notes });
    expect(prompt).toContain(`Note ${MAX_NOTES - 1}`);
    expect(prompt).not.toContain(`Note ${MAX_NOTES}`);
  });

  it('asks for three sentences and nothing beyond the record', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('exactly three sentences');
    expect(BRIEF_SYSTEM_PROMPT).toContain('Never state a figure, date, count or clause number');
  });

  it('is not worth asking about an empty card', () => {
    expect(worthBriefing({}).ok).toBe(false);
    expect(worthBriefing({ description: 'Annual.' }).ok).toBe(true);
  });
});

describe('what comes back', () => {
  it('passes a brief whose every number is on the card', () => {
    const r = checkBrief(
      'Job 31240 is the six monthly on both buildings. Sign in at the office and mind the 2 open defects, one critical in the foyer. It was last serviced on 4/3/2026.',
      CARD,
    );
    expect(r.refusal).toBeUndefined();
    expect(r.text).toContain('31240');
  });

  it('refuses a number from nowhere', () => {
    // "7 open defects" where the card lists two: not a summary, a new fact.
    const r = checkBrief('Six monthly routine with 7 open defects on site.', CARD);
    expect(r.text).toBeUndefined();
    expect(r.refusal).toContain('"7"');
  });

  it('lets a date through in either written form, since its parts are on the card', () => {
    expect(checkBrief('Last serviced 4/3/2026.', CARD).text).toBeDefined();
    expect(checkBrief('Last serviced 04/03/2026.', CARD).text).toBeDefined();
  });

  it('refuses nothing at all', () => {
    expect(checkBrief('', CARD).refusal).toContain('returned nothing');
  });
});

describe('over the wire, with a fake fetch', () => {
  const realFetch = global.fetch;
  afterAll(() => { global.fetch = realFetch; });

  it('with the switch on, sends the card and checks the brief', async () => {
    __reset();
    await setItemAsync('safeqld.anthropic.key', 'test-key');
    let sent: Record<string, unknown> = {};
    global.fetch = (async (_url: string, init?: { body?: string }) => {
      sent = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Six monthly on both buildings. Two open defects, one critical. Last serviced 4/3/2026.' }] }) };
    }) as unknown as typeof fetch;
    const r = await draftJobBrief(CARD, { readPrefs: async () => ({ aiShareJobRecords: true }) });
    expect(r.text).toContain('Last serviced 4/3/2026');
    expect(sent.system).toBe(BRIEF_SYSTEM_PROMPT);
    expect((sent.messages as { content: string }[])[0]!.content).toBe(buildBriefPrompt(CARD));
  });

  it('with the switch on and no key, says so without a network call', async () => {
    __reset();
    let called = 0;
    global.fetch = (async () => { called++; throw new Error('must not be reached'); }) as unknown as typeof fetch;
    const r = await draftJobBrief(CARD, { readPrefs: async () => ({ aiShareJobRecords: true }) });
    expect(r.refusal).toContain('No API key');
    expect(called).toBe(0);
  });
});
