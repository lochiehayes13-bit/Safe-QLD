/**
 * Reading a file that is one XML-ish tag per line.
 *
 * Two vendors independently arrived at the same shape: Notifier's .pci and
 * Vigilant's .mx1 / .f4k are both a flat sequence of self-closing elements,
 * one to a line, carrying all their data in attributes. Neither is valid XML.
 * Notifier's has no root element and puts `&vbCrLf` — a fragment of Visual
 * Basic — inside an attribute, which no XML parser will accept. Vigilant's is
 * Windows-1252, so a strict UTF-8 parse dies on the first curly apostrophe:
 * 30 of the 44 configuration files the vendor ships fail that way.
 *
 * Reading a line at a time sidesteps both, and costs nothing, because neither
 * format ever nests or spans lines.
 */

export interface LineTag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  closing: boolean;
}

const NAMED: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

/**
 * Decodes the five named XML entities and the numeric forms.
 *
 * Anything else is left exactly as it is. `&vbCrLf` is the case that matters:
 * it is not an entity, it is Visual Basic that leaked into a string, and
 * quietly turning it into a newline would be inventing content the panel never
 * held.
 */
export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => NAMED[m] ?? m);
}

/**
 * Reads one line as a tag, or returns undefined when it is not one.
 *
 * Attribute values are always quoted in both formats, which is what makes a
 * line scan safe: a `>` inside a value cannot be mistaken for the end of the
 * tag, because the scan never looks for one.
 */
export function parseTagLine(line: string): LineTag | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) return undefined;

  if (trimmed.startsWith('</')) {
    const name = trimmed.slice(2, -1).trim();
    return name ? { name, attrs: {}, selfClosing: false, closing: true } : undefined;
  }

  const selfClosing = trimmed.endsWith('/>');
  const body = trimmed.slice(1, selfClosing ? -2 : -1);
  // Vigilant writes an element name with a hyphen in it — <F4000-MX4428>.
  const nameMatch = body.match(/^([A-Za-z_][\w.-]*)/);
  if (!nameMatch) return undefined;

  const attrs: Record<string, string> = {};
  // Notifier writes `Name = "value"`, Vigilant writes `Name="value"`.
  const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) attrs[m[1]!] = decodeXmlEntities(m[2]!);

  return { name: nameMatch[1]!, attrs, selfClosing, closing: false };
}

/**
 * The 0x80-0x9F range of Windows-1252, which is where it differs from
 * Latin-1. Everything outside that range is identical in both.
 *
 * Hand-rolled rather than handed to TextDecoder: React Native's JavaScript
 * engine is not required to ship the legacy encoding tables, so
 * `new TextDecoder('windows-1252')` is not something to rely on in the app.
 * Thirty-two characters is a cheap thing to carry.
 */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** Decodes bytes as Windows-1252, which is what Delphi tools on Windows write. */
export function decodeCp1252(bytes: Uint8Array): string {
  const out: string[] = [];
  // Built in chunks: String.fromCharCode with a very large argument list
  // overflows the call stack on a multi-megabyte file.
  const CHUNK = 8192;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const codes = new Array<number>(end - start);
    for (let i = start; i < end; i++) {
      const b = bytes[i]!;
      codes[i - start] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b;
    }
    out.push(String.fromCharCode(...codes));
  }
  return out.join('');
}
