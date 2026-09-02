import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { expireLapsedQuotes, listQuotes, setQuoteStatus } from '@/db/quoteRepo';
import {
  QUOTE_STATUS_LABEL, canTransition, lapseStatus, orderQuotes, quoteTotals,
  type Quote, type QuoteStatus,
} from '@/domain/quote';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, Rowed, Screen, StatTile, Txt,
} from '@/components/ui';

/**
 * Every quote, across every site.
 *
 * The quote builder saved a quote and there was nothing that could ever show it
 * again — no list, no way back to one, and nothing calling the expiry the
 * repository had already been written to do. So a quote was a document you
 * produced once and then lost track of, and the office half of this app could
 * not answer the only question it gets asked about them: what is out, and what
 * is still good.
 *
 * Ordered by what needs an answer soonest rather than by site or by date. An
 * issued quote about to lapse is the row that matters; one accepted last month
 * is history. A list ordered alphabetically buries the first at the letter S.
 *
 * ---
 *
 * **Lapsing happens here, on open.** `expireLapsedQuotes` was written with a
 * comment saying to run it when the quote list is opened, and until there was
 * a quote list nothing did. An issued quote sitting a month past its expiry
 * still read as live, and someone accepts it — at last year's rates, which is
 * the job done at a loss the expiry exists to prevent.
 *
 * It is done on open rather than on a timer because there is no server here:
 * the app is offline by design, and a phone that has not been opened for a
 * fortnight has to catch up when it is. The count is shown rather than done
 * silently, because a quote changing state without anybody being told is how
 * the office finds out from the client.
 */

type Row = {
  quote: Quote;
  totalCents: number;
  incomplete: boolean;
  daysRemaining?: number;
  note: string;
};

export default function QuotesScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [expired, setExpired] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const asAt = nowIso();
    // Before the list is built, not after, so nothing on screen is a state the
    // quote is no longer in.
    let lapsed: string[] = [];
    try {
      lapsed = await expireLapsedQuotes(asAt);
    } catch {
      // A clock the app cannot read is not a reason to show nothing. The
      // quotes still list; they just keep the status they were saved with.
    }
    const quotes = await listQuotes();
    setExpired(lapsed.length);
    setRows(quotes.map((quote) => {
      const totals = quoteTotals(quote, asAt);
      const lapse = lapseStatus(quote, asAt);
      return {
        quote,
        totalCents: totals.totalCents,
        incomplete: totals.incomplete,
        daysRemaining: lapse.daysRemaining,
        note: lapse.note,
      };
    }));
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Ordered by the domain rather than here, so the rule is testable and the
  // screen cannot quietly disagree with it.
  const ordered = useMemo(
    () => orderQuotes(rows.map((r) => ({ ...r.quote, row: r })), nowIso()).map((q) => q.row),
    [rows],
  );

  const out = rows.filter((r) => r.quote.status === 'issued');
  const closing = out.filter((r) => (r.daysRemaining ?? Infinity) <= 7).length;
  const outValue = out.reduce((n, r) => n + r.totalCents, 0);

  const move = async (row: Row, to: QuoteStatus) => {
    const check = canTransition(row.quote, to, nowIso());
    if (!check.allowed) {
      // The state machine's own words. It says why in a sentence meant for a
      // person, and rewording it here would only make the two disagree.
      Alert.alert('Cannot change this quote', check.reason ?? 'That change is not allowed.');
      return;
    }
    try {
      await setQuoteStatus(row.quote.id, to, { asAt: nowIso() });
      await load();
    } catch (e) {
      Alert.alert('Could not change this quote', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Quotes' }} />

      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        Every quote raised on this device. A quote is raised from a site, off its own defect list
        and the rate card.
      </Txt>

      {expired ? (
        <Banner
          tone="warn"
          title={`${expired} quote${expired === 1 ? '' : 's'} lapsed since this was last opened`}
          body={'Prices move, so a quote holds good only for its validity period. These are marked '
            + 'expired rather than left reading as live — raise a new one at current rates if the '
            + 'client still wants the work.'}
        />
      ) : null}

      <Rowed gap={2} wrap>
        <View style={{ flex: 1, minWidth: 100 }}>
          <StatTile label="Out with clients" value={out.length} tone={out.length ? 'warn' : 'muted'} />
        </View>
        <View style={{ flex: 1, minWidth: 100 }}>
          <StatTile label="Closing this week" value={closing} tone={closing ? 'fail' : 'muted'} />
        </View>
        <View style={{ flex: 1, minWidth: 120 }}>
          <StatTile label="Value out" value={formatCents(outValue)} tone="muted" />
        </View>
      </Rowed>

      {loaded && !rows.length ? (
        <EmptyState
          title="No quotes raised yet"
          body={'A quote comes off a site’s open defects — open the site and choose Quote. The '
            + 'lines come from the defect codes and the hours from the rate card.'}
        />
      ) : null}

      {ordered.map((row) => (
        <Card
          key={row.quote.id}
          onPress={() => router.push({ pathname: '/site/[id]', params: { id: row.quote.siteId } })}
        >
          <Rowed>
            <View style={{ flex: 1 }}>
              <Txt weight="700">{row.quote.siteName || 'Unnamed site'}</Txt>
              <Txt size="sm" tone="muted">
                {row.quote.reference}
                {row.quote.clientName ? ` · ${row.quote.clientName}` : ''}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Chip label={QUOTE_STATUS_LABEL[row.quote.status]} tone={toneFor(row)} />
              <Txt weight="700">{formatCents(row.totalCents)}</Txt>
            </View>
          </Rowed>

          {row.incomplete ? (
            <Txt size="sm" tone="warn">
              Something on this quote has no price, so the total is not the whole job.
            </Txt>
          ) : null}

          {row.quote.status === 'issued' ? (
            <Txt
              size="sm"
              tone={(row.daysRemaining ?? Infinity) <= 7 ? 'warn' : 'muted'}
            >
              Issued {formatAuDate(row.quote.issuedAt)} · {row.note}
            </Txt>
          ) : null}

          {row.quote.status === 'expired' ? (
            <Txt size="sm" tone="muted">{row.note}</Txt>
          ) : null}

          {row.quote.status === 'accepted' ? (
            <Txt size="sm" tone="muted">
              Accepted {formatAuDate(row.quote.acceptedAt)}
              {row.quote.acceptedBy ? ` by ${row.quote.acceptedBy}` : ''}
            </Txt>
          ) : null}

          {row.quote.status === 'declined' ? (
            <Txt size="sm" tone="muted">Declined {formatAuDate(row.quote.declinedAt)}</Txt>
          ) : null}

          {/*
            * Only the moves the state machine actually allows. An accepted or
            * declined quote is finished with, and offering a button that
            * refuses when pressed is worse than offering none.
            */}
          {row.quote.status === 'issued' ? (
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <Button title="Accepted" variant="secondary" onPress={() => void move(row, 'accepted')} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Declined" variant="secondary" onPress={() => void move(row, 'declined')} />
              </View>
            </Rowed>
          ) : null}
        </Card>
      ))}

      {rows.length ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          A quote holds good for its validity period only, counted in Queensland dates from the day
          it was issued. Lapsed quotes are marked expired when this screen is opened.
        </Txt>
      ) : null}
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}

function toneFor(row: Row): 'default' | 'pass' | 'warn' | 'fail' {
  if (row.quote.status === 'accepted') return 'pass';
  if (row.quote.status === 'expired') return 'fail';
  if (row.quote.status === 'issued') return (row.daysRemaining ?? Infinity) <= 7 ? 'warn' : 'default';
  return 'default';
}
