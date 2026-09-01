import type { SimproClient } from './client';
import { buildRateCard, type RateCardImport, type RawLabourRate, type RawServiceFee } from './rateCard';

/**
 * Typed views over the Simpro endpoints the app uses.
 *
 * Simpro's payloads are wide and inconsistently cased across endpoints, so each
 * mapper picks out only the fields the app needs and normalises them. Anything
 * unrecognised is ignored rather than guessed at.
 */

// Simpro returns PascalCase keys; these mirror only what is actually read.
interface RawRef { ID?: number; Name?: string }
interface RawSite {
  ID?: number;
  Name?: string;
  Address?: { Address?: string; City?: string; State?: string; PostalCode?: string };
  Customers?: RawRef[];
}
interface RawJob {
  ID?: number;
  Type?: string;
  Name?: string;
  Description?: string;
  Customer?: RawRef;
  Site?: RawRef;
  Stage?: string;
  Status?: { ID?: number; Name?: string };
  DateIssued?: string;
  DueDate?: string;
  Total?: { ExTax?: number };
}
interface RawSchedule {
  ID?: number;
  Type?: string;
  Reference?: string;
  Staff?: RawRef;
  Date?: string;
  Blocks?: { StartTime?: string; EndTime?: string }[];
  Job?: RawRef;
}
interface RawEmployee { ID?: number; Name?: string; Email?: string; Phone?: string; Position?: string }
interface RawCustomerAsset {
  ID?: number;
  Name?: string;
  AssetType?: RawRef;
  Site?: RawRef;
  SerialNumber?: string;
  ManufacturedDate?: string;
  InstallDate?: string;
  CustomFields?: { CustomField?: RawRef; Value?: string }[];
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
}

export interface SimproJob {
  /** The source's own modification timestamp, where it provides one. */
  DateModified?: string;
  id: string;
  title: string;
  description?: string;
  customerName?: string;
  siteName?: string;
  siteId?: string;
  stage?: string;
  status?: string;
  issuedAt?: string;
  dueAt?: string;
  type?: string;
}

export interface SimproScheduleBlock {
  id: string;
  jobId?: string;
  reference?: string;
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
}

export interface SimproAsset {
  id: string;
  name: string;
  typeName?: string;
  siteName?: string;
  siteId?: string;
  serial?: string;
  installedDate?: string;
  custom: Record<string, string>;
}

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

export class SimproResources {
  constructor(private readonly client: SimproClient) {}

  /**
   * @param query extra filters, used to ask only for what changed since the
   * last sync. Passed through rather than built here, because whether the
   * endpoint honours a filter is checked by the caller.
   */
  async sites(maxRecords = 2000, query: Record<string, string> = {}): Promise<SimproSite[]> {
    const raw = await this.client.listAll<RawSite>(
      'sites/', { columns: 'ID,Name,Address,Customers,DateModified', ...query }, maxRecords,
    );
    return raw.map((s) => ({
      id: String(s.ID ?? ''),
      name: str(s.Name) ?? 'Unnamed site',
      address: str(s.Address?.Address),
      suburb: str(s.Address?.City),
      state: str(s.Address?.State) ?? 'QLD',
      postcode: str(s.Address?.PostalCode),
      customerName: str(s.Customers?.[0]?.Name),
      // Kept so the caller can anchor the next incremental sync on the newest
      // record rather than on the local clock.
      DateModified: str((s as { DateModified?: unknown }).DateModified),
    }));
  }

  async jobs(query: Record<string, string | number> = {}, maxRecords = 1000): Promise<SimproJob[]> {
    const raw = await this.client.listAll<RawJob>('jobs/', {
      columns: 'ID,Type,Name,Description,Customer,Site,Stage,Status,DateIssued,DueDate,DateModified',
      ...query,
    }, maxRecords);
    return raw.map((j) => ({
      DateModified: str((j as { DateModified?: unknown }).DateModified),
      id: String(j.ID ?? ''),
      title: str(j.Name) ?? str(j.Description) ?? `Job ${j.ID ?? ''}`,
      description: str(j.Description),
      customerName: str(j.Customer?.Name),
      siteName: str(j.Site?.Name),
      siteId: j.Site?.ID !== undefined ? String(j.Site.ID) : undefined,
      stage: str(j.Stage),
      status: str(j.Status?.Name),
      issuedAt: str(j.DateIssued),
      dueAt: str(j.DueDate),
      type: str(j.Type),
    }));
  }

  /** Open jobs only — the technician's actual work list. */
  async openJobs(maxRecords = 500): Promise<SimproJob[]> {
    return this.jobs({ 'Stage': 'Progress' }, maxRecords);
  }

  async schedulesForDate(date: string, maxRecords = 500): Promise<SimproScheduleBlock[]> {
    const raw = await this.client.listAll<RawSchedule>('schedules/', {
      columns: 'ID,Type,Reference,Staff,Date,Blocks,Job',
      Date: date,
    }, maxRecords);
    return raw.map((s) => ({
      id: String(s.ID ?? ''),
      jobId: s.Job?.ID !== undefined ? String(s.Job.ID) : undefined,
      reference: str(s.Reference),
      staffName: str(s.Staff?.Name),
      date: str(s.Date) ?? date,
      startTime: str(s.Blocks?.[0]?.StartTime),
      endTime: str(s.Blocks?.[0]?.EndTime),
      type: str(s.Type),
    }));
  }

  async employees(maxRecords = 500): Promise<SimproEmployee[]> {
    const raw = await this.client.listAll<RawEmployee>('employees/', { columns: 'ID,Name,Email,Phone,Position' }, maxRecords);
    return raw.map((e) => ({
      id: String(e.ID ?? ''),
      name: str(e.Name) ?? 'Unnamed',
      email: str(e.Email),
      phone: str(e.Phone),
      position: str(e.Position),
    }));
  }

  async customerAssets(maxRecords = 5000): Promise<SimproAsset[]> {
    const raw = await this.client.listAll<RawCustomerAsset>('customerAssets/', {}, maxRecords);
    return raw.map((a) => {
      const custom: Record<string, string> = {};
      for (const f of a.CustomFields ?? []) {
        const key = str(f.CustomField?.Name);
        const value = str(f.Value);
        if (key && value) custom[key] = value;
      }
      return {
        id: String(a.ID ?? ''),
        name: str(a.Name) ?? 'Unnamed asset',
        typeName: str(a.AssetType?.Name),
        siteName: str(a.Site?.Name),
        siteId: a.Site?.ID !== undefined ? String(a.Site.ID) : undefined,
        serial: str(a.SerialNumber),
        installedDate: str(a.InstallDate),
        custom,
      };
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
    const { data } = await this.client.request<{ ID?: number }>('POST', 'purchaseOrders/', {
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
    return { id: data.ID !== undefined ? String(data.ID) : undefined };
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

    const tryList = async <T>(what: string, path: string): Promise<T[]> => {
      try {
        return await this.client.listAll<T>(path, {}, 1000);
      } catch (e) {
        unreadable.push({ what, error: e instanceof Error ? e.message : String(e) });
        return [];
      }
    };

    const [rates, fees] = await Promise.all([
      tryList<RawLabourRate>('Labour rates', 'setup/labor/laborRates/'),
      tryList<RawServiceFee>('Service fees', 'setup/labor/serviceFees/'),
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
