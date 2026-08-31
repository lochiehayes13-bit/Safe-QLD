import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildXlsx } from './xlsx';
import type { Sheet } from './xlsx';
import { toCsv } from '@/parsers/csv';

/**
 * Writing and sharing generated files.
 *
 * Everything lands in a Safe QLD folder inside the cache directory: the OS can
 * reclaim it under storage pressure, which is the right trade for exports the
 * tech has already sent on. Anything that must survive lives in SQLite.
 */

const EXPORT_DIR = 'exports';

function exportDir(): Directory {
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Makes a string safe for a filename across Android and iOS.
 *
 * Site names routinely contain slashes and colons ("Level 3 / Plant Room"),
 * which silently break file creation on Android.
 */
export function safeFileName(name: string, fallback = 'export'): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 90);
  return cleaned || fallback;
}

export interface WrittenFile {
  uri: string;
  name: string;
  size: number;
}

function writeBytes(fileName: string, bytes: Uint8Array): WrittenFile {
  const file = new File(exportDir(), fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return { uri: file.uri, name: fileName, size: bytes.length };
}

function writeText(fileName: string, text: string): WrittenFile {
  const file = new File(exportDir(), fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return { uri: file.uri, name: fileName, size: text.length };
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

/** Renders HTML to a PDF and moves it to a meaningful filename. */
export async function writePdf(baseName: string, html: string): Promise<WrittenFile> {
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const src = new File(uri);
  const target = new File(exportDir(), `${safeFileName(baseName)}.pdf`);
  if (target.exists) target.delete();
  // expo-print writes to a temp path with a random name; rename so the share
  // sheet and the recipient's inbox show something readable.
  src.move(target);
  return { uri: target.uri, name: target.name, size: target.size ?? 0 };
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.sqld': 'application/octet-stream',
};

/** Opens the system share sheet for a written file. */
export async function shareFile(file: WrittenFile, dialogTitle?: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const ext = file.name.slice(file.name.lastIndexOf('.'));
  await Sharing.shareAsync(file.uri, {
    mimeType: MIME[ext] ?? 'application/octet-stream',
    dialogTitle: dialogTitle ?? file.name,
    UTI: ext === '.pdf' ? 'com.adobe.pdf' : undefined,
  });
  return true;
}

/** Removes previously generated exports. */
export function clearExports(): number {
  const dir = exportDir();
  const items = dir.list();
  let n = 0;
  for (const item of items) {
    try {
      item.delete();
      n++;
    } catch {
      // A file held open by a share sheet can refuse deletion; skip it.
    }
  }
  return n;
}

/** Total size of generated exports, for the storage line in Settings. */
export function exportsSize(): number {
  let total = 0;
  for (const item of exportDir().list()) {
    if (item instanceof File) total += item.size ?? 0;
  }
  return total;
}
