import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useConfig } from '@/hooks/useConfig';
import {
  addressLabel, deviceBreakdown, filterPoints, inPanelOrder, loopNumbers, typesPresent,
  type ConfigPoint,
} from '@/domain/configBrowse';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { contextId } from '@/domain/screenContext';
import { pointSheet } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, Rowed, Screen, SearchBox, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { RecordGate } from '@/components/RecordGate';
import { describeActionFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import type { DeviceType } from '@/domain/types';

/**
 * Every device in a configuration that has not been imported.
 *
 * The same job as the site point browser and a different source: these points
 * are in memory, read out of a file, and nothing about them is in the
 * database. So the filtering is arithmetic rather than SQL, and it lives in
 * `@/domain/configBrowse` where it can be tested.
 *
 * Spares are hidden by default, the way a panel presents itself, with a toggle
 * because commissioning work is exactly the case where the empty addresses
 * matter.
 */
export default function ConfigPointsScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = contextId(params.id);
  const { opened, failed, missing, reload } = useConfig(id);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [panelIndex, setPanelIndex] = useState(0);
  const [loop, setLoop] = useState<number | undefined>();
  const [type, setType] = useState<DeviceType | undefined>();
  const [includeUnused, setIncludeUnused] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Debounced so typing stays smooth on a configuration with thousands of
  // devices in it, which is the size these actually come in.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 180);
    return () => clearTimeout(handle);
  }, [search]);

  const panels = opened?.parsed?.panels ?? [];
  const panel = panels[Math.min(panelIndex, Math.max(0, panels.length - 1))];

  const rows = useMemo(() => {
    if (!panel) return [];
    return inPanelOrder(filterPoints(panel.points, {
      text: debounced, loop, type, includeUnused,
    }));
  }, [panel, debounced, loop, type, includeUnused]);

  const loops = useMemo(() => (panel ? loopNumbers(panel.points) : []), [panel]);
  const types = useMemo(() => (panel ? typesPresent(panel.points) : []), [panel]);
  const breakdown = useMemo(() => (panel ? deviceBreakdown(panel.points, includeUnused) : []), [panel, includeUnused]);

  /**
   * Hands the list to a spreadsheet, which is what a technician does with it.
   *
   * Built from the filtered list rather than the whole panel: somebody who has
   * narrowed to loop 2's call points wants loop 2's call points, and an export
   * that quietly widens back to everything is a file they have to filter again.
   */
  const exportList = async () => {
    if (!panel || !opened?.record) return;
    setExporting(true);
    try {
      const sheet = pointSheet({ name: panel.name || 'Panel' }, rows);
      const name = `${opened.record.fileName.replace(/\.[^.]+$/, '')} devices`;
      const file = writeXlsx(name, [sheet]);
      if (!(await shareFile(file, 'Export device list'))) {
        const notice = notSharedNotice(file.name, 'spreadsheet');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not make the spreadsheet', describeActionFailure(e, 'export this device list'));
    } finally {
      setExporting(false);
    }
  };

  if (!id) return <ContextGate kind="configuration" what="the devices in it" title="Devices" />;
  if (!opened) {
    return (
      <RecordGate
        missing={missing}
        what="configuration"
        why="It may have been removed from this phone."
        failed={failed}
        onRetry={reload}
      />
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: 'Devices' }} />

      <View style={{ gap: t.space(2) }}>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Text, zone, what it is, or 1/34"
        />

        {panels.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            {panels.map((p, i) => (
              <Chip
                key={`${p.name}-${i}`}
                label={p.name || `Panel ${i + 1}`}
                selected={i === panelIndex}
                onPress={() => { setPanelIndex(i); setLoop(undefined); setType(undefined); }}
              />
            ))}
          </ScrollView>
        ) : null}

        {loops.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            <Chip label="All loops" selected={loop === undefined} onPress={() => setLoop(undefined)} />
            {loops.map((n) => (
              <Chip key={n} label={`Loop ${n}`} selected={loop === n} onPress={() => setLoop(n)} />
            ))}
          </ScrollView>
        ) : null}

        {types.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            <Chip label="Everything" selected={type === undefined} onPress={() => setType(undefined)} />
            {types.map((d) => (
              <Chip
                key={d}
                label={DEVICE_TYPE_LABEL[d] ?? d}
                selected={type === d}
                onPress={() => setType(type === d ? undefined : d)}
              />
            ))}
          </ScrollView>
        ) : null}

        <Rowed gap={2} wrap>
          <Chip
            label={includeUnused ? 'Spares shown' : 'Spares hidden'}
            selected={includeUnused}
            onPress={() => setIncludeUnused((v) => !v)}
          />
          <Txt size="xs" tone="faint" style={{ flex: 1 }}>
            {`${rows.length.toLocaleString()} of ${(panel?.points.length ?? 0).toLocaleString()}`}
          </Txt>
          {rows.length ? (
            <Button
              title="Spreadsheet"
              variant="ghost"
              compact
              loading={exporting}
              onPress={() => { void exportList(); }}
              icon={<MaterialCommunityIcons name="file-excel-outline" size={16} color={t.color.accentText} />}
            />
          ) : null}
        </Rowed>
      </View>

      {opened.unreadable ? (
        <View style={{ marginTop: t.space(3) }}>
          <Banner tone="warn" title="This build could not read the contents" body={opened.unreadable} />
        </View>
      ) : null}

      {!rows.length ? (
        <EmptyState
          icon="text-box-search-outline"
          title={debounced || loop !== undefined || type ? 'Nothing matches' : 'No devices in this file'}
          body={
            debounced || loop !== undefined || type
              ? 'Try fewer words, or clear the loop and type filters above.'
              : 'The reader found no devices. Inside the file shows what is actually in it.'
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p, i) => `${p.pointRef ?? ''}-${p.loopNumber ?? ''}-${p.address ?? ''}-${p.subAddress ?? ''}-${i}`}
          style={{ marginTop: t.space(3) }}
          contentContainerStyle={{ paddingBottom: t.space(28), gap: t.space(2) }}
          ListHeaderComponent={breakdown.length > 1 ? (
            <Rowed gap={2} wrap style={{ marginBottom: t.space(1) }}>
              {breakdown.slice(0, 6).map((d) => (
                <Chip key={d.type} label={`${d.count} × ${d.label.toLowerCase()}`} />
              ))}
            </Rowed>
          ) : null}
          renderItem={({ item }) => <PointRow point={item} />}
        />
      )}
    </Screen>
  );
}

function PointRow({ point }: { point: ConfigPoint }) {
  const t = useTheme();
  const where = addressLabel(point);
  return (
    <Card>
      <Rowed gap={2}>
        <Txt weight="700" style={{ flex: 1 }} numberOfLines={2}>
          {point.text.trim() || <Txt tone="faint" weight="700">(no device text)</Txt>}
        </Txt>
        {point.unused ? <Chip label="Spare" tone="muted" /> : null}
      </Rowed>
      {point.text2?.trim() ? (
        <Txt size="sm" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>{point.text2.trim()}</Txt>
      ) : null}
      <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>
        {[
          where,
          DEVICE_TYPE_LABEL[point.deviceType] ?? point.deviceType,
          point.zoneNumber !== undefined
            ? `zone ${point.zoneNumber}${point.zoneText?.trim() ? ` — ${point.zoneText.trim()}` : ''}`
            : undefined,
          point.deviceTypeRaw?.trim() && point.deviceType === 'unknown' ? point.deviceTypeRaw.trim() : undefined,
        ].filter(Boolean).join(' · ')}
      </Txt>
    </Card>
  );
}
