/**
 * Maximum demand.
 *
 * The figure that sizes the main, the main switch and the supply, and the one
 * most often arrived at by adding up every nameplate in the building and then
 * quietly halving it. It is not the connected load: nothing has every appliance
 * in a building running flat out at the same moment, and a main sized as
 * though it did is money in a wall and a supply upgrade nobody needed.
 *
 * ## What this does and does not decide
 *
 * The per-load allowances — how much of a range's connected load counts, what a
 * lighting circuit is assessed at, how many socket outlets are diversified —
 * come from the maximum demand table in the designer's own copy of the Wiring
 * Rules. Those figures are Standards Australia's and are not in this app, in
 * line with everything else here.
 *
 * What this does is the arithmetic around them, which is where the mistakes
 * actually happen:
 *
 *  - each load group assessed either as a fraction of what is connected or as
 *    a fixed figure, because the table does both and mixing them up is easy;
 *  - the assessment carried alongside the number, so the working can be read
 *    back six months later;
 *  - the total taken per phase rather than divided by three, because a supply
 *    is sized on its worst phase and an installation with everything on one of
 *    them has a maximum demand three times what the average suggests.
 *
 * That last one is the reason this exists as its own module rather than as a
 * sum on a screen. Dividing a three-phase total by three is the single most
 * common way a maximum demand comes out wrong, and it comes out wrong in the
 * direction that trips a main on the first hot afternoon.
 */

export type DemandBasis = 'fraction' | 'fixed';

/** Which phase a load sits on. */
export type DemandPhase = 'a' | 'b' | 'c' | 'all';

export const PHASE_LABELS: Record<DemandPhase, string> = {
  a: 'Phase A',
  b: 'Phase B',
  c: 'Phase C',
  all: 'Across all three',
};

export interface DemandRow {
  id: string;
  /** What it is: "Lighting", "Range", "10 A socket outlets". */
  label: string;
  /** The connected load, in amps. */
  connectedA: number;
  basis: DemandBasis;
  /**
   * For `fraction`, how much of the connected load counts, 0 to 1. For
   * `fixed`, the demand in amps that the assessment gives outright.
   */
  value: number;
  phase: DemandPhase;
  /** Which row of whose table this assessment came from. */
  source?: string;
}

export interface AssessedRow {
  row: DemandRow;
  /** What this row contributes, in amps. */
  demandA: number;
  /** Why it contributes nothing, where it does not. */
  ignored?: string;
}

export interface DemandResult {
  rows: AssessedRow[];
  /** What each phase carries. */
  perPhaseA: Record<'a' | 'b' | 'c', number>;
  /** The heaviest phase — what the main is sized on. */
  maximumDemandA: number;
  worstPhase: 'a' | 'b' | 'c';
  /** Everything connected, before any assessment. */
  connectedA: number;
  /** Demand over connected, which is the diversity actually achieved. */
  diversity: number;
  /**
   * How far the heaviest phase is above the lightest, as a percentage of the
   * heaviest. Zero on a perfectly balanced board.
   */
  imbalancePercent: number;
  /** Present where something in the input could not be used. */
  warnings: string[];
}

/**
 * Works the demand out per phase.
 *
 * A row with a fraction outside 0 to 1, or a negative connected load, is
 * ignored and named rather than clamped: a clamped figure looks like an
 * answer, and this answer sizes the supply.
 *
 * A three-phase load marked `all` contributes its demand to each phase, not a
 * third of it to each — the phase carries the full per-phase current of a
 * balanced load, and dividing it here would understate every phase by three.
 */
export function assessDemand(rows: readonly DemandRow[]): DemandResult {
  const assessed: AssessedRow[] = [];
  const perPhaseA = { a: 0, b: 0, c: 0 };
  const warnings: string[] = [];
  let connectedA = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.connectedA) || row.connectedA < 0) {
      assessed.push({ row, demandA: 0, ignored: 'the connected load is not a number' });
      warnings.push(`${row.label || 'A row'}: the connected load is not a number.`);
      continue;
    }
    if (!Number.isFinite(row.value) || row.value < 0) {
      assessed.push({ row, demandA: 0, ignored: 'the assessment is not a number' });
      warnings.push(`${row.label || 'A row'}: the assessment is not a number.`);
      continue;
    }
    if (row.basis === 'fraction' && row.value > 1) {
      assessed.push({ row, demandA: 0, ignored: 'a fraction above 1 would assess more than is connected' });
      warnings.push(`${row.label || 'A row'}: a fraction above 1 would assess more than is connected.`);
      continue;
    }

    connectedA += row.connectedA;
    const demandA = row.basis === 'fixed' ? row.value : row.connectedA * row.value;
    assessed.push({ row, demandA: round(demandA, 2) });

    if (row.phase === 'all') {
      perPhaseA.a += demandA;
      perPhaseA.b += demandA;
      perPhaseA.c += demandA;
    } else {
      perPhaseA[row.phase] += demandA;
    }
  }

  const phases: ('a' | 'b' | 'c')[] = ['a', 'b', 'c'];
  const worstPhase = phases.reduce((worst, p) => (perPhaseA[p] > perPhaseA[worst] ? p : worst), 'a');
  const maximumDemandA = perPhaseA[worstPhase];
  const lightest = Math.min(perPhaseA.a, perPhaseA.b, perPhaseA.c);

  return {
    rows: assessed,
    perPhaseA: { a: round(perPhaseA.a, 2), b: round(perPhaseA.b, 2), c: round(perPhaseA.c, 2) },
    maximumDemandA: round(maximumDemandA, 2),
    worstPhase,
    connectedA: round(connectedA, 2),
    diversity: connectedA > 0 ? round(maximumDemandA / connectedA, 3) : 0,
    imbalancePercent: maximumDemandA > 0 ? round(((maximumDemandA - lightest) / maximumDemandA) * 100, 1) : 0,
    warnings,
  };
}

/**
 * Whether moving one single-phase load to another phase would help, and which.
 *
 * A board out of balance is not a calculation problem, it is twenty minutes
 * with a screwdriver — but only if somebody is told which way to move what.
 * The suggestion is the heaviest single-phase row on the worst phase, and it
 * is offered only where moving it actually lowers the maximum demand rather
 * than simply making a different phase the worst one.
 */
export function rebalanceSuggestion(result: DemandResult): { row: DemandRow; to: 'a' | 'b' | 'c'; newMaximumA: number } | undefined {
  const phases: ('a' | 'b' | 'c')[] = ['a', 'b', 'c'];
  const lightestPhase = phases.reduce((best, p) => (result.perPhaseA[p] < result.perPhaseA[best] ? p : best), 'a');
  if (lightestPhase === result.worstPhase) return undefined;

  const movable = result.rows
    .filter((r) => !r.ignored && r.row.phase === result.worstPhase && r.demandA > 0)
    .sort((a, b) => b.demandA - a.demandA)[0];
  if (!movable) return undefined;

  const after = { ...result.perPhaseA };
  after[result.worstPhase] -= movable.demandA;
  after[lightestPhase] += movable.demandA;
  const newMaximumA = Math.max(after.a, after.b, after.c);

  if (newMaximumA >= result.maximumDemandA) return undefined;
  return { row: movable.row, to: lightestPhase, newMaximumA: round(newMaximumA, 2) };
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
