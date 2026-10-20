import { getDb, inTransaction, nowIso } from './index';

/**
 * The office's asset types, as the phone last read them.
 *
 * A create in Simpro names a type by the office's id and every value by the
 * office's field id, and the phone's own type catalogue (@/seed/assetTypes)
 * knows neither. Nineteen rows, replaced whole whenever they are read; the
 * screens read them here and ask @/simpro/assetTypes to fill the table when
 * it is empty.
 */

export interface OfficeCustomField {
  id: number;
  name: string;
  /** Text, Numeric, Date, List or Barcode on the live build. */
  type: string;
  /** The choices of a List field, where the office gave any. */
  listItems: string[];
  /** True where the office locked the field: read on the phone, never written. */
  locked?: boolean;
}

export interface OfficeAssetType {
  id: string;
  name: string;
  customFields: OfficeCustomField[];
}

interface Row { externalId: string; name: string; customFieldsJson: string }

function fields(json: string): OfficeCustomField[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as OfficeCustomField[]) : [];
  } catch {
    return [];
  }
}

export async function listOfficeAssetTypes(): Promise<OfficeAssetType[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT externalId, name, customFieldsJson FROM simpro_asset_type ORDER BY name COLLATE NOCASE');
  return rows.map((r) => ({ id: r.externalId, name: r.name, customFields: fields(r.customFieldsJson) }));
}

/** Replaces the whole list: a type the office has removed is gone here too. */
export async function replaceOfficeAssetTypes(types: readonly OfficeAssetType[]): Promise<void> {
  const db = await getDb();
  const at = nowIso();
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM simpro_asset_type');
    for (const t of types) {
      await db.runAsync(
        'INSERT INTO simpro_asset_type (externalId,name,customFieldsJson,syncedAt) VALUES (?,?,?,?)',
        t.id, t.name, JSON.stringify(t.customFields), at,
      );
    }
  });
}
