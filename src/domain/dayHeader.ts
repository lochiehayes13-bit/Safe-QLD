import { relativeQldTime } from './jobPresentation';
import type { WhoseSchedule } from './myDay';

/**
 * The words at the top of My day and Today's run: whose day it is, and how
 * fresh the office's schedule on this phone is.
 *
 * The person's name, not "Name (employee 123)". The employee number is the
 * key the schedule is matched on and means nothing to the person reading it,
 * so it only shows where there is no name to show instead.
 */
export function whoName(who: WhoseSchedule, technicianName: string): string {
  if (who.by === 'name') return who.staffName.trim();
  return technicianName.trim() || `Employee ${who.staffId}`;
}

/** "Synced 5 min ago", "Synced yesterday 16:10", or "Not synced yet". */
export function syncedLine(syncedAt: string | undefined, nowIso: string): string {
  const when = syncedAt ? relativeQldTime(syncedAt, nowIso) : '';
  if (!when) return 'Not synced yet';
  return `Synced ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}
