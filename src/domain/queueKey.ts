/**
 * A content key for a queued piece of outbound work.
 *
 * The queue used to identify an item only by a local row id, which changes on
 * every reinstall and says nothing about what the item is. Two things go
 * wrong without a key: the same note or order queued twice (a double tap, a
 * screen that re-queues on focus) posts twice, and a retry after a timeout
 * that the server had actually accepted posts again. The key is derived from
 * the content, so the same work has the same key on every phone and after
 * every reinstall, and it is written into the posted text as a marker so the
 * office system itself carries the evidence that it was sent.
 *
 * FNV-1a over the canonical JSON, 64 bits split across two 32-bit lanes,
 * because JavaScript has no 64-bit integer arithmetic worth trusting on a
 * phone and a cryptographic hash would be theatre here: the only party that
 * could forge a collision is this app.
 */

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

function fnv1a32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function queueKey(kind: string, payload: unknown): string {
  const text = `${kind}|${canonical(payload)}`;
  const a = fnv1a32(text, 0x811c9dc5);
  const b = fnv1a32(text, 0x9747b28c);
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** The marker written into what is posted, so the office record itself says this was sent. */
export function markerFor(key: string): string {
  return `[SQ-REF:${key}]`;
}

export function hasMarker(text: string | undefined | null, key: string): boolean {
  return !!text && text.includes(markerFor(key));
}

/** Appends the marker to a note or comment, on its own line, once. */
export function withMarker(text: string | undefined, key: string): string {
  const body = (text ?? '').trimEnd();
  if (hasMarker(body, key)) return body;
  return body ? `${body}\n${markerFor(key)}` : markerFor(key);
}
