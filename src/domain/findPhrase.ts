import { KIND_LABEL, type SearchKind } from './search';

/**
 * Reading a sentence typed into the search box.
 *
 * The box takes an identifier — a job number, a part number, a phone
 * number — and that is what it is for. But people type sentences at boxes.
 * "unpaid invoices for harbourline", "purchase orders for job 44501",
 * "who do I ring at the tower". Handed to the plain search those are five
 * words that appear in no record together, and the answer is "nothing
 * matched", which is wrong: the records are right there.
 *
 * So a phrase is read before it is searched. Two things come out of it:
 * the kind of record the words named, and the words that are actually a
 * name or a number. Everything else — the sentence around them — is put
 * aside, and the screen says what it put aside, because a search that
 * quietly ignores half of what you typed is worse than one that says it
 * did.
 *
 * This is deliberately not a language model. It runs on a phone with no
 * signal in a plant room, it is the same answer every time, and it can be
 * read in a test. The model layer in `src/ai/findPhrase.ts` sits behind it
 * for the phrasings these lists do not have, and cannot be reached at all
 * without a key.
 *
 * Nothing here invents a word. The terms are always a subset of what was
 * typed, so the search can only ever look for something the person said.
 */

/** The words that name a kind of record, in every form they get typed in. */
const KIND_WORDS: Record<string, SearchKind> = {
  job: 'job', jobs: 'job', works: 'job', workorder: 'job', 'work order': 'job', 'work orders': 'job',
  site: 'site', sites: 'site', building: 'site', buildings: 'site', property: 'site', properties: 'site',
  customer: 'customer', customers: 'customer', client: 'customer', clients: 'customer', account: 'customer',
  contact: 'contact', contacts: 'contact', person: 'contact', people: 'contact', 'site contact': 'contact',
  quote: 'quote', quotes: 'quote', quotation: 'quote', quotations: 'quote',
  invoice: 'invoice', invoices: 'invoice', inv: 'invoice', bill: 'invoice', bills: 'invoice',
  po: 'order', pos: 'order', order: 'order', orders: 'order', 'purchase order': 'order', 'purchase orders': 'order',
  purchases: 'order',
  part: 'catalog', parts: 'catalog', catalogue: 'catalog', catalog: 'catalog', material: 'catalog', materials: 'catalog',
  lead: 'lead', leads: 'lead', prospect: 'lead', prospects: 'lead',
  supplier: 'vendor', suppliers: 'vendor', vendor: 'vendor', vendors: 'vendor', wholesaler: 'vendor',
};

/**
 * Words that carry no record in them.
 *
 * Three sorts: the scaffolding of a request ("show me the"), the joins
 * ("for", "at", "on"), and the state words the search cannot act on yet
 * ("unpaid", "open", "overdue"). The last are the ones worth telling
 * somebody about — the phone has no unpaid filter in this box, and a person
 * who asked for unpaid invoices should be told they got all of them rather
 * than left to assume.
 */
const FILLER = new Set([
  'show', 'me', 'the', 'a', 'an', 'my', 'our', 'their', 'his', 'her', 'its',
  'find', 'search', 'look', 'lookup', 'get', 'give', 'list', 'pull', 'bring', 'up', 'please',
  'for', 'of', 'at', 'on', 'in', 'to', 'from', 'with', 'by', 'about', 'against', 'any', 'all',
  'what', 'whats', "what's", 'which', 'who', 'whos', "who's", 'where', 'is', 'are', 'was', 'were',
  'do', 'does', 'did', 'i', 'we', 'you', 'ring', 'call', 'phone', 'number', 'numbers',
  'and', 'or', 'that', 'this', 'these', 'those', 'there', 'here', 'have', 'has', 'had',
]);

/** State words the plain search has no filter for. Removed, and named in `ignored`. */
const STATE_WORDS = new Set([
  'unpaid', 'paid', 'open', 'closed', 'outstanding', 'overdue', 'due', 'owing', 'received', 'outstanding',
  'today', 'tomorrow', 'yesterday', 'week', 'month', 'recent', 'latest', 'last', 'new', 'archived', 'cancelled',
]);

export interface PhraseReading {
  /** The words worth searching for: what was typed, minus the sentence around it. */
  terms: string;
  /** The kind the words named, where they named one. */
  kind?: SearchKind;
  /** The state words that were dropped, in the order they were typed, for the screen to own up to. */
  ignored: string[];
  /** True where reading the phrase actually changed it. */
  changed: boolean;
}

/** A number as typed, with any hash and separators taken off. */
const NUMBERISH = /^#?\d[\d-]*$/;

const normalise = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * Whether what was typed reads as a sentence rather than an identifier.
 *
 * A number, a part code, an email and a phone number are never phrases,
 * whatever else is in them. Two words are a name — "Fictional Tower" — and
 * are left alone unless one of them names a kind. Three or more words, or a
 * kind word beside anything, is a phrase.
 */
export function isPhrase(text: string): boolean {
  const trimmed = normalise(text).toLowerCase();
  if (!trimmed || trimmed.includes('@')) return false;
  const words = trimmed.split(' ');
  if (words.length < 2) return false;
  // A phone number is digits with spaces in it, however many groups.
  if (words.every((w) => NUMBERISH.test(w) || w === '+')) return false;
  // "PO 80375" and "inv 62339" are the search's own prefixes, and it reads
  // them better than this does.
  if (words.length === 2 && NUMBERISH.test(words[1]!)) return false;
  if (words.length >= 3) return true;
  return words.some((w) => KIND_WORDS[w] !== undefined || FILLER.has(w) || STATE_WORDS.has(w));
}

/**
 * What a phrase is actually asking for.
 *
 * Kind words are matched two at a time first, so "purchase orders" is one
 * word and not "purchase" plus "orders". The first kind word wins: in
 * "invoices for the job at the tower" the person asked for invoices, and
 * "job" is how they described which ones.
 *
 * Where every word was scaffolding, the terms come back empty and the
 * caller shows the kind's own list rather than searching for nothing.
 */
export function readPhrase(text: string): PhraseReading {
  const original = normalise(text);
  const words = original.split(' ').filter(Boolean);
  if (!words.length) return { terms: '', ignored: [], changed: false };

  const lower = words.map((w) => w.toLowerCase().replace(/[.,;:!?]+$/, ''));
  const kept: string[] = [];
  const ignored: string[] = [];
  let kind: SearchKind | undefined;

  for (let i = 0; i < words.length; i += 1) {
    const pair = i + 1 < words.length ? `${lower[i]} ${lower[i + 1]}` : undefined;
    if (pair && KIND_WORDS[pair]) {
      if (!kind) kind = KIND_WORDS[pair];
      i += 1;
      continue;
    }
    const word = lower[i]!;
    if (KIND_WORDS[word]) {
      if (!kind) kind = KIND_WORDS[word];
      continue;
    }
    if (STATE_WORDS.has(word)) { ignored.push(word); continue; }
    if (FILLER.has(word)) continue;
    kept.push(words[i]!);
  }

  const terms = kept.join(' ');
  return { terms, kind, ignored, changed: terms !== original || kind !== undefined };
}

/**
 * The line the screen shows when a phrase was read as something narrower
 * than what was typed. Undefined where nothing was taken away.
 */
export function phraseWords(reading: PhraseReading): string | undefined {
  if (!reading.changed) return undefined;
  const parts: string[] = [];
  if (reading.kind) parts.push(`${KIND_LABEL[reading.kind].many.toLowerCase()} only`);
  if (reading.terms) parts.push(`matching "${reading.terms}"`);
  else parts.push('the most recent');
  if (reading.ignored.length) {
    const list = reading.ignored.join(' and ');
    parts.push(`"${list}" is not something this box can filter on, so it was left out`);
  }
  return `Read as: ${parts.join(', ')}.`;
}
