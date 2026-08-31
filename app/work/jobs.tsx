import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { listJobs, type JobRecord } from '@/db/opsRepo';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/** Job list, urgent first. */
export default function JobsScreen() {
  const t = useTheme();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [filter, setFilter] = useState<'open' | 'today' | 'all'>('open');

  const load = useCallback(async () => setJobs(await listJobs({ limit: 500 })), []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const today = new Date().toISOString().slice(0, 10);
  const shown = jobs.filter((j) => {
    if (filter === 'open') return j.status !== 'complete';
    if (filter === 'today') return j.scheduledFor?.slice(0, 10) === today;
    return true;
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Jobs' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2) }}>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'today', label: 'Today' },
              { value: 'all', label: 'All' },
            ]}
          />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            <EmptyState
              title="No jobs"
              body="Jobs sync from Simpro once it is connected in Settings, or can be added by hand."
            />
          }
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/work/job/[id]', params: { id: item.id } })}>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700" numberOfLines={1}>{item.siteName}</Txt>
                  <Txt size="sm" tone="muted" numberOfLines={1}>{item.title}</Txt>
                  {item.address ? <Txt size="sm" tone="faint" numberOfLines={1}>{item.address}</Txt> : null}
                  <Rowed gap={1.5} wrap style={{ marginTop: t.space(1.5) }}>
                    {item.priority === 'urgent' ? <Chip label="Urgent" tone="fail" /> : null}
                    {item.jobType ? <Chip label={item.jobType} /> : null}
                    {item.scheduledFor ? <Chip label={formatAuDate(item.scheduledFor)} /> : null}
                    {item.externalId ? <Chip label={`#${item.externalId}`} /> : null}
                  </Rowed>
                </View>
                <Chip
                  label={item.status === 'complete' ? 'Done' : item.status === 'in-progress' ? 'Running' : 'Scheduled'}
                  tone={item.status === 'complete' ? 'pass' : item.status === 'in-progress' ? 'warn' : 'default'}
                />
              </Rowed>
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
