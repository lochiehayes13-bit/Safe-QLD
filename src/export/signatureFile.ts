import { Directory, File, Paths } from 'expo-file-system';
import { PHOTO_DIR, photoPath } from '@/domain/photoStore';
import { utf8Bytes } from './zip';

/**
 * Keeping a customer's sign-off signature until it goes to Simpro, on a phone.
 *
 * Written to document storage beside the photographs, so it survives a cache
 * clear and the upload reads it by the same relative path a photograph is
 * read by (src/simpro/attachmentFiles.ts). The browser has no file system and
 * keeps it as a `data:` URI instead: see signatureFile.web.ts.
 */

export interface KeptSignature {
  /** What the queued attachment points at: `photos/…` here, a `data:` URI in a browser. */
  localUri: string;
  sizeBytes: number;
}

export function keepSignature(filename: string, svg: string): KeptSignature {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const stored = filename.replace(/[^A-Za-z0-9 ._-]/g, '_');
  const file = new File(dir, stored);
  if (file.exists) file.delete();
  file.create();
  file.write(svg);
  return { localUri: photoPath(stored), sizeBytes: utf8Bytes(svg).length };
}
