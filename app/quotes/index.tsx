import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { expireLapsedQuotes, listQuotes, setQuoteStatus } from '@/db/quoteRepo';
import {
  QUOTE_STATUS_LABEL, canTransition, lapseStatus, orderQuotes, quoteTotals,
  type Quote, type QuoteStatus,
} from '@/domain/quote';
import { formatCents } from '@/domain/rates';
import { siteFallbackWords } from '@/domain/siteMiss';
import { formatAuDate } from '@/export/sheets';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { showAlert } from '@/components/alert';
import { SiteMissCards, useSiteMisses } from '@/components/SiteMisses';
import {
  Banner, Button, Card, Chip, EmptyState, Rowed, Screen, SearchBox, Segmented, StatTile, Txt,
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
 * **Searchable by the building, like every other module.** This screen had no
 * search box at all — the owner's "every site appears in every single module
 * when searching a site, whether there's jobs available or not" had nothing to
 * appear in here. The Simpro half of the same switch has had one all along, so
 * the two faces of one screen disagreed about whether quotes could be found.
 *
 * The search runs in the database over every quote this phone holds, not over
 * the rows drawn, and it reaches the site through the same shared clause the
 * sites tab and the picker use — so a quote is findable by the building's
 * address, suburb, postcode, client, the office's reference and the office's
 * site number, not only by the name that was written onto the quote. And where
 * a building has no quotes, the screen offers the building rather than saying
 * "Nothing matches" about a site that is plainly on the phone.
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

/**
 * How many issued quotes the three tiles are counted over.
 *
 * The tiles answer "what is out, and what is still good", which is a question
 * about the book and not about what was typed — so they are read separately
 * from the list and the search does not move them. An issued quote lapses, so
 * the live ones are tens; where there are somehow more than this the caption
 * says so rather than quietly understating the value out.
 */
const OUT_COUNTED = 500;

const asRow = (quote: Quote, asAt: string): Row => {
  const totals = quoteTotals(quote, asAt);
  const lapse = lapseStatus(quote, asAt);
  return {
    quote,
    totalCents: totals.totalCents,
    incomplete: totals.incomplete,
    daysRemaining: lapse.daysRemaining,
    note: lapse.note,
  };
};

export default function QuotesScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState<{ total: number; matching: number; capped: boolean } | null>(null);
  const [out, setOut] = useState<Row[]>([]);
  const [outCapped, setOutCapped] = useState(false);
  const [expired, setExpired] = useState(0);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');

  // The search is a query now, so it waits for the typing to stop. The same
  // 200ms the job list and the Simpro quote list use, because a search that
  // settles at a different speed on each screen reads as an app that is
  // sometimes slow.
  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async () => {
    const asAt = nowIso();
    const [found, issued] = await Promise.all([
      listQuotes({ query }),
      listQuotes({ status: 'issued', limit: OUT_COUNTED }),
    ]);
    setPage({ total: found.total, matching: found.matching, capped: found.capped });
    setRows(found.rows.map((quote) => asRow(quote, asAt)));
    setOut(issued.rows.map((quote) => asRow(quote, asAt)));
    setOutCapped(issued.capped);
  }, [query]);

  /*
   * The lapse pass belongs to opening the screen, not to typing in it.
   *
   * It used to sit inside the load, which was fine while the load only ran on
   * focus. With a search box the load runs again every time the typing
   * settles, and that would mark quotes expired on a keystroke and — worse —
   * reset the count behind the banner to zero, so the one sentence telling
   * somebody that four quotes lapsed while the phone was in a van would
   * disappear as soon as they typed into the box underneath it.
   *
   * The tick is what carries "the screen was opened" into the load below, so
   * the list is still built after the lapse and not before it.
   */
  const [opened, setOpened] = useState(0);
  useFocusEffect(useCallback(() => {
    let live = true;
    void (async () => {
      let lapsed: string[] = [];
      try {
        lapsed = await expireLapsedQuotes(nowIso());
      } catch {
        // A clock the app cannot read is not a reason to show nothing. The
        // quotes still list; they just keep the status they were saved with.
      }
      if (live) { setExpired(lapsed.length); setOpened((n) => n + 1); }
    })();
    return () => { live = false; };
  }, []));

  /*
   * The list, re-read when the screen is opened and when the typing settles.
   *
   * useFocusEffect rather than useEffect for the same reason the job list uses
   * it: it re-runs when the callback changes while focused, so a new query
   * reloads, and it does not run at all for a screen nobody is looking at.
   * Nothing before the first focus, so opening is one read and not two — the
   * lapse pass above raises the count that lets this run.
   */
  useFocusEffect(useCallback(() => { if (opened) void load(); }, [load, opened]));

  /*
   * The buildings the words match, for the dead end this box would otherwise
   * have had on the day it was added. A site with no quotes is the ordinary
   * case — one has never been raised there — and the technician who typed it
   * still wants the building.
   */
  const siteHits = useSiteMisses(query, !rows.length && page !== null);

  // Ordered by the domain rather than here, so the rule is testable and the
  // screen cannot quietly disagree with it.
  const ordered = useMemo(
    () => orderQuotes(rows.map((r) => ({ ...r.quote, row: r })), nowIso()).map((q) => q.row),
    [rows],
  );

  const closing = out.filter((r) => (r.daysRemaining ?? Infinity) <= 7).length;
  const outValue = out.reduce((n, r) => n + r.totalCents, 0);

  const move = async (row: Row, to: QuoteStatus) => {
    const check = canTransition(row.quote, to, nowIso());
    if (!check.allowed) {
      // The state machine's own words. It says why in a sentence meant for a
      // person, and rewording it here would only make the two disagree.
      showAlert('Cannot change this quote', check.reason ?? 'That change is not allowed.');
      return;
    }
    try {
      await setQuoteStatus(row.quote.id, to, { asAt: nowIso() });
      await load();
    } catch (e) {
      showAlert('Could not change this quote', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Quotes' }} />

      {/*
        * Two sources, one switch. These are priced on this phone off the rate
        * card; the office's own quotes, priced in Simpro, sit behind the other
        * half, and the same switch is at the top of that screen. Replace rather
        * than push, so the pair reads as one screen with two faces and back
        * leaves the quotes altogether instead of flicking between them.
        */}
      <Segmented
        value="ours"
        onChange={(v) => { if (v === 'simpro') router.replace('/quotes/simpro'); }}
        options={[{ value: 'ours', label: 'Ours on this phone' }, { value: 'simpro', label: 'Simpro' }]}
      />

      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        Every quote raised on this device. A quote is raised from a site, off its own defect list
        and the rate card.
      </Txt>

      <SearchBox value={typed} onChange={setTyped} placeholder="Quote number, site, suburb or client" />
      {page && page.total ? (
        <Txt size="xs" tone="faint">
          {page.matching.toLocaleString()} of {page.total.toLocaleString()} quote{page.total === 1 ? '' : 's'}
          {/* Said out loud where the list is cut, because a number over a list
              that does not match the rows under it is worse than no number.
              The search still reaches every quote: it runs in the database,
              not over the rows on screen. */}
          {page.capped ? ` · first ${rows.length} shown, search to narrow` : ''}
        </Txt>
      ) : null}

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
      {/* These three are about the book, not about what was typed, so they are
          read separately and the search leaves them alone. Where there are
          somehow more issued quotes than one read covers, the number is a
          floor and says so. */}
      {outCapped ? (
        <Txt size="xs" tone="faint">
          Counted over the first {OUT_COUNTED.toLocaleString()} issued quotes, so these are at least this much.
        </Txt>
      ) : null}

      {/*
        * Three different pieces of news, which used to be one sentence.
        *
        * "No quotes raised yet" was shown whenever the list was empty, and
        * with a search box that would say it to somebody holding two hundred
        * quotes who mistyped a suburb. What is true depends on whether
        * anything was typed and whether the building is on this phone at all.
        */}
      {page && !rows.length ? (
        <>
          <EmptyState
            icon="file-document-edit-outline"
            {...(!page.total
              ? {
                title: 'No quotes raised yet',
                body: 'A quote comes off a site’s open defects — open the site and choose Quote. The '
                  + 'lines come from the defect codes and the hours from the rate card.',
              }
              : siteHits.length
                ? siteFallbackWords(siteHits.length, 'quotes')
                : {
                  title: 'Nothing matches',
                  body: 'Try the quote number on its own, or part of the site, the suburb or the client.',
                })}
          />
          <SiteMissCards sites={siteHits} />
        </>
      ) : null}

      {ordered.map((row) => (
        <Card
          key={row.quote.id}
          onPress={() => router.push({ pathname: '/quote/[id]', params: { id: row.quote.id } })}
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
