import React, { useCallback, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { listPurchaseRequests, setPurchaseStatus, type PurchaseRequest } from '@/db/opsRepo';
import { queuePurchaseOrder } from '@/simpro/sync';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/** Purchase requests — parts to order, ready to push to Simpro. */
export default function PurchasesScreen() {
  const t = useTheme();
  const [items, setItems] = useState<PurchaseRequest[]>([]);

  const load = useCallback(async () => setItems(await listPurchaseRequests()), []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * Sends a request to the office.
   *
   * Queued rather than sent: a technician in a basement has no signal, and a
   * parts order lost to that is the failure this app exists to avoid. It leaves
   * with the next sync from Settings.
   *
   * The status only moves once the queue has actually accepted it. Marking a
   * request submitted and then failing to queue it would leave a request nobody
   * is working on and nobody knows is stuck.
   */
  const submit = async (item: PurchaseRequest) => {
    try {
      await queuePurchaseOrder({
        jobId: item.jobId,
        notes: item.notes,
        lines: item.lines.map((l) => ({
          partNumber: l.partNumber,
          description: l.description,
          quantity: l.quantity,
        })),
      });
      await setPurchaseStatus(item.id, 'submitted');
      void load();
      Alert.alert(
        'Queued for the office',
        'It goes out with the next Simpro sync. Nothing is lost if you are out of signal.',
      );
    } catch (e) {
      Alert.alert('Could not queue it', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Purchase requests' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            <EmptyState
              title="Nothing on order"
              body="Requests raised from van stock or from a defect's quote lines appear here before they go to the office."
            />
          }
          renderItem={({ item }) => (
            <Card>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{item.lines.length} line{item.lines.length === 1 ? '' : 's'}</Txt>
                  <Txt size="sm" tone="muted">
                    {item.supplier ?? 'Supplier not set'} · {formatAuDate(item.createdAt)}
                  </Txt>
                </View>
                <Chip
                  label={item.status}
                  tone={item.status === 'received' ? 'pass' : item.status === 'draft' ? 'warn' : 'default'}
                />
              </Rowed>
              <View style={{ marginTop: t.space(2), gap: 4 }}>
                {item.lines.slice(0, 5).map((l, i) => (
                  <Rowed key={i} style={{ justifyContent: 'space-between' }}>
                    <Txt size="sm" style={{ flex: 1 }} numberOfLines={1}>{l.description}</Txt>
                    <Txt size="sm" tone="muted">× {l.quantity}</Txt>
                  </Rowed>
                ))}
                {item.lines.length > 5 ? <Txt size="xs" tone="faint">+{item.lines.length - 5} more</Txt> : null}
              </View>
              {item.status === 'draft' ? (
                <Button
                  title="Submit to office"
                  compact
                  style={{ marginTop: t.space(2.5) }}
                  onPress={() => void submit(item)}
                />
              ) : null}
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
