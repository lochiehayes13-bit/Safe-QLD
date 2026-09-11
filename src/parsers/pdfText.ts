import { inflate } from 'pako';

/**
 * Reading the text out of a PDF, on the device.
 *
 * Safe QLD holds licensed copies of about thirty standards. Those copies cannot
 * be shipped inside this app — they are licensed per copy and the repository is
 * not the place for them — but a technician's own copy on their own phone is a
 * different matter entirely. So the app imports the PDF they already paid for
 * and makes it searchable offline, in a plant room, with no signal and nothing
 * leaving the device.
 *
 * That is the whole reason this exists. There is no PDF text library in the
 * React Native runtime, and shipping one that expects a browser or Node is not
 * an option, so the format is read here the same way the app already reads
 * SQLite and zip containers.
 *
 * **What it does and does not do.** It recovers text from PDFs that contain
 * text. It cannot recover text from a scanned page, because there is none there
 * — a scan is a picture of words, and no amount of parsing turns one into the
 * other. Roughly a third of the standards Safe QLD holds are scans of paper
 * originals, and for those this returns nothing and says so, rather than
 * returning the few incidental characters a scanner's OCR layer sometimes
 * leaves behind and letting them pass for a readable document.
 *
 * The objects are found by scanning for `N G obj` rather than by walking the
 * cross-reference table. That is deliberate: the xref is the first thing to go
 * stale in a file that has been edited, appended to, or produced by a tool that
 * cuts corners, and a reader that trusts it fails on exactly the documents most
 * worth reading. Scanning is slower and does not care.
 */

export class PdfError extends Error {}

export interface PdfPage {
  /** 1-based, in the order the pages were found. */
  number: number;
  text: string;
}

export interface PdfDocument {
  pages: PdfPage[];
  /** Every page's text joined, which is what a search runs over. */
  text: string;
  /** Title, author and so on, where the document carries them. */
  info: Record<string, string>;
  /**
   * What the reader could not do, in plain words.
   *
   * A document that comes back with no text and no warning would look like a
   * successful import of an empty file. These say which it was.
   */
  warnings: string[];
}

/** A PDF starts with %PDF- and nothing else does. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

const latin1 = (b: Uint8Array, from = 0, to = b.length): string => {
  let s = '';
  // Chunked so a large document does not blow the argument limit on apply().
  for (let i = from; i < to; i += 8192) {
    s += String.fromCharCode(...b.subarray(i, Math.min(i + 8192, to)));
  }
  return s;
};

interface RawObject {
  num: number;
  gen: number;
  /** The dictionary and anything before the stream, as text. */
  head: string;
  /** Raw stream bytes, before any filter is applied. */
  stream?: Uint8Array;
}

const OBJ_RE = /(\d+)\s+(\d+)\s+obj\b/g;

/**
 * Every object in the file, found by scanning.
 *
 * A later definition of the same object number wins, which is how an
 * incrementally updated PDF is meant to resolve: the appended revision at the
 * end of the file supersedes the original.
 */
function scanObjects(bytes: Uint8Array): Map<number, RawObject> {
  const text = latin1(bytes);
  const out = new Map<number, RawObject>();

  OBJ_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OBJ_RE.exec(text))) {
    const num = Number(m[1]);
    const gen = Number(m[2]);
    const bodyStart = m.index + m[0].length;

    const endObj = text.indexOf('endobj', bodyStart);
    const streamAt = text.indexOf('stream', bodyStart);
    const hasStream = streamAt !== -1 && (endObj === -1 || streamAt < endObj);

    if (!hasStream) {
      out.set(num, { num, gen, head: text.slice(bodyStart, endObj === -1 ? undefined : endObj) });
      continue;
    }

    const head = text.slice(bodyStart, streamAt);
    // "stream" is followed by CRLF or LF, never by LF CR.
    let dataAt = streamAt + 'stream'.length;
    if (text[dataAt] === '\r') dataAt += 1;
    if (text[dataAt] === '\n') dataAt += 1;

    /*
     * /Length is often an indirect reference to an object defined later, so it
     * cannot be relied on at this point. Searching for the endstream keyword is
     * what actually works across real files, and a stream whose data happens to
     * contain those bytes is caught by the inflate failing rather than by
     * producing plausible nonsense.
     */
    const endStream = text.indexOf('endstream', dataAt);
    const dataEnd = endStream === -1 ? bytes.length : endStream;
    out.set(num, { num, gen, head, stream: bytes.subarray(dataAt, trimEol(text, dataAt, dataEnd)) });
  }

  expandObjectStreams(out);
  return out;
}

/**
 * Objects packed inside another object.
 *
 * Every PDF produced this decade puts most of its objects inside compressed
 * object streams, so a reader that only scans the file for `N G obj` finds the
 * streams and almost nothing else — it comes back with a handful of pages and
 * no fonts, which looks exactly like a scan. This is what separates reading a
 * 2018 standard from failing on it.
 *
 * An /ObjStm carries N objects. Its first /First bytes are pairs of object
 * number and offset; the bodies follow. None of them have streams of their own,
 * which the format guarantees.
 */
function expandObjectStreams(objects: Map<number, RawObject>): void {
  for (const container of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(container.head)) continue;

    const decoded = decodeStream(container).bytes;
    if (!decoded) continue;

    const n = Number(/\/N\s+(\d+)/.exec(container.head)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(container.head)?.[1] ?? 0);
    if (!n || !first) continue;

    const body = latin1(decoded);
    const header = body.slice(0, first).trim().split(/\s+/).map(Number);

    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const at = header[i * 2 + 1];
      if (num === undefined || at === undefined || !Number.isFinite(num)) continue;
      // The next object's offset bounds this one; the last runs to the end.
      const nextAt = header[(i + 1) * 2 + 1];
      const end = nextAt === undefined ? body.length : first + nextAt;
      // A packed object never wins over one defined in the file proper, which
      // is where an incremental update would have put a newer copy.
      if (objects.has(num)) continue;
      objects.set(num, { num, gen: 0, head: body.slice(first + at, end) });
    }
  }
}

/** endstream is preceded by an EOL that is not part of the data. */
function trimEol(text: string, from: number, to: number): number {
  let end = to;
  if (end > from && text[end - 1] === '\n') end -= 1;
  if (end > from && text[end - 1] === '\r') end -= 1;
  return end;
}

/** Applies the stream's filter. Only the ones that carry text are supported. */
function decodeStream(obj: RawObject): { bytes?: Uint8Array; warning?: string } {
  if (!obj.stream) return {};
  const filter = /\/Filter\s*(\/\w+|\[[^\]]*\])/.exec(obj.head)?.[1] ?? '';

  if (!filter) return { bytes: obj.stream };

  if (filter.includes('FlateDecode')) {
    try {
      const out = inflate(obj.stream);
      // A predictor rearranges the inflated bytes; applying none where one was
      // used gives shifted rubbish, so it is refused rather than guessed at.
      if (/\/Predictor\s+(\d+)/.test(obj.head)) {
        const p = Number(/\/Predictor\s+(\d+)/.exec(obj.head)![1]);
        if (p > 1) return { warning: `object ${obj.num} uses predictor ${p}, which this reader does not undo` };
      }
      return { bytes: out };
    } catch {
      return { warning: `object ${obj.num} is compressed in a way this reader could not inflate` };
    }
  }

  for (const unsupported of ['DCTDecode', 'JPXDecode', 'CCITTFaxDecode', 'JBIG2Decode']) {
    if (filter.includes(unsupported)) {
      // An image. Not a failure — there is simply no text in it.
      return {};
    }
  }
  if (filter.includes('ASCIIHexDecode')) return { bytes: fromHex(latin1(obj.stream)) };
  return { warning: `object ${obj.num} uses ${filter}, which this reader does not decode` };
}

function fromHex(s: string): Uint8Array {
  const clean = s.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * A ToUnicode CMap, reduced to the mapping this needs.
 *
 * Without it a font that encodes "fi" as a single glyph, or subsets its
 * alphabet so that byte 3 means "e", produces text that looks like line noise.
 * Standards are typeset with subset fonts constantly.
 */
function parseToUnicode(cmap: string): Map<number, string> {
  const out = new Map<number, string>();

  const hexToStr = (hex: string): string => {
    let s = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = parseInt(hex.substr(i, 4), 16);
      if (Number.isFinite(code)) s += String.fromCharCode(code);
    }
    return s;
  };

  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    const pairs = block.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g) ?? [];
    for (const p of pairs) {
      const m = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/.exec(p)!;
      out.set(parseInt(m[1]!, 16), hexToStr(m[2]!));
    }
  }

  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const rows = block.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g) ?? [];
    for (const r of rows) {
      const m = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/.exec(r)!;
      const lo = parseInt(m[1]!, 16);
      const hi = parseInt(m[2]!, 16);
      const dst = parseInt(m[3]!, 16);
      // A runaway range would allocate forever on a malformed file.
      if (hi < lo || hi - lo > 65535) continue;
      for (let c = lo; c <= hi; c++) out.set(c, String.fromCharCode(dst + (c - lo)));
    }
  }
  return out;
}

interface Font {
  toUnicode?: Map<number, string>;
  /** Two-byte codes, as composite fonts use. */
  wide: boolean;
}

/** Resolves the fonts a page's resources name, so its text can be decoded. */
function pageFonts(head: string, objects: Map<number, RawObject>): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const res = /\/Font\s*<<([\s\S]*?)>>/.exec(head)?.[1];
  if (!res) return fonts;

  for (const m of res.matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)) {
    const name = m[1]!;
    const fontObj = objects.get(Number(m[2]));
    if (!fontObj) continue;

    const wide = /\/Type0\b/.test(fontObj.head)
      || /\/Encoding\s*\/Identity-[HV]/.test(fontObj.head);

    let toUnicode: Map<number, string> | undefined;
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObj.head);
    if (tu) {
      const stream = objects.get(Number(tu[1]));
      if (stream) {
        const decoded = decodeStream(stream).bytes;
        if (decoded) toUnicode = parseToUnicode(latin1(decoded));
      }
    }
    fonts.set(name, { toUnicode, wide });
  }
  return fonts;
}

/** Decodes one PDF string literal's bytes through the current font. */
function decodeShown(raw: number[], font: Font | undefined): string {
  if (!font) return String.fromCharCode(...raw);

  if (font.wide) {
    let s = '';
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = (raw[i]! << 8) | raw[i + 1]!;
      s += font.toUnicode?.get(code) ?? '';
    }
    return s;
  }

  let s = '';
  for (const b of raw) s += font.toUnicode?.get(b) ?? String.fromCharCode(b);
  return s;
}

/**
 * Pulls the shown text out of a content stream.
 *
 * Only the operators that put glyphs on a page are honoured — Tj, TJ, the quote
 * forms, Tf to know which font is current, and the positioning operators that
 * imply a new line. Everything else is skipped, because a content stream is
 * mostly drawing instructions and none of them are words.
 */
function extractText(content: string, fonts: Map<string, Font>): string {
  let out = '';
  let i = 0;
  let font: Font | undefined;
  const n = content.length;

  const readLiteral = (): number[] => {
    const bytes: number[] = [];
    let depth = 1;
    i += 1;
    while (i < n) {
      const ch = content[i]!;
      if (ch === '\\') {
        const next = content[i + 1];
        if (next === undefined) break;
        const escapes: Record<string, number> = {
          n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92,
        };
        if (next in escapes) { bytes.push(escapes[next]!); i += 2; continue; }
        if (next >= '0' && next <= '7') {
          let oct = '';
          i += 1;
          for (;;) {
            const d = content[i];
            if (oct.length >= 3 || d === undefined || d < '0' || d > '7') break;
            oct += d;
            i += 1;
          }
          bytes.push(parseInt(oct, 8) & 0xff);
          continue;
        }
        // A backslash before a newline is a line continuation.
        if (next === '\n') { i += 2; continue; }
        if (next === '\r') { i += content[i + 2] === '\n' ? 3 : 2; continue; }
        bytes.push(next.charCodeAt(0)); i += 2; continue;
      }
      if (ch === '(') depth += 1;
      if (ch === ')') { depth -= 1; if (!depth) { i += 1; break; } }
      bytes.push(ch.charCodeAt(0));
      i += 1;
    }
    return bytes;
  };

  const readHex = (): number[] => {
    const end = content.indexOf('>', i);
    const hex = content.slice(i + 1, end === -1 ? n : end).replace(/[^0-9a-fA-F]/g, '');
    i = end === -1 ? n : end + 1;
    const bytes: number[] = [];
    for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.substr(k, 2).padEnd(2, '0'), 16));
    return bytes;
  };

  while (i < n) {
    const ch = content[i]!;

    if (ch === '(') { out += decodeShown(readLiteral(), font); continue; }
    if (ch === '<' && content[i + 1] !== '<') { out += decodeShown(readHex(), font); continue; }

    if (ch === '/') {
      // /F3 12 Tf — remember the font so the next string decodes correctly.
      const m = /^\/(\w+)\s+[\d.]+\s+Tf/.exec(content.slice(i, i + 40));
      if (m) { font = fonts.get(m[1]!); i += m[0].length; continue; }
      i += 1; continue;
    }

    if (ch === 'T') {
      const op = content.slice(i, i + 2);
      // Td, TD and T* all move to a new line; TJ's array is handled by the
      // string branches above.
      if (op === 'd' || op === 'D' || op === '*' || op === 'Td' || op === 'TD' || op === 'T*') {
        out += '\n'; i += 2; continue;
      }
      i += 1; continue;
    }

    if (ch === "'" || ch === '"') { out += '\n'; i += 1; continue; }
    if (ch === ']') { i += 1; continue; }

    i += 1;
  }

  return out;
}

/**
 * The page objects, in document order.
 *
 * The page tree is walked from /Type /Catalog where one is present, because
 * that is the only thing that gives a reliable order. Where it is not — a
 * damaged file, or an object stream this reader cannot open — every /Type /Page
 * found by scanning is used instead, which gets the content at the cost of
 * possibly shuffling the order.
 */
function pageObjects(objects: Map<number, RawObject>): { pages: RawObject[]; ordered: boolean } {
  const kidsOf = (obj: RawObject): number[] => {
    const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(obj.head)?.[1];
    if (!kids) return [];
    return [...kids.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  };

  let root: RawObject | undefined;
  for (const obj of objects.values()) {
    if (/\/Type\s*\/Pages\b/.test(obj.head) && !/\/Parent\b/.test(obj.head)) { root = obj; break; }
  }

  if (root) {
    const out: RawObject[] = [];
    const seen = new Set<number>();
    const walk = (obj: RawObject) => {
      if (seen.has(obj.num)) return;
      seen.add(obj.num);
      if (/\/Type\s*\/Page\b/.test(obj.head) && !/\/Type\s*\/Pages\b/.test(obj.head)) {
        out.push(obj);
        return;
      }
      for (const kid of kidsOf(obj)) {
        const k = objects.get(kid);
        if (k) walk(k);
      }
    };
    walk(root);
    if (out.length) return { pages: out, ordered: true };
  }

  const found: RawObject[] = [];
  for (const obj of objects.values()) {
    if (/\/Type\s*\/Page\b/.test(obj.head) && !/\/Type\s*\/Pages\b/.test(obj.head)) found.push(obj);
  }
  found.sort((a, b) => a.num - b.num);
  return { pages: found, ordered: false };
}

/** Collapses the whitespace a content stream leaves behind into readable lines. */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * Below this many words a page, a document is a picture of words rather than
 * words. Real typeset pages run to hundreds; a scan yields the stray character
 * or two a scanner's OCR layer leaves behind.
 */
const WORDS_PER_PAGE_FLOOR = 8;

/** Letters as a share of the characters, which is what separates text from noise. */
function letterRatio(s: string): number {
  if (!s.length) return 0;
  const letters = s.replace(/[^A-Za-z]/g, '').length;
  return letters / s.length;
}

export interface ReadPdfOptions {
  /** Stop after this many pages. Importing a 600-page standard on a phone is slow. */
  maxPages?: number;
}

/**
 * Whether the publisher has locked the file.
 *
 * Every Australian Standard Safe QLD holds is encrypted with the /Standard
 * security handler; the Queensland Government documents beside them are not.
 * The encryption is there to enforce the licence — no copying, no extraction —
 * and this app is not going to defeat it, whoever owns the copy. Detected up
 * front so the import says exactly that rather than reporting twenty streams
 * that would not inflate and leaving a technician to guess why.
 */
export function isEncrypted(bytes: Uint8Array): boolean {
  /*
   * /Encrypt lives in the trailer, but "the trailer" is not one place: an
   * incrementally updated file has several, a linearized file puts one near the
   * front, and a cross-reference stream carries it as a dictionary key rather
   * than after the trailer keyword. An 8 KB window at the end missed it on
   * fourteen of the twenty-four standards tested here, every one of which then
   * came back as an unreadable jumble instead of an honest refusal.
   *
   * Matched as a dictionary key with a value after it, so the literal appearing
   * inside a content stream is not mistaken for the real thing.
   */
  const key = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;
  const head = latin1(bytes, 0, Math.min(bytes.length, 65536));
  if (key.test(head)) return true;
  const tail = latin1(bytes, Math.max(0, bytes.length - 262144));
  return key.test(tail);
}

export function readPdf(bytes: Uint8Array, options: ReadPdfOptions = {}): PdfDocument {
  if (!isPdf(bytes)) throw new PdfError('Not a PDF — the file does not start with %PDF-.');

  if (isEncrypted(bytes)) {
    throw new PdfError(
      'This PDF is encrypted by its publisher to prevent its text being copied. Every Australian '
      + 'Standard is published this way. Safe QLD will not strip that protection — read it in your '
      + 'own licensed viewer, and use the clause index in this app to find which clause you want.',
    );
  }

  const objects = scanObjects(bytes);
  if (!objects.size) throw new PdfError('No PDF objects found. The file is truncated or not a PDF.');

  const warnings = new Set<string>();
  const { pages: pageObjs, ordered } = pageObjects(objects);
  if (!ordered && pageObjs.length) {
    warnings.add(
      'The page tree could not be walked, so pages are in object order rather than reading order. '
      + 'The text is all here; a page number cited from it may not match the printed one.',
    );
  }

  const limit = options.maxPages ?? pageObjs.length;
  const pages: PdfPage[] = [];

  for (const [index, page] of pageObjs.slice(0, limit).entries()) {
    const fonts = pageFonts(page.head, objects);

    const contentRefs = /\/Contents\s*(\d+)\s+\d+\s+R/.exec(page.head)?.[1]
      ? [Number(/\/Contents\s*(\d+)\s+\d+\s+R/.exec(page.head)![1])]
      : [...(/\/Contents\s*\[([\s\S]*?)\]/.exec(page.head)?.[1] ?? '')
        .matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));

    let text = '';
    for (const ref of contentRefs) {
      const stream = objects.get(ref);
      if (!stream) continue;
      const { bytes: decoded, warning } = decodeStream(stream);
      if (warning) warnings.add(warning);
      if (decoded) text += extractText(latin1(decoded), fonts);
    }

    pages.push({ number: index + 1, text: tidy(text) });
  }

  if (pageObjs.length > limit) {
    warnings.add(`Stopped after ${limit} pages of ${pageObjs.length}.`);
  }

  const text = pages.map((p) => p.text).filter(Boolean).join('\n\n');

  /*
   * A scan has no text in it. Some scanners leave a handful of stray characters
   * behind, and letting those pass for a readable document is worse than
   * returning nothing — a technician would search it, find nothing, and
   * conclude the standard did not say anything about it.
   */
  /*
   * Measured per page rather than as an absolute count. A one-page cover sheet
   * with a dozen words is a real document; a two-hundred-page standard with a
   * dozen words is a scan, and an absolute floor cannot tell them apart.
   */
  const words = text.split(/\s+/).filter((w) => w.length > 2 && /[a-z]/i.test(w));
  const perPage = pages.length ? words.length / pages.length : 0;
  if (perPage < WORDS_PER_PAGE_FLOOR || letterRatio(text) < 0.4) {
    warnings.add(
      'No readable text. This is almost certainly a scan of a paper original — a picture of the '
      + 'words rather than the words — and nothing can extract text that is not there. Searching '
      + 'it will find nothing, so it has not been indexed.',
    );
    return { pages: [], text: '', info: readInfo(objects), warnings: [...warnings] };
  }

  return { pages, text, info: readInfo(objects), warnings: [...warnings] };
}

function readInfo(objects: Map<number, RawObject>): Record<string, string> {
  const info: Record<string, string> = {};
  for (const obj of objects.values()) {
    if (!/\/(Title|Author|Subject|Producer|Creator)\s*\(/.test(obj.head)) continue;
    for (const m of obj.head.matchAll(/\/(Title|Author|Subject|Producer|Creator)\s*\(([^)]*)\)/g)) {
      const value = m[2]!.replace(/\\([()\\])/g, '$1').trim();
      if (value && !info[m[1]!]) info[m[1]!] = value;
    }
  }
  return info;
}
