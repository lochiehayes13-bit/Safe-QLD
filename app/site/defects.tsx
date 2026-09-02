import React, { useCallback, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getSite, listDefects, reopenDefect, updateDefect } from '@/db/repo';
import { nowIso } from '@/db';
import type { Defect, Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { defectSheet } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/** Defects for one site. */
export default function SiteDefectsScreen() {
  const t = useTheme();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const [s, d] = await Promise.all([getSite(siteId), listDefects(siteId)]);
    setSite(s);
    setDefects(d);
  }, [siteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = defects.filter((d) => (status === 'open' ? d.status === 'open' : true));

  /*
   * Rectified is a statutory fact, not a tidy-up. The date it stamps is what
   * the occupier statement and a critical defect notice read back, so one tap
   * on the wrong row used to put a rectification date on a defect nobody had
   * touched, with no way back. It asks now, and a slip can be reopened.
   */
  const markRectified = (d: Defect) => {
    Alert.alert(
      'Mark this defect rectified?',
      `${d.location}\n\nThis records today as the rectification date, which the occupier statement and any critical defect notice read back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rectified',
          onPress: () => {
            void (async () => {
              await updateDefect(d.id, { status: 'rectified', rectifiedAt: nowIso() });
              void load();
            })();
          },
        },
      ],
    );
  };

  const reopen = (d: Defect) => {
    Alert.alert('Reopen this defect?', 'It goes back to open and the rectification date is cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reopen',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await reopenDefect(d.id);
            void load();
          })();
        },
      },
    ]);
  };

  const exportList = async () => {
    if (!shown.length) return;
    setBusy(true);
    try {
      const file = writeXlsx(`Defects - ${site?.name ?? 'Site'}`, [defectSheet(shown)]);
      await shareFile(file, 'Defect list');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: site ? `${site.name} — defects` : 'Defects' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2) }}>
          <Segmented value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
          <Rowed gap={2}>
            <Button
              title="Raise defect"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/work/defect/new', params: { siteId: siteId ?? '' } })}
            />
            <Button title="Export" variant="secondary" style={{ flex: 1 }} onPress={exportList} loading={busy} />
          </Rowed>
        </View>

        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            <EmptyState
              title={status === 'open' ? 'Nothing outstanding here' : 'No defects recorded'}
              body="Defects raised on this site appear here until they are cleared."
            />
          }
          renderItem={({ item }) => (
            <Card>
              <Rowed gap={2} wrap>
                <Chip label={item.severity === 'critical' ? 'CRITICAL' : 'Non-critical'} tone={item.severity === 'critical' ? 'fail' : 'warn'} />
                <Chip label={item.status} tone={item.status === 'open' ? 'default' : 'pass'} />
                {item.photos.length ? <Chip label={`${item.photos.length} photo`} /> : null}
              </Rowed>
              <Txt weight="700" style={{ marginTop: t.space(1.5) }}>{item.location}</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{item.description}</Txt>
              <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>Raised {formatAuDate(item.raisedAt)}</Txt>
              {item.status === 'open' ? (
                <Button
                  title="Mark rectified"
                  variant="secondary"
                  compact
                  style={{ marginTop: t.space(2.5) }}
                  onPress={() => markRectified(item)}
                />
              ) : item.status === 'rectified' ? (
                <Button
                  title="Reopen"
                  variant="ghost"
                  compact
                  style={{ marginTop: t.space(2.5) }}
                  onPress={() => reopen(item)}
                />
              ) : null}
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
