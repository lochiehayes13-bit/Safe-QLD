import { buildDataUri } from '@/domain/dataUri';
import { toBase64, utf8Bytes } from './zip';
import type { KeptSignature } from './signatureFile';

/**
 * Keeping a customer's sign-off signature, in a browser.
 *
 * The phone half writes the SVG into document storage. Here that threw on
 * every iPhone: `expo-file-system`'s web build is stubs, and Sign off died on
 * its first `Directory`. So the signature is kept the way the browser keeps a
 * photograph (photoFiles.web.ts), as a base64 `data:` URI that is itself the
 * stored path. The web half of attachmentFiles splits that straight back into
 * base64 for the upload, and a reload cannot leave it pointing at nothing.
 *
 * Base64 and not the `utf8,` form the signature pad hands the PDFs: the
 * upload reader takes only base64, and reports anything else as a missing
 * file rather than guess at a decode.
 */

export type { KeptSignature };

export function keepSignature(_filename: string, svg: string): KeptSignature {
  const bytes = utf8Bytes(svg);
  return { localUri: buildDataUri('image/svg+xml', toBase64(bytes)), sizeBytes: bytes.length };
}
