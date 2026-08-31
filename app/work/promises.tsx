import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { completePromise, createPromise, listPromises, type Promise_ } from '@/db/opsRepo';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, EmptyState, Field, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Promises.
 *
 * "I'll come back tomorrow with the part" is the most commonly broken sentence
 * in field work, because it lives in someone's head. Recording it here means it
 * survives the drive home.
 */
export default function PromisesScreen() {
  const t = useTheme();
  const [items, setItems] = useState<Promise_[]>([]);
  const [what, setWhat] = useState('');

  const load = useCallback(async () => setItems(await listPromises(true)), []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const add = async () => {
    if (!what.trim()) return;
    await createPromise({ what: what.trim() });
    setWhat('');
    void load();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Promises' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={
            <View style={{ gap: t.space(2), marginBottom: t.space(1) }}>
              <Field
                label="What did you say you'd do?"
                value={what}
                onChangeText={setWhat}
                placeholder="Return Thursday with a 4k7 EOL for zone 3"
              />
              <Button title="Add" onPress={add} disabled={!what.trim()} />
            </View>
          }
          ListEmptyComponent={<EmptyState title="Nothing outstanding" body="Anything you commit to on site can go here so it does not rely on memory." />}
          renderItem={({ item }) => (
            <Card>
              <Rowed gap={3}>
                <Pressable
                  onPress={async () => { await completePromise(item.id); void load(); }}
                  hitSlop={10}
                >
                  <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={24} color={t.color.textFaint} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Txt weight="600">{item.what}</Txt>
                  <Txt size="xs" tone="faint">
                    Added {formatAuDate(item.createdAt)}{item.dueAt ? ` · due ${formatAuDate(item.dueAt)}` : ''}
                  </Txt>
                </View>
              </Rowed>
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
