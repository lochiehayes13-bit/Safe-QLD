import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getSite, listDefects, reopenDefect, updateDefect } from '@/db/repo';
import { nowIso } from '@/db';
import type { Defect, Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { defectSheet } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/** Defects for one site. */
export default function SiteDefectsScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState(false);

  // An empty list under "Nothing outstanding here" is a compliance statement
  // about the site, so a read that threw says so instead of making it.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    setFailed(null);
    try {
      const [s, d] = await Promise.all([getSite(siteId), listDefects(siteId)]);
      setSite(s);
      setDefects(d);
    } catch (e) {
      setDefects([]);
      setFailed(describeLoadFailure(e, "this site's defects"));
    }
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
    showAlert(
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
    showAlert('Reopen this defect?', 'It goes back to open and the rectification date is cleared.', [
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
    // The button is always on screen, so an empty list used to make it do
    // nothing at all — press, no spinner, no sheet, no word.
    if (!shown.length) {
      showAlert(
        'Nothing to export',
        status === 'open'
          ? 'There are no open defects at this site. Switch to All if you want the ones already cleared.'
          : 'No defects have been recorded at this site yet.',
      );
      return;
    }
    setBusy(true);
    try {
      const file = writeXlsx(`Defects - ${site?.name ?? 'Site'}`, [defectSheet(shown)]);
      const shared = await shareFile(file, 'Defect list');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'spreadsheet');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not export', describeActionFailure(e, 'export this defect list'));
    } finally {
      setBusy(false);
    }
  };

  if (!siteId) return <ContextGate kind="site" what="the defects raised" title="Defects" />;

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
          {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
        </View>

        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            failed ? null : (
              <EmptyState
                title={status === 'open' ? 'Nothing outstanding here' : 'No defects recorded'}
                body="Defects raised on this site appear here until they are cleared."
              />
            )
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
