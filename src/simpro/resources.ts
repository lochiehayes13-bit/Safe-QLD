import type { SimproClient } from './client';
import { buildRateCard, type RateCardImport, type RawLabourRate, type RawServiceFee } from './rateCard';
import { JOB_LIST_COLUMNS, SIMPRO_PATHS, mapJobRow, type RawJobRow, type SimproJob } from './mirrorResources';
import { htmlToText } from '@/domain/simproText';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * The job shape now lives with the rest of the mirror in ./mirrorResources;
 * re-exported here so the sync and the asset mapper keep one import.
 */
export type { SimproJob } from './mirrorResources';

/**
 * Typed views over the Simpro endpoints the app uses.
 *
 * Simpro's payloads are wide and inconsistently cased across endpoints, so each
 * mapper picks out only the fields the app needs and normalises them. Anything
 * unrecognised is ignored rather than guessed at.
 */

// Simpro returns PascalCase keys; these mirror only what is actually read.
interface RawRef { ID?: number; Name?: string }
/** Simpro's contact block, shared by sites and employees. */
interface RawContact {
  GivenName?: string;
  FamilyName?: string;
  Email?: string;
  WorkPhone?: string;
  CellPhone?: string;
  Position?: string;
}
interface RawSite {
  ID?: number;
  Name?: string;
  Address?: { Address?: string; City?: string; State?: string; PostalCode?: string };
  Customers?: RawRef[];
  PrimaryContact?: RawContact;
  PublicNotes?: string;
  Archived?: boolean;
  DateModified?: string;
}
export interface RawSchedule {
  ID?: number;
  Type?: string;
  Reference?: string;
  Staff?: RawRef;
  Date?: string;
  Blocks?: { StartTime?: string; EndTime?: string }[];
  /** Where the job id lives: `{ProjectID, SectionID, CostCenterID}` on a job
   *  block, and the empty string on an activity — leave, training, a day off. */
  Project?: { ProjectID?: number } | string;
}
interface RawEmployee { ID?: number; Name?: string; Position?: string; PrimaryContact?: RawContact; Archived?: boolean }
interface RawCustomerAsset {
  ID?: number;
  Name?: string;
  AssetType?: RawRef;
  Site?: RawRef;
  SerialNumber?: string;
  ManufacturedDate?: string;
  InstallDate?: string;
  StartDate?: string;
  ParentID?: number | null;
  Archived?: boolean;
  DateModified?: string;
  CustomFields?: { CustomField?: RawRef; Value?: string }[];
  /** Every frequency this asset is on, each with the date it is next due. */
  ServiceLevels?: { ID?: number; Name?: string; ServiceDate?: string }[];
  /** What the office recorded last time, which is not what this phone recorded. */
  LastTest?: { Result?: string; Date?: string | null; ServiceLevel?: RawRef };
}

export interface SimproSite {
  /** The source's own modification timestamp, where it provides one. */
  DateModified?: string;
  id: string;
  name: string;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  customerName?: string;
  /**
   * The site's own contact, which the office already holds for most sites.
   *
   * Reports print Contact, Mobile and Email rows and those rows were blank on
   * every report the app has ever produced — not because the office lacks the
   * detail, but because the sync never asked for the field.
   */
  contactName?: string;
  contactEmail?: string;
  contactWorkPhone?: string;
  contactMobile?: string;
  /** Simpro's customer number for the site, off the list's Customers. */
  customerExternalId?: string;
  /** The office's public notes, plain text. Undefined where the list did not carry them. */
  publicNotes?: string;
  archived?: boolean;
}

export interface SimproScheduleBlock {
  id: string;
  jobId?: string;
  reference?: string;
  /** Simpro's employee id, the key the day screen filters on. */
  staffId?: string;
  staffName?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type?: string;
}

export interface SimproEmployee {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  /** Left the company. Kept so a phone set to them can be told, never offered. */
  archived?: boolean;
}

export interface SimproAsset {
  /** The source's own modification timestamp, where it provides one. */
  DateModified?: string;
  id: string;
  name: string;
  typeName?: string;
  typeId?: string;
  siteName?: string;
  siteId?: string;
  serial?: string;
  installedDate?: string;
  custom: Record<string, string>;
  /** Each frequency this asset is on, with the date the office says it is next due. */
  serviceLevels: { id: string; name: string; dueAt?: string }[];
  /**
   * The office's record of the last test.
   *
   * Held separately from anything this phone recorded, and deliberately a free
   * string: "No Test" is a real state on 7,263 of the 12,546 assets and a
   * pass/fail boolean cannot hold it.
   */
  lastTestResult?: string;
  lastTestAt?: string;
  /** Set on sub-assets, e.g. a detector under a panel. */
  parentId?: string;
  archived?: boolean;
}

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

/*
 * The schedule columns this build honours.
 *
 * `Job` is not one of them. Asking for it returned 422 "Invalid columns
 * found" and took the whole schedules stage down with it, so a sync that
 * read four and a half thousand jobs still showed an empty diary. The job a
 * block belongs to arrives under `Project` instead — `{ProjectID,
 * SectionID, CostCenterID}` — which is the same number the jobs endpoint
 * calls `ID`. `JobID` is accepted by the build but comes back empty, which
 * is worse than a refusal: it fails silently.
 */
export const SCHEDULE_COLUMNS = 'ID,Type,Reference,Staff,Date,Blocks,Project';

/**
 * Simpro's range filter for a date column, from its API documentation.
 *
 * Kept in one place because the sync tells the technician the exact filter
 * the build rejected if it does; a filter spelled two ways would make that
 * message a lie half the time.
 */
export function scheduleDateFilter(from: string, to: string): string {
  return `between(${from},${to})`;
}

/**
 * One schedule row, however it was asked for.
 *
 * A block can be split across the day — two hours in the morning and two
 * after another site — so the start is the first block's and the end is the
 * last's. Anything between is the same job and does not need saying.
 */
/**
 * The job a schedule block belongs to, or nothing if it is not on a job.
 *
 * Two shapes come back from the one field. A block on a job carries
 * `Project: {ProjectID: 41801, ...}`, and 41801 is the job's own id. A block
 * on an activity — annual leave, a training day — carries `Project: ""`, and
 * has no job at all. The `Reference` on a job block reads "41801-11950",
 * which is that same id with the cost centre after it, and is the fallback
 * for a build that returns the reference but not the object.
 */
function scheduleJobId(s: RawSchedule): string | undefined {
  const project = s.Project;
  if (project && typeof project === 'object' && project.ProjectID !== undefined) {
    return String(project.ProjectID);
  }
  const fromReference = /^(\d+)-\d+$/.exec(str(s.Reference) ?? '');
  return fromReference ? fromReference[1] : undefined;
}

export function mapSchedule(s: RawSchedule, fallbackDate: string): SimproScheduleBlock {
  const blocks = s.Blocks ?? [];
  return {
    id: String(s.ID ?? ''),
    jobId: scheduleJobId(s),
    reference: str(s.Reference),
    staffId: s.Staff?.ID !== undefined ? String(s.Staff.ID) : undefined,
    staffName: str(s.Staff?.Name),
    date: str(s.Date) ?? fallbackDate,
    startTime: str(blocks[0]?.StartTime),
    endTime: str(blocks[blocks.length - 1]?.EndTime),
    type: str(s.Type),
  };
}

export class SimproResources {
  constructor(private readonly client: SimproClient) {}

  /**
   * @param query extra filters, used to ask only for what changed since the
   * last sync. Passed through rather than built here, because whether the
   * endpoint honours a filter is checked by the caller.
   */
  /**
   * @param query extra filters, used to ask only for what changed since the
   * last sync. Passed through rather than built here, because whether the
   * endpoint honours a filter is checked by the caller.
   *
   * The ceiling was 2,000 against a build holding 3,057 sites, so a full pull
   * dropped a thousand of them and reported success — `listAll` returns a bare
   * array and cannot say it stopped early. It is now above the real count with
   * room to grow, and the caller that cares uses `sitesPaged`.
   */
  async sites(maxRecords = 20000, query: Record<string, string> = {}): Promise<SimproSite[]> {
    return (await this.sitesPaged(maxRecords, query)).sites;
  }

  /**
   * The same read, saying whether the ceiling cut it short.
   *
   * The public notes are asked for with the rest, and asked for again
   * without them if the build refuses the column: the notes are worth a
   * second first page, and not worth the whole site list. `columnsRejected`
   * carries the refusal in the server's words, and the notes are then
   * absent from every row rather than blank — the sync must not clear what
   * a read of the site's own record put there.
   */
  async sitesPaged(
    maxRecords = 20000,
    query: Record<string, string> = {},
  ): Promise<{ sites: SimproSite[]; truncated: boolean; columnsRejected?: string }> {
    const verified = 'ID,Name,Address,Customers,PrimaryContact,Archived,DateModified';
    let columnsRejected: string | undefined;
    let read: { items: RawSite[]; truncated: boolean };
    try {
      read = await this.client.listAllPaged<RawSite>('sites/', { columns: `${verified},PublicNotes`, ...query }, maxRecords);
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      if (status !== 422) throw e;
      columnsRejected = e instanceof Error ? e.message : String(e);
      read = await this.client.listAllPaged<RawSite>('sites/', { columns: verified, ...query }, maxRecords);
    }
    const { items, truncated } = read;
    return {
      truncated,
      columnsRejected,
      sites: items.map((s) => {
        const c = s.PrimaryContact;
        const contactName = [str(c?.GivenName), str(c?.FamilyName)].filter(Boolean).join(' ');
        return {
          id: String(s.ID ?? ''),
          name: str(s.Name) ?? 'Unnamed site',
          address: str(s.Address?.Address),
          suburb: str(s.Address?.City),
          state: str(s.Address?.State) ?? 'QLD',
          postcode: str(s.Address?.PostalCode),
          customerName: str(s.Customers?.[0]?.Name),
          customerExternalId: s.Customers?.[0]?.ID !== undefined ? String(s.Customers[0].ID) : undefined,
          publicNotes: columnsRejected ? undefined : htmlToText(s.PublicNotes) || undefined,
          contactName: contactName || undefined,
          contactEmail: str(c?.Email),
          contactWorkPhone: str(c?.WorkPhone),
          contactMobile: str(c?.CellPhone),
          archived: s.Archived === true,
          // Kept so the caller can anchor the next incremental sync on the newest
          // record rather than on the local clock.
          DateModified: str(s.DateModified),
        };
      }),
    };
  }

  async jobs(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<SimproJob[]> {
    return (await this.jobsPaged(query, maxRecords)).jobs;
  }

  /**
   * The same read, saying whether the ceiling cut it short, and newest
   * change first so that what a cut read drops is the oldest, not the job
   * somebody edited this morning. Simpro's default order is by ID ascending,
   * which on a build with a multi-year history means a capped read returns
   * the oldest jobs on the books.
   *
   * The column set is the full one the build was verified to honour — see
   * JOB_LIST_COLUMNS — rather than the eight fields it used to ask for, so a
   * job row carries its order number, its status and its technicians on the
   * first read. The ceiling is above the 4,562 jobs on the books, with room:
   * a mirror that holds the newest five hundred is not a mirror.
   */
  async jobsPaged(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<{ jobs: SimproJob[]; truncated: boolean }> {
    const { items: raw, truncated } = await this.client.listAllPaged<RawJobRow>(SIMPRO_PATHS.jobs(), {
      columns: JOB_LIST_COLUMNS,
      orderby: '-DateModified',
      ...query,
    }, maxRecords);
    return { truncated, jobs: raw.map(mapJobRow) };
  }

  /** Open jobs only — the technician's actual work list. */
  async openJobs(maxRecords = 500): Promise<SimproJob[]> {
    return this.jobs({ 'Stage': 'Progress' }, maxRecords);
  }

  async schedulesForDate(date: string, maxRecords = 500): Promise<SimproScheduleBlock[]> {
    const raw = await this.client.listAll<RawSchedule>('schedules/', {
      columns: SCHEDULE_COLUMNS,
      Date: date,
    }, maxRecords);
    return raw.map((s) => mapSchedule(s, date));
  }

  /**
   * Every schedule block dated between two days, inclusive.
   *
   * One read for the whole window rather than one per day: the window the
   * sync uses is four weeks, and twenty-eight reads a sync — paced at eight
   * a second, on every phone, twice a day — is not nothing on a build shared
   * with the office. Whether the build honours the filter is the caller's to
   * find out; it is told the server's exact words if not.
   */
  async schedulesBetween(from: string, to: string, maxRecords = 2000): Promise<SimproScheduleBlock[]> {
    const raw = await this.client.listAll<RawSchedule>('schedules/', {
      columns: SCHEDULE_COLUMNS,
      Date: scheduleDateFilter(from, to),
    }, maxRecords);
    return raw.map((s) => mapSchedule(s, from));
  }

  async employees(maxRecords = 500): Promise<SimproEmployee[]> {
    // Email and Phone are not columns on this endpoint — asking for them
    // returns 422 "Invalid columns found" and the whole read fails. Contact
    // detail lives under PrimaryContact, as it does on sites.
    const raw = await this.client.listAll<RawEmployee>(
      'employees/', { columns: 'ID,Name,Position,PrimaryContact,Archived' }, maxRecords,
    );
    return raw.map((e) => ({
      id: String(e.ID ?? ''),
      name: str(e.Name) ?? 'Unnamed',
      email: str(e.PrimaryContact?.Email),
      phone: str(e.PrimaryContact?.CellPhone) ?? str(e.PrimaryContact?.WorkPhone),
      position: str(e.Position),
      archived: e.Archived === true,
    }));
  }

  /**
   * Every customer asset, with the detail a technician actually needs.
   *
   * This previously sent no `columns` at all, which returns the thin list shape
   * — ID, AssetType, Site and ServiceLevels without dates — so location, tag
   * number, equipment type and last test result were never fetched. Asking for
   * them by name is what makes one request per 250 assets carry the whole
   * record, instead of 12,546 follow-up reads for the detail.
   *
   * The ceiling was 5,000 against 12,546 assets and silently dropped the rest.
   */
  async customerAssets(maxRecords = 30000, query: Record<string, string> = {}): Promise<SimproAsset[]> {
    return (await this.customerAssetsPaged(maxRecords, query)).assets;
  }

  /** The same read, saying whether the ceiling cut it short. */
  async customerAssetsPaged(
    maxRecords = 30000,
    query: Record<string, string> = {},
  ): Promise<{ assets: SimproAsset[]; truncated: boolean }> {
    const { items, truncated } = await this.client.listAllPaged<RawCustomerAsset>(
      'customerAssets/',
      {
        columns: 'ID,AssetType,Site,ServiceLevels,LastTest,CustomFields,StartDate,ParentID,Archived,DateModified',
        ...query,
      },
      maxRecords,
    );
    const assets = items.map((a) => {
      const custom: Record<string, string> = {};
      for (const f of a.CustomFields ?? []) {
        const key = str(f.CustomField?.Name);
        const value = str(f.Value);
        if (key && value) custom[key] = value;
      }
      return {
        DateModified: str(a.DateModified),
        id: String(a.ID ?? ''),
        // The endpoint returns no Name for an asset; the office identifies one
        // by its type and its Location custom field, so fall back to those
        // rather than printing "Unnamed asset" 12,546 times.
        name: str(a.Name) ?? str(custom['Location']) ?? str(a.AssetType?.Name) ?? 'Unnamed asset',
        typeName: str(a.AssetType?.Name),
        typeId: a.AssetType?.ID !== undefined ? String(a.AssetType.ID) : undefined,
        siteName: str(a.Site?.Name),
        siteId: a.Site?.ID !== undefined ? String(a.Site.ID) : undefined,
        serial: str(a.SerialNumber),
        installedDate: str(a.InstallDate) ?? str(a.StartDate),
        parentId: a.ParentID !== undefined && a.ParentID !== null ? String(a.ParentID) : undefined,
        archived: a.Archived === true,
        lastTestResult: str(a.LastTest?.Result),
        lastTestAt: str(a.LastTest?.Date ?? undefined),
        serviceLevels: (a.ServiceLevels ?? [])
          .filter((l) => l.ID !== undefined)
          .map((l) => ({ id: String(l.ID), name: str(l.Name) ?? '', dueAt: str(l.ServiceDate) })),
        custom,
      };
    });
    return { assets, truncated };
  }

  /**
   * Records a test result against a customer asset.
   *
   * Simpro has no endpoint for a test as a thing in its own right — there is no
   * `customerAssets/{id}/tests/`, and the asset attached to a job's cost centre
   * is only a link, `{Asset: {ID, AssetType}}`, with nowhere to put a result.
   * What the asset does carry is `LastTest {Result, Date, ServiceLevel}`, so
   * that is what this sets.
   *
   * `ServiceLevels` is deliberately NOT sent. An asset is usually on several
   * frequencies at once — a 6 Monthly and a Yearly, sometimes a 5 Yearly — and
   * a PATCH carrying an array of one would very plausibly be read as the whole
   * new set, silently deleting the others and with them the dates the office
   * schedules from. Advancing the next service date is Simpro's own job once a
   * test is recorded; it is not worth risking a customer's schedule to save it
   * a calculation.
   *
   * @param serviceLevelId which frequency this test was against, e.g. the
   * 6 Monthly. Required: a result with no frequency does not say what was done.
   */
  async postAssetTest(assetId: string, result: 'Pass' | 'Fail', dateIso: string, serviceLevelId: string): Promise<void> {
    // No trailing slash: a single record's path with one is a 404 "Invalid
    // route" on this build, so every test result posted was silently refused.
    await this.client.request('PATCH', SIMPRO_PATHS.customerAsset(assetId), {
      body: {
        LastTest: {
          Result: result,
          // The Queensland day, not the UTC one: before ten in the morning
          // those differ, and this company starts at seven.
          Date: qldIsoDay(dateIso) ?? dateIso,
          ServiceLevel: { ID: Number(serviceLevelId) },
        },
      },
    });
  }

  /** Adds a note to a job — how a technician's field finding reaches the office. */
  async addJobNote(jobId: string, subject: string, note: string): Promise<void> {
    await this.client.request('POST', `jobs/${jobId}/notes/`, {
      body: { Subject: subject.slice(0, 200), Note: note },
    });
  }

  async createPurchaseOrder(payload: {
    vendorId?: number;
    jobId?: string;
    lines: { partNumber: string; description: string; quantity: number }[];
    notes?: string;
  }): Promise<{ id?: string }> {
    // Simpro's route is `vendorOrders/`; `purchaseOrders/` returns 404 "Invalid
    // route", so every order raised from the app was silently failing to post.
    const { data } = await this.client.request<{ ID?: number }>('POST', 'vendorOrders/', {
      body: {
        Vendor: payload.vendorId,
        Job: payload.jobId ? Number(payload.jobId) : undefined,
        Notes: payload.notes,
        Items: payload.lines.map((l) => ({
          PartNo: l.partNumber,
          Description: l.description,
          Quantity: l.quantity,
        })),
      },
    });
    // A 204, or a 2xx with nothing in it, resolves with no body at all: the
    // order was raised, its number just was not handed back.
    return { id: data?.ID !== undefined ? String(data.ID) : undefined };
  }

  /**
   * Customer names, used only to tell a customer rate from a general one.
   *
   * Nothing else is read: a rate card needs to know that "Vaxxas" is a real
   * customer, not who they are.
   */
  async customerNames(maxRecords = 5000): Promise<string[]> {
    const raw = await this.client.listAll<{ CompanyName?: string; Name?: string }>(
      'customers/companies/', { columns: 'ID,CompanyName' }, maxRecords,
    );
    return raw.map((c) => str(c.CompanyName) ?? str(c.Name)).filter((n): n is string => !!n);
  }

  /**
   * The rate card as Simpro holds it right now.
   *
   * Rates change in the office system day to day, which is the whole reason to
   * read them rather than keep a typed copy. The two setup endpoints are asked
   * for separately so one being unreadable — a key without setup scope is
   * common — still yields the other, with the gap reported rather than showing
   * a half card as though it were whole.
   */
  async rateCard(): Promise<RateCardImport & { unreadable: { what: string; error: string }[] }> {
    const unreadable: { what: string; error: string }[] = [];

    /**
     * `columns` is not optional here.
     *
     * Both of these endpoints answer a bare list with nothing but ID and Name —
     * no cost, no markup, no charge, no included time. So the pull succeeded,
     * found the rates, and imported a card with every figure missing, which
     * `buildRateCard` then discarded as unusable. The result was an empty rate
     * card and a message saying Simpro had no rates to give, on a build that
     * has six of them.
     */
    const tryList = async <T>(what: string, path: string, columns: string): Promise<T[]> => {
      try {
        return await this.client.listAll<T>(path, { columns }, 1000);
      } catch (e) {
        unreadable.push({ what, error: e instanceof Error ? e.message : String(e) });
        return [];
      }
    };

    const [rates, fees] = await Promise.all([
      tryList<RawLabourRate>(
        'Labour rates',
        'setup/labor/laborRates/',
        'ID,Name,CostRate,Markup,Multiplier,TaxCode,IsDefault,Archived',
      ),
      // Narrower than the labour rate set on purpose: this endpoint rejects
      // `TaxCode` and `Amount` outright with 422, and one bad name fails the
      // whole read rather than being ignored.
      tryList<RawServiceFee>(
        'Service fees',
        'setup/labor/serviceFees/',
        'ID,Name,Price,LaborTime,SalesTaxCode,Archived',
      ),
    ]);

    let customers: string[] = [];
    try {
      customers = await this.customerNames();
    } catch (e) {
      unreadable.push({ what: 'Customer names', error: e instanceof Error ? e.message : String(e) });
    }

    return { ...buildRateCard(rates, fees, customers), unreadable };
  }
}
