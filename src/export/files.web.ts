import { buildXlsx } from './xlsx';
import type { Sheet } from './xlsx';
import { safeFileName } from './fileNames';
import { toCsv } from '@/parsers/csv';
import { blobTypeFor, deliveryFor, printableDocument, webShareNotice } from './webFiles';
import { showAlert } from '@/components/alert';

/**
 * Generating paperwork in a browser.
 *
 * The phone writes a file into its own storage and opens the share sheet. A
 * page can do neither — but it can hand the person a file to save, and it can
 * put a document in front of the printer, which on an iPhone is how a PDF
 * reaches Files or a mail. So the same seventeen screens keep calling
 * `writeXlsx` and `writePdf` and `shareFile`, and this is what those mean here.
 *
 * The file itself is held in memory until it is handed over, because there is
 * nowhere else to put it: `uri` is an object URL rather than a path, and the
 * bytes are released when the export list is cleared.
 */

/** Everything generated this session, so Settings can report and release it. */
const held = new Map<string, { blob: Blob; name: string; size: number; html?: string }>();

export interface WrittenFile {
  uri: string;
  name: string;
  size: number;
  /**
   * A PDF the browser will print rather than a file it has written. Set only
   * on the web, and read only by `shareFile` here; the phone never sets it.
   */
  printed?: boolean;
}

function hold(name: string, blob: Blob, html?: string): WrittenFile {
  const uri = URL.createObjectURL(blob);
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

/**
 * Lays the report out and keeps it, ready for the printer.
 *
 * Nothing is put on screen here. A print dialogue that opens while the app is
 * still working reads as the app having finished, and several screens do more
 * after this returns — so the dialogue waits for `shareFile`, which is the
 * moment the phone build opens its share sheet.
 */
export async function writePdf(baseName: string, html: string): Promise<WrittenFile> {
  const name = `${safeFileName(baseName)}.pdf`;
  const document_ = printableDocument(safeFileName(baseName), html);
  const file = hold(name, new Blob([document_], { type: 'text/html;charset=utf-8' }), document_);
  return { ...file, printed: true };
}

/**
 * Hands the file to the person: the printer for a PDF, the browser's own
 * download for anything else.
 *
 * Returns false only where the browser refuses outright, which is what the
 * callers already say something about.
 */
export async function shareFile(file: WrittenFile, dialogTitle?: string): Promise<boolean> {
  const entry = held.get(file.uri);
  if (!entry) return false;

  if (deliveryFor(file.name) === 'print' && entry.html) return printHtml(entry.html, document as unknown as PrintDocument);

  try {
    const link = document.createElement('a');
    link.href = file.uri;
    link.download = file.name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // A phone opens a share sheet, which is unmistakable. A browser download is
    // a badge in a corner that an iPhone shows for a second, so the app says
    // where the file went rather than leaving somebody wondering whether the
    // button worked. Print says nothing: the dialogue is the whole screen.
    const notice = webShareNotice(file.name);
    showAlert(notice.title, notice.body);
    return true;
  } catch {
    return false;
  }
  // `dialogTitle` has no counterpart in a browser: the file name is what the
  // person sees. Named in the signature so the callers stay identical.
  void dialogTitle;
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
    URL.revokeObjectURL(uri);
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
