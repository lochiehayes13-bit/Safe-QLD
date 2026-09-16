import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { listCatalogGroups, searchCatalogItems, type CatalogItemRecord } from '@/db/moreRepo';
import type { SimproCatalogGroup } from '@/simpro/moreResources';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { describeLoadFailure } from '@/domain/loadFailure';
import { formatCents } from '@/domain/rates';
import { everSynced } from '@/simpro/watermark';
import { useTheme } from '@/theme';
import { Reveal } from '@/components/motion';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, SearchBox, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * The office catalogue: the parts Simpro prices work from.
 *
 * Distinct from the app's own supplier catalogue under Tools, which is the
 * eleven thousand parts the app ships with their electrical data. This is
 * the office's list — the part numbers a quote line and a purchase order
 * line carry, with the sell price the office puts on each. The sell price
 * is the office's own figure already given to customers; what the company
 * pays for the part is not on the phone and never will be.
 *
 * Search takes a part number or a name, runs in the database, and the
 * exact part number leads. Copying the number is the one action, because a
 * part number is typed into a note or a request far more often than it is
 * read.
 */

const PAGE = 100;

export default function OfficeCatalogueScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  const [typed, setTyped] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  // The chosen parent group, and within it the chosen child, if any.
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [groupId, setGroupId] = useState<string | undefined>(undefined);
  const [groups, setGroups] = useState<SimproCatalogGroup[]>([]);
  const [items, setItems] = useState<CatalogItemRecord[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [empty, setEmpty] = useState<EmptyStateWords | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [found, g] = await Promise.all([
        searchCatalogItems(query, { groupId, parentGroupId: groupId ? undefined : parentId, limit: PAGE }),
        listCatalogGroups(),
      ]);
      setItems(found);
      setGroups(g);
      if (!found.length && !query.trim() && !parentId && !groupId) {
        const prefs = await loadPrefs();
        setEmpty(officeEmptyState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'catalogue parts',
        ));
      } else {
        setEmpty(null);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the office catalogue'));
    }
  }, [query, parentId, groupId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Top-level groups in the chip row: the office has a few dozen parents
  // and hundreds of children, and a row of hundreds is a row of none. A
  // parent chip asks for the parts under it and under every child, since a
  // part is filed in the child; choosing a parent then offers its children
  // on a second row to narrow further.
  const parents = groups.filter((g) => !g.parentId);
  const children = parentId ? groups.filter((g) => g.parentId === parentId) : [];
  const chooseParent = (id: string | undefined) => { setParentId(id); setGroupId(undefined); };

  return (
    <>
      <Stack.Screen options={{ title: 'Office catalogue' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2.5) }}>
          <SearchBox value={typed} onChange={setTyped} placeholder="Part number or name" />
          {parents.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              <Chip label="All groups" selected={!parentId} onPress={() => chooseParent(undefined)} />
              {parents.map((g) => (
                <Chip key={g.id} label={g.name} selected={parentId === g.id} onPress={() => chooseParent(parentId === g.id ? undefined : g.id)} />
              ))}
            </ScrollView>
          ) : null}
          {children.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              <Chip label="Whole group" selected={!groupId} onPress={() => setGroupId(undefined)} />
              {children.map((g) => (
                <Chip key={g.id} label={g.name} selected={groupId === g.id} onPress={() => setGroupId(groupId === g.id ? undefined : g.id)} />
              ))}
            </ScrollView>
          ) : null}
          {items ? (
            <Txt size="xs" tone="faint">
              {items.length >= PAGE ? `First ${PAGE} shown. Search to narrow.` : `${items.length} part${items.length === 1 ? '' : 's'}`}
            </Txt>
          ) : null}
        </View>
        <FlatList
          data={items ?? []}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={15}
          windowSize={9}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          ListHeaderComponent={failed ? <Banner tone="fail" title="The catalogue could not be read" body={failed} /> : null}
          ListEmptyComponent={items === null && !failed ? null : (
            empty ? (
              <EmptyState icon="package-variant-closed" title={empty.title} body={empty.body} />
            ) : (
              <EmptyState
                icon="package-variant-closed"
                title="Nothing matched"
                body="Try the part number on its own, or clear the group."
              />
            )
          )}
          renderItem={({ item, index }) => {
            const row = <PartRow item={item} />;
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

function PartRow({ item }: { item: CatalogItemRecord }) {
  const t = useTheme();
  const group = [item.parentGroupName, item.groupName].filter(Boolean).join(' › ');
  const copy = async () => {
    if (!item.partNo) return;
    try {
      await Clipboard.setStringAsync(item.partNo);
    } catch (e) {
      showAlert('Could not copy', e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card>
      <Rowed align="flex-start" gap={2}>
        <View style={{ flex: 1 }}>
          <Rowed gap={2}>
            {item.partNo ? <Txt mono size="sm" weight="700" tone="accent">{item.partNo}</Txt> : <Txt size="xs" tone="faint">No part number</Txt>}
            {item.archived ? <Chip label="Archived" /> : null}
          </Rowed>
          <Txt weight="600" style={{ marginTop: 2 }} numberOfLines={2}>{item.name}</Txt>
          <Txt size="xs" tone="muted" style={{ marginTop: 4 }} numberOfLines={1}>
            {[group, item.manufacturer].filter(Boolean).join(' · ') || 'No group'}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: t.space(1.5) }}>
          <Txt weight="700">{item.sellExTaxCents !== undefined ? formatCents(item.sellExTaxCents) : '—'}</Txt>
          <Txt size="xs" tone="faint">sell ex GST</Txt>
          {item.partNo ? (
            <Pressable onPress={() => void copy()} hitSlop={10} accessibilityLabel={`Copy part number ${item.partNo}`} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Rowed gap={1}>
                <MaterialCommunityIcons name="content-copy" size={16} color={t.color.accentText} />
                <Txt size="xs" tone="accent" weight="700">Copy part no</Txt>
              </Rowed>
            </Pressable>
          ) : null}
        </View>
      </Rowed>
    </Card>
  );
}
