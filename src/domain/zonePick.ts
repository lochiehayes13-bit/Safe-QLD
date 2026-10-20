import type { Zone } from '@/domain/types';

/**
 * Finding a zone to hang a cause and effect rule on.
 *
 * The picker used to draw the first sixty zones as chips, so zone 61 and up
 * on a large panel could not be picked at all. This searches every zone by
 * number or by its programmed text and returns the best few.
 */

export type ZoneLike = Pick<Zone, 'number' | 'text'> & { text2?: string | null };

export interface ZoneMatches<T> {
  /** The zones to draw, best first, no more than the limit. */
  rows: T[];
  /** How many zones matched in all, so a cut list can say so. */
  matching: number;
}

/**
 * Searches zones by number or text.
 *
 * A number puts the exact zone first, then zones whose number starts with it,
 * then zones whose text holds it ("Level 3"). "Zone 12" and "z12" read as 12.
 * Words must all appear in the number or either line of text, in any order and
 * any case. An empty search returns the lowest-numbered zones.
 */
export function searchZones<T extends ZoneLike>(
  zones: readonly T[],
  query: string,
  limit: number,
): ZoneMatches<T> {
  const byNumber = [...zones].sort((a, b) => a.number - b.number);
  const q = query.trim().toLowerCase().replace(/^z(?:one)?\s*(?=\d)/, '');
  if (!q) return { rows: byNumber.slice(0, Math.max(0, limit)), matching: byNumber.length };

  const words = q.split(/\s+/).filter(Boolean);
  const ranked: { zone: T; rank: number }[] = [];
  for (const zone of byNumber) {
    const num = String(zone.number);
    const haystack = `${num} ${zone.text ?? ''} ${zone.text2 ?? ''}`.toLowerCase();
    let rank: number | undefined;
    if (/^\d+$/.test(q) && num === q) rank = 0;
    else if (/^\d+$/.test(q) && num.startsWith(q)) rank = 1;
    else if (words.every((w) => haystack.includes(w))) rank = 2;
    if (rank !== undefined) ranked.push({ zone, rank });
  }
  // Stable within a rank, so zones stay in number order.
  ranked.sort((a, b) => a.rank - b.rank);
  return {
    rows: ranked.slice(0, Math.max(0, limit)).map((r) => r.zone),
    matching: ranked.length,
  };
}
