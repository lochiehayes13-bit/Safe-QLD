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
import { searchDestinations, type DestinationHit } from '@/domain/appMode';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { describeLoadFailure } from '@/domain/loadFailure';
import { everSynced } from '@/simpro/watermark';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, IconPlate, Rowed, Screen, SearchBox, Txt } from '@/components/ui';
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
 * and no network.
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
  /** Whether a kind guessed out of the words found nothing and every kind was asked instead. */
  const [widened, setWidened] = useState(false);
  // What an empty answer means: a phone nobody has connected has nothing to
  // search, and "nothing matched" on that phone sends somebody retyping.
  const [empty, setEmpty] = useState<EmptyStateWords | null>(null);

  // A query, so it waits for the typing to stop: a job number is one read
  // rather than five.
  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  // What the words asked for, where they were a sentence.
  const phrase = useMemo(() => (isPhrase(query) ? readPhrase(query) : null), [query]);
  const searched = phrase ? phrase.terms : query;
  const onlyKind = phrase?.kind;
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
      /*
       * A kind the words were *guessed* to mean is a preference, not a filter.
       *
       * The phrase reader treats any three words as a sentence and maps
       * "parts", "people", "account", "bill", "order", "lead" and "supplier"
       * onto a kind. Those words turn up in site names (an auto parts store, a
       * stadium), so typing a building's name
       * exactly asked the catalogue, or the contacts, for it, the site was
       * never queried, and the screen answered "Nothing matched. Try a number
       * on its own, or a shorter piece of the name." A shorter piece does find
       * it, which makes the advice accidentally right and the search wrong:
       * the more precisely somebody typed the name, the less chance they had.
       *
       * So where a guess found nothing, every kind is asked and the screen
       * says it widened. A kind the person typed as a prefix — "site 8812" —
       * is a deliberate narrowing and still means it: parsed.hint is set only
       * for that, and it is left alone.
       */
      const guessed = onlyKind && !parsed.hint;
      const widerRows = !found.length && guessed
        ? await searchEverything(parsed.text, { limitPerKind: PER_KIND })
        : null;
      setWidened(!!widerRows?.length);
      const rows = widerRows?.length ? widerRows : found;
      setHits(rows);
      // The app's own screens answer to what was typed, not to what the
      // phrase was reduced to: "purchase orders" should still offer the
      // purchase orders screen.
      setScreens(searchDestinations(query, 'office', 4).filter((d) => !d.destination.needsContext));
      if (!rows.length && !held) {
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
  }, [parsed.text, parsed.hint, onlyKind, query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const groups = useMemo(() => (hits ? groupHits(hits) : []), [hits]);
  const nothing = hits !== null && !hits.length && !screens.length;
  const words = nothingFoundWords(parsed);
  const readAs = phrase ? phraseWords(phrase) : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Find anything' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <SearchBox value={typed} onChange={setTyped} placeholder="Job, invoice, PO, site, part or phone" />
          {readAs ? <Txt size="xs" tone="muted">{readAs}</Txt> : null}
          {/*
            * Said, because the row the person wanted is now in a list they
            * were told they were not looking at. Without this the screen
            * reads as having ignored them.
            */}
          {widened && onlyKind ? (
            <Txt size="xs" tone="muted">
              {`No ${KIND_LABEL[onlyKind].many.toLowerCase()} matched. Showing all results.`}
            </Txt>
          ) : null}
          {hits ? (
            <Txt size="xs" tone="faint">
              {hits.length
                ? `${hits.length} found`
                  + (parsed.hint ? ` · ${KIND_LABEL[parsed.hint].many.toLowerCase()} only` : '')
                : ' '}
            </Txt>
          ) : null}
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(24) }}
        >
          {failed ? <Banner tone="fail" title="Search failed" body={failed} /> : null}

          {hits === null && !failed ? <Hints onPick={setTyped} /> : null}

          {groups.map((g, gi) => (
            <Group
              key={g.kind}
              group={g}
              index={gi}
              exactOf={(h) => isExact(h, parsed)}
              capped={g.hits.length >= PER_KIND}
              term={parsed.text}
            />
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
        <Txt weight="800">Type one thing you know</Txt>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Start with inv, po, quote, job or cust to narrow it.
        </Txt>
        <View style={{ marginTop: t.space(1.5), gap: 2 }}>
          {SEARCH_HINTS.map((h) => (
            <Bounce key={h.example} onPress={() => onPick(h.example)} haptic="selection" scaleTo={0.99}>
              <Rowed gap={3} align="baseline" style={{ minHeight: 44, paddingVertical: 12 }}>
                <Txt mono size="sm" weight="700" tone="accent" style={{ minWidth: 140 }}>{h.example}</Txt>
                <Txt size="sm" tone="muted" style={{ flex: 1 }}>{h.finds}</Txt>
              </Rowed>
            </Bounce>
          ))}
        </View>
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
          Searches this phone, as of the last sync.
        </Txt>
      </Card>
    </Reveal>
  );
}

function Group({ group, index, exactOf, capped, term }: {
  group: HitGroup; index: number; exactOf: (h: SearchHit) => boolean; capped: boolean; term: string;
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
        {capped ? (
          <>
            <Txt size="xs" tone="faint">More may match. Add a word to narrow it.</Txt>
            {/*
              * And somewhere to go for the rest, for the kinds that have a
              * list of their own. "More may match" with no way to see them is
              * a cut that has been announced rather than fixed: the Sites tab
              * draws three hundred of the same search, so it takes the words
              * across rather than making somebody type them again.
              */}
            {group.kind === 'site' && term ? (
              <Button
                title="See all matching sites"
                variant="ghost"
                compact
                onPress={() => router.push({ pathname: '/(tabs)/sites', params: { q: term } })}
              />
            ) : null}
          </>
        ) : null}
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
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
          </Rowed>
        </Card>
      ))}
    </View>
  );
}
