/**
 * RFC 4180-style delimited text parsing, with delimiter sniffing.
 *
 * Panel programming tools export point and zone lists as CSV/TSV far more often
 * than they expose their native format, so this is the most broadly useful
 * import path in the app.
 */

export type Delimiter = ',' | ';' | '\t' | '|';

/**
 * Guesses the delimiter by scoring candidates on how consistently they split
 * the first few lines into the same number of fields. Consistency beats raw
 * frequency: device text often contains commas but rarely tabs or pipes.
 */
export function sniffDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [',', ';', '\t', '|'];
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (!lines.length) return ',';

  let best: Delimiter = ',';
  let bestScore = -1;

  for (const d of candidates) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const first = counts[0]!;
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length;
    // Reward both consistency across lines and having several columns.
    const score = consistent * 10 + Math.min(first, 12);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Splits a single line, honouring double-quoted fields. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parses delimited text into rows, handling quoted fields that contain the
 * delimiter or span newlines.
 */
export function parseDelimited(text: string, delim?: Delimiter): string[][] {
  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const d = delim ?? sniffDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === d) { row.push(cur); cur = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  // Flush trailing content, but not a phantom row from a trailing newline.
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Serialises rows back to CSV, quoting only where required. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          if (c === null || c === undefined) return '';
          const s = String(c);
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}
