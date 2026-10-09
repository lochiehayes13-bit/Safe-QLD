import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { qldIsoDay } from '@/domain/qldTime';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createOccupierStatement, listOccupierStatements, type OccupierStatement } from '@/db/occupierRepo';
import { listSitePicks, type SitePick } from '@/db/repo';
import {
  COMMISSIONER_COPY_BUSINESS_DAYS, STATEMENT_RETENTION_YEARS,
  commissionerCopyDeadline, nextStatementDue, qldBusinessDaysBetween,
} from '@/domain/occupierForm';
import { formatAuDate } from '@/export/sheets';
import { nowIso } from '@/db';
import { siteFallbackWords } from '@/domain/siteMiss';
import { useTheme } from '@/theme';
import { SiteMissCards, useSiteMisses } from '@/components/SiteMisses';
import { SitePicker } from '@/components/SitePicker';
import {
  Banner, Button, Card, Chip, EmptyState, Rowed, Screen, SearchBox, StatTile, Txt,
} from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { needsSiteState } from '@/domain/deviceData';
import { loadPrefs } from '@/app-prefs';
import { everSynced } from '@/simpro/watermark';
import { showAlert } from '@/components/alert';

/**
 * Every occupier statement, across every site.
 *
 * The duty is the occupier's, but the clock is the thing that gets missed, and
 * it cannot be seen one site at a time. A statement signed and never sent to
 * the commissioner looks, from the site screen, exactly like a statement that
 * was sent — both are signed. Across 897 sites nobody notices until somebody
 * asks.
 *
 * So this is ordered by what is closest to being late rather than by site or by
 * date: overdue first, then due soonest, then everything settled. A list
 * ordered alphabetically buries the one row that matters at the letter S.
 *
 * The deadline shown is the statutory one — ten business days from the day the
 * statement was *required to be prepared*, not from the day it was signed.
 * Those are the same date only for an occupier who signs on their anniversary,
 * and counting from the signature shows a comfortable deadline for one that has
 * already run.
 *
 * ---
 *
 * **Searchable by the building.** There was nothing to type into. Every
 * statement the phone holds and every site the phone holds, read on each
 * focus, ordered by what is closest to being late — and no way to ask about
 * one building. This is the module where a building is the only thing anybody
 * looks a statement up by, because the statement is the occupier's and the
 * occupier is a building.
 *
 * The three tiles are deliberately read apart from the search. They are the
 * state of the duty across the whole book, which is not a question about what
 * somebody has typed into a box.
 */

type Row = {
  statement: OccupierStatement;
  due?: string;
  daysLeft?: number;
  state: 'sent' | 'overdue' | 'due' | 'unsigned';
};

/**
 * How many unsent statements the tiles are counted over.
 *
 * A statement the commissioner has had is settled and counts toward none of
 * the three, so only the unsent ones are read. That is the actionable backlog
 * and it is small; where it somehow is not, the caption says the numbers are a
 * floor rather than quietly understating how late the company is.
 */
const DUTY_COUNTED = 500;

/** The state of one statement, which is what all three tiles are counting. */
const stateOf = (statement: OccupierStatement, today: string): Row => {
  if (statement.sentToCommissionerAt) return { statement, state: 'sent' };
  if (!statement.signedAt) return { statement, state: 'unsigned' };
  const deadline = commissionerCopyDeadline({
    requiredPreparationDate: statement.periodEnd || undefined,
    signedDate: qldIsoDay(statement.signedAt),
  });
  const daysLeft = deadline.due ? qldBusinessDaysBetween(today, deadline.due).days : undefined;
  return {
    statement,
    due: deadline.due,
    daysLeft,
    state: daysLeft !== undefined && daysLeft < 0 ? 'overdue' : 'due',
  };
};


export default function OccupierIndexScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState<{ total: number; matching: number; capped: boolean } | null>(null);
  const [duty, setDuty] = useState<Row[]>([]);
  const [dutyCapped, setDutyCapped] = useState(false);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  // A read that threw is not an empty book. Said, with a way to try again.
  const [failed, setFailed] = useState<string | null>(null);
  /** The sites to choose from for a new statement, while a choice is being made. */
  const [picking, setPicking] = useState<SitePick[] | null>(null);
  const [starting, setStarting] = useState(false);

  // The search is a query, so it waits for the typing to stop — the same 200ms
  // every other list in this app settles at.
  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const today = qldIsoDay(nowIso()) ?? '';
      const [found, unsent] = await Promise.all([
        listOccupierStatements({ query }),
        listOccupierStatements({ unsentOnly: true, limit: DUTY_COUNTED }),
      ]);
      setPage({ total: found.total, matching: found.matching, capped: found.capped });
      setRows(found.rows.map((statement) => stateOf(statement, today)));
      setDuty(unsent.rows.map((statement) => stateOf(statement, today)));
      setDutyCapped(unsent.capped);
    } catch (e) {
      setPage(null);
      setRows([]);
      setDuty([]);
      setFailed(describeLoadFailure(e, 'the occupier statements'));
    }
  }, [query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /*
   * The buildings the words match, for the dead end this box would otherwise
   * have. A site with no statement is the ordinary case — the occupier has
   * never been asked for one — and that is the site somebody is most likely
   * hunting for in this module.
   */
  const siteHits = useSiteMisses(query, !rows.length && page !== null);

  /*
   * Ordered by how close each is to being late. Overdue first, then the ones
   * with least time left. A list ordered by site buries the row that matters.
   */
  const ordered = useMemo(() => {
    const rank = { overdue: 0, due: 1, unsigned: 2, sent: 3 };
    return [...rows].sort((a, b) =>
      rank[a.state] - rank[b.state]
      || (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY)
      || (a.statement.siteName ?? '').localeCompare(b.statement.siteName ?? ''));
  }, [rows]);

  // Counted over the unsent statements, not over the search: these three are
  // the state of the duty across the book, and a number that moved while
  // somebody typed a suburb would be answering a different question.
  const overdue = duty.filter((r) => r.state === 'overdue').length;
  const outstanding = duty.filter((r) => r.state === 'due').length;
  const unsigned = duty.filter((r) => r.state === 'unsigned').length;

  const startFor = async (site: SitePick) => {
    setStarting(true);
    try {
      const rec = await createOccupierStatement(site.id, {
        premisesName: site.name,
        premisesAddress: site.address ?? '',
      });
      setPicking(null);
      router.push({ pathname: '/occupier/[id]', params: { id: rec.id } });
    } catch (e) {
      showAlert('Statement not started', describeActionFailure(e, 'start the statement'));
    } finally {
      setStarting(false);
    }
  };

  const start = async () => {
    try {
      const all = await listSitePicks();
      if (!all.length) {
        const prefs = await loadPrefs();
        const words = needsSiteState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'An occupier statement',
        );
        showAlert(words.title, words.body, words.action
          ? [{ text: words.action.label, onPress: () => router.push(words.action!.route) }, { text: 'Not now', style: 'cancel' }]
          : undefined);
        return;
      }
      if (all.length === 1) { await startFor(all[0]!); return; }
      setPicking(all);
    } catch (e) {
      showAlert('Statement not started', describeActionFailure(e, 'read the sites'));
    }
  };

  if (picking) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Which site?' }} />
        <SitePicker
          sites={picking}
          onChange={(siteId: string) => {
            const site = picking.find((s) => s.id === siteId);
            if (site) void startFor(site);
          }}
        />
        <Button title="Cancel" variant="ghost" onPress={() => setPicking(null)} disabled={starting} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Occupier statements' }} />

      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        We prepare each statement; the occupier signs it. The Commissioner&rsquo;s copy is due{' '}
        {COMMISSIONER_COPY_BUSINESS_DAYS} business days after the period end.
      </Txt>

      <Button title="New statement" onPress={() => { void start(); }} loading={starting} />

      {failed ? (
        <>
          <Banner tone="fail" title="List not loaded" body={failed} />
          <Button title="Try again" variant="secondary" onPress={() => { void load(); }} />
        </>
      ) : null}

      {overdue ? (
        <Banner
          tone="fail"
          title={`${overdue} statement${overdue === 1 ? '' : 's'} past the Commissioner deadline`}
          body="Counted from the period end, not the signing date. Building Fire Safety Regulation 2008, s 55A(3)."
        />
      ) : null}

      <Rowed gap={2} wrap>
        <View style={{ flex: 1, minWidth: 100 }}>
          <StatTile label="Overdue" value={overdue} tone={overdue ? 'fail' : 'muted'} />
        </View>
        <View style={{ flex: 1, minWidth: 100 }}>
          <StatTile label="To send" value={outstanding} tone={outstanding ? 'warn' : 'muted'} />
        </View>
        <View style={{ flex: 1, minWidth: 100 }}>
          <StatTile label="Unsigned" value={unsigned} tone="muted" />
        </View>
      </Rowed>
      {dutyCapped ? (
        <Txt size="xs" tone="faint">
          At least this many.
        </Txt>
      ) : null}

      <SearchBox value={typed} onChange={setTyped} placeholder="Building, suburb, occupier or signer" />
      {page && page.total ? (
        <Txt size="xs" tone="faint">
          {page.matching.toLocaleString()} of {page.total.toLocaleString()} statement{page.total === 1 ? '' : 's'}
          {/* Said out loud where the list is cut: a number over a list that
              does not match the rows under it is worse than no number. The
              search still reaches every statement — it runs in the database,
              not over the rows on screen. */}
          {page.capped ? ` · first ${rows.length} shown, search to narrow` : ''}
        </Txt>
      ) : null}

      {/*
        * Three different pieces of news, which used to be one sentence.
        *
        * "No occupier statements yet" was shown whenever the list was empty,
        * and with a search box that would say it to somebody holding four
        * hundred who typed a suburb two ways.
        */}
      {page && !rows.length ? (
        <>
          <EmptyState
            icon="file-document-outline"
            {...(!page.total
              ? {
                title: 'No occupier statements yet',
                body: 'Start one here or from a site.',
              }
              : siteHits.length
                ? siteFallbackWords(siteHits.length, 'statements')
                : {
                  title: 'Nothing matches',
                  body: 'Try the building, suburb or occupier.',
                })}
          />
          <SiteMissCards sites={siteHits} />
        </>
      ) : null}

      {ordered.map((row) => (
        <Card
          key={row.statement.id}
          onPress={() => router.push({ pathname: '/occupier/[id]', params: { id: row.statement.id } })}
        >
          <Rowed>
            <View style={{ flex: 1 }}>
              <Txt weight="700">{row.statement.siteName ?? (row.statement.premisesName || 'Unnamed premises')}</Txt>
              <Txt size="sm" tone="muted">
                {row.statement.periodStart ? `${formatAuDate(row.statement.periodStart)} – ` : ''}
                {formatAuDate(row.statement.periodEnd) || 'Period not set'}
              </Txt>
            </View>
            <StateChip row={row} />
          </Rowed>

          {row.state === 'overdue' && row.daysLeft !== undefined ? (
            <Txt size="sm" tone="fail">
              {Math.abs(row.daysLeft)} business day{Math.abs(row.daysLeft) === 1 ? '' : 's'} late
              {row.due ? `, due ${formatAuDate(row.due)}` : ''}
            </Txt>
          ) : null}

          {row.state === 'due' && row.due ? (
            <Txt size="sm" tone={row.daysLeft !== undefined && row.daysLeft <= 3 ? 'warn' : 'muted'}>
              Commissioner copy due {formatAuDate(row.due)}
              {row.daysLeft !== undefined ? ` · ${row.daysLeft} business day${row.daysLeft === 1 ? '' : 's'} left` : ''}
            </Txt>
          ) : null}

          {row.state === 'unsigned' ? (
            <Txt size="sm" tone="muted">
              Not signed.
            </Txt>
          ) : null}

          {row.state === 'sent' ? <SentLine statement={row.statement} /> : null}
        </Card>
      ))}

      {rows.length ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          One statement a year per premises. Keep each for {STATEMENT_RETENTION_YEARS} years.
        </Txt>
      ) : null}
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}

function StateChip({ row }: { row: Row }) {
  if (row.state === 'sent') return <Chip label="Sent" tone="pass" />;
  if (row.state === 'overdue') return <Chip label="Overdue" tone="fail" />;
  if (row.state === 'due') return <Chip label="To send" tone="warn" />;
  return <Chip label="Unsigned" />;
}

/**
 * When the next one falls due, once this one is settled.
 *
 * Shown only on a sent statement, because on an unsent one it is the wrong
 * clock to be looking at.
 */
function SentLine({ statement }: { statement: OccupierStatement }) {
  const t = useTheme();
  const next = statement.signedAt
    ? nextStatementDue(qldIsoDay(statement.signedAt) ?? '')
    : undefined;
  return (
    <Rowed gap={2}>
      <MaterialCommunityIcons name="check-circle-outline" size={16} color={t.color.pass} />
      <Txt size="sm" tone="muted" style={{ flex: 1 }}>
        Sent {formatAuDate(statement.sentToCommissionerAt ?? undefined)}
        {next?.date ? ` · next due ${formatAuDate(next.date)}` : ''}
      </Txt>
    </Rowed>
  );
}
