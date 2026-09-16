import { mailtoUrl, type MailDraft } from '@/domain/mailDraft';
import type { WrittenFile } from './files';

/**
 * Sending an email, in a browser.
 *
 * Two things a page cannot do, and both are worked around here rather than
 * failed at quietly.
 *
 * It cannot attach a file to an email. `mailto:` has no attachment in it —
 * there is nowhere in the scheme to put one, and a page cannot reach inside a
 * mail client. What it can do is hand the person the file, so the attachment
 * downloads first and the composer opens second, with the workbook sitting in
 * their downloads a drag away. `expo-mail-composer`'s own browser half drops
 * attachments on the floor and says nothing, which is how a timesheet reached
 * payroll as a wall of text with the workbook still on the phone.
 *
 * And it cannot know whether the person pressed send: the mail client is
 * another application entirely. So this answers `handed-over`, and the screens
 * say what is true — the draft is open, with the file downloaded — rather than
 * "Sent" or "Not sent", each of which would be a guess, and one of which would
 * mark a week submitted that nobody sent.
 */

export type MailOutcome = 'sent' | 'not-sent' | 'handed-over' | 'no-mail-app';

export async function sendMail(draft: MailDraft, attachments: readonly WrittenFile[] = []): Promise<MailOutcome> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'no-mail-app';

  /*
   * The file first, then the composer. The other order loses the download: a
   * `mailto:` hands focus to another application, and a download started after
   * that reads to the browser as one the person did not ask for.
   *
   * A `printed` file is skipped: that is a document being held for the print
   * dialogue rather than a file, and handing it over would save HTML under a
   * .pdf name. The screens that produce one say so themselves.
   */
  for (const file of attachments.filter((f) => !f.printed)) {
    try {
      const link = document.createElement('a');
      link.href = file.uri;
      link.download = file.name;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      // A download the browser refused is worth less than the email itself,
      // and the screen already tells the person to attach the file. Carry on
      // and open the composer rather than losing both.
    }
  }

  /*
   * `location.href` rather than `window.open`: a pop-up blocker stops the
   * second window a single gesture opens, and the download above has already
   * spent that gesture in some browsers.
   */
  window.location.href = mailtoUrl(draft);
  return 'handed-over';
}
