import { getDb } from './index';

export interface PanelSite {
  siteId: string;
  siteName: string;
}

/**
 * The site each panel is on, for points listed across every site.
 *
 * A point only knows its panel, and the find screen lists points from any
 * site, so it reads the panels' sites once for the rows it is showing.
 */
export async function sitesForPanels(panelIds: readonly string[]): Promise<Map<string, PanelSite>> {
  const ids = [...new Set(panelIds)];
  const found = new Map<string, PanelSite>();
  if (!ids.length) return found;
  const db = await getDb();
  const rows = await db.getAllAsync<{ panelId: string; siteId: string; siteName: string }>(
    `SELECT p.id AS panelId, p.siteId AS siteId, s.name AS siteName
     FROM panel p JOIN site s ON s.id = p.siteId
     WHERE p.id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  for (const r of rows) found.set(r.panelId, { siteId: r.siteId, siteName: r.siteName });
  return found;
}
