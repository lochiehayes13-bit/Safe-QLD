/**
 * Handing an email to somebody's own mail app.
 *
 * Every email this app sends is composed in the technician's own mail client
 * rather than sent by a server: payroll and the office reply to a person, not
 * to a no-reply address, and nothing about the arrangement needs a mail server
 * of our own. On a phone `expo-mail-composer` opens the composer directly. In a
 * browser there is no composer to open, so it becomes a `mailto:` link.
 *
 * That link is why this module exists. `mailto:` is a URL, and there are two
 * ways to write spaces in a URL query: `%20`, from percent-encoding, and `+`,
 * from the form-encoding a web page uses when it submits a form. They are not
 * interchangeable. A mail client reading a `mailto:` unescapes `%20` to a space
 * and leaves `+` exactly as it found it — so a subject encoded the form way
 * arrives reading `Timesheet+—+Lachlan+Hayes+—+week+starting+09/09/2026`, with
 * a plus between every word, in the inbox of whoever does the payroll.
 *
 * `expo-mail-composer`'s browser half builds its link with `URLSearchParams`,
 * which is form-encoding, so that is exactly what it produced. This builds the
 * link by hand instead, with `encodeURIComponent`, which is the percent-encoder
 * — and there is a test below the line that no `+` ever survives it.
 */

export interface MailDraft {
  /** Where it goes. Several addresses are joined with a comma, as the scheme says. */
  to: string | readonly string[];
  subject: string;
  body: string;
}

/**
 * How long a `mailto:` is allowed to get.
 *
 * There is no limit in the scheme and a hard one in practice: the link is
 * handed to the operating system, which hands it to a mail client, and
 * somewhere in that chain a long one is truncated silently. Outlook has
 * historically cut at about two thousand characters. A timesheet with a
 * comment on every day clears that easily, and a truncated body is worse than
 * a shortened one because it stops mid-sentence with no sign it was cut.
 *
 * So the body is trimmed here, on a line boundary, with a line saying so. The
 * detail is in the attachment either way.
 */
export const MAILTO_LIMIT = 1900;

/** The note left where a body has been shortened to fit the link. */
export const TRIMMED_NOTE = '(Shortened to fit the mail link. The full sheet is attached.)';

/**
 * A body cut to fit, on a line boundary, or the body unchanged.
 *
 * Whole lines because half a line of a day's hours reads as the day's hours,
 * and somebody would work from it.
 */
export function fitBody(body: string, limit = MAILTO_LIMIT): string {
  if (body.length <= limit) return body;

  const room = Math.max(0, limit - TRIMMED_NOTE.length - 2);
  const lines = body.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    // +1 for the newline that will join it.
    if (used + line.length + 1 > room) break;
    kept.push(line);
    used += line.length + 1;
  }

  return `${kept.join('\n')}\n\n${TRIMMED_NOTE}`.trimStart();
}

/**
 * The `mailto:` link for a draft.
 *
 * Percent-encoded throughout. `encodeURIComponent` leaves a handful of
 * sub-delimiters alone — `!'()*` — and every one of those is legal in a URL
 * query, so they are left as typed rather than escaped into noise.
 */
export function mailtoUrl(draft: MailDraft, limit = MAILTO_LIMIT): string {
  const to = (Array.isArray(draft.to) ? draft.to : [draft.to])
    .map((a) => String(a).trim())
    .filter(Boolean)
    .join(',');

  const query = [
    draft.subject.trim() ? `subject=${encodeURIComponent(draft.subject.trim())}` : '',
    draft.body ? `body=${encodeURIComponent(fitBody(draft.body, limit))}` : '',
  ].filter(Boolean).join('&');

  // The address is encoded too, but not its separators: a comma between two
  // recipients and the @ inside one are part of the scheme's own syntax.
  const encodedTo = to.split(',').map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',');

  return query ? `mailto:${encodedTo}?${query}` : `mailto:${encodedTo}`;
}
