import { DEFECT_LIBRARY } from '@/seed/defectLibrary';
import { SERVICE_ROUTINES, SOURCE_LABEL } from '@/seed/serviceRoutines';
import { EOL_VALUES } from '@/calc/eol';
import { PROTOCOLS } from '@/calc/dipswitch';
import { ASSET_TYPES, SYSTEM_LABELS } from '@/seed/assetTypes';

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

export type AnswerKind = 'routine' | 'defect' | 'eol' | 'protocol' | 'asset-type' | 'calculator';

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
}

export const KIND_LABEL: Record<AnswerKind, string> = {
  routine: 'Service routine',
  defect: 'Defect code',
  eol: 'End of line',
  protocol: 'Addressing',
  'asset-type': 'Equipment',
  calculator: 'Calculator',
};

/** What the app can answer about, shown when it cannot answer. */
export const COVERAGE = [
  'Service routines and what each check covers',
  'Defect codes, their wording and rectification',
  'End-of-line values by panel and circuit',
  'Device addressing by protocol',
  'Equipment types and their attributes',
  'The calculators and what each one needs',
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
function score(query: string, identifier: string, haystack: string): number {
  const q = normalise(query);
  if (!q) return 0;

  const id = normalise(identifier);
  if (id && (id === q || id.replace(/ /g, '') === q.replace(/ /g, ''))) return 1000;

  const words = tokens(query);
  // Nothing but stop words is not a question this can answer.
  if (!words.length) return 0;

  const hay = normalise(haystack);
  let hits = 0;
  for (const w of words) {
    if (hay.includes(w)) hits += 1;
  }
  if (!hits) return 0;

  // Coverage of the question, plus a nudge for an identifier that contains it.
  const coverage = hits / words.length;
  const idBonus = id.includes(q) ? 0.5 : 0;
  return coverage + idBonus;
}

/** Anything below this is not an answer, it is the nearest thing lying around. */
export const ANSWER_THRESHOLD = 0.5;

export function ask(query: string, limit = 12): Answer[] {
  const q = query.trim();
  if (q.length < 2) return [];

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
    }, score(q, code.code, hay));
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
      }, score(q, test.label, hay));
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
    }, score(q, `${eol.brand} ${eol.panel}`, hay));
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
    }, score(q, p.label, hay));
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
    }, score(q, type.label, hay));
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
    }, score(q, calc.title, hay));
  }

  return out
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
