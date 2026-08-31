import React, { useCallback, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createKnowledge, listKnowledge, setKnowledgeStatus, type KnowledgeNote } from '@/db/opsRepo';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Field, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Company knowledge.
 *
 * Everything a technician learns the hard way is worth keeping, but a passing
 * remark must never become company policy by accident — hence the verification
 * state on every note, shown wherever the note is used.
 */
const STATUS_LABEL: Record<KnowledgeNote['status'], string> = {
  unverified: 'Unverified',
  verified: 'Verified',
  'manufacturer-confirmed': 'Manufacturer confirmed',
  superseded: 'Superseded',
};

export default function KnowledgeScreen() {
  const t = useTheme();
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = useCallback(async () => setNotes(await listKnowledge({ search })), [search]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const add = async () => {
    if (!title.trim()) return;
    const prefs = await loadPrefs();
    await createKnowledge({ title: title.trim(), body: body.trim(), author: prefs.technicianName });
    setTitle(''); setBody(''); setAdding(false);
    void load();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Company knowledge' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
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
              placeholder="Search what people have found"
              placeholderTextColor={t.color.textFaint}
              style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
            />
          </View>

          {adding ? (
            <Card>
              <Field label="What did you find?" value={title} onChangeText={setTitle} placeholder="MX1 shows UNDR on a device left at 255" />
              <View style={{ height: t.space(2) }} />
              <Field label="Detail" value={body} onChangeText={setBody} multiline />
              <View style={{ height: t.space(2.5) }} />
              <Rowed gap={2}>
                <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setAdding(false)} />
                <Button title="Submit" style={{ flex: 1 }} onPress={add} disabled={!title.trim()} />
              </Rowed>
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                Notes start unverified. A senior technician marks them verified before they read as company guidance.
              </Txt>
            </Card>
          ) : (
            <Button title="Add something you learned" variant="secondary" onPress={() => setAdding(true)} />
          )}
        </View>

        <FlatList
          data={notes}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            <EmptyState
              title={search ? 'Nothing matched' : 'No notes yet'}
              body="Panel quirks, difficult sites, access tricks, common faults — the things that normally live in one person's head."
            />
          }
          renderItem={({ item }) => (
            <Card>
              <Rowed align="flex-start" gap={2}>
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{item.title}</Txt>
                  {item.body ? <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 20 }}>{item.body}</Txt> : null}
                  <Txt size="xs" tone="faint" style={{ marginTop: 6 }}>
                    {item.author ?? 'Unknown'}{item.model ? ` · ${item.model}` : ''}
                  </Txt>
                </View>
                <Chip
                  label={STATUS_LABEL[item.status]}
                  tone={item.status === 'unverified' ? 'warn' : item.status === 'superseded' ? 'default' : 'pass'}
                />
              </Rowed>
              {item.status === 'unverified' ? (
                <Button
                  title="Mark verified"
                  variant="secondary"
                  compact
                  style={{ marginTop: t.space(2.5) }}
                  onPress={async () => { await setKnowledgeStatus(item.id, 'verified'); void load(); }}
                />
              ) : null}
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
