/**
 * Schema v21 — the indexes the screens' own queries need.
 *
 * Up to now every list on this app read its whole table and sorted, filtered
 * and searched the rows in JavaScript, so there was nothing for an index to
 * do: the query was always "give me everything". At twenty rows that is
 * invisible. The owner's phone holds 4,562 jobs, 3,059 sites, 12,568 assets
 * and 2,232 invoices, and the job list was reading all four and a half
 * thousand rows on every focus — every time a technician backed out of a job.
 *
 * The filters and the searches are queries now, and these are the indexes
 * those queries search rather than scan. Each one is proved by an
 * `EXPLAIN QUERY PLAN` in src/__tests__/schema.test.ts: an index nothing uses
 * is write cost on every sync for nothing, and this schema has carried one of
 * those before.
 *
 * Two are indexes on expressions rather than on columns, which SQLite has
 * allowed since 3.9 and matches by comparing the parsed expression, not the
 * text. Both expressions are written out in full in `opsRepo`, and the plan
 * tests are what say the two copies still agree.
 *
 *  - **The open-work stage.** "Open" is a stage of nothing, "Pending" or
 *    "Progress", trimmed and lowered so a hand-typed "pending " counts. That
 *    fold is what the Open tab, the Mine tab and the counts on a site and a
 *    customer card all ask for, and it is not a column.
 *
 *  - **The Queensland day a job was issued.** The Today tab asks which jobs
 *    were issued today in Brisbane. Queensland is UTC+10, so that is not the
 *    first ten characters of the stored instant — between midnight and 10am
 *    those are yesterday's, and this company starts at seven.
 */

export const MIGRATION_V21 = `
/* The Open and Mine tabs, and the open-job counts on a site or customer card:
   some six hundred rows out of four and a half thousand. */
CREATE INDEX IF NOT EXISTS idx_job_open_stage
  ON job(LOWER(TRIM(COALESCE(stageRaw, stage, ''))), status);

/* The Today tab's second half: jobs the office issued for today, for a phone
   whose schedule has not synced. Kept as the Queensland day, because that is
   the day the question is asked in. */
CREATE INDEX IF NOT EXISTS idx_job_qld_day ON job(
  CASE
    WHEN scheduledFor GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN scheduledFor
    WHEN scheduledFor GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'
      THEN substr(datetime(scheduledFor, '+10 hours'), 1, 10)
  END
);

/* The Today tab's first half, and the home screen's "what am I on today":
   which job numbers are on the schedule for a day. Covering, so the day's
   blocks are read out of the index without touching the table. */
CREATE INDEX IF NOT EXISTS idx_schedule_day_job ON schedule(date, jobId);

/* Outstanding works across every site, and the badge on the Work tab. The
   existing index leads with the site, which is no help to a question that
   does not name one. Worst first is the order the screen shows them in. */
CREATE INDEX IF NOT EXISTS idx_defect_status ON defect(status, severity, raisedAt DESC);

/* The quote list's Open, Approved, Converted and Closed tabs. */
CREATE INDEX IF NOT EXISTS idx_simpro_quote_open ON simpro_quote(isClosed, jobExternalId);

/* The site list's own order. Without it a page of three hundred sites is a
   sort of all three thousand before the first row can be drawn; with it the
   read walks the index in order and stops. */
CREATE INDEX IF NOT EXISTS idx_site_name ON site(name COLLATE NOCASE);

/* Whether another site is called the same thing. Three of Safe QLD's sites
   are "Storage Choice - Sumner Park" and the register carries no address for
   any of them, so the list says which is which — and it has to be able to say
   it about a row without reading every other site to find out. */
CREATE INDEX IF NOT EXISTS idx_site_name_key ON site(LOWER(TRIM(name)));
`;
