/**
 * v10 — client quotes.
 *
 * The document that wins the rectification work. Everything it needs already
 * exists in the database — coded defects that know their own quote lines, and a
 * rate card — but nothing joined them, so the priced version of a defect list
 * was being typed into an email and lost.
 *
 * Its own tables rather than columns on the defect. A quote is a document with
 * a life of its own: it is issued, it holds good for a period, it is accepted
 * or it is not, and none of that belongs on the defect that prompted it. A
 * defect rectified last year must not be able to change a quote a client is
 * holding.
 *
 * There are deliberately no cost columns anywhere below. The device is told
 * what work sells for and never what it costs Safe QLD, so a phone left in a
 * client's plant room cannot give away a margin.
 */

export const MIGRATION_V10 = `
CREATE TABLE IF NOT EXISTS quote (
  id             TEXT PRIMARY KEY NOT NULL,
  siteId         TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  /* Q-NPWTP-2026-004 — the number the client quotes back down the phone. */
  reference      TEXT NOT NULL DEFAULT '',
  /* The office system's job number, where the work already has one. */
  jobReference   TEXT NOT NULL DEFAULT '',
  clientName     TEXT NOT NULL DEFAULT '',
  /* Denormalised so an issued quote reprints as it was issued, even after the
     site is renamed. The client's copy cannot be edited, so nor can ours. */
  siteName       TEXT NOT NULL DEFAULT '',
  siteAddress    TEXT NOT NULL DEFAULT '',
  contactName    TEXT NOT NULL DEFAULT '',
  preparedBy     TEXT NOT NULL DEFAULT '',
  /* draft | issued | accepted | declined | expired. Only a draft may be edited;
     the transitions are enforced in domain/quote.ts, not here, because a
     refusal has to carry a reason a technician can read. */
  status         TEXT NOT NULL DEFAULT 'draft',
  /* Whole days the price holds good from the issue date. Stored per quote
     rather than read from settings, so changing the standard validity cannot
     retrospectively shorten a quote already with a client. */
  validityDays   INTEGER NOT NULL DEFAULT 30,
  issuedAt       TEXT,
  /* Queensland calendar date, computed on issue at UTC+10. The last day the
     quote can be accepted, not the first day it is dead. */
  expiresAt      TEXT,
  acceptedAt     TEXT,
  /* Who accepted it, because "the client accepted" is not a defence. */
  acceptedBy     TEXT,
  declinedAt     TEXT,
  /* Whole cents off the work, never a percentage. A percentage of a subtotal
     lands on a fraction of a cent, and the quote and the invoice then disagree
     by however each of them rounded. */
  discountCents  INTEGER NOT NULL DEFAULT 0,
  discountReason TEXT NOT NULL DEFAULT '',
  /* Defects that produced no priced work, as JSON, recorded when the quote was
     built. Kept here rather than recomputed: an issued quote has to be able to
     say what it left out even after those defects are cleared. */
  unpriceable    TEXT NOT NULL DEFAULT '[]',
  scopeNote      TEXT NOT NULL DEFAULT '',
  /* JSON array. What the price does not cover — printed, because an unstated
     exclusion is an argument on the day. */
  exclusions     TEXT NOT NULL DEFAULT '[]',
  notes          TEXT NOT NULL DEFAULT '',
  /* GST as a fraction at the time of issue. Held per quote so a historic quote
     reprints at the rate it was issued under rather than today's. */
  taxRate        REAL NOT NULL DEFAULT 0.1,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_site ON quote(siteId, status, issuedAt);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_reference ON quote(reference) WHERE reference <> '';

CREATE TABLE IF NOT EXISTS quote_line (
  id            TEXT PRIMARY KEY NOT NULL,
  quoteId       TEXT NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  /* materials | labour. They print as separate sections because that is how a
     client reads a quote and how they query one. */
  section       TEXT NOT NULL,
  sortIndex     INTEGER NOT NULL DEFAULT 0,
  description   TEXT NOT NULL DEFAULT '',
  /* ea | hr | m | lot, from the defect library's own quote item. */
  unit          TEXT NOT NULL DEFAULT 'ea',
  /* REAL because labour is quoted in quarter hours. Money never is. */
  quantity      REAL NOT NULL DEFAULT 0,
  /* Whole cents excluding GST, or NULL where nothing has priced this line.
     NULL is a state the document prints as "not priced" and the totals leave
     out. It is not zero, and no read path may turn it into zero: zero on a
     quote reads as included at no charge, and a client may read it that way. */
  unitCents     INTEGER,
  /* Where unitCents came from: office | settings | entered | catalogue.
     A figure on a quote that cannot be traced cannot be defended when the
     client asks how it was arrived at. */
  sourceKind    TEXT,
  sourceLabel   TEXT,
  sourceUrl     TEXT,
  /* high | medium | low. A price typed on a phone on site is not the same
     quality of fact as a rate pulled from the office system. */
  sourceConf    TEXT,
  /* Comma-separated defect codes behind the line, so a client query on one line
     can be traced back to the defects that produced it. */
  fromCodes     TEXT NOT NULL DEFAULT '',
  defectCount   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_line_quote ON quote_line(quoteId, section, sortIndex);
`;
