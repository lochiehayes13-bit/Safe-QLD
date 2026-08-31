import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Link, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listSiteSummaries, type SiteSummary } from '@/db/repo';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Site list — the app's home.
 *
 * A tech's mental model is "which job am I on", so sites come first and
 * everything else hangs off them.
 */
export default function SitesScreen() {
  const t = useTheme();
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setSites(await listSiteSummaries());
    setLoading(false);
  }, []);

  // Reload on focus so returning from an import shows the new data.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={sites}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(24) }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.color.accent} />}
        ListHeaderComponent={
          <Rowed gap={2} style={{ marginBottom: t.space(1) }}>
            <Button
              title="New site"
              onPress={() => router.push('/site/new')}
              style={{ flex: 1 }}
              icon={<MaterialCommunityIcons name="plus" size={18} color={t.color.onAccent} />}
            />
            <Button
              title="Import"
              variant="secondary"
              onPress={() => router.push('/import')}
              style={{ flex: 1 }}
              icon={<MaterialCommunityIcons name="file-import-outline" size={18} color={t.color.text} />}
            />
          </Rowed>
        }
        renderItem={({ item }) => <SiteCard site={item} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="No sites yet"
              body="Add a site by hand, or import a device list exported from any panel programming tool. Both work offline."
              action={<Button title="Add your first site" onPress={() => router.push('/site/new')} />}
            />
          )
        }
      />
    </Screen>
  );
}

function SiteCard({ site }: { site: SiteSummary }) {
  const t = useTheme();
  const location = [site.suburb, site.state].filter(Boolean).join(' ');

  return (
    <Card onPress={() => router.push({ pathname: '/site/[id]', params: { id: site.id } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size="lg" weight="700" numberOfLines={1}>{site.name}</Txt>
          {site.address || location ? (
            <Txt size="sm" tone="muted" numberOfLines={1}>
              {[site.address, location].filter(Boolean).join(', ')}
            </Txt>
          ) : null}
          {site.clientName ? <Txt size="sm" tone="faint" numberOfLines={1}>{site.clientName}</Txt> : null}

          <Rowed gap={1.5} wrap style={{ marginTop: t.space(1.5) }}>
            <Chip label={`${site.panelCount} panel${site.panelCount === 1 ? '' : 's'}`} />
            <Chip label={`${site.pointCount.toLocaleString()} points`} />
            {site.openDefects > 0 ? <Chip label={`${site.openDefects} open defect${site.openDefects === 1 ? '' : 's'}`} tone="fail" /> : null}
          </Rowed>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
