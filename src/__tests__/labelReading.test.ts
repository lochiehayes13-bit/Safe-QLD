import {
  LABEL_SYSTEM_PROMPT, WHY_PHOTO_READING, decodeTranscription, expandDoubts, parseTranscription,
} from '@/ai/labelReading';
import { messageContent } from '@/ai/client';

/**
 * Reading a detector label from a photograph.
 *
 * The model transcribes; it never decides an age. So the tests are about
 * the seam: what is accepted from the model, and that every date on the
 * screen came from the app's own decoder with the same answer it gives a
 * typed code.
 */

const today = new Date('2026-09-10T00:00:00Z');

describe('what is sent', () => {
  it('asks for transcription, never for an age', () => {
    expect(LABEL_SYSTEM_PROMPT).toContain('Do not interpret dates');
    expect(LABEL_SYSTEM_PROMPT).toContain('JSON only');
  });

  it('puts the photograph before the words, in the shape the API reads', () => {
    const content = messageContent('Transcribe.', [{ base64: 'AAAA', mediaType: 'image/jpeg' }]);
    expect(Array.isArray(content)).toBe(true);
    expect((content as { type: string }[]).map((c) => c.type)).toEqual(['image', 'text']);
    // Without a photograph the message is the plain string it always was.
    expect(messageContent('Hello')).toBe('Hello');
  });
});

describe('what is accepted back', () => {
  it('reads the JSON, with or without a fence, and keeps only digit codes', () => {
    const t = parseTranscription('```json\n{"brand":"System Sensor","model":"2251","codes":[{"text":"6015","where":"below barcode"},{"text":"ABC-1","where":"top"}],"dateText":"","readable":true,"notes":"clear"}\n```')!;
    expect(t.knownBrand).toBe('Notifier');
    expect(t.codes).toEqual([{ text: '6015', where: 'below barcode' }]);
  });

  it('treats an unknown make as every format', () => {
    const t = parseTranscription('{"brand":"Acme","codes":[{"text":"6015","where":""}]}')!;
    expect(t.knownBrand).toBeUndefined();
    expect(t.readable).toBe(true);
  });

  it('gives up on prose, and on nothing', () => {
    expect(parseTranscription('The label says 6015.')).toBeUndefined();
    expect(parseTranscription('')).toBeUndefined();
  });

  it('expands a bracketed doubt into each reading, capped', () => {
    expect(expandDoubts('60[1/7]5')).toEqual(['6015', '6075']);
    expect(expandDoubts('[1/2][3/4][5/6][7/8]', 4)).toHaveLength(4);
    expect(expandDoubts('6015')).toEqual(['6015']);
  });
});

describe('the dates come from the decoder', () => {
  it('reads a System Sensor code exactly as a typed one is read', () => {
    const t = parseTranscription('{"brand":"Notifier","codes":[{"text":"6015","where":"back"}],"readable":true}')!;
    const r = decodeTranscription(t, { today });
    expect(r.refusal).toBeUndefined();
    expect(r.codes[0]!.readings.length).toBeGreaterThan(0);
    expect(r.codes[0]!.readings.every((x) => x.format === 'system-sensor')).toBe(true);
    expect(r.howRead.some((h) => h.includes('Notifier'))).toBe(true);
    expect(r.howRead[r.howRead.length - 1]).toContain('app\'s own decoder');
  });

  it('narrows with an install year the same way the typed screen does', () => {
    const t = parseTranscription('{"brand":"Notifier","codes":[{"text":"6015","where":""}],"readable":true}')!;
    const open = decodeTranscription(t, { today });
    const narrowed = decodeTranscription(t, { today, knownInServiceYear: 2017, earliestYear: 2014 });
    expect(narrowed.codes[0]!.readings.length).toBeLessThanOrEqual(open.codes[0]!.readings.length);
  });

  it('refuses digits that fit nothing rather than offering the nearest thing', () => {
    const t = parseTranscription('{"brand":"Notifier","codes":[{"text":"99-99","where":""}],"readable":true}')!;
    const r = decodeTranscription(t, { today });
    expect(r.refusal).toContain('fit no date code format');
    expect(r.codes[0]!.readings).toEqual([]);
  });

  it('says when the photograph was not good enough', () => {
    const t = parseTranscription('{"readable":false,"codes":[],"notes":"blurred"}')!;
    expect(decodeTranscription(t, { today }).refusal).toContain('not clear enough');
  });

  it('keeps a printed date beside the decoded ones, and says it wins', () => {
    const t = parseTranscription('{"brand":"Hochiki","codes":[{"text":"0124","where":""}],"dateText":"MFG 12/2000","readable":true}')!;
    const r = decodeTranscription(t, { today });
    expect(r.howRead.some((h) => h.includes('MFG 12/2000') && h.includes('wins'))).toBe(true);
  });
});

describe('why it is on the screen', () => {
  it('says so in words a technician would accept', () => {
    expect(WHY_PHOTO_READING.length).toBeGreaterThanOrEqual(3);
    expect(WHY_PHOTO_READING.join(' ')).toContain('only transcribes');
  });
});
