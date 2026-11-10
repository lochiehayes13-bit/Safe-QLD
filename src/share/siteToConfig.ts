import { listCauseEffect, listLoops, listPanels, listZones, queryPoints } from '@/db/repo';
import type { ParsedConfig, ParsedPanel, Site } from '@/domain/types';

/**
 * Rebuilding a shareable config from a site already in the database.
 *
 * The inverse of importing one. A pack is how one technician hands a site to
 * another without sending the vendor's original file — so the app has to be
 * able to produce one, not only read one, and until now it could only read.
 *
 * Everything stored against a panel comes back out: zones, points, loops and
 * the cause-and-effect rules. Database identifiers are dropped, because they
 * mean nothing on the receiving device and would only invite a collision.
 * Unused points are kept: the receiver decides what to hide, and a pack that
 * silently drops the spare addresses is not the same site.
 */

export const PACK_PARSER_ID = 'safeqld-site-export/1';

export async function siteToConfig(site: Site): Promise<ParsedConfig> {
  const panels = await listPanels(site.id);

  const built: ParsedPanel[] = [];
  for (const panel of panels) {
    const [zones, points, loops, causeEffect] = await Promise.all([
      listZones(panel.id, true),
      queryPoints({ panelId: panel.id, includeUnused: true, limit: 200000 }),
      listLoops(panel.id),
      listCauseEffect(panel.id),
    ]);

    built.push({
      name: panel.name,
      brand: panel.brand,
      model: panel.model,
      nodeNumber: panel.nodeNumber,
      zones: zones.map(({ id, panelId, ...rest }) => rest),
      points: points.map(({ id, panelId, ...rest }) => rest),
      loops: loops.map(({ id, panelId, ...rest }) => rest),
      causeEffect: causeEffect.map(({ id, panelId, ...rest }) => rest),
    });
  }

  return {
    // The pack records the brand of the first panel, which is what a mixed site
    // gets asked to choose anyway; each panel carries its own brand regardless.
    // A site with no panels yet packs as 'other' rather than guessing.
    brand: panels[0]?.brand ?? 'other',
    model: panels[0]?.model,
    siteName: site.name,
    panels: built,
    warnings: [],
    parser: PACK_PARSER_ID,
  };
}

/** Totals for the confirmation shown before a pack is shared. */
export function configTotals(config: ParsedConfig): {
  panels: number; zones: number; points: number; rules: number;
} {
  return {
    panels: config.panels.length,
    zones: config.panels.reduce((n, p) => n + p.zones.length, 0),
    points: config.panels.reduce((n, p) => n + p.points.length, 0),
    rules: config.panels.reduce((n, p) => n + p.causeEffect.length, 0),
  };
}
