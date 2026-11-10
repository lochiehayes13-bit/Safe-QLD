/**
 * Schema v40 — the scope of works, kept with the quote.
 *
 * The quote builder printed the scope from the defects on screen and stored
 * only the priced lines, so reprinting a quote from the quote list printed
 * "No scope items were recorded against this quotation" over a page of priced
 * work. The client's second copy disagreed with the first.
 *
 * JSON, one { location, text } per line, written when the quote is saved.
 * '[]' for every quote saved before this migration; those reprint with a scope
 * rebuilt from the defect codes on their lines (domain/quote.ts,
 * scopeForReprint). Nothing older is rewritten.
 */
export const MIGRATION_V40 = `
  ALTER TABLE quote ADD COLUMN scope TEXT NOT NULL DEFAULT '[]';
`;
