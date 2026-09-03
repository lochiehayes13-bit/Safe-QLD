import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COVERAGE, KIND_LABEL, ask, type Answer } from '@/domain/ask';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Ask Safe QLD.
 *
 * A search across everything the app holds — routines, defect codes,
 * end-of-line values, addressing, equipment, calculators — not a language
 * model. That distinction is on the screen, because a thing that answers in
 * confident sentences and is wrong is far more dangerous halfway up a ladder
 * than a thing that hands you the entry and lets you read it.
 *
 * Every answer names its source and its confidence, and a question nothing
 * matches gets a plain "I don't know" with a list of what it does cover. The
 * failure mode worth engineering against here is not missing an answer; it is
 * inventing one.
 */
export default function AskScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(h);
  }, [query]);

  const answers = useMemo(() => ask(debounced), [debounced]);
  const asked = debounced.trim().length >= 2;

  return (
    <>
      <Stack.Screen options={{ title: 'Ask Safe QLD' }} />
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
              value={query}
              onChangeText={setQuery}
              placeholder="A defect code, a panel, a check, a calculation"
              placeholderTextColor={t.color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: t.color.text, fontSize: 16, paddingVertical: t.space(2.5) }}
            />
          </View>

          {!asked ? (
            <Banner
              tone="info"
              title="This searches what the app holds — it is not an AI"
              body="It will not write you an answer. It finds the entry, names where it came from and how far to trust it, and says so plainly when it has nothing."
            />
          ) : null}
        </View>

        <FlatList
          data={answers}
          keyExtractor={(a, i) => `${a.kind}:${a.title}:${i}`}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            asked ? (
              <View style={{ gap: t.space(3) }}>
                <Banner
                  tone="warn"
                  title="I don't know"
                  body={`Nothing held here answers "${debounced.trim()}". Rather than give you the nearest thing lying around, here is what this can actually answer.`}
                />
                {COVERAGE.map((line) => (
                  <Rowed key={line} gap={2} align="flex-start">
                    <MaterialCommunityIcons name="circle-small" size={20} color={t.color.textFaint} />
                    <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{line}</Txt>
                  </Rowed>
                ))}
                <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                  Standards themselves are not held here. Where a figure or an interval has to come from the current
                  standard or a manufacturer's manual, that is where to get it.
                </Txt>
              </View>
            ) : null
          }
          renderItem={({ item }) => <AnswerCard answer={item} />}
        />
      </Screen>
    </>
  );
}

function AnswerCard({ answer }: { answer: Answer }) {
  const t = useTheme();
  const tone = answer.confidence === 'high' ? 'pass' : answer.confidence === 'low' ? 'fail' : 'warn';

  return (
    <Card onPress={answer.route ? () => router.push(answer.route as never) : undefined}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Chip label={KIND_LABEL[answer.kind]} />
          <Txt weight="700" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>{answer.title}</Txt>
          {answer.body ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 3, lineHeight: 19 }}>{answer.body}</Txt>
          ) : null}
        </View>
        {answer.route ? (
          <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
        ) : null}
      </Rowed>

      <Rowed gap={2} wrap style={{ marginTop: t.space(2.5) }}>
        <Chip
          label={
            answer.confidence === 'high' ? 'Confident'
              : answer.confidence === 'medium' ? 'Reasonably sure'
              : 'Check the source'
          }
          tone={tone}
        />
        <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 17 }}>{answer.source}</Txt>
      </Rowed>

      {answer.confidence === 'low' ? (
        <Txt size="xs" tone="warn" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
          The actual figure or interval has to come from the current standard or the manufacturer's documentation, not
          from here.
        </Txt>
      ) : null}
    </Card>
  );
}
