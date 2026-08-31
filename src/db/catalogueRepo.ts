import { getDb, newId } from './index';

/**
 * Device catalogue.
 *
 * Part numbers and electrical specifications harvested from suppliers' own
 * public catalogues and datasheets. The point is not to be a parts list — it is
 * that picking a device fills its currents into a battery calculation, its
 * model into an asset record, and its part number into a purchase request,
 * without anyone transcribing anything.
 *
 * Every row carries the confidence it was recorded at and, where there is one,
 * the page it came from. A figure a tradesperson relies on should be traceable.
 */

export interface CatalogueItem {
  id: string;
  partNumber: string;
  name: string;
  brand: string;
  supplier?: string;
  category: string;
  subcategory?: string;
  description?: string;
  voltage?: string;
  quiescentMa?: number;
  alarmMa?: number;
  protocol?: string;
  dbAt1m?: number;
  ipRating?: string;
  standards?: string;
  notes?: string;
  sourceUrl?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Shape accepted by the seeder.
 *
 * The bundled harvest is plain JSON with nulls for anything not published and
 * no id yet, so the seed type is looser than the stored record.
 */
export type CatalogueSeedItem = {
  [K in keyof Omit<CatalogueItem, 'id' | 'confidence'>]?: CatalogueItem[K] | null;
} & {
  partNumber: string;
  brand: string;
  name?: string | null;
  id?: string;
  confidence?: string | null;
};

export const CATEGORY_LABEL: Record<string, string> = {
  detector: 'Detectors',
  mcp: 'Call points',
  panel: 'Panels',
  module: 'Modules',
  sounder: 'Sounders',
  strobe: 'Strobes',
  'sounder-strobe': 'Sounder/strobes',
  aspirating: 'Aspirating',
  beam: 'Beam detectors',
  base: 'Bases',
  isolator: 'Isolators',
  'power-supply': 'Power supplies',
  battery: 'Batteries',
  ewis: 'EWIS',
  wip: 'WIP phones',
  extinguisher: 'Extinguishers',
  'hose-reel': 'Hose reels',
  hydrant: 'Hydrants',
  sprinkler: 'Sprinkler',
  signage: 'Signage',
  'emergency-lighting': 'Emergency lighting',
  cable: 'Cable',
  ancillary: 'Ancillary',
  tool: 'Tools',
  accessory: 'Accessories',
  other: 'Other',
};

function searchText(item: CatalogueSeedItem): string {
  return [item.partNumber, item.name, item.brand, item.description, item.subcategory, item.protocol]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Loads catalogue rows.
 *
 * Upserts on brand plus part number so re-seeding a corrected harvest updates
 * in place rather than duplicating. Runs in one transaction because a full
 * catalogue is thousands of rows and a write per row would take minutes.
 */
export async function seedCatalogue(items: CatalogueSeedItem[]): Promise<number> {
  if (!items.length) return 0;
  const db = await getDb();
  let written = 0;

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      if (!item.partNumber?.trim() || !item.brand?.trim()) continue;
      await db.runAsync(
        `INSERT INTO catalogue_item
           (id,partNumber,name,brand,supplier,category,subcategory,description,voltage,
            quiescentMa,alarmMa,protocol,dbAt1m,ipRating,standards,notes,sourceUrl,confidence,searchText)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(brand,partNumber) DO UPDATE SET
           name=excluded.name, supplier=excluded.supplier, category=excluded.category,
           subcategory=excluded.subcategory, description=excluded.description,
           voltage=excluded.voltage, quiescentMa=excluded.quiescentMa, alarmMa=excluded.alarmMa,
           protocol=excluded.protocol, dbAt1m=excluded.dbAt1m, ipRating=excluded.ipRating,
           standards=excluded.standards, notes=excluded.notes, sourceUrl=excluded.sourceUrl,
           confidence=excluded.confidence, searchText=excluded.searchText`,
        item.id || newId(), item.partNumber.trim(), item.name ?? item.partNumber, item.brand.trim(),
        item.supplier ?? null, item.category || 'other', item.subcategory ?? null,
        item.description ?? null, item.voltage ?? null, item.quiescentMa ?? null,
        item.alarmMa ?? null, item.protocol ?? null, item.dbAt1m ?? null,
        item.ipRating ?? null, item.standards ?? null, item.notes ?? null,
        item.sourceUrl ?? null, normaliseConfidence(item.confidence), searchText(item),
      );
      written++;
    }
  });
  return written;
}

/** Anything unrecognised is recorded as medium rather than silently trusted. */
function normaliseConfidence(v: string | null | undefined): string {
  const s = (v ?? '').toLowerCase();
  return s === 'high' || s === 'low' ? s : 'medium';
}

export interface CatalogueQuery {
  search?: string;
  brand?: string;
  category?: string;
  /** Only rows carrying a current figure, for the battery calculator picker. */
  withCurrents?: boolean;
  limit?: number;
}

export async function queryCatalogue(q: CatalogueQuery = {}): Promise<CatalogueItem[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (q.search?.trim()) {
    // Every term must appear, so "ampac photo" narrows rather than widens.
    for (const term of q.search.trim().toLowerCase().split(/\s+/).slice(0, 5)) {
      where.push('searchText LIKE ?');
      args.push(`%${term}%`);
    }
  }
  if (q.brand) { where.push('brand = ?'); args.push(q.brand); }
  if (q.category) { where.push('category = ?'); args.push(q.category); }
  if (q.withCurrents) where.push('(quiescentMa IS NOT NULL OR alarmMa IS NOT NULL)');

  args.push(q.limit ?? 200);
  return db.getAllAsync<CatalogueItem>(
    `SELECT * FROM catalogue_item ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY brand, category, partNumber LIMIT ?`,
    ...args,
  );
}

export async function catalogueBrands(): Promise<{ brand: string; count: number }[]> {
  const db = await getDb();
  return db.getAllAsync<{ brand: string; count: number }>(
    'SELECT brand, COUNT(*) AS count FROM catalogue_item GROUP BY brand ORDER BY count DESC',
  );
}

export async function catalogueCategories(brand?: string): Promise<{ category: string; count: number }[]> {
  const db = await getDb();
  return brand
    ? db.getAllAsync<{ category: string; count: number }>(
        'SELECT category, COUNT(*) AS count FROM catalogue_item WHERE brand = ? GROUP BY category ORDER BY count DESC',
        brand,
      )
    : db.getAllAsync<{ category: string; count: number }>(
        'SELECT category, COUNT(*) AS count FROM catalogue_item GROUP BY category ORDER BY count DESC',
      );
}

export async function catalogueCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM catalogue_item');
  return row?.n ?? 0;
}

export async function getCatalogueItem(id: string): Promise<CatalogueItem | null> {
  const db = await getDb();
  return (await db.getFirstAsync<CatalogueItem>('SELECT * FROM catalogue_item WHERE id = ?', id)) ?? null;
}

/** Exact part number lookup, for scanning and for "what is this?". */
export async function findByPartNumber(partNumber: string): Promise<CatalogueItem[]> {
  const db = await getDb();
  const p = partNumber.trim();
  return db.getAllAsync<CatalogueItem>(
    'SELECT * FROM catalogue_item WHERE partNumber = ? OR partNumber LIKE ? ORDER BY brand LIMIT 25',
    p, `%${p}%`,
  );
}
