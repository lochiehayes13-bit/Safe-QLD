import React, { useState } from 'react';
import { View } from 'react-native';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
import { queueJobAttachment } from '@/simpro/sync';
import { attachmentContentKey } from '@/domain/outboundWork';
import { qldIsoDay } from '@/domain/qldTime';
import { nowIso } from '@/db';
import { describeActionFailure } from '@/domain/loadFailure';
import { formatAuDate } from '@/export/sheets';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import { Button, Card, Chip, Label, Rowed, SearchBox, Txt } from '@/components/ui';
import type { WrittenFile } from '@/export/files';

/**
 * Putting a document on the Simpro job, from any screen that makes one.
 *
 * Fifteen screens in this app produce a document and, until this existed,
 * exactly one of them could file it: the Form 72. Everything else ended at
 * the share sheet, which means the office got the document if somebody
 * remembered to email it to themselves and attach it by hand — which is the
 * same as saying the office did not get it.
 *
 * The card is the Form 72's, made general. Its three states are the ones that
 * matter to a technician: not linked to a job yet, linked and not sent, and
 * sent — because "the office has it" and "I think I sent it" are different
 * things and only one of them lets somebody stop worrying.
 *
 * The send is queued rather than posted. A pump room has no signal, and the
 * outbound queue is what carries a document out of one. On the web build a
 * PDF is printed rather than written to a file, so there is nothing to queue
 * and the card says so instead of failing quietly.
 */
export function JobFileCard({
  siteId,
  jobExternalId,
  jobTitle,
  attachedAt,
  what,
  filename,
  subject,
  buildFile,
  onPickJob,
  onAttached,
  disabled,
  disabledWhy,
}: {
  siteId?: string;
  jobExternalId?: string;
  jobTitle?: string;
  /** When the file was last queued onto the job, if it has been. */
  attachedAt?: string;
  /** What the document is, in a technician's words: "service report". */
  what: string;
  /** The file name it lands under in Simpro. */
  filename: string;
  /** The subject line the attachment carries. */
  subject: string;
  /** Makes the file. Called only when there is a job to put it on. */
  buildFile: () => Promise<WrittenFile>;
  /** Stores the job on the record. Null clears it. */
  onPickJob: (job: { externalId: string; title?: string } | null) => Promise<void> | void;
  /** Stores when it went. */
  onAttached: (at: string) => Promise<void> | void;
  /** Set where the document is not ready to be filed — unsigned, unfinished. */
  disabled?: boolean;
  disabledWhy?: string;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const openPicker = async () => {
    setPicking(true);
    try {
      const page = await listJobPage({ filter: 'all', today: qldIsoDay(nowIso()) ?? '', siteId, limit: 50 });
      setJobs(page.rows);
    } catch (e) {
      showAlert('Could not read the jobs', describeActionFailure(e, 'reading the jobs'));
    }
  };

  const attach = async () => {
    if (!jobExternalId) return;
    setBusy(true);
    try {
      const file = await buildFile();
      if (file.printed) {
        showAlert(
          'Printed, not attached',
          'On the web the document is printed rather than written to a file, so there is nothing to queue onto the job. Do this from the phone.',
        );
        return;
      }
      const row = await queueJobAttachment({
        jobId: jobExternalId,
        localUri: file.uri,
        filename,
        mimeType: 'application/pdf',
        subject,
        sizeBytes: file.size,
        key: attachmentContentKey({ jobId: jobExternalId, filename, sizeBytes: file.size }),
      });
      const at = nowIso();
      await onAttached(at);
      showAlert(
        row.duplicate ? 'Already on the queue' : 'Queued for the job',
        `The ${what} is on Waiting to send for job ${jobExternalId}. It goes up with the next sync and shows on the job’s attachments in Simpro.`,
      );
    } catch (e) {
      showAlert('Not attached', describeActionFailure(e, `putting the ${what} on the job`));
    } finally {
      setBusy(false);
    }
  };

  const matches = query.trim()
    ? jobs.filter((j) => `${j.externalId ?? ''} ${j.title} ${j.siteName}`.toLowerCase().includes(query.trim().toLowerCase()))
    : jobs;

  return (
    <Card>
      <Label>The Simpro job</Label>

      {jobExternalId ? (
        <>
          <Rowed align="flex-start" style={{ marginTop: t.space(1) }}>
            <View style={{ flex: 1 }}>
              <Txt weight="600">Job {jobExternalId}</Txt>
              {jobTitle ? <Txt size="sm" tone="muted">{jobTitle}</Txt> : null}
              {attachedAt ? (
                <Chip label={`Sent ${formatAuDate(qldIsoDay(attachedAt) ?? attachedAt)}`} tone="pass" />
              ) : null}
            </View>
            <Button title="Change" variant="ghost" compact onPress={() => { void openPicker(); }} />
          </Rowed>
          <Button
            title={attachedAt ? `Send the ${what} again` : `Put the ${what} on the job`}
            variant="secondary"
            loading={busy}
            disabled={disabled}
            onPress={() => { void attach(); }}
            style={{ marginTop: t.space(2) }}
          />
          {disabled && disabledWhy ? (
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>{disabledWhy}</Txt>
          ) : null}
        </>
      ) : (
        <>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
            Not linked to a job. Pick one and the {what} goes onto its attachments in Simpro, rather than staying on
            this phone.
          </Txt>
          <Button title="Pick the job" variant="secondary" onPress={() => { void openPicker(); }} style={{ marginTop: t.space(2) }} />
        </>
      )}

      {picking ? (
        <View style={{ marginTop: t.space(3) }}>
          <SearchBox value={query} onChange={setQuery} placeholder="Job number, title or site" />
          {matches.length === 0 ? (
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(2) }}>
              {jobs.length ? 'Nothing matched.' : 'No jobs on this phone for that site. Sync, or search all of them above.'}
            </Txt>
          ) : null}
          {matches.slice(0, 25).map((j) => (
            <Card
              key={j.id}
              onPress={() => {
                void onPickJob(j.externalId ? { externalId: j.externalId, title: j.title } : null);
                setPicking(false);
              }}
            >
              <Txt weight="600">{j.externalId ? `Job ${j.externalId}` : j.title}</Txt>
              <Txt size="sm" tone="muted">{j.title}{j.siteName ? ` · ${j.siteName}` : ''}</Txt>
            </Card>
          ))}
          <Rowed gap={2}>
            <Button title="Close" variant="ghost" onPress={() => setPicking(false)} />
            {jobExternalId ? (
              <Button
                title="Unlink"
                variant="ghost"
                onPress={() => { void onPickJob(null); setPicking(false); }}
              />
            ) : null}
          </Rowed>
        </View>
      ) : null}
    </Card>
  );
}
