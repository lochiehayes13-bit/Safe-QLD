import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSite, listPanels, queryPoints } from '@/db/repo';
import type { DeviceType, Panel, Point, Site } from '@/domain/types';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { pointSheet } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { useTheme } from '@/theme';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { Banner, Button, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/**
 * Point browser.
 *
 * Zone text is shown on every row rather than only on a zone screen — that is
 * what lets a tech confirm zone allocation at a glance, which is the single
 * most common reason for opening a config on site.
 *
 * Unused points are hidden by default, matching how panels present themselves,
 * with a toggle because commissioning work needs to see them.
 */
export default function PointsScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; panelId?: string }>();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(params.siteId);
  const panelId = contextId(params.panelId);

  const [site, setSite] = useState<Site | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [includeUnused, setIncludeUnused] = useState(false);
  const [loopFilter, setLoopFilter] = useState<number | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<DeviceType | undefined>(undefined);
  const [activePanel, setActivePanel] = useState<string | undefined>(panelId);
  const [exporting, setExporting] = useState(false);
  // A read that threw used to leave "No points" on screen, which reads as a
  // site with nothing imported rather than a read that did not happen.
  const [failed, setFailed] = useState<string | null>(null);

  // Debounce so typing stays smooth on a site with tens of thousands of points.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(search), 180);
    return () => clearTimeout(h);
  }, [search]);

  useEffect(() => {
    if (!siteId) return;
    void Promise.all([getSite(siteId), listPanels(siteId)])
      .then(([s, p]) => { setSite(s); setPanels(p); })
      .catch((e: unknown) => setFailed(describeLoadFailure(e, 'this site')));
  }, [siteId]);

  /*
   * A counter, so an older answer cannot land on top of a newer one.
   *
   * Typing in the search box starts a read of up to twenty thousand points
   * every 180 ms, and nothing was stopping the read for "FI" finishing after
   * the read for "FIP" and putting its rows on screen. On a large site that is
   * a list that does not match what is in the box — the technician deletes a
   * character to make it work and gets a different wrong list. Each read takes
   * a ticket and only the newest one is allowed to write.
   */
  const readSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++readSeq.current;
    setLoading(true);
    setFailed(null);
    try {
      const rows = await queryPoints({
        siteId: activePanel ? undefined : siteId,
        panelId: activePanel,
        search: debounced,
        includeUnused,
        loopNumber: loopFilter,
        deviceType: typeFilter,
        limit: 20000,
      });
      if (seq !== readSeq.current) return;
      setPoints(rows);
    } catch (e) {
      if (seq !== readSeq.current) return;
      setPoints([]);
      setFailed(describeLoadFailure(e, 'the points on this site'));
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  }, [siteId, activePanel, debounced, includeUnused, loopFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loops = useMemo(() => {
    const set = new Set<number>();
    for (const p of points) if (p.loopNumber !== undefined && p.loopNumber !== null) set.add(p.loopNumber);
    return [...set].sort((a, b) => a - b);
  }, [points]);

  const types = useMemo(() => {
    const counts = new Map<DeviceType, number>();
    for (const p of points) counts.set(p.deviceType, (counts.get(p.deviceType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [points]);

  const exportList = async () => {
    // Always on screen next to the count, so it has to answer for a count of
    // zero rather than swallowing the press.
    if (!points.length) {
      showAlert(
        'Nothing to export',
        debounced
          ? 'Nothing matches that search, so there are no rows to put in a spreadsheet. Clear the search first.'
          : 'This site has no points yet. Import a device list from the panel, and they will be here.',
      );
      return;
    }
    setExporting(true);
    try {
      const panel = panels.find((p) => p.id === activePanel) ?? panels[0];
      const name = `${site?.name ?? 'Site'} points`;
      const file = writeXlsx(name, [
        pointSheet(panel ?? ({ id: '', siteId: '', name: 'Points', brand: 'other', source: 'manual', createdAt: '', updatedAt: '' } as Panel), points),
      ]);
      const shared = await shareFile(file, 'Export point list');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'spreadsheet');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not export', describeActionFailure(e, 'export this point list'));
    } finally {
      setExporting(false);
    }
  };

  if (!siteId) return <ContextGate kind="site" what="every point on the panels" title="Points" />;

  return (
    <>
      <Stack.Screen options={{ title: site ? `${site.name} — points` : 'Points' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: t.color.surfaceAlt,
              borderRadius: t.radius.md,
              borderWidth: 1,
              borderColor: t.color.border,
              paddingHorizontal: t.space(3),
              minHeight: t.touch,
              gap: t.space(2),
            }}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search device text, zone or address"
              placeholderTextColor={t.color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <MaterialCommunityIcons name="close-circle" size={18} color={t.color.textFaint} />
              </Pressable>
            ) : null}
          </View>

          {panels.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              <Chip label="All panels" selected={!activePanel} onPress={() => setActivePanel(undefined)} />
              {panels.map((p) => (
                <Chip
                  key={p.id}
                  label={p.nodeNumber !== undefined && p.nodeNumber !== null ? `${p.name} (${p.nodeNumber})` : p.name}
                  selected={activePanel === p.id}
                  onPress={() => setActivePanel(p.id)}
                />
              ))}
            </ScrollView>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            <Chip
              label={includeUnused ? 'Showing unused' : 'Unused hidden'}
              tone={includeUnused ? 'warn' : 'default'}
              onPress={() => setIncludeUnused((v) => !v)}
            />
            {loops.length > 1 ? (
              <>
                <Chip label="All loops" selected={loopFilter === undefined} onPress={() => setLoopFilter(undefined)} />
                {loops.map((l) => (
                  <Chip key={l} label={`Loop ${l}`} selected={loopFilter === l} onPress={() => setLoopFilter(l)} />
                ))}
              </>
            ) : null}
            {types.map(([type, n]) => (
              <Chip
                key={type}
                label={`${DEVICE_TYPE_LABEL[type]} ${n}`}
                selected={typeFilter === type}
                onPress={() => setTypeFilter(typeFilter === type ? undefined : type)}
              />
            ))}
          </ScrollView>

          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt size="sm" tone="muted">
              {loading ? 'Searching…' : `${points.length.toLocaleString()} point${points.length === 1 ? '' : 's'}`}
            </Txt>
            <Button title="Export" variant="ghost" compact onPress={exportList} loading={exporting} />
          </Rowed>
        </View>

        {loading && !points.length ? (
          <ActivityIndicator color={t.color.accent} style={{ marginTop: t.space(8) }} />
        ) : (
          <FlatList
            data={points}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20) }}
            // Long lists are the norm here; these keep scrolling smooth.
            initialNumToRender={20}
            maxToRenderPerBatch={30}
            windowSize={11}
            removeClippedSubviews
            ListHeaderComponent={
              failed ? <Banner tone="fail" title="The points could not be read" body={failed} /> : null
            }
            ListEmptyComponent={
              failed ? null : (
                <EmptyState
                  title={debounced ? 'Nothing matched' : 'No points'}
                  body={
                    debounced
                      ? 'Try a shorter search, or turn on unused points if you are looking at a spare address.'
                      : 'Import a device list to populate this site.'
                  }
                />
              )
            }
            renderItem={({ item }) => <PointRow point={item} />}
          />
        )}
      </Screen>
    </>
  );
}

function PointRow({ point }: { point: Point }) {
  const t = useTheme();
  const address =
    point.loopNumber !== undefined && point.loopNumber !== null && point.address !== undefined && point.address !== null
      ? `L${point.loopNumber}.${String(point.address).padStart(3, '0')}`
      : (point.pointRef ?? (point.address !== undefined && point.address !== null ? String(point.address) : '—'));

  return (
    <View
      style={{
        paddingVertical: t.space(2.5),
        borderBottomWidth: 1,
        borderBottomColor: t.color.border,
        gap: 3,
        opacity: point.unused ? 0.5 : 1,
      }}
    >
      <Rowed gap={2}>
        <Txt mono size="sm" tone="accent" weight="700" style={{ minWidth: 74 }}>{address}</Txt>
        <Txt size="md" weight="600" style={{ flex: 1 }} numberOfLines={1}>
          {point.text || <Txt tone="faint">(no text)</Txt>}
        </Txt>
      </Rowed>
      {point.text2 ? (
        <Txt size="sm" tone="muted" numberOfLines={1} style={{ marginLeft: 82 }}>{point.text2}</Txt>
      ) : null}
      <Rowed gap={2} style={{ marginLeft: 82 }} wrap>
        <Txt size="xs" tone="faint">{DEVICE_TYPE_LABEL[point.deviceType]}</Txt>
        {point.zoneNumber !== undefined && point.zoneNumber !== null ? (
          <Txt size="xs" tone="muted">
            · Zone {point.zoneNumber}{point.zoneText ? ` — ${point.zoneText}` : ''}
          </Txt>
        ) : null}
        {point.unused ? <Txt size="xs" tone="warn">· Unused</Txt> : null}
      </Rowed>
    </View>
  );
}
