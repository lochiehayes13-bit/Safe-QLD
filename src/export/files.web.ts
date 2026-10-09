import { buildXlsx } from './xlsx';
import type { Sheet } from './xlsx';
import { safeFileName } from './fileNames';
import { toCsv } from '@/parsers/csv';
import { blobTypeFor, deliveryFor, printableDocument, readyHint, webShareNotice } from './webFiles';
import { rasterPdfFromHtml } from './rasterPdf.web';
import { readyChoices, showReadySheet } from './readySheet.web';
import { showAlert } from '@/components/alert';

/**
 * Generating paperwork in a browser.
 *
 * The phone writes a file into its own storage and opens the share sheet. A
 * page can do neither directly — but it can make the file, hand it to the
 * person to save, open the operating system's own share sheet with it, and put
 * a document in front of the printer. So the same seventeen screens keep
 * calling `writeXlsx` and `writePdf` and `shareFile`, and this is what those
 * mean here.
 *
 * A PDF is a real file now. It used to be the printer: a browser has no PDF
 * writer, and the print dialogue was the one way from a page to a PDF, so
 * `writePdf` held the HTML and `shareFile` printed it. On a desktop that is
 * "Save as PDF" and tolerable. On an iPhone it is a preview that becomes a file
 * only if the person knows to pinch it, and in an app added to the home screen
 * it is nothing — `window.print()` does not open there. Chris pressed Produce
 * PDF on a Form 72, got nothing, and had to be told the pinch by an assistant.
 * And because there were never any bytes, nothing could be queued onto the
 * Simpro job from a browser, which is where he wanted it to go.
 *
 * So the document is laid out in a hidden frame, cut into pages by its own
 * break rules, rasterised and written as a PDF (rasterPdf.web.ts), and what
 * comes back is a file: shareable, saveable, attachable. The printer is kept
 * as the fallback for a browser that cannot rasterise, and as a choice on the
 * sheet for anyone who wants the vector copy.
 *
 * The file itself is held in memory until it is handed over, because there is
 * nowhere else to put it. A PDF's `uri` is a `data:` URI rather than an object
 * URL, because the attachment queue stores the uri in the database and reads
 * it back after a reload — and an object URL is gone the moment the page is.
 * Everything else keeps an object URL, which is lighter and is only ever read
 * in the same session.
 */

/** Everything generated this session, so Settings can report and release it. */
const held = new Map<string, { blob: Blob; name: string; size: number; html?: string }>();

export interface WrittenFile {
  uri: string;
  name: string;
  size: number;
  /**
   * A PDF the browser will print rather than a file it has written. Set only
   * on the web, only where the page could not be rasterised, and read only by
   * `shareFile` here and by the screens that would have queued the file; the
   * phone never sets it.
   */
  printed?: boolean;
}

function hold(name: string, blob: Blob, html?: string, uri = URL.createObjectURL(blob)): WrittenFile {
  held.set(uri, { blob, name, size: blob.size, html });
  return { uri, name, size: blob.size };
}

function writeBytes(fileName: string, bytes: Uint8Array): WrittenFile {
  // A fresh copy of the bytes: the Blob must own its buffer, and the array the
  // caller built may be a view into a larger one.
  return hold(fileName, new Blob([bytes.slice()], { type: blobTypeFor(fileName) }));
}

function writeText(fileName: string, text: string): WrittenFile {
  return hold(fileName, new Blob([text], { type: blobTypeFor(fileName) }));
}

export function writeXlsx(baseName: string, sheets: Sheet[]): WrittenFile {
  return writeBytes(`${safeFileName(baseName)}.xlsx`, buildXlsx(sheets));
}

export function writeCsv(baseName: string, rows: (string | number | null | undefined)[][]): WrittenFile {
  // The BOM makes Excel open UTF-8 CSV correctly instead of mangling accents.
  return writeText(`${safeFileName(baseName)}.csv`, '﻿' + toCsv(rows));
}

export function writePack(baseName: string, bytes: Uint8Array): WrittenFile {
  return writeBytes(`${safeFileName(baseName)}.sqld`, bytes);
}

/** A Blob as a `data:` URI, through the browser's own encoder rather than a string built by hand. */
function dataUriOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read back.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Lays the document out and writes it as a PDF.
 *
 * Where the browser cannot rasterise it — no canvas, a frame it will not lay
 * out, a page too big for the device — the HTML is kept for the printer
 * instead and the file says so with `printed`, which is what every screen
 * already knows how to say something about. The one thing this never does is
 * fail silently: a thrown layout error is caught here precisely so the
 * technician gets the printer rather than nothing.
 */
export async function writePdf(baseName: string, html: string): Promise<WrittenFile> {
  const safe = safeFileName(baseName);
  const name = `${safe}.pdf`;
  const document_ = printableDocument(safe, html);
  try {
    const { bytes } = await rasterPdfFromHtml(document_, { title: safe });
    // A copy, so the Blob owns its buffer — the same reason writeBytes copies.
    const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
    return hold(name, blob, document_, await dataUriOf(blob));
  } catch {
    const file = hold(name, new Blob([document_], { type: 'text/html;charset=utf-8' }), document_);
    return { ...file, printed: true };
  }
}

/** The browser's share sheet, where it takes files. */
type FileSharer = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

function fileSharer(file: File): FileSharer | null {
  if (typeof navigator === 'undefined') return null;
  const n = navigator as FileSharer;
  if (typeof n.share !== 'function' || typeof n.canShare !== 'function') return null;
  try {
    return n.canShare({ files: [file] }) ? n : null;
  } catch {
    return null;
  }
}

/** The browser's own download, which is a badge in a corner, so it is said out loud afterwards. */
function download(uri: string, name: string): void {
  const link = document.createElement('a');
  link.href = uri;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  const notice = webShareNotice(name, 'download');
  showAlert(notice.title, notice.body);
}

/**
 * Offers a finished PDF: share where the browser can, save anywhere, print
 * where the document can be printed.
 *
 * A sheet of real buttons rather than an immediate `navigator.share`, because
 * a share has to run inside a tap and the tap that asked for the file expired
 * while the pages were being drawn. Each button's own tap is the gesture the
 * browser wants. `sendTo` names where the file should go, for the hint.
 */
export function offerPdf(file: WrittenFile, options: { title?: string; sendTo?: string; text?: string } = {}): boolean {
  const entry = held.get(file.uri);
  if (!entry) return false;
  const asFile = new File([entry.blob], entry.name, { type: 'application/pdf' });
  const sharer = fileSharer(asFile);
  const choices = readyChoices({
    canShare: !!sharer,
    canPrint: !!entry.html,
    share: async () => {
      try {
        await sharer!.share!({ files: [asFile], title: options.title ?? entry.name, text: options.text });
      } catch (e) {
        // Dismissing the sheet is a person changing their mind, and the
        // offer stays up for them. Anything else is the browser refusing,
        // and the file goes to the downloads so it is not lost.
        if ((e as { name?: string }).name === 'AbortError') throw e;
        download(file.uri, entry.name);
      }
    },
    save: () => download(file.uri, entry.name),
    print: () => { if (entry.html) printHtml(entry.html, document as unknown as PrintDocument); },
  });
  showReadySheet({
    title: `${entry.name} is ready`,
    hint: readyHint({ canShare: !!sharer, sendTo: options.sendTo }),
    choices,
  });
  return true;
}

/**
 * Hands the file to the person: the sheet of choices for a PDF, the printer
 * for a PDF that could not be written, the browser's own download for
 * anything else.
 *
 * Returns false only where the browser refuses outright, which is what the
 * callers already say something about.
 */
export async function shareFile(file: WrittenFile, dialogTitle?: string): Promise<boolean> {
  const entry = held.get(file.uri);
  if (!entry) return false;

  if (file.printed && entry.html) {
    const opened = printHtml(entry.html, document as unknown as PrintDocument);
    if (opened) {
      const notice = webShareNotice(file.name, 'print');
      showAlert(notice.title, notice.body);
    }
    return opened;
  }
  if (deliveryFor(file.name) === 'offer') return offerPdf(file, { title: dialogTitle });

  try {
    download(file.uri, file.name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Just enough of a document to make an iframe and print it, so the one piece
 * of this file that cannot be reasoned about — does the browser actually put a
 * dialogue on the screen — can be exercised without a browser.
 */
export interface PrintFrame {
  setAttribute: (name: string, value: string) => void;
  style: { cssText: string };
  srcdoc: string;
  onload: (() => void) | null;
  contentWindow: { focus: () => void; print: () => void } | null;
  remove: () => void;
}

export interface PrintDocument {
  createElement: (tag: string) => PrintFrame;
  body: { appendChild: (frame: PrintFrame) => void };
}

/**
 * Prints a document without leaving the app.
 *
 * A hidden iframe rather than a new window, because a window opened after an
 * await is a pop-up as far as the browser is concerned and is blocked without
 * a word — and being blocked silently is the fault this whole pass exists to
 * remove.
 */
export function printHtml(html: string, doc: PrintDocument): boolean {
  try {
    const frame = doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
    frame.srcdoc = html;
    frame.onload = () => {
      const view = frame.contentWindow;
      if (!view) return;
      view.focus();
      view.print();
      // Left in place until the dialogue is done with it: removing the frame
      // while the browser is still laying the document out prints a blank
      // page. A minute is longer than any dialogue and shorter than a session.
      setTimeout(() => frame.remove(), 60_000);
    };
    doc.body.appendChild(frame);
    return true;
  } catch {
    return false;
  }
}

/** Releases everything generated this session. */
export function clearExports(): number {
  let n = 0;
  for (const uri of held.keys()) {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    n++;
  }
  held.clear();
  return n;
}

/** What those files come to, for the storage line in Settings. */
export function exportsSize(): number {
  let total = 0;
  for (const entry of held.values()) total += entry.size;
  return total;
}
