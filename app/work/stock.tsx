import React, { useCallback, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  createPurchaseRequest, createStockLocation, listStock, listStockLocations,
  restockNeeded, upsertStock, type StockItem, type StockLocation,
} from '@/db/opsRepo';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Field, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Van and workshop stock.
 *
 * The useful question is not "what do I have" but "will tomorrow's work leave
 * me short", so anything at or below its minimum is surfaced first and can be
 * turned into a purchase request in one action.
 */
export default function StockScreen() {
  const t = useTheme();
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [active, setActive] = useState<string>();
  const [items, setItems] = useState<StockItem[]>([]);
  const [low, setLow] = useState<StockItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [part, setPart] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('');
  const [min, setMin] = useState('');

  const load = useCallback(async () => {
    const locs = await listStockLocations();
    setLocations(locs);
    const current = active ?? locs[0]?.id;
    setActive(current);
    setItems(await listStock(current));
    setLow(await restockNeeded(current));
  }, [active]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const addVan = async () => {
    const prefs = await loadPrefs();
    const loc = await createStockLocation(prefs.vehicleRego ? `Van ${prefs.vehicleRego}` : 'My van', 'van', prefs.technicianName);
    setActive(loc.id);
    void load();
  };

  const addItem = async () => {
    if (!active || !part.trim()) return;
    await upsertStock({
      locationId: active,
      partNumber: part.trim(),
      description: desc.trim() || part.trim(),
      quantity: parseFloat(qty) || 0,
      minimum: parseFloat(min) || 0,
    });
    setPart(''); setDesc(''); setQty(''); setMin('');
    setAdding(false);
    void load();
  };

  const requestRestock = async () => {
    if (!low.length) return;
    const prefs = await loadPrefs();
    await createPurchaseRequest({
      requestedBy: prefs.technicianName,
      lines: low.map((i) => ({
        partNumber: i.partNumber,
        description: i.description,
        // Order back up to the minimum, plus one so it is not immediately low again.
        quantity: Math.max(1, i.minimum - i.quantity + 1),
      })),
      notes: 'Automatic restock request from van stock levels.',
    });
    Alert.alert('Restock requested', `${low.length} line${low.length === 1 ? '' : 's'} added to a purchase request.`);
    router.push('/work/purchases');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Stock' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          {locations.length ? (
            <Rowed gap={2} wrap>
              {locations.map((l) => (
                <Chip
                  key={l.id}
                  label={l.label}
                  selected={active === l.id}
                  onPress={() => { setActive(l.id); void load(); }}
                />
              ))}
            </Rowed>
          ) : (
            <Button title="Set up my van" onPress={addVan} />
          )}

          {low.length ? (
            <>
              <Banner
                tone="warn"
                title={`${low.length} line${low.length === 1 ? '' : 's'} at or below minimum`}
                body={low.slice(0, 4).map((i) => `${i.description} — ${i.quantity} left`).join('\n')}
              />
              <Button title="Request restock" onPress={requestRestock} />
            </>
          ) : null}

          {active ? (
            adding ? (
              <Card>
                <Field label="Part number" value={part} onChangeText={setPart} autoCapitalize="characters" />
                <View style={{ height: t.space(2) }} />
                <Field label="Description" value={desc} onChangeText={setDesc} />
                <View style={{ height: t.space(2) }} />
                <Rowed gap={2} align="flex-start">
                  <View style={{ flex: 1 }}><Field label="Qty" value={qty} onChangeText={setQty} keyboardType="numeric" /></View>
                  <View style={{ flex: 1 }}><Field label="Minimum" value={min} onChangeText={setMin} keyboardType="numeric" /></View>
                </Rowed>
                <View style={{ height: t.space(2.5) }} />
                <Rowed gap={2}>
                  <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setAdding(false)} />
                  <Button title="Add" style={{ flex: 1 }} onPress={addItem} disabled={!part.trim()} />
                </Rowed>
              </Card>
            ) : (
              <Button
                title="Add stock line"
                variant="secondary"
                onPress={() => setAdding(true)}
                icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
              />
            )
          ) : null}
        </View>

        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(2), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            active ? <EmptyState title="Nothing recorded" body="Add the parts you actually carry, with a minimum, and the app will tell you when you are running out." /> : null
          }
          renderItem={({ item }) => {
            const isLow = item.quantity <= item.minimum;
            return (
              <Card>
                <Rowed align="center" gap={2}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="600" numberOfLines={1}>{item.description}</Txt>
                    <Txt size="sm" mono tone="muted">{item.partNumber}</Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt size="xl" weight="700" tone={isLow ? 'warn' : 'default'}>{item.quantity}</Txt>
                    <Txt size="xs" tone="faint">min {item.minimum}</Txt>
                  </View>
                  <Rowed gap={1}>
                    <Button title="−" variant="secondary" compact onPress={async () => { await upsertStock({ ...item, quantity: Math.max(0, item.quantity - 1) }); void load(); }} />
                    <Button title="+" variant="secondary" compact onPress={async () => { await upsertStock({ ...item, quantity: item.quantity + 1 }); void load(); }} />
                  </Rowed>
                </Rowed>
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
