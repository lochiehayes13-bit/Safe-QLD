import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  STANDARDS, type StandardDoc, type StandardScope,
} from '@/domain/standardsCatalogue';
import { ask, explainQuery, type Answer } from '@/domain/ask';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * The standards library.
 *
 * A technician carries about thirty documents' worth of obligation and can hold
 * maybe five clause numbers in their head. This is the rest of it, offline, in a
 * plant room with no signal.
 *
 * It searches the documents the way the question gets asked rather than the way
 * the document is worded — "how far off the wall can a detector go" lands on
 * AS 1670.1 clause 5.1.4, whose heading shares exactly one word with that
 * question. The search shows what it understood, so it is never a black box.
 *
 * What it does not do is quote the standard. Clause numbers are facts and ship
 * here; the wording is licensed per copy and stays in the technician's own copy.
 * Where nobody has written up what a clause covers, the entry says so rather
 * than inventing a summary — a confident wrong answer about a fire system is the
 * failure this whole app is built to avoid.
 */

const SCOPE_LABEL: Record<StandardScope, string> = {
  design: 'Design',
  maintenance: 'Maintenance',
  product: 'Product',
  legislation: 'Legislation',
  code: 'Code',
};

const SCOPE_TONE: Record<StandardScope, 'default' | 'accent' | 'warn'> = {
  design: 'default',
  maintenance: 'accent',
  product: 'default',
  legislation: 'warn',
  code: 'warn',
};

const KIND_ICON: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  clause: 'book-open-variant',
  routine: 'clipboard-check-outline',
  defect: 'alert-octagon-outline',
  eol: 'resistor-nodes',
  protocol: 'toggle-switch-outline',
  'asset-type': 'shape-outline',
  calculator: 'calculator-variant-outline',
};

/** Suggestions that show what the search is actually good at, in the trade's words. */
const EXAMPLES = [
  'how far off the wall can a detector go',
  'how loud does the alarm need to be',
  'can I still use this extinguisher',
  'AS 2419.1 clause 10.4',
  'emergency light discharge test',
  'what do I write for a critical defect',
];

export default function LibraryScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [system, setSystem] = useState<string | null>(null);

  const q = query.trim();
  const searching = q.length >= 2;

  const results = useMemo(() => (searching ? ask(q, 25) : []), [q, searching]);
  const reading = useMemo(() => (searching ? explainQuery(q) : null), [q, searching]);

  const systems = useMemo(() => {
    const seen = new Set<string>();
    for (const d of STANDARDS) for (const s of d.systems) seen.add(s);
    return [...seen].sort();
  }, []);

  const shown = useMemo(
    () => (system ? STANDARDS.filter((d) => d.systems.includes(system)) : STANDARDS),
    [system],
  );

  const clauseCount = useMemo(
    () => STANDARDS.reduce((n, d) => n + d.clauses.length, 0),
    [],
  );
  const writtenUp = useMemo(
    () => STANDARDS.reduce((n, d) => n + d.clauses.filter((c) => c.covers).length, 0),
    [],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Standards' }} />
      <Screen>
        <Field
          label="Ask it the way you would ask a mate"
          value={query}
          onChangeText={setQuery}
          placeholder="how far off the wall can a detector go"
          autoCapitalize="none"
        />

        {searching && reading ? (
          <View>
            {reading.readings.length ? (
              <Rowed gap={2} align="center" style={{ marginTop: t.space(1) }}>
                <MaterialCommunityIcons name="lightbulb-on-outline" size={15} color={t.color.accentText} />
                <Txt size="xs" tone="accent" style={{ flex: 1 }}>
                  Read as {reading.readings.join(', and ')}.
                </Txt>
              </Rowed>
            ) : null}
            {reading.alsoSearched.length ? (
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 16 }}>
                Also searched: {reading.alsoSearched.join(', ')}.
              </Txt>
            ) : null}
          </View>
        ) : null}

        {searching && !results.length ? (
          <Banner
            tone="warn"
            title="I do not know"
            body={
              'Nothing here answers that. It is a search over what this app holds, not a language '
              + 'model, so it would rather say nothing than hand you the nearest thing lying about. '
              + 'Try the equipment name, or a clause reference like "AS 2419.1 10.4".'
            }
          />
        ) : null}

        {searching ? (
          results.map((a, i) => <Result key={`${a.kind}-${a.title}-${i}`} answer={a} />)
        ) : (
          <>
            <Card>
              <Rowed gap={2} align="center">
                <MaterialCommunityIcons name="bookshelf" size={22} color={t.color.accentText} />
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{STANDARDS.length} documents · {clauseCount} clauses</Txt>
                  <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
                    {writtenUp} written up in plain English. The rest are listed so they can be
                    found and cited, and say nothing further rather than guessing.
                  </Txt>
                </View>
              </Rowed>
            </Card>

            <H2>Try asking</H2>
            {EXAMPLES.map((e) => (
              <Pressable key={e} onPress={() => setQuery(e)}>
                <Rowed gap={2} align="center" style={{ paddingVertical: t.space(2) }}>
                  <MaterialCommunityIcons name="magnify" size={16} color={t.color.textFaint} />
                  <Txt size="sm" tone="muted" style={{ flex: 1 }}>{e}</Txt>
                </Rowed>
              </Pressable>
            ))}

            <H2>The catalogue</H2>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Rowed gap={2}>
                <Pressable onPress={() => setSystem(null)}>
                  <Chip label="All" tone={system === null ? 'accent' : 'default'} />
                </Pressable>
                {systems.map((s) => (
                  <Pressable key={s} onPress={() => setSystem(s === system ? null : s)}>
                    <Chip
                      label={SYSTEM_LABELS[s as keyof typeof SYSTEM_LABELS] ?? s}
                      tone={s === system ? 'accent' : 'default'}
                    />
                  </Pressable>
                ))}
              </Rowed>
            </ScrollView>

            {shown.map((d) => <DocCard key={d.id} doc={d} />)}

            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Clause numbers and titles were read out of the documents themselves rather than
              recalled, so they can be cited. The wording of an Australian Standard is licensed per
              copy and is not held here — open your own copy at the clause this points you to.
            </Txt>
          </>
        )}
      </Screen>
    </>
  );
}

function Result({ answer }: { answer: Answer }) {
  const t = useTheme();
  const tone = answer.confidence === 'high' ? 'muted' : answer.confidence === 'low' ? 'warn' : 'muted';
  return (
    <Card onPress={answer.route ? () => router.push(answer.route as never) : undefined}>
      <Rowed gap={2} align="flex-start">
        <MaterialCommunityIcons
          name={KIND_ICON[answer.kind] ?? 'file-outline'}
          size={18}
          color={answer.kind === 'clause' ? t.color.accentText : t.color.textFaint}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="700" size="sm">{answer.title}</Txt>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
            {answer.body}
          </Txt>
          <Rowed gap={2} align="center" style={{ marginTop: t.space(1.5) }}>
            <Txt size="xs" tone={tone} style={{ flex: 1 }}>{answer.source}</Txt>
            {answer.confidence !== 'high' ? (
              <Chip label={answer.confidence} tone="warn" />
            ) : null}
          </Rowed>
        </View>
      </Rowed>
    </Card>
  );
}

function DocCard({ doc }: { doc: StandardDoc }) {
  const t = useTheme();
  const written = doc.clauses.filter((c) => c.covers).length;
  return (
    <Card onPress={() => router.push(`/library/${doc.id}` as never)}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Rowed gap={2} align="center">
            <Txt weight="700">{doc.designation}</Txt>
            <Chip label={SCOPE_LABEL[doc.scope]} tone={SCOPE_TONE[doc.scope]} />
            {doc.status === 'superseded' ? <Chip label="Superseded" tone="warn" /> : null}
          </Rowed>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
            {doc.title}
          </Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
            {doc.clauses.length} clause{doc.clauses.length === 1 ? '' : 's'}
            {written ? ` · ${written} written up` : ''}
            {doc.supersededBy ? ` · superseded by ${doc.supersededBy}` : ''}
          </Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
