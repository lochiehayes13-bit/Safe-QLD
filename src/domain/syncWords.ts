/**
 * The words on the home screen's sync strip.
 *
 * Pure, so the rules — when the strip appears at all, what a stage is called,
 * how a first sync is told apart from a routine one — are tested rather than
 * read off a phone. The component in components/SyncStrip only draws.
 */

export interface SyncStripInput {
  inFlight: boolean;
  progress: { stage: string; done: number; total: number } | null;
  trigger: string | null;
  lastError: string | null;
}

export type SyncStripWords =
  | { kind: 'running'; title: string; detail: string; fraction: number }
  | { kind: 'problem'; title: string; detail: string };

/** How much of an error to put on the home screen before it becomes a wall. */
const ERROR_CHARS = 220;

export function syncStripWords(input: SyncStripInput): SyncStripWords | null {
  if (input.inFlight) {
    const p = input.progress;
    const fraction = p && p.total > 0 ? Math.max(0, Math.min(1, p.done / p.total)) : 0;
    const title = input.trigger === 'signin'
      ? 'Fetching your jobs from the office'
      : input.trigger === 'launch' && !p
        ? 'Checking with the office'
        : 'Syncing with the office';
    const detail = p
      ? (p.total > 12 && p.done <= p.total
        // A stage with a row count: "Sites 1,225 of 3,059".
        ? `${p.stage} ${p.done.toLocaleString('en-AU')} of ${p.total.toLocaleString('en-AU')}`
        // A stage of the twelve: "Reading jobs, step 2 of 12".
        : `${p.stage}, step ${Math.min(p.done + 1, p.total)} of ${p.total}`)
      : 'Working out what is due';
    return { kind: 'running', title, detail, fraction };
  }
  if (input.lastError) {
    const trimmed = input.lastError.trim();
    const detail = trimmed.length > ERROR_CHARS ? `${trimmed.slice(0, ERROR_CHARS - 1)}…` : trimmed;
    return { kind: 'problem', title: 'The last sync hit a problem', detail };
  }
  return null;
}
