/**
 * How a fire technician actually asks a question.
 *
 * Search fails on site for a boring reason: nobody types the words the document
 * uses. A technician standing under a detector asks "how far off the wall can
 * this go"; the standard's heading says "Spacing from walls, partitions or air
 * supply openings". No amount of ranking fixes that, because the two share one
 * word and it is "from".
 *
 * So this is the bridge — the trade's vocabulary mapped onto the documents'. It
 * is what makes an offline search feel like it understood the question, without
 * a language model, a network, or an API key. That matters: the answer has to
 * arrive in a plant room with no signal, and a thing that answers in confident
 * sentences and is wrong is far more dangerous on a ladder than a thing that
 * hands you the clause.
 *
 * Two deliberate limits:
 *
 * Expansion only ever ADDS terms. It never replaces what was typed and never
 * drops it, so a query cannot be quietly turned into a different question. If a
 * technician types a word this file has never heard of, that word still gets
 * searched.
 *
 * Nothing here asserts a fact. The vocabulary decides what to look for, never
 * what is true — every figure still comes from the module that owns it, with
 * its own source and confidence.
 */

/** A group of words that mean the same thing on site. Matching any one pulls in the rest. */
interface Synonyms {
  terms: string[];
  /** Why this grouping exists, where it is not obvious. */
  note?: string;
}

const SYNONYMS: Synonyms[] = [
  // --- Detection -----------------------------------------------------------
  { terms: ['detector', 'head', 'point', 'sensor', 'smoke detector', 'smokie'] },
  { terms: ['mcp', 'call point', 'break glass', 'manual call point', 'breakglass'] },
  { terms: ['fip', 'panel', 'fire panel', 'fire indicator panel', 'cie', 'control and indicating equipment'] },
  { terms: ['asd', 'aspirating', 'vesda', 'sampling', 'air sampling'],
    note: 'VESDA is a brand that became the trade word for aspirating detection.' },
  { terms: ['spacing', 'clearance', 'distance', 'how far', 'proximity', 'setback', 'offset'],
    note: 'The single most common shape of question on site, and the one the documents word most differently.' },
  { terms: ['isolate', 'isolation', 'disable', 'inhibit', 'bypass'] },
  { terms: ['zone', 'zone chart', 'block plan', 'zone block plan', 'zone location diagram'] },
  { terms: ['loop', 'circuit', 'slc', 'signalling line circuit'] },
  { terms: ['brigade', 'ase', 'alarm signalling equipment', 'monitoring', 'fire brigade', 'qfes', 'qfd'] },

  // --- Occupant warning ----------------------------------------------------
  { terms: ['ews', 'ewis', 'occupant warning', 'evacuation', 'eviction', 'warning system'] },
  { terms: ['spl', 'sound pressure', 'sound level', 'db', 'decibel', 'loudness', 'audibility', 'audible'] },
  { terms: ['intelligibility', 'clarity', 'understandable', 'speech', 'stipa'] },
  { terms: ['speaker', 'loudspeaker', 'sounder', 'horn'] },
  { terms: ['wip', 'warden intercom', 'warden phone', 'intercom point'] },
  { terms: ['strobe', 'beacon', 'visual alarm', 'vad', 'flasher'] },

  // --- Water --------------------------------------------------------------
  { terms: ['hydrant', 'fire hydrant', 'landing valve'] },
  { terms: ['booster', 'booster assembly', 'fire brigade booster', 'boost'] },
  { terms: ['flow', 'flow rate', 'l/s', 'lps', 'l/min', 'lpm', 'litres per second', 'litres per minute'] },
  { terms: ['pressure', 'kpa', 'bar', 'psi', 'head'] },
  { terms: ['static', 'residual', 'running pressure', 'flowing pressure'] },
  { terms: ['pitot', 'pitot gauge', 'pitot tube'] },
  { terms: ['hydrostatic', 'pressure test', 'hydro', 'hydro test', 'pressure testing'] },
  { terms: ['pump', 'pumpset', 'fire pump', 'jockey', 'diesel pump', 'electric pump'] },
  { terms: ['hose reel', 'reel', 'fhr', 'fire hose reel'] },
  { terms: ['sprinkler', 'head', 'sprinkler head', 'wet pipe', 'deluge'] },
  { terms: ['most disadvantaged', 'hydraulically most disadvantaged', 'worst case hydrant', 'furthest hydrant'] },

  // --- Extinguishers and blankets -----------------------------------------
  { terms: ['extinguisher', 'exting', 'bottle', 'portable extinguisher'] },
  { terms: ['abe', 'dry chemical', 'dcp', 'powder', 'dry powder'] },
  { terms: ['co2', 'carbon dioxide'] },
  { terms: ['wet chemical', 'class f', 'kitchen extinguisher'] },
  { terms: ['blanket', 'fire blanket'] },
  { terms: ['discharge test', 'discharge', 'refill', 'recharge'] },
  { terms: ['condemn', 'condemned', 'scrap', 'out of service', 'withdraw'] },
  { terms: ['travel distance', 'how far to walk', 'reach', 'coverage distance'] },

  // --- Emergency lighting -------------------------------------------------
  { terms: ['emergency light', 'emergency lighting', 'e-light', 'eel', 'emergency luminaire', 'fitting'] },
  { terms: ['exit sign', 'exit', 'running man', 'pictogram'] },
  { terms: ['viewing distance', 'how far can you see it', 'sign size', 'legibility'] },
  { terms: ['single point', 'self contained', 'self-contained', 'standalone fitting'] },
  { terms: ['central', 'centrally supplied', 'central battery', 'slave fitting'] },
  { terms: ['sustained', 'maintained', 'non-sustained', 'non-maintained'] },
  { terms: ['90 minute', 'ninety minute', 'duration', 'discharge duration', 'run time'] },

  // --- Passive ------------------------------------------------------------
  { terms: ['fire door', 'doorset', 'fire rated door', 'fd'] },
  { terms: ['smoke door', 'smoke seal', 'smoke doorset'] },
  { terms: ['penetration', 'fire stopping', 'firestop', 'collar', 'sealed penetration'] },
  { terms: ['tag', 'door tag', 'fire door tag', 'identification tag'] },
  { terms: ['gap', 'clearance gap', 'door gap', 'leaf gap'] },

  // --- Power and electrical ------------------------------------------------
  { terms: ['battery', 'batteries', 'standby battery', 'sla', 'vrla'] },
  { terms: ['standby', 'standby time', 'standby capacity', 'quiescent'] },
  { terms: ['alarm load', 'alarm current', 'alarm draw'] },
  { terms: ['volt drop', 'voltage drop', 'vd', 'cable drop'] },
  { terms: ['eol', 'end of line', 'end-of-line', 'terminating resistor'] },
  { terms: ['charger', 'psu', 'power supply', 'pse', 'power supply equipment'] },

  // --- Compliance and paperwork -------------------------------------------
  { terms: ['critical defect', 'critical', 'cdn', 'critical defect notice'] },
  { terms: ['occupier statement', 'occupiers statement', 'annual statement', 'form 4'] },
  { terms: ['form 72', 'hydrant certificate', 'periodic testing form'] },
  { terms: ['baseline', 'baseline data', 'baseline record'] },
  { terms: ['routine', 'service', 'maintenance', 'inspection', 'test'] },
  { terms: ['annual', 'yearly', '12 monthly', 'twelve monthly'] },
  { terms: ['six monthly', '6 monthly', 'half yearly', 'biannual'] },
  { terms: ['five yearly', '5 yearly', 'quinquennial'] },
  { terms: ['logbook', 'log book', 'record of maintenance', 'maintenance record'] },
  { terms: ['qdc', 'queensland development code', 'mp 6.1', 'mp6.1'] },
  { terms: ['bfsr', 'building fire safety regulation', 'regulation 2008'] },
  { terms: ['not tested', 'no access', 'inaccessible', 'could not test', 'unable to test'] },
];

/**
 * Intent phrases — a whole question shape mapped onto the terms that answer it.
 *
 * Distinct from synonyms because the trigger is a phrase rather than a word, and
 * because the useful expansion is often into vocabulary the technician did not
 * use at all. "Can I still use this" is a condemnation question, and nothing in
 * those four words says so.
 */
interface Intent {
  /** Any of these appearing in the query fires the intent. */
  triggers: string[];
  expand: string[];
  /** Shown to the technician so the search is never a black box. */
  reading: string;
}

const INTENTS: Intent[] = [
  { triggers: ['how far', 'how close', 'minimum distance', 'maximum distance', 'distance from'],
    expand: ['spacing', 'clearance', 'location', 'proximity'],
    reading: 'a spacing or clearance question' },
  { triggers: ['can i still use', 'is it still ok', 'do i condemn', 'is this scrap', 'still serviceable'],
    expand: ['condemn', 'out of service', 'condition', 'defect'],
    reading: 'whether equipment can stay in service' },
  { triggers: ['how often', 'how frequently', 'when is it due', 'what frequency', 'due again'],
    expand: ['routine', 'frequency', 'annual', 'six monthly', 'five yearly', 'schedule'],
    reading: 'a service frequency question' },
  { triggers: ['how loud', 'loud enough', 'can they hear', 'is it audible', 'above ambient'],
    expand: ['spl', 'sound pressure', 'audibility', 'ambient'],
    reading: 'an audibility question' },
  { triggers: ['what size battery', 'how big a battery', 'battery size', 'how long will it last'],
    expand: ['battery', 'standby', 'capacity', 'alarm load'],
    reading: 'a battery sizing question' },
  { triggers: ['what do i write', 'how do i word', 'what wording', 'report wording'],
    expand: ['defect', 'wording', 'report'],
    reading: 'a report wording question' },
  { triggers: ['do i have to tell', 'who do i notify', 'notify the', 'notice to'],
    expand: ['critical defect', 'notice', 'occupier', 'commissioner'],
    reading: 'a notification obligation question' },
  { triggers: ['how much water', 'what flow do i need', 'what pressure do i need', 'duty'],
    expand: ['flow', 'pressure', 'design', 'block plan', 'performance'],
    reading: 'a water supply duty question' },
  { triggers: ['what does it mean', 'what is a', 'what are', 'definition of'],
    expand: ['definition', 'glossary', 'meaning'],
    reading: 'a definition question' },
  { triggers: ['how old', 'age of', 'when was it made', 'date code', 'manufactured'],
    expand: ['date code', 'age', 'service life', 'replacement'],
    reading: 'an equipment age question' },
];

/**
 * Words that carry no search signal once a question shape has been recognised.
 *
 * Only applied when an intent fired, so a query this file does not understand
 * keeps every word it was given.
 */
const FILLER = new Set([
  'off', 'go', 'goes', 'still', 'much', 'many', 'long', 'big', 'small', 'get',
  'put', 'take', 'know', 'tell', 'say', 'thing', 'stuff', 'one', 'it', 'this',
  'that', 'there', 'anyone', 'someone', 'ok', 'okay', 'allowed', 'meant',
]);

const WORD = /[a-z0-9./-]+/g;

/** Lowercase, strip punctuation that is not part of a clause number or a unit. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9./\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return normalise(text).match(WORD) ?? [];
}

export interface Expansion {
  /** Everything to search for: what was typed, plus what it implies. */
  terms: string[];
  /** Only the added terms, so the screen can show its working. */
  added: string[];
  /** Question shapes recognised, in plain words. */
  readings: string[];
  /**
   * Words that were part of a recognised question shape and have already been
   * turned into better terms.
   *
   * "how far off the wall can a detector go" is five content words, three of
   * which ("far", "off", "go") appear in no document ever written. Counting
   * them against the match drags a perfect hit on the spacing clause below the
   * threshold and the search returns nothing — which is exactly the failure
   * this module exists to prevent. A caller scoring coverage should leave these
   * out of the denominator.
   */
  consumed: string[];
}

/**
 * Widens a query into everything it could reasonably be asking for.
 *
 * The original words always survive. Where the query names a clause outright —
 * "AS 2419.1 3.5", "clause 10.4" — that reference is kept intact as a term, so
 * a technician who knows exactly what they want is not made to fight the
 * synonym table for it.
 */
export function expand(query: string): Expansion {
  const original = words(query);
  if (!original.length) return { terms: [], added: [], readings: [], consumed: [] };

  const phrase = normalise(query);
  const have = new Set(original);
  const added = new Set<string>();
  const readings: string[] = [];
  const consumed = new Set<string>();

  const add = (term: string) => {
    for (const w of words(term)) {
      if (!have.has(w)) added.add(w);
    }
    // Multi-word terms are also kept whole, so a phrase match can score.
    if (term.includes(' ') && !have.has(term)) added.add(term);
  };

  for (const group of SYNONYMS) {
    const hit = group.terms.some((t) => (t.includes(' ') ? phrase.includes(t) : have.has(t)));
    if (!hit) continue;
    for (const t of group.terms) add(t);
  }

  for (const intent of INTENTS) {
    const fired = intent.triggers.filter((t) => phrase.includes(t));
    if (!fired.length) continue;
    readings.push(intent.reading);
    for (const t of intent.expand) add(t);
    for (const t of fired) for (const w of words(t)) consumed.add(w);
  }

  // Filler that survives a trigger match: "how far off the wall can it go"
  // leaves "off" and "go" behind, and neither appears in any document.
  if (readings.length) {
    for (const w of FILLER) if (have.has(w)) consumed.add(w);
  }

  return {
    terms: [...new Set([...original, ...added])],
    added: [...added],
    readings,
    consumed: [...consumed],
  };
}

/**
 * A clause reference typed directly into the search box.
 *
 * "AS 2419.1 clause 10.4", "as1670.4 4.7", "2293.2 3.4" — a technician who
 * already knows the reference is not searching, they are navigating, and that
 * deserves an exact jump rather than a ranked list.
 */
export interface ClauseQuery {
  /** The standard as typed, normalised: "as 2419.1". Absent when only a clause was given. */
  standard?: string;
  /** "10.4" */
  clause?: string;
}

const STANDARD_RE = /\bas(?:\/nzs)?\s*([0-9]{3,4}(?:\.[0-9]{1,2})?)(?:[:\s-]*((?:19|20)[0-9]{2}))?/;
const CLAUSE_RE = /\b(?:clause|cl\.?|section|sec\.?)\s*([0-9]{1,2}(?:\.[0-9]{1,2}){0,3})\b/;
const BARE_CLAUSE_RE = /(?:^|\s)([0-9]{1,2}(?:\.[0-9]{1,2}){1,3})(?:\s|$)/;

export function clauseQuery(query: string): ClauseQuery | undefined {
  const q = normalise(query);
  const std = STANDARD_RE.exec(q);
  const named = CLAUSE_RE.exec(q);

  let clause = named?.[1];
  if (!clause) {
    // A bare "3.5" only counts as a clause when a standard was named too —
    // otherwise "2419.1" would read as its own clause number.
    const rest = std ? q.replace(std[0], ' ') : q;
    const bare = BARE_CLAUSE_RE.exec(rest);
    if (bare && std) clause = bare[1];
  }

  if (!std && !clause) return undefined;
  return {
    standard: std ? `as ${std[1]}` : undefined,
    clause,
  };
}
