import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  type StandardDoc, type StandardScope,
} from '@/domain/standardsCatalogue';
import { EXPLAINED_CLAUSES, LIBRARY, TOTAL_CLAUSES } from '@/domain/standardsLibrary';
import { ask, explainQuery, type Answer } from '@/domain/ask';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import {
  importPdf, libraryPage, listLibraryDocs, searchLibrary, webPickedBytes, type LibraryDoc,
} from '@/db/libraryRepo';
import type { PageHit } from '@/domain/docSearch';
import { useTheme } from '@/theme';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
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

/** The confidence chip on a result, in words rather than a rating. */
const CONFIDENCE_WORD: Record<Answer['confidence'], string> = {
  high: 'Checked',
  medium: 'Likely',
  low: 'Check source',
};

/** One of the technician's imported documents, optionally at a page. */
function openImported(id: string, page?: number) {
  router.push({
    pathname: '/library/[id]',
    params: page ? { id, mine: '1', page: String(page) } : { id, mine: '1' },
  });
}

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
  const [mineError, setMineError] = useState<string | null>(null);
  const [foundPages, setFoundPages] = useState<PageHit[]>([]);
  const [importing, setImporting] = useState(false);

  const q = debounced.trim();
  const searching = q.length >= 2;

  const results = useMemo(() => (searching ? ask(q, 25) : []), [q, searching]);
  const pageHits = searching ? foundPages : [];
  const reading = useMemo(() => (searching ? explainQuery(q) : null), [q, searching]);

  const load = useCallback(async () => {
    try {
      setMine(await listLibraryDocs());
      setMineError(null);
    } catch (e) {
      setMineError(describeLoadFailure(e, 'your documents'));
    }
  }, []);
  // Read again on every return to this screen, so a document removed from
  // its own page is gone from the list.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The imported documents are searched from the database, so this cannot be a
  // memo — it lands a moment after the clause results and that is fine.
  useEffect(() => {
    if (!searching) return undefined;
    let live = true;
    searchLibrary(q, 15)
      .then((h) => { if (live) setFoundPages(h); })
      .catch(() => { if (live) setFoundPages([]); });
    return () => { live = false; };
  }, [q, searching]);

  const addDocument = async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf', copyToCacheDirectory: true,
      });
    } catch (e) {
      showAlert('Could not open the file picker', describeActionFailure(e, 'choose a file'));
      return;
    }
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setImporting(true);
    try {
      // expo-file-system has no browser half, so the web build reads the
      // picked file the browser's own way.
      const bytes = Platform.OS === 'web'
        ? await webPickedBytes(asset)
        : await new File(asset.uri).bytes();
      const result = await importPdf({ bytes, fileName: asset.name ?? 'document.pdf' });
      if (result.refused) {
        showAlert('Not imported', result.refused);
        return;
      }
      await load();
      showAlert('Imported', `${result.doc!.title}: ${result.doc!.pageCount} pages, now searchable.`);
    } catch (e) {
      showAlert('Could not read that file', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
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
          label="Search standards"
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

        {searching && !results.length && !pageHits.length ? (
          <Banner
            tone="warn"
            title="No match"
            body="Try the equipment name or a clause, e.g. AS 2419.1 10.4."
          />
        ) : null}

        {searching ? (
          <>
            {pageHits.length ? (
              <>
                <H2>Your documents</H2>
                {pageHits.map((h) => (
                  <PageResult key={`${h.docId}-${h.page}`} hit={h} />
                ))}
                {results.length ? <H2>Standards</H2> : null}
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
                    {writtenUp} with plain-English notes.
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
                  <Txt weight="700">Fire safety regulation</Txt>
                  <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
                    Building Fire Safety Regulation 2008, by who must act.
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
                Import a PDF to search its text offline.
              </Txt>
              <Txt size="xs" tone="warn" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                Locked PDFs, like most Australian Standards, can&rsquo;t be imported.
              </Txt>
              <View style={{ height: t.space(3) }} />
              <Button
                title="Import a PDF"
                variant="secondary"
                onPress={addDocument}
                loading={importing}
              />
            </Card>

            {mineError ? (
              <Txt size="sm" tone="warn" style={{ lineHeight: 19 }}>{mineError}</Txt>
            ) : null}

            {mine.map((d) => (
              <Card key={d.id} onPress={() => openImported(d.id)}>
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
                  <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
                </Rowed>
              </Card>
            ))}

            <H2>All documents</H2>
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
              Clause numbers only. Open your own copy for the wording.
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
            <Txt size="sm" tone="muted">Loading page {hit.page}…</Txt>
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
              Couldn&rsquo;t load this page. Search again.
            </Txt>
          )}
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
            Text only. Check tables and figures in the PDF itself.
          </Txt>
          <Pressable onPress={() => openImported(hit.docId, hit.page)} style={{ marginTop: t.space(2) }}>
            <Rowed gap={2} align="center">
              <MaterialCommunityIcons name="arrow-right-circle-outline" size={15} color={t.color.accentText} />
              <Txt size="sm" tone="accent">Open document</Txt>
            </Rowed>
          </Pressable>
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
          {/*
            Which part of the document this came out of.
            Eight cards from six standards all read alike — a number, a heading
            and a paragraph — and what decides which is worth opening is
            usually whether it came from the smoke detector section or the
            commissioning appendix. In the brand colour because it is the line
            the eye should land on while scanning, and above the source rather
            than below it: the section is about the answer, the source is about
            where to check it.
          */}
          {answer.context ? (
            <Txt
              size="xs"
              weight="600"
              numberOfLines={2}
              style={{ color: t.color.accentText, marginTop: t.space(1.5), lineHeight: 16 }}
            >
              {answer.context}
            </Txt>
          ) : null}
          <Rowed gap={2} align="center" style={{ marginTop: t.space(1.5) }}>
            <Txt size="xs" tone={tone} style={{ flex: 1 }}>{answer.source}</Txt>
            {answer.confidence !== 'high' ? (
              <Chip label={CONFIDENCE_WORD[answer.confidence]} tone="warn" />
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
            {written ? ` · ${written} with notes` : ''}
            {doc.supersededBy ? ` · superseded by ${doc.supersededBy}` : ''}
          </Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
