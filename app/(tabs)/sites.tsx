import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listSiteSummaries, type SiteSummary } from '@/db/repo';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { Reveal, Skeleton } from '@/components/motion';
import { ambiguousNames, disambiguator } from '@/domain/siteNames';

/** Site list. A technician's mental model is "which job am I on", so sites lead. */
export default function SitesScreen() {
  const t = useTheme();
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setSites(await listSiteSummaries());
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /*
   * Worked out across the whole list rather than the filtered one: a name is
   * ambiguous because two sites share it, and that stays true when a search
   * happens to show only one of them. Deciding it from the filtered list would
   * make the warning appear and disappear as somebody types.
   */
  const ambiguous = useMemo(() => ambiguousNames(sites), [sites]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) =>
      [s.name, s.address, s.suburb, s.clientName, s.siteRef].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [sites, search]);

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(24) }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.color.accent} />}
        ListHeaderComponent={
          <View style={{ gap: t.space(3), marginBottom: t.space(1) }}>
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
                placeholder="Search sites, clients, references"
                placeholderTextColor={t.color.textFaint}
                autoCapitalize="none"
                style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
              />
            </View>
            <Rowed gap={2}>
              <Button
                title="Map"
                variant="secondary"
                onPress={() => router.push('/map')}
                style={{ flex: 1 }}
                icon={<MaterialCommunityIcons name="map-marker-radius-outline" size={20} color={t.color.text} />}
              />
              <Button title="New site" onPress={() => router.push('/site/new')} style={{ flex: 1 }} />
              <Button title="Import" variant="secondary" onPress={() => router.push('/import')} style={{ flex: 1 }} />
            </Rowed>
          </View>
        }
        renderItem={({ item, index }) => (
          index < 8
            ? <Reveal index={index}><SiteCard site={item} apart={disambiguator(item, ambiguous)} /></Reveal>
            : <SiteCard site={item} apart={disambiguator(item, ambiguous)} />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: t.space(3) }}>
              <Skeleton height={104} /><Skeleton height={104} /><Skeleton height={104} /><Skeleton height={104} />
            </View>
          ) : (
            <EmptyState
              icon={search ? 'map-search-outline' : 'office-building-marker-outline'}
              title={search ? 'Nothing matched' : 'No sites yet'}
              body={search ? 'Try a shorter search.' : 'Add a site by hand, or import a device list exported from any panel programming tool. Both work offline.'}
              action={search ? undefined : <Button title="Add your first site" onPress={() => router.push('/site/new')} />}
            />
          )
        }
      />
    </Screen>
  );
}

/**
 * One site in the list.
 *
 * `apart` is what tells this site from its namesakes, and it is absent on all
 * but a handful of rows. Three of the sites on the book are called "Storage
 * Choice - Sumner Park", three are "Luggage Direct" and two are "Brisbane
 * Rheumatology", the register carries no address for any of them, and without
 * this the rows are identical — so a technician picks one of three and records
 * a service against whichever building it turns out to be.
 */
function SiteCard({ site, apart }: { site: SiteSummary; apart?: string }) {
  const t = useTheme();
  const location = [site.suburb, site.state].filter(Boolean).join(' ');
  return (
    <Card onPress={() => router.push({ pathname: '/site/[id]', params: { id: site.id } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size="lg" weight="700" numberOfLines={1}>{site.name}</Txt>
          {site.address || location ? (
            <Txt size="sm" tone="muted" numberOfLines={1}>{[site.address, location].filter(Boolean).join(', ')}</Txt>
          ) : null}
          {site.clientName ? <Txt size="sm" tone="faint" numberOfLines={1}>{site.clientName}</Txt> : null}
          {apart ? (
            <Rowed gap={1.5} align="center">
              <MaterialCommunityIcons name="alert-circle-outline" size={13} color={t.color.warn} />
              <Txt size="xs" tone="warn" numberOfLines={1}>
                Another site shares this name — {apart}
              </Txt>
            </Rowed>
          ) : null}
          <Rowed gap={1.5} wrap style={{ marginTop: t.space(1.5) }}>
            <Chip label={`${site.panelCount} panel${site.panelCount === 1 ? '' : 's'}`} />
            <Chip label={`${site.pointCount.toLocaleString()} points`} />
            {site.openDefects > 0 ? <Chip label={`${site.openDefects} open`} tone="fail" /> : null}
          </Rowed>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
