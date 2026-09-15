import { expand, normalise } from '@/domain/tradeVocabulary';
import type { SwmsTemplate } from '@/domain/swms';

/**
 * Turning "what sort of works" into the right statements.
 *
 * A technician types a line about the day — "core drilling the slab to run
 * pipe in an old shopping centre" — and the builder has to put the right
 * safety statements in front of them. The one a crew forgets is the second
 * one, every time: the drilling statement is obvious and the asbestos one is
 * not, the hydrant flow test is obvious and the traffic one is not.
 *
 * What was here before was one line: is any of this template's words a
 * substring of what they typed. It failed in both directions at once.
 * "core" did not match "coring"; "ase" matched "basement"; "pit" matched
 * "pitot"; "gas" matched "gasket"; and "test", which is in the live-testing
 * list, matched almost anything anybody would ever type.
 *
 * Three ideas fix it, and all three are needed.
 *
 * **Rank, do not decide.** The screen needs two answers at once — which boxes
 * come up already ticked, and which come up visible but not ticked — and a
 * boolean cannot carry both. Being generous with a boolean is self-defeating:
 * a generous rule fires five to seven of the ten statements on an ordinary
 * phrasing, and a crew handed a hundred and thirty steps to read reads none of
 * them. So a strong match is ticked, a weaker one is offered, and the rest are
 * a search box away.
 *
 * **Some words decide and some only corroborate.** "asbestos" in a sentence
 * settles it. "panel" does not — every one of these statements mentions a
 * panel. Each statement's words are split accordingly, and a corroborating
 * word can put a statement on the list but never tick it on its own.
 *
 * **Match whole words, through the trade's own vocabulary.** The app already
 * knows that FIP means the fire indicator panel and that batteries means
 * battery; that expansion is reused here so "coring" and "core drill" reach
 * the same statement. Matching is on word boundaries, so "basement" is no
 * longer an ASE.
 *
 * Everything here is pure and every decision is a number somebody can check.
 * The screen is in app/swms/new.tsx and holds none of this.
 */

/**
 * A statement worth putting on the page unticked. Below this it is not offered.
 *
 * There is no upper score that ticks a box. Ticking turns on whether anything
 * DECISIVE matched — a word only this statement's work uses, a system on the
 * register, a routine due — because a pile of corroboration is not the same
 * as one fact. Four mentions of "panel" and "test" is how the detection
 * statement used to tick itself on an extinguisher job.
 */
export const OFFER_SCORE = 1;

/** What one decisive word is worth. */
const STRONG = 2;
/** What one corroborating word is worth — two of them reach the offer line, never the tick. */
const WEAK = 0.6;
/** A system on the register, or a routine due. Facts about the site, not guesses about the words. */
const SYSTEM = 2;
const ROUTINE = 2;

/**
 * What a rare word in a statement's own body is worth.
 *
 * Deliberately below the offer line on its own. A statement's steps run to
 * several hundred words and mention a great deal in passing; one of them
 * turning up in a sentence is a hint and not a finding. Two are worth
 * listening to.
 */
const BODY = 0.6;

/**
 * How common a word may be across the ten statements and still count.
 *
 * Two hundred words appear in every single statement — isolate, panel,
 * pressure, test, confined, permit — and matching on any of them would return
 * all ten every time. A word in more than this share of the statements decides
 * nothing and is ignored.
 */
const BODY_RARITY = 0.35;

/** Four letters, because "gas" and "pit" inside other words are what went wrong before. */
const MIN_BODY_WORD = 4;

export interface MatchContext {
  /** What the technician typed about the work. */
  text?: string;
  /** Asset systems on the site's register. */
  systems?: readonly string[];
  /** Service routines due or being done. */
  routineIds?: readonly string[];
}

export interface TemplateMatch {
  templateId: string;
  score: number;
  /** Ticked for the crew, or offered for them to tick. */
  verdict: 'preselect' | 'offer';
  /**
   * Why, in the words that caused it — shown under the checkbox so the crew can
   * see the app's reasoning rather than being handed a list from nowhere.
   */
  because: string[];
}

/**
 * The words in a piece of text, as words.
 *
 * `normalise` keeps dots and hyphens, because it exists to make "AS 1670.4"
 * survive a search. That is right there and wrong here: it leaves "shafts." and
 * "below-ground" in the index, and neither can ever match what somebody types.
 * Here a word is letters and digits and nothing else.
 */
function words(text: string): Set<string> {
  return new Set(
    normalise(text)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/**
 * Whether a term appears in the text as a whole word or whole phrase.
 *
 * A multi-word term ("core drill", "hot work") is matched as a phrase with
 * boundaries at each end; a single word is matched against the token set.
 */
function mentions(text: string, tokens: Set<string>, term: string): boolean {
  const t = normalise(term);
  if (!t) return false;
  if (!t.includes(' ')) return tokens.has(t);
  return ` ${text} `.includes(` ${t} `);
}

/**
 * The words in each statement's own body that are rare enough to mean
 * something.
 *
 * Built once from whatever templates are handed in, so a test can build it
 * from a fixture and the app builds it from the real ten.
 */
export function rareBodyWords(templates: readonly SwmsTemplate[]): Map<string, Set<string>> {
  const bodies = new Map<string, Set<string>>();
  for (const t of templates) {
    const text = [
      t.title, t.activity, t.whenRequired,
      ...t.steps.flatMap((s) => [s.step, ...s.hazards, ...s.controls.map((c) => c.control)]),
    ].join(' ');
    bodies.set(t.id, new Set([...words(text)].filter((w) => w.length >= MIN_BODY_WORD)));
  }

  const spread = new Map<string, number>();
  for (const set of bodies.values()) {
    for (const w of set) spread.set(w, (spread.get(w) ?? 0) + 1);
  }

  const ceiling = Math.max(1, Math.floor(templates.length * BODY_RARITY));
  const rare = new Map<string, Set<string>>();
  for (const [id, set] of bodies) {
    rare.set(id, new Set([...set].filter((w) => (spread.get(w) ?? 0) <= ceiling)));
  }
  return rare;
}

/**
 * Which statements the work needs, ranked.
 *
 * Returns everything at or above the offer line, best first. The caller ticks
 * the preselects and shows the rest; nothing here decides what a crew signs.
 */
export function matchTemplates(
  templates: readonly SwmsTemplate[],
  context: MatchContext,
  rare = rareBodyWords(templates),
): TemplateMatch[] {
  const typed = normalise(context.text ?? '');
  // The trade's own vocabulary, so "FIP" reaches the panel words and "coring"
  // reaches "core". Added terms are matched exactly as typed ones are.
  const widened = typed ? `${typed} ${expand(typed).added.join(' ')}`.trim() : '';
  const tokens = words(widened);

  const systems = new Set((context.systems ?? []).map((s) => normalise(s)));
  const routines = new Set(context.routineIds ?? []);

  const out: TemplateMatch[] = [];
  for (const t of templates) {
    const s = t.suggestFor;
    if (!s) continue;

    let score = 0;
    // Kept apart from the score: what ticks a box is whether anything decisive
    // matched, not how much corroboration piled up.
    let decisive = 0;
    const because: string[] = [];

    for (const system of s.systems ?? []) {
      if (systems.has(normalise(system))) {
        score += SYSTEM;
        decisive += 1;
        because.push(`${system} on the register`);
      }
    }
    for (const routine of s.routineIds ?? []) {
      if (routines.has(routine)) {
        score += ROUTINE;
        decisive += 1;
        because.push('a routine due here');
      }
    }

    if (widened) {
      for (const w of s.words ?? []) {
        if (mentions(widened, tokens, w)) {
          score += STRONG;
          decisive += 1;
          because.push(w);
        }
      }
      for (const w of s.weakWords ?? []) {
        if (mentions(widened, tokens, w)) {
          score += WEAK;
          because.push(w);
        }
      }

      // The statement's own steps and hazards, on rare words only. Never
      // enough on its own; enough alongside anything else.
      const body = rare.get(t.id);
      if (body) {
        let hits = 0;
        for (const w of tokens) if (body.has(w)) hits += 1;
        if (hits) score += Math.min(hits, 3) * BODY;
      }
    }

    if (score >= OFFER_SCORE) {
      out.push({
        templateId: t.id,
        score,
        verdict: decisive > 0 ? 'preselect' : 'offer',
        // Deduped and capped: this is a line under a checkbox, not a log.
        because: [...new Set(because)].slice(0, 4),
      });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.templateId.localeCompare(b.templateId));
}

/** The ones to tick for the crew. */
export function preselectedTemplates(matches: readonly TemplateMatch[]): string[] {
  return matches.filter((m) => m.verdict === 'preselect').map((m) => m.templateId);
}
