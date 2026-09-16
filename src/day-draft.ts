import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DaySite } from '@/domain/dayBuilder';

/**
 * The day a technician is part way through building.
 *
 * A day is built the afternoon before, between other things: pick three
 * sites, go and answer the phone, come back, add a fourth. That only works
 * if the half-built day is still there — and it was not, because the
 * builder's stops lived in React state that the screen threw away the
 * moment the technician switched to the month view or walked out to the
 * Jobs tab.
 *
 * So the draft is written to the handset as it is edited. It is not a
 * database table on purpose: it is one small thing, it belongs to this
 * handset rather than to the company, and it stops being interesting the
 * moment the day is on the schedule.
 *
 * It carries the date it was built for. A draft for last Tuesday is not
 * offered as today's work — that is how somebody books a day of visits onto
 * a day that has already been and gone.
 */

const KEY = 'safeqld.day-draft';

export interface DayDraft {
  /** The Queensland day it is for, yyyy-mm-dd. */
  date: string;
  stops: DaySite[];
  /** When it was last touched, so a stale one can be recognised. */
  savedAt: string;
}

export async function loadDayDraft(): Promise<DayDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = parsed as Partial<DayDraft>;
    if (typeof draft.date !== 'string' || !Array.isArray(draft.stops)) return null;
    return {
      date: draft.date,
      stops: draft.stops.filter((s): s is DaySite => Boolean(s && typeof s.siteId === 'string' && typeof s.siteName === 'string')),
      savedAt: typeof draft.savedAt === 'string' ? draft.savedAt : '',
    };
  } catch {
    // A draft that cannot be read is not worth a failure on a screen whose
    // job is to start a day. The technician picks the sites again.
    return null;
  }
}

export async function saveDayDraft(draft: DayDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Same reasoning: losing the draft is a nuisance, an alert mid-typing is
    // worse, and the day is still on the screen in front of them.
  }
}

export async function clearDayDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to tell anybody: the next save overwrites it anyway.
  }
}

/**
 * Whether a draft is worth offering back.
 *
 * Today's, or one for a day still to come. Yesterday's half-built day is
 * dropped rather than offered, because the only thing to do with it is
 * rebuild it against today's register anyway.
 */
export function draftIsCurrent(draft: DayDraft | null, today: string): boolean {
  return Boolean(draft && draft.stops.length && draft.date >= today);
}
