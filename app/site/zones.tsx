import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getSite, listPanels, listZones, queryPoints } from '@/db/repo';
import type { Panel, Site, Zone } from '@/domain/types';
import { zoneSheet } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { useTheme } from '@/theme';
import { Button, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

interface ZoneWithCount extends Zone {
  deviceCount: number;
}

/** Zone list with device counts, so a tech can see zone allocation at a glance. */
export default function ZonesScreen() {
  const t = useTheme();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [activePanel, setActivePanel] = useState<string | undefined>();
  const [zones, setZones] = useState<ZoneWithCount[]>([]);
  const [includeUnused, setIncludeUnused] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    void Promise.all([getSite(siteId), listPanels(siteId)]).then(([s, p]) => {
      setSite(s);
      setPanels(p);
      setActivePanel((cur) => cur ?? p[0]?.id);
    });
  }, [siteId]);

  const load = useCallback(async () => {
    if (!activePanel) return;
    const [z, pts] = await Promise.all([
      listZones(activePanel, includeUnused),
      queryPoints({ panelId: activePanel, includeUnused: true, limit: 100000 }),
    ]);
    const counts = new Map<number, number>();
    for (const p of pts) {
      if (p.zoneNumber === undefined || p.zoneNumber === null) continue;
      counts.set(p.zoneNumber, (counts.get(p.zoneNumber) ?? 0) + 1);
    }
    setZones(z.map((x) => ({ ...x, deviceCount: counts.get(x.number) ?? 0 })));
  }, [activePanel, includeUnused]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportZones = async () => {
    const panel = panels.find((p) => p.id === activePanel);
    if (!panel || !zones.length) return;
    setExporting(true);
    try {
      const file = writeXlsx(`${site?.name ?? 'Site'} zones`, [zoneSheet(panel, zones)]);
      await shareFile(file, 'Export zone list');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: site ? `${site.name} — zones` : 'Zones' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          {panels.length > 1 ? (
            <Rowed gap={2} wrap>
              {panels.map((p) => (
                <Chip key={p.id} label={p.name} selected={activePanel === p.id} onPress={() => setActivePanel(p.id)} />
              ))}
            </Rowed>
          ) : null}
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Chip
              label={includeUnused ? 'Showing unused' : 'Unused hidden'}
              tone={includeUnused ? 'warn' : 'default'}
              onPress={() => setIncludeUnused((v) => !v)}
            />
            <Button title="Export" variant="ghost" compact onPress={exportZones} loading={exporting} />
          </Rowed>
          <Txt size="sm" tone="muted">{zones.length} zone{zones.length === 1 ? '' : 's'}</Txt>
        </View>

        <FlatList
          data={zones}
          keyExtractor={(z) => z.id}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20) }}
          ListEmptyComponent={<EmptyState title="No zones" body="Import a config or device list that carries zone data." />}
          renderItem={({ item }) => (
            <View
              style={{
                paddingVertical: t.space(2.5),
                borderBottomWidth: 1,
                borderBottomColor: t.color.border,
                opacity: item.unused ? 0.5 : 1,
              }}
            >
              <Rowed gap={3}>
                <Txt mono size="sm" tone="accent" weight="700" style={{ minWidth: 46 }}>
                  {String(item.number).padStart(3, '0')}
                </Txt>
                <View style={{ flex: 1 }}>
                  <Txt weight="600" numberOfLines={1}>{item.text || <Txt tone="faint">(no text)</Txt>}</Txt>
                  {item.text2 ? <Txt size="sm" tone="muted" numberOfLines={1}>{item.text2}</Txt> : null}
                </View>
                <Txt size="sm" tone="muted">{item.deviceCount}</Txt>
              </Rowed>
            </View>
          )}
        />
      </Screen>
    </>
  );
}
