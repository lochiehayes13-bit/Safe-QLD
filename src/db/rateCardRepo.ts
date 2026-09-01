import { getDb, nowIso } from '@/db';
import type { HoursBand, LabourRate, ServiceFee } from '@/domain/rates';

/**
 * The rate card held on the device.
 *
 * Simpro is the record and it changes day to day, so this is a copy taken when
 * there was last a signal — never the truth, and the screens that show money
 * say when it was taken.
 *
 * Replaced wholesale rather than merged. A rate deleted or renamed in the
 * office system has to disappear here too: a stale rate that still selects is
 * worse than no rate, because a missing rate is reported and a wrong one is
 * silently used.
 */

export const RATE_SOURCE_SIMPRO = 'simpro';

export interface StoredRateCard {
  rates: LabourRate[];
  fees: ServiceFee[];
  /** When the card was pulled, or undefined when nothing has ever been pulled. */
  pulledAt?: string;
}

/** Replaces the whole card in one transaction, so a failed pull cannot half-apply. */
export async function saveRateCard(
  rates: LabourRate[],
  fees: ServiceFee[],
  source = RATE_SOURCE_SIMPRO,
): Promise<void> {
  const db = await getDb();
  const at = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM labour_rate WHERE source = ?', [source]);
    await db.runAsync('DELETE FROM service_fee WHERE source = ?', [source]);

    for (const r of rates) {
      await db.runAsync(
        `INSERT INTO labour_rate
           (id, name, sellCentsPerHour, taxRate, kind, hours, customerName, source, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${source}:${r.id}`, r.name, Math.round(r.sellCentsPerHour), r.taxRate,
          r.kind, r.hours, r.customerName ?? null, source, at,
        ],
      );
    }
    for (const f of fees) {
      await db.runAsync(
        `INSERT INTO service_fee
           (id, name, chargeCents, includedLabourMinutes, taxRate, hours, source, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${source}:${f.id}`, f.name, Math.round(f.chargeCents),
          Math.round(f.includedLabourMinutes), f.taxRate, f.hours, source, at,
        ],
      );
    }
  });
}

interface RateRow {
  id: string; name: string; sellCentsPerHour: number; taxRate: number;
  kind: string; hours: string; customerName: string | null; updatedAt: string;
}
interface FeeRow {
  id: string; name: string; chargeCents: number; includedLabourMinutes: number;
  taxRate: number; hours: string; updatedAt: string;
}

const band = (v: string): HoursBand => (v === 'after-hours' ? 'after-hours' : 'normal');

export async function loadRateCard(): Promise<StoredRateCard> {
  const db = await getDb();
  const rateRows = await db.getAllAsync<RateRow>('SELECT * FROM labour_rate ORDER BY name');
  const feeRows = await db.getAllAsync<FeeRow>('SELECT * FROM service_fee ORDER BY name');

  const rates: LabourRate[] = rateRows.map((r) => ({
    id: r.id,
    name: r.name,
    // Never stored, so never read. The device is not told what an hour costs.
    costCentsPerHour: 0,
    sellCentsPerHour: r.sellCentsPerHour,
    taxRate: r.taxRate,
    efficiencyMultiplier: 1,
    kind: r.kind === 'callout' ? 'callout' : 'labour',
    hours: band(r.hours),
    customerName: r.customerName ?? undefined,
  }));

  const fees: ServiceFee[] = feeRows.map((f) => ({
    id: f.id,
    name: f.name,
    chargeCents: f.chargeCents,
    includedLabourMinutes: f.includedLabourMinutes,
    taxRate: f.taxRate,
    hours: band(f.hours),
  }));

  const stamps = [...rateRows, ...feeRows].map((r) => r.updatedAt).filter(Boolean).sort();
  return { rates, fees, pulledAt: stamps[stamps.length - 1] };
}

/** Removes the pulled card, so the app falls back to the figures in Settings. */
export async function clearRateCard(source = RATE_SOURCE_SIMPRO): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM labour_rate WHERE source = ?', [source]);
  await db.runAsync('DELETE FROM service_fee WHERE source = ?', [source]);
}
