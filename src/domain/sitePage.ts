import { siteIsArchived } from '@/domain/siteNames';

/**
 * Small decisions made by the site list and the site page, and nowhere else.
 *
 * Pure, so they can be tested without the screens, which the suite's
 * react-native mock cannot load.
 */

export interface SiteChip {
  label: string;
  tone?: 'warn' | 'fail';
}

export interface SiteChipInput {
  panelCount: number;
  pointCount: number;
  openDefects: number;
  archived?: boolean | number | null;
}

function counted(n: number, one: string): string {
  return `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * The chips on one row of the site list.
 *
 * A zero count is left off. Panels and points only come from an imported
 * configuration, so every site that came from Simpro carried "0 panels" and
 * "0 points", which told nobody anything.
 */
export function siteListChips(site: SiteChipInput): SiteChip[] {
  const chips: SiteChip[] = [];
  if (siteIsArchived(site)) chips.push({ label: 'Archived in Simpro', tone: 'warn' });
  if (site.panelCount > 0) chips.push({ label: counted(site.panelCount, 'panel') });
  if (site.pointCount > 0) chips.push({ label: counted(site.pointCount, 'point') });
  if (site.openDefects > 0) chips.push({ label: counted(site.openDefects, 'open defect'), tone: 'fail' });
  return chips;
}

/**
 * Whether the site page offers "Delete site".
 *
 * A site the office holds comes straight back on the next sync, without the
 * panels, reports and defects that were deleted with it. Only a site typed in
 * on this device can be deleted here.
 */
export function siteCanBeDeleted(site: { externalId?: string | null }): boolean {
  return !site.externalId?.trim();
}

/**
 * Whether the site page shows the rows that read a panel's configuration:
 * points, zones and cause and effect. Without an imported panel each of them
 * opens on an empty list.
 */
export function showsPanelRows(panelCount: number): boolean {
  return panelCount > 0;
}
