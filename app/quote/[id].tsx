import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import { getQuote, listQuoteLines, setQuoteStatus, updateQuote } from '@/db/quoteRepo';
import {
  QUOTE_STATUS_LABEL, canTransition, editRefusal, lapseStatus, lineAmountCents, qldDate, quoteTotals,
  scopeLinesFor, type Quote,
} from '@/domain/quote';
import { formatCents } from '@/domain/rates';
import { quoteDocumentHtml } from '@/export/quoteDocument';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { safeFileName } from '@/export/fileNames';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { RecordGate } from '@/components/RecordGate';
import { JobFileCard } from '@/components/JobFileCard';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, StatusPill, Txt,
} from '@/components/ui';

/**
 * A quote, after it has been raised.
 *
 * There was no way to open one. The list pushed to the site screen, `getQuote`
 * and `listQuoteLines` were called only from inside the repository itself, and
 * `updateQuote` and `deleteQuote` had no caller anywhere outside their tests.
 * So a quote issued on Tuesday could not be re-read on Wednesday: not to
 * reprint it for a client who lost it, not to check what was in it before
 * ringing them, not to mark it accepted when they rang back.
 *
 * Which is the thing this screen is for. The four things that happen to a
 * quote after it leaves are: it gets reprinted, it gets emailed again, it gets
 * accepted or declined, and it lapses. All four are here, and the fifth —
 * editing it — is deliberately refused once it has been issued, because the
 * client is holding a copy and two documents that disagree is worse than one
 * that is wrong.
 */
export default function QuoteScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither.
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [acceptedBy, setAcceptedBy] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const [found, prefs] = await Promise.all([getQuote(id), loadPrefs()]);
      if (found) found.lines = await listQuoteLines(found.id);
      setQuote(found);
      setMissing(!found);
      setCompanyName(prefs.companyName);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this quote'));
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const totals = useMemo(() => (quote ? quoteTotals(quote, nowIso()) : null), [quote]);
  const lapse = useMemo(() => (quote ? lapseStatus(quote, nowIso()) : undefined), [quote]);
  const locked = quote ? editRefusal(quote) : undefined;

  const pdf = useCallback(async () => {
    if (!quote) throw new Error('The quote is not loaded.');
    const html = quoteDocumentHtml({
      quote,
      companyName: companyName || undefined,
      scopeItems: scopeLinesFor([]),
      asAt: nowIso(),
    });
    const day = qldDate(nowIso()) ?? '';
    return writePdf(`Quote ${quote.reference || quote.siteName} ${day}`.trim(), html);
  }, [quote, companyName]);

  const share = async () => {
    setBusy(true);
    try {
      const file = await pdf();
      const shared = await shareFile(file, 'Quotation');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'quote');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not produce the quote', describeActionFailure(e, 'producing the quote'));
    } finally {
      setBusy(false);
    }
  };

  const email = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      if (!(await MailComposer.isAvailableAsync())) {
        showAlert('No mail app set up', 'This phone has no email account configured. Use the PDF button and attach it yourself.');
        return;
      }
      const file = await pdf();
      await MailComposer.composeAsync({
        subject: `Quotation ${quote.reference} — ${quote.siteName}`.trim(),
        body: [
          `${quote.clientName || 'Hello'},`,
          '',
          `Our quotation ${quote.reference} for ${quote.siteName} is attached.`,
          quote.expiresAt ? `It holds good until ${formatAuDate(quote.expiresAt)}.` : '',
          '',
          companyName || 'Safe QLD Fire Protection',
        ].filter(Boolean).join('\n'),
        attachments: file.printed ? undefined : [file.uri],
      });
    } catch (e) {
      showAlert('Could not email it', describeActionFailure(e, 'emailing the quote'));
    } finally {
      setBusy(false);
    }
  };

  const move = async (to: Quote['status']) => {
    if (!quote) return;
    const allowed = canTransition(quote, to, nowIso());
    if (!allowed.allowed) {
      showAlert('Not from here', allowed.reason ?? 'That change is not allowed.');
      return;
    }
    try {
      await setQuoteStatus(quote.id, to, {
        asAt: nowIso(),
        acceptedBy: to === 'accepted' ? acceptedBy.trim() || undefined : undefined,
      });
      await load();
    } catch (e) {
      showAlert('Not changed', describeActionFailure(e, 'changing the quote'));
    }
  };

  if (!quote || !totals) {
    return (
      <>
        <Stack.Screen options={{ title: 'Quote' }} />
        <RecordGate
          missing={missing}
          what="quote"
          why="It may have been deleted, or the link came from another device."
          failed={failed}
          onRetry={() => { void load(); }}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: quote.reference || 'Quote' }} />
      <Screen>
        <Card>
          <Rowed align="flex-start">
            <View style={{ flex: 1 }}>
              <Txt size="lg" weight="700">{quote.siteName}</Txt>
              <Txt size="sm" tone="muted">
                {quote.reference}{quote.clientName ? ` · ${quote.clientName}` : ''}
              </Txt>
              {quote.issuedAt ? (
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
                  Issued {formatAuDate(qldDate(quote.issuedAt) ?? quote.issuedAt)}
                  {quote.expiresAt ? ` · holds good to ${formatAuDate(quote.expiresAt)}` : ''}
                </Txt>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: t.space(1) }}>
              <StatusPill
                label={QUOTE_STATUS_LABEL[quote.status]}
                tone={quote.status === 'accepted' ? 'pass' : quote.status === 'declined' || quote.status === 'expired' ? 'fail' : 'warn'}
              />
              <Txt size="lg" weight="700">{formatCents(totals.totalCents)}</Txt>
            </View>
          </Rowed>
        </Card>

        {lapse?.lapsed || (lapse?.daysRemaining !== undefined && lapse.daysRemaining <= 7) ? (
          <Banner tone={lapse.lapsed ? 'fail' : 'warn'} title={lapse.lapsed ? 'It has lapsed' : 'About to lapse'} body={lapse.note} />
        ) : null}

        <H2>What was quoted</H2>
        {quote.lines.length === 0 ? (
          <Txt size="sm" tone="muted">No lines on this quote.</Txt>
        ) : null}
        {quote.lines.map((line) => (
          <Card key={line.id}>
            <Rowed align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt size="sm" weight="600">{line.description}</Txt>
                <Txt size="xs" tone="faint">
                  {line.quantity} {line.unit}
                  {line.unitCents === undefined ? ' · not priced' : ` × ${formatCents(line.unitCents)}`}
                </Txt>
              </View>
              <Txt weight="700">
                {lineAmountCents(line) === undefined ? '—' : formatCents(lineAmountCents(line)!)}
              </Txt>
            </Rowed>
          </Card>
        ))}

        <Card>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt size="sm" tone="muted">Subtotal</Txt>
            <Txt size="sm">{formatCents(totals.subtotalCents)}</Txt>
          </Rowed>
          {quote.discountCents ? (
            <Rowed style={{ justifyContent: 'space-between' }}>
              <Txt size="sm" tone="muted">Less {quote.discountReason || 'discount'}</Txt>
              <Txt size="sm">−{formatCents(quote.discountCents)}</Txt>
            </Rowed>
          ) : null}
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt size="sm" tone="muted">GST</Txt>
            <Txt size="sm">{formatCents(totals.gstCents)}</Txt>
          </Rowed>
          <Divider />
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt weight="700">Total</Txt>
            <Txt weight="700">{formatCents(totals.totalCents)}</Txt>
          </Rowed>
        </Card>

        {quote.exclusions.length ? (
          <Card>
            <Label>What it does not cover</Label>
            {quote.exclusions.map((x) => (
              <Txt key={x} size="sm" tone="muted" style={{ marginTop: t.space(1.5), lineHeight: 19 }}>• {x}</Txt>
            ))}
          </Card>
        ) : null}

        <H2>Send it again</H2>
        <Rowed gap={2}>
          <Button title="PDF" style={{ flex: 1 }} loading={busy} onPress={() => { void share(); }} />
          <Button title="Email it" variant="secondary" style={{ flex: 1 }} loading={busy} onPress={() => { void email(); }} />
        </Rowed>

        <JobFileCard
          siteId={quote.siteId}
          jobExternalId={quote.jobReference}
          what="quote"
          filename={`${safeFileName(`Quote ${quote.reference || quote.siteName}`, 'quote')}.pdf`}
          subject={`Quotation ${quote.reference} — ${quote.siteName}`.trim()}
          buildFile={pdf}
          onPickJob={(job) => updateQuote(quote.id, { jobReference: job?.externalId })
            .then(() => load())
            .catch((e: unknown) => showAlert('Not linked', describeActionFailure(e, 'linking the job')))}
          onAttached={() => { /* The quote has no attachedAt column; the queue is the record. */ }}
        />

        <H2>Where it stands</H2>
        {quote.status === 'accepted' ? (
          <Banner
            tone="pass"
            title="Accepted"
            body={`${quote.acceptedBy ? `${quote.acceptedBy}, ` : ''}${quote.acceptedAt ? formatAuDate(qldDate(quote.acceptedAt) ?? quote.acceptedAt) : ''}. Raise the work with the office.`}
          />
        ) : null}
        {quote.status === 'issued' ? (
          <Field
            label="Who accepted it"
            value={acceptedBy}
            onChangeText={setAcceptedBy}
            hint="The name they gave, for the record"
          />
        ) : null}
        <Rowed gap={2} wrap>
          {(['issued', 'accepted', 'declined'] as const).map((s) => (
            <Chip
              key={s}
              label={QUOTE_STATUS_LABEL[s]}
              selected={quote.status === s}
              onPress={() => { void move(s); }}
            />
          ))}
        </Rowed>
        {locked ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{locked}</Txt> : null}
      </Screen>
    </>
  );
}
