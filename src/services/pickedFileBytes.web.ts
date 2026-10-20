/**
 * The bytes of a file the document picker handed back, in a browser.
 *
 * expo-file-system has no browser half, so `new File(uri).bytes()` throws here.
 * The picker gives a web File alongside the uri; that is read first. A `blob:`
 * or `data:` uri with no File beside it is fetched instead.
 *
 * The shape is the phone half's, imported by the bare name so TypeScript
 * resolves ./pickedFileBytes while Metro takes this file, and nothing from
 * expo-file-system reaches the browser bundle.
 */
import type { PickedFile } from './pickedFileBytes';

export type { PickedFile };

export async function pickedFileBytes(asset: PickedFile): Promise<Uint8Array> {
  if (asset.file) return new Uint8Array(await asset.file.arrayBuffer());
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error(`Couldn't read ${asset.name} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
