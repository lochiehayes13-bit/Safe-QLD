/**
 * Characterising a configuration file nobody has a parser for yet.
 *
 * Reverse-engineering a vendor format starts the same way every time: is it
 * text or binary, is it a container, what separates a record from the next one,
 * and what repeats. Doing that by eye on a 1.7 MB file is slow and easy to get
 * wrong, so this does it mechanically.
 *
 * It serves two purposes. In the app, a technician who drops an unrecognised
 * file gets something better than "unsupported" — it says what the file appears
 * to be and whether it is the sort of thing a parser could be built for. And
 * when a sample arrives for a panel family we do not yet read, this is the
 * first pass over it.
 *
 * It deliberately does not guess at a vendor. Saying "this looks like a Simplex
 * database" on the strength of a file extension would be a guess dressed as a
 * finding.
 */

import { inflate } from 'pako';
import { isZip, likelyConfigEntry, readZip } from './zipRead';

export type Container =
  | 'zip'
  | 'sqlite'
  | 'ole-compound'
  | 'gzip'
  | 'ms-access'
  | 'xml'
  | 'json'
  | 'plain-text'
  | 'unknown-binary';

export interface FileProbe {
  byteLength: number;
  container: Container;
  /** Human sentence about what the container means for parsing. */
  containerNote: string;
  /** Whether the content is readable as text at all. */
  textual: boolean;
  /** Best guess at how the bytes decode. */
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1' | 'binary';
  /** Proportion of bytes that are printable ASCII or common whitespace. */
  printableRatio: number;
  lineCount: number;
  /**
   * Most likely field separator, with how concentrated the record shapes are:
   * the share of delimited lines covered by the three commonest field counts.
   */
  delimiter?: { char: string; name: string; consistency: number };
  /** Lines that look like section headers, e.g. "[ P 10000 P 1". */
  sectionMarkers: string[];
  /** Tokens that repeat often enough to look like a controlled vocabulary. */
  repeatedTokens: { token: string; count: number }[];
  /** First lines, for a human to read. */
  head: string[];
  /** What this suggests about building a parser. */
  assessment: string;
  /**
   * For a container, the probe of the file inside it.
   *
   * Saying "unpack it first" and then not doing so leaves the reader exactly
   * where they started, when the interesting answer is one step away.
   */
  inner?: { name: string; probe: FileProbe };
}

const MAGIC: { bytes: number[]; container: Container; note: string }[] = [
  {
    bytes: [0x50, 0x4b, 0x03, 0x04],
    container: 'zip',
    note: 'A zip container. Unpack it first — the useful data is one of the entries inside, and those are often plain text or XML.',
  },
  {
    bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00],
    container: 'sqlite',
    note: 'A SQLite database. This is the best case for a binary format: the schema is readable and every table can be queried directly.',
  },
  {
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    container: 'ole-compound',
    note: 'An OLE compound document — the old Microsoft container. Readable with a compound-file library; the payload inside is usually a proprietary stream.',
  },
  { bytes: [0x1f, 0x8b], container: 'gzip', note: 'Gzip-compressed. Decompress it and probe again.' },
  {
    bytes: [0x00, 0x01, 0x00, 0x00, 0x53, 0x74, 0x61, 0x6e, 0x64, 0x61, 0x72, 0x64, 0x20, 0x4a, 0x65, 0x74],
    container: 'ms-access',
    note: 'A Microsoft Access database. Readable with an MDB tool, and the table names usually map straight onto panel concepts.',
  },
];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

const DELIMITERS: { char: string; name: string }[] = [
  { char: '\t', name: 'tab' },
  { char: ',', name: 'comma' },
  { char: ';', name: 'semicolon' },
  { char: '|', name: 'pipe' },
];

/**
 * A separator is only a separator if the lines using it fall into a few clear
 * record shapes. A comma appearing in prose does not, and treating it as one
 * produces a column layout that shifts halfway down the file.
 *
 * Note that this is not "every line has the same number of fields". A real
 * vendor config is sectioned: the Ampac file has 29 tabs on its device rows,
 * 15 on another record type and 1 on another, and no single count covers even
 * half the tabbed lines. Demanding one uniform width finds no delimiter in a
 * file that is unmistakably tab-separated. What distinguishes structure from
 * prose is concentration — a handful of shapes accounting for most lines.
 */
function detectDelimiter(lines: string[]): FileProbe['delimiter'] {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 3) return undefined;

  // Sample evenly across the whole file rather than taking the first n lines.
  // A vendor config typically opens with a header block and only then gets to
  // its delimited records — reading the top alone finds no delimiter and
  // concludes, wrongly, that there is none.
  const stride = Math.max(1, Math.floor(nonEmpty.length / 1000));
  const sample: string[] = [];
  for (let i = 0; i < nonEmpty.length; i += stride) sample.push(nonEmpty[i]!);

  let best: FileProbe['delimiter'];
  let bestStrength = 0;
  for (const { char, name } of DELIMITERS) {
    const counts = sample.map((l) => l.split(char).length - 1).filter((n) => n > 0);
    // Some lines will always be headers or blanks. What marks a real delimiter
    // is that a decent share of lines use it and those that do agree on how
    // many fields there are.
    if (counts.length < Math.max(3, sample.length * 0.2)) continue;

    const shapes = counts
      .reduce<Map<number, number>>((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map());

    // How much of the delimited content the three commonest record shapes
    // account for. Structured data concentrates; prose does not.
    const topThree = [...shapes.values()].sort((a, b) => b - a).slice(0, 3);
    const concentration = topThree.reduce((n, c) => n + c, 0) / counts.length;
    const share = counts.length / sample.length;
    const strength = concentration * Math.min(1, share * 2);

    if (concentration >= 0.5 && (!best || strength > bestStrength)) {
      best = { char, name, consistency: concentration };
      bestStrength = strength;
    }
  }
  return best;
}

/**
 * Lines that look like they open a section rather than carry a record.
 *
 * Bracketed headers, all-caps keyword lines and lines ending in a colon are the
 * three shapes vendors reach for. Recognising them is most of understanding how
 * a text config is organised.
 */
function detectSectionMarkers(lines: string[]): string[] {
  const seen = new Map<string, number>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length > 120) continue;
    const bracketed = /^[[<{(]/.test(line);
    const keyword = /^[A-Z][A-Z0-9 _-]{2,}$/.test(line);
    const colon = /^[A-Za-z][A-Za-z0-9 _-]{2,}:$/.test(line);
    if (!bracketed && !keyword && !colon) continue;
    // Generalise the numbers out so "[ P 10000 P 1" and "[ P 20000 P 2" count
    // as the same shape rather than as two hapaxes.
    const shape = line.replace(/\d+/g, '#');
    seen.set(shape, (seen.get(shape) ?? 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([shape, count]) => `${shape}  (×${count})`);
}

/**
 * Tokens that repeat often enough to be a controlled vocabulary rather than
 * data — device types, states, protocol names.
 *
 * Sampled across the whole file for the same reason the delimiter is: the top
 * of a vendor config is header material where every token is unique. Reading
 * only the first few thousand lines of the Ampac file finds nothing at all,
 * while the device rows below carry OPT, INPUT, DMULTI and HYD thousands of
 * times over.
 */
function detectRepeatedTokens(lines: string[], delimiter?: string): { token: string; count: number }[] {
  const counts = new Map<string, number>();
  const stride = Math.max(1, Math.floor(lines.length / 5000));
  const sample: string[] = [];
  for (let i = 0; i < lines.length; i += stride) sample.push(lines[i]!);

  for (const line of sample) {
    const fields = delimiter ? line.split(delimiter) : line.split(/\s+/);
    for (const raw of fields) {
      const token = raw.trim();
      // Short tokens and bare numbers are noise; a controlled vocabulary is
      // words like SMOKE, MCP, SOUNDER.
      if (token.length < 3 || token.length > 24) continue;
      if (/^\d+$/.test(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([token, count]) => ({ token, count }));
}

function detectEncoding(bytes: Uint8Array): FileProbe['encoding'] {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }
  // A run of alternating zero bytes is UTF-16 without a mark, which is common
  // in Windows tooling and decodes to nonsense if read as bytes.
  const window = bytes.slice(0, 512);
  let zeroAtOdd = 0;
  for (let i = 1; i < window.length; i += 2) if (window[i] === 0) zeroAtOdd++;
  if (window.length > 32 && zeroAtOdd > window.length / 4) return 'utf-16le';

  let high = 0;
  let invalidUtf8 = 0;
  for (let i = 0; i < window.length; i++) {
    const b = window[i]!;
    if (b < 0x80) continue;
    high++;
    // Rough continuation check: a lead byte should be followed by 10xxxxxx.
    if (b >= 0xc0 && b <= 0xf7) {
      const next = window[i + 1];
      if (next === undefined || (next & 0xc0) !== 0x80) invalidUtf8++;
    } else if ((b & 0xc0) !== 0x80) {
      invalidUtf8++;
    }
  }
  if (high === 0) return 'utf-8';
  return invalidUtf8 > high / 4 ? 'latin1' : 'utf-8';
}

function printableRatio(bytes: Uint8Array): number {
  if (!bytes.length) return 0;
  const window = bytes.slice(0, 8192);
  let printable = 0;
  for (const b of window) {
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / window.length;
}

function assess(probe: Omit<FileProbe, 'assessment'>): string {
  switch (probe.container) {
    case 'sqlite':
      return 'Readable without reverse engineering: open it and read the schema. Table and column names usually map straight onto zones, loops and devices.';
    case 'ms-access':
      return 'A database rather than a format to decode. Export the tables and the structure will be self-describing.';
    case 'zip':
      return 'Unpack it and probe the entries — a zip of XML or text is a straightforward parse once the wrapper is off.';
    case 'gzip':
      return 'Decompress and probe again; the result is likely text.';
    case 'xml':
      return 'Self-describing. Element names will name the concepts, and a parser is schema mapping rather than reverse engineering.';
    case 'json':
      return 'Self-describing. Parsing is trivial; the work is mapping its shape onto sites, panels, zones and points.';
    case 'ole-compound':
      return 'A container from the old Microsoft toolchain. The streams inside are usually proprietary, so this is the hardest realistic case short of an encrypted blob.';
    case 'plain-text':
      break;
    case 'unknown-binary':
      return 'No recognised signature and largely unprintable. Reverse engineering this needs several sample files from the same site over time — the bytes that change are the data, and the ones that do not are structure.';
  }

  const bits: string[] = [];
  if (probe.delimiter) {
    bits.push(
      `Delimited text (${probe.delimiter.name}); the three commonest record shapes cover ` +
      `${Math.round(probe.delimiter.consistency * 100)}% of delimited lines.`,
    );
  } else {
    bits.push('Plain text with no consistent field separator, so records are probably fixed-width or line-oriented.');
  }
  if (probe.sectionMarkers.length) {
    bits.push(`${probe.sectionMarkers.length} repeating section-header shapes, so it is organised in blocks rather than one flat table.`);
  }
  if (probe.repeatedTokens.length) {
    bits.push(`${probe.repeatedTokens.length} repeated tokens that look like a controlled vocabulary — likely device types or states.`);
  }
  bits.push('This is the workable case: a parser can be built from a couple of real files.');
  return bits.join(' ');
}

/** Decodes bytes for inspection, tolerating whatever encoding they turn out to be. */
export function decodeForProbe(bytes: Uint8Array, encoding: FileProbe['encoding']): string {
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const out: string[] = [];
    const swap = encoding === 'utf-16be';
    // Skip the byte order mark: kept, it decodes to U+FEFF and then counts as
    // an unprintable character, which is enough on a short file to have the
    // whole thing judged binary.
    const hasBom =
      bytes.length >= 2 &&
      ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
    for (let i = hasBom ? 2 : 0; i + 1 < bytes.length; i += 2) {
      const a = bytes[i]!;
      const b = bytes[i + 1]!;
      out.push(String.fromCharCode(swap ? (a << 8) | b : (b << 8) | a));
    }
    return out.join('');
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * Opens a container one level down, where that can be done safely.
 *
 * One level only. A container nested inside a container is either an unusual
 * vendor choice worth a human looking at, or an archive bomb, and neither is
 * worth unwrapping automatically.
 */
function unwrap(bytes: Uint8Array, container: Container, sampleLines: number):
  { name: string; probe: FileProbe } | undefined {
  try {
    if (container === 'zip' && isZip(bytes)) {
      const entry = likelyConfigEntry(readZip(bytes));
      if (!entry) return undefined;
      return { name: entry.name, probe: probeFile(entry.bytes, sampleLines, false) };
    }
    if (container === 'gzip') {
      return { name: '(decompressed)', probe: probeFile(inflate(bytes), sampleLines, false) };
    }
  } catch {
    // A container that will not open is still worth reporting as a container;
    // the outer probe already says what it is.
    return undefined;
  }
  return undefined;
}

export function probeFile(bytes: Uint8Array, sampleLines = 40, unwrapContainers = true): FileProbe {
  for (const { bytes: sig, container, note } of MAGIC) {
    if (startsWith(bytes, sig)) {
      const base: Omit<FileProbe, 'assessment'> = {
        byteLength: bytes.length,
        container,
        containerNote: note,
        textual: false,
        encoding: 'binary',
        printableRatio: printableRatio(bytes),
        lineCount: 0,
        sectionMarkers: [],
        repeatedTokens: [],
        head: [],
      };
      const inner = unwrapContainers ? unwrap(bytes, container, sampleLines) : undefined;
      return {
        ...base,
        inner,
        assessment: inner
          ? `${assess(base)} Opened it: the largest entry is "${inner.name}". ${inner.probe.assessment}`
          : assess(base),
      };
    }
  }

  const encoding = detectEncoding(bytes);
  const text = decodeForProbe(bytes, encoding);
  // UTF-16 is roughly half null bytes, so measuring printability on the raw
  // bytes calls every UTF-16 text file binary. Measure the decoded characters
  // instead — which is what a reader would actually see.
  const ratio =
    encoding === 'utf-16le' || encoding === 'utf-16be'
      ? printableRatio(Uint8Array.from([...text.slice(0, 8192)].map((c) => c.charCodeAt(0) & 0xff)))
      : printableRatio(bytes);
  const trimmedStart = text.slice(0, 200).trimStart();

  let container: Container = 'plain-text';
  let containerNote = 'Plain text, which is the format a parser can most readily be built for.';
  if (trimmedStart.startsWith('<?xml') || /^<[A-Za-z_][\w:.-]*[\s>]/.test(trimmedStart)) {
    container = 'xml';
    containerNote = 'XML, so the structure names itself.';
  } else if (/^[[{]/.test(trimmedStart)) {
    // Only call it JSON if it actually parses — a bracketed section header
    // opens plenty of text configs, including Ampac's.
    try {
      JSON.parse(text);
      container = 'json';
      containerNote = 'JSON, so the structure names itself.';
    } catch {
      /* not JSON; leave as plain text */
    }
  } else if (ratio < 0.7) {
    container = 'unknown-binary';
    containerNote = 'Mostly unprintable bytes with no recognised signature.';
  }

  const textual = container !== 'unknown-binary';
  const lines = textual ? text.split(/\r\n|\r|\n/) : [];
  const delimiter = textual ? detectDelimiter(lines) : undefined;

  const base: Omit<FileProbe, 'assessment'> = {
    byteLength: bytes.length,
    container,
    containerNote,
    textual,
    encoding: textual ? encoding : 'binary',
    printableRatio: ratio,
    lineCount: lines.length,
    delimiter,
    sectionMarkers: textual ? detectSectionMarkers(lines) : [],
    repeatedTokens: textual ? detectRepeatedTokens(lines, delimiter?.char) : [],
    head: lines.slice(0, sampleLines).map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l)),
  };

  return { ...base, assessment: assess(base) };
}
