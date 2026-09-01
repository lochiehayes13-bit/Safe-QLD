import {
  SCHEDULE_2_INSTALLATIONS, schedule2Installation,
  type FilledInstallationRow, type FilledOccupierStatement,
} from '@/domain/occupierForm';
import type { RegisterSystem } from '@/parsers/assetRegister';
import type { SystemKind } from '@/seed/assetTypes';

/**
 * Checking the occupier statement against the company's own records.
 *
 * Schedule 2 column 3 asks whether a critical defect notice was issued during
 * the period, and column 4 asks when the defect was rectified. Both are filled
 * in by a person answering from memory, and both are answers the app already
 * holds: a defect carries the date its notice was given to the occupier and the
 * date it was rectified, against the site, dated.
 *
 * So the statement and the records can disagree, and until now nothing looked.
 *
 * That matters more here than it would on an internal screen. The occupier
 * signs this statement, it goes to the Commissioner, and it is the document
 * produced when something has gone wrong. A statement saying no critical defect
 * notice was issued, over a Safe QLD record of one being issued and the
 * occupier receiving it, is not a clerical difference — it is the company's own
 * file contradicting the document its customer signed.
 *
 * Nothing here fills the form in. The occupier's answer stays the occupier's
 * answer; this says where it does not match what we recorded, so somebody
 * decides before it is signed rather than afterwards.
 *
 * ---
 *
 * Two things it is deliberately careful about.
 *
 * **A disagreement is not always an error.** Safe QLD is not always the only
 * maintenance contractor on a building. A statement declaring a notice we hold
 * no record of may be perfectly true and about somebody else's work, so that
 * reads as something to check. Only the other direction — we hold a notice and
 * the statement says there was none — is a contradiction of our own file.
 *
 * **Not every defect can be attributed to a row.** A pump serves hydrants or
 * sprinklers depending on what it feeds, and the register does not say which,
 * so a notice on a pumpset cannot be filed against a Schedule 2 row without
 * guessing. Guessing would put a contradiction against a row that may be
 * correctly filled in, which is worse than saying nothing. Those are reported
 * as unattributed, with the reason, and left to a person.
 */

// ---------------------------------------------------------------------------
// Which Schedule 2 row a system belongs to
// ---------------------------------------------------------------------------

/**
 * Both of the app's system vocabularies, because a statement is filled from
 * both and one table has to answer for either.
 *
 * `SystemKind` is what an asset type carries; `RegisterSystem` is what the CSV
 * register importer produces. They overlap without matching — the register
 * splits smoke alarms from detection and names doors by what they resist,
 * the asset side has aspirating and gas as their own kinds.
 *
 * They were mapped to Schedule 2 separately, and the separate map was an
 * untyped `Record<string, string>`, so four of the fourteen asset system kinds
 * had no entry and nothing said so. A critical defect on one of them — a fire
 * pumpset that will not start is the obvious one, and it fails both limbs of
 * the Queensland test — was dropped on the floor when the statement was filled
 * in from the site's defects.
 *
 * One table, covering both, exhaustively, is what stops that recurring. The
 * type is the guard: a system added to either vocabulary and left out of both
 * tables below will not compile.
 */
export type AnySystem = RegisterSystem | SystemKind;

/**
 * The rows the app can name with confidence from a register's system.
 *
 * Only where the system is the installation. Anything needing a judgement about
 * a particular building is left out and handled below, because a wrong
 * attribution here becomes a contradiction reported against a row that is
 * correctly filled in.
 */
export const SYSTEM_TO_INSTALLATION: Partial<Record<AnySystem, string>> = {
  extinguisher: 'Fire extinguishers',
  'emergency-lighting': 'Emergency lighting',
  'hose-reel': 'Fire hose reels',
  hydrant: 'Fire hydrants (including boosters)',
  detection: 'Fire detection and alarm systems',
  'smoke-alarm': 'Fire detection and alarm systems',
  aspirating: 'Fire detection and alarm systems',
  ews: 'Emergency warning and intercommunication systems',
  sprinkler: 'Sprinklers',
  'special-hazard': 'Special automatic fire suppression systems',
  gas: 'Special automatic fire suppression systems',
  'smoke-door': 'Smoke doorsets',
  'fire-door': 'Fire doorsets',
  door: 'Fire doorsets',
};

/**
 * Why a system has no Schedule 2 row, in words that say what to do about it.
 *
 * Each of these is a real limit rather than a gap to be filled in later. A
 * pumpset genuinely belongs to whichever installation it feeds, and the asset
 * register does not record that.
 */
const NO_INSTALLATION_REASON: Partial<Record<AnySystem, string>> = {
  pump: 'a fire pumpset serves whichever installation it feeds — hydrants, sprinklers or both — and the '
    + 'register does not say which, so the row cannot be worked out from the asset alone',
  'water-tank': 'a fire water tank serves whichever installation draws from it, and the register does not '
    + 'say which',
  'fire-blanket': 'fire blankets are not one of the twenty-one prescribed installations in Schedule 2; '
    + 'where the building treats them as a fire safety installation they belong under "Other features"',
  unknown: 'the register did not identify what system this asset belongs to',
  passive: 'passive fire protection spans several rows — fire doorsets, smoke doorsets and solid core '
    + 'doors are each their own — so the row depends on which element the defect is on',
  electrical: 'electrical work is not a prescribed installation in its own right; where it is the '
    + 'emergency power supply it belongs under that row',
  structure: 'building structure is not one of the twenty-one prescribed installations',
};

export interface SystemInstallation {
  /** The Schedule 2 row name, where the system names one on its own. */
  installation?: string;
  /** "Schedule 2, row 9". */
  formRef?: string;
  /** Why there is no row, where there is not. Always set when installation is not. */
  why?: string;
}

/** The Schedule 2 row a system belongs to, or why it does not name one. */
export function installationForSystem(system: AnySystem): SystemInstallation {
  const name = SYSTEM_TO_INSTALLATION[system];
  if (!name) {
    return { why: NO_INSTALLATION_REASON[system] ?? 'this system does not correspond to a Schedule 2 row' };
  }
  const item = schedule2Installation(name);
  return { installation: name, formRef: item?.ref };
}

// ---------------------------------------------------------------------------
// What the app holds
// ---------------------------------------------------------------------------

/**
 * A critical defect notice the app recorded, flattened out of the defect table.
 *
 * Deliberately not a database row. This module is pure so it can be tested, and
 * so the same check runs over a statement being filled in on the phone and over
 * one being reviewed in the office.
 */
export interface RecordedNotice {
  /** The defect the notice was issued for, so a problem can point at it. */
  defectId: string;
  /** ISO date the notice was given to the occupier. */
  noticeIssuedAt: string;
  /** The system the defect was found on, where either vocabulary identified one. */
  system?: AnySystem;
  /** ISO date the defect was rectified, where it has been. */
  rectifiedAt?: string;
  location?: string;
  description?: string;
}

export type EvidenceProblemKind =
  /** We hold a notice for this row and the statement declares none. */
  | 'notice-not-declared'
  /** The row is struck out as not installed and we hold a notice against it. */
  | 'struck-but-recorded'
  /** We hold a notice and column 3 has not been answered either way. */
  | 'notice-unanswered'
  /** We hold a notice that cannot be filed against a row without guessing. */
  | 'notice-unattributed'
  /** The statement declares a notice we hold no record of. */
  | 'declared-without-record'
  /** The statement gives a rectification date for a defect still open on our file. */
  | 'rectification-not-recorded'
  /** The statement's rectification date is earlier than the one we recorded. */
  | 'rectification-before-record'
  /** There is no period, so nothing can be attributed to it. */
  | 'no-period';

export interface EvidenceProblem {
  kind: EvidenceProblemKind;
  /** "Schedule 2, row 7", where the problem is about a row. */
  formRef?: string;
  installation?: string;
  message: string;
  /**
   * True where the statement disagrees with the company's own file.
   *
   * The rest are things to check: a notice issued by another contractor on the
   * same building is a real and ordinary thing, and calling it a contradiction
   * would teach people to dismiss the ones that are.
   */
  contradiction: boolean;
  /** The defects behind it, so a screen can open them. */
  defectIds: string[];
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const iso = (s: string | undefined): string | undefined => {
  const t = s?.trim().slice(0, 10);
  return t || undefined;
};

/** Whether a date falls inside the statement's period, both ends included. */
function inPeriod(dateIso: string, start: string, end: string): boolean {
  const d = dateIso.slice(0, 10);
  return d >= start && d <= end;
}

function describe(n: RecordedNotice): string {
  const where = [n.location?.trim(), n.description?.trim()].filter(Boolean).join(' — ');
  return where || 'a recorded critical defect';
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Compares a filled statement with the critical defect notices the app holds.
 *
 * `notices` is every notice recorded against this site, whatever its date —
 * filtering to the period is this function's job, because which notices the
 * period covers is part of what is being checked.
 *
 * Returns an empty list where the statement and the records agree, which is the
 * ordinary case and the one worth being quiet about.
 */
export function checkStatementAgainstRecords(
  statement: FilledOccupierStatement,
  notices: readonly RecordedNotice[],
): EvidenceProblem[] {
  const start = iso(statement.periodStart);
  const end = iso(statement.periodEnd);

  const held = notices.filter((n) => iso(n.noticeIssuedAt));
  if (!start || !end) {
    if (!held.length) return [];
    return [{
      kind: 'no-period',
      message: `The app holds ${held.length} critical defect ${plural(held.length, 'notice', 'notices')} `
        + 'for this site, and the statement does not say what period it covers, so they cannot be '
        + 'checked against it. Set the period first.',
      contradiction: false,
      defectIds: held.map((n) => n.defectId),
    }];
  }

  const inside = held.filter((n) => inPeriod(n.noticeIssuedAt, start, end));

  // Group what we hold by the row it belongs to, keeping the ones that cannot
  // be attributed separate rather than dropping them.
  const byInstallation = new Map<string, RecordedNotice[]>();
  const unattributed: { notice: RecordedNotice; why: string }[] = [];
  for (const n of inside) {
    const where = n.system ? installationForSystem(n.system) : { why: 'the defect is not recorded against a system' };
    if (where.installation) {
      const list = byInstallation.get(where.installation) ?? [];
      list.push(n);
      byInstallation.set(where.installation, list);
    } else {
      unattributed.push({ notice: n, why: where.why! });
    }
  }

  const problems: EvidenceProblem[] = [];
  const rowFor = (name: string): FilledInstallationRow | undefined =>
    statement.rows.find((r) => schedule2Installation(r.installation)?.name === name);
  const refFor = (name: string): string | undefined =>
    SCHEDULE_2_INSTALLATIONS.find((i) => i.name === name)?.ref;

  for (const [installation, held0] of byInstallation) {
    const row = rowFor(installation);
    const formRef = refFor(installation);
    const ids = held0.map((n) => n.defectId);
    const listed = held0.map((n) => `${describe(n)} (notice given ${n.noticeIssuedAt.slice(0, 10)})`).join('; ');
    const count = held0.length;

    if (row && row.installed === false) {
      /*
       * The row is struck out — the statement says the building does not have
       * this installation — and we hold a critical defect notice against it.
       *
       * Footnote 2 has an occupier delete a row the building does not have, so
       * a struck row is a positive answer rather than a blank, and it takes the
       * whole installation off the form. If it is struck wrongly, the notice
       * disappears with it and nothing else on the document would ever mention
       * it. Two things can be wrong here and both matter: the row, or which
       * asset the defect was recorded against.
       */
      problems.push({
        kind: 'struck-but-recorded',
        formRef,
        installation,
        message: `${installation}: the statement says the building does not have this installation, `
          + `and Safe QLD holds ${count} critical defect ${plural(count, 'notice', 'notices')} `
          + `against it in this period — ${listed}. Either the row is struck wrongly, or the `
          + 'defect is recorded against the wrong asset. Struck out, the notice comes off the form '
          + 'with the row.',
        contradiction: true,
        defectIds: ids,
      });
      continue;
    }

    if (!row || row.criticalDefectNoticeIssued === undefined) {
      problems.push({
        kind: 'notice-unanswered',
        formRef,
        installation,
        message: `${installation}: column 3 has not been answered, and the app holds ${count} critical `
          + `defect ${plural(count, 'notice', 'notices')} issued in this period — ${listed}. `
          + 'The answer is Yes on our records.',
        contradiction: false,
        defectIds: ids,
      });
      continue;
    }

    if (row.criticalDefectNoticeIssued === false) {
      problems.push({
        kind: 'notice-not-declared',
        formRef,
        installation,
        message: `${installation}: the statement says no critical defect notice was issued in this period, `
          + `and Safe QLD's own records show ${count} — ${listed}. One of the two is wrong, and the `
          + 'statement is the one the occupier signs.',
        contradiction: true,
        defectIds: ids,
      });
      continue;
    }

    // Column 3 says yes. Check what column 4 claims about rectification.
    const claimed = iso(row.rectificationDate);
    if (!claimed) continue; // Already a blocking issue in the base checker.

    const openIds = held0.filter((n) => !iso(n.rectifiedAt)).map((n) => n.defectId);
    if (openIds.length) {
      problems.push({
        kind: 'rectification-not-recorded',
        formRef,
        installation,
        message: `${installation}: the statement gives ${claimed} as the date of rectification, and `
          + `${openIds.length} of the ${count} ${plural(count, 'defect', 'defects')} behind it `
          + `${plural(openIds.length, 'is', 'are')} still open on our file. Either the rectification was `
          + 'not recorded or the date is not right.',
        contradiction: true,
        defectIds: openIds,
      });
      continue;
    }

    const latest = held0
      .map((n) => iso(n.rectifiedAt)!)
      .reduce((a, b) => (a > b ? a : b));
    if (claimed < latest) {
      problems.push({
        kind: 'rectification-before-record',
        formRef,
        installation,
        message: `${installation}: the statement gives ${claimed} as the date of rectification, and our `
          + `records show the last of these defects rectified on ${latest}. A date before the work was `
          + 'done understates how long the building was affected.',
        contradiction: true,
        defectIds: ids,
      });
    }
  }

  // Rows declaring a notice we hold nothing for. Ordinary where somebody else
  // maintains part of the building, so it reads as a check and not a fault.
  for (const row of statement.rows) {
    if (row.criticalDefectNoticeIssued !== true) continue;
    const item = schedule2Installation(row.installation);
    if (!item || byInstallation.has(item.name)) continue;

    /*
     * We may hold a notice for this installation outside the period. That does
     * not support the claim — every column on the schedule is answered "during
     * the period covered by this statement" — but saying we hold no record of
     * one would be untrue, and it is the fact that tells somebody whether the
     * period is wrong or the answer is.
     */
    const outside = held
      .filter((n) => !inPeriod(n.noticeIssuedAt, start, end))
      .filter((n) => n.system && installationForSystem(n.system).installation === item.name);

    problems.push({
      kind: 'declared-without-record',
      formRef: item.ref,
      installation: item.name,
      message: outside.length
        ? `${item.name}: the statement says a critical defect notice was issued in this period, and `
          + `the ${plural(outside.length, 'notice', 'notices')} Safe QLD holds for it fall outside `
          + `it — ${outside.map((n) => n.noticeIssuedAt.slice(0, 10)).join(', ')}, against a period `
          + `of ${start} to ${end}. Either the period is wrong or the answer belongs to a different `
          + 'statement.'
        : `${item.name}: the statement says a critical defect notice was issued in this period and `
          + 'Safe QLD holds no record of one. That is expected where another contractor maintains it — '
          + 'worth confirming, and the notice has to be attached either way.',
      contradiction: false,
      defectIds: outside.map((n) => n.defectId),
    });
  }

  for (const { notice, why } of unattributed) {
    problems.push({
      kind: 'notice-unattributed',
      message: `A critical defect notice was issued on ${notice.noticeIssuedAt.slice(0, 10)} for `
        + `${describe(notice)}, and it cannot be filed against a Schedule 2 row: ${why}. `
        + 'Check the row it belongs to by hand.',
      contradiction: false,
      defectIds: [notice.defectId],
    });
  }

  return problems;
}

/** The problems that put the statement at odds with the company's own file. */
export function contradictions(problems: readonly EvidenceProblem[]): EvidenceProblem[] {
  return problems.filter((p) => p.contradiction);
}

/**
 * One line for a screen, or nothing where there is nothing to say.
 *
 * Separated from the problems themselves because a summary that reads "3 issues"
 * over a list of three things to confirm is alarming about the wrong thing.
 */
export function evidenceSummary(problems: readonly EvidenceProblem[]): string | undefined {
  if (!problems.length) return undefined;
  const bad = contradictions(problems).length;
  const rest = problems.length - bad;
  if (bad && rest) {
    return `${bad} ${plural(bad, 'answer contradicts', 'answers contradict')} Safe QLD's records, and `
      + `${rest} ${plural(rest, 'other needs', 'others need')} checking.`;
  }
  if (bad) {
    return `${bad} ${plural(bad, 'answer contradicts', 'answers contradict')} Safe QLD's own records.`;
  }
  return `${rest} ${plural(rest, 'answer needs', 'answers need')} checking against Safe QLD's records.`;
}
