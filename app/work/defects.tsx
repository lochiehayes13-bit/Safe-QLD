import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { listDefects, listSites, updateDefect } from '@/db/repo';
import type { Defect, Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/** Outstanding works — defects across every site, worst first. */
export default function DefectsScreen() {
  const t = useTheme();
  const [defects, setDefects] = useState<Defect[]>([]);
  const [sites, setSites] = useState<Map<string, Site>>(new Map());
  const [status, setStatus] = useState<'open' | 'all'>('open');

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([listDefects(), listSites()]);
    setDefects(d);
    setSites(new Map(s.map((x) => [x.id, x])));
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = defects.filter((d) => (status === 'open' ? d.status === 'open' : true));

  /** Age in days, which is what makes an outstanding list feel urgent. */
  const ageDays = (iso: string): number => {
    const then = Date.parse(iso);
    return Number.isFinite(then) ? Math.floor((Date.now() - then) / 86_400_000) : 0;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Defects' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]}
          />
          <Button title="Raise a defect" onPress={() => router.push('/work/defect/new')} />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={<EmptyState title={status === 'open' ? 'Nothing outstanding' : 'No defects recorded'} body="Defects raised on site appear here until they are cleared." />}
          renderItem={({ item }) => {
            const days = ageDays(item.raisedAt);
            return (
              <Card>
                <Rowed align="flex-start" gap={2}>
                  <View style={{ flex: 1 }}>
                    <Rowed gap={2} wrap>
                      <Chip label={item.severity === 'critical' ? 'CRITICAL' : 'Non-critical'} tone={item.severity === 'critical' ? 'fail' : 'warn'} />
                      <Chip label={item.status} tone={item.status === 'open' ? 'default' : 'pass'} />
                      {days > 30 ? <Chip label={`${days} days old`} tone="fail" /> : days > 0 ? <Chip label={`${days}d`} /> : null}
                    </Rowed>
                    <Txt weight="700" style={{ marginTop: t.space(1.5) }} numberOfLines={1}>{item.location}</Txt>
                    <Txt size="sm" tone="muted" numberOfLines={3} style={{ lineHeight: 19 }}>{item.description}</Txt>
                    <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>
                      {sites.get(item.siteId)?.name ?? 'Unknown site'} · raised {formatAuDate(item.raisedAt)}
                      {item.photos.length ? ` · ${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}` : ''}
                    </Txt>
                  </View>
                </Rowed>
                {item.status === 'open' ? (
                  <Rowed gap={2} style={{ marginTop: t.space(2.5) }}>
                    <Button
                      title="Rectified"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      onPress={async () => {
                        await updateDefect(item.id, { status: 'rectified', rectifiedAt: new Date().toISOString() });
                        void load();
                      }}
                    />
                    <Button
                      title="Quoted"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      onPress={async () => { await updateDefect(item.id, { status: 'quoted' }); void load(); }}
                    />
                  </Rowed>
                ) : null}
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
