import { File } from 'expo-file-system';

/**
 * The bytes of a file the document picker handed back, on a phone.
 *
 * The picker copies the file into the cache and gives a `file://` uri, which
 * expo-file-system reads directly. The browser build has no file system, so it
 * has its own half (pickedFileBytes.web.ts) that reads the picker's File.
 */

/** The parts of a picker asset either half reads. */
export interface PickedFile {
  uri: string;
  name: string;
  /** The browser's own File, present only on the web. */
  file?: { arrayBuffer(): Promise<ArrayBuffer> };
}

export async function pickedFileBytes(asset: PickedFile): Promise<Uint8Array> {
  return new Uint8Array(await new File(asset.uri).bytes());
}
