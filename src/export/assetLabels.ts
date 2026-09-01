import { TAG_LENGTH, compactTag, parseTag, tagPayload } from '@/domain/assetTag';

/**
 * The label sheet that gets 12,553 assets identified.
 *
 * A tag scheme with no way to print it is a database column. This turns a list
 * of tags into an A4 sheet a technician runs off in the office on the way to
 * site, on label stock from any newsagent, with a machine-readable code on
 * every label.
 *
 * **Why a barcode and not a QR code.** A QR would be nicer: smaller, readable
 * at any rotation, and it could carry the whole payload. Implementing one
 * correctly is Reed-Solomon error correction over GF(256), eight mask patterns
 * scored against four penalty rules, and BCH-coded format information — and
 * the failure mode of getting any of that subtly wrong is a symbol that looks
 * perfectly convincing on paper and cannot be read by anything. Adding a
 * library was not an option either. So the code here is Code 39, which is a
 * lookup table and some rectangles, is impossible to get subtly wrong, and is
 * already in the scan screen's list of accepted symbologies. A barcode that
 * scans beats a QR that does not.
 *
 * The tag's own payload string (SQFP:1:...) exists in the domain module and is
 * unused here, waiting for the day a QR is worth building. Code 39's character
 * set has no colon, so the barcode carries the tag alone, without separators —
 * which the parser accepts, since it counts field widths rather than looking
 * for hyphens.
 *
 * **What is deliberately not printed: a date.** Every other date printed on a
 * fire asset means something — tested, pressure tested, replace by. A print
 * date on a tag would be read as one of those from six feet up a ladder, and
 * a label that implies a service happened is worse than no label.
 *
 * Nothing here touches the file system or the database. It returns HTML, and
 * the screen hands that to expo-print.
 */

// ---------------------------------------------------------------------------
// Label stock
// ---------------------------------------------------------------------------

export type StockConfidence = 'high' | 'medium' | 'low';

export interface LabelStock {
  id: string;
  /** What it is called on the box. */
  name: string;
  /** The code printed on the packet, which is how a technician buys more. */
  productCode: string;
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  columnGapMm: number;
  rowGapMm: number;
  /** Where the dimensions came from. */
  source: string;
  confidence: StockConfidence;
  note?: string;
}

/**
 * The stock this prints on.
 *
 * A4 sheet stock rather than a thermal roll: every office already has an A4
 * laser printer and these sheets are on the shelf at any Australian newsagent
 * or office supplier, whereas a label printer is a purchase, a driver and a
 * consumable that runs out on a Friday.
 *
 * Label sizes and counts are from retail listings of the Avery Australia
 * product; Avery's own site refuses automated retrieval, so they are marked
 * medium confidence rather than claimed as manufacturer data. The page margins
 * are NOT quoted from anywhere — they are derived by centring the block of
 * labels on the page, which is how the die is set and which reproduces the
 * commonly published figures for L7160 (7.25 mm left, 15.15 mm top) exactly.
 * Any real sheet should still be proved with one test print, which is what the
 * offset adjustment below is for.
 */
export const LABEL_STOCKS: LabelStock[] = [
  {
    id: 'l7160',
    name: 'Avery L7160 — 21 per A4 sheet',
    productCode: 'L7160 / 959001',
    pageWidthMm: 210, pageHeightMm: 297,
    labelWidthMm: 63.5, labelHeightMm: 38.1,
    columns: 3, rows: 7,
    columnGapMm: 2.5, rowGapMm: 0,
    source: 'Avery Australia L7160 (959001), 63.5 x 38.1 mm, 21 per sheet, as listed by Winc: '
      + 'https://www.winc.com.au/main-catalogue-productdetail/avery-quick-peel-address-labels-with-sure-feed-laser-print-63-5-x-38-1-mm-2100-labels-959001-l7160/50061200',
    confidence: 'medium',
    note: 'The default. Big enough for a scannable barcode, small enough for a detector base or an extinguisher body.',
  },
  {
    id: 'l7163',
    name: 'Avery L7163 — 14 per A4 sheet',
    productCode: 'L7163 / 959004',
    pageWidthMm: 210, pageHeightMm: 297,
    labelWidthMm: 99.1, labelHeightMm: 38.1,
    columns: 2, rows: 7,
    columnGapMm: 2.5, rowGapMm: 0,
    source: 'Avery Australia L7163 (99.1 x 38.1 mm, 14 per sheet): '
      + 'https://www.averyproducts.com.au/product/removable-multi-purpose-labels-959046',
    confidence: 'medium',
    note: 'Wider, so the barcode gets a bigger module and reads from further away. For plant rooms and boosters.',
  },
  {
    id: 'l7651',
    name: 'Avery L7651 — 65 per A4 sheet',
    productCode: 'L7651 / 959005',
    pageWidthMm: 210, pageHeightMm: 297,
    labelWidthMm: 38.1, labelHeightMm: 21.2,
    columns: 5, rows: 13,
    columnGapMm: 2.5, rowGapMm: 0,
    source: 'Avery L7651 (38.1 x 21.2 mm, 65 per sheet), as listed by Winc: '
      + 'https://www.winc.com.au/main-catalogue-productdetail/avery-address-labels-with-quick-peel-for-laser-printers-38-1-x-21-2mm-6500-labels-l7651-/86716263',
    confidence: 'medium',
    note: 'Too narrow for a readable barcode at this tag length — these print the number only, and the sheet says so.',
  },
];

export function stockById(id: string): LabelStock | undefined {
  return LABEL_STOCKS.find((s) => s.id === id);
}

export interface StockLayout {
  leftMarginMm: number;
  topMarginMm: number;
  perSheet: number;
}

/** Where the block of labels sits on the page, derived by centring it. */
export function stockLayout(stock: LabelStock): StockLayout {
  const blockWidth = stock.columns * stock.labelWidthMm + (stock.columns - 1) * stock.columnGapMm;
  const blockHeight = stock.rows * stock.labelHeightMm + (stock.rows - 1) * stock.rowGapMm;
  return {
    leftMarginMm: (stock.pageWidthMm - blockWidth) / 2,
    topMarginMm: (stock.pageHeightMm - blockHeight) / 2,
    perSheet: stock.columns * stock.rows,
  };
}

// ---------------------------------------------------------------------------
// Code 39
// ---------------------------------------------------------------------------

/**
 * Code 39 element patterns: nine elements per character, alternating bar and
 * space and starting with a bar, of which exactly three are wide.
 *
 * The table is the risky part of any barcode renderer — one transposed pattern
 * produces a symbol that scans as the wrong character — so the test file checks
 * every row for the structural invariants the symbology guarantees (nine
 * elements, three wide, two of them bars, all 44 patterns distinct) and then
 * decodes rendered symbols back to their input.
 */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

/** Start and stop character. Not valid data, which is why the tag has no asterisk in it. */
const CODE39_GUARD = '*';

/** The symbology's own character set, exposed so callers can check before rendering. */
export const CODE39_ALPHABET = Object.keys(CODE39).filter((c) => c !== CODE39_GUARD).join('');

export const CODE39_PATTERNS: Readonly<Record<string, string>> = CODE39;

/**
 * Minimum narrow element, below which a laser-printed symbol stops being
 * reliably readable by a phone camera in a dark riser cupboard.
 *
 * 0.19 mm (7.5 mil) is the common practical floor. The wide-to-narrow ratio
 * must be between 2.2:1 and 3.0:1 once the narrow element is under 0.508 mm
 * (0.020"), so 3:1 is preferred and 2.5:1 is the fallback when the label is
 * too narrow for it.
 *
 * Source: AIM Uniform Symbology Specification USS-39, copy at
 * https://expresscorp.com/wp-content/uploads/2023/02/USS-39.pdf — a hosted
 * copy rather than AIM's own publication, so treated as medium confidence.
 */
export const MIN_NARROW_MM = 0.19;
const PREFERRED_RATIO = 3;
const FALLBACK_RATIO = 2.5;
/** Ten narrow elements of clear space each side, per the specification. */
const QUIET_ZONE_MODULES = 10;
/** USS-39: bar height is at least 15% of symbol length, and never under 6.35 mm. */
const MIN_BAR_HEIGHT_MM = 6.35;
const BAR_HEIGHT_FRACTION = 0.15;

/** Total width of a symbol in narrow-element widths, including quiet zones. */
export function code39WidthModules(characterCount: number, ratio: number): number {
  const perCharacter = 6 + 3 * ratio;
  return QUIET_ZONE_MODULES * 2 + characterCount * perCharacter + (characterCount - 1);
}

export interface BarcodePlan {
  ratio: number;
  narrowMm: number;
  widthMm: number;
  heightMm: number;
}

/**
 * Whether a barcode can honestly be printed in the space available.
 *
 * Returns undefined rather than shrinking the modules until it fits. A symbol
 * printed below the readable module width looks like a working barcode and
 * scans like a smudge, and a technician who has learned that the barcodes on
 * these labels do not work stops trying to scan them — which loses the whole
 * point of the exercise for every label, not just the small ones.
 */
export function planBarcode(
  dataLength: number,
  availableWidthMm: number,
  availableHeightMm: number,
): BarcodePlan | undefined {
  const characters = dataLength + 2; // start and stop
  for (const ratio of [PREFERRED_RATIO, FALLBACK_RATIO]) {
    const modules = code39WidthModules(characters, ratio);
    const narrowMm = availableWidthMm / modules;
    if (narrowMm < MIN_NARROW_MM) continue;
    const heightMm = Math.max(MIN_BAR_HEIGHT_MM, availableWidthMm * BAR_HEIGHT_FRACTION);
    if (heightMm > availableHeightMm) continue;
    return { ratio, narrowMm, widthMm: availableWidthMm, heightMm };
  }
  return undefined;
}

/**
 * Draws a Code 39 symbol as inline SVG, in millimetres.
 *
 * Returns undefined for data the symbology cannot carry, rather than dropping
 * the offending character: a barcode that encodes something other than what is
 * printed beside it is the exact failure this whole module exists to prevent.
 */
export function code39Svg(data: string, plan: BarcodePlan): string | undefined {
  const characters = `${CODE39_GUARD}${data}${CODE39_GUARD}`;
  for (const ch of data) {
    if (ch === CODE39_GUARD || CODE39[ch] === undefined) return undefined;
  }

  const { ratio, narrowMm, heightMm } = plan;
  const rects: string[] = [];
  let x = QUIET_ZONE_MODULES * narrowMm;

  for (let i = 0; i < characters.length; i += 1) {
    const pattern = CODE39[characters[i] as string];
    if (pattern === undefined) return undefined;
    for (let e = 0; e < pattern.length; e += 1) {
      const width = (pattern[e] === 'w' ? ratio : 1) * narrowMm;
      // Even elements are bars, odd are spaces; only bars are drawn.
      if (e % 2 === 0) {
        rects.push(`<rect x="${round(x)}" y="0" width="${round(width)}" height="${round(heightMm)}"/>`);
      }
      x += width;
    }
    if (i < characters.length - 1) x += narrowMm; // inter-character gap
  }

  const totalWidth = x + QUIET_ZONE_MODULES * narrowMm;
  return `<svg class="bc" width="${round(totalWidth)}mm" height="${round(heightMm)}mm" `
    + `viewBox="0 0 ${round(totalWidth)} ${round(heightMm)}" shape-rendering="crispEdges" `
    + `xmlns="http://www.w3.org/2000/svg"><g fill="#000">${rects.join('')}</g></svg>`;
}

/** Three decimal places is a tenth of a printer dot at 600 dpi; more is noise in the file. */
function round(mm: number): number {
  return Math.round(mm * 1000) / 1000;
}

/**
 * Reads a Code 39 symbol back out of its element widths.
 *
 * Here rather than in the test file because it is the only honest way to prove
 * the renderer works: encode, measure the bars and spaces off the drawing, and
 * see whether the original string comes back. Exported so it can be used
 * against the real SVG rather than against a copy of the encoder's own logic.
 */
export function decodeCode39Widths(widths: number[], narrow: number, ratio: number): string | undefined {
  const midpoint = (1 + ratio) / 2;
  const symbols = widths.map((w) => (w / narrow > midpoint ? 'w' : 'n'));
  const perCharacter = 9;
  const out: string[] = [];
  const lookup = new Map(Object.entries(CODE39).map(([ch, pattern]) => [pattern, ch]));

  for (let i = 0; i < symbols.length; i += perCharacter + 1) {
    const pattern = symbols.slice(i, i + perCharacter).join('');
    if (pattern.length < perCharacter) return undefined;
    const ch = lookup.get(pattern);
    if (ch === undefined) return undefined;
    out.push(ch);
  }

  const text = out.join('');
  if (!text.startsWith(CODE39_GUARD) || !text.endsWith(CODE39_GUARD) || text.length < 2) return undefined;
  return text.slice(1, -1);
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export interface LabelContent {
  /** The full tag. A label whose tag does not validate is not printed. */
  tag: string;
  /** "Fire extinguisher", "Detector" — what the thing is. */
  typeLabel: string;
  /** Where it is: "Level 3 · Plant room". */
  location: string;
  siteName: string;
}

export interface LabelSheetOptions {
  stock: LabelStock;
  /**
   * Which label position on the first sheet to start at, counting across then
   * down from 1. Part-used sheets are the normal state of a label packet, and
   * without this every reprint wastes the top row.
   */
  startAt?: number;
  /** Printer drift, in millimetres, proved with one test print. */
  offsetXMm?: number;
  offsetYMm?: number;
  /** Faint outlines, for a test print on plain paper. Off for real stock. */
  showOutlines?: boolean;
}

export interface OmittedLabel {
  tag: string;
  reason: string;
}

export interface LabelSheetResult {
  html: string;
  sheets: number;
  printed: number;
  omitted: OmittedLabel[];
  warnings: string[];
  /** What was decided about the barcode, so the screen can say it out loud. */
  barcode: { rendered: boolean; ratio?: number; narrowMm?: number; reason?: string };
}

function esc(s: string | number | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the printable sheet.
 *
 * Labels whose tag does not validate are left off and reported. Printing an
 * unverifiable number onto adhesive and sticking it to a fire asset makes a
 * bad record permanent and physical, and the sheet has no way to warn the
 * person who reads it in three years.
 */
export function buildLabelSheet(labels: LabelContent[], options: LabelSheetOptions): LabelSheetResult {
  const { stock } = options;
  const layout = stockLayout(stock);
  const warnings: string[] = [];
  const omitted: OmittedLabel[] = [];

  const startAt = Math.trunc(options.startAt ?? 1);
  let skip = startAt - 1;
  if (startAt < 1 || startAt > layout.perSheet) {
    warnings.push(
      `Start position ${startAt} is outside the 1 to ${layout.perSheet} labels on a sheet of `
      + `${stock.productCode}. Started at the first label instead.`,
    );
    skip = 0;
  }

  const printable: LabelContent[] = [];
  for (const label of labels) {
    const parsed = parseTag(label.tag);
    if (!parsed.ok) {
      omitted.push({ tag: label.tag, reason: parsed.message });
      continue;
    }
    printable.push({ ...label, tag: parsed.tag });
  }

  const padMm = stock.labelWidthMm >= 60 ? 3 : 2;
  const availableWidth = stock.labelWidthMm - padMm * 2;
  // Barcodes get at most a little under half the label; the rest is the number
  // and the location, which are what a person reads when the scan fails.
  const availableHeight = stock.labelHeightMm * 0.42;
  // Every tag is the same width by construction, so the symbol is sized once
  // from the stock. Sizing it per label would print two tags of identical
  // length at different module widths for no reason a reader could see.
  const plan = planBarcode(TAG_LENGTH, availableWidth, availableHeight);

  let barcode: LabelSheetResult['barcode'];
  if (plan) {
    barcode = { rendered: true, ratio: plan.ratio, narrowMm: Math.round(plan.narrowMm * 1000) / 1000 };
  } else {
    const reason = `A ${TAG_LENGTH}-character tag will not fit a readable Code 39 symbol across `
      + `${availableWidth.toFixed(1)} mm — the narrow bar would come out under ${MIN_NARROW_MM} mm. `
      + 'These labels carry the number only. Use wider stock if they need to be scannable.';
    barcode = { rendered: false, reason };
    warnings.push(reason);
  }

  const sheets: string[] = [];
  const blanks = Array.from({ length: skip }, () => '');
  const positions = [...blanks, ...printable.map((l) => renderLabel(l, stock, plan, padMm))];

  for (let i = 0; i < positions.length; i += layout.perSheet) {
    sheets.push(renderSheet(positions.slice(i, i + layout.perSheet), stock, layout, options));
  }

  if (!printable.length) {
    warnings.push('Nothing to print: no label in this batch carries a tag that validates.');
  }

  return {
    html: page(sheets, stock, options),
    sheets: sheets.length,
    printed: printable.length,
    omitted,
    warnings,
    barcode,
  };
}

function renderLabel(
  label: LabelContent,
  stock: LabelStock,
  plan: BarcodePlan | undefined,
  padMm: number,
): string {
  const compact = compactTag(label.tag);
  const svg = plan ? code39Svg(compact, plan) : undefined;
  const compactStock = stock.labelHeightMm < 30;

  // On stock too small for a barcode the number carries the whole label, so it
  // is set large enough to be read at arm's length rather than shrunk to leave
  // room for detail nobody can read anyway.
  const tagSize = svg ? (compactStock ? 9 : 11) : (compactStock ? 11 : 14);

  return `<div class="lb" style="padding:${padMm}mm">
  <div class="ty">${esc(label.typeLabel)}</div>
  <div class="tg" style="font-size:${tagSize}pt">${esc(label.tag)}</div>
  ${compactStock && svg ? '' : `<div class="lo">${esc(label.location) || '&nbsp;'}</div>`}
  <div class="si">${esc(label.siteName)}</div>
  ${svg ? `<div class="bcw">${svg}</div>` : ''}
</div>`;
}

function renderSheet(
  cells: string[],
  stock: LabelStock,
  layout: StockLayout,
  options: LabelSheetOptions,
): string {
  const dx = options.offsetXMm ?? 0;
  const dy = options.offsetYMm ?? 0;
  const boxes: string[] = [];

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!cell) continue; // a skipped position on a part-used sheet
    const column = i % stock.columns;
    const row = Math.floor(i / stock.columns);
    const left = layout.leftMarginMm + column * (stock.labelWidthMm + stock.columnGapMm) + dx;
    const top = layout.topMarginMm + row * (stock.labelHeightMm + stock.rowGapMm) + dy;
    boxes.push(
      `<div class="cell${options.showOutlines ? ' out' : ''}" style="left:${round(left)}mm;top:${round(top)}mm">${cell}</div>`,
    );
  }

  return `<div class="sheet">${boxes.join('')}</div>`;
}

function page(sheets: string[], stock: LabelStock, options: LabelSheetOptions): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${stock.pageWidthMm}mm ${stock.pageHeightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #000;
         -webkit-print-color-adjust: exact; }
  .sheet { position: relative; width: ${stock.pageWidthMm}mm; height: ${stock.pageHeightMm}mm;
           page-break-after: always; overflow: hidden; }
  .sheet:last-child { page-break-after: auto; }
  .cell { position: absolute; width: ${stock.labelWidthMm}mm; height: ${stock.labelHeightMm}mm; overflow: hidden; }
  .cell.out { outline: 0.2mm dashed #BBB; outline-offset: -0.1mm; }
  .lb { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-start; }
  .lb > div { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ty { font-size: 6pt; letter-spacing: 0.5pt; text-transform: uppercase; color: #444; line-height: 1.1; }
  .tg { font-family: "Courier New", Courier, monospace; font-weight: 700; letter-spacing: 0.2pt;
        line-height: 1.15; margin-top: 0.4mm; }
  .lo { font-size: 7pt; line-height: 1.15; margin-top: 0.3mm; }
  .si { font-size: 6pt; color: #444; line-height: 1.1; }
  /* The barcode sits on the bottom edge of the label, which is the part least
     likely to be covered when a label is wrapped around a curved extinguisher. */
  .bcw { margin-top: auto; padding-top: 0.6mm; }
  .bc { display: block; }
  </style></head><body>${sheets.join('')}</body></html>`;
}

/**
 * The payload a QR would carry, kept reachable from the export side.
 *
 * Not printed today. Here so that the day a QR renderer is added, the string it
 * encodes is already decided and already tested, rather than being invented at
 * the point of drawing it.
 */
export function labelPayload(tag: string): string | undefined {
  return tagPayload(tag);
}
