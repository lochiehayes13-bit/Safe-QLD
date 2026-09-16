import { complete, type CompletionImage } from './client';
import { FORMATS, readDateCode, type DateReading } from '@/calc/deviceAge';

/**
 * Reading a detector's label from a photograph.
 *
 * The date code on the back of a head is four to nine digits in a font the
 * size of a grain of rice, on a curved surface, under a ceiling. Reading it
 * by eye and typing it into a phone is where a wrong year gets into a
 * client's effectiveness report — and a wrong year is the difference between
 * "these heads are fine" and "these heads are two years past the
 * manufacturer's life".
 *
 * So the phone photographs the label and a model transcribes it. That is
 * the whole of the model's job: **it reads characters, it never decides an
 * age.** What it saw comes back as text, the app's own decoder in
 * `@/calc/deviceAge` turns that text into dates exactly as it does for a
 * typed code, and the screen shows both halves — what was transcribed, and
 * how the decoder read it — so the technician can hold the head up and
 * check the transcription against the label with their own eyes.
 *
 * The checks on the way back follow the app's rule for every model feature:
 * a transcription is a string of characters that appears on the label, a
 * brand is one the decoder knows or "other", and anything else the model
 * volunteers is dropped. The model is not asked what year the head was
 * made, and an answer that says so anyway is ignored.
 *
 * What leaves the phone is the photograph of the label and the words below.
 * Nothing about the site, the job or the customer goes with it.
 */

export const LABEL_SYSTEM_PROMPT = [
  'You are reading the manufacturer\'s label on the back of a fire detector head from a photograph.',
  'Transcribe exactly what is printed. Do not interpret dates, do not guess an age, do not correct what you see.',
  '',
  'Answer with JSON only, no prose, in this shape:',
  '{"brand": string, "model": string, "codes": [{"text": string, "where": string}], "dateText": string, "readable": boolean, "notes": string}',
  '',
  '- brand: the manufacturer name printed on the label, exactly as printed; "" if none is visible.',
  '- model: the model or part number printed, exactly; "" if none.',
  '- codes: every group of digits (with any dashes) of four or more characters printed on the label that could be a date code, batch or serial — each with a few words on where it sits ("below the barcode", "stamped in the plastic"). Transcribe every character; if one is doubtful put the alternatives in brackets, like 60[1/7]5.',
  '- dateText: any words on the label that give a date directly, such as "Date of manufacture 05/2016", or "".',
  '- readable: false if the label cannot be read well enough to transcribe any code.',
  '- notes: one sentence on legibility.',
].join('\n');

export function buildLabelPrompt(): string {
  return 'Transcribe this detector label. JSON only.';
}

/** What the model said it saw, after the checks. */
export interface LabelTranscription {
  brand: string;
  /** Which brand the decoder will treat it as, from the brands it knows. */
  knownBrand?: 'Notifier' | 'Hochiki' | 'Apollo';
  model: string;
  codes: { text: string; where: string }[];
  dateText: string;
  readable: boolean;
  notes: string;
}

/** A code the decoder could read, with every date it can mean. */
export interface CodeReading {
  code: string;
  where: string;
  readings: DateReading[];
}

export interface LabelResult {
  transcription?: LabelTranscription;
  /** Every candidate code the decoder tried, readable or not. */
  codes: CodeReading[];
  /** How the answer was arrived at, step by step, for the technician to check. */
  howRead: string[];
  /** Why there is nothing usable. Present exactly when `codes` has no readings. */
  refusal?: string;
}

const KNOWN_BRANDS: { test: RegExp; brand: 'Notifier' | 'Hochiki' | 'Apollo' }[] = [
  { test: /notifier|system sensor|honeywell/i, brand: 'Notifier' },
  { test: /hochiki/i, brand: 'Hochiki' },
  { test: /apollo/i, brand: 'Apollo' },
];

/** Digits and dashes, four to twelve characters, with any bracketed alternatives kept. */
const CODE_SHAPE = /^[0-9\-[\]/ ]{4,20}$/;

/**
 * Reads the model's JSON, keeping only what passes the checks.
 *
 * Tolerant of a code fence around the JSON and of missing fields; intolerant
 * of a code that is not made of digits, because the decoder only reads
 * digits and a transcription with letters in it is a transcription of the
 * wrong thing. Returns undefined where nothing usable came back.
 */
export function parseTranscription(raw: string): LabelTranscription | undefined {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const o = parsed as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const codes = Array.isArray(o.codes)
    ? o.codes
      .map((c) => (c && typeof c === 'object' ? { text: str((c as Record<string, unknown>).text), where: str((c as Record<string, unknown>).where) } : { text: '', where: '' }))
      .filter((c) => CODE_SHAPE.test(c.text))
    : [];
  const brand = str(o.brand);
  const known = KNOWN_BRANDS.find((k) => k.test.test(`${brand} ${str(o.model)}`))?.brand;
  return {
    brand,
    knownBrand: known,
    model: str(o.model),
    codes,
    dateText: str(o.dateText),
    readable: o.readable !== false,
    notes: str(o.notes),
  };
}

/**
 * Every way a transcription with bracketed doubts can be read.
 *
 * "60[1/7]5" is two codes. The alternatives multiply, so they are capped:
 * more than eight ways is a label that needs a better photograph, not a
 * longer list.
 */
export function expandDoubts(code: string, cap = 8): string[] {
  const m = code.match(/\[([^\]]+)\]/);
  if (!m) return [code.replace(/\s+/g, '')];
  const options = m[1]!.split('/').map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const opt of options) {
    for (const rest of expandDoubts(code.replace(m[0], opt), cap)) {
      if (out.length >= cap) return out;
      if (!out.includes(rest)) out.push(rest);
    }
  }
  return out;
}

/**
 * Turns a transcription into dates, the same way a typed code is turned.
 *
 * The decoder gets the brand only where the label named one it knows;
 * otherwise it tries every format, which is what it does for a code typed
 * with the make set to "Any". The explanation is built as it goes so the
 * screen can print exactly the chain from pixels to a year.
 */
export function decodeTranscription(
  t: LabelTranscription,
  options: { today: Date; knownInServiceYear?: number; earliestYear?: number },
): LabelResult {
  const howRead: string[] = [];
  howRead.push(t.readable
    ? `The label was transcribed from the photograph${t.brand ? ` as a ${t.brand} head` : ''}${t.model ? `, model ${t.model}` : ''}.`
    : 'The photograph was not clear enough to transcribe a code.');
  if (t.knownBrand) howRead.push(`The decoder is reading it as ${t.knownBrand}, whose date code formats this app holds.`);
  else if (t.brand) howRead.push(`"${t.brand}" is not a make this app holds formats for, so every format is tried.`);
  if (t.dateText) howRead.push(`The label also says: "${t.dateText}". That is printed, not decoded, and it wins if the two disagree.`);

  const codes: CodeReading[] = [];
  for (const c of t.codes) {
    for (const variant of expandDoubts(c.text)) {
      const readings = readDateCode(variant, {
        brand: t.knownBrand,
        today: options.today,
        knownInServiceYear: options.knownInServiceYear,
        earliestYear: options.earliestYear,
      });
      codes.push({ code: variant, where: c.where, readings });
      if (readings.length) {
        const formats = [...new Set(readings.map((r) => FORMATS[r.format].label))];
        howRead.push(`"${variant}"${c.where ? ` (${c.where})` : ''} fits ${formats.join('; ')} — ${readings.length} possible date${readings.length === 1 ? '' : 's'}.`);
      } else {
        howRead.push(`"${variant}"${c.where ? ` (${c.where})` : ''} fits no format this app knows, so it is shown and not dated.`);
      }
    }
  }

  const usable = codes.some((c) => c.readings.length);
  if (!usable) {
    return {
      transcription: t,
      codes,
      howRead,
      refusal: t.readable
        ? (t.codes.length ? 'The digits transcribed fit no date code format this app holds. Check them against the label, or type the code by hand.' : 'No code was found on the label. Try a closer photograph of the back of the head, or type the code by hand.')
        : 'The photograph was not clear enough. Get closer, keep the label flat to the lens, and use the torch.',
    };
  }
  howRead.push('Every date above came from the app\'s own decoder, not from the model. The model only transcribed the characters.');
  return { transcription: t, codes, howRead };
}

/** Why this is on the screen at all — shown beside the button, because it earns its place. */
export const WHY_PHOTO_READING = [
  'A date code is four to nine digits in tiny print on a curved surface, read by torchlight on a ladder. Reading it by eye and typing it is where a wrong year gets into a client\'s report.',
  'The year in a System Sensor code is one digit, so 6015 is 2016 or 2006 and the difference is a head in life or two years past it. A photograph is evidence that can be checked later; a typed number is not.',
  'An effectiveness assessment samples dozens of heads. Photographing each label is faster than typing each code, and the photographs go on the report.',
  'The model only transcribes. The dates come from the same decoder a typed code goes through, so a photograph can never produce an age the app could not have produced from the digits.',
];

/**
 * Photographs a label and reads it, or says why it could not.
 *
 * Never throws. Every refusal leaves the typed field usable: this only ever
 * offers to fill it.
 */
export async function readLabelFromPhoto(
  image: CompletionImage,
  options: { today: Date; knownInServiceYear?: number; earliestYear?: number },
): Promise<LabelResult> {
  const result = await complete({ system: LABEL_SYSTEM_PROMPT, user: buildLabelPrompt(), images: [image], maxTokens: 500 });
  if (result.text === undefined) {
    switch (result.failure) {
      case 'no-key':
        return { codes: [], howRead: [], refusal: 'No API key is set. Add one in Settings to read labels from a photograph; the code can still be typed.' };
      case 'no-answer':
        return { codes: [], howRead: [], refusal: 'No answer came back — most likely no signal. Type the code for now.' };
      default:
        return { codes: [], howRead: [], refusal: `${result.refusal ?? 'No answer.'} Type the code for now.` };
    }
  }
  const t = parseTranscription(result.text);
  if (!t) return { codes: [], howRead: [], refusal: 'The answer could not be read. Try the photograph again, or type the code.' };
  return decodeTranscription(t, options);
}
