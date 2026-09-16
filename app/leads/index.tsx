import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { loadPrefs } from '@/app-prefs';
import { listLeads, type LeadRecord } from '@/db/moreRepo';
import { getSiteByExternalId } from '@/db/searchRepo';
import type { Site } from '@/domain/types';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { describeLoadFailure } from '@/domain/loadFailure';
import { everSynced } from '@/simpro/watermark';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Reveal } from '@/components/motion';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, SearchBox, StatusPill, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Leads: the work the office is chasing before it is a quote.
 *
 * An office list that reads as office work, but it stays in both modes —
 * a lead carries no price, only a site, a customer and a stage, and "is
 * anything happening with that building" gets asked of whoever is
 * standing in it. No hub lists it in either mode; Find anything is the
 * way in. The stage chips are whatever stages the office uses, read off
 * the leads themselves rather than listed here from memory.
 */

const PAGE = 100;

export default function LeadsScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  const [typed, setTyped] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [stage, setStage] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<LeadRecord[] | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [empty, setEmpty] = useState<EmptyStateWords | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const found = await listLeads({ stage, query, limit: PAGE });
      setRows(found);
      // The stages on offer come from the unfiltered list, so choosing one
      // does not make the others vanish from the row.
      if (!stage && !query.trim()) {
        setStages([...new Set(found.map((l) => l.stage?.trim()).filter((s): s is string => !!s))]);
      }
      if (!found.length && !query.trim() && !stage) {
        const prefs = await loadPrefs();
        setEmpty(officeEmptyState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'leads',
        ));
      } else {
        setEmpty(null);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the leads'));
    }
  }, [stage, query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => rows ?? [], [rows]);

  return (
    <>
      <Stack.Screen options={{ title: 'Leads' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2.5) }}>
          <SearchBox value={typed} onChange={setTyped} placeholder="Lead, customer or site" />
          {stages.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              <Chip label="All stages" selected={!stage} onPress={() => setStage(undefined)} />
              {stages.map((s) => <Chip key={s} label={s} selected={stage === s} onPress={() => setStage(stage === s ? undefined : s)} />)}
            </ScrollView>
          ) : null}
          {rows ? (
            <Txt size="xs" tone="faint">
              {rows.length >= PAGE ? `The newest ${PAGE} shown. Search to narrow.` : `${rows.length} lead${rows.length === 1 ? '' : 's'}`}
            </Txt>
          ) : null}
        </View>
        <FlatList
          data={shown}
          keyExtractor={(l) => l.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={failed ? <Banner tone="fail" title="The leads could not be read" body={failed} /> : null}
          ListEmptyComponent={rows === null && !failed ? null : (
            empty ? (
              <EmptyState icon="lightbulb-outline" title={empty.title} body={empty.body} />
            ) : (
              <EmptyState
                icon="lightbulb-outline"
                title={query.trim() ? 'Nothing matched' : stage ? `Nothing at ${stage}` : 'No leads'}
                body={query.trim() ? 'Try part of the customer or site name.' : 'The office is chasing nothing the phone knows of.'}
              />
            )
          )}
          renderItem={({ item, index }) => {
            const row = <LeadRow lead={item} />;
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

function LeadRow({ lead: l }: { lead: LeadRecord }) {
  const t = useTheme();
  // A lead has no record screen of its own; the site it names does, where
  // the phone holds it, and that is the useful place to land.
  const openSite = async () => {
    if (!l.siteId) return;
    let site: Site | null;
    try {
      site = await getSiteByExternalId(l.siteId);
    } catch (e) {
      showAlert('The site could not be looked up', e instanceof Error ? e.message : String(e));
      return;
    }
    if (!site) {
      showAlert('Not on this phone yet', `The site this lead names${l.siteName ? ` (${l.siteName})` : ''} has not come down from the office. It arrives with the next sync.`);
      return;
    }
    router.push({ pathname: '/site/[id]', params: { id: site.id } });
  };
  return (
    <Card onPress={l.siteId ? () => { void openSite(); } : undefined}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1 }}>
          <Txt weight="700" numberOfLines={2}>{l.name}</Txt>
          {l.siteName || l.customerName ? (
            <Txt size="sm" tone="muted" numberOfLines={1}>{[l.siteName, l.customerName].filter(Boolean).join(' · ')}</Txt>
          ) : null}
          <Txt size="xs" tone="faint">
            {[
              `#${l.id}`,
              l.dateCreated ? `Raised ${formatAuDate(l.dateCreated)}` : undefined,
              l.followUpDate ? `Follow up ${formatAuDate(l.followUpDate)}` : undefined,
              l.salesperson ? `with ${l.salesperson}` : undefined,
            ].filter(Boolean).join(' · ')}
          </Txt>
          {l.description ? <Txt size="xs" tone="muted" numberOfLines={2} style={{ marginTop: 4 }}>{l.description}</Txt> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatusPill label={l.status ?? l.stage ?? 'Lead'} tone="info" />
          {l.tags.slice(0, 2).map((tag) => <Chip key={tag} label={tag} />)}
        </View>
      </Rowed>
      {l.siteId ? <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5) }}>Opens the site where the phone holds it.</Txt> : null}
    </Card>
  );
}
