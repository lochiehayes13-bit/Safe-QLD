import { expand, normalise, words } from './tradeVocabulary';

/**
 * Searching documents a technician imported themselves.
 *
 * The clause index that ships with the app says which clause covers a subject.
 * This is the other half: the actual words, out of the technician's own copy of
 * a document, found and shown in context. It runs over the QDC parts, the
 * legislation, manufacturer manuals, site documentation and Safe QLD's own
 * reports — everything the publisher has not locked.
 *
 * Ranking is deliberately simple and inspectable. A phrase match beats scattered
 * words, an early match beats a late one, and a page that uses a term repeatedly
 * beats one that mentions it once. There is no learned model here and no hidden
 * weighting: a technician who cannot tell why a result came up will not trust
 * the one that matters.
 *
 * The snippet is the point. A hit with no context is a page number, and nobody
 * walks back to the ute to check a page number.
 */

export interface SearchablePage {
  docId: string;
  docTitle: string;
  page: number;
  text: string;
}

export interface PageHit {
  docId: string;
  docTitle: string;
  page: number;
  /** The matched text with enough either side to read it. */
  snippet: string;
  /** Character offsets within the snippet, so the screen can mark them. */
  marks: { from: number; to: number }[];
  score: number;
  /** Which of the searched terms this page actually contained. */
  matched: string[];
}

/** Below this a page is a coincidence rather than an answer. */
export const PAGE_THRESHOLD = 1;

const SNIPPET_BEFORE = 90;
const SNIPPET_AFTER = 170;

/**
 * Where a term appears in a page, as offsets into the original text.
 *
 * Matched on word boundaries so "test" does not light up inside "latest" —
 * which sounds pedantic until a search for "test" returns every page of a
 * document that says "the latest edition" in its footer.
 */
function occurrences(hay: string, term: string): number[] {
  if (!term) return [];
  const out: number[] = [];
  const isWord = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
  let from = 0;
  for (;;) {
    const at = hay.indexOf(term, from);
    if (at === -1) break;
    const before = hay[at - 1];
    const after = hay[at + term.length];
    if (!isWord(before) && !isWord(after)) out.push(at);
    from = at + term.length;
  }
  return out;
}

function snippetAround(text: string, at: number, length: number): { snippet: string; offset: number } {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  // Trim to a word boundary so a snippet does not open mid-word.
  const lead = start > 0 ? text.indexOf(' ', start) + 1 : 0;
  const from = lead > 0 && lead < at ? lead : start;
  let snippet = text.slice(from, end);
  if (from > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return { snippet, offset: from - (from > 0 ? -1 : 0) };
}

export interface SearchOptions {
  limit?: number;
  /** Restrict to one imported document. */
  docId?: string;
}

/**
 * Ranks pages against a question.
 *
 * The trade vocabulary widens the query the same way it does for the clause
 * index, so "how far off the wall" reaches a page that says "spacing". Typed
 * terms are worth more than implied ones, for the same reason as everywhere
 * else: a question widened into thirty terms must not let an unrelated page win
 * on surface area.
 */
export function searchPages(
  pages: readonly SearchablePage[],
  query: string,
  options: SearchOptions = {},
): PageHit[] {
  const q = normalise(query);
  if (q.length < 2) return [];

  const e = expand(query);
  const consumed = new Set(e.consumed);
  const typed = words(query).filter((w) => w.length >= 2 && !consumed.has(w));
  const implied = e.added.filter((w) => w.length >= 3 && !w.includes(' '));

  // The whole phrase, when there is one worth matching as a unit.
  const phrase = typed.length > 1 ? typed.join(' ') : '';

  const hits: PageHit[] = [];

  for (const page of pages) {
    if (options.docId && page.docId !== options.docId) continue;
    const hay = normalise(page.text);
    if (!hay) continue;

    let score = 0;
    const matched: string[] = [];
    let firstAt = -1;

    const record = (term: string, weight: number) => {
      const at = occurrences(hay, term);
      if (!at.length) return;
      matched.push(term);
      // Repeats count, with diminishing returns — a page that uses a term four
      // times is about it, not twice as about it as one that uses it twice.
      score += weight * (1 + Math.log10(at.length));
      if (firstAt === -1 || at[0]! < firstAt) firstAt = at[0]!;
    };

    for (const t of typed) record(t, 1);
    for (const t of implied) record(t, 0.35);

    if (phrase && hay.includes(phrase)) {
      score += 3;
      const at = hay.indexOf(phrase);
      if (firstAt === -1 || at < firstAt) firstAt = at;
    }

    if (score < PAGE_THRESHOLD || firstAt === -1) continue;

    // Earlier on the page is usually the heading that governs the rest of it.
    score += Math.max(0, 0.5 - (firstAt / Math.max(hay.length, 1)) * 0.5);

    const term = matched[0] ?? typed[0] ?? '';
    const { snippet } = snippetAround(page.text, firstAt, term.length);

    hits.push({
      docId: page.docId,
      docTitle: page.docTitle,
      page: page.page,
      snippet,
      marks: markUp(snippet, [...typed, ...implied]),
      score: Math.round(score * 100) / 100,
      matched,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, options.limit ?? 30);
}

/** Where each searched term falls inside a snippet, for highlighting. */
export function markUp(snippet: string, terms: readonly string[]): { from: number; to: number }[] {
  const hay = snippet.toLowerCase();
  const marks: { from: number; to: number }[] = [];
  for (const t of terms) {
    if (t.length < 3) continue;
    for (const at of occurrences(hay, t)) marks.push({ from: at, to: at + t.length });
  }
  // Overlapping marks would render as nested highlights.
  marks.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m.from <= last.to) last.to = Math.max(last.to, m.to);
    else merged.push({ ...m });
  }
  return merged;
}
