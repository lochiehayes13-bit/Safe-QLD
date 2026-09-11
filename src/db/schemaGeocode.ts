/**
 * Schema v15 — where an address is.
 *
 * The site table has never held a coordinate: sites arrive from the office as
 * text addresses, and the office does not hold coordinates either. The service
 * map needs one for every site it draws, and asking the phone's geocoder for
 * three thousand addresses each time the map opens is neither polite to the
 * platform nor fast enough to be useful.
 *
 * So the answer is cached, keyed by the normalised address rather than the
 * site. Two sites at the same building share one lookup, and a site whose
 * address the office corrects gets a fresh one without anything having to
 * notice. The key is the whole of the identity, which is why it is the primary
 * key and why there is no site id here at all.
 *
 * A miss is recorded too. An address the geocoder cannot place is retried on a
 * schedule rather than on every opening, otherwise the same few unplaceable
 * addresses would soak up the whole budget every time and the sites behind
 * them would never get their turn.
 */

export const MIGRATION_V15 = `
CREATE TABLE IF NOT EXISTS geocode (
  /* The normalised address, as sent to the geocoder. See geo/geocodeKey.ts. */
  key         TEXT PRIMARY KEY NOT NULL,
  latitude    REAL,
  longitude   REAL,
  /* Which geocoder answered, e.g. 'device'. Kept so a later, better source can
     replace a worse one selectively. */
  source      TEXT,
  attemptedAt TEXT NOT NULL,
  /* 1 when the last attempt found nothing, so the retry rule can find it. */
  failed      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_geocode_failed ON geocode(failed, attemptedAt);
`;
