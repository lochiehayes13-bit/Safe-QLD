import { DEFECT_LIBRARY } from '@/seed/defectLibrary';
import { SERVICE_ROUTINES, SOURCE_LABEL } from '@/seed/serviceRoutines';
import { EOL_VALUES } from '@/calc/eol';
import { PROTOCOLS } from '@/calc/dipswitch';
import { ASSET_TYPES, SYSTEM_LABELS } from '@/seed/assetTypes';
import { LIBRARY } from '@/domain/standardsLibrary';
import { clauseQuery, expand, normalise as normaliseRef } from '@/domain/tradeVocabulary';

/**
 * Answering a technician's question from what the app already holds.
 *
 * This is a search, not a language model. It says so on the screen, because a
 * thing that answers in sentences and is wrong is far more dangerous on a
 * ladder than a thing that hands you the clause and lets you read it.
 *
 * Every answer carries where it came from and how much to trust it, and a
 * question nothing matches gets "I don't know" rather than the closest thing
 * lying around. That last part is the whole point: the failure mode worth
 * engineering against is a confident wrong answer about a fire system.
 */

export type AnswerKind =
  | 'routine' | 'defect' | 'eol' | 'protocol' | 'asset-type' | 'calculator' | 'clause';

export interface Answer {
  kind: AnswerKind;
  /** Short heading — a code, a part, a check. */
  title: string;
  /** The substance, in our own words. */
  body: string;
  /** Where it comes from, named so it can be checked. */
  source: string;
  confidence: 'high' | 'medium' | 'low';
  /** Screen that shows it in full. */
  route?: string;
  /** Internal, for ranking. */
  score: number;
  /**
   * Internal. How specific the entry is, for breaking a tie between two things
   * that scored the same — a clause reference's depth, so 5.1.4 counts as more
   * specific than 5.1.
   */
  specificity?: number;
}

export const KIND_LABEL: Record<AnswerKind, string> = {
  routine: 'Service routine',
  defect: 'Defect code',
  eol: 'End of line',
  protocol: 'Addressing',
  'asset-type': 'Equipment',
  calculator: 'Calculator',
  clause: 'Standard',
};

/** What the app can answer about, shown when it cannot answer. */
export const COVERAGE = [
  'Service routines and what each check covers',
  'Defect codes, their wording and rectification',
  'End-of-line values by panel and circuit',
  'Device addressing by protocol',
  'Equipment types and their attributes',
  'The calculators and what each one needs',
  'Which clause of which standard covers a subject, across the whole catalogue',
];

interface CalculatorDef {
  title: string;
  body: string;
  route: string;
  terms: string[];
}

/**
 * The calculators, described so a question about the thing finds the tool.
 *
 * A technician asks "how big a battery" rather than "battery calculator", so
 * the terms carry the question as well as the name.
 */
const CALCULATORS: CalculatorDef[] = [
  {
    title: 'Battery sizing',
    body: 'Sizes a standby battery from measured quiescent and alarm currents to the Australian formula, and shows its working. Standby defaults to 72 hours — the familiar 24 hours applies only where the power-supply-failure signal is continuously monitored.',
    route: '/tools/battery',
    terms: ['battery', 'standby', 'ah', 'amp hour', 'capacity', 'quiescent', 'alarm current', '72 hour', '24 hour', 'charger', 'sla', 'vrla'],
  },
  {
    title: 'VESDA and aspirating sizing',
    body: 'Derives aspirator current from published watts rather than storing pre-rounded milliamps, and refuses an unpublished setting instead of interpolating across a curve that is not linear.',
    route: '/tools/vesda',
    terms: ['vesda', 'aspirating', 'asd', 'aspirator', 'laserplus', 'vlf', 'vli', 'sampling'],
  },
  {
    title: 'Cable volt drop',
    body: 'Volt drop for a run, using copper at 75 °C rather than the 20 °C bench figure, and counting DC and single-phase runs twice for the return path.',
    route: '/tools/electrical',
    terms: ['volt drop', 'voltage drop', 'cable', 'csa', 'copper', 'resistance', 'run length'],
  },
  {
    title: 'Resistor decoder',
    body: 'Decodes 3 to 6 band resistors and finds the nearest preferred value in E6 through E192.',
    route: '/tools/resistor',
    terms: ['resistor', 'colour code', 'color code', 'band', 'ohm', 'e12', 'e24', 'e96', 'e192', 'tolerance'],
  },
  {
    title: 'Device addressing',
    body: 'DIP switches, Apollo XPERT cards and rotary dials across twelve protocols, with the trap each one carries.',
    route: '/tools/dipswitch',
    terms: ['address', 'dip', 'dipswitch', 'xpert', 'rotary', 'loop address', 'addressing'],
  },
  {
    title: 'End-of-line reference',
    body: 'End-of-line values by panel and circuit. There is deliberately no universal table: several Australian panels sense current or voltage bands rather than resistance.',
    route: '/tools/eol',
    terms: ['eol', 'end of line', 'end-of-line', 'terminating', 'resistor value', 'line monitoring'],
  },
  {
    title: 'Units and conversions',
    body: 'Conversions a fire technician actually reaches for, each showing the factor used.',
    route: '/tools/units',
    terms: ['convert', 'conversion', 'unit', 'kpa', 'psi', 'metre', 'feet', 'litre'],
  },
];

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Words that appear in nearly every entry and so carry no signal.
 *
 * Without this, "what is the capital of France" scores half marks against a
 * routine check, because "is", "the" and "of" are in most of them. Coverage has
 * to be measured on the words that mean something.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'has', 'have', 'had', 'with', 'that',
  'this', 'from', 'not', 'but', 'its', 'it', 'is', 'of', 'to', 'in', 'on', 'at',
  'by', 'or', 'be', 'an', 'as', 'a', 'i', 'my', 'me', 'we', 'you', 'do', 'does',
  'what', 'when', 'where', 'which', 'who', 'how', 'why', 'can', 'should', 'would',
  'need', 'want', 'get', 'any', 'all', 'some', 'there', 'here', 'about',
]);

function tokens(s: string): string[] {
  // Two characters is the floor for a term to be worth matching, and a stop
  // word never is.
  return normalise(s)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * How well a haystack answers a query.
 *
 * An exact match on an identifier outranks everything, because someone typing
 * "DET-DET-001" or "FSP-951AUS" knows exactly what they want and any softer
 * match is noise. Below that it is term coverage: an answer matching four of
 * the five words asked beats one matching one.
 */
function score(
  query: string,
  identifier: string,
  haystack: string,
  implied: string[] = [],
  consumed: ReadonlySet<string> = new Set(),
): number {
  const q = normalise(query);
  if (!q) return 0;

  const id = normalise(identifier);
  if (id && (id === q || id.replace(/ /g, '') === q.replace(/ /g, ''))) return 1000;

  /*
   * Words the trade vocabulary already turned into better terms are left out.
   * "how far off the wall can a detector go" is five content words, three of
   * which appear in no document ever written; counting them drags a perfect hit
   * on the spacing clause below the threshold and the search returns nothing.
   */
  const typed = tokens(query);
  const words = typed.filter((w) => !consumed.has(w));
  // Nothing but stop words is not a question this can answer.
  if (!words.length) return 0;

  const hay = normalise(haystack);
  let hits = 0;
  for (const w of words) {
    if (hay.includes(w)) hits += 1;
  }

  /*
   * Terms the trade vocabulary supplied count too, but never as much as the
   * ones actually typed, and never enough on their own to clear the threshold.
   * A question expanded into thirty terms would otherwise let a loosely related
   * entry outrank a direct hit purely by surface area — which is exactly the
   * "nearest thing lying around" this module exists to refuse.
   */
  let impliedHits = 0;
  for (const w of implied) {
    if (w.length >= 3 && !STOP_WORDS.has(w) && hay.includes(w)) impliedHits += 1;
  }
  const impliedBonus = implied.length
    ? Math.min(IMPLIED_CAP, (impliedHits / implied.length) * IMPLIED_WEIGHT)
    : 0;

  if (!hits && !impliedHits) return 0;

  // Coverage of the question, plus a nudge for an identifier that contains it.
  const coverage = hits / words.length;
  const idBonus = id.includes(q) ? 0.5 : 0;
  return coverage + idBonus + impliedBonus;
}

/** How much a vocabulary-supplied term is worth against one the technician typed. */
const IMPLIED_WEIGHT = 0.9;
/** And the ceiling, so implied terms alone can never clear ANSWER_THRESHOLD. */
const IMPLIED_CAP = 0.45;

/** Anything below this is not an answer, it is the nearest thing lying around. */
export const ANSWER_THRESHOLD = 0.5;

/**
 * What the search understood, so it is never a black box.
 *
 * Shown above the results. A technician who can see that "how far off the wall"
 * was read as a spacing question can tell instantly whether the search is
 * answering them or something else — which is the difference between trusting a
 * result and checking it twice.
 */
export interface QueryReading {
  /** Question shapes recognised, in plain words. */
  readings: string[];
  /** Terms the trade vocabulary added to the search. */
  alsoSearched: string[];
  /** A standard or clause the technician named outright. */
  jumpTo?: { standard?: string; clause?: string };
}

export function explainQuery(query: string): QueryReading {
  const e = expand(query);
  return {
    readings: e.readings,
    alsoSearched: e.added.filter((t) => !t.includes(' ')).slice(0, 12),
    jumpTo: clauseQuery(query),
  };
}

export function ask(query: string, limit = 12): Answer[] {
  const q = query.trim();
  if (q.length < 2) return [];

  const expansion = expand(q);
  const implied = expansion.added;
  const consumed = new Set(expansion.consumed);
  const direct = clauseQuery(q);

  const out: Answer[] = [];
  const add = (a: Omit<Answer, 'score'>, s: number) => {
    if (s >= ANSWER_THRESHOLD) out.push({ ...a, score: s });
  };

  for (const code of DEFECT_LIBRARY) {
    const hay = [code.code, code.component, code.defect, code.reportWording, code.clientWording, code.rectification]
      .filter(Boolean).join(' ');
    add({
      kind: 'defect',
      title: `${code.code} — ${code.component}: ${code.defect}`,
      body: code.rectification || code.reportWording,
      source: `Safe QLD defect library · ${SYSTEM_LABELS[code.system]}`,
      confidence: 'high',
      route: '/tools/defects',
    }, score(q, code.code, hay, implied, consumed));
  }

  for (const routine of SERVICE_ROUTINES) {
    for (const test of routine.tests) {
      const hay = [test.label, test.section, test.whatToDo, test.whatToLookFor, test.passCriteria, test.failCriteria, routine.label]
        .filter(Boolean).join(' ');
      add({
        kind: 'routine',
        title: `${routine.label} — ${test.label}`,
        body: [test.whatToDo, test.passCriteria && `Pass: ${test.passCriteria}`].filter(Boolean).join(' '),
        // The source kind is the honest part: a check that exists because a
        // manufacturer says so is not the same as one a standard requires.
        source: `${SOURCE_LABEL[test.sourceKind]}${routine.sourceRef ? ` · ${routine.sourceRef}` : ''}`,
        // A check flagged for verification is one where the actual figure has
        // to come from the standard or the manual, so it is not a high-
        // confidence answer on its own.
        confidence: test.verify ? 'low' : 'high',
        route: '/tools/routines',
      }, score(q, test.label, hay, implied, consumed));
    }
  }

  for (const eol of EOL_VALUES) {
    const hay = [eol.brand, eol.panel, eol.circuit, eol.value, eol.notes].filter(Boolean).join(' ');
    add({
      kind: 'eol',
      title: `${eol.brand} ${eol.panel} — ${eol.circuit}`,
      body: `${eol.value}${eol.notes ? `. ${eol.notes}` : ''}`,
      source: eol.source ?? 'Manufacturer documentation',
      confidence: eol.confidence,
      route: '/tools/eol',
    }, score(q, `${eol.brand} ${eol.panel}`, hay, implied, consumed));
  }

  for (const p of PROTOCOLS) {
    const hay = [p.label, p.id, p.notes, p.methods.join(' ')].filter(Boolean).join(' ');
    add({
      kind: 'protocol',
      title: p.label,
      body: `Addresses ${p.minAddress}–${p.maxAddress}, ${p.maxDevicesPerLoop} per loop. ${p.notes ?? ''}`.trim(),
      source: 'Manufacturer addressing documentation',
      confidence: 'high',
      route: '/tools/dipswitch',
    }, score(q, p.label, hay, implied, consumed));
  }

  for (const type of ASSET_TYPES) {
    const hay = [type.label, type.id, SYSTEM_LABELS[type.system], ...(type.attributes ?? []).map((a) => a.label)]
      .filter(Boolean).join(' ');
    add({
      kind: 'asset-type',
      title: type.label,
      body: `${SYSTEM_LABELS[type.system]}. Records ${(type.attributes ?? []).length} attribute${(type.attributes ?? []).length === 1 ? '' : 's'}.`,
      source: 'Safe QLD asset register',
      confidence: 'high',
    }, score(q, type.label, hay, implied, consumed));
  }

  for (const calc of CALCULATORS) {
    const hay = [calc.title, calc.body, ...calc.terms].join(' ');
    add({
      kind: 'calculator',
      title: calc.title,
      body: calc.body,
      source: 'Safe QLD calculator',
      confidence: 'high',
      route: calc.route,
    }, score(q, calc.title, hay, implied, consumed));
  }

  /*
   * The merged library rather than the register alone. The register carries
   * fifty-odd descriptions read out of the documents; the curated notes carry
   * another two hundred, and searching only the register meant a question whose
   * answer had been written up returned nothing but a clause number.
   */
  for (const doc of LIBRARY) {
    /*
     * Normalised with the reference-aware form, which keeps the dots. This
     * module's own normalise strips them, so "AS 2419.1:2005" would become
     * "as 2419 1 2005" and never match the "as 2419.1" a technician typed —
     * the jump silently degraded into an ordinary ranked search.
     */
    const designation = normaliseRef(doc.designation);

    /*
     * Scored first, added second, because a clause cannot be judged on its own.
     * A section heading and the clause beneath it both match "how far off the
     * wall", and the heading has the longer description — so it covers more of
     * the question by surface area and outranks the clause that actually
     * answers it. The pass below fixes that, and it needs to see the siblings.
     */
    const scored: { clause: typeof doc.clauses[number]; s: number; named: boolean }[] = [];
    const bodies = new Map<string, string>();

    for (const clause of doc.clauses) {
      /*
       * A clause named outright is navigation, not search. "AS 2419.1 clause
       * 10.4" wins over everything so the technician who already knows the
       * reference is not made to fight the ranking for it.
       */
      const named = direct
        && (!direct.standard || designation.startsWith(direct.standard))
        && (!direct.clause || clause.ref.toLowerCase() === direct.clause);

      const hay = [
        doc.designation, doc.title, clause.ref, clause.title, clause.covers,
      ].filter(Boolean).join(' ');

      const body = clause.covers
        ?? `${doc.designation} clause ${clause.ref}. Nobody has written up what this clause covers, `
          + 'so the app is not going to guess — open your own copy of the standard.';

      scored.push({
        clause,
        named: !!named,
        s: named ? 900 : score(q, `${doc.designation} ${clause.ref}`, hay, implied, consumed),
      });
      // Keep the composed body with the clause so the second pass need not
      // rebuild it.
      bodies.set(clause.ref, body);
    }

    /*
     * A section that contains the answer is a worse answer than the answer.
     *
     * "5.1 Spacing and Location of Point-type Detectors" and "5.1.4 Spacing
     * from walls, partitions or air supply openings" both match "how far off
     * the wall". Both are true. Only the second one answers it — and left
     * alone the first wins, because its description is longer and therefore
     * contains more of the question.
     *
     * So a clause whose own sub-clause also cleared the threshold is demoted
     * below it. Only ever below its own children, never below an unrelated
     * clause, and never at all where the technician named it outright.
     */
    for (const entry of scored) {
      const child = scored.find((o) =>
        o !== entry
        && o.clause.ref.startsWith(`${entry.clause.ref}.`)
        && o.s >= ANSWER_THRESHOLD);
      const demoted = !entry.named && child ? Math.min(entry.s, child.s - 0.001) : entry.s;
      const { clause } = entry;

      add({
        kind: 'clause',
        title: `${doc.designation} ${clause.ref} — ${clause.title}`,
        body: bodies.get(clause.ref)!,
        // Superseded editions still get answered, because they are what is
        // installed on most sites — but the answer says so rather than letting
        // a technician quote a withdrawn edition at a client.
        source: doc.status === 'superseded' && doc.supersededBy
          ? `${doc.designation} · superseded by ${doc.supersededBy}`
          : doc.designation,
        // The app holds the clause reference, not the clause. Where nobody has
        // described it, that is a pointer and nothing more.
        confidence: clause.covers ? 'high' : 'low',
        route: `/library/${doc.id}`,
        // A clause reference's depth. See the tie-break in the sort below.
        specificity: clause.ref.split('.').length,
      }, demoted);
    }
  }

  /*
   * Score first, then specificity, then the title.
   *
   * The middle one is not cosmetic. A section heading and the clause under it
   * both match "how far off the wall", and once both carry a written
   * description they score the same — at which point an alphabetical tie-break
   * hands the technician "5.1 Spacing and Location of Point-type Detectors"
   * instead of "5.1.4 Spacing from walls, partitions or air supply openings".
   * Both are true; only one answers the question. The deeper reference wins.
   */
  return out
    .sort((a, b) =>
      b.score - a.score
      || (b.specificity ?? 0) - (a.specificity ?? 0)
      || a.title.localeCompare(b.title))
    .slice(0, limit);
}
