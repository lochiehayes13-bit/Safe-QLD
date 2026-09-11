/**
 * Reading Simpro's "oAuth2 Details" page back into a connection.
 *
 * When somebody makes an API key in Simpro, the build hands them a block of
 * text — a token URL, a client_id, a client_secret, the grant type — and
 * that block is what actually gets emailed around and pasted into a note.
 * Setting this app up meant reading it with one eye and typing four fields
 * with the other, and the field that goes wrong is always the secret: it is
 * the longest, the least readable, and the one whose failure says nothing
 * more useful than "the office rejected this device".
 *
 * So the block goes in whole and this pulls it apart. It is deliberately
 * forgiving about the shape, because the shape varies: the page copies with
 * the rule lines and the documentation link, an email arrives with the
 * fields quoted, and a phone's clipboard sometimes folds long lines. What it
 * is not forgiving about is guessing — a value it cannot find is left alone
 * rather than filled with something plausible, and a field the block does
 * not mention never overwrites one already set.
 *
 * Pure: no keystore, no network, no preferences. Where the secret ends up is
 * ./client's business, and it goes to the keystore, never to prefs.
 */

export interface PastedConnection {
  /** The build's host, e.g. `safeqld.simprosuite.com`, taken from the token URL. */
  domain?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface PastedConnectionRead {
  found: PastedConnection;
  /** What was recognised, in the order a person reads it. For the confirmation. */
  fields: string[];
  /** Why nothing was taken, when nothing was. */
  problem?: string;
}

/**
 * A field's value out of `name: value`, `name = value` or `name value`.
 *
 * The name is matched at a line start so that the documentation link at the
 * top of Simpro's page — which contains the words "client" and "id" inside a
 * query string — cannot be read as a client_id. Surrounding quotes, commas
 * and semicolons come off, because the block gets pasted out of JSON and out
 * of a spreadsheet as often as out of the page itself.
 */
function field(text: string, ...names: string[]): string | undefined {
  for (const name of names) {
    // The name itself is written here as plain words — "client id" — and the
    // separator between them is whatever the paste used: a space, an
    // underscore, a hyphen, or nothing. `"client_id":` out of JSON has a
    // quote between the name and the colon, so that is optional too.
    const loose = name.trim().split(/\s+/).join('[\\s_-]?');
    const pattern = new RegExp(`^[\\s"'*\\-]*${loose}["']?\\s*[:=]?\\s*(.+)$`, 'im');
    const hit = pattern.exec(text);
    const value = hit?.[1]?.trim().replace(/^["'`]+|["'`,;]+$/g, '').trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * The build host out of any Simpro URL in the block.
 *
 * The token URL is the reliable one — `https://<build>.simprosuite.com/oauth2/token`
 * — but a self-hosted build is on its own domain and the same line still
 * carries it. The documentation link is on developer.simprogroup.com and is
 * skipped by name, since taking it would point every request at Simpro's
 * documentation site.
 */
function buildDomain(text: string): string | undefined {
  const urls = text.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
  for (const url of urls) {
    const host = /^https?:\/\/([^/\s:]+)/i.exec(url)?.[1]?.toLowerCase();
    if (!host) continue;
    if (host === 'developer.simprogroup.com' || host.endsWith('.simprogroup.com')) continue;
    if (!/oauth2|token|simprosuite|simpro/i.test(url)) continue;
    return host;
  }
  return undefined;
}

/** A client id or secret is a token, not a sentence: anything with a space in it is prose. */
function credential(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(/\s+/)[0] ?? '';
  return /^[A-Za-z0-9._~+/=-]{6,}$/.test(first) ? first : undefined;
}

/**
 * Read a pasted oAuth2 details block.
 *
 * Nothing is assumed from nothing: an empty paste, or one with no field this
 * recognises, comes back with a `problem` and an empty `found`, so the
 * screen can say what it was looking for instead of silently doing nothing.
 */
export function readPastedConnection(text: string): PastedConnectionRead {
  const body = (text ?? '').replace(/\r\n?/g, '\n');
  if (!body.trim()) {
    return { found: {}, fields: [], problem: 'Nothing was pasted.' };
  }

  const found: PastedConnection = {
    domain: buildDomain(body),
    clientId: credential(field(body, 'client id', 'client key', 'consumer key')),
    clientSecret: credential(field(body, 'client secret', 'consumer secret', 'secret')),
  };

  const fields = [
    found.domain ? 'build domain' : '',
    found.clientId ? 'client ID' : '',
    found.clientSecret ? 'client secret' : '',
  ].filter(Boolean);

  if (!fields.length) {
    return {
      found: {},
      fields: [],
      problem: 'That text has no client ID, client secret or token URL in it. '
        + 'Copy the whole oAuth2 details block from Simpro — System Setup, then API keys — and paste it again.',
    };
  }
  return { found, fields };
}

/** The confirmation, in the order the fields appear on the screen. */
export function describePastedConnection(read: PastedConnectionRead): string {
  if (read.problem) return read.problem;
  const list = read.fields.length === 1
    ? read.fields[0]!
    : `${read.fields.slice(0, -1).join(', ')} and ${read.fields[read.fields.length - 1]}`;
  const secret = read.found.clientSecret
    ? ' The secret went straight to this device’s keystore, not into ordinary storage.'
    : '';
  return `Read the ${list} out of that.${secret}`;
}
