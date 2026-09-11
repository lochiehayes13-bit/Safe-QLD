import { complete } from './client';
import { SYSTEM_LABELS, type SystemKind } from '@/seed/assetTypes';
import type { DefectCode, Severity } from '@/seed/defectLibrary';

/**
 * Writing a defect up, from what the technician saw.
 *
 * The record has a register — third person, past tense, what was found and
 * what it must do, the clause where there is one — and the observation a
 * technician types on a ladder does not. Turning the one into the other is
 * what the library's coded wording is for, and what a model can genuinely
 * help with when the observation does not sit neatly under one code.
 *
 * The same three rules as the grounded search, enforced here rather than
 * hoped for:
 *
 * **It only ever sees what the task needs.** The type of asset, the system it
 * belongs to, the observation, and the handful of library codes the ranking
 * put forward, with their wording. Not the site, not the customer, not the
 * asset's code or serial, not the job number. A technician writing up a
 * cracked extinguisher hose has not consented to sending a hospital's name
 * to a third party, and the wording does not need it.
 *
 * **It cannot answer beyond them.** It must pick one of the candidate codes,
 * and the answer is checked on the way back: a code that was not offered is
 * refused, a wording that runs past the record's length is refused, and a
 * figure or clause number that appears in neither the observation nor the
 * candidates is refused. A model that helpfully adds "as required by clause
 * 4.2" has authored a citation nobody supplied, and on a service record that
 * is a wrong statement in the company's name.
 *
 * **Nothing depends on it.** The library wording works with no key and no
 * signal; the technician's own words are always editable; the button that
 * calls this says why when it cannot.
 */

/** The most codes worth offering. More than this and the model picks the first one it reads. */
export const MAX_CANDIDATES = 6;
/** The longest wording the record will take. A defect is a sentence or two, not a report. */
export const MAX_WORDING_CHARS = 400;

export interface WordingInput {
  /** The asset type's label, e.g. "Portable extinguisher". Never the asset's own name or code. */
  assetTypeLabel: string;
  system: SystemKind;
  /** What the technician saw, in their words. */
  observation: string;
  /** The library codes the ranking put forward, best first. Trimmed to MAX_CANDIDATES. */
  candidates: DefectCode[];
  /** Readings the technician took, e.g. { 'Pressure': '450 kPa' }. */
  measurements?: Record<string, string | number>;
}

export interface WordingResult {
  /** The wording for the record, or undefined where it was refused. */
  wording?: string;
  /** The library code it chose, always one of the candidates. */
  code?: string;
  /** That code's severity, so the screen shows what the record will carry. */
  severity?: Severity;
  /** Why there is no wording, in words a technician can act on. */
  refusal?: string;
}

export const WORDING_SYSTEM_PROMPT = [
  'You write defect entries for a fire protection service record in Queensland, Australia.',
  'A technician has described what they found. Your job is to say the same thing in the',
  'register of the record and to pick which of the library codes offered it falls under.',
  '',
  'Rules, all absolute:',
  '1. Pick exactly one CODE from the candidates offered. Never invent a code and never',
  '   answer with one that was not offered. If none fits, answer CODE: none.',
  '2. Write the WORDING in the third person and the past tense: what was found, and what',
  '   must be done. One or two sentences. Under 400 characters.',
  '3. Never state a figure, dimension, pressure, date, interval or clause number that is',
  '   not in the observation, the measurements or the candidate wording. Do not convert,',
  '   round or estimate one either.',
  '4. Where the chosen candidate carries a source reference, you may cite it exactly as',
  '   written. Cite nothing else.',
  '5. Do not name the site, the customer, or any person, and do not add anything the',
  '   technician did not observe.',
  '6. Australian spelling and metric units.',
  '',
  'Answer in exactly this shape, and nothing else:',
  'CODE: <one of the candidate codes, or none>',
  'WORDING: <the wording>',
].join('\n');

/**
 * Builds the message. Everything the model sees is in this string, so the
 * test that the prompt carries no customer data is a test of this function.
 */
export function buildWordingPrompt(input: WordingInput): string {
  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  const listed = candidates.map((c) => [
    `- ${c.code} (${c.severity}): ${c.defect}`,
    `  Wording: ${c.reportWording}`,
    c.rectification ? `  Rectification: ${c.rectification}` : undefined,
    c.sourceRef ? `  Source: ${c.sourceRef}` : undefined,
  ].filter(Boolean).join('\n')).join('\n');

  const measurements = Object.entries(input.measurements ?? {})
    .filter(([, v]) => String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  return [
    `Asset type: ${input.assetTypeLabel}`,
    `System: ${SYSTEM_LABELS[input.system]}`,
    '',
    'Observation:',
    input.observation.trim() || '(none given)',
    measurements ? `\nMeasurements:\n${measurements}` : undefined,
    '',
    'Candidate codes:',
    listed || '(none)',
  ].filter((l) => l !== undefined).join('\n');
}

/**
 * Whether there is enough to ask.
 *
 * A blank observation and no measurements means the model would be writing
 * from the candidate list alone, which is the library wording with extra
 * steps and none of the checking. No candidates means there is nothing it is
 * allowed to pick, so it would either refuse or invent.
 */
export function worthDrafting(input: WordingInput): { ok: boolean; reason?: string } {
  const hasMeasurement = Object.values(input.measurements ?? {}).some((v) => String(v).trim());
  if (input.observation.trim().length < 4 && !hasMeasurement) {
    return { ok: false, reason: 'Say what you found first — a few words is enough.' };
  }
  if (!input.candidates.length) {
    return { ok: false, reason: 'No library code covers this system, so there is nothing for it to choose from. Write the wording yourself.' };
  }
  return { ok: true };
}

/** Every number in a piece of text, as written: "450", "4.2", "10,000", "2.5". */
const NUMBER = /\d+(?:[.,]\d+)*/g;

export function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER)].map((m) => normaliseNumber(m[0])));
}

/**
 * "10,000" and "10000" are one number, and so are "04" and "4" — a date the
 * prompt wrote as 04/03/2026 may come back as 4/3/2026. "4.20" and "4.2" are
 * not, because a clause number is a name, not a quantity.
 */
function normaliseNumber(n: string): string {
  return n.replace(/,/g, '').replace(/^0+(?=\d)/, '');
}

/** The text with every candidate code taken out, however it was capitalised. */
function withoutCodes(text: string, candidates: readonly Pick<DefectCode, 'code'>[]): string {
  let out = text;
  for (const c of candidates) {
    const escaped = c.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), ' ');
  }
  return out;
}

/**
 * Checks the answer before anybody reads it.
 *
 * The three refusals are the three ways a model composes rather than reads:
 * a code it was not offered, a wording long enough to be padding, and a
 * number from nowhere. Each is thrown away rather than shown with a caveat,
 * because a caveat under an invented clause number does not stop anybody
 * copying the clause number.
 */
export function checkWording(raw: string, input: WordingInput): WordingResult {
  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  const text = raw.trim();
  if (!text) return { refusal: 'The model returned nothing. The library wording below still stands.' };

  const codeLine = text.match(/^\s*CODE:\s*(.+?)\s*$/im);
  // The wording runs to the next CODE: line or the end, whichever is first:
  // a model that answers WORDING before CODE must not have the code line
  // swallowed into the sentence that goes on the record.
  const wordingMatch = text.match(/WORDING:\s*([\s\S]*?)(?=\n\s*CODE:|$)/i);
  if (!codeLine || !wordingMatch) {
    return { refusal: 'The answer did not come back in the shape asked for, so it cannot be checked. Discarded.' };
  }

  const codeText = codeLine[1]!.trim();
  if (/^none$/i.test(codeText)) {
    return { refusal: 'The model said none of the offered codes fit. Pick one yourself, or write the wording without a code.' };
  }
  const chosen = candidates.find((c) => c.code.toLowerCase() === codeText.toLowerCase());
  if (!chosen) {
    return {
      refusal: `The answer chose ${codeText}, which was never offered to it. An answer picking a code it was not `
        + 'given has stopped reading and started composing, so it has been discarded.',
    };
  }

  const wording = wordingMatch[1]!.replace(/\s+/g, ' ').trim();
  if (!wording) return { refusal: 'The answer carried no wording. Discarded.' };
  if (wording.length > MAX_WORDING_CHARS) {
    return { refusal: `The wording ran to ${wording.length} characters; the record takes ${MAX_WORDING_CHARS}. Discarded rather than cut.` };
  }

  const allowed = new Set<string>();
  const permit = (s: string | undefined) => { if (s) for (const n of numbersIn(s)) allowed.add(n); };
  permit(input.observation);
  for (const v of Object.values(input.measurements ?? {})) permit(String(v));
  // The code's digits are not permitted: they are a name, and a wording that
  // quotes "001" as a quantity has misread the list. A wording that names
  // the code whole ("under EXT-EXT-001") is fine, so the codes are taken out
  // before the count rather than their digits let in.
  for (const c of candidates) {
    permit(c.reportWording);
    permit(c.rectification);
    permit(c.sourceRef);
    permit(c.clientWording);
  }
  const foreign = [...numbersIn(withoutCodes(wording, candidates))].filter((n) => !allowed.has(n));
  if (foreign.length) {
    return {
      refusal: `The wording states "${foreign[0]}", a figure that is in neither what you wrote nor the library. `
        + 'A number from nowhere on a service record is the failure this check exists for, so it has been discarded.',
    };
  }

  return { wording, code: chosen.code, severity: chosen.severity };
}

/**
 * Drafts the wording, or says why it did not.
 *
 * Never throws. The key comes from the same keystore slot as the grounded
 * search; there is one key and one privacy note for both.
 */
export async function draftDefectWording(input: WordingInput): Promise<WordingResult> {
  const worth = worthDrafting(input);
  if (!worth.ok) return { refusal: worth.reason };

  const result = await complete({
    system: WORDING_SYSTEM_PROMPT,
    user: buildWordingPrompt(input),
    maxTokens: 300,
  });

  if (result.text === undefined) {
    switch (result.failure) {
      case 'no-key':
        return { refusal: 'No API key is set. The library wording and your own words are the record; add a key in Settings to have it drafted.' };
      case 'no-answer':
        return { refusal: 'No answer came back — most likely no signal. The library wording still stands.' };
      default:
        return { refusal: `${result.refusal ?? 'No answer.'} The library wording still stands.` };
    }
  }

  return checkWording(result.text, input);
}
