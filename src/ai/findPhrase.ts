import { complete } from './client';
import { KIND_ORDER, type SearchKind } from '@/domain/search';
import { readPhrase, type PhraseReading } from '@/domain/findPhrase';

/**
 * The last mile of the search box: a phrase the word lists could not read.
 *
 * `@/domain/findPhrase` reads a typed sentence with two word lists and no
 * network, and gets most of them: it knows "invoices", "purchase orders",
 * "who do I ring". What it cannot do is read a phrasing nobody put in a
 * list — "anything outstanding with the pump mob", "that job the sparky
 * was on at the hospital" — because there is no list of how people talk.
 *
 * So a model may be asked, and its answer is treated as a suggestion about
 * *which words to search for*, never as an answer in itself. Three rules,
 * all enforced here rather than asked for:
 *
 * **It only ever sees the phrase.** What goes up is the words typed into
 * the box and the names of the ten kinds of record. No job, no customer,
 * no site, no row of any kind. A person typing "the hospital" into a search
 * box has not consented to sending their client list anywhere.
 *
 * **It cannot invent a word.** The terms it comes back with must every one
 * of them appear in what was typed. A model that answers "Harbourline" to
 * "that job at the tower" has made up a customer, and searching for it
 * would put a confident, wrong answer in front of somebody. Checked on the
 * way back; an answer that fails is dropped, not shown.
 *
 * **It cannot invent a kind.** The kind must be one of the ten the app
 * searches, or none.
 *
 * Nothing here is required. With no key, no signal, or a refusal, the plain
 * reading stands and the search runs exactly as it did before.
 */

export interface PhraseSuggestion {
  /** The words to search for. Always a subset of what was typed. */
  terms: string;
  /** The kind to search, where the model picked one of the app's own. */
  kind?: SearchKind;
}

export type PhraseSuggestionResult =
  | { suggestion: PhraseSuggestion; refusal?: undefined }
  | { suggestion?: undefined; refusal: string };

/** The longest phrase worth sending. Past this it is not a search, it is a paragraph. */
export const MAX_PHRASE_CHARS = 120;

export const FIND_SYSTEM_PROMPT = [
  'You turn a phrase typed into a search box into a search. The box searches records a fire',
  'protection company holds: jobs, sites, customers, contacts, quotes, invoices, purchase orders,',
  'catalogue parts, leads and suppliers.',
  '',
  'Answer with one line of JSON and nothing else, in this exact shape:',
  '{"terms": "...", "kind": "..."}',
  '',
  'Rules, all absolute:',
  '1. "terms" must contain only words that appear in the phrase, spelled as they were typed.',
  '   Never add a name, a number, a place or a spelling that is not in the phrase. If the useful',
  '   words are already the whole phrase, repeat them.',
  '2. "kind" must be exactly one of: job, site, customer, contact, quote, invoice, order, catalog,',
  '   lead, vendor — or omit it if the phrase does not say which kind of record is wanted.',
  '3. Drop the words that are not part of a name or number: "show me", "for", "the", and words',
  '   describing state such as unpaid, open or overdue, which the box cannot filter on.',
  '4. Never explain, never apologise, never write anything outside the JSON.',
].join('\n');

/** The phrase, and the kinds it may choose from. Nothing else leaves the phone. */
export function buildFindPrompt(phrase: string): string {
  return [
    `Kinds: ${KIND_ORDER.join(', ')}.`,
    `Phrase: ${phrase.trim()}`,
  ].join('\n');
}

/** A word as both sides compare it: lower case, no punctuation around it. */
function wordKey(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

const wordsOf = (text: string): string[] => text.split(/\s+/).map(wordKey).filter(Boolean);

/**
 * Whether a phrase is worth asking about at all.
 *
 * Only a phrase whose kind the word lists could not name. Where they found
 * one — "invoices for the tower" — that reading is already what a round
 * trip would say, and better for being instant and offline. One word is an
 * identifier, and a paragraph is not a search.
 */
export function worthAsking(phrase: string, plain: PhraseReading = readPhrase(phrase)): { ok: boolean; reason?: string } {
  const trimmed = phrase.trim();
  if (trimmed.length > MAX_PHRASE_CHARS) return { ok: false, reason: 'That is too long to read as a search.' };
  if (wordsOf(trimmed).length < 2) return { ok: false, reason: 'One word is a search already.' };
  if (plain.kind) return { ok: false, reason: 'The phrase was already read without asking.' };
  return { ok: true };
}

/**
 * Checks an answer against the phrase it came from.
 *
 * Every word of the terms has to have been typed, and the kind has to be
 * one of the app's own. Anything else is dropped with a reason, because a
 * search for a word nobody typed is a wrong answer that looks like a right
 * one.
 */
export function checkSuggestion(raw: string, phrase: string): PhraseSuggestionResult {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { refusal: 'The answer was not a search.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { refusal: 'The answer was not a search.' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { refusal: 'The answer was not a search.' };

  const body = parsed as { terms?: unknown; kind?: unknown };
  const terms = typeof body.terms === 'string' ? body.terms.trim().replace(/\s+/g, ' ') : '';

  const typed = new Set(wordsOf(phrase));
  const invented = wordsOf(terms).filter((w) => !typed.has(w));
  if (invented.length) {
    return { refusal: `It came back with a word that was not typed: "${invented[0]}". Left as it was.` };
  }

  let kind: SearchKind | undefined;
  if (typeof body.kind === 'string' && body.kind.trim() && body.kind.trim().toLowerCase() !== 'any') {
    const named = body.kind.trim().toLowerCase() as SearchKind;
    if (!KIND_ORDER.includes(named)) return { refusal: `It asked for "${body.kind}", which is not a kind of record here.` };
    kind = named;
  }

  if (!terms && !kind) return { refusal: 'It made nothing of the phrase either.' };
  return { suggestion: { terms, kind } };
}

/**
 * Reads a phrase with the model, or says why it did not.
 *
 * Never throws. Every refusal is one a technician can read, and the plain
 * reading of the phrase stands behind every one of them.
 */
export async function readPhraseWithModel(phrase: string): Promise<PhraseSuggestionResult> {
  const worth = worthAsking(phrase);
  if (!worth.ok) return { refusal: worth.reason ?? 'Nothing to read.' };

  const result = await complete({
    system: FIND_SYSTEM_PROMPT,
    user: buildFindPrompt(phrase),
    maxTokens: 120,
  });

  if (result.text === undefined) {
    switch (result.failure) {
      case 'no-key':
        return { refusal: 'No API key is set. Add one in Settings to have a phrase read; the search itself works without it.' };
      case 'no-answer':
        return { refusal: 'No answer came back — most likely no signal. The search still ran on what you typed.' };
      default:
        return { refusal: `${result.refusal ?? 'No answer.'} The search still ran on what you typed.` };
    }
  }

  return checkSuggestion(result.text, phrase);
}
