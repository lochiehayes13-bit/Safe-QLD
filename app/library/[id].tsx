import React, { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { STANDARDS, type StandardClause } from '@/domain/standardsCatalogue';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { normalise } from '@/domain/tradeVocabulary';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * One standard, clause by clause.
 *
 * The useful thing on site is not the document — it is knowing which clause to
 * open, and whether it is the clause that actually governs what you are looking
 * at. So this is an index that says what each clause is for, in plain English,
 * and jumps to the part of the app that implements or checks it.
 *
 * Two honesty rules run through it. A clause nobody has written up says exactly
 * that instead of a generated summary. And a superseded edition is labelled as
 * one at the top — most Queensland sites are maintained to the edition they were
 * built under, so a superseded standard is often the right one to be reading,
 * but quoting it at a client without saying so is another matter.
 */
export default function StandardScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [filter, setFilter] = useState('');

  const doc = useMemo(() => STANDARDS.find((d) => d.id === id), [id]);

  const clauses = useMemo(() => {
    if (!doc) return [];
    const q = normalise(filter);
    if (!q) return doc.clauses;
    return doc.clauses.filter((c) => normalise(`${c.ref} ${c.title} ${c.covers ?? ''}`).includes(q));
  }, [doc, filter]);

  if (!doc) {
    return (
      <Screen>
        <Banner
          tone="warn"
          title="No such document"
          body="This standard is not in the catalogue. It may have been referenced by a clause that has since been removed."
        />
      </Screen>
    );
  }

  const written = doc.clauses.filter((c) => c.covers).length;

  return (
    <>
      <Stack.Screen options={{ title: doc.designation }} />
      <Screen>
        <Card>
          <Txt weight="700" size="lg">{doc.designation}</Txt>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 20 }}>
            {doc.title}
          </Txt>
          <Rowed gap={2} align="center" style={{ marginTop: t.space(2), flexWrap: 'wrap' }}>
            {doc.systems.map((s) => (
              <Chip key={s} label={SYSTEM_LABELS[s as keyof typeof SYSTEM_LABELS] ?? s} />
            ))}
          </Rowed>
        </Card>

        {doc.status === 'superseded' && doc.supersededBy ? (
          <Banner
            tone="warn"
            title={`Superseded by ${doc.supersededBy}`}
            body={
              'Most sites are maintained to the edition they were built under, so this is often the '
              + 'right document to be reading. It is worth saying which edition you worked to on the '
              + 'record, because a client reading a withdrawn reference will ask.'
            }
          />
        ) : null}

        {doc.note ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>{doc.note}</Txt>
        ) : null}

        <Field
          label="Find a clause"
          value={filter}
          onChangeText={setFilter}
          placeholder="block plan, pressure test, 10.4"
          autoCapitalize="none"
        />

        <H2>
          {clauses.length === doc.clauses.length
            ? `${doc.clauses.length} clauses`
            : `${clauses.length} of ${doc.clauses.length} clauses`}
        </H2>

        {!clauses.length ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            Nothing in this document matches that. The index holds clause numbers and titles, not
            the standard's wording, so a phrase from inside a clause will not be found here.
          </Txt>
        ) : null}

        <Card>
          {clauses.map((c, i) => (
            <View key={`${c.ref}-${i}`}>
              {i > 0 ? <Divider /> : null}
              <ClauseRow clause={c} />
            </View>
          ))}
        </Card>

        <Card>
          <Txt size="sm" weight="700">The wording is not held here</Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
            {written} of {doc.clauses.length} clauses carry a description written for this app. The
            standard's own text is licensed per copy and is not in this application — open your own
            copy at the clause above. Clause numbers and titles were read out of the document
            itself, so they can be cited with confidence.
          </Txt>
          <View style={{ height: t.space(3) }} />
          <Button
            title="Where to get this standard"
            variant="secondary"
            compact
            onPress={() => void Linking.openURL(doc.officialUrl)}
          />
        </Card>
      </Screen>
    </>
  );
}

function ClauseRow({ clause }: { clause: StandardClause }) {
  const t = useTheme();
  const body = (
    <Rowed gap={2} align="flex-start" style={{ paddingVertical: t.space(2) }}>
      <View style={{ width: 74 }}>
        <Txt size="sm" weight="700" style={{ fontFamily: t.font.mono }}>{clause.ref}</Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt size="sm">{clause.title}</Txt>
        {clause.covers ? (
          <Txt size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>
            {clause.covers}
          </Txt>
        ) : (
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>
            Not written up. Listed so it can be found and cited; the app is not going to guess what
            it says.
          </Txt>
        )}
        {clause.appFeature ? (
          <Rowed gap={2} align="center" style={{ marginTop: t.space(1.5) }}>
            <MaterialCommunityIcons name="arrow-right-circle-outline" size={14} color={t.color.accentText} />
            <Txt size="xs" tone="accent">Open what checks this</Txt>
          </Rowed>
        ) : null}
      </View>
    </Rowed>
  );

  if (!clause.appFeature) return body;
  return (
    <Pressable onPress={() => router.push(`/${clause.appFeature}` as never)}>{body}</Pressable>
  );
}
