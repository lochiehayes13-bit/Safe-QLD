import type { ServiceFrequency, ServiceReport } from './types';
import { siteMatches } from './siteSearch';

/**
 * Test sheet header: the service interval, its words, the default title, and
 * the list search.
 *
 * Every sheet used to be created as 'annual' with nothing on the sheet to
 * change it, so a monthly service printed "Service type: annual". The values
 * are the domain's own (ServiceFrequency); the words are the ones AS 1851 uses
 * for the intervals, which is what a technician says.
 */

/** The intervals a technician picks from on the sheet, in order. */
export const TEST_SHEET_FREQUENCIES: readonly { value: ServiceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Three-monthly' },
  { value: 'six-monthly', label: 'Six-monthly' },
  { value: 'annual', label: 'Yearly' },
  { value: 'five-yearly', label: 'Five-yearly' },
];

const OTHER_LABELS: Record<string, string> = {
  commissioning: 'Commissioning',
  'ad-hoc': 'Ad hoc',
};

/** The word printed for a sheet's interval. An unknown value comes back as it is, not blank. */
export function frequencyLabel(frequency: string | undefined | null): string {
  if (!frequency) return '';
  const known = TEST_SHEET_FREQUENCIES.find((f) => f.value === frequency)?.label ?? OTHER_LABELS[frequency];
  return known ?? frequency;
}

/** The title a new sheet starts with, e.g. "Six-monthly service". */
export function defaultSheetTitle(frequency: ServiceFrequency): string {
  return `${frequencyLabel(frequency)} service`;
}

/**
 * The title after the interval changes, or undefined to leave it alone.
 *
 * A title still reading as the default for the old interval follows the new
 * one, so a sheet switched to monthly does not print "Yearly service".
 * A title somebody typed is theirs and is never touched. The old site-screen
 * default ("Service report — <site>") counts as a default too.
 */
export function titleAfterFrequencyChange(
  title: string,
  from: ServiceFrequency,
  to: ServiceFrequency,
  siteName?: string,
): string | undefined {
  if (from === to) return undefined;
  const now = title.trim();
  const defaults = new Set([
    '',
    defaultSheetTitle(from).toLowerCase(),
    'service report',
    ...(siteName ? [`service report — ${siteName}`.toLowerCase(), `service report - ${siteName}`.toLowerCase()] : []),
  ]);
  return defaults.has(now.toLowerCase()) ? defaultSheetTitle(to) : undefined;
}

/** What a sheet started from the list is created with. Today's Queensland date is passed in. */
export function newTestSheetInput(args: {
  siteId: string;
  /** The site's panels. One panel puts the sheet on it; none or several leaves it site-wide. */
  panelIds: readonly string[];
  today: string;
  frequency?: ServiceFrequency;
}): Omit<ServiceReport, 'id' | 'createdAt' | 'updatedAt'> {
  const frequency = args.frequency ?? 'annual';
  return {
    siteId: args.siteId,
    panelId: args.panelIds.length === 1 ? args.panelIds[0] : undefined,
    title: defaultSheetTitle(frequency),
    frequency,
    serviceDate: args.today,
    status: 'draft',
  };
}

type SheetSite = Parameters<typeof siteMatches>[0];

/**
 * Whether a sheet matches what was typed in the list's search box.
 *
 * The sheet's own words (title, job number, customer, technician, interval)
 * and the site's, through the same columns every site search uses, so a
 * suburb finds the sheets for the buildings in it.
 */
export function sheetMatches(
  sheet: Pick<ServiceReport, 'title' | 'jobNumber' | 'customerName' | 'technicianName' | 'frequency'>,
  site: SheetSite | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const own = [sheet.title, sheet.jobNumber, sheet.customerName, sheet.technicianName, frequencyLabel(sheet.frequency)];
  if (own.some((v) => v && v.toLowerCase().includes(q))) return true;
  return site ? siteMatches(site, q) : false;
}
