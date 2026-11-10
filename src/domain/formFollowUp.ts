import { occupierCopyDueBy } from '@/export/form72';
import { siteMatches, type SiteSearchColumn } from '@/domain/siteSearch';

/**
 * Where a Form 72 stands for whoever follows it up: still a draft, issued with
 * the occupier's copy owed, or settled.
 *
 * The due date is the form's own count (occupierCopyDueBy, MP 6.1 A4(b)), so
 * the list and the form never give two answers. An owed copy whose date cannot
 * be counted is its own state rather than "no deadline": the ten business days
 * still run, somebody has to count them by hand.
 */

/** The fields this needs, so a test can pass a plain object. */
export interface FollowUpForm {
  status: 'draft' | 'issued';
  testDate?: string;
  copyGivenAt?: string;
}

export type CopyState =
  | { kind: 'draft' }
  | { kind: 'given'; on: string }
  | { kind: 'due'; by: string }
  | { kind: 'late'; by: string }
  | { kind: 'uncounted' };

/** `today` is a Queensland calendar day, YYYY-MM-DD. */
export function copyState(form: FollowUpForm, today: string): CopyState {
  if (form.status === 'draft') return { kind: 'draft' };
  if (form.copyGivenAt) return { kind: 'given', on: form.copyGivenAt };
  const by = occupierCopyDueBy(form.testDate);
  if (!by) return { kind: 'uncounted' };
  // Due on the day itself; late from the day after.
  return today && today > by ? { kind: 'late', by } : { kind: 'due', by };
}

export interface FollowUpGroups<T> {
  drafts: T[];
  /** Issued, occupier copy not yet given. */
  owed: T[];
  /** Issued and handed over. */
  settled: T[];
}

/** Splits forms into the list's three sections, keeping the order they came in. */
export function followUpGroups<T extends FollowUpForm>(forms: readonly T[]): FollowUpGroups<T> {
  const out: FollowUpGroups<T> = { drafts: [], owed: [], settled: [] };
  for (const f of forms) {
    if (f.status === 'draft') out.drafts.push(f);
    else if (!f.copyGivenAt) out.owed.push(f);
    else out.settled.push(f);
  }
  return out;
}

/** What the list's search box reads on a form. */
export interface FollowUpSearchable {
  siteName?: string;
  siteAddress?: string;
  systemLabel?: string;
  jobExternalId?: string;
  jobTitle?: string;
  /** The site as the site record holds it now (listForm72ToFollowUp). */
  siteNow?: Partial<Record<SiteSearchColumn, string | null | undefined>>;
}

/**
 * Whether a form answers the typed search.
 *
 * Word by word, every word somewhere, as the other module searches do. A word
 * matches the form's own name, address, system or job, or the building the way
 * every site search matches one (siteMatches): the client, the office's site
 * number, the postcode and the name the site has now, none of which the form
 * itself holds.
 */
export function followUpMatches(form: FollowUpSearchable, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const own = [form.siteName, form.siteAddress, form.systemLabel, form.jobExternalId, form.jobTitle]
    .map((v) => (v ?? '').toLowerCase());
  return words.every((w) => own.some((v) => v.includes(w))
    || (form.siteNow ? siteMatches(form.siteNow, w) : false));
}
