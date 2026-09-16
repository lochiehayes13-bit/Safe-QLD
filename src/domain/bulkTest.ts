import type { AssetRecord } from '@/db/assetRepo';
import type { AssetTestRefusal, AssetTestToSend } from '@/domain/assetTestDecision';
import { qldDay } from '@/domain/qldTime';
import { SYSTEM_LABELS, assetTypeById, type SystemKind } from '@/seed/assetTypes';
import {
  DEFECT_LIBRARY, SEVERITY_ORDER, defectByCode, defectsForSystem, type DefectCode, type Severity,
} from '@/seed/defectLibrary';

/**
 * Testing a site's assets in bulk.
 *
 * A routine run asks every check on every asset, which is right for an annual
 * and wrong for the other eleven months. A six-monthly on a school is three
 * hundred extinguishers that all pass, four that do not, and two behind a
 * locked door — and the honest record of that visit is "these passed, these
 * failed and here is why, these were not reached". This module is that
 * record before it is written: which assets are in hand, what was decided
 * about each, and what the decision turns into on the asset, in the defect
 * list and in the note the office reads.
 *
 * It is deliberately pure. Every decision a screen would otherwise make on
 * the fly — what a fail becomes as a defect, which assets a "select this
 * level" tap picks up, how a note to the office is worded — is made here,
 * where it can be tested without a phone. The screen only holds the state
 * and calls the repositories with what this hands it.
 *
 * "Not tested" stays a third answer, as it is everywhere else in the app. It
 * is the commonest real outcome on an annual and it is neither of the other
 * two: recorded as a pass it hides a coverage gap, recorded as a fail it
 * raises a defect that does not exist.
 */

export type VerdictKind = 'pass' | 'fail' | 'not-tested';

/**
 * What a failure carries.
 *
 * `observation` is what the technician saw, in their words; `wording` is the
 * sentence that goes on the record. They are kept apart because the record
 * has a register — third person, past tense, what was found and what it must
 * do — and "bloody thing won't discharge" does not, though it is the more
 * useful of the two to whoever fixes it. The observation stays on the asset's
 * timeline as the detail behind the event.
 */
export interface FailDetail {
  observation: string;
  /** The library code, where one fits. A fail can be recorded without one. */
  defectCode?: string;
  /** The wording that goes on the record. Falls back to the code's, then the observation. */
  wording?: string;
  severity: Severity;
  photos: string[];
}

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'fail'; fail: FailDetail }
  | { kind: 'not-tested'; reason: string };

/** Every verdict so far, by asset id. Plain data, so a draft can hold it. */
export type Batch = Record<string, Verdict>;

/**
 * The assets in hand, as an ordered list of ids.
 *
 * A list rather than a Set because the selection lives in a draft that is
 * serialised to storage on every change, and JSON has no Set. Membership is
 * looked up through `isSelected`, which is the only place that needs to be
 * quick, and it builds a Set on the way.
 */
export type BulkSelection = string[];

/** Why an asset could not be tested. The same list a routine run offers. */
export const NOT_TESTED_REASONS = [
  'No access to the area',
  'Access equipment required',
  'Tenant refused entry',
  'Device could not be located',
  'Isolated for other works',
  'Unsafe to test',
] as const;

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export const EMPTY_SELECTION: BulkSelection = [];

export function isSelected(selection: BulkSelection, id: string): boolean {
  return selection.includes(id);
}

export function toggleSelected(selection: BulkSelection, id: string): BulkSelection {
  return selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
}

/** Adds every asset given, keeping the order of the ones already there. */
export function selectAll(selection: BulkSelection, assets: readonly Pick<AssetRecord, 'id'>[]): BulkSelection {
  const have = new Set(selection);
  const added = assets.map((a) => a.id).filter((id) => !have.has(id));
  return [...selection, ...added];
}

export function clearSelection(): BulkSelection {
  return EMPTY_SELECTION;
}

/** The system an asset belongs to, through its type. Unknown types have none. */
export function systemOf(asset: Pick<AssetRecord, 'assetTypeId'>): SystemKind | undefined {
  return assetTypeById(asset.assetTypeId)?.system;
}

/** Adds every asset of one system. */
export function selectSystem(
  selection: BulkSelection,
  assets: readonly Pick<AssetRecord, 'id' | 'assetTypeId'>[],
  system: SystemKind,
): BulkSelection {
  return selectAll(selection, assets.filter((a) => systemOf(a) === system));
}

/**
 * Adds every asset on one level.
 *
 * Levels are compared trimmed and case-folded because they were typed, and
 * "Level 2", "level 2" and "Level 2 " are the same floor of the same building.
 */
export function selectLevel(
  selection: BulkSelection,
  assets: readonly Pick<AssetRecord, 'id' | 'level'>[],
  level: string,
): BulkSelection {
  const wanted = levelKey(level);
  return selectAll(selection, assets.filter((a) => levelKey(a.level) === wanted));
}

export function levelKey(level: string | undefined): string {
  return (level ?? '').trim().toLowerCase();
}

/** The distinct levels across a register, in the order they first appear. Blank levels are left out. */
export function levelsOf(assets: readonly Pick<AssetRecord, 'level'>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of assets) {
    const raw = a.level?.trim();
    if (!raw) continue;
    const key = levelKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/** The distinct systems across a register, most assets first. */
export function systemsOf(assets: readonly Pick<AssetRecord, 'assetTypeId'>[]): SystemKind[] {
  const counts = new Map<SystemKind, number>();
  for (const a of assets) {
    const s = systemOf(a);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/**
 * Records one verdict against every selected asset.
 *
 * A fail's photographs and wording are shared across the batch on purpose:
 * three extinguishers past their hydrostatic date on the same level are one
 * observation, and asking for it three times is how a technician starts
 * writing "as above". Each asset still gets its own defect on record.
 */
export function applyVerdictToAll(batch: Batch, selection: BulkSelection, verdict: Verdict): Batch {
  const next: Batch = { ...batch };
  for (const id of selection) next[id] = verdict;
  return next;
}

export function clearVerdict(batch: Batch, id: string): Batch {
  if (!(id in batch)) return batch;
  const next = { ...batch };
  delete next[id];
  return next;
}

/** Whether a fail has enough on it to be written up. A code or an observation; one will do. */
export function failIsComplete(fail: FailDetail): boolean {
  return Boolean(fail.defectCode) || fail.observation.trim().length > 0;
}

/**
 * The sentence that goes on the defect.
 *
 * Whatever the technician (or the model, checked) wrote wins. Failing that,
 * the library's wording for the code with the observation after it — the
 * same shape a routine run writes — and failing that the observation alone,
 * which is at least true.
 */
export function finalWording(fail: FailDetail): string {
  const own = fail.wording?.trim();
  if (own) return own;
  const code = fail.defectCode ? defectByCode(fail.defectCode) : undefined;
  const observation = fail.observation.trim();
  if (code) return [code.reportWording, observation].filter(Boolean).join(' ');
  return observation || 'Failed on test.';
}

/**
 * Where a defect says it is.
 *
 * Level, room and name, the same as a routine run writes, so a defect raised
 * here reads identically to one raised there and the notice screen and the
 * report do not have to know which screen it came from.
 */
export function locationOf(asset: Pick<AssetRecord, 'level' | 'room' | 'name' | 'assetTypeId'>): string {
  return [asset.level, asset.room, asset.name || assetTypeById(asset.assetTypeId)?.label]
    .filter(Boolean)
    .join(' ') || 'Location not recorded';
}

/** The library's four grades folded to the record's two, the way a routine run does it. */
export function recordSeverity(severity: Severity): 'critical' | 'non-critical' {
  return severity === 'critical' ? 'critical' : 'non-critical';
}

// ---------------------------------------------------------------------------
// What a verdict turns into
// ---------------------------------------------------------------------------

export interface PlannedEvent {
  kind: 'passed' | 'failed' | 'not-tested';
  summary: string;
  detail?: string;
  photos: string[];
}

/** The timeline event a verdict writes on the asset. */
export function eventFor(verdict: Verdict): PlannedEvent {
  switch (verdict.kind) {
    case 'pass':
      return { kind: 'passed', summary: 'Bulk test — passed', photos: [] };
    case 'fail': {
      const code = verdict.fail.defectCode;
      return {
        kind: 'failed',
        summary: `Bulk test — failed${code ? ` (${code})` : ''}`,
        detail: verdict.fail.observation.trim() || undefined,
        photos: verdict.fail.photos,
      };
    }
    case 'not-tested':
      return { kind: 'not-tested', summary: `Bulk test — not tested: ${verdict.reason}`, photos: [] };
  }
}

export interface PlannedDefect {
  assetId: string;
  location: string;
  description: string;
  severity: 'critical' | 'non-critical';
  /** The library's own grade, kept for the non-critical ones. See Defect. */
  priority?: 'high' | 'medium' | 'low';
  defectCode?: string;
  photos: string[];
  notes: string;
}

/** The defect a failed asset raises. */
export function defectFor(asset: AssetRecord, fail: FailDetail): PlannedDefect {
  const observation = fail.observation.trim();
  return {
    assetId: asset.id,
    location: locationOf(asset),
    description: finalWording(fail),
    severity: recordSeverity(fail.severity),
    priority: fail.severity === 'critical' ? undefined : fail.severity,
    defectCode: fail.defectCode,
    photos: fail.photos,
    notes: [
      fail.defectCode ? `${fail.defectCode} · raised from a bulk test` : 'Raised from a bulk test',
      observation ? `Technician note: ${observation}` : undefined,
    ].filter(Boolean).join('\n\n'),
  };
}

/** The key the asset sync writes the office's service levels under. See mapSimproAsset. */
export const SERVICE_LEVELS_KEY = 'simproServiceLevels';

/**
 * Which Simpro service level an asset's result is filed against.
 *
 * Simpro records a test against a frequency, and its id has to come from the
 * asset the office sent down. The sync writes them under one key as
 * `id:name:dueAt,id:name:dueAt` (the date left off where the office has
 * none); nothing else is read, because a key nobody writes is a guess. An
 * asset on several frequencies is filed against the one falling due
 * soonest — that is the visit the office is waiting on — and against the
 * first listed where no date is on record. Where the key is absent there is
 * no id, and the honest answer is the queue's 'no-service-level' refusal
 * rather than a guess: a result filed against the wrong frequency moves the
 * office's due date for the wrong one.
 */
export function serviceLevelIdOf(asset: Pick<AssetRecord, 'attributes'>): string | undefined {
  const raw = asset.attributes?.[SERVICE_LEVELS_KEY];
  if (raw === undefined) return undefined;
  const levels = String(raw)
    .split(',')
    .map(parseServiceLevel)
    .filter((l): l is { id: string; dueAt?: string } => Boolean(l));
  if (!levels.length) return undefined;
  const dated = levels.filter((l) => l.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  return (dated[0] ?? levels[0])!.id;
}

/**
 * One `id:name[:dueAt]` entry. The date is recognised by shape, so a colon
 * in a name cannot become a date; and the id must be a number, since
 * Simpro's are, so a comma the office typed into a level's name cannot
 * leave a name fragment posing as an id.
 */
function parseServiceLevel(entry: string): { id: string; dueAt?: string } | undefined {
  const parts = entry.split(':').map((p) => p.trim());
  const id = parts[0];
  if (!id || !/^\d+$/.test(id)) return undefined;
  const last = parts[parts.length - 1];
  const dueAt = parts.length > 2 && last && /^\d{4}-\d{2}-\d{2}/.test(last) ? last : undefined;
  return { id, dueAt };
}

/**
 * The batch less the assets already on record.
 *
 * A write that stops part-way has written some verdicts and not others. The
 * ones written are taken out of the draft so pressing Record again writes
 * only the rest, rather than a second event, a second defect and a second
 * Simpro row for every asset that was already done.
 */
export function withoutWritten(batch: Batch, written: Iterable<string>): Batch {
  const gone = new Set(written);
  if (!gone.size) return batch;
  const next: Batch = {};
  for (const [id, v] of Object.entries(batch)) if (!gone.has(id)) next[id] = v;
  return next;
}

/** What goes to the asset-test queue for one verdict. The queue decides whether it may be sent. */
export function assetTestFor(asset: AssetRecord, verdict: Verdict, testedAt: string): AssetTestToSend {
  const fromSimpro = asset.externalSource === 'simpro' && Boolean(asset.externalId);
  return {
    externalAssetId: fromSimpro ? asset.externalId : undefined,
    serviceLevelId: serviceLevelIdOf(asset),
    result: verdict.kind,
    testedAt,
    description: `${locationOf(asset)} — ${eventFor(verdict).summary}`,
  };
}

// ---------------------------------------------------------------------------
// Summary and the note to the office
// ---------------------------------------------------------------------------

export interface BatchSummary {
  passed: number;
  failed: number;
  notTested: number;
  /** Fails, in register order, ready to raise. */
  defects: { asset: AssetRecord; fail: FailDetail }[];
  /** Not-tested assets by reason, for the note. */
  notTestedByReason: { reason: string; assets: AssetRecord[] }[];
  /** Verdicts against assets no longer in the register, which cannot be written. */
  orphaned: number;
}

/** Counts, the defects to raise, and the gaps — in the register's order, not the tap order. */
export function summarise(batch: Batch, assets: readonly AssetRecord[]): BatchSummary {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out: BatchSummary = { passed: 0, failed: 0, notTested: 0, defects: [], notTestedByReason: [], orphaned: 0 };
  const reasons = new Map<string, AssetRecord[]>();

  for (const asset of assets) {
    const v = batch[asset.id];
    if (!v) continue;
    if (v.kind === 'pass') out.passed++;
    else if (v.kind === 'fail') {
      out.failed++;
      out.defects.push({ asset, fail: v.fail });
    } else {
      out.notTested++;
      const list = reasons.get(v.reason) ?? [];
      list.push(asset);
      reasons.set(v.reason, list);
    }
  }
  for (const id of Object.keys(batch)) if (!byId.has(id)) out.orphaned++;
  out.notTestedByReason = [...reasons.entries()].map(([reason, list]) => ({ reason, assets: list }));
  return out;
}

/** How many verdicts there are to write. */
export function decidedCount(batch: Batch): number {
  return Object.keys(batch).length;
}

/**
 * The note that goes on the Simpro job.
 *
 * Short, because the office reads it in a list beside forty others. Passes
 * are counted by system — nobody reads three hundred lines of "passed" —
 * and every failure gets one line of its own with its code, because a
 * failure is the thing the note exists to say. Not-tested assets are grouped
 * under their reason, so "no access" on a whole level reads as one fact.
 */
export function buildServiceNote(
  batch: Batch,
  assets: readonly AssetRecord[],
  site: { name: string },
  technician: string | undefined,
  testedAt: string,
): string {
  const s = summarise(batch, assets);
  const lines: string[] = [];
  const day = qldDay(testedAt) ?? testedAt;
  lines.push(`${site.name} — ${day}${technician ? ` — ${technician}` : ''}`);
  lines.push(`${s.passed} passed, ${s.failed} failed, ${s.notTested} not tested.`);

  if (s.passed) {
    const bySystem = new Map<string, number>();
    for (const a of assets) {
      if (batch[a.id]?.kind !== 'pass') continue;
      const label = systemLabel(a);
      bySystem.set(label, (bySystem.get(label) ?? 0) + 1);
    }
    lines.push('');
    lines.push(`Passed: ${[...bySystem.entries()].map(([label, n]) => `${n} ${label.toLowerCase()}`).join(', ')}.`);
  }

  if (s.defects.length) {
    lines.push('');
    lines.push('Failed:');
    for (const { asset, fail } of s.defects) {
      const code = fail.defectCode ?? 'no code';
      const severity = recordSeverity(fail.severity) === 'critical' ? 'CRITICAL' : fail.severity;
      lines.push(`- ${labelFor(asset)} [${code}, ${severity}]: ${firstSentence(finalWording(fail))}`);
    }
  }

  if (s.notTestedByReason.length) {
    lines.push('');
    lines.push('Not tested:');
    for (const group of s.notTestedByReason) {
      lines.push(`- ${group.reason}: ${group.assets.map(labelFor).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/** The subject line of the note. */
export function serviceNoteSubject(batch: Batch, assets: readonly AssetRecord[]): string {
  const s = summarise(batch, assets);
  return `Site test: ${s.passed} passed, ${s.failed} failed, ${s.notTested} not tested`;
}

function systemLabel(asset: Pick<AssetRecord, 'assetTypeId'>): string {
  const system = systemOf(asset);
  return system ? SYSTEM_LABELS[system] : 'Other';
}

/** The shortest name that still finds the asset: its code where it has one, else where it is. */
function labelFor(asset: AssetRecord): string {
  const tag = asset.code || (typeof asset.attributes?.['assetNumber'] === 'string' ? String(asset.attributes['assetNumber']) : undefined);
  const where = locationOf(asset);
  return tag ? `${tag} ${where}` : where;
}

function firstSentence(text: string): string {
  const m = text.match(/^[^.]*\./);
  return (m ? m[0] : text).trim();
}

// ---------------------------------------------------------------------------
// The outcome, in words
// ---------------------------------------------------------------------------

export interface RecordOutcome {
  passed: number;
  failed: number;
  notTested: number;
  defectsRaised: number;
  /** Results that went on the Simpro queue. */
  queued: number;
  /** Results that did not, by reason. */
  refused: Partial<Record<AssetTestRefusal, number>>;
  /** The Simpro job the note went to, if one was chosen. */
  noteJobId?: string;
  /** Why the note did not go, where the results did: the queue would not take it. */
  noteError?: string;
}

/** "14 passed, 3 failed (3 defects raised), 2 not tested; 17 results queued for Simpro; note queued on job 1234". */
export function describeOutcome(o: RecordOutcome): string {
  const parts: string[] = [];
  parts.push(`${o.passed} passed`);
  parts.push(`${o.failed} failed${o.defectsRaised ? ` (${o.defectsRaised} defect${o.defectsRaised === 1 ? '' : 's'} raised)` : ''}`);
  parts.push(`${o.notTested} not tested`);
  const clauses = [parts.join(', ')];
  if (o.queued) clauses.push(`${o.queued} result${o.queued === 1 ? '' : 's'} queued for Simpro`);
  if (o.noteJobId) clauses.push(`note queued on job ${o.noteJobId}`);
  if (o.noteError) clauses.push(`the note to the office did not queue (${o.noteError})`);
  return clauses.join('; ');
}

// ---------------------------------------------------------------------------
// Candidate defects
// ---------------------------------------------------------------------------

/** Words too common to tell one defect from another. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'was', 'were', 'it', 'its', 'not', 'no',
  'with', 'for', 'by', 'from', 'this', 'that', 'has', 'have', 'had', 'be', 'been', 'as', 'when', 'unit', 'found',
]);

/** A word's stem, roughly: enough that "leaking" finds "leak" and "damaged" finds "damage". */
function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(ing|ed|es|s)$/, '');
}

/**
 * Whether a query word is in a set of stems.
 *
 * Exact first. Failing that, a long enough prefix either way: the crude stem
 * above leaves "contamination" and "contaminated" as different strings, and
 * a technician typing the one should still find the code named the other.
 * Five letters, so "test" does not find "testing" in every code there is.
 */
function hit(set: Set<string>, w: string): boolean {
  if (set.has(w)) return true;
  if (w.length < 5) return false;
  for (const x of set) {
    if (x.length >= 5 && (x.startsWith(w) || w.startsWith(x))) return true;
  }
  return false;
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const w = stem(raw);
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/**
 * The library codes most likely to describe an observation, best first.
 *
 * Ranked, never chosen: the technician or the model picks from these, and the
 * ranking only decides what is at the top of the list. It is a word match
 * against the code's name, component, wording and rectification — the name
 * counts most, because "failed to discharge" in the observation and "Failed
 * to discharge" as the defect is the ordinary case — narrowed to the asset's
 * system so a detector's observation cannot turn into an extinguisher code.
 *
 * A blank observation gives the system's codes by severity, so the sheet is
 * never empty while somebody is still typing. An asset of no known system
 * searches the whole library, because it still failed.
 */
export function candidateDefects(assetTypeId: string, observation: string, limit = 6): DefectCode[] {
  const system = assetTypeById(assetTypeId)?.system;
  const pool = system ? defectsForSystem(system) : DEFECT_LIBRARY;
  const query = words(observation);

  if (!query.size) {
    return [...pool].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, limit);
  }

  const scored = pool.map((code) => {
    const name = words(code.defect);
    const component = words(code.component);
    const body = words(`${code.reportWording} ${code.rectification ?? ''}`);
    let score = 0;
    for (const w of query) {
      if (hit(name, w)) score += 3;
      if (hit(component, w)) score += 2;
      if (hit(body, w)) score += 1;
    }
    return { code, score };
  });

  const hits = scored.filter((s) => s.score > 0);
  // Nothing matched a word: the system's list by severity is still the right
  // thing to show, and better than nothing at all.
  const ranked = (hits.length ? hits : scored)
    .sort((a, b) => b.score - a.score || SEVERITY_ORDER[a.code.severity] - SEVERITY_ORDER[b.code.severity]);
  return ranked.slice(0, limit).map((s) => s.code);
}
