import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { recurringFailures, type RecurringFailure } from '@/db/assetRepo';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Assets that keep failing.
 *
 * Three failures on one detector is a location or environment problem, not
 * three unrelated faults — and replacing it a fourth time will not fix it.
 */
export default function RecurringScreen() {
  const t = useTheme();
  const [items, setItems] = useState<RecurringFailure[]>([]);

  const load = useCallback(async () => setItems(await recurringFailures(undefined, 2)), []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <>
      <Stack.Screen options={{ title: 'Recurring failures' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={items}
          keyExtractor={(r) => r.assetId}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={
            items.length ? (
              <Banner
                tone="warn"
                title="Worth a root cause, not another swap"
                body="Repeated failure on the same asset usually means the environment, the location or the device type is wrong for the job."
              />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing failing repeatedly"
              body="Once assets have a few services behind them, anything failing more than once will show up here."
            />
          }
          renderItem={({ item }) => (
            <Card>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{item.assetName}</Txt>
                  {item.assetCode ? <Txt size="sm" mono tone="muted">{item.assetCode}</Txt> : null}
                  <Txt size="sm" tone="faint" style={{ marginTop: 4 }}>
                    First {formatAuDate(item.firstAt)} · most recent {formatAuDate(item.lastAt)}
                  </Txt>
                </View>
                <Chip label={`${item.failures} failures`} tone="fail" />
              </Rowed>
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
