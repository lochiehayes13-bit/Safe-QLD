/**
 * Simpro's rich text, as plain text a phone can show.
 *
 * The office types job descriptions and notes into a rich-text box, and the
 * API hands them back as the HTML that box produced: `<div style="font-size:
 * 10pt;">`, `<strong>`, `&nbsp;`, `<br>`. Shown raw on a job card that reads
 * as a fault; stripped naively it runs three paragraphs into one line. This
 * keeps the line breaks the writer meant and drops everything else.
 *
 * It is not an HTML parser and does not try to be. The markup Simpro emits is
 * shallow — block tags, inline emphasis, entities — and a parser that handled
 * more would be more code to hold wrong. Pure, so it can be tested on the
 * shapes the live build actually returns.
 */

/** Tags whose close ends a line. A list item is not here: its open tag starts one. */
const BLOCK_END = /<\/(?:p|div|tr|h[1-6]|blockquote|pre|section|article|header|footer|table|ul|ol)\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const LIST_ITEM = /<li\b[^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', deg: '°',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®',
};

/** `&amp;`, `&#39;` and `&#x27;` back to the characters they stand for. Unknown names are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Whether a string carries markup at all, so plain text is not run through the stripper needlessly. */
export function looksLikeHtml(text: string): boolean {
  return /<[a-z!/][^>]*>/i.test(text) || /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(text);
}

/**
 * Plain text out of Simpro's HTML.
 *
 * Block closes and `<br>` become newlines, list items get a dash, every other
 * tag is dropped, entities are decoded, and whitespace is tidied: runs of
 * spaces collapse, more than one blank line collapses to one, and each line is
 * trimmed. Text with no markup comes back trimmed and otherwise untouched.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  const source = String(html);
  if (!looksLikeHtml(source)) return source.replace(/\r\n?/g, '\n').trim();

  const withBreaks = source
    .replace(/\r\n?/g, '\n')
    // Script and style bodies are not prose, whatever the box did.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(LINE_BREAK, '\n')
    .replace(LIST_ITEM, '\n- ')
    .replace(BLOCK_END, '\n')
    .replace(ANY_TAG, '');

  return decodeEntities(withBreaks)
    // A non-breaking space is a space to a phone screen.
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The first line of a text, for a list row, cut at a word rather than mid-way
 * through one. `max` counts characters, not bytes.
 */
export function firstLine(text: string | null | undefined, max = 80): string {
  const line = (text ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}
