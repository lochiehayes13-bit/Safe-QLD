/**
 * Naming a file that is about to leave the phone.
 *
 * Split out of files.ts, which cannot be loaded in a test at all: it imports
 * expo-file-system, expo-print and expo-sharing, so the one piece of real logic
 * in it sat at zero per cent coverage — not through neglect but because there
 * was no way to reach it. The same split is already made for photographs, where
 * `shrinkTarget` is pure and `shrinkForStorage` does the native work.
 *
 * What it has to survive is site names as the register actually writes them.
 * Theirs run to ninety-four characters and contain commas, ampersands, slashes
 * and colons — "Level 3 / Plant Room" is the shape the original comment names,
 * and a slash silently breaks file creation on Android.
 */

/**
 * Characters a filename cannot carry on Android or iOS.
 *
 * Tab, newline and carriage return are deliberately not in here even though
 * they are control characters. A site name pasted out of a spreadsheet cell
 * arrives with a line break in it, and that is whitespace — turning it into a
 * hyphen gives "Logan DC - report" for a name that reads "Logan DC report".
 * The collapse below handles them. It is the same line the workbook writer
 * draws, and for the same reason.
 */
const FORBIDDEN = /[/\\?%*:|"<>\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * The cap, and the reason a long name is cut in the middle rather than the end.
 *
 * The caller composes the whole name — "<site> service report", "<site> zone
 * chart" — and hands it over as one string, so cutting the tail removes the
 * half that says what the document is. On a site whose name is already at the
 * cap, every export it produces then lands on the same filename, and each write
 * deletes the file before it. One of their eight hundred and ninety-two sites
 * is long enough for that today.
 *
 * Keeping both ends costs an ellipsis and keeps two things: which site it is,
 * and which document it is.
 */
const MAX_LENGTH = 90;
const ELLIPSIS = '…';

/**
 * Makes a string safe for a filename across Android and iOS.
 *
 * Site names routinely contain slashes and colons ("Level 3 / Plant Room"),
 * which silently break file creation on Android.
 */
export function safeFileName(name: string, fallback = 'export'): string {
  const cleaned = name
    .replace(FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');

  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_LENGTH) return cleaned;

  // Two thirds from the front, the rest from the back, so the document type
  // survives on a long site name and two different exports stay two files.
  const head = Math.floor((MAX_LENGTH - ELLIPSIS.length) * 0.66);
  const tail = MAX_LENGTH - ELLIPSIS.length - head;
  return `${cleaned.slice(0, head).trimEnd()}${ELLIPSIS}${cleaned.slice(-tail).trimStart()}`;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.sqld': 'application/octet-stream',
};

export const DEFAULT_MIME = 'application/octet-stream';

/**
 * The type to hand the share sheet, from the filename's extension.
 *
 * `name.slice(name.lastIndexOf('.'))` was the original, and on a name with no
 * dot at all `lastIndexOf` returns -1 and `slice(-1)` hands back the last
 * character of the name rather than nothing. Every writer appends an extension
 * so it never fired, which is exactly the kind of thing that fires the first
 * time somebody adds a writer that does not.
 */
export function mimeTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return DEFAULT_MIME;
  return MIME[fileName.slice(dot).toLowerCase()] ?? DEFAULT_MIME;
}

/** True where the share sheet should be told this is a PDF specifically. */
export function isPdfName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf');
}
