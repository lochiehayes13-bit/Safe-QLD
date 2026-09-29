/**
 * Asking a language model a question about a fire system, safely.
 *
 * The app's search is deliberately not a language model: it hands over the
 * clause and lets a technician read it, because a thing that answers in
 * confident sentences and is wrong is far more dangerous on a ladder than a
 * thing that says "I don't know". That stays true. What a model can genuinely
 * add is the last mile — reading the six passages the search already found and
 * saying which one actually answers the question.
 *
 * So this module is the harness, and its whole job is to stop the model doing
 * the thing models do. Three rules, all enforced here rather than hoped for:
 *
 * **It only ever sees what the app retrieved.** The question goes up with the
 * retrieved passages and nothing else. No site data, no customer names, no
 * defect history — a technician asking "how far off the wall" has not consented
 * to sending Ipswich Hospital's asset register to a third party.
 *
 * **It cannot answer beyond them.** The instruction is explicit and the answer
 * is checked on the way back: an answer citing a passage that was not supplied
 * is discarded rather than shown. A model that invents a clause number is not a
 * degraded answer, it is a wrong one, and this is a trade where someone acts on
 * it.
 *
 * **Nothing works without it.** Every part of the app that matters runs offline
 * with no key and no signal. This is a layer on top of a search that already
 * works, never a replacement for one, and where it is unavailable the app says
 * so and shows the passages.
 */

export interface Passage {
  /** How the answer must cite it: "AS 2419.1:2005 clause 10.4", "QDC MP 6.1 page 8". */
  citation: string;
  text: string;
  /** Where it came from, for the technician not the model. */
  source: string;
}

export interface GroundedQuestion {
  question: string;
  passages: Passage[];
}

/** The most passages worth sending. Beyond this the useful ones get buried. */
export const MAX_PASSAGES = 8;
/** Characters per passage. A whole page crowds out the other passages. */
export const MAX_PASSAGE_CHARS = 1200;

export const SYSTEM_PROMPT = [
  'You are helping a fire protection technician in Queensland, Australia, who is on site and may',
  'be up a ladder. Answer only from the numbered passages given to you.',
  '',
  'Rules, all absolute:',
  '1. If the passages do not answer the question, say exactly: I don\'t know from what is here.',
  '   Then say what would answer it. Never fall back on general knowledge — a plausible wrong',
  '   answer about a fire system is worse than no answer.',
  '2. Cite every claim with the bracketed number of the passage it came from, like [2].',
  '   A sentence with no citation will be discarded.',
  '3. Never state a figure, dimension, pressure, interval or clause number that is not in a',
  '   passage. Do not convert, round or interpolate one either.',
  '4. Be brief. Two or three sentences. A technician is holding a torch.',
  '5. Australian conventions: metric, dates as d/m/yyyy.',
].join('\n');

/** Trims a passage without cutting mid-sentence where it can be helped. */
export function trimPassage(text: string, limit = MAX_PASSAGE_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return `${stop > limit * 0.6 ? cut.slice(0, stop + 1) : cut}…`;
}

/**
 * Builds the message.
 *
 * Passages are numbered from one because that is how the answer has to cite
 * them, and a model asked to cite from a zero-based list gets it wrong often
 * enough to matter.
 */
export function buildPrompt(input: GroundedQuestion): string {
  const passages = input.passages.slice(0, MAX_PASSAGES);
  const numbered = passages
    .map((p, i) => `[${i + 1}] ${p.citation}\n${trimPassage(p.text)}`)
    .join('\n\n');

  return [
    'Passages:',
    '',
    numbered || '(none)',
    '',
    `Question: ${input.question.trim()}`,
  ].join('\n');
}

export interface GroundedAnswer {
  /** The answer, or undefined where it was refused or could not be trusted. */
  text?: string;
  /** Passages the answer actually cited, in the order cited. */
  cited: Passage[];
  /** Why there is no answer, in words a technician can act on. */
  refusal?: string;
}

const DONT_KNOW = /i don'?t know from what is here/i;
const CITATION = /\[(\d{1,2})\]/g;

/**
 * Checks the answer before anybody reads it.
 *
 * The model is instructed to cite; this is what happens when it does not, or
 * cites something that was never sent. Both are treated the same way — the
 * answer is thrown away — because an answer that cites [9] out of six passages
 * has stopped reading them and started composing.
 */
export function checkAnswer(raw: string, passages: readonly Passage[]): GroundedAnswer {
  const text = raw.trim();
  const available = passages.slice(0, MAX_PASSAGES);

  if (!text) {
    return { cited: [], refusal: 'The model returned nothing. The passages are below; read them yourself.' };
  }

  if (DONT_KNOW.test(text)) {
    return {
      cited: [],
      refusal: `${text}\n\nThat is the honest answer rather than a guess. The passages the search `
        + 'found are below.',
    };
  }

  const numbers = [...text.matchAll(CITATION)].map((m) => Number(m[1]));

  if (!numbers.length) {
    return {
      cited: [],
      refusal: 'The answer cited nothing, so there is no way to check it against the documents. '
        + 'Discarded — read the passages below instead.',
    };
  }

  const outOfRange = numbers.filter((n) => n < 1 || n > available.length);
  if (outOfRange.length) {
    return {
      cited: [],
      refusal: `The answer cited passage ${outOfRange[0]}, which was never sent to it. An answer `
        + 'citing something that does not exist has stopped reading and started composing, so it '
        + 'has been discarded. Read the passages below.',
    };
  }

  const seen = new Set<number>();
  const cited: Passage[] = [];
  for (const n of numbers) {
    if (seen.has(n)) continue;
    seen.add(n);
    cited.push(available[n - 1]!);
  }

  return { text, cited };
}

/**
 * Whether a question is worth sending at all.
 *
 * Nothing retrieved means nothing to ground an answer in, and sending it anyway
 * invites exactly the invention this module exists to prevent. The search
 * already said "I don't know"; the model does not get a second go at it.
 */
export function worthAsking(input: GroundedQuestion): { ok: boolean; reason?: string } {
  if (input.question.trim().length < 5) {
    return { ok: false, reason: 'Too short to answer.' };
  }
  if (!input.passages.length) {
    return {
      ok: false,
      reason: 'The search found nothing to answer from, so there is nothing to reason over. '
        + 'Asking anyway would only invite an invented answer.',
    };
  }
  return { ok: true };
}

/**
 * What leaves the device, stated plainly.
 *
 * Shown before the feature is turned on, because a technician agreeing to this
 * should know what it means. The app sends the question and the passages; it
 * does not send the site, the customer, the asset register or anything else it
 * holds.
 */
export const PRIVACY_NOTE = [
  'When this is on, a question you ask and the passages the search found for it are sent to',
  'Anthropic to be answered. Nothing else goes with them:',
  'not the site, not the customer, not your asset register, not your defects,',
  'not your photographs.',
  '',
  'It needs a network, so it does not work in a plant room. Everything else in this app does,',
  'and the search underneath this one answers with or without it.',
].join('\n');
