import { mailtoUrl, recipients, type MailDraft } from '@/domain/mailDraft';
import type { WrittenFile } from './files';
import { readyHint } from './webFiles';
import { showReadySheet, type ReadyChoice } from './readySheet.web';

/**
 * Sending an email, in a browser.
 *
 * A page cannot attach a file to an email: `mailto:` has no attachment in it,
 * and a page cannot reach inside a mail client. What it can do on a phone is
 * open the operating system's share sheet with the file already on it, and
 * Mail is on that sheet — one tap, the file attached, the subject filled in.
 * On a desktop, where there is no share sheet, the file downloads first and
 * the composer opens second, with the file sitting in the downloads a drag
 * away. `expo-mail-composer`'s own browser half drops attachments on the floor
 * and says nothing, which is how a timesheet reached payroll as a wall of text
 * with the workbook still on the phone.
 *
 * And it cannot know whether the person pressed send: the mail client is
 * another application entirely. So this answers `offered` where the share
 * sheet was put up and `handed-over` where a composer was opened, and the
 * screens say what is true — the file is on its way to being sent — rather
 * than "Sent" or "Not sent", each of which would be a guess, and one of which
 * would mark a week submitted that nobody sent.
 */

export type MailOutcome = 'sent' | 'not-sent' | 'handed-over' | 'no-mail-app' | 'offered';

type FileSharer = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

/** Reads a browser URI — blob: or data: — back into a File the share sheet can carry. */
async function fileFor(file: WrittenFile): Promise<File> {
  const blob = await (await fetch(file.uri)).blob();
  return new File([blob], file.name, { type: blob.type || 'application/octet-stream' });
}

/** The browser's download, for the composer route and the save button. */
function download(file: WrittenFile): void {
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

/**
 * The file first, then the composer. The other order loses the download: a
 * `mailto:` hands focus to another application, and a download started after
 * that reads to the browser as one the person did not ask for.
 *
 * `location.href` rather than `window.open`: a pop-up blocker stops the
 * second window a single gesture opens, and the download above has already
 * spent that gesture in some browsers.
 */
function openComposer(draft: MailDraft, files: readonly WrittenFile[]): void {
  for (const file of files) download(file);
  window.location.href = mailtoUrl(draft);
}

export async function sendMail(draft: MailDraft, attachments: readonly WrittenFile[] = []): Promise<MailOutcome> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'no-mail-app';

  /*
   * A `printed` file is skipped: that is a document being held for the print
   * dialogue rather than a file, and handing it over would save HTML under a
   * .pdf name. The screens that produce one say so themselves.
   */
  const real = attachments.filter((f) => !f.printed);
  if (!real.length) {
    window.location.href = mailtoUrl(draft);
    return 'handed-over';
  }

  // The share sheet, where the browser has one that takes files. Asked with
  // the actual files, because a browser that shares links may refuse files.
  const n = navigator as FileSharer;
  let files: File[] = [];
  let canShare = false;
  if (typeof n.share === 'function' && typeof n.canShare === 'function') {
    try {
      files = await Promise.all(real.map(fileFor));
      canShare = n.canShare({ files });
    } catch {
      canShare = false;
    }
  }
  if (!canShare) {
    openComposer(draft, real);
    return 'handed-over';
  }

  /*
   * A sheet of real buttons rather than an immediate share, because a share
   * has to run inside a tap and the tap that asked for the email expired
   * while the file was being made. The hint names the address, since the
   * share sheet cannot fill it in and the person picking Mail should not have
   * to remember it.
   */
  const choices: ReadyChoice[] = [
    {
      label: 'Share…',
      primary: true,
      onPress: async () => {
        try {
          await n.share!({ files, title: draft.subject, text: draft.body });
        } catch (e) {
          // Dismissed is a person changing their mind: the sheet stays up.
          // Refused is the browser's doing, and the composer route still works.
          if ((e as { name?: string }).name === 'AbortError') throw e;
          openComposer(draft, real);
        }
      },
    },
    { label: 'Open an email draft instead', onPress: () => openComposer(draft, real) },
    { label: 'Save to this device', onPress: () => { for (const file of real) download(file); } },
  ];
  showReadySheet({
    title: real.length === 1 ? `${real[0]!.name} is ready to send` : `${real.length} files are ready to send`,
    hint: readyHint({ canShare: true, sendTo: recipients(draft) || undefined }),
    choices,
  });
  return 'offered';
}
