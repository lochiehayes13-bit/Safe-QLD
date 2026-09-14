import { newId, nowIso } from '@/db';
import {
  configByFingerprint, configBytes, deleteConfigFile, getConfigFile,
  saveConfigWithBytes, touchConfigFile,
} from '@/db/configRepo';
import {
  classifyBytes, importTabular, previewTabular, type PanelParser,
} from '@/parsers';
import { probeFile } from '@/parsers/probe';
import { decodePack, PackError } from '@/share/pack';
import {
  emptySummary, extensionOf, fingerprint, summarise, type ConfigFileRecord,
} from '@/domain/configLibrary';
import type { ParsedConfig } from '@/domain/types';

/**
 * Opening a configuration without importing it.
 *
 * The whole point of the Config Explorer is in this file: reading a vendor
 * file changes nothing. The bytes are kept, the contents are worked out, and
 * not one row is written into a site until somebody presses the button that
 * does that. Every other path into this app that touches a panel file commits
 * it on the way in.
 *
 * A file is read afresh on every open rather than once at import. That costs a
 * parse — milliseconds on a building's configuration — and buys the thing that
 * makes a library worth keeping: a parser improved in a later build gives a
 * better answer for a file opened months ago. Four of the seven parsers in
 * this app have been corrected since they were written, and every file read
 * under the old ones would still be showing the old answer.
 */

/** What the app can say about a file it has been handed. */
export interface OpenedConfig {
  record: ConfigFileRecord;
  /** The configuration as this build reads it. */
  parsed?: ParsedConfig;
  /**
   * Why there is no `parsed`, in a sentence for a technician.
   *
   * Always present when `parsed` is not, because a config screen with nothing
   * on it and no reason is indistinguishable from a config with nothing in it.
   */
  unreadable?: string;
  /** The catalogue entry that recognised the file, where one did. */
  parser?: PanelParser;
  /**
   * The file itself.
   *
   * Carried alongside the parse because the Explorer has two views of every
   * configuration and they must be of the same bytes: what the parser made of
   * it, and what is actually in the container. Reading the blob a second time
   * for the second view would be a second chance to disagree.
   *
   * Absent only where the row has lost its bytes.
   */
  bytes?: Uint8Array;
  /** True when these exact bytes were already in the library. */
  wasAlreadyOpen: boolean;
}

/** A file the Explorer will not take, with the reason a screen shows. */
export class NotAConfigError extends Error {}

interface ReadResult {
  parsed?: ParsedConfig;
  unreadable?: string;
  parser?: PanelParser;
}

/**
 * Works out what a file holds, without touching the database.
 *
 * Kept separate so re-opening a stored file runs the identical path a fresh
 * one does. Two code paths for "read this config" is how a library ends up
 * disagreeing with itself about a file it is holding.
 */
export function readConfigBytes(fileName: string, bytes: Uint8Array): ReadResult {
  const kind = classifyBytes(fileName, bytes);

  if (kind.kind === 'register') {
    // An asset register is the office's book of work, not a panel's
    // programming. Importing one is a different screen and a different
    // outcome, and letting it in here would put nine hundred sites into
    // something called a config.
    throw new NotAConfigError(
      'That is an asset register from the office system, not a panel configuration. '
      + 'Import brings one of those in.',
    );
  }

  if (kind.kind === 'pack') {
    try {
      const pack = decodePack(bytes);
      return { parsed: pack.config };
    } catch (e) {
      return {
        unreadable: e instanceof PackError || e instanceof Error
          ? e.message
          : 'The share pack could not be opened.',
      };
    }
  }

  if (kind.kind === 'unreadable' && kind.parser) {
    return {
      parser: kind.parser,
      unreadable: [kind.parser.limitation, kind.parser.howToExport].filter(Boolean).join(' '),
    };
  }

  try {
    if (kind.kind === 'native-binary' && kind.parser?.parseBytes) {
      return { parsed: kind.parser.parseBytes(bytes, fileName), parser: kind.parser };
    }
    if (kind.kind === 'native' && kind.parser?.parse) {
      return { parsed: kind.parser.parse(decodeText(bytes), fileName), parser: kind.parser };
    }
    if (kind.kind === 'tabular') {
      return { parsed: readTabular(decodeText(bytes), fileName) };
    }
  } catch (e) {
    /*
     * A parser that threw is a fact about this file, not a failure of the
     * app, and the file is still worth keeping: the structure view below reads
     * the container without going through any parser at all, and a file that
     * broke a parser is the one most worth being able to look inside.
     */
    return {
      parser: kind.parser,
      unreadable: `The ${kind.parser?.brandLabel ?? 'file'} reader could not finish: `
        + `${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Nothing recognised it. The probe says what it appears to be, which is more
  // use than "unsupported" to the person holding the only copy.
  const probe = probeFile(bytes);
  return { unreadable: `${probe.containerNote} ${probe.assessment}` };
}

/**
 * A delimited export, read with the columns matched automatically.
 *
 * The Import screen asks a technician to confirm the mapping before writing
 * anything, and it is right to: a wrong column there puts wrong device text
 * into the register permanently. Here nothing is written, so the guess stands
 * on its own — and the structure view shows the file's real columns beside it,
 * which is a better check than a screen of chips.
 */
function readTabular(text: string, fileName: string): ParsedConfig {
  const preview = previewTabular(text);
  if (!preview.totalRows) {
    throw new Error('The file had no readable rows.');
  }
  return importTabular(text, {
    panelName: fileName.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imported panel',
    brand: 'other',
    mapping: preview.mapping,
    hasHeader: preview.hasHeader,
  });
}

/** Text from bytes, tolerating whatever encoding the vendor tool used. */
function decodeText(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * Takes a file into the library and says what is in it.
 *
 * A file already held is not stored twice. It is the same bytes — the
 * fingerprint is over every one of them — so a second copy would be a second
 * row describing the same thing, and the comparison screen would offer a
 * technician the choice of comparing a file with itself.
 */
export async function openConfig(fileName: string, bytes: Uint8Array): Promise<OpenedConfig> {
  const print = fingerprint(bytes);
  const read = readConfigBytes(fileName, bytes);
  const summary = read.parsed
    ? summarise(read.parsed)
    : emptySummary(read.unreadable ? [read.unreadable] : []);

  const existing = await configByFingerprint(print);
  if (existing) {
    const at = nowIso();
    await touchConfigFile(existing.id, summary, at);
    return {
      record: { ...existing, summary, lastOpenedAt: at },
      parsed: read.parsed,
      unreadable: read.unreadable,
      parser: read.parser,
      bytes,
      wasAlreadyOpen: true,
    };
  }

  const at = nowIso();
  const record: ConfigFileRecord = {
    id: newId(),
    fileName,
    byteLength: bytes.length,
    fingerprint: print,
    parserId: read.parser?.id,
    brand: read.parsed?.brand ?? read.parser?.brand ?? 'other',
    model: read.parsed?.model,
    siteNameInFile: read.parsed?.siteName?.trim() || undefined,
    openedAt: at,
    lastOpenedAt: at,
    summary,
  };
  await saveConfigWithBytes(record, bytes);

  return {
    record, parsed: read.parsed, unreadable: read.unreadable, parser: read.parser, bytes, wasAlreadyOpen: false,
  };
}

/**
 * Reads a config already in the library, from its bytes.
 *
 * Returns nothing where the row is gone. Where the row is there and the bytes
 * are not — which should not happen, since they are written in one transaction
 * and deleted by a cascade — the record comes back saying so rather than as a
 * config with nothing in it.
 */
export async function reopenConfig(id: string): Promise<OpenedConfig | undefined> {
  const record = await getConfigFile(id);
  if (!record) return undefined;

  const bytes = await configBytes(id);
  if (!bytes) {
    return {
      record,
      unreadable: 'The file itself is no longer on this phone. Open it again from wherever you got it.',
      wasAlreadyOpen: true,
    };
  }

  const read = readConfigBytes(record.fileName, bytes);
  const summary = read.parsed
    ? summarise(read.parsed)
    : emptySummary(read.unreadable ? [read.unreadable] : []);
  await touchConfigFile(id, summary);

  return {
    record: { ...record, summary },
    parsed: read.parsed,
    unreadable: read.unreadable,
    parser: read.parser,
    bytes,
    wasAlreadyOpen: true,
  };
}

/** Removes a config from the library. The bytes go with it. */
export async function forgetConfig(id: string): Promise<void> {
  await deleteConfigFile(id);
}

/** The name a stored config's bytes would have on disk, for a share or a save. */
export function downloadNameFor(record: ConfigFileRecord): string {
  const ext = extensionOf(record.fileName);
  const base = ext ? record.fileName.slice(0, -ext.length) : record.fileName;
  return `${base.replace(/[\\/:*?"<>|]/g, '-').trim() || 'configuration'}${ext}`;
}
