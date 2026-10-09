import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { searchAssets, type AssetHit } from '@/db/assetRepo';
import { findByPartNumber, type CatalogueItem } from '@/db/catalogueRepo';
import { queryPoints } from '@/db/repo';
import { sitesForPanels, type PanelSite } from '@/db/pointSites';
import { officeNumber } from '@/domain/assetLookup';
import type { Point } from '@/domain/types';
import { assetTypeById } from '@/seed/assetTypes';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { useTheme } from '@/theme';
import { Card, Chip, EmptyState, H2, Rowed, Screen, Txt } from '@/components/ui';

interface Found {
  q: string;
  assets: AssetHit[];
  points: Point[];
  pointSites: Map<string, PanelSite>;
  parts: CatalogueItem[];
  failed?: string;
}

const EMPTY: Omit<Found, 'q'> = { assets: [], points: [], pointSites: new Map(), parts: [] };

/**
 * Universal find.
 *
 * One box that searches assets, imported points and the parts catalogue at
 * once, because a technician holding something knows one identifier — a code, a
 * serial, a part number or a location — and not necessarily which kind it is.
 */
export default function FindScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  /*
   * What came back, with the query it answers. Shown only while that is still
   * the query, so clearing the box or a slower answer to an older query never
   * leaves the wrong results on screen.
   */
  const [result, setResult] = useState<Found | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(h);
  }, [query]);

  const q = debounced.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    void (async () => {
      try {
        const [assets, points, parts] = await Promise.all([
          // Exact tag, office asset number or serial first, in any form it
          // was typed, then everything that only contains it.
          searchAssets(q, 40),
          queryPoints({ search: q, includeUnused: true, limit: 20 }),
          findByPartNumber(q),
        ]);
        const pointSites = await sitesForPanels(points.map((p) => p.panelId));
        if (live) setResult({ q, assets, points, pointSites, parts });
      } catch (e) {
        if (live) setResult({ ...EMPTY, q, failed: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { live = false; };
  }, [q]);

  const shown = q.length >= 2 && result?.q === q ? result : { ...EMPTY, q };
  const { assets, points, pointSites, parts, failed } = shown;
  const nothing = shown === result && !failed && !assets.length && !points.length && !parts.length;

  return (
    <>
      <Stack.Screen options={{ title: 'Find asset' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4) }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.space(2),
              backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md,
              borderWidth: 1, borderColor: t.color.border,
              paddingLeft: t.space(3), minHeight: t.touch,
            }}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Tag, serial, part number or location"
              placeholderTextColor={t.color.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
            />
            <Pressable
              onPress={() => router.push('/scan')}
              accessibilityRole="button"
              accessibilityLabel="Scan a tag"
              hitSlop={8}
              style={{ minWidth: t.touch, minHeight: t.touch, alignItems: 'center', justifyContent: 'center' }}
            >
              <MaterialCommunityIcons name="barcode-scan" size={22} color={t.color.accent} />
            </Pressable>
          </View>
        </View>

        <FlatList
          data={[] as never[]}
          keyExtractor={(_, i) => String(i)}
          renderItem={() => null}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20) }}
          ListHeaderComponent={
            <View style={{ gap: t.space(3) }}>
              {assets.length ? (
                <>
                  <H2>Assets</H2>
                  {assets.map((a) => {
                    const type = assetTypeById(a.assetTypeId);
                    const officeNo = officeNumber(a.attributes);
                    return (
                      <Card key={a.id} onPress={() => router.push({ pathname: '/assets/[id]', params: { id: a.id } })}>
                        <Rowed align="flex-start">
                          <View style={{ flex: 1 }}>
                            <Txt weight="700">{a.name || type?.label || 'Asset'}</Txt>
                            <Txt size="sm" numberOfLines={1}>{a.siteName ?? 'No site'}</Txt>
                            {a.code || officeNo ? (
                              <Txt size="sm" mono tone="accent" numberOfLines={1}>
                                {[a.code, officeNo && officeNo !== a.code ? `Asset # ${officeNo}` : undefined]
                                  .filter(Boolean).join(' · ')}
                              </Txt>
                            ) : null}
                            <Txt size="sm" tone="muted" numberOfLines={1}>
                              {[type?.label, a.level, a.room, a.model].filter(Boolean).join(' · ')}
                            </Txt>
                            {a.serial ? <Txt size="xs" tone="faint">Serial {a.serial}</Txt> : null}
                          </View>
                          {a.openDefects ? (
                            <Chip label={`${a.openDefects} defect${a.openDefects === 1 ? '' : 's'}`} tone="fail" />
                          ) : null}
                        </Rowed>
                      </Card>
                    );
                  })}
                </>
              ) : null}

              {points.length ? (
                <>
                  <H2>Points</H2>
                  {points.map((p) => {
                    const site = pointSites.get(p.panelId);
                    return (
                      <Card
                        key={p.id}
                        onPress={site
                          ? () => router.push({ pathname: '/site/points', params: { siteId: site.siteId, panelId: p.panelId } })
                          : undefined}
                      >
                        <Rowed gap={2}>
                          <Txt mono size="sm" tone="accent" weight="700">
                            {p.loopNumber !== undefined && p.loopNumber !== null && p.address !== undefined && p.address !== null
                              ? `L${p.loopNumber}.${String(p.address).padStart(3, '0')}`
                              : (p.pointRef ?? '—')}
                          </Txt>
                          <View style={{ flex: 1 }}>
                            <Txt weight="600" numberOfLines={1}>{p.text || '(no text)'}</Txt>
                            {site ? <Txt size="sm" numberOfLines={1}>{site.siteName}</Txt> : null}
                            <Txt size="xs" tone="muted" numberOfLines={1}>
                              {DEVICE_TYPE_LABEL[p.deviceType]}
                              {p.zoneText ? ` · ${p.zoneText}` : ''}
                            </Txt>
                          </View>
                        </Rowed>
                      </Card>
                    );
                  })}
                </>
              ) : null}

              {parts.length ? (
                <>
                  <H2>Parts</H2>
                  {parts.map((c) => (
                    <Card key={c.id} onPress={() => router.push({ pathname: '/office-catalogue', params: { q: c.partNumber } })}>
                      <Rowed gap={2}>
                        <Txt mono size="sm" tone="accent" weight="700">{c.partNumber}</Txt>
                        <View style={{ flex: 1 }}>
                          <Txt weight="600" numberOfLines={1}>{c.name}</Txt>
                          <Txt size="xs" tone="muted">
                            {c.brand}
                            {c.quiescentMa !== null && c.quiescentMa !== undefined ? ` · ${c.quiescentMa} mA standby` : ''}
                          </Txt>
                        </View>
                      </Rowed>
                    </Card>
                  ))}
                </>
              ) : null}

              {failed ? (
                <EmptyState icon="alert-circle-outline" title="Search failed" body={failed} />
              ) : null}

              {nothing ? (
                <EmptyState
                  icon="magnify-close"
                  title="Nothing found"
                  body="Try part of the tag, serial or location."
                />
              ) : null}

              {q.length < 2 ? (
                <EmptyState
                  icon="magnify"
                  title="Find an asset"
                  body="Tag, asset #, serial, part number or location."
                />
              ) : null}
            </View>
          }
        />
      </Screen>
    </>
  );
}
