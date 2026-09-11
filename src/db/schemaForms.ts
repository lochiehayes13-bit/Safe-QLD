/**
 * Schema v19 — the forms, hung off the asset register.
 *
 * The office's sites and their equipment come from Simpro's customer assets
 * and land in `asset`. The service report's test sheet was written earlier,
 * for panel configuration imports, and only ever read `point` — so on a
 * Simpro-synced site "add every device" found nothing, and the sheet stayed
 * blank on every one of the office's three thousand sites.
 *
 * A test row can now point at the asset it was tested against, which is what
 * lets a result marked on the sheet be written back onto the asset's timeline
 * and its last-result column, the way a routine run already does. The type
 * label is denormalised beside it for the same reason the point columns are:
 * a report stays readable after the register it came from has been re-synced
 * or the asset retired, and the printed Type column has something to say for
 * an extinguisher, which the panel vocabulary has no word for.
 *
 * The report gains the four things the customer's own report leads with and
 * this one never carried: their job number, who the customer is, and the site
 * contact. Worked out from the Simpro mirror where it is unambiguous, typed
 * where it is not, and stored on the report so a PDF made on a later visit
 * says the same thing as the one made on the day.
 */
export const MIGRATION_V19 = `
ALTER TABLE test_row ADD COLUMN assetId TEXT;
ALTER TABLE test_row ADD COLUMN assetType TEXT;
CREATE INDEX IF NOT EXISTS idx_testrow_asset ON test_row(assetId);

ALTER TABLE report ADD COLUMN jobNumber TEXT;
ALTER TABLE report ADD COLUMN customerName TEXT;
ALTER TABLE report ADD COLUMN siteContactName TEXT;
ALTER TABLE report ADD COLUMN siteContactPhone TEXT;
`;
