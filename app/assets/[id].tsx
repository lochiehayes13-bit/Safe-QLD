import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  addAssetEvent, assetTimeline, getAsset, updateAsset,
  type AssetEvent, type AssetEventKind, type AssetRecord,
} from '@/db/assetRepo';
import { assetTypeById, SYSTEM_LABELS, type AttributeDef } from '@/seed/assetTypes';
import { getSite } from '@/db/repo';
import type { Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * Asset detail and timeline.
 *
 * The timeline is the reason this screen exists. A list of attributes tells you
 * what something is; the history tells you whether it can be trusted, and why
 * it keeps failing.
 */
const EVENT_ICON: Record<AssetEventKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  installed: 'plus-circle-outline',
  tested: 'clipboard-check-outline',
  passed: 'check-circle-outline',
  failed: 'close-circle-outline',
  cleaned: 'spray-bottle',
  repaired: 'wrench-outline',
  replaced: 'autorenew',
  isolated: 'pause-circle-outline',
  restored: 'play-circle-outline',
  'defect-raised': 'alert-circle-outline',
  'defect-cleared': 'check-decagram-outline',
  'not-tested': 'help-circle-outline',
  moved: 'map-marker-outline',
  noted: 'note-text-outline',
};

const EVENT_TONE: Partial<Record<AssetEventKind, 'pass' | 'fail' | 'warn'>> = {
  passed: 'pass',
  restored: 'pass',
  'defect-cleared': 'pass',
  failed: 'fail',
  'defect-raised': 'fail',
  isolated: 'warn',
  'not-tested': 'warn',
};

export default function AssetScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [site, setSite] = useState<Site | null>(null);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const a = await getAsset(id);
    setAsset(a);
    setMissing(!a);
    if (a) {
      const [s, e] = await Promise.all([getSite(a.siteId), assetTimeline(a.id)]);
      setSite(s);
      setEvents(e);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const record = async (kind: AssetEventKind, summary: string) => {
    if (!asset) return;
    const prefs = await loadPrefs();
    await addAssetEvent({
      assetId: asset.id,
      kind,
      occurredAt: nowIso(),
      technician: prefs.technicianName || undefined,
      summary,
    });
    // Keep the denormalised service state on the asset in step with its history.
    if (kind === 'passed' || kind === 'failed') {
      await updateAsset(asset.id, { lastServicedAt: nowIso(), lastResult: kind === 'passed' ? 'pass' : 'fail' });
    }
    void load();
  };

  if (!asset) return <RecordGate missing={missing} what="asset" />;

  const type = assetTypeById(asset.assetTypeId);
  const failures = events.filter((e) => e.kind === 'failed').length;
  const attributes: AttributeDef[] = type?.attributes ?? [];

  return (
    <>
      <Stack.Screen options={{ title: asset.name || type?.label || 'Asset' }} />
      <Screen>
        <View>
          <Txt size="xl" weight="700">{asset.name || type?.label}</Txt>
          {asset.code ? <Txt size="sm" mono tone="accent">{asset.code}</Txt> : null}
          <Txt size="sm" tone="muted">
            {[type?.label, site?.name, asset.level, asset.room].filter(Boolean).join(' · ')}
          </Txt>
        </View>

        <Rowed gap={2} wrap>
          {type ? <Chip label={SYSTEM_LABELS[type.system]} /> : null}
          <Chip
            label={asset.status}
            tone={asset.status === 'in-service' ? 'pass' : asset.status === 'isolated' ? 'warn' : 'fail'}
          />
          {asset.lastResult ? (
            <Chip label={`Last ${asset.lastResult}`} tone={asset.lastResult === 'pass' ? 'pass' : 'fail'} />
          ) : null}
          {asset.openDefects ? <Chip label={`${asset.openDefects} open defect`} tone="fail" /> : null}
        </Rowed>

        {failures >= 3 ? (
          <Banner
            tone="warn"
            title={`This has failed ${failures} times`}
            body="Repeated failure on one asset is usually the environment, the location or the device type — worth a root cause rather than another replacement."
          />
        ) : null}

        <H2>Record</H2>
        <Rowed gap={2} wrap>
          <Button title="Passed" variant="secondary" compact onPress={() => record('passed', 'Tested — passed')} />
          <Button title="Failed" variant="danger" compact onPress={() => record('failed', 'Tested — failed')} />
          <Button title="Cleaned" variant="secondary" compact onPress={() => record('cleaned', 'Cleaned')} />
          <Button title="Replaced" variant="secondary" compact onPress={() => record('replaced', 'Replaced')} />
        </Rowed>
        <Rowed gap={2}>
          <Button
            title="Raise defect"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              router.push({
                pathname: '/work/defect/new',
                params: { siteId: asset.siteId, assetId: asset.id, location: [asset.level, asset.room, asset.name].filter(Boolean).join(' ') },
              })
            }
          />
          {/*
            The timeline above says what happened at each service. This says
            what has been happening across them, which is the question a single
            reading cannot answer.
          */}
          <Button
            title="Trend"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/assets/trend', params: { id: asset.id } })}
          />
        </Rowed>

        <Rowed gap={2} align="flex-end">
          <View style={{ flex: 1 }}>
            <Field label="Add a note" value={note} onChangeText={setNote} placeholder="Anything the next person should know" />
          </View>
          <Button
            title="Add"
            compact
            disabled={!note.trim()}
            onPress={async () => { await record('noted', note.trim()); setNote(''); }}
          />
        </Rowed>

        {attributes.length ? (
          <>
            <H2>Details</H2>
            <Card>
              {attributes.map((a, i) => {
                const value = asset.attributes[a.key];
                if (value === undefined || value === '') return null;
                return (
                  <View key={a.key}>
                    {i > 0 ? <Divider /> : null}
                    <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                      <Txt size="sm" tone="muted">{a.label}</Txt>
                      <Txt size="sm" weight="600">
                        {String(value)}{a.unit ? ` ${a.unit}` : ''}
                      </Txt>
                    </Rowed>
                  </View>
                );
              })}
              {asset.manufacturer || asset.model ? (
                <>
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                    <Txt size="sm" tone="muted">Make and model</Txt>
                    <Txt size="sm" weight="600">{[asset.manufacturer, asset.model].filter(Boolean).join(' ')}</Txt>
                  </Rowed>
                </>
              ) : null}
              {asset.serial ? (
                <>
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                    <Txt size="sm" tone="muted">Serial</Txt>
                    <Txt size="sm" mono weight="600">{asset.serial}</Txt>
                  </Rowed>
                </>
              ) : null}
              {asset.installedDate ? (
                <>
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                    <Txt size="sm" tone="muted">Installed</Txt>
                    <Txt size="sm" weight="600">{formatAuDate(asset.installedDate)}</Txt>
                  </Rowed>
                </>
              ) : null}
            </Card>
          </>
        ) : null}

        <H2>History</H2>
        {events.length ? (
          <Card>
            {events.map((e, i) => (
              <View key={e.id}>
                {i > 0 ? <Divider /> : null}
                <Rowed gap={3} align="flex-start" style={{ paddingVertical: t.space(2) }}>
                  <MaterialCommunityIcons
                    name={EVENT_ICON[e.kind] ?? 'circle-small'}
                    size={18}
                    color={
                      EVENT_TONE[e.kind] === 'pass' ? t.color.pass
                      : EVENT_TONE[e.kind] === 'fail' ? t.color.fail
                      : EVENT_TONE[e.kind] === 'warn' ? t.color.warn
                      : t.color.textFaint
                    }
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Txt size="sm" weight="600">{e.summary}</Txt>
                    {e.detail ? <Txt size="xs" tone="muted" style={{ lineHeight: 18 }}>{e.detail}</Txt> : null}
                    <Txt size="xs" tone="faint">
                      {formatAuDate(e.occurredAt)}{e.technician ? ` · ${e.technician}` : ''}
                      {e.photos.length ? ` · ${e.photos.length} photo${e.photos.length === 1 ? '' : 's'}` : ''}
                    </Txt>
                  </View>
                </Rowed>
              </View>
            ))}
          </Card>
        ) : (
          <Txt tone="faint" size="sm">Nothing recorded yet. Everything done to this asset from now on lands here.</Txt>
        )}
      </Screen>
    </>
  );
}
