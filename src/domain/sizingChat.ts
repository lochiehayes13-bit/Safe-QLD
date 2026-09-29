import {
  DEFAULT_DROP_LIMIT_PERCENT, designCurrent, sizeCable,
  type CircuitPhase, type DeratingFactor, type SizingResult,
} from '@/calc/cable';
import {
  candidateRowsFor, capacityColumns, deratingFactors, describeColumn,
  type CapacityColumn, type WiringDerating,
} from '@/domain/wiringCables';
import type { SizingBrief } from '@/ai/sizingChat';

/**
 * Turning a description of an install into a cable, deterministically.
 *
 * The model in `@/ai/sizingChat` reads the sentence and produces facts. This
 * module does everything after that, and it contains no model and no
 * judgement that cannot be shown: it matches those facts to a real column of
 * a real table, matches the conditions to real derating factors, and hands
 * the whole lot to the same `sizeCable` the manual screen uses.
 *
 * Two rules make the answer defensible.
 *
 * **It never picks silently.** Where two columns fit almost as well, both come
 * back and the screen shows the runners-up, because "TPS in a wall" is three
 * different arrangements in the standard and the difference between them is
 * worth twenty amps.
 *
 * **It never invents a condition.** A description that mentions four other
 * circuits and no ambient temperature gets a grouping factor and no ambient
 * factor, and says the ambient was not derated — rather than assuming 40 °C
 * because that is what the table was computed at.
 */

// ---------------------------------------------------------------------------
// Matching the cable
// ---------------------------------------------------------------------------

export interface ColumnMatch {
  column: CapacityColumn;
  score: number;
  /** What matched, in words, for the line under the answer. */
  because: string[];
}

export interface TablePick {
  best?: ColumnMatch;
  /** The next few, so a wrong pick is one tap from being corrected. */
  runnersUp: ColumnMatch[];
  /** What was said that nothing matched — so the screen can say so. */
  unmatched: string[];
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'in', 'on', 'of', 'and', 'or', 'to', 'at', 'through', 'with', 'core']);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9. ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** How many of the description's words appear in the column's own wording. */
function overlap(said: string, against: string): number {
  const target = against.toLowerCase();
  const hits = words(said).filter((w) => target.includes(w));
  return hits.length;
}

/**
 * The cable designations a technician says, and what the tables call them.
 *
 * "TPS" is not a word in AS/NZS 3008: the table says thermoplastic, and a
 * sparky says TPS or V-75. Without this the insulation half of every match
 * scores zero.
 */
const INSULATION_WORDS: { says: RegExp; tableWord: string }[] = [
  { says: /\btps\b|\bv-?75\b|pvc|thermoplastic/i, tableWord: 'thermoplastic' },
  { says: /\bx-?90\b|xlpe|cross-?linked|\bxhf\b/i, tableWord: 'x-90' },
  { says: /\bep\b|\br-?ep-?90\b|elastomer|rubber/i, tableWord: 'r-ep-90' },
  { says: /\bmims\b|mineral/i, tableWord: 'mims' },
  { says: /110\s*°?c/i, tableWord: '110' },
];

const CORE_WORDS: { says: RegExp; tableWord: string }[] = [
  { says: /\bsingle[- ]?core\b|\bsingles?\b/i, tableWord: 'single-core' },
  { says: /\b(two|2)[- ]?core\b|\btwin\b|\b2c\b/i, tableWord: 'two-core' },
  { says: /\b(three|3)[- ]?core\b|\b3c\b/i, tableWord: 'three-core' },
  { says: /\b(four|4)[- ]?core\b|\b4c\b/i, tableWord: 'four-core' },
  { says: /\bflex(ible)?\b|\bcord\b/i, tableWord: 'flexible' },
];

/**
 * How a sparky says an installation, and what the table calls it.
 *
 * This is the gap that decides whether the whole feature works. Nobody says
 * "wiring enclosure in air" — they say conduit in a wall. Nobody says
 * "unenclosed, spaced" — they say clipped to the wall, or on a tray. Matching
 * the description's words against the table's words directly finds almost
 * nothing, and the first arrangement in the list wins by default, which is
 * how a cable gets sized against the wrong column without anybody noticing.
 */
const INSTALL_WORDS: {
  says: RegExp;
  tableWords: string[];
  /**
   * True for the arrangements nobody gets by accident. Buried, wrapped in
   * insulation and out in the sun all carry lower figures and all have to be
   * said out loud; a column for one of them is wrong for a description that
   * did not mention it, and without this it wins on a tiebreak.
   */
  mustBeSaid?: boolean;
}[] = [
  { says: /buried|underground|in the ground|trench|direct burial/i, tableWords: ['buried', 'underground'], mustBeSaid: true },
  { says: /conduit|duct|trunking|enclosure|inside a pipe|in pipe/i, tableWords: ['wiring enclosure', 'enclosed'] },
  { says: /insulation|batts|sarking/i, tableWords: ['thermal insulation'], mustBeSaid: true },
  { says: /touching|bunched|bundled|strapped together/i, tableWords: ['touching'] },
  { says: /tray|ladder|cleat|rack|clipped|surface|free air|open air|unenclosed|spaced/i, tableWords: ['unenclosed', 'spaced'] },
  { says: /sun|sunlight|exposed/i, tableWords: ['exposed to sun'], mustBeSaid: true },
  { says: /partial/i, tableWords: ['partially'] },
  { says: /completely|fully|wrapped|surrounded/i, tableWords: ['completely'] },
];

/**
 * Whether an arrangement mentions a word, as a word.
 *
 * A plain substring test says that "unenclosed › spaced" mentions "enclosed",
 * which sends every conduit run to the wrong column — and the wrong column
 * here is the one with the highest figures in the table, so the mistake makes
 * the cable smaller.
 */
function mentions(arrangement: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(arrangement);
}

/**
 * Picks the column the description is about.
 *
 * Scored rather than filtered, because a description almost never names every
 * axis: "TPS in a wall" says nothing about cores, and refusing to answer until
 * it does is how a tool gets abandoned. The score says how much was actually
 * matched, and the screen prints it.
 */
export function pickTable(brief: SizingBrief, columns: readonly CapacityColumn[] = capacityColumns()): TablePick {
  const unmatched: string[] = [];

  const insulationWord = brief.insulation
    ? INSULATION_WORDS.find((i) => i.says.test(brief.insulation!))?.tableWord
    : undefined;
  if (brief.insulation && !insulationWord) unmatched.push(`insulation “${brief.insulation}”`);

  const coreWord = brief.cores
    ? CORE_WORDS.find((c) => c.says.test(brief.cores!))?.tableWord
    : undefined;
  if (brief.cores && !coreWord) unmatched.push(`cable “${brief.cores}”`);

  const scored: ColumnMatch[] = [];
  for (const column of columns) {
    let score = 0;
    const because: string[] = [];

    if (brief.material) {
      if (column.material === brief.material) { score += 3; because.push(brief.material); } else score -= 4;
    } else if (column.material === 'copper') {
      // Nothing said: copper is what nearly everything is, and aluminium is
      // named when it is used.
      score += 1;
    }

    if (insulationWord) {
      if (column.insulation.toLowerCase().includes(insulationWord)) { score += 3; because.push(column.insulation.split('(')[0]!.trim()); } else score -= 1;
    }

    if (coreWord) {
      const cores = column.cores.toLowerCase();
      if (cores.includes(coreWord) || (coreWord === 'three-core' && cores.includes('three-core'))) {
        score += 3;
        because.push(column.cores.split('(')[0]!.trim());
      } else score -= 1;
    }

    if (brief.installMethod) {
      const arrangement = column.installMethod.toLowerCase();
      let matchedAny = false;
      for (const group of INSTALL_WORDS) {
        const said = group.says.test(brief.installMethod);
        const inColumn = group.tableWords.some((w) => mentions(arrangement, w));
        if (said && inColumn) {
          score += 4;
          matchedAny = true;
        } else if (said) {
          score -= 1;
        } else if (group.mustBeSaid && inColumn) {
          score -= 3;
        }
      }
      const hits = overlap(brief.installMethod, column.installMethod);
      if (hits) { score += hits * 2; matchedAny = true; }
      if (matchedAny) because.push(column.installMethod);
    }

    // A column with more sizes is a better default than a short one, all else
    // equal: it covers more of the answer space rather than refusing early.
    score += Math.min(1, column.sizes / 40);

    if (score > 0) scored.push({ column, score, because: [...new Set(because)] });
  }

  scored.sort((a, b) => b.score - a.score || b.column.sizes - a.column.sizes);

  const arrangementUnderstood = brief.installMethod
    ? INSTALL_WORDS.some((g) => g.says.test(brief.installMethod!))
      || scored.some((m) => overlap(brief.installMethod!, m.column.installMethod))
    : true;
  if (!arrangementUnderstood) unmatched.push(`how it runs — “${brief.installMethod}”`);

  return { best: scored[0], runnersUp: scored.slice(1, 5), unmatched };
}

// ---------------------------------------------------------------------------
// Matching the conditions
// ---------------------------------------------------------------------------

export interface DeratingPick {
  applied: WiringDerating[];
  /** Conditions the description stated that no factor was found for. */
  uncovered: string[];
}

/** The number in a condition's text, for matching "6 circuits" to a row. */
function firstNumber(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) : undefined;
}

/**
 * The derating the description actually calls for.
 *
 * Only what was said. An ambient nobody mentioned is not derated and the
 * screen says the answer assumes the table's own reference ambient, which is
 * the honest position: guessing 40 °C in a Queensland roof space would be
 * wrong by two factors.
 */
export function pickDerating(brief: SizingBrief, factors: readonly WiringDerating[] = deratingFactors()): DeratingPick {
  const applied: WiringDerating[] = [];
  const uncovered: string[] = [];

  if (brief.ambientC !== undefined) {
    const ambient = factors
      .filter((f) => f.kind === 'ambient' && /air|concrete/i.test(f.condition))
      .map((f) => ({ f, at: temperatureOfCondition(f.condition) }))
      .filter((x): x is { f: WiringDerating; at: number } => x.at !== undefined)
      .sort((a, b) => Math.abs(a.at - brief.ambientC!) - Math.abs(b.at - brief.ambientC!))[0];
    if (ambient && Math.abs(ambient.at - brief.ambientC) <= 5) applied.push(ambient.f);
    else uncovered.push(`${brief.ambientC} °C ambient`);
  }

  if (brief.groupedCircuits !== undefined && brief.groupedCircuits > 1) {
    const grouped = factors
      .filter((f) => f.kind === 'grouping' && /bunched|enclosure/i.test(f.condition))
      .map((f) => ({ f, n: firstNumber(f.condition.split('—')[0] ?? '') }))
      .filter((x): x is { f: WiringDerating; n: number } => x.n !== undefined)
      .sort((a, b) => Math.abs(a.n - brief.groupedCircuits!) - Math.abs(b.n - brief.groupedCircuits!))[0];
    if (grouped && grouped.n === brief.groupedCircuits) applied.push(grouped.f);
    else uncovered.push(`${brief.groupedCircuits} circuits together`);
  }

  if (brief.inInsulation) {
    // Thermal insulation is handled by the capacity column itself in AS/NZS
    // 3008 — there are columns for it — so it belongs in the table pick, not
    // in a factor. Saying so beats applying nothing silently.
    uncovered.push('surrounded by thermal insulation — pick the column for it rather than derating');
  }

  if (brief.buriedDepthM !== undefined) {
    const depth = factors
      .filter((f) => f.kind === 'depth')
      .map((f) => ({ f, at: firstNumber(f.condition.split('—')[0] ?? '') }))
      .filter((x): x is { f: WiringDerating; at: number } => x.at !== undefined)
      .sort((a, b) => Math.abs(a.at - brief.buriedDepthM!) - Math.abs(b.at - brief.buriedDepthM!))[0];
    if (depth && Math.abs(depth.at - brief.buriedDepthM) <= 0.2) applied.push(depth.f);
    else uncovered.push(`buried ${brief.buriedDepthM} m deep`);
  }

  return { applied, uncovered };
}

function temperatureOfCondition(condition: string): number | undefined {
  // "Ambient air or concrete slab temperature: Conductor temperature °C 75 — … 45"
  const tail = condition.split('—').pop() ?? condition;
  const m = /(-?\d+(?:\.\d+)?)\s*$/.exec(tail.trim()) ?? /(-?\d+(?:\.\d+)?)/.exec(tail);
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export interface SizingAnswer {
  /** Absent when the facts do not reach far enough to size anything. */
  result?: SizingResult;
  pick: TablePick;
  derating: DeratingPick;
  /** The design current used, and how it was arrived at. */
  designCurrentA?: number;
  currentFrom?: string;
  /** What has to be answered before there can be an answer. */
  needs: string[];
  /** Everything the answer assumed, stated rather than buried. */
  assumptions: string[];
}

/**
 * The whole chain, from the facts to the size.
 *
 * `needs` is the important half. A description with no length cannot be
 * sized, and saying "25 mm²" from a guessed length would be worse than
 * saying what is missing — so the answer comes back with the questions
 * instead, and the screen asks them.
 */
export function answerFromBrief(
  brief: SizingBrief,
  options: { columns?: readonly CapacityColumn[]; factors?: readonly WiringDerating[] } = {},
): SizingAnswer {
  const pick = pickTable(brief, options.columns ?? capacityColumns());
  const derating = pickDerating(brief, options.factors ?? deratingFactors());
  const needs: string[] = [];
  const assumptions: string[] = [];

  const phase: CircuitPhase | undefined = brief.phase;
  if (!phase) needs.push('Single phase or three phase?');
  if (brief.volts === undefined) needs.push('What is the supply voltage?');
  if (brief.lengthM === undefined) needs.push('How long is the run, one way?');

  let designCurrentA: number | undefined;
  let currentFrom: string | undefined;
  if (brief.loadAmps !== undefined) {
    designCurrentA = brief.loadAmps;
    currentFrom = `${brief.loadAmps} A, as stated`;
  } else if (brief.loadWatts !== undefined && brief.volts !== undefined && phase) {
    const pf = brief.powerFactor ?? 1;
    const amps = designCurrent(brief.loadWatts, brief.volts, phase, pf);
    if (amps !== null) {
      designCurrentA = amps;
      currentFrom = `${amps} A, from ${brief.loadWatts} W at ${brief.volts} V${pf === 1 ? '' : ` and ${pf} power factor`}`;
      if (brief.powerFactor === undefined) assumptions.push('Unity power factor, because none was stated. A motor is nearer 0.8 and draws more.');
    }
  } else {
    needs.push('How much load — amps, or watts?');
  }

  if (!pick.best) needs.push('What cable, and how does it run? Nothing in the tables matched.');

  if (needs.length || !pick.best || designCurrentA === undefined
    || brief.volts === undefined || brief.lengthM === undefined || !phase) {
    return { pick, derating, designCurrentA, currentFrom, needs, assumptions };
  }

  const { rows } = candidateRowsFor(pick.best.column);
  const factors: DeratingFactor[] = derating.applied.map((f) => ({
    kind: f.kind, condition: f.condition, factor: f.factor, source: f.source,
  }));

  if (!derating.applied.length) {
    assumptions.push(`Nothing derated: sized as printed in ${pick.best.column.tableRef}, which assumes ${pick.best.column.referenceAmbient ?? 'its own reference ambient'} and one circuit on its own.`);
  }
  if (brief.voltDropLimitPercent === undefined) {
    assumptions.push(`${DEFAULT_DROP_LIMIT_PERCENT}% volt drop limit, the usual figure, because none was stated.`);
  }
  if (!brief.faultA) {
    assumptions.push('Fault withstand was not checked, because no prospective fault current was given.');
  }

  const result = sizeCable({
    designCurrentA,
    lengthM: brief.lengthM,
    supplyVolts: brief.volts,
    phase,
    material: pick.best.column.material,
    operatingC: pick.best.column.operatingC,
    powerFactor: brief.powerFactor,
    limitPercent: brief.voltDropLimitPercent,
    derating: factors,
    rows,
    fault: brief.faultA && brief.clearingTimeS
      ? {
        faultA: brief.faultA,
        clearingTimeS: brief.clearingTimeS,
        // The conductor starts at its operating temperature and may reach the
        // short-circuit limit for its insulation; 160 °C is thermoplastic's,
        // which is the conservative one of the two common insulations.
        startC: pick.best.column.operatingC,
        finalC: pick.best.column.operatingC >= 90 ? 250 : 160,
      }
      : undefined,
  });

  return { result, pick, derating, designCurrentA, currentFrom, needs, assumptions };
}

/** One line for the top of the answer card. */
export function answerHeadline(answer: SizingAnswer): string {
  if (answer.needs.length) return 'Not enough to size it yet';
  const chosen = answer.result?.chosen;
  if (!chosen) return answer.result?.refusal ?? 'Nothing passed every check';
  return `${chosen.row.areaMm2} mm² on a ${chosen.protection.deviceRatingA} A device`;
}

/** The working, in the order somebody would check it. */
export function answerWorking(answer: SizingAnswer): string[] {
  const out: string[] = [];
  if (answer.currentFrom) out.push(`Design current ${answer.currentFrom}.`);
  if (answer.pick.best) out.push(`Sized against ${describeColumn(answer.pick.best.column)} — ${answer.pick.best.column.ref}.`);
  const chosen = answer.result?.chosen;
  if (chosen) {
    out.push(`Carries ${chosen.capacityA} A where it is installed${answer.derating.applied.length ? ` after ${answer.derating.applied.length} derating factor${answer.derating.applied.length === 1 ? '' : 's'}` : ''}.`);
    if (chosen.drop) out.push(`Volt drop ${chosen.drop.dropPercent}% over the run, limit ${chosen.drop.limitPercent}%.`);
    out.push(chosen.protection.reason);
    out.push(chosen.row.source);
  }
  return out;
}
