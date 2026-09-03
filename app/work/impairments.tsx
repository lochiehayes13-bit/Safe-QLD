import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { listImpairments, impairmentElapsedMs, impairmentOutstanding, type ImpairmentRecord } from '@/db/opsRepo';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { describeLoadFailure } from '@/domain/loadFailure';

export default function ImpairmentsScreen() {
  const t = useTheme();
  const [items, setItems] = useState<ImpairmentRecord[]>([]);
  const [scope, setScope] = useState<'open' | 'all'>('open');

  /*
   * "No systems impaired" is a statement about live fire protection, and an
   * empty list was making it whether the read had worked or not. A throw in a
   * `void load()` reaches nothing, so the list stayed empty and the screen said
   * every system was up — which is the one wrong answer this screen must never
   * give.
   */
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setItems(await listImpairments(scope === 'open'));
    } catch (e) {
      setItems([]);
      setFailed(describeLoadFailure(e, 'the impairments on this device'));
    }
  }, [scope]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const duration = (rec: ImpairmentRecord): string => {
    const ms = impairmentElapsedMs(rec);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Impairments' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <Segmented value={scope} onChange={setScope} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
          <Button title="Declare impairment" variant="danger" onPress={() => router.push('/impairment/new')} />
          {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
        </View>
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={failed ? null : <EmptyState title="No systems impaired" body="Declaring an impairment here keeps the clock and the notifications visible until the system is back." />}
          renderItem={({ item }) => {
            const outstanding = impairmentOutstanding(item);
            return (
              <Card onPress={() => router.push({ pathname: '/impairment/[id]', params: { id: item.id } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700">{item.system}</Txt>
                    <Txt size="sm" tone="muted" numberOfLines={2}>{item.scope}</Txt>
                  </View>
                  <Chip label={duration(item)} tone={item.restoredAt ? 'pass' : 'fail'} />
                </Rowed>
                {!item.restoredAt && outstanding.length ? (
                  <Txt size="xs" tone="warn" style={{ marginTop: t.space(2) }}>
                    {outstanding.length} outstanding: {outstanding.join(', ')}
                  </Txt>
                ) : null}
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
