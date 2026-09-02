import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  type StandardDoc, type StandardScope,
} from '@/domain/standardsCatalogue';
import { EXPLAINED_CLAUSES, LIBRARY, TOTAL_CLAUSES } from '@/domain/standardsLibrary';
import { ask, explainQuery, type Answer } from '@/domain/ask';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import {
  deleteLibraryDoc, importPdf, libraryPage, listLibraryDocs, searchLibrary, type LibraryDoc,
} from '@/db/libraryRepo';
import type { PageHit } from '@/domain/docSearch';
import { askGrounded, hasKey } from '@/ai/client';
import type { GroundedAnswer, Passage } from '@/ai/grounding';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Field, H2, Rowed, Screen, Txt,
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
  // Opened from the question bar on the home screen, so a technician's question
  // survives the navigation rather than making them type it twice.
  const { q: initial } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(initial ?? '');
  // Searched a beat after the last keystroke rather than on every one. The
  // clause search runs over the whole index and the document search is a
  // database query, and doing both per character made typing stutter.
  const [debounced, setDebounced] = useState(initial ?? '');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(h);
  }, [query]);
  const [system, setSystem] = useState<string | null>(null);
  const [mine, setMine] = useState<LibraryDoc[]>([]);
  const [pageHits, setPageHits] = useState<PageHit[]>([]);
  const [importing, setImporting] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [thinking, setThinking] = useState(false);

  const q = debounced.trim();
  const searching = q.length >= 2;

  const results = useMemo(() => (searching ? ask(q, 25) : []), [q, searching]);
  const reading = useMemo(() => (searching ? explainQuery(q) : null), [q, searching]);

  const load = useCallback(async () => { setMine(await listLibraryDocs()); }, []);
  useEffect(() => { void load(); void hasKey().then(setAiOn); }, [load]);

  /**
   * The passages behind an answer are whatever the search already found, and
   * nothing else — no site, no customer, no asset register.
   */
  const passages = useMemo((): Passage[] => [
    ...pageHits.map((h) => ({
      citation: `${h.docTitle} page ${h.page}`,
      text: h.snippet,
      source: 'Your imported document',
    })),
    ...results.filter((r) => r.kind === 'clause').slice(0, 5).map((r) => ({
      citation: r.title,
      text: r.body,
      source: r.source,
    })),
  ], [pageHits, results]);

  const askAi = async () => {
    setThinking(true);
    try {
      setAnswer(await askGrounded({ question: q, passages }));
    } finally {
      setThinking(false);
    }
  };

  // The imported documents are searched from the database, so this cannot be a
  // memo — it lands a moment after the clause results and that is fine.
  useEffect(() => {
    // A new search invalidates the last answer: leaving it on screen under a
    // different question is how a wrong answer gets acted on. It is cleared
    // here, when a search actually runs, and not on every keystroke.
    setAnswer(null);
    if (!searching) { setPageHits([]); return; }
    let live = true;
    void searchLibrary(q, 15).then((h) => { if (live) setPageHits(h); });
    return () => { live = false; };
  }, [q, searching]);

  const addDocument = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf', copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setImporting(true);
    try {
      const bytes = await new File(asset.uri).bytes();
      const result = await importPdf({ bytes, fileName: asset.name ?? 'document.pdf' });
      if (result.refused) {
        Alert.alert('Not imported', result.refused);
        return;
      }
      await load();
      Alert.alert(
        'Imported',
        `${result.doc!.title} — ${result.doc!.pageCount} pages, searchable offline. `
        + 'The file itself stays where it is; the app kept only the text it read.',
      );
    } catch (e) {
      Alert.alert('Could not read that file', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const forget = (doc: LibraryDoc) => {
    Alert.alert(`Remove ${doc.title}?`, 'The original file is not touched — only the text this app read from it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => { void deleteLibraryDoc(doc.id).then(load); },
      },
    ]);
  };

  const systems = useMemo(() => {
    const seen = new Set<string>();
    for (const d of LIBRARY) for (const s of d.systems) seen.add(s);
    return [...seen].sort();
  }, []);

  const shown = useMemo(
    () => (system ? LIBRARY.filter((d) => d.systems.includes(system)) : LIBRARY),
    [system],
  );

  const clauseCount = useMemo(
    () => TOTAL_CLAUSES,
    [],
  );
  const writtenUp = useMemo(
    () => EXPLAINED_CLAUSES,
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

        {searching && aiOn && passages.length ? (
          <Card>
            {answer?.text ? (
              <>
                <Rowed gap={2} align="center">
                  <MaterialCommunityIcons name="creation-outline" size={16} color={t.color.accentText} />
                  <Txt size="xs" tone="accent" style={{ flex: 1 }}>Read from the passages below</Txt>
                </Rowed>
                <Txt size="sm" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>{answer.text}</Txt>
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 16 }}>
                  Every claim above is numbered to a passage below. Anything it could not source it
                  did not say — check the passage before you act on it.
                </Txt>
              </>
            ) : answer?.refusal ? (
              <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>{answer.refusal}</Txt>
            ) : (
              <Button
                title="Read these for me"
                variant="secondary"
                compact
                loading={thinking}
                onPress={askAi}
              />
            )}
          </Card>
        ) : null}

        {searching ? (
          <>
            {pageHits.length ? (
              <>
                <H2>In your own documents</H2>
                {pageHits.map((h) => (
                  <PageResult key={`${h.docId}-${h.page}`} hit={h} />
                ))}
                <H2>In the clause index</H2>
              </>
            ) : null}
            {results.map((a, i) => <Result key={`${a.kind}-${a.title}-${i}`} answer={a} />)}
          </>
        ) : (
          <>
            <Card>
              <Rowed gap={2} align="center">
                <MaterialCommunityIcons name="bookshelf" size={22} color={t.color.accentText} />
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{LIBRARY.length} documents · {clauseCount} clauses</Txt>
                  <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
                    {writtenUp} written up in plain English. The rest are listed so they can be
                    found and cited, and say nothing further rather than guessing.
                  </Txt>
                </View>
              </Rowed>
            </Card>

            {/*
              The regulation is the reason the rest of this exists, and it is
              Crown material rather than a licensed standard — so it is here in
              full rather than as a clause index, and it goes above the search
              examples because "what am I actually obliged to do" is the
              question underneath most of them.
            */}
            <Card onPress={() => router.push('/library/law')}>
              <Rowed gap={2} align="center">
                <MaterialCommunityIcons name="scale-balance" size={22} color={t.color.accentText} />
                <View style={{ flex: 1 }}>
                  <Txt weight="700">The regulation</Txt>
                  <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
                    Building Fire Safety Regulation 2008, indexed by who has to do what. Every clock
                    this app counts comes from a section in here.
                  </Txt>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
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

            <H2>Your documents</H2>
            <Card>
              <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                Import a PDF you already own and the app reads its text on this device, so you can
                search the actual words offline. Nothing is uploaded and the file itself stays where
                it is.
              </Txt>
              <Txt size="xs" tone="warn" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                Australian Standards are published encrypted to stop their text being copied, and
                this app will not strip that. Those stay in your own licensed viewer — the clause
                index below is what points you at the right clause. The Queensland codes, the
                legislation and manufacturer manuals are not locked and read fine.
              </Txt>
              <View style={{ height: t.space(3) }} />
              <Button
                title="Import a PDF"
                variant="secondary"
                onPress={addDocument}
                loading={importing}
              />
            </Card>

            {mine.map((d) => (
              <Card key={d.id} onPress={() => forget(d)}>
                <Rowed gap={2} align="flex-start">
                  <MaterialCommunityIcons name="file-document-outline" size={18} color={t.color.accentText} />
                  <View style={{ flex: 1 }}>
                    <Txt size="sm" weight="700">{d.title}</Txt>
                    <Txt size="xs" tone="faint">
                      {d.pageCount} pages · {d.wordCount.toLocaleString()} words
                    </Txt>
                    {d.warnings.length ? (
                      <Txt size="xs" tone="warn" style={{ marginTop: t.space(1), lineHeight: 16 }}>
                        {d.warnings.join(' ')}
                      </Txt>
                    ) : null}
                  </View>
                </Rowed>
              </Card>
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

function PageResult({ hit }: { hit: PageHit }) {
  const t = useTheme();
  /*
   * The matched words are marked in the snippet. A hit with no context is a
   * page number, and nobody walks back to the ute to check a page number.
   *
   * The snippet is not always enough, though, and a standard is the worst case
   * for it: the sentence that decides the answer is often the one after the
   * match — "except where the system is", "unless otherwise approved" — and a
   * snippet ending mid-qualifier reads as a clear answer while being the
   * opposite of one. libraryPage was written to fetch the whole page for
   * exactly this and nothing called it, so the page could be found and not
   * read.
   *
   * Tapping opens it. The document is the technician's own copy, imported on
   * their own device, and nothing about showing it leaves the handset.
   */
  const [page, setPage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (page !== null) return;
    setLoading(true);
    try {
      setPage((await libraryPage(hit.docId, hit.page)) ?? '');
    } catch {
      setPage('');
    } finally {
      setLoading(false);
    }
  };

  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const m of hit.marks) {
    if (m.from > at) parts.push({ text: hit.snippet.slice(at, m.from), mark: false });
    parts.push({ text: hit.snippet.slice(m.from, m.to), mark: true });
    at = m.to;
  }
  if (at < hit.snippet.length) parts.push({ text: hit.snippet.slice(at), mark: false });

  return (
    <Card onPress={() => void toggle()}>
      <Rowed gap={2} align="center">
        <MaterialCommunityIcons name="text-search" size={16} color={t.color.accentText} />
        <Txt size="xs" tone="accent" style={{ flex: 1 }}>
          {hit.docTitle} · page {hit.page}
        </Txt>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={t.color.textFaint}
        />
      </Rowed>
      <Txt size="sm" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>
        {parts.map((p, i) => (
          <Txt
            key={i}
            size="sm"
            weight={p.mark ? '700' : undefined}
            tone={p.mark ? 'accent' : undefined}
          >
            {p.text}
          </Txt>
        ))}
      </Txt>

      {open ? (
        <>
          <View style={{ height: 1, backgroundColor: t.color.border, marginVertical: t.space(2) }} />
          {loading ? (
            <Txt size="sm" tone="muted">Reading page {hit.page}…</Txt>
          ) : page ? (
            <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>{page}</Txt>
          ) : (
            /*
             * The page was found by the search, so its text existed when the
             * document was imported. Saying nothing here would read as a blank
             * page in the standard rather than as the app failing to read it
             * back.
             */
            <Txt size="sm" tone="warn">
              The text of this page could not be read back. The document may have been re-imported
              since this result was found — search again.
            </Txt>
          )}
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
            Page {hit.page} of your own imported copy, as the text was read off it. Layout, tables
            and figures are not preserved — check the document itself where the layout matters.
          </Txt>
        </>
      ) : null}
    </Card>
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
