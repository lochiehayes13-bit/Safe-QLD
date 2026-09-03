import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { listJobSummaries, type JobSummary } from '@/db/opsRepo';
import { getCustomer, listJobsFor, scheduledJobExternalIds } from '@/db/mirrorRepo';
import { getSite } from '@/db/repo';
import {
  applyJobFilter, jobStatusWord, localStateWord, stageLabel, statusSwatch, type JobListFilter,
} from '@/domain/jobPresentation';
import { whoseSchedule, type WhoseSchedule } from '@/domain/myDay';
import { qldIsoDay } from '@/domain/qldTime';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Reveal } from '@/components/motion';
import { Card, Chip, EmptyState, Rowed, Screen, SearchBox, Segmented, Txt } from '@/components/ui';

/**
 * The job list.
 *
 * Every job the office has is on the phone now, which is four and a half
 * thousand rows, so the list is only useful with a way in: a filter for the
 * open work, for what is booked to this person, for today, and a search that
 * takes a job number, a site or a customer as typed. Opened from a site or
 * a customer it shows only theirs.
 *
 * Each row carries the office's own status, coloured with the office's own
 * colour — the same dot the scheduler is looking at on their screen when
 * they ring.
 */
export default function JobsScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; customerId?: string }>();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [filter, setFilter] = useState<JobListFilter>('open');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState<WhoseSchedule | null>(null);
  const [scheduledToday, setScheduledToday] = useState<ReadonlySet<string>>(new Set());
  const [scope, setScope] = useState<string | undefined>(undefined);

  const today = qldIsoDay(nowIso()) ?? '';

  const load = useCallback(async () => {
    const prefs = await loadPrefs();
    setWho(whoseSchedule(prefs));
    // Today is the schedule's word, for everyone: a block on today's schedule
    // is today's work whatever the job's own dates say.
    setScheduledToday(new Set(await scheduledJobExternalIds({ from: today, to: today })));
    if (params.siteId) {
      const [rows, site] = await Promise.all([listJobsFor({ siteId: params.siteId, limit: 2000 }), getSite(params.siteId)]);
      setJobs(rows);
      setScope(site ? `at ${site.name}` : 'at this site');
    } else if (params.customerId) {
      const [rows, customer] = await Promise.all([
        listJobsFor({ customerExternalId: params.customerId, limit: 2000 }),
        getCustomer(params.customerId),
      ]);
      setJobs(rows);
      setScope(customer ? `for ${customer.name}` : 'for this customer');
    } else {
      // Every job, re-read on every focus, because a status set on site in
      // the job screen has to show here when the technician backs out. The
      // whole set is what keeps the search and the "N of M" line instant;
      // read as the list-shaped projection, since the row and the filter
      // never look at the description, the notes or the JSON columns.
      setJobs(await listJobSummaries({ limit: 6000 }));
      setScope(undefined);
    }
  }, [params.siteId, params.customerId, today]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(
    () => applyJobFilter(jobs ?? [], { filter, today, who, scheduledToday, query }),
    [jobs, filter, today, who, scheduledToday, query],
  );

  const empty = (() => {
    if (jobs === null) return null;
    if (!jobs.length) {
      return {
        title: scope ? `No jobs ${scope}` : 'No jobs on this phone yet',
        body: 'Jobs come from Simpro. Connect it in Settings and sync, and every job on the books is here — or add one by hand.',
      };
    }
    if (query.trim()) return { title: 'Nothing matches', body: 'Try the job number on its own, or part of the site or customer name.' };
    if (filter === 'mine' && !who) {
      return { title: 'This phone does not know whose it is', body: 'Pick yourself in Who you are, or sign in with your Simpro login, and the jobs booked to you show up here.' };
    }
    if (filter === 'mine') return { title: 'Nothing booked to you', body: `No open job lists ${who!.label} as a technician. Today's schedule is on My day.` };
    if (filter === 'today') return { title: 'Nothing on today', body: scheduledToday.size ? 'The schedule has nothing for today that matches.' : 'The schedule has nothing for today, or has not synced yet.' };
    if (filter === 'open') return { title: 'Nothing open', body: 'Every job the phone holds is complete, invoiced or archived at the office, or has been completed on this phone.' };
    return { title: 'No jobs', body: '' };
  })();

  return (
    <>
      <Stack.Screen options={{ title: scope ? `Jobs ${scope}` : 'Jobs' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <SearchBox value={query} onChange={setQuery} placeholder="Job number, site or customer" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'mine', label: 'Mine' },
              { value: 'today', label: 'Today' },
              { value: 'all', label: 'All' },
            ]}
          />
          {jobs ? (
            <Txt size="xs" tone="faint">
              {shown.length.toLocaleString()} of {jobs.length.toLocaleString()} job{jobs.length === 1 ? '' : 's'}
            </Txt>
          ) : null}
        </View>
        <FlatList
          data={shown}
          keyExtractor={(j) => j.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={empty ? <EmptyState title={empty.title} body={empty.body} icon="clipboard-list-outline" /> : null}
          renderItem={({ item, index }) => {
            const row = <JobRow job={item} />;
            // The first screenful arrives as a cascade; past it nobody is
            // watching the animation, they are scrolling.
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

function JobRow({ job }: { job: JobSummary }) {
  const t = useTheme();
  const status = jobStatusWord(job);
  const swatch = statusSwatch(job.statusColor, t.color.surface);
  const stage = stageLabel(job.stageRaw ?? job.stage);
  const tone = { pass: t.color.pass, fail: t.color.fail, warn: t.color.warn, info: t.color.info, muted: t.color.textMuted }[status.tone];
  // What the phone did that the office's word does not say — started or
  // completed here — so a job the technician just finished is recognisable
  // under All rather than reading as merely issued.
  const local = localStateWord(job);
  // The office's completion day where it has one; the phone's completion
  // where the office has not caught up yet, so a job completed here says so.
  const done = job.completedDate ?? (job.status === 'complete' ? job.completedAt : undefined);
  const date = job.dueAt && job.status !== 'complete'
    ? `Due ${formatAuDate(job.dueAt)}`
    : done
      ? `Done ${formatAuDate(done)}`
      : job.scheduledFor ? `${job.externalId ? 'Issued' : 'Scheduled'} ${formatAuDate(job.scheduledFor)}` : undefined;
  return (
    <Card onPress={() => router.push({ pathname: '/work/job/[id]', params: { id: job.id } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1 }}>
          <Rowed gap={1.5}>
            <View
              style={{
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: swatch?.fill ?? tone,
                borderWidth: swatch?.outlined ? StyleSheet.hairlineWidth : 0, borderColor: t.color.textMuted,
              }}
            />
            <Txt size="xs" weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{status.label}</Txt>
            {stage && stage !== status.label ? <Txt size="xs" tone="muted">· {stage}</Txt> : null}
            {job.externalId ? <Txt size="xs" tone="faint" mono>· #{job.externalId}</Txt> : null}
          </Rowed>
          <Txt weight="700" numberOfLines={1} style={{ marginTop: 3 }}>{job.siteName}</Txt>
          <Txt size="sm" tone="muted" numberOfLines={1}>{job.title}</Txt>
          {job.customerName ? <Txt size="sm" tone="faint" numberOfLines={1}>{job.customerName}</Txt> : null}
          {local ? (
            <Rowed gap={1.5} style={{ marginTop: 6 }}>
              <Chip label={local.label} tone={local.tone === 'muted' || local.tone === 'info' ? 'default' : local.tone} />
            </Rowed>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {date ? <Txt size="xs" tone={job.dueAt && job.status !== 'complete' ? 'warn' : 'muted'} weight="700">{date}</Txt> : null}
          {job.priority === 'urgent' ? <Txt size="xs" tone="fail" weight="800">URGENT</Txt> : null}
          {job.jobTypeRaw ?? job.jobType ? <Txt size="xs" tone="faint">{job.jobTypeRaw ?? job.jobType}</Txt> : null}
        </View>
      </Rowed>
    </Card>
  );
}
