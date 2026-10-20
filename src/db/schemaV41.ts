/**
 * Schema v41 — the unpaid break a timesheet was submitted with.
 *
 * The break comes off long days as the sheet is shown and exported, from the
 * setting. Without this, turning the setting on would change the totals of
 * weeks payroll already has. Null on drafts, which follow the setting, and on
 * every sheet submitted before this migration, which had no break taken.
 */
export const MIGRATION_V41 = `
  ALTER TABLE timesheet ADD COLUMN unpaidBreakMinutes INTEGER;
`;
