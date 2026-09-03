import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { assetCountsBySystem, queryAssets, type AssetRecord } from '@/db/assetRepo';
import { getSite } from '@/db/repo';
import { SYSTEM_LABELS, assetTypeById, type SystemKind } from '@/seed/assetTypes';
import type { Site } from '@/domain/types';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';

/** The site's asset register, grouped by system. */
export default function SiteAssetsScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, and an empty string is not a site.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [counts, setCounts] = useState<{ system: string; count: number }[]>([]);
  const [system, setSystem] = useState<SystemKind>();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(h);
  }, [search]);

  const load = useCallback(async () => {
    if (!siteId) return;
    const [s, a, c] = await Promise.all([
      getSite(siteId),
      queryAssets({ siteId, system, search: debounced, limit: 2000 }),
      assetCountsBySystem(siteId),
    ]);
    setSite(s);
    setAssets(a);
    setCounts(c);
  }, [siteId, system, debounced]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const total = useMemo(() => counts.reduce((n, c) => n + c.count, 0), [counts]);

  // Opened from search or a stale link there is no site, and the screen used
  // to answer "No assets recorded" — a statement about a building nobody
  // named, and one a technician believes.
  if (!siteId) return <ContextGate kind="site" what="an asset register" title="Assets" />;

  return (
    <>
      <Stack.Screen options={{ title: site ? `${site.name} — assets` : 'Assets' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.space(2),
              backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md,
              borderWidth: 1, borderColor: t.color.border,
              paddingHorizontal: t.space(3), minHeight: t.touch,
            }}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Code, serial, model or location"
              placeholderTextColor={t.color.textFaint}
              autoCapitalize="none"
              style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
            />
          </View>

          {counts.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              <Chip label={`All ${total}`} selected={!system} onPress={() => setSystem(undefined)} />
              {counts.map((c) => (
                <Chip
                  key={c.system}
                  label={`${SYSTEM_LABELS[c.system as SystemKind] ?? c.system} ${c.count}`}
                  selected={system === c.system}
                  onPress={() => setSystem(system === (c.system as SystemKind) ? undefined : (c.system as SystemKind))}
                />
              ))}
            </ScrollView>
          ) : null}

          <Button
            title="Add asset"
            onPress={() => router.push({ pathname: '/assets/new', params: { siteId: siteId ?? '', system: system ?? '' } })}
            icon={<MaterialCommunityIcons name="plus" size={18} color={t.color.onAccent} />}
          />
        </View>

        <FlatList
          data={assets}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          initialNumToRender={15}
          removeClippedSubviews
          ListEmptyComponent={
            <EmptyState
              title={debounced || system ? 'Nothing matched' : 'No assets recorded'}
              body="Build the register as you go — extinguishers, lights, hydrants, doors, pumps. Each one keeps its own history."
            />
          }
          renderItem={({ item }) => {
            const type = assetTypeById(item.assetTypeId);
            const summary = (type?.attributes ?? [])
              .filter((a) => a.summary && item.attributes[a.key])
              .map((a) => `${item.attributes[a.key]}${a.unit ? ` ${a.unit}` : ''}`)
              .join(' · ');
            return (
              <Card onPress={() => router.push({ pathname: '/assets/[id]', params: { id: item.id } })}>
                <Rowed align="flex-start" gap={2}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="700" numberOfLines={1}>{item.name || type?.label}</Txt>
                    {item.code ? <Txt size="xs" mono tone="accent">{item.code}</Txt> : null}
                    <Txt size="sm" tone="muted" numberOfLines={1}>
                      {[type?.label, item.level, item.room].filter(Boolean).join(' · ')}
                    </Txt>
                    {summary ? <Txt size="xs" tone="faint" numberOfLines={1}>{summary}</Txt> : null}
                  </View>
                  {item.openDefects ? <Chip label={`${item.openDefects}`} tone="fail" /> : null}
                  {item.lastResult ? (
                    <Chip label={item.lastResult === 'pass' ? 'Pass' : 'Fail'} tone={item.lastResult === 'pass' ? 'pass' : 'fail'} />
                  ) : null}
                </Rowed>
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
