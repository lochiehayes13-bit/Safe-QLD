import { __reset, setItemAsync } from '../__mocks__/expo-secure-store';
import {
  MAX_CANDIDATES, MAX_WORDING_CHARS, WORDING_SYSTEM_PROMPT, buildWordingPrompt, checkWording, draftDefectWording,
  numbersIn, worthDrafting, type WordingInput,
} from '@/ai/defectWording';
import { askGrounded } from '@/ai/client';
import { defectByCode, type DefectCode } from '@/seed/defectLibrary';
import type { AssetRecord } from '@/db/assetRepo';

/**
 * The harness that stops a language model inventing a defect.
 *
 * Two failures guarded. The first is what goes up: a technician writing up a
 * perished hose has not agreed to send the customer's name, so the prompt is
 * built from a fixture that carries every kind of value that must not travel
 * and checked for each of them. The second is what comes back: a code that
 * was never offered, a wording long enough to be padding, or a number from
 * nowhere — each thrown away rather than shown with a caveat.
 */

/** An asset as it would sit on a phone, with everything a prompt must not carry. */
const FIXTURE_ASSET: AssetRecord = {
  id: 'asset-local-9',
  siteId: 'site-local-3',
  assetTypeId: 'extinguisher',
  code: 'SQ-EXT-0000417',
  name: 'Extinguisher, Harbourline foyer',
  level: 'Level 3',
  room: 'East corridor',
  serial: 'ZX-88213-Q',
  externalId: '30917',
  externalSource: 'simpro',
  status: 'in-service',
  attributes: { assetNumber: '417', serviceLevelId: '9' },
  openDefects: 0,
  notes: 'Customer Harbourline Body Corporate; contact Dana Reyes 0400 000 001; job 39917',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const FIXTURE_SITE = { name: 'Harbourline Apartments', address: '12 Quay Street', clientName: 'Harbourline Body Corporate' };

const candidates = (): DefectCode[] => ['EXT-EXT-001', 'EXT-EXT-002', 'EXT-EXT-003'].map((c) => defectByCode(c)!);

/** The input the screen builds: the type's label, the system, the words, the codes — and nothing off the asset. */
const input = (over: Partial<WordingInput> = {}): WordingInput => ({
  assetTypeLabel: 'Portable extinguisher',
  system: 'extinguisher',
  observation: 'hose perished at the nozzle, pressure gauge reading 450 kPa',
  candidates: candidates(),
  ...over,
});

const answer = (code: string, wording: string) => `CODE: ${code}\nWORDING: ${wording}`;

describe('what goes up', () => {
  it('carries nothing off the asset, the site or the customer', () => {
    const prompt = buildWordingPrompt(input());
    for (const value of [
      FIXTURE_ASSET.code, FIXTURE_ASSET.name, FIXTURE_ASSET.serial, FIXTURE_ASSET.externalId, FIXTURE_ASSET.id,
      FIXTURE_ASSET.level, FIXTURE_ASSET.room, '417', '39917', 'Dana Reyes', '0400 000 001',
      FIXTURE_SITE.name, FIXTURE_SITE.address, FIXTURE_SITE.clientName, 'Harbourline',
    ]) {
      expect(prompt).not.toContain(value!);
    }
    // And it carries what the task needs.
    expect(prompt).toContain('Portable extinguisher');
    expect(prompt).toContain('hose perished at the nozzle');
    expect(prompt).toContain('EXT-EXT-001');
  });

  it('cannot be handed the asset by mistake', () => {
    // The input type has no field for a site, an asset code or a serial. A
    // screen that wants to send one has to add the field, and the test above
    // would then fail on it.
    const keys = Object.keys(input()).sort();
    expect(keys).toEqual(['assetTypeLabel', 'candidates', 'observation', 'system']);
  });

  it('offers at most six codes, with their wording and source', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...candidates()[0]!, code: `EXT-TST-${String(i).padStart(3, '0')}`, sourceRef: `AS 1851-2012 clause 1.${i}` }));
    const prompt = buildWordingPrompt(input({ candidates: many }));
    expect(prompt).toContain(`EXT-TST-00${MAX_CANDIDATES - 1}`);
    expect(prompt).not.toContain(`EXT-TST-00${MAX_CANDIDATES}`);
    expect(prompt).toContain('Source: AS 1851-2012 clause 1.0');
  });

  it('tells the model, in as many words, not to invent a code or a figure', () => {
    expect(WORDING_SYSTEM_PROMPT).toContain('Never invent a code');
    expect(WORDING_SYSTEM_PROMPT).toContain('Do not convert');
    expect(WORDING_SYSTEM_PROMPT).toContain('Do not name the site, the customer');
  });

  it('is not worth asking with nothing to say or nothing to pick from', () => {
    expect(worthDrafting(input({ observation: 'ok' })).ok).toBe(false);
    expect(worthDrafting(input({ candidates: [] })).ok).toBe(false);
    expect(worthDrafting(input()).ok).toBe(true);
    // A measurement on its own is something to say.
    expect(worthDrafting(input({ observation: '', measurements: { Pressure: '450 kPa' } })).ok).toBe(true);
  });
});

describe('what comes back', () => {
  it('accepts a good answer and reports the code\'s severity', () => {
    const r = checkWording(answer('EXT-EXT-001', 'Extinguisher hose found perished at the nozzle with the gauge reading 450 kPa. Replace the hose and re-test.'), input());
    expect(r.refusal).toBeUndefined();
    expect(r.code).toBe('EXT-EXT-001');
    expect(r.severity).toBe(defectByCode('EXT-EXT-001')!.severity);
    expect(r.wording).toContain('found perished');
  });

  it('refuses a code that was never offered', () => {
    // A detector code for an extinguisher: the model has stopped reading the
    // list and started composing.
    const r = checkWording(answer('DET-DET-001', 'Extinguisher hose found perished.'), input());
    expect(r.wording).toBeUndefined();
    expect(r.refusal).toContain('never offered');
  });

  it('refuses a made-up code as firmly as a real one from elsewhere', () => {
    const r = checkWording(answer('EXT-EXT-099', 'Extinguisher hose found perished.'), input());
    expect(r.refusal).toContain('EXT-EXT-099');
  });

  it('passes on an honest none', () => {
    const r = checkWording(answer('none', 'Nothing fits.'), input());
    expect(r.wording).toBeUndefined();
    expect(r.refusal).toContain('none of the offered codes');
  });

  it('refuses a figure that is in neither the observation nor the library', () => {
    // The failure that matters: "as required within 6 months" where nobody said six.
    const r = checkWording(answer('EXT-EXT-001', 'Extinguisher hose found perished; replace within 6 months.'), input());
    expect(r.wording).toBeUndefined();
    expect(r.refusal).toContain('"6"');
  });

  it('refuses a clause number nobody supplied', () => {
    const r = checkWording(answer('EXT-EXT-001', 'Extinguisher hose found perished, contrary to clause 4.2.'), input());
    expect(r.refusal).toContain('"4.2"');
  });

  it('allows a figure the technician wrote, a clause the candidate carries, and a comma in a thousand', () => {
    const withRef = candidates().map((c, i) => (i === 0 ? { ...c, sourceRef: 'AS 1851-2012 clause 10.4' } : c));
    const r = checkWording(
      answer('EXT-EXT-001', 'Gauge read 450 kPa against AS 1851-2012 clause 10.4; hose perished. Replace and re-test.'),
      input({ candidates: withRef }),
    );
    expect(r.refusal).toBeUndefined();
    expect(numbersIn('10,000 kPa')).toEqual(new Set(['10000']));
  });

  it('lets a wording name its own code without reading the code\'s digits as a figure', () => {
    // "EXT-EXT-001" is a name. Counted as a number it is "1", which is in
    // neither the observation nor the library, and the check would refuse
    // every wording that cites the code it was told to pick.
    const r = checkWording(answer('EXT-EXT-001', 'Extinguisher hose found perished at the nozzle (EXT-EXT-001). Replace the hose.'), input());
    expect(r.refusal).toBeUndefined();
    expect(r.wording).toContain('EXT-EXT-001');
    // Lower-cased by the model, still the code.
    expect(checkWording(answer('EXT-EXT-001', 'Hose found perished, ext-ext-001.'), input()).refusal).toBeUndefined();
  });

  it('takes the wording alone when the model answers WORDING before CODE', () => {
    const r = checkWording('WORDING: Extinguisher hose found perished at the nozzle.\nCODE: EXT-EXT-001', input());
    expect(r.code).toBe('EXT-EXT-001');
    expect(r.wording).toBe('Extinguisher hose found perished at the nozzle.');
    expect(r.wording).not.toContain('CODE');
  });

  it('refuses a wording longer than the record takes', () => {
    const r = checkWording(answer('EXT-EXT-001', 'Hose perished. '.repeat(40)), input());
    expect(r.wording).toBeUndefined();
    expect(r.refusal).toContain(String(MAX_WORDING_CHARS));
  });

  it('refuses an answer not in the shape asked for', () => {
    const r = checkWording('The hose is perished, replace it.', input());
    expect(r.refusal).toContain('shape asked for');
  });

  it('refuses nothing at all', () => {
    expect(checkWording('   ', input()).refusal).toContain('returned nothing');
  });
});

describe('over the wire, with a fake fetch', () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const realFetch = global.fetch;

  const fake = (status: number, text?: string) => {
    global.fetch = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ content: text === undefined ? [] : [{ type: 'text', text }] }),
      };
    }) as unknown as typeof fetch;
  };

  beforeEach(() => { __reset(); calls.length = 0; });
  afterAll(() => { global.fetch = realFetch; });

  it('sends nothing with no key, and says where the key goes', async () => {
    fake(200, answer('EXT-EXT-001', 'Hose found perished.'));
    const r = await draftDefectWording(input());
    expect(r.wording).toBeUndefined();
    expect(r.refusal).toContain('No API key');
    expect(calls).toHaveLength(0);
  });

  it('sends exactly the built prompt and checks the answer on the way back', async () => {
    await setItemAsync('safeqld.anthropic.key', 'test-key');
    fake(200, answer('EXT-EXT-001', 'Extinguisher hose found perished at the nozzle. Replace the hose and re-test.'));
    const r = await draftDefectWording(input());
    expect(r.code).toBe('EXT-EXT-001');
    expect(calls).toHaveLength(1);
    const sent = calls[0]!.body;
    expect(sent.system).toBe(WORDING_SYSTEM_PROMPT);
    expect((sent.messages as { content: string }[])[0]!.content).toBe(buildWordingPrompt(input()));
    expect(JSON.stringify(sent)).not.toContain('Harbourline');
  });

  it('turns a rejected key, a rate limit and a bad answer into refusals, never a throw', async () => {
    await setItemAsync('safeqld.anthropic.key', 'test-key');
    fake(401);
    expect((await draftDefectWording(input())).refusal).toContain('rejected');
    fake(429);
    expect((await draftDefectWording(input())).refusal).toContain('Rate limited');
    fake(200, answer('DET-DET-001', 'Something about a detector.'));
    expect((await draftDefectWording(input())).refusal).toContain('never offered');
    global.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await draftDefectWording(input())).refusal).toContain('no signal');
  });

  it('still answers the grounded search the same way after the refactor', async () => {
    const passages = [{ citation: 'QDC MP 6.1 page 8', text: 'Within 10 business days.', source: 'test' }];
    expect((await askGrounded({ question: 'when is the copy due', passages })).refusal).toContain('No API key is set');
    await setItemAsync('safeqld.anthropic.key', 'test-key');
    fake(200, 'Ten business days [1].');
    const a = await askGrounded({ question: 'when is the copy due', passages });
    expect(a.text).toBe('Ten business days [1].');
    expect(a.cited[0]!.citation).toBe('QDC MP 6.1 page 8');
    fake(200, 'Five years [4].');
    expect((await askGrounded({ question: 'when is the copy due', passages })).refusal).toContain('never sent to it');
    fake(200);
    expect((await askGrounded({ question: 'when is the copy due', passages })).refusal).toContain('returned nothing');
  });
});
