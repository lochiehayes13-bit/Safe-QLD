import React, { useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getJob, setJobStatus, listPromises, type JobRecord } from '@/db/opsRepo';
import { getSite, listDefects } from '@/db/repo';
import { assetCountsBySystem } from '@/db/assetRepo';
import { listKnowledge, type KnowledgeNote } from '@/db/opsRepo';
import type { Defect, Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, H2, Label, Rowed, Screen, StatTile, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * Job detail — the site briefing.
 *
 * Everything shown here answers "what should I know before I walk in": what is
 * already broken, what the last person found, how many assets there are. That
 * is the difference between arriving informed and arriving cold.
 */
export default function JobScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<JobRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [knowledge, setKnowledge] = useState<KnowledgeNote[]>([]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const j = await getJob(id);
      setJob(j);
      setMissing(!j);
      if (j?.siteId) {
        const [s, d, a, k] = await Promise.all([
          getSite(j.siteId),
          listDefects(j.siteId, 'open'),
          // A count, not the rows: the briefing wants a number.
          assetCountsBySystem(j.siteId),
          listKnowledge({ siteId: j.siteId }),
        ]);
        setSite(s); setDefects(d); setAssetCount(a.reduce((n, x) => n + x.count, 0)); setKnowledge(k);
      }
    })();
  }, [id]);

  if (!job) return <RecordGate missing={missing} what="job" />;

  const critical = defects.filter((d) => d.severity === 'critical');

  return (
    <>
      <Stack.Screen options={{ title: job.siteName }} />
      <Screen>
        <Txt size="xl" weight="700">{job.title}</Txt>
        {job.customerName ? <Txt tone="muted">{job.customerName}</Txt> : null}
        {job.address ? (
          <Rowed gap={2}>
            <MaterialCommunityIcons name="map-marker-outline" size={16} color={t.color.textFaint} />
            <Txt size="sm" tone="muted" style={{ flex: 1 }}>{job.address}</Txt>
            <Button
              title="Directions"
              variant="ghost"
              compact
              onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(job.address!)}`)}
            />
          </Rowed>
        ) : null}

        <Rowed gap={2}>
          <StatTile label="Assets" value={assetCount} />
          <StatTile label="Open defects" value={defects.length} tone={critical.length ? 'fail' : 'default'} />
          <StatTile label="Critical" value={critical.length} tone={critical.length ? 'fail' : 'default'} />
        </Rowed>

        {knowledge.length ? (
          <Card>
            <Label>You should know about this site</Label>
            <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
              {knowledge.slice(0, 4).map((k) => (
                <View key={k.id}>
                  <Rowed gap={2}>
                    <MaterialCommunityIcons
                      name={k.status === 'verified' || k.status === 'manufacturer-confirmed' ? 'check-decagram' : 'information-outline'}
                      size={15}
                      color={k.status === 'unverified' ? t.color.warn : t.color.pass}
                    />
                    <Txt size="sm" weight="600" style={{ flex: 1 }}>{k.title}</Txt>
                  </Rowed>
                  {k.body ? <Txt size="sm" tone="muted" style={{ marginLeft: 23, lineHeight: 19 }}>{k.body}</Txt> : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {critical.length ? (
          <Banner
            tone="fail"
            title={`${critical.length} critical defect${critical.length === 1 ? '' : 's'} already open here`}
            body={critical.slice(0, 3).map((d) => `${d.location}: ${d.description.slice(0, 90)}`).join('\n')}
          />
        ) : null}

        <H2>Do</H2>
        {job.status !== 'in-progress' && job.status !== 'complete' ? (
          <Button
            title="Start job"
            onPress={async () => { await setJobStatus(job.id, 'in-progress'); setJob({ ...job, status: 'in-progress' }); }}
          />
        ) : null}
        {job.status === 'in-progress' ? (
          <Button
            title="Mark complete"
            onPress={() => {
              Alert.alert('Complete this job?', 'Check the test sheet, defects and photos are done first — anything missing is harder to add later.', [
                { text: 'Not yet', style: 'cancel' },
                {
                  text: 'Complete',
                  onPress: async () => { await setJobStatus(job.id, 'complete'); setJob({ ...job, status: 'complete' }); },
                },
              ]);
            }}
          />
        ) : null}

        <Rowed gap={2}>
          <Button
            title="Raise defect"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/work/defect/new', params: { siteId: job.siteId ?? '' } })}
          />
          {job.siteId ? (
            <Button
              title="Open site"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/site/[id]', params: { id: job.siteId! } })}
            />
          ) : null}
        </Rowed>

        {job.notes ? (
          <>
            <H2>Notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.notes}</Txt></Card>
          </>
        ) : null}

        <Txt size="xs" tone="faint">
          {job.externalId ? `Simpro job ${job.externalId} · ` : ''}
          {job.scheduledFor ? `Scheduled ${formatAuDate(job.scheduledFor)}` : 'Not scheduled'}
        </Txt>
      </Screen>
    </>
  );
}
