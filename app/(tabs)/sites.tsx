import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listSiteSummaries, type SiteSummary, type SiteSummaryPage } from '@/db/repo';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { Reveal, Skeleton } from '@/components/motion';
import { disambiguator } from '@/domain/siteNames';
import { siteListChips } from '@/domain/sitePage';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { siteSearchMiss, type SiteMissWords } from '@/domain/siteMiss';
import { loadPrefs } from '@/app-prefs';
import { everSynced, readSyncState } from '@/simpro/watermark';
import { type SyncState } from '@/simpro/incremental';
import { simproConfigFromPrefs } from '@/simpro/config';
import { pullFromSimpro } from '@/simpro/sync';
import { showAlert } from '@/components/alert';
import { describeActionFailure } from '@/domain/loadFailure';

/**
 * Site list. A technician's mental model is "which job am I on", so sites lead.
 *
 * The search and the cap are the database's. This screen used to read all
 * three thousand sites on every focus and filter them in JavaScript on every
 * keystroke; the office has three thousand and fifty-nine of them.
 */

/** How many site rows the list draws at once. Where it cuts, the list says so. */
const PAGE = 300;

export default function SitesScreen() {
  const t = useTheme();
  /*
   * Arrived from the global search, which shows the first eight sites of
   * however many matched and had nowhere to send somebody for the rest. The
   * words come across so the tab opens on the same search rather than on three
   * thousand buildings and a cursor.
   */
  const params = useLocalSearchParams<{ q?: string }>();
  const arrived = typeof params.q === 'string' ? params.q : '';
  const [page, setPage] = useState<SiteSummaryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(arrived);
  const [query, setQuery] = useState(arrived);
  // What an empty list means here: a device nobody connected to the office is
  // not the same as one with nothing in it, and saying "add your first site"
  // to the first sends a person to type in a building the office already has.
  const [empty, setEmpty] = useState<EmptyStateWords>(
    { title: 'No sites yet', body: 'Add a site or import a panel config.' },
  );
  /*
   * What a miss means, which this screen used to refuse to say.
   *
   * It said "Nothing matched / Try a shorter search." and nothing else, so a
   * technician searching for a building the office has archived — which never
   * comes down with the site list, however many times it is synced — was told
   * they had mistyped. The owner hit exactly that and asked why a site he
   * services was not there. src/domain/siteMiss.ts holds the words.
   */
  const [sitesState, setSitesState] = useState<SyncState | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const [pulling, setPulling] = useState(false);

  // The search is a query now, so it waits for the typing to stop.
  useEffect(() => {
    const h = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(h);
  }, [search]);

  const load = useCallback(async () => {
    const found = await listSiteSummaries({ query, limit: PAGE });
    setPage(found);
    if (!found.rows.length) {
      const prefs = await loadPrefs();
      const isConnected = Boolean(prefs.simproClientId && prefs.simproCompanyId);
      setConnected(isConnected);
      // Read only on a miss: it is one row, and only the empty state needs it.
      setSitesState(await readSyncState('sites'));
      if (!query.trim()) {
        setEmpty(officeEmptyState({ held: 0, connected: isConnected, everSynced: await everSynced() }, 'sites'));
      }
    }
    setLoading(false);
  }, [query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * Re-reads the office's whole site list, and nothing else.
   *
   * Settings already has "Fetch everything", and on this phone that is sites,
   * jobs, assets, customers, quotes, invoices and the rest — minutes of
   * waiting for somebody who wants to know whether one building is on the
   * books. This asks for the sites in full and skips the detail prefetch, so
   * it is the one read that answers the question in front of them.
   */
  const pullSites = useCallback(async () => {
    setPulling(true);
    try {
      const prefs = await loadPrefs();
      const result = await pullFromSimpro(simproConfigFromPrefs(prefs), undefined, {
        fullResources: ['sites'],
        prefetchDetails: false,
      });
      await load();
      showAlert(
        'Sites refreshed',
        [
          `${result.sitesAdded} added, ${result.sitesUpdated} updated.`,
          ...(result.notes.length ? ['', ...result.notes] : []),
          ...(result.errors.length ? ['', ...result.errors.slice(0, 3)] : []),
        ].join('\n'),
      );
    } catch (e) {
      showAlert('Could not refresh sites', describeActionFailure(e, 'refresh the site list'));
    } finally {
      setPulling(false);
    }
  }, [load]);

  /*
   * Worked out across every site rather than across the page: a name is
   * ambiguous because two sites share it, and that stays true when a search
   * happens to show only one of them. Deciding it from the rows on screen
   * would make the warning appear and disappear as somebody types, which is
   * why the count is made in the same statement that reads them.
   */
  const filtered = useMemo(() => page?.rows ?? [], [page]);
  const ambiguous = useMemo(
    () => new Set(filtered.filter((s) => s.sharesName).map((s) => s.name.trim().toLowerCase())),
    [filtered],
  );

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(24) }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.color.accent} />}
        ListHeaderComponent={
          <View style={{ gap: t.space(3), marginBottom: t.space(1) }}>
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
                placeholder="Name, suburb, address or client"
                placeholderTextColor={t.color.textFaint}
                autoCapitalize="none"
                style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
              />
            </View>
            {page && page.capped ? (
              <Txt size="xs" tone="faint">
                First {PAGE} of {page.matching.toLocaleString()} sites. Search to narrow.
              </Txt>
            ) : null}
            <Rowed gap={2}>
              <Button
                title="Map"
                variant="secondary"
                onPress={() => router.push('/map')}
                style={{ flex: 1 }}
                icon={<MaterialCommunityIcons name="map-marker-radius-outline" size={20} color={t.color.text} />}
              />
              <Button title="New site" onPress={() => router.push('/site/new')} style={{ flex: 1 }} />
              <Button title="Import" variant="secondary" onPress={() => router.push('/config')} style={{ flex: 1 }} />
            </Rowed>
            {/*
              * On its own row rather than beside Import, because they are
              * opposite things and the word is nearly the same. Import writes a
              * file into a site; this one opens a file and writes nothing.
              */}
            <Button
              title="Config Explorer"
              variant="secondary"
              onPress={() => router.push('/config')}
              icon={<MaterialCommunityIcons name="file-cog-outline" size={20} color={t.color.text} />}
            />
          </View>
        }
        renderItem={({ item, index }) => (
          index < 8
            ? <Reveal index={index}><SiteCard site={item} apart={disambiguator(item, ambiguous)} /></Reveal>
            : <SiteCard site={item} apart={disambiguator(item, ambiguous)} />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: t.space(3) }}>
              <Skeleton height={104} /><Skeleton height={104} /><Skeleton height={104} /><Skeleton height={104} />
            </View>
          ) : search ? (
            <SiteMiss
              words={siteSearchMiss({
                term: search,
                held: page?.total ?? 0,
                connected,
                sites: sitesState,
                now: new Date(),
              })}
              pulling={pulling}
              onPull={pullSites}
            />
          ) : (
            <EmptyState
              icon="office-building-marker-outline"
              title={empty.title}
              body={empty.body}
              action={(
                <Rowed gap={2} wrap>
                  {empty.action ? <Button title={empty.action.label} onPress={() => router.push(empty.action!.route)} /> : null}
                  <Button title="Add a site" variant="ghost" onPress={() => router.push('/site/new')} />
                </Rowed>
              )}
            />
          )
        }
      />
    </Screen>
  );
}

/**
 * One site in the list.
 *
 * `apart` is what tells this site from its namesakes, and it is absent on all
 * but a handful of rows. Several sites on the book share a name with two or
 * three others and carry no address, and without this the rows are identical,
 * so a technician picks one of three and records a service against whichever
 * building it turns out to be.
 */
function SiteCard({ site, apart }: { site: SiteSummary; apart?: string }) {
  const t = useTheme();
  const location = [site.suburb, site.state].filter(Boolean).join(' ');
  const chips = siteListChips(site);
  return (
    <Card onPress={() => router.push({ pathname: '/site/[id]', params: { id: site.id } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size="lg" weight="700" numberOfLines={1}>{site.name}</Txt>
          {site.address || location ? (
            <Txt size="sm" tone="muted" numberOfLines={1}>{[site.address, location].filter(Boolean).join(', ')}</Txt>
          ) : null}
          {site.clientName ? <Txt size="sm" tone="faint" numberOfLines={1}>{site.clientName}</Txt> : null}
          {apart ? (
            <Rowed gap={1.5} align="center">
              <MaterialCommunityIcons name="alert-circle-outline" size={13} color={t.color.warn} />
              <Txt size="xs" tone="warn" numberOfLines={1}>
                Same name as another site · {apart}
              </Txt>
            </Rowed>
          ) : null}
          {chips.length ? (
            <Rowed gap={1.5} wrap style={{ marginTop: t.space(1.5) }}>
              {/*
                * Marked, not hidden. An archived building's logbook is still the
                * record of work that happened and its assets are still in the
                * wall; a technician sent there has to be able to find it. What
                * they must not do is raise new work against it without knowing.
                */}
              {chips.map((c) => <Chip key={c.label} label={c.label} tone={c.tone} />)}
            </Rowed>
          ) : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}

/**
 * What a site search that found nothing is allowed to say.
 *
 * Every line, rather than a title and one sentence, because the useful part is
 * usually the third: the office's archived sites never come down with the list
 * and no amount of syncing changes that. A technician who is not told cannot
 * work it out, and will go on typing shorter and shorter searches.
 */
function SiteMiss({
  words, pulling, onPull,
}: { words: SiteMissWords; pulling: boolean; onPull: () => void }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: t.space(3), paddingVertical: t.space(6) }}>
      <MaterialCommunityIcons name="map-search-outline" size={40} color={t.color.textFaint} />
      <Txt size="lg" weight="700" style={{ textAlign: 'center' }}>{words.title}</Txt>
      <View style={{ gap: t.space(2), maxWidth: 420 }}>
        {words.lines.map((line) => (
          <Txt key={line} size="sm" tone="muted" style={{ textAlign: 'center', lineHeight: 20 }}>{line}</Txt>
        ))}
      </View>
      <Rowed gap={2} wrap style={{ justifyContent: 'center' }}>
        {words.offerPull ? (
          <Button
            title={pulling ? 'Refreshing…' : 'Refresh sites'}
            onPress={onPull}
            disabled={pulling}
          />
        ) : null}
        {words.offerConnect ? (
          <Button title="Connect to Simpro" onPress={() => router.push('/settings')} />
        ) : null}
        {words.offerAdd ? (
          <Button title="Add a site" variant="ghost" onPress={() => router.push('/site/new')} />
        ) : null}
      </Rowed>
    </View>
  );
}
