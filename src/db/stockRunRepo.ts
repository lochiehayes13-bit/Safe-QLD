import { listDefects } from './repo';
import { jobsByExternalIds, listStock } from './opsRepo';
import { listScheduleBetween } from './scheduleRepo';
import { buildStockRun, stockRunDays, type StockRun, type StockRunJob } from '@/domain/stockRun';
import { SCHEDULE_DAYS_AHEAD, scheduleWindow } from '@/domain/myDay';
import { nowIso } from './index';

/**
 * Gathering what the stock list needs, and nothing else.
 *
 * Thin on purpose, the way the rest of the repositories are: every decision
 * about the list — which days count, how a site booked twice is counted, what a
 * blank on-hand figure means — lives in `@/domain/stockRun`, which imports no
 * database and is tested on its own. This reads four tables and hands them
 * over.
 *
 * The reads are all bounded by the window rather than by a row limit. A limit
 * would be the wrong shape here: the answer to "what do I need for the next
 * five days" that quietly stops at two hundred defects is not a smaller answer,
 * it is a wrong one, and nothing on the screen would say which parts were left
 * off.
 */

/** Everything on the list, for a horizon in days counted from today. */
export async function loadStockRun(days: number): Promise<StockRun> {
  const asked = stockRunDays(days);
  const window = scheduleWindow(nowIso());

  /*
   * The schedule's reach, taken from the same constant the sync uses rather
   * than from the rows on hand. Reading it off the rows would make an empty
   * diary look like a short window and the list would claim to cover fewer
   * days than it really does — the honest failure is "nothing booked", not
   * "we only know about three days".
   */
  const scheduleCoversTo = window.to;

  const blocks = await listScheduleBetween(window.today, scheduleCoversTo);

  const jobIds = [...new Set(blocks.map((b) => b.jobId).filter((id): id is string => Boolean(id)))];
  const jobRows = jobIds.length ? await jobsByExternalIds(jobIds) : [];
  const jobs = new Map<string, StockRunJob>();
  for (const job of jobRows) {
    if (!job.externalId) continue;
    jobs.set(job.externalId, {
      siteId: job.siteId,
      siteName: job.siteName,
      orderNo: job.orderNo ?? job.externalId,
    });
  }

  /*
   * Defects per building, read only for the buildings actually booked. The
   * register runs to thousands of rows across nine hundred sites and all but a
   * handful of them are irrelevant to this week.
   */
  const siteIds = [...new Set([...jobs.values()].map((j) => j.siteId).filter((id): id is string => Boolean(id)))];
  const defectsBySite = new Map(
    await Promise.all(siteIds.map(async (siteId) => [siteId, await listDefects(siteId, 'open')] as const)),
  );

  const onHand = (await listStock()).map((item) => ({
    description: item.description,
    partNumber: item.partNumber,
    quantity: item.quantity,
  }));

  return buildStockRun({
    today: window.today,
    days: asked,
    scheduleCoversTo,
    blocks: blocks.map((b) => ({ jobId: b.jobId, date: b.date })),
    jobs,
    defectsBySite,
    onHand,
  });
}

/** How far ahead the list can see at all, so a screen can say so before asking. */
export const STOCK_RUN_HORIZON_DAYS = SCHEDULE_DAYS_AHEAD;
