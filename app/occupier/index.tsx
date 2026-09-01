import React, { useCallback, useMemo, useState } from 'react';
import { qldIsoDay } from '@/domain/qldTime';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listOccupierStatements, type OccupierStatement } from '@/db/occupierRepo';
import { listSites } from '@/db/repo';
import {
  COMMISSIONER_COPY_BUSINESS_DAYS, STATEMENT_INTERVAL_YEARS, STATEMENT_RETENTION_YEARS,
  commissionerCopyDeadline, nextStatementDue, qldBusinessDaysBetween,
} from '@/domain/occupierForm';
import { nowIso } from '@/db';
import type { Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, EmptyState, Rowed, Screen, StatTile, Txt,
} from '@/components/ui';

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
 */

type Row = {
  statement: OccupierStatement;
  site?: Site;
  due?: string;
  daysLeft?: number;
  state: 'sent' | 'overdue' | 'due' | 'unsigned';
};

const auDate = (iso?: string | null): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export default function OccupierIndexScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const [statements, sites] = await Promise.all([listOccupierStatements(), listSites()]);
    const bySite = new Map(sites.map((s) => [s.id, s]));
    const today = qldIsoDay(nowIso()) ?? '';

    setRows(statements.map((statement) => {
      const site = bySite.get(statement.siteId);
      if (statement.sentToCommissionerAt) {
        return { statement, site, state: 'sent' as const };
      }
      if (!statement.signedAt) {
        return { statement, site, state: 'unsigned' as const };
      }
      const deadline = commissionerCopyDeadline({
        requiredPreparationDate: statement.periodEnd || undefined,
        signedDate: qldIsoDay(statement.signedAt),
      });
      const daysLeft = deadline.due
        ? qldBusinessDaysBetween(today, deadline.due).days
        : undefined;
      return {
        statement,
        site,
        due: deadline.due,
        daysLeft,
        state: daysLeft !== undefined && daysLeft < 0 ? ('overdue' as const) : ('due' as const),
      };
    }));
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /*
   * Ordered by how close each is to being late. Overdue first, then the ones
   * with least time left. A list ordered by site buries the row that matters.
   */
  const ordered = useMemo(() => {
    const rank = { overdue: 0, due: 1, unsigned: 2, sent: 3 };
    return [...rows].sort((a, b) =>
      rank[a.state] - rank[b.state]
      || (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY)
      || (a.site?.name ?? '').localeCompare(b.site?.name ?? ''));
  }, [rows]);

  const overdue = rows.filter((r) => r.state === 'overdue').length;
  const outstanding = rows.filter((r) => r.state === 'due').length;
  const unsigned = rows.filter((r) => r.state === 'unsigned').length;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Occupier statements' }} />

      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        Queensland puts this duty on the occupier, not on us. We prepare it from the year&rsquo;s
        maintenance so they are signing something they can check, and a copy goes to the
        commissioner within {COMMISSIONER_COPY_BUSINESS_DAYS} business days.
      </Txt>

      {overdue ? (
        <Banner
          tone="fail"
          title={`${overdue} statement${overdue === 1 ? '' : 's'} past the commissioner deadline`}
          body={'Counted from the day each statement was required to be prepared, which is what '
            + 'section 55A(3) counts from — not from the day it was signed.'}
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

      {!rows.length ? (
        <EmptyState
          title="No occupier statements yet"
          body={'One is raised from a site — open the site and choose Occupier statement. It fills '
            + "in from that site's own register and defect history."}
        />
      ) : null}

      {ordered.map((row) => (
        <Card
          key={row.statement.id}
          onPress={() => router.push({ pathname: '/occupier/[id]', params: { id: row.statement.id } })}
        >
          <Rowed>
            <View style={{ flex: 1 }}>
              <Txt weight="700">{row.site?.name ?? (row.statement.premisesName || 'Unnamed premises')}</Txt>
              <Txt size="sm" tone="muted">
                {row.statement.periodStart ? `${auDate(row.statement.periodStart)} – ` : ''}
                {auDate(row.statement.periodEnd) || 'period not set'}
              </Txt>
            </View>
            <StateChip row={row} />
          </Rowed>

          {row.state === 'overdue' && row.daysLeft !== undefined ? (
            <Txt size="sm" tone="fail">
              {Math.abs(row.daysLeft)} business day{Math.abs(row.daysLeft) === 1 ? '' : 's'} late
              {row.due ? ` — was due ${auDate(row.due)}` : ''}
            </Txt>
          ) : null}

          {row.state === 'due' && row.due ? (
            <Txt size="sm" tone={row.daysLeft !== undefined && row.daysLeft <= 3 ? 'warn' : 'muted'}>
              Copy to the commissioner due {auDate(row.due)}
              {row.daysLeft !== undefined ? ` — ${row.daysLeft} business day${row.daysLeft === 1 ? '' : 's'} left` : ''}
            </Txt>
          ) : null}

          {row.state === 'unsigned' ? (
            <Txt size="sm" tone="muted">
              Not signed yet, so nothing is running against it.
            </Txt>
          ) : null}

          {row.state === 'sent' ? <SentLine statement={row.statement} /> : null}
        </Card>
      ))}

      {rows.length ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          One statement a year per premises, kept {STATEMENT_RETENTION_YEARS} years. The next one
          falls {STATEMENT_INTERVAL_YEARS} year after the last.
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
  const next = statement.signedAt
    ? nextStatementDue(qldIsoDay(statement.signedAt) ?? '')
    : undefined;
  return (
    <Rowed gap={2}>
      <MaterialCommunityIcons name="check-circle-outline" size={16} color="#2E9E5B" />
      <Txt size="sm" tone="muted" style={{ flex: 1 }}>
        Sent {auDate(statement.sentToCommissionerAt)}
        {next?.date ? ` · next due ${auDate(next.date)}` : ''}
      </Txt>
    </Rowed>
  );
}
