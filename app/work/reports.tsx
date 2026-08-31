import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { listReports, listSites } from '@/db/repo';
import type { ServiceReport, Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

export default function ReportsScreen() {
  const t = useTheme();
  const [reports, setReports] = useState<ServiceReport[]>([]);
  const [sites, setSites] = useState<Map<string, Site>>(new Map());

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([listReports(), listSites()]);
    setReports(r);
    setSites(new Map(s.map((x) => [x.id, x])));
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <>
      <Stack.Screen options={{ title: 'Test sheets' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={<EmptyState title="No test sheets yet" body="Open a site and start one. It stays on this device until you export or share it." />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/report/[id]', params: { id: item.id } })}>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700" numberOfLines={1}>{item.title}</Txt>
                  <Txt size="sm" tone="muted" numberOfLines={1}>{sites.get(item.siteId)?.name ?? 'Unknown site'}</Txt>
                  <Txt size="sm" tone="faint">
                    {item.frequency} · {formatAuDate(item.serviceDate)}{item.technicianName ? ` · ${item.technicianName}` : ''}
                  </Txt>
                </View>
                <Chip label={item.status === 'complete' ? 'Complete' : 'Draft'} tone={item.status === 'complete' ? 'pass' : 'warn'} />
              </Rowed>
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
