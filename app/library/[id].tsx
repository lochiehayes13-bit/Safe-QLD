import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type StandardClause } from '@/domain/standardsCatalogue';
import { LIBRARY, clauseProvenance } from '@/domain/standardsLibrary';
import type { NoteConfidence } from '@/domain/standardsExtra';
import type { PageHit } from '@/domain/docSearch';
import {
  deleteLibraryDoc, getLibraryDoc, libraryPage, searchLibrary, type LibraryDoc,
} from '@/db/libraryRepo';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { RecordGate } from '@/components/RecordGate';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { normalise } from '@/domain/tradeVocabulary';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';

/** How far one of our clause notes can be trusted, as a word on its chip. */
const CONFIDENCE_WORD: Record<NoteConfidence, string> = {
  high: 'checked',
  medium: 'likely',
  low: 'unconfirmed',
};

/**
 * A catalogue standard, or with `?mine=1` one of the technician's imported
 * PDFs. Both live under /library/<id>, so a search result and the list of
 * imported documents open the same way.
 */
export default function LibraryDocScreen() {
  const { id, mine, page } = useLocalSearchParams<{ id: string; mine?: string; page?: string }>();
  if (mine) return <ImportedScreen id={id} startPage={Number(page) || 1} />;
  return <StandardScreen id={id} />;
}

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
function StandardScreen({ id }: { id: string }) {
  const t = useTheme();
  const [filter, setFilter] = useState('');

  const doc = useMemo(() => LIBRARY.find((d) => d.id === id), [id]);

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
          body="This standard is not in the catalogue."
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
            body="Most sites are maintained to the edition they were built under. Name the edition on the record."
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

        {/*
          * Two different empty states, and telling them apart matters. A
          * document whose index nobody has read in yet is not a document that
          * failed to match a search, and saying "nothing matches" about a
          * document holding nothing would send somebody looking for a typo in
          * their own search box.
          */}
        {!doc.clauses.length ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            No clause list for this one yet.
          </Txt>
        ) : !clauses.length ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            No match. Search by clause number or title.
          </Txt>
        ) : null}

        {clauses.length ? (
          <Card>
            {clauses.map((c, i) => (
              <View key={`${c.ref}-${i}`}>
                {i > 0 ? <Divider /> : null}
                <ClauseRow clause={c} docId={doc.id} />
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Txt size="sm" weight="700">Open your own copy for the wording</Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
            {doc.clauses.length
              ? `${written} of ${doc.clauses.length} clauses have notes. `
              : ''}
            Clause numbers and titles are from the document and safe to cite.
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

/**
 * One clause, and where its explanation came from.
 *
 * The clause number and title were read out of the document. The sentence
 * underneath was written by somebody, and this app's rule is that a written
 * thing says so — a technician deciding whether to climb back down and find the
 * actual clause is entitled to know whether they are reading an extraction or
 * an interpretation, and how much that interpretation is worth.
 */
function ClauseRow({ clause, docId }: { clause: StandardClause; docId: string }) {
  const t = useTheme();
  const prov = clauseProvenance(docId, clause);
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
            No notes yet.
          </Txt>
        )}
        {prov ? (
          <Rowed gap={1.5} align="center" style={{ marginTop: t.space(1.5) }} wrap>
            <Chip
              label={prov.fromExtraction ? 'From the document' : `Our notes · ${CONFIDENCE_WORD[prov.confidence]}`}
              tone={prov.confidence === 'high' ? 'pass' : prov.confidence === 'low' ? 'warn' : 'default'}
            />
          </Rowed>
        ) : null}
        {prov && !prov.fromExtraction ? (
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 16 }}>
            {prov.source}
          </Txt>
        ) : null}
        {clause.appFeature ? (
          <Rowed gap={2} align="center" style={{ marginTop: t.space(1.5) }}>
            <MaterialCommunityIcons name="arrow-right-circle-outline" size={14} color={t.color.accentText} />
            <Txt size="xs" tone="accent">Open in the app</Txt>
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

/**
 * One of the technician's own imported PDFs, read a page at a time.
 *
 * The text is what was read off the file at import; the file itself was never
 * kept. Searching here looks in this document only.
 */
function ImportedScreen({ id, startPage }: { id: string; startPage: number }) {
  const t = useTheme();
  const [doc, setDoc] = useState<LibraryDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState(startPage);
  // A search result opening this screen again at another page moves to it.
  const [lastStart, setLastStart] = useState(startPage);
  if (startPage !== lastStart) {
    setLastStart(startPage);
    setPageNo(startPage);
  }
  // Which page the text belongs to, so a page still loading is never shown
  // under the number of the next one.
  const [read, setRead] = useState<{ page: number; text: string | null } | null>(null);
  const [find, setFind] = useState('');
  const [hits, setHits] = useState<PageHit[]>([]);
  const [removing, setRemoving] = useState(false);

  // Bumped by Try again, which reads the document afresh.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    getLibraryDoc(id)
      .then((found) => {
        if (!live) return;
        setDoc(found);
        setMissing(!found);
        setFailed(null);
      })
      .catch((e: unknown) => { if (live) setFailed(describeLoadFailure(e, 'this document')); });
    return () => { live = false; };
  }, [id, attempt]);

  useEffect(() => {
    let live = true;
    libraryPage(id, pageNo)
      .then((p) => { if (live) setRead({ page: pageNo, text: p ?? null }); })
      .catch(() => { if (live) setRead({ page: pageNo, text: null }); });
    return () => { live = false; };
  }, [id, pageNo]);
  const text = read && read.page === pageNo ? read.text : undefined;

  const q = find.trim();
  useEffect(() => {
    if (q.length < 2) return undefined;
    let live = true;
    const h = setTimeout(() => {
      searchLibrary(q, 30, id)
        .then((found) => { if (live) setHits(found); })
        .catch(() => { if (live) setHits([]); });
    }, 180);
    return () => { live = false; clearTimeout(h); };
  }, [q, id]);
  const shownHits = q.length >= 2 ? hits : [];

  const remove = useCallback(() => {
    if (!doc) return;
    showAlert(`Remove ${doc.title}?`, 'Removes it from search. Your file is kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setRemoving(true);
            try {
              await deleteLibraryDoc(doc.id);
              if (router.canGoBack()) router.back();
              else router.replace('/library');
            } catch (e) {
              showAlert('Not removed', describeActionFailure(e, 'remove the document'));
            } finally {
              setRemoving(false);
            }
          })();
        },
      },
    ]);
  }, [doc]);

  if (!doc) {
    return (
      <RecordGate
        missing={missing}
        what="document"
        why="It may have been removed. Import it again from Standards."
        failed={failed}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  const last = Math.max(1, doc.pageCount);
  const go = (n: number) => setPageNo(Math.min(last, Math.max(1, n)));

  return (
    <>
      <Stack.Screen options={{ title: doc.title }} />
      <Screen>
        <Card>
          <Txt weight="700" size="lg">{doc.title}</Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
            {doc.pageCount} pages · {doc.wordCount.toLocaleString()} words · {doc.fileName}
          </Txt>
          {doc.warnings.length ? (
            <Txt size="xs" tone="warn" style={{ marginTop: t.space(1), lineHeight: 16 }}>
              {doc.warnings.join(' ')}
            </Txt>
          ) : null}
        </Card>

        <Field
          label="Find in this document"
          value={find}
          onChangeText={setFind}
          placeholder="flow test, residual pressure"
          autoCapitalize="none"
        />

        {q.length >= 2 ? (
          shownHits.length ? (
            <Card>
              {shownHits.map((h, i) => (
                <View key={`${h.page}-${i}`}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable onPress={() => { go(h.page); setFind(''); }}>
                    <View style={{ paddingVertical: t.space(2) }}>
                      <Txt size="xs" tone="accent" weight="700">Page {h.page}</Txt>
                      <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
                        {h.snippet}
                      </Txt>
                    </View>
                  </Pressable>
                </View>
              ))}
            </Card>
          ) : (
            <Txt size="sm" tone="muted">No match in this document.</Txt>
          )
        ) : null}

        <Rowed gap={2} align="center">
          <Button title="Previous" variant="secondary" compact disabled={pageNo <= 1} onPress={() => go(pageNo - 1)} />
          <Txt size="sm" weight="700" style={{ flex: 1, textAlign: 'center' }}>
            Page {pageNo} of {last}
          </Txt>
          <Button title="Next" variant="secondary" compact disabled={pageNo >= last} onPress={() => go(pageNo + 1)} />
        </Rowed>

        <Card>
          {text === undefined ? (
            <Txt size="sm" tone="muted">Loading page {pageNo}…</Txt>
          ) : text ? (
            <Txt size="sm" style={{ lineHeight: 21 }}>{text}</Txt>
          ) : (
            <Txt size="sm" tone="muted">No readable text on this page.</Txt>
          )}
        </Card>
        <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
          Text only. Check tables and figures in the PDF itself.
        </Txt>

        <Button
          title="Remove from library"
          variant="danger"
          compact
          loading={removing}
          onPress={remove}
        />
      </Screen>
    </>
  );
}
