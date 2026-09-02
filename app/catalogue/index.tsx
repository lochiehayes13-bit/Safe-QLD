import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  CATEGORY_LABEL, catalogueBrands, catalogueCategories, catalogueCount, queryCatalogue,
  type CatalogueItem,
} from '@/db/catalogueRepo';
import { startCatalogueSeed } from '@/seed/catalogueSeed';
import { useTheme } from '@/theme';
import { Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Parts catalogue.
 *
 * Search is deliberately across part number, name, brand and description at
 * once, because a technician holding a device knows one of those and not
 * necessarily which.
 */
export default function CatalogueScreen() {
  const t = useTheme();
  // The scanner sends an unrecognised code here so the search is already run
  // rather than needing to be retyped from a ladder.
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [search, setSearch] = useState(q ?? '');
  const [debounced, setDebounced] = useState(q ?? '');
  const [brand, setBrand] = useState<string>();
  const [category, setCategory] = useState<string>();
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [brands, setBrands] = useState<{ brand: string; count: number }[]>([]);
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  // Seeding starts at launch but runs alongside the app, so on the first run
  // after an install this screen can arrive before the parts do.
  const [seeding, setSeeding] = useState(true);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(h);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    startCatalogueSeed()
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setSeeding(false);
        void catalogueBrands().then(setBrands);
        void catalogueCount().then(setTotal);
        void load();
      });
    return () => { cancelled = true; };
    // load is intentionally not a dependency: this runs once, when seeding
    // settles, and the filter effect below owns every later reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void catalogueCategories(brand).then(setCategories);
  }, [brand]);

  const load = useCallback(async () => {
    setItems(await queryCatalogue({ search: debounced, brand, category, limit: 300 }));
  }, [debounced, brand, category]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <Stack.Screen options={{ title: 'Parts' }} />
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
              placeholder="Part number, model or description"
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

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            <Chip label={`All ${total}`} selected={!brand} onPress={() => { setBrand(undefined); setCategory(undefined); }} />
            {brands.map((b) => (
              <Chip
                key={b.brand}
                label={`${b.brand} ${b.count}`}
                selected={brand === b.brand}
                onPress={() => { setBrand(brand === b.brand ? undefined : b.brand); setCategory(undefined); }}
              />
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            {categories.map((c) => (
              <Chip
                key={c.category}
                label={`${CATEGORY_LABEL[c.category] ?? c.category} ${c.count}`}
                selected={category === c.category}
                onPress={() => setCategory(category === c.category ? undefined : c.category)}
              />
            ))}
          </ScrollView>

          <Txt size="sm" tone="muted">{items.length} shown</Txt>
        </View>

        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews
          ListEmptyComponent={
            <EmptyState
              title={seeding ? 'Loading the catalogue' : total === 0 ? 'Catalogue not loaded' : 'Nothing matched'}
              body={
                seeding
                  ? 'Thousands of parts are being written to this device. It happens once, after an install or an update.'
                  : total === 0
                    ? 'The parts catalogue loads on first run. If this stays empty, the bundled data is missing from this build.'
                    : 'Try the part number on its own, or clear the brand filter.'
              }
            />
          }
          renderItem={({ item }) => <PartRow item={item} />}
        />
      </Screen>
    </>
  );
}

function PartRow({ item }: { item: CatalogueItem }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);

  const specs = useMemo(() => {
    const out: string[] = [];
    if (item.voltage) out.push(item.voltage);
    if (item.quiescentMa !== null && item.quiescentMa !== undefined) out.push(`${item.quiescentMa} mA standby`);
    if (item.alarmMa !== null && item.alarmMa !== undefined) out.push(`${item.alarmMa} mA alarm`);
    if (item.dbAt1m) out.push(`${item.dbAt1m} dB(A)`);
    if (item.protocol) out.push(item.protocol);
    if (item.ipRating) out.push(item.ipRating);
    return out;
  }, [item]);

  return (
    <Card onPress={() => setExpanded((v) => !v)}>
      <Rowed align="flex-start" gap={2}>
        <View style={{ flex: 1 }}>
          <Rowed gap={2}>
            <Txt mono size="sm" weight="700" tone="accent">{item.partNumber}</Txt>
            <Txt size="xs" tone="faint">{item.brand}</Txt>
          </Rowed>
          <Txt weight="600" style={{ marginTop: 2 }} numberOfLines={expanded ? undefined : 2}>{item.name}</Txt>
          {specs.length ? (
            <Txt size="xs" tone="muted" style={{ marginTop: 4 }} numberOfLines={expanded ? undefined : 1}>
              {specs.join(' · ')}
            </Txt>
          ) : null}
        </View>
        <Pressable onPress={() => void Clipboard.setStringAsync(item.partNumber)} hitSlop={10}>
          <MaterialCommunityIcons name="content-copy" size={18} color={t.color.textFaint} />
        </Pressable>
      </Rowed>

      {expanded ? (
        <View style={{ marginTop: t.space(2.5), gap: t.space(1.5) }}>
          {item.description ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{item.description}</Txt> : null}
          {item.standards ? <Txt size="xs" tone="faint">Standards: {item.standards}</Txt> : null}
          {item.notes ? <Txt size="xs" tone="faint">{item.notes}</Txt> : null}
          <Rowed gap={2} wrap>
            <Chip label={CATEGORY_LABEL[item.category] ?? item.category} />
            <Chip
              label={`${item.confidence} confidence`}
              tone={item.confidence === 'high' ? 'pass' : item.confidence === 'low' ? 'warn' : 'default'}
            />
            {item.supplier ? <Chip label={item.supplier.slice(0, 30)} /> : null}
          </Rowed>
          {item.sourceUrl ? (
            <Txt size="xs" tone="faint" numberOfLines={1}>Source: {item.sourceUrl}</Txt>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
