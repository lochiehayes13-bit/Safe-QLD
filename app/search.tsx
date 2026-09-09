import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { searchEverything, searchableCount } from '@/db/searchRepo';
import {
  KIND_LABEL, SEARCH_HINTS, groupHits, isExact, nothingFoundWords, parseQuery, type HitGroup, type SearchHit,
} from '@/domain/search';
import { isPhrase, phraseWords, readPhrase } from '@/domain/findPhrase';
import { readPhraseWithModel, worthAsking } from '@/ai/findPhrase';
import { hasKey } from '@/ai/client';
import { readMode, searchDestinations, type DestinationHit } from '@/domain/appMode';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { describeLoadFailure } from '@/domain/loadFailure';
import { everSynced } from '@/simpro/watermark';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, EmptyState, IconPlate, Rowed, Screen, SearchBox, Txt } from '@/components/ui';
import { Bounce, Reveal } from '@/components/motion';

/**
 * Find anything.
 *
 * One box over every record the office's mirror holds: jobs, sites,
 * customers, contacts, quotes, invoices, purchase orders, the office
 * catalogue, leads and suppliers — and, under those, the app's own screens
 * by name. A technician holds one identifier and does not always know which
 * of the ten lists it belongs in; this is the screen that does not ask.
 *
 * The search runs in the database, one statement per kind, each capped, so
 * a keystroke costs the same on a phone holding four thousand jobs as on a
 * test holding four. The results come grouped by kind with a count on each
 * group, an exact number match marked as such, and every row opens the
 * record it names.
 *
 * A sentence typed at the box is read before it is searched: "unpaid
 * invoices for the tower" is invoices matching "the tower", and the screen
 * says so in a line under the box rather than silently searching for five
 * words that appear in no record together. That reading is two word lists
 * and no network. Where they cannot tell what kind of record was meant, and
 * only then, a model may be asked to pick which of the typed words to
 * search for — never to answer, and never with a word nobody typed.
 */

/** How many of each kind to show. Where a kind is cut, the group says so. */
const PER_KIND = 8;

export default function SearchScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  const [typed, setTyped] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [screens, setScreens] = useState<DestinationHit[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  // A phrase read by the model, kept beside the typed text: the box still
  // holds what the person wrote, and one line says how it was read.
  const [asked, setAsked] = useState<{ phrase: string; terms: string; kind?: SearchHit['kind']; note: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [keyed, setKeyed] = useState(false);
  // What an empty answer means: a phone nobody has connected has nothing to
  // search, and "nothing matched" on that phone sends somebody retyping.
  const [empty, setEmpty] = useState<EmptyStateWords | null>(null);

  // A query, so it waits for the typing to stop: a job number is one read
  // rather than five.
  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  // What the words asked for, where they were a sentence. A phrase the
  // model read outranks the word lists' reading of the same phrase.
  const phrase = useMemo(() => (isPhrase(query) ? readPhrase(query) : null), [query]);
  const model = asked && asked.phrase === query.trim() ? asked : null;
  const searched = model ? model.terms : (phrase ? phrase.terms : query);
  const onlyKind = model ? model.kind : phrase?.kind;
  const parsed = useMemo(() => parseQuery(searched), [searched]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      // A phrase that named a kind and nothing else — "the open purchase
      // orders" — is a list of that kind, not two characters of nothing.
      if (parsed.text.length < 2 && !onlyKind) {
        setHits(null);
        setScreens([]);
        return;
      }
      const prefs = await loadPrefs();
      const [found, held] = await Promise.all([
        searchEverything(parsed.text, { limitPerKind: PER_KIND, kinds: onlyKind ? [onlyKind] : undefined }),
        searchableCount(),
      ]);
      setHits(found);
      // The app's own screens answer to what was typed, not to what the
      // phrase was reduced to: "purchase orders" should still offer the
      // purchase orders screen.
      setScreens(searchDestinations(query, readMode(prefs.appMode).mode, 4).filter((d) => !d.destination.needsContext));
      if (!found.length && !held) {
        setEmpty(officeEmptyState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'records',
        ));
      } else {
        setEmpty(null);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the search'));
    }
  }, [parsed.text, onlyKind, query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Whether a key exists at all, so the button to ask is only offered where
  // it can do something.
  useEffect(() => { void hasKey().then(setKeyed).catch(() => setKeyed(false)); }, []);

  const ask = useCallback(async () => {
    const phraseText = query.trim();
    setAsking(true);
    try {
      const result = await readPhraseWithModel(phraseText);
      setAsked(result.suggestion
        ? {
          phrase: phraseText,
          terms: result.suggestion.terms,
          kind: result.suggestion.kind,
          note: `Read as: ${result.suggestion.kind ? `${KIND_LABEL[result.suggestion.kind].many.toLowerCase()} ` : ''}`
            + (result.suggestion.terms ? `matching "${result.suggestion.terms}"` : 'the most recent') + '.',
        }
        : { phrase: phraseText, terms: phraseText, note: result.refusal });
    } catch (e) {
      // It is written not to throw; if it ever does, the search still ran
      // on what was typed and the line under the box says why nothing else
      // happened.
      setAsked({ phrase: phraseText, terms: phraseText, note: describeLoadFailure(e, 'reading the phrase') });
    } finally {
      setAsking(false);
    }
  }, [query]);

  const groups = useMemo(() => (hits ? groupHits(hits) : []), [hits]);
  const nothing = hits !== null && !hits.length && !screens.length;
  const words = nothingFoundWords(parsed);
  const readAs = model ? model.note : (phrase ? phraseWords(phrase) : undefined);
  // Offered under a phrase the word lists could not place, and only where
  // there is a key to ask with.
  const canAsk = keyed && !model && Boolean(phrase) && worthAsking(query, phrase!).ok;

  return (
    <>
      <Stack.Screen options={{ title: 'Find anything' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <SearchBox value={typed} onChange={setTyped} placeholder="Job, invoice, PO, quote, site, customer, part, phone" />
          {readAs ? <Txt size="xs" tone="muted">{readAs}</Txt> : null}
          {hits ? (
            <Txt size="xs" tone="faint">
              {hits.length
                ? `${hits.length} ${hits.length === 1 ? 'record' : 'records'} across ${groups.length} ${groups.length === 1 ? 'kind' : 'kinds'}`
                  + (parsed.hint ? ` · ${KIND_LABEL[parsed.hint].many.toLowerCase()} only` : '')
                : ' '}
            </Txt>
          ) : null}
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(24) }}
        >
          {failed ? <Banner tone="fail" title="The search could not run" body={failed} /> : null}

          {hits === null && !failed ? <Hints onPick={setTyped} /> : null}

          {groups.map((g, gi) => (
            <Group key={g.kind} group={g} index={gi} exactOf={(h) => isExact(h, parsed)} capped={g.hits.length >= PER_KIND} />
          ))}

          {screens.length ? <Screens hits={screens} /> : null}

          {nothing && !failed ? (
            empty ? (
              <EmptyState
                icon="cloud-download-outline"
                title={empty.title}
                body={empty.body}
                action={empty.action ? (
                  <Bounce onPress={() => router.push(empty.action!.route)} haptic="light">
                    <Chip label={empty.action.label} selected />
                  </Bounce>
                ) : undefined}
              />
            ) : (
              <EmptyState icon="magnify-close" title={words.title} body={words.body} />
            )
          ) : null}

          {canAsk ? (
            <Card style={{ gap: t.space(1) }}>
              <Txt weight="700">That reads like a sentence</Txt>
              <Txt size="sm" tone="muted">
                Nothing in it says which kind of record you meant. The words you typed can be sent to the model to pick
                which of them to search for. Only those words go; no job, customer or site leaves the phone.
              </Txt>
              <Bounce onPress={() => { void ask(); }} haptic="light">
                <Chip label={asking ? 'Reading…' : 'Read it for me'} selected />
              </Bounce>
            </Card>
          ) : null}
        </ScrollView>
      </Screen>
    </>
  );
}

/**
 * What can be typed, as tappable examples.
 *
 * Shown in place of results while the box is empty, because a box that
 * accepts eight shapes of thing and says nothing about any of them gets
 * used for one.
 */
function Hints({ onPick }: { onPick: (example: string) => void }) {
  const t = useTheme();
  return (
    <Reveal index={0}>
      <Card style={{ gap: t.space(1) }}>
        <Txt weight="800">Type any one thing you know</Txt>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          A number on its own is looked for everywhere, the record with exactly that number first. A word in front
          narrows it: inv, po, quote, job, cust.
        </Txt>
        <View style={{ marginTop: t.space(1.5), gap: 2 }}>
          {SEARCH_HINTS.map((h) => (
            <Bounce key={h.example} onPress={() => onPick(h.example)} haptic="selection" scaleTo={0.99}>
              <Rowed gap={3} style={{ minHeight: 44 }}>
                <Txt mono size="sm" weight="700" tone="accent" style={{ minWidth: 140 }}>{h.example}</Txt>
                <Txt size="sm" tone="muted" style={{ flex: 1 }}>{h.finds}</Txt>
              </Rowed>
            </Bounce>
          ))}
        </View>
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
          Everything here is what the phone holds from the last sync; nothing goes to the office.
        </Txt>
      </Card>
    </Reveal>
  );
}

function Group({ group, index, exactOf, capped }: {
  group: HitGroup; index: number; exactOf: (h: SearchHit) => boolean; capped: boolean;
}) {
  const t = useTheme();
  return (
    <Reveal index={index}>
      <View style={{ gap: t.space(2) }}>
        <Rowed gap={2}>
          <MaterialCommunityIcons name={group.icon as never} size={18} color={t.color.accentText} />
          <Txt weight="800" style={{ flex: 1 }}>{group.label}</Txt>
          <Chip label={capped ? `first ${group.hits.length}` : String(group.hits.length)} />
        </Rowed>
        {group.hits.map((h) => <HitRow key={`${h.kind}-${h.id}`} hit={h} exact={exactOf(h)} />)}
        {capped ? <Txt size="xs" tone="faint">More may match. Add a word, or the kind in front of a number.</Txt> : null}
      </View>
    </Reveal>
  );
}

function HitRow({ hit, exact }: { hit: SearchHit; exact: boolean }) {
  const t = useTheme();
  return (
    <Card onPress={() => router.push({ pathname: hit.route, params: hit.params } as never)} style={{ paddingVertical: t.space(3) }}>
      <Rowed gap={3} align="flex-start">
        <IconPlate icon={KIND_LABEL[hit.kind].icon as never} size={36} muted={!exact} />
        <View style={{ flex: 1, gap: 2 }}>
          <Rowed gap={2}>
            <Txt weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>{hit.title}</Txt>
            {exact ? <Chip label="Exact" tone="pass" /> : null}
          </Rowed>
          {hit.subtitle ? <Txt size="sm" tone="muted" numberOfLines={2}>{hit.subtitle}</Txt> : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}

/** The app's own screens that answer to the words, under the records. */
function Screens({ hits }: { hits: DestinationHit[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space(2) }}>
      <Rowed gap={2}>
        <MaterialCommunityIcons name="apps" size={18} color={t.color.accentText} />
        <Txt weight="800" style={{ flex: 1 }}>Screens</Txt>
        <Chip label={String(hits.length)} />
      </Rowed>
      {hits.map((h) => (
        <Card key={h.destination.route} onPress={() => router.push(h.destination.route as never)} style={{ paddingVertical: t.space(3) }}>
          <Rowed gap={3}>
            <IconPlate icon="apps" size={36} muted />
            <View style={{ flex: 1 }}>
              <Txt weight="700">{h.destination.label}</Txt>
              <Txt size="sm" tone="muted" numberOfLines={2}>{h.destination.blurb}</Txt>
              {h.hidden ? <Txt size="xs" tone="faint">Not listed in this mode; opens from here all the same.</Txt> : null}
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
          </Rowed>
        </Card>
      ))}
    </View>
  );
}
