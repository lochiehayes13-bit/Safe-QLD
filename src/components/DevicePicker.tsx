import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { queryCatalogue, type CatalogueItem } from '@/db/catalogueRepo';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from './ui';

/**
 * Picks a device out of the parts catalogue.
 *
 * Only rows carrying a published current are offered, because the whole point
 * of picking here rather than typing is that the figures come from a datasheet
 * rather than from memory. The confidence of each row is shown, so a low
 * confidence figure is a deliberate choice rather than a silent one.
 */
export function DevicePicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (item: CatalogueItem) => void;
}) {
  const t = useTheme();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<CatalogueItem[]>([]);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(h);
  }, [search]);

  const load = useCallback(async () => {
    setItems(await queryCatalogue({ search: debounced, withCurrents: true, limit: 120 }));
  }, [debounced]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <Screen scroll={false} padded={false} edges={['top']}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt size="lg" weight="700">Pick a device</Txt>
            <Button title="Close" variant="ghost" compact onPress={onClose} />
          </Rowed>

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
              placeholder="Part number or model"
              placeholderTextColor={t.color.textFaint}
              autoCapitalize="none"
              autoFocus
              style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
            />
          </View>

          <Txt size="xs" tone="faint">
            Only devices with a published current are listed — {items.length} shown.
          </Txt>
        </View>

        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(10), gap: t.space(2) }}
          initialNumToRender={12}
          removeClippedSubviews
          ListEmptyComponent={
            <EmptyState
              title="Nothing matched"
              body="Try the part number on its own. Devices without a published current figure are deliberately not offered here."
            />
          }
          renderItem={({ item }) => (
            <Card onPress={() => { onPick(item); onClose(); }}>
              <Rowed align="flex-start" gap={2}>
                <View style={{ flex: 1 }}>
                  <Rowed gap={2}>
                    <Txt mono size="sm" weight="700" tone="accent">{item.partNumber}</Txt>
                    <Txt size="xs" tone="faint">{item.brand}</Txt>
                  </Rowed>
                  <Txt weight="600" numberOfLines={2}>{item.name}</Txt>
                  <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
                    {item.quiescentMa !== null && item.quiescentMa !== undefined ? `${item.quiescentMa} mA standby` : 'standby not published'}
                    {item.alarmMa !== null && item.alarmMa !== undefined ? ` · ${item.alarmMa} mA alarm` : ''}
                    {item.voltage ? ` · ${item.voltage}` : ''}
                  </Txt>
                </View>
                <Chip
                  label={item.confidence}
                  tone={item.confidence === 'high' ? 'pass' : item.confidence === 'low' ? 'warn' : 'default'}
                />
              </Rowed>
            </Card>
          )}
        />
      </Screen>
    </Modal>
  );
}
