import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { findBySerial, getAssetByCode, queryAssets, type AssetRecord } from '@/db/assetRepo';
import { findByPartNumber, type CatalogueItem } from '@/db/catalogueRepo';
import { queryPoints } from '@/db/repo';
import type { Point } from '@/domain/types';
import { assetTypeById } from '@/seed/assetTypes';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { useTheme } from '@/theme';
import { Card, Chip, EmptyState, H2, Rowed, Screen, Txt } from '@/components/ui';

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
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [parts, setParts] = useState<CatalogueItem[]>([]);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(h);
  }, [query]);

  const search = useCallback(async () => {
    const q = debounced.trim();
    if (q.length < 2) {
      setAssets([]); setPoints([]); setParts([]);
      return;
    }
    const [byCode, bySerial, byName, pts, cat] = await Promise.all([
      getAssetByCode(q),
      findBySerial(q),
      queryAssets({ search: q, limit: 40 }),
      queryPoints({ search: q, includeUnused: true, limit: 40 }),
      findByPartNumber(q),
    ]);

    // De-duplicate across the three asset lookups, code match first.
    const seen = new Set<string>();
    const merged: AssetRecord[] = [];
    for (const a of [...(byCode ? [byCode] : []), ...bySerial, ...byName]) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      merged.push(a);
    }

    setAssets(merged);
    setPoints(pts);
    setParts(cat);
  }, [debounced]);

  useEffect(() => { void search(); }, [search]);

  const nothing = debounced.trim().length >= 2 && !assets.length && !points.length && !parts.length;

  return (
    <>
      <Stack.Screen options={{ title: 'Find' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4) }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.space(2),
              backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md,
              borderWidth: 1, borderColor: t.color.border,
              paddingHorizontal: t.space(3), minHeight: t.touch,
            }}
          >
            <MaterialCommunityIcons name="magnify-scan" size={20} color={t.color.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Asset code, serial, part number or location"
              placeholderTextColor={t.color.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
            />
          </View>
        </View>

        <FlatList
          data={[] as never[]}
          keyExtractor={(_, i) => String(i)}
          renderItem={() => null}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20) }}
          ListHeaderComponent={
            <View style={{ gap: t.space(3) }}>
              {assets.length ? (
                <>
                  <H2>Assets</H2>
                  {assets.map((a) => {
                    const type = assetTypeById(a.assetTypeId);
                    return (
                      <Card key={a.id} onPress={() => router.push({ pathname: '/assets/[id]', params: { id: a.id } })}>
                        <Rowed align="flex-start">
                          <View style={{ flex: 1 }}>
                            <Txt weight="700">{a.name || type?.label || 'Asset'}</Txt>
                            {a.code ? <Txt size="sm" mono tone="accent">{a.code}</Txt> : null}
                            <Txt size="sm" tone="muted" numberOfLines={1}>
                              {[type?.label, a.level, a.room, a.model].filter(Boolean).join(' · ')}
                            </Txt>
                            {a.serial ? <Txt size="xs" tone="faint">Serial {a.serial}</Txt> : null}
                          </View>
                          {a.openDefects ? <Chip label={`${a.openDefects} defect`} tone="fail" /> : null}
                        </Rowed>
                      </Card>
                    );
                  })}
                </>
              ) : null}

              {points.length ? (
                <>
                  <H2>Points</H2>
                  {points.slice(0, 20).map((p) => (
                    <Card key={p.id}>
                      <Rowed gap={2}>
                        <Txt mono size="sm" tone="accent" weight="700">
                          {p.loopNumber !== undefined && p.loopNumber !== null && p.address !== undefined && p.address !== null
                            ? `L${p.loopNumber}.${String(p.address).padStart(3, '0')}`
                            : (p.pointRef ?? '—')}
                        </Txt>
                        <View style={{ flex: 1 }}>
                          <Txt weight="600" numberOfLines={1}>{p.text || '(no text)'}</Txt>
                          <Txt size="xs" tone="muted" numberOfLines={1}>
                            {DEVICE_TYPE_LABEL[p.deviceType]}
                            {p.zoneText ? ` · ${p.zoneText}` : ''}
                          </Txt>
                        </View>
                      </Rowed>
                    </Card>
                  ))}
                </>
              ) : null}

              {parts.length ? (
                <>
                  <H2>Parts</H2>
                  {parts.map((c) => (
                    <Card key={c.id}>
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

              {nothing ? (
                <EmptyState
                  title="Nothing found"
                  body="Try part of the code, the serial from the label, or a word from the location text."
                />
              ) : null}

              {debounced.trim().length < 2 ? (
                <EmptyState
                  title="Search everything at once"
                  body="Asset codes, serial numbers, part numbers and device text are all searched together — you do not have to know which kind of thing you are holding."
                />
              ) : null}
            </View>
          }
        />
      </Screen>
    </>
  );
}
