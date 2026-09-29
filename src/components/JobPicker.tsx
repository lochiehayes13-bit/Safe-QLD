import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { searchJobPicks, type JobPick } from '@/db/opsRepo';
import { describeLoadFailure } from '@/domain/loadFailure';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Rowed, SearchBox, Txt } from '@/components/ui';

/**
 * Which job.
 *
 * A list to start from — usually what is booked to this technician today,
 * because that is what they are almost always picking — and behind it a search
 * over every job the phone holds, by number, site, customer, order number or
 * title. It runs against SQLite and nothing else, so it works in a basement.
 *
 * This was written once in the clock screen and then copied, verbatim, into
 * the schedule screen; the copy carries a comment saying as much and asking
 * whether it should be shared. The SWMS builder would have been the fourth,
 * so it is shared now. The two lines that differ between screens — the
 * heading, and what to say when the starting list is empty — are props.
 *
 * The three screens that hold their own copy are left alone for now. Two are
 * this component with different words and would collapse into it; the
 * timesheet's is a different thing, a full-screen sheet that merges the
 * device search with the jobs off recent timesheets, and folding that in here
 * would make this worse rather than better.
 */
export function JobPicker({
  heading = 'Which job?',
  suggested,
  suggestedLabel,
  emptyWhenNoneSuggested,
  emptyWhenNothingOnDevice,
  busy = false,
  onPick,
  onClose,
}: {
  heading?: string;
  /** The list shown before anybody searches. */
  suggested: JobPick[];
  /** What that list is, in the trade's words: "Booked to you today". */
  suggestedLabel: string;
  /** When the suggested list is empty but the phone does hold jobs. */
  emptyWhenNoneSuggested: string;
  /** When the phone holds no jobs at all — a different problem with a different fix. */
  emptyWhenNothingOnDevice: string;
  /** True while the caller is acting on a pick, so a second tap does nothing. */
  busy?: boolean;
  onPick: (job: JobPick) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<JobPick[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  const [onDevice, setOnDevice] = useState<number | null>(null);

  // "No match" and "no jobs on this phone" read the same on screen and have
  // completely different answers, so the count is fetched once rather than
  // inferred from an empty list.
  useEffect(() => {
    let live = true;
    void searchJobPicks('', 1)
      .then((rows) => { if (live) setOnDevice(rows.length); })
      .catch(() => { if (live) setOnDevice(null); });
    return () => { live = false; };
  }, []);

  // A search per keystroke would fight the keyboard, and one that lands after
  // the next would show the wrong answer: wait for a pause, drop a stale reply.
  useEffect(() => {
    const typed = q.trim();
    let current = true;
    const timer = setTimeout(() => {
      if (!current) return;
      // Clearing the box goes through the same delay as typing into it, so
      // nothing here runs while the effect body does — and the list does not
      // flash back to the suggestions between two keystrokes.
      if (!typed) { setFound(null); setSearching(false); setSearchFailed(null); return; }
      void (async () => {
        setSearching(true);
        setSearchFailed(null);
        try {
          const rows = await searchJobPicks(typed, 40);
          if (current) setFound(rows.filter((r) => r.externalId));
        } catch (e) {
          if (current) { setFound([]); setSearchFailed(describeLoadFailure(e, 'the job search')); }
        } finally {
          if (current) setSearching(false);
        }
      })();
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [q]);

  const list = found ?? suggested;
  const nothingAnywhere = onDevice === 0;

  return (
    <Card>
      <Rowed gap={2} style={{ justifyContent: 'space-between' }}>
        <Txt weight="700">{heading}</Txt>
        <Button title="Close" variant="ghost" compact onPress={onClose} />
      </Rowed>
      <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
        <SearchBox value={q} onChange={setQ} placeholder="Job number, site or customer" />
        {searching ? <Txt size="sm" tone="muted">Looking…</Txt> : null}
        {searchFailed ? <Banner tone="fail" title="The search could not run" body={searchFailed} /> : null}
        {!found && suggested.length ? <Txt size="sm" tone="muted">{suggestedLabel}</Txt> : null}
        {!found && !suggested.length ? (
          <Txt size="sm" tone="muted">
            {nothingAnywhere ? emptyWhenNothingOnDevice : emptyWhenNoneSuggested}
          </Txt>
        ) : null}
        {found && !found.length && !searching && !searchFailed ? (
          <Txt size="sm" tone="muted">
            {nothingAnywhere ? emptyWhenNothingOnDevice : 'No job matches that.'}
          </Txt>
        ) : null}
        {list.map((job) => (
          <Card key={job.externalId ?? job.siteName ?? ''} onPress={busy ? undefined : () => onPick(job)}>
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <Txt weight="600">Job {job.externalId}{job.siteName ? ` · ${job.siteName}` : ''}</Txt>
                <Txt size="sm" tone="muted" numberOfLines={1}>
                  {[job.customerName, job.title].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
            </Rowed>
          </Card>
        ))}
      </View>
    </Card>
  );
}
