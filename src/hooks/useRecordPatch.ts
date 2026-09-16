import { useRef } from 'react';
import { showAlert } from '@/components/alert';
import { describeActionFailure } from '@/domain/loadFailure';

/**
 * Editing a record so that a write which fails is not silent.
 *
 * Every record screen in this app was written the same way. A field changes,
 * the new value goes on screen, and the write goes out as `void save(next)` —
 * a promise nobody holds. When it works, which is nearly always, that is
 * exactly right. When it does not — the disk is full, the row was deleted on
 * another handset, a column arrived that this build does not know about — the
 * value stays on screen and is not stored. The technician finishes the form,
 * closes it, and the form is not what they filled in. There is no message,
 * because there is nowhere for a message to come from.
 *
 * A record that quietly does not save is worse than one that refuses to. The
 * service report learned that first; this is that lesson made into something
 * the other screens can use, and a guard test in recordScreens keeps the next
 * screen from being written the old way.
 *
 * Three things it does beyond catching:
 *
 * Writes go out in order. A `Field` fires a change per keystroke, so "Level 3"
 * is five writes racing each other into SQLite; whichever resolves last wins,
 * and that is not necessarily the last one sent. Chaining them means the row
 * ends up holding what the person actually typed.
 *
 * Two edits in one tick both land. React has not re-rendered between them, so
 * a second patch built off the props alone would be built off the record as it
 * was before the first — and would quietly undo it. What has been patched
 * since the last render is kept as an overlay and thrown away as soon as a
 * fresh record arrives.
 *
 * One message per run of failures. If the disk is full, every keystroke fails,
 * and a modal per keystroke is not a warning — it is the app locking up. The
 * first failure speaks and re-reads the record; the rest are quiet until a
 * write succeeds again.
 */
export function useRecordPatch<T>({
  record,
  setRecord,
  write,
  what,
  reload,
}: {
  /** The record as it stands, or null while it is still being read. */
  record: T | null;
  /** Puts the merged record back on screen. */
  setRecord: (next: T) => void;
  /** Stores it. Given the merged record and the fields that changed. */
  write: (next: T, patch: Partial<T>) => Promise<unknown>;
  /** What the record is, in a technician's words: "assessment". */
  what: string;
  /** Re-reads the record after a failure, so the screen shows what is stored. */
  reload?: () => void | Promise<unknown>;
}): (patch: Partial<T>) => Promise<void> {
  /*
   * Every one of these is read and written from inside the returned function,
   * which only ever runs from an event handler. Nothing here is touched while
   * the component is rendering.
   */
  const builtOn = useRef<T | null>(null);
  const overlay = useRef<Partial<T>>({});
  const chain = useRef<Promise<void>>(Promise.resolve());
  const complaining = useRef(false);

  return (patch: Partial<T>) => {
    // Nothing to merge into. A screen that patches before its record has
    // loaded is asking to store a record made entirely of the patch.
    if (record === null || record === undefined) return Promise.resolve();

    if (builtOn.current !== record) {
      builtOn.current = record;
      overlay.current = {};
    }
    overlay.current = { ...overlay.current, ...patch };

    const next = { ...record, ...overlay.current };
    setRecord(next);

    const link = chain.current.then(async () => {
      try {
        await write(next, patch);
        complaining.current = false;
      } catch (e) {
        if (complaining.current) return;
        complaining.current = true;
        showAlert('Not saved', describeActionFailure(e, `saving the ${what}`));
        await reload?.();
      }
    });
    chain.current = link;
    return link;
  };
}
