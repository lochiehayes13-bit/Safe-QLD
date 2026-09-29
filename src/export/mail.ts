import * as MailComposer from 'expo-mail-composer';
import type { MailDraft } from '@/domain/mailDraft';
import type { WrittenFile } from './files';

/**
 * Sending an email, on a phone.
 *
 * The counterpart to `files.ts`, and it exists for the same reason: the phone
 * and the browser can both put an email in front of a person, and they do it
 * so differently that six screens should not each work out which they are on.
 *
 * Here the mail composer opens with the attachments already on it, and it
 * tells us afterwards whether the person pressed send. That answer is worth
 * having — the timesheet marks itself submitted on it — and it is the half the
 * browser cannot give, which is why `MailOutcome` has a word for "we handed it
 * over and cannot know".
 */

export type MailOutcome =
  /** The mail app said the person sent it. */
  | 'sent'
  /** The mail app opened and the person did not send. */
  | 'not-sent'
  /**
   * The draft was handed to the person's mail app, which cannot report back.
   * The browser's answer, always — never the phone's.
   */
  | 'handed-over'
  /** There is no mail app to open. */
  | 'no-mail-app';

export async function sendMail(draft: MailDraft, attachments: readonly WrittenFile[] = []): Promise<MailOutcome> {
  if (!(await MailComposer.isAvailableAsync())) return 'no-mail-app';

  const { status } = await MailComposer.composeAsync({
    recipients: (Array.isArray(draft.to) ? draft.to : [draft.to]).map((a) => String(a).trim()).filter(Boolean),
    subject: draft.subject,
    body: draft.body,
    /*
     * A `printed` file is not a file: it is a document the web build holds for
     * the print dialogue, and its `uri` points at HTML wearing a .pdf name.
     * The phone never sets the flag, so this is dead weight here and the rule
     * that stops a screen emailing one — but it is written the same way in
     * both halves so neither can be the one that forgets.
     */
    attachments: attachments.filter((f) => !f.printed).map((f) => f.uri),
  });

  /*
   * Only SENT counts as sent, which on iOS means the person pressed send
   * rather than saving a draft or cancelling.
   *
   * Android answers `sent` either way: the composer is another application
   * reached through an intent, and the system tells an app nothing about what
   * happened in it. That is worth knowing and not worth working around — the
   * alternative is never marking a week submitted on Android, and the person
   * has the Mark submitted button in front of them either way.
   */
  return status === MailComposer.MailComposerStatus.SENT ? 'sent' : 'not-sent';
}
