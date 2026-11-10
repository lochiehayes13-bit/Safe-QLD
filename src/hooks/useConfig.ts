import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { reopenConfig, type OpenedConfig } from '@/services/configOpen';
import { describeLoadFailure } from '@/domain/loadFailure';

/**
 * One configuration, read from the library.
 *
 * Six screens in the Explorer are about the same open configuration — its
 * devices, its zones, its logic, the container it arrived in, what it says
 * against a site, and what is wrong with it — and each is reached with nothing
 * but an id in the route. Every one of them therefore has to read the file and
 * parse it, and every one of them has to cope with the id naming nothing.
 * Written six times that is six chances to leave a spinner up for ever, which
 * is a fault this app has already had and written a guard against.
 *
 * The three states are held apart deliberately. `loading` is the moment before
 * an answer; `failed` is a read that threw; and a finished load with no
 * `opened` is a config that is not there. The middle one is the one that gets
 * collapsed, and collapsing it tells a technician their file was deleted when
 * in fact the database would not open.
 */
export interface ConfigState {
  opened?: OpenedConfig;
  loading: boolean;
  failed: string | null;
  /** True once a load has finished and found nothing under that id. */
  missing: boolean;
  reload: () => void;
}

export function useConfig(id: string | undefined): ConfigState {
  const [opened, setOpened] = useState<OpenedConfig>();
  const [loading, setLoading] = useState(Boolean(id));
  const [failed, setFailed] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(null);
    try {
      const found = await reopenConfig(id);
      setOpened(found);
      setMissing(!found);
    } catch (e) {
      // The parse is inside `reopenConfig` and catches its own failures, so
      // anything reaching here is the database rather than the file. Said as
      // such: "the configuration could not be read" would send a technician to
      // fetch the file again for no reason.
      setOpened(undefined);
      setMissing(false);
      setFailed(describeLoadFailure(e, 'this configuration'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return { opened, loading, failed, missing, reload: () => { void load(); } };
}
