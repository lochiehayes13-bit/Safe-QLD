import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { loadStockRun } from '@/db/stockRunRepo';
import { createPurchaseRequest, type PurchaseLine } from '@/db/opsRepo';
import { loadPrefs } from '@/app-prefs';
import { DEFAULT_STOCK_DAYS, MAX_STOCK_DAYS, type StockRun } from '@/domain/stockRun';
import { UNCOVERED_REASON } from '@/domain/partsNeeded';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Rowed, Screen, SectionHeader, Segmented, Txt,
} from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * What to load for the next few days.
 *
 * Asked for from the field by Chris Scoffell: "a stock list for x number of
 * days … referencing defect jobs and pulling required stock from them". The
 * chain was already on the phone in four separate places — the schedule, the
 * defect register, the coded parts library, the van list — and this is the one
 * screen that walks it.
 *
 * It answers with a shortfall rather than a total. Somebody standing at the
 * store does not want to know that the week's work needs six detector heads;
 * they want to know they are two short. So each line reads "get 2" with the
 * need and the van's count underneath it, and where the van has never carried
 * the part the count is blank rather than nought — nobody has looked, which is
 * a different fact from having none.
 *
 * Every rule behind it is in `@/domain/stockRun`, which touches no database and
 * is tested on its own. This screen picks a number of days and draws the answer.
 */

/** The horizons worth a tap. Beyond three weeks the schedule holds nothing. */
const CHOICES = ['3', '7', '14', String(MAX_STOCK_DAYS)] as const;
type Choice = (typeof CHOICES)[number];

export default function StockListScreen() {
  const t = useTheme();
  const [days, setDays] = useState<Choice>(String(DEFAULT_STOCK_DAYS) as Choice);
  const [run, setRun] = useState<StockRun | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [raising, setRaising] = useState(false);

  /*
   * A read that threw leaves `run` null, and a null run here is the empty
   * state — "nothing booked" — which is a completely different thing from "the
   * register could not be read". Held apart so a broken read cannot read as a
   * quiet week and send somebody out with an empty van.
   */
  const load = useCallback(async (forDays: string) => {
    setBusy(true);
    setFailed(null);
    try {
      setRun(await loadStockRun(Number(forDays)));
    } catch (e) {
      setRun(null);
      setFailed(describeLoadFailure(e, 'the stock list'));
    } finally {
      setBusy(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(days); }, [load, days]));

  const choose = (next: Choice) => {
    setDays(next);
    void load(next);
  };

  /**
   * Turns the shortfall into a purchase request for the office.
   *
   * Only the lines that are actually short: a part the van already carries
   * enough of is on the screen for the arithmetic and has no business on an
   * order. No part number is sent as a real blank rather than an empty string
   * standing in for one — the office picks, and it is visible that nobody has.
   */
  const raise = async () => {
    if (!run) return;
    const short = run.lines.filter((l) => l.short > 0);
    if (!short.length) {
      showAlert('Nothing to order', 'The van already carries everything this window calls for.');
      return;
    }

    setRaising(true);
    try {
      const prefs = await loadPrefs();
      const lines: PurchaseLine[] = short.map((l) => ({
        partNumber: l.partNumber ?? '',
        description: l.description,
        quantity: l.short,
        note: `${l.defectCount} defect${l.defectCount === 1 ? '' : 's'} (${l.fromCodes.join(', ')})`
          + `${l.sites.length ? ` at ${l.sites.join(', ')}` : ''}`,
      }));
      await createPurchaseRequest({
        requestedBy: prefs.technicianName || undefined,
        lines,
        notes: `Stock for ${run.days} ${run.days === 1 ? 'day' : 'days'} from ${formatAuDate(run.from)}: `
          + `${run.sites.length} ${run.sites.length === 1 ? 'building' : 'buildings'} booked.`,
      });
      showAlert(
        'Request raised',
        `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} added to a purchase request. `
        + 'It goes to the office with the rest of the queue.',
      );
      // Straight to it, as Van stock does. A request raised and not shown is a
      // request nobody is sure went anywhere.
      router.push('/work/purchases');
    } catch (e) {
      showAlert('Could not raise it', describeActionFailure(e, 'raise the purchase request'));
    } finally {
      setRaising(false);
    }
  };

  const shortCount = run?.lines.filter((l) => l.short > 0).length ?? 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Stock to load' }} />

      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          What the work booked in the days ahead calls for, less what the van already carries.
          Built from the open defects at each building.
        </Txt>
        <View style={{ height: t.space(3) }} />
        <Segmented
          value={days}
          onChange={choose}
          options={CHOICES.map((d) => ({ value: d, label: `${d} days` }))}
        />
      </Card>

      {failed ? (
        <>
          <Banner tone="fail" title="The stock list could not be built" body={failed} />
          <Button title="Try again" variant="secondary" onPress={() => void load(days)} />
        </>
      ) : null}

      {busy && !run ? (
        <Txt size="sm" tone="muted" style={{ marginTop: t.space(4) }}>Reading the diary…</Txt>
      ) : null}

      {run ? (
        <>
          {/*
            * One banner, not one per note. Three stacked info boxes read as
            * three problems; they are three things to know about the same list.
            */}
          {run.notes.length ? (
            <Banner tone="info" title="Before you load" body={run.notes.join('\n\n')} />
          ) : null}

          {run.sites.length === 0 ? (
            <EmptyState
              icon="calendar-blank-outline"
              title="Nothing booked in this window"
              body={
                `There is no work on the schedule between ${formatAuDate(run.from)} and `
                + `${formatAuDate(run.to)}, so there is nothing to load for. If that looks wrong, `
                + 'sync and look again.'
              }
              action={<Button title="Open the schedule" variant="secondary" compact onPress={() => router.push('/work/schedule')} />}
            />
          ) : (
            <>
              <SectionHeader title={`Get ${shortCount} ${shortCount === 1 ? 'line' : 'lines'}`} />
              <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2) }}>
                {`${run.sites.length} ${run.sites.length === 1 ? 'building' : 'buildings'} over `}
                {`${run.days} ${run.days === 1 ? 'day' : 'days'} to ${formatAuDate(run.to)}.`}
              </Txt>

              {run.lines.length === 0 ? (
                <EmptyState
                  icon="clipboard-check-outline"
                  title="Nothing to take"
                  body="Nothing is open against the buildings booked in this window."
                />
              ) : (
                <Card>
                  {run.lines.map((line, i) => (
                    <View key={`${line.description}|${line.unit}`}>
                      {i > 0 ? <Divider /> : null}
                      <Rowed gap={2}>
                        <Txt weight="700" style={{ flex: 1 }}>{line.description}</Txt>
                        <Chip
                          label={line.short > 0 ? `Get ${line.short}` : 'Covered'}
                          tone={line.short > 0 ? 'accent' : 'pass'}
                        />
                      </Rowed>
                      <Txt size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>
                        {`Needs ${line.needed} ${line.unit} · `}
                        {line.onHand === undefined
                          ? 'not on the van list'
                          : `${line.onHand} on the van`}
                        {line.partNumber ? ` · ${line.partNumber}` : ''}
                      </Txt>
                      <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>
                        {`${line.defectCount} defect${line.defectCount === 1 ? '' : 's'}`}
                        {line.sites.length ? ` · ${line.sites.join(', ')}` : ''}
                      </Txt>
                    </View>
                  ))}
                </Card>
              )}

              {shortCount > 0 ? (
                <Button
                  title={`Raise a request for ${shortCount} ${shortCount === 1 ? 'line' : 'lines'}`}
                  onPress={raise}
                  loading={raising}
                />
              ) : null}

              <SectionHeader title="Where it is going" />
              <Card>
                {run.sites.map((site, i) => (
                  <View key={site.siteId}>
                    {i > 0 ? <Divider /> : null}
                    <Rowed gap={2}>
                      <Txt weight="700" style={{ flex: 1 }}>{site.siteName}</Txt>
                      <Chip
                        label={`${site.openDefects} open`}
                        tone={site.openDefects ? 'warn' : 'muted'}
                      />
                    </Rowed>
                    <Txt size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>
                      {site.days.map(formatAuDate).join(', ')}
                      {site.jobNumbers.length ? ` · job ${site.jobNumbers.join(', ')}` : ''}
                    </Txt>
                  </View>
                ))}
              </Card>

              {/*
                * Named rather than dropped. A free-text defect and a labour-only
                * one both put nothing on the list, and a list that hides them
                * looks complete while missing the reason somebody is going.
                */}
              {run.uncovered.length ? (
                <>
                  <SectionHeader title={`${run.uncovered.length} put nothing on the list`} />
                  <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2) }}>
                    Still work — just nothing to carry for it.
                  </Txt>
                  <Card>
                    {[...new Set(run.uncovered.map((u) => u.reason))].map((reason) => {
                      const count = run.uncovered.filter((u) => u.reason === reason).length;
                      return (
                        <Txt key={reason} size="sm" tone="muted" style={{ lineHeight: 19 }}>
                          {`${count} — ${UNCOVERED_REASON[reason].toLowerCase()}.`}
                        </Txt>
                      );
                    })}
                  </Card>
                </>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
