import React, { useState } from 'react';
import { View } from 'react-native';
import { listJobPage, type JobPick } from '@/db/opsRepo';
import { queueJobAttachment } from '@/simpro/sync';
import { attachmentContentKey } from '@/domain/outboundWork';
import { qldIsoDay } from '@/domain/qldTime';
import { nowIso } from '@/db';
import { describeActionFailure } from '@/domain/loadFailure';
import { formatAuDate } from '@/export/sheets';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import { JobPicker } from '@/components/JobPicker';
import { Button, Card, Chip, Label, Rowed, Txt } from '@/components/ui';
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
  /**
   * Stores when it went, and clears it when the job changes.
   *
   * Takes undefined for that second case: a document that reached job 41207
   * has not reached 41208, and a card that kept the stamp across a change
   * showed a green "Sent" against a job the file was never sent to. That is
   * the exact claim this card exists to make truthfully.
   */
  onAttached: (at: string | undefined) => Promise<void> | void;
  /** Set where the document is not ready to be filed — unsigned, unfinished. */
  disabled?: boolean;
  disabledWhy?: string;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const [jobs, setJobs] = useState<JobPick[]>([]);
  const [busy, setBusy] = useState(false);

  /**
   * The jobs at this record's site, as the list to start from.
   *
   * Opened once the read has come back. It used to open first, so a read that
   * threw left an empty picker on screen saying "No jobs on this phone for
   * that site" — which is an answer, and the wrong one, to a question nothing
   * had answered.
   */
  const openPicker = async () => {
    try {
      const page = await listJobPage({ filter: 'all', today: qldIsoDay(nowIso()) ?? '', siteId, limit: 50 });
      setJobs(page.rows
        .filter((j) => j.externalId)
        .map((j) => ({
          externalId: j.externalId, siteName: j.siteName, siteId: j.siteId,
          status: j.status, customerName: j.customerName, title: j.title,
        })));
      setPicking(true);
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
        // The browser could not write the file, so there is nothing to queue.
        // It used to say "do this from the phone" to a technician on an
        // iPhone, which has no build but this one.
        showAlert(
          'Not attached',
          `This browser could not build the ${what} as a file, so nothing was queued onto the job. The PDF button `
          + 'still prints it; attach the saved copy to the job in Simpro, or try again on a different browser.',
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

  /**
   * Taking a pick, with the stamp that belongs to the job it was sent to.
   *
   * Changing the job makes "Sent on the 3rd" a statement about a job this file
   * never reached, so it goes with the job it described. Done here rather than
   * in each screen's handler because six screens remembering the same rule is
   * six chances to forget it, and the seventh will.
   */
  const take = (picked: { externalId: string; title?: string } | null) => {
    void onPickJob(picked);
    if (attachedAt && picked?.externalId !== jobExternalId) void onAttached(undefined);
    setPicking(false);
  };

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

      {/*
        * The shared picker, which this card was one of five copies of.
        *
        * It read the first fifty jobs at the site, filtered those in
        * JavaScript and drew twenty-five — so a job past the fiftieth at a
        * busy building could not be picked at all, and the empty line told the
        * technician to "search all of them above" when the box above searched
        * only those fifty. The instruction on screen could not work, which is
        * the worst way for a screen to be wrong. The site's jobs are still the
        * list it starts from; the search behind them is now over every job the
        * phone holds, run in the database.
        */}
      {picking ? (
        <View style={{ marginTop: t.space(3) }}>
          <JobPicker
            heading={`Which job does the ${what} go on?`}
            suggested={jobs}
            suggestedLabel={siteId ? 'Jobs at this site' : 'Jobs on this phone'}
            emptyWhenNoneSuggested="No job on this phone is filed under this site. Search for it by number above."
            emptyWhenNothingOnDevice="No jobs on this phone yet. Connect Simpro in Settings and sync, and every job on the books is here."
            onPick={(job) => take(job.externalId ? { externalId: job.externalId, title: job.title } : null)}
            onClose={() => setPicking(false)}
          />
          {jobExternalId ? (
            <Rowed gap={2}>
              <Button title="Unlink" variant="ghost" onPress={() => take(null)} />
            </Rowed>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
