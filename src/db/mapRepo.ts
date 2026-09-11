import { getDb } from './index';
import { readAllPositions } from './geocodeRepo';
import { siteAddressKey } from '@/geo/geocodeKey';
import {
  isPosition, recentSinceDay, type LatLng, type MapJob, type MapQuote, type MapSite,
} from '@/domain/mapPins';
import type { MatchCustomer } from '@/domain/customerMatch';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * What the map reads, in as few statements as it can.
 *
 * The map wants every site, its position, and enough about its jobs, quotes
 * and invoices to colour it — for three thousand sites, on a phone, every
 * time the tab is opened. Reading the site list and then asking about each
 * site is three thousand round trips; reading every job on the books and
 * sorting them out in JavaScript is four and a half thousand rows for the
 * sake of the few hundred that are live. So the counts are aggregated in one
 * statement, and only the jobs that can still colour a dot are read at all.
 *
 * Nothing here reads an asset. The register is thirteen thousand rows and
 * the map has no use for a single one of them.
 */

export interface MapSiteRow extends MapSite {
  contactName?: string;
  contactMobile?: string;
  contactWorkPhone?: string;
  /** The office's site id, where the site came from the sync. */
  externalId?: string;
  jobsTotal: number;
  /** The most recent job's issue date, yyyy-mm-dd. */
  lastJobAt?: string;
  quotesOpen: number;
  /** Invoices issued inside the recent window that bill this site's jobs. */
  invoicesRecent: number;
}

export interface MapData {
  sites: MapSiteRow[];
  /** Only the jobs that can colour a dot: not finished, or finished inside the recent window. */
  jobs: MapJob[];
  /** Open quotes the sync matched to a local site. */
  quotes: MapQuote[];
  /** Site id → position: the geocode cache first, a job's own coordinates as the fallback. */
  positions: Map<string, LatLng>;
  /** The first day of the recent window, so the screen can say what "recent" meant. */
  sinceDay: string;
  /** The instant the read was taken, for the pin builder's clock. */
  loadedAt: number;
}

interface SiteRow {
  id: string;
  name: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  clientName: string | null;
  contactName: string | null;
  contactMobile: string | null;
  contactWorkPhone: string | null;
  externalId: string | null;
  customerExternalId: string | null;
  customerName: string | null;
  jobsTotal: number | null;
  lastJobAt: string | null;
  jobLatitude: number | null;
  jobLongitude: number | null;
  quotesOpen: number | null;
  invoicesRecent: number | null;
  lastInvoicedAt: string | null;
}

/*
 * One row per site, with the aggregates joined on rather than looked up per
 * row: each subquery scans its table once and groups by site, so the cost is
 * the size of the tables and not their product. The customer subquery keeps a
 * single MAX so SQLite's bare-column rule hands back the customer off the
 * latest job rather than an arbitrary one; the same for the job position.
 *
 * Invoices reach a site through the jobs they bill, and the count is of
 * distinct invoices so one that bills two jobs on the site is one invoice.
 */
const SITES_SQL = `SELECT s.id, s.name, s.address, s.suburb, s.state, s.postcode, s.clientName,
       s.contactName, s.contactMobile, s.contactWorkPhone, s.externalId,
       c.customerExternalId, c.customerName,
       j.jobsTotal, j.lastJobAt,
       p.latitude AS jobLatitude, p.longitude AS jobLongitude,
       q.quotesOpen,
       i.invoicesRecent, i.lastInvoicedAt
FROM site s
LEFT JOIN (
  SELECT siteId, COUNT(*) AS jobsTotal, MAX(scheduledFor) AS lastJobAt
  FROM job WHERE siteId IS NOT NULL GROUP BY siteId
) j ON j.siteId = s.id
LEFT JOIN (
  SELECT siteId, customerExternalId, customerName, MAX(COALESCE(dateModified, updatedAt)) AS latest
  FROM job WHERE siteId IS NOT NULL AND customerExternalId IS NOT NULL GROUP BY siteId
) c ON c.siteId = s.id
LEFT JOIN (
  SELECT siteId, latitude, longitude, MAX(updatedAt) AS latest
  FROM job WHERE siteId IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL GROUP BY siteId
) p ON p.siteId = s.id
LEFT JOIN (
  SELECT siteId, COUNT(*) AS quotesOpen
  FROM simpro_quote WHERE siteId IS NOT NULL AND isClosed = 0 AND jobExternalId IS NULL GROUP BY siteId
) q ON q.siteId = s.id
LEFT JOIN (
  SELECT jb.siteId,
         COUNT(DISTINCT CASE WHEN i.dateIssued >= ? THEN i.externalId END) AS invoicesRecent,
         MAX(i.dateIssued) AS lastInvoicedAt
  FROM invoice i
  JOIN invoice_job ij ON ij.invoiceExternalId = i.externalId
  JOIN job jb ON jb.externalId = ij.jobExternalId
  WHERE jb.siteId IS NOT NULL GROUP BY jb.siteId
) i ON i.siteId = s.id
ORDER BY s.name COLLATE NOCASE`;

interface JobRow {
  id: string;
  externalId: string | null;
  siteId: string | null;
  title: string;
  stage: string | null;
  status: MapJob['status'];
  scheduledFor: string | null;
  scheduledDay: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedDate: string | null;
  updatedAt: string | null;
}

/*
 * The jobs that can still colour a dot. Finished is the same test the pin
 * builder applies — the app's status, or the office's stage — and a finished
 * job is read only where one of its dates falls inside the window. The bound
 * is a day, and an instant compares after its own day, so the boundary day
 * is inside the window whichever shape the date took.
 *
 * The booking comes from the schedule, not the job: the office's job record
 * carries only the day it was issued, and the day a technician is actually
 * going is a block on the schedule against the job number. The earliest
 * block from today on is the one that decides whether the dot is "on now"
 * or "upcoming"; a block already behind us says nothing about the future.
 * The schedule is held for three weeks ahead (see domain/myDay), so a job
 * booked beyond that has no block here and reads as open, which is the
 * honest answer for a phone that does not hold the booking.
 */
const JOBS_SQL = `SELECT j.id, j.externalId, j.siteId, j.title, j.stage, j.status, j.scheduledFor, b.scheduledDay,
       j.dueAt, j.completedAt, j.completedDate, j.updatedAt
FROM job j
LEFT JOIN (
  SELECT jobId, MIN(date) AS scheduledDay FROM schedule WHERE jobId IS NOT NULL AND date >= ? GROUP BY jobId
) b ON b.jobId = j.externalId
WHERE j.siteId IS NOT NULL AND (
  (j.status <> 'complete' AND LOWER(TRIM(COALESCE(j.stage, ''))) NOT IN ('complete', 'completed', 'invoiced'))
  OR COALESCE(j.completedAt, j.completedDate, j.dueAt, j.scheduledFor) >= ?
)`;

interface QuoteRow {
  externalId: string;
  siteId: string | null;
  name: string;
  isClosed: number;
  jobExternalId: string | null;
  dateIssued: string | null;
}

const QUOTES_SQL = `SELECT externalId, siteId, name, isClosed, jobExternalId, dateIssued
FROM simpro_quote
WHERE siteId IS NOT NULL AND isClosed = 0 AND jobExternalId IS NULL`;

const orUndefined = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Everything the map needs, positioned where it can be. */
export async function loadMapData(now: number = Date.now()): Promise<MapData> {
  const db = await getDb();
  const sinceDay = recentSinceDay(now);
  // The Queensland day, so a booking for this morning is today's from
  // midnight and not from ten o'clock, when the UTC date catches up.
  const today = qldIsoDay(new Date(now).toISOString()) ?? '';
  const [siteRows, jobRows, quoteRows, cached] = await Promise.all([
    db.getAllAsync<SiteRow>(SITES_SQL, sinceDay),
    db.getAllAsync<JobRow>(JOBS_SQL, today, sinceDay),
    db.getAllAsync<QuoteRow>(QUOTES_SQL),
    readAllPositions(),
  ]);

  const positions = new Map<string, LatLng>();
  const sites: MapSiteRow[] = siteRows.map((r) => {
    // A geocoded address beats a job's own coordinates where both exist: the
    // address is the site, the coordinates are wherever the job was raised
    // from. The job's position is the fallback for a site the cache has not
    // reached yet, and it counts as located so the geocoder skips it.
    const key = siteAddressKey(r);
    const cachedPosition = key ? cached.get(key) : undefined;
    if (cachedPosition) positions.set(r.id, cachedPosition);
    else if (isPosition(r.jobLatitude, r.jobLongitude)) {
      positions.set(r.id, { latitude: r.jobLatitude!, longitude: r.jobLongitude! });
    }
    return {
      id: r.id,
      name: r.name,
      address: orUndefined(r.address),
      suburb: orUndefined(r.suburb),
      state: orUndefined(r.state),
      postcode: orUndefined(r.postcode),
      clientName: orUndefined(r.clientName),
      contactName: orUndefined(r.contactName),
      contactMobile: orUndefined(r.contactMobile),
      contactWorkPhone: orUndefined(r.contactWorkPhone),
      externalId: orUndefined(r.externalId),
      customerExternalId: orUndefined(r.customerExternalId),
      customerName: orUndefined(r.customerName),
      lastInvoicedAt: orUndefined(r.lastInvoicedAt),
      jobsTotal: r.jobsTotal ?? 0,
      lastJobAt: orUndefined(r.lastJobAt),
      quotesOpen: r.quotesOpen ?? 0,
      invoicesRecent: r.invoicesRecent ?? 0,
    };
  });

  const jobs: MapJob[] = jobRows.map((r) => ({
    id: r.id,
    externalId: orUndefined(r.externalId),
    siteId: orUndefined(r.siteId),
    title: r.title,
    stage: orUndefined(r.stage),
    status: r.status,
    scheduledFor: orUndefined(r.scheduledFor),
    scheduledDay: orUndefined(r.scheduledDay),
    dueAt: orUndefined(r.dueAt),
    completedAt: orUndefined(r.completedAt),
    completedDate: orUndefined(r.completedDate),
    updatedAt: orUndefined(r.updatedAt),
  }));

  const quotes: MapQuote[] = quoteRows.map((r) => ({
    externalId: r.externalId,
    siteId: orUndefined(r.siteId),
    name: r.name,
    isClosed: r.isClosed === 1,
    jobExternalId: orUndefined(r.jobExternalId),
    dateIssued: orUndefined(r.dateIssued),
  }));

  return { sites, jobs, quotes, positions, sinceDay, loadedAt: now };
}

interface CustomerRow {
  externalId: string;
  name: string;
  address: string | null;
  suburb: string | null;
  postcode: string | null;
}

/**
 * Every current customer, as the matcher wants them. Read once per search
 * session rather than per keystroke: the list is a couple of thousand rows,
 * and a technician who searches three places in a row should not read it
 * three times.
 */
export async function listMatchCustomers(): Promise<MatchCustomer[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CustomerRow>(
    `SELECT externalId, name, address, suburb, postcode FROM customer WHERE archived = 0 ORDER BY name COLLATE NOCASE`,
  );
  return rows.map((r) => ({
    externalId: r.externalId,
    name: r.name,
    address: orUndefined(r.address),
    suburb: orUndefined(r.suburb),
    postcode: orUndefined(r.postcode),
  }));
}
