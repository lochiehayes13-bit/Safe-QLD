import { getDb, inTransaction, newId, nowIso } from '@/db';
import {
  DEFAULT_EXCLUSIONS, DEFAULT_VALIDITY_DAYS, canTransition, editRefusal, expiryFor, qldDate,
  type Confidence, type PriceSource, type Quote, type QuoteLine, type QuoteSection,
  type QuoteStatus, type UnpriceableDefect,
} from '@/domain/quote';
import { GST } from '@/domain/rates';

/**
 * Storing quotes and their lines.
 *
 * The rules about what a quote may do live in domain/quote.ts, not here — this
 * layer's job is to refuse to write anything those rules refuse, and to say why
 * in the same words the screen would. A repository that silently accepted an
 * edit to an issued quote would make the state machine decorative.
 *
 * Lines are replaced wholesale rather than merged. A quote is rebuilt from its
 * defects every time the technician ticks one on or off, and merging a rebuild
 * into what was there leaves lines behind from defects no longer on the quote.
 */

interface QuoteRow {
  id: string;
  siteId: string;
  reference: string;
  jobReference: string;
  clientName: string;
  siteName: string;
  siteAddress: string;
  contactName: string;
  preparedBy: string;
  status: string;
  validityDays: number;
  issuedAt: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  declinedAt: string | null;
  discountCents: number;
  discountReason: string;
  unpriceable: string;
  scopeNote: string;
  exclusions: string;
  notes: string;
  taxRate: number;
  createdAt: string;
  updatedAt: string;
}

interface QuoteLineRow {
  id: string;
  quoteId: string;
  section: string;
  sortIndex: number;
  description: string;
  unit: string;
  quantity: number;
  unitCents: number | null;
  sourceKind: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourceConf: string | null;
  fromCodes: string;
  defectCount: number;
}

const STATUSES: QuoteStatus[] = ['draft', 'issued', 'accepted', 'declined', 'expired'];
const SECTIONS: QuoteSection[] = ['materials', 'labour'];
const UNITS: QuoteLine['unit'][] = ['ea', 'hr', 'm', 'lot'];

/** An unrecognised stored value is not quietly mapped to a plausible one. */
function readStatus(v: string): QuoteStatus {
  const found = STATUSES.find((s) => s === v);
  if (!found) throw new Error(`Quote has an unrecognised status "${v}".`);
  return found;
}

/**
 * The section a stored line belongs to.
 *
 * Refused rather than defaulted for the same reason as the status. Defaulting
 * to materials would move a labour line into the materials subtotal and change
 * two figures on a document a client is holding, and it would do it silently.
 */
function readSection(v: string): QuoteSection {
  const found = SECTIONS.find((s) => s === v);
  if (!found) throw new Error(`A quote line has an unrecognised section "${v}".`);
  return found;
}

/** Likewise the unit: "ea" against hours quotes a day's labour as one item. */
function readUnit(v: string): QuoteLine['unit'] {
  const found = UNITS.find((u) => u === v);
  if (!found) throw new Error(`A quote line has an unrecognised unit "${v}".`);
  return found;
}

function readJsonArray<T>(raw: string, what: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // A corrupt column loses that one list rather than the whole quote. The
    // money is in its own columns and is unaffected.
    console.warn(`Quote ${what} could not be read and has been treated as empty.`);
    return [];
  }
}

const list = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * The stored list of defects the quote could not price.
 *
 * Read back defensively because it is JSON in a column: anything that is not an
 * object with a location and a description would print as "undefined" on the
 * client's copy, which is worse than the entry being missing. What survives is
 * shown; what does not is said out loud rather than dropped in silence.
 */
function readUnpriceable(raw: string): UnpriceableDefect[] {
  const rows = readJsonArray<Partial<UnpriceableDefect>>(raw, 'list of defects it could not price');
  const out: UnpriceableDefect[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.reason !== 'string') {
      console.warn('A quote carried an entry in its unpriced-defect list that could not be read.');
      continue;
    }
    out.push({
      defectId: String(row.defectId ?? ''),
      defectCode: row.defectCode,
      location: String(row.location ?? ''),
      description: String(row.description ?? ''),
      reason: row.reason as UnpriceableDefect['reason'],
    });
  }
  return out;
}

function toLine(r: QuoteLineRow): QuoteLine {
  // A stored line with a source kind but no label would be a figure with no
  // traceable origin, which is the one thing a quote line may not be.
  const source: PriceSource | undefined = r.sourceKind && r.sourceLabel
    ? {
      kind: r.sourceKind as PriceSource['kind'],
      label: r.sourceLabel,
      confidence: (r.sourceConf ?? 'low') as Confidence,
      url: r.sourceUrl ?? undefined,
    }
    : undefined;

  return {
    id: r.id,
    section: readSection(r.section),
    description: r.description,
    unit: readUnit(r.unit),
    quantity: r.quantity,
    // NULL means nobody has priced it. It must not become zero here.
    unitCents: r.unitCents === null ? undefined : r.unitCents,
    source: r.unitCents === null ? undefined : source,
    fromCodes: list(r.fromCodes),
    defectCount: r.defectCount,
  };
}

function toQuote(r: QuoteRow, lines: QuoteLine[]): Quote {
  return {
    id: r.id,
    siteId: r.siteId,
    reference: r.reference,
    jobReference: r.jobReference || undefined,
    clientName: r.clientName,
    siteName: r.siteName,
    siteAddress: r.siteAddress || undefined,
    contactName: r.contactName || undefined,
    preparedBy: r.preparedBy,
    status: readStatus(r.status),
    validityDays: r.validityDays,
    issuedAt: r.issuedAt ?? undefined,
    expiresAt: r.expiresAt ?? undefined,
    acceptedAt: r.acceptedAt ?? undefined,
    acceptedBy: r.acceptedBy ?? undefined,
    declinedAt: r.declinedAt ?? undefined,
    discountCents: r.discountCents,
    discountReason: r.discountReason || undefined,
    lines,
    unpriceable: readUnpriceable(r.unpriceable),
    scopeNote: r.scopeNote || undefined,
    exclusions: readJsonArray<string>(r.exclusions, 'exclusions'),
    notes: r.notes || undefined,
    taxRate: r.taxRate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type NewQuote = Partial<Omit<Quote, 'id' | 'createdAt' | 'updatedAt'>> & Pick<Quote, 'siteId'>;

export async function createQuote(input: NewQuote): Promise<Quote> {
  // A quote starts as a draft and is moved along by setQuoteStatus, which
  // checks the move is legal and stamps the dates that go with it. Letting a
  // caller insert one straight in as issued or accepted would put a quote in
  // the table with no issue date, no expiry and nothing having checked it.
  if (input.status && input.status !== 'draft') {
    throw new Error(
      `A quote is created as a draft, not as ${input.status}. Save it, then issue it — issuing is `
      + 'what sets the date the price holds good until.',
    );
  }
  const db = await getDb();
  const at = nowIso();
  const record: Quote = {
    id: newId(),
    reference: '',
    clientName: '',
    siteName: '',
    preparedBy: '',
    status: 'draft',
    validityDays: DEFAULT_VALIDITY_DAYS,
    discountCents: 0,
    lines: [],
    unpriceable: [],
    exclusions: [...DEFAULT_EXCLUSIONS],
    taxRate: GST,
    createdAt: at,
    updatedAt: at,
    ...input,
  };

  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO quote
         (id, siteId, reference, jobReference, clientName, siteName, siteAddress, contactName,
          preparedBy, status, validityDays, issuedAt, expiresAt, acceptedAt, acceptedBy, declinedAt,
          discountCents, discountReason, unpriceable, scopeNote, exclusions, notes, taxRate,
          createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.siteId, record.reference, record.jobReference ?? '', record.clientName,
        record.siteName, record.siteAddress ?? '', record.contactName ?? '', record.preparedBy,
        record.status, record.validityDays, record.issuedAt ?? null, record.expiresAt ?? null,
        record.acceptedAt ?? null, record.acceptedBy ?? null, record.declinedAt ?? null,
        Math.round(record.discountCents), record.discountReason ?? '',
        JSON.stringify(record.unpriceable), record.scopeNote ?? '',
        JSON.stringify(record.exclusions), record.notes ?? '', record.taxRate,
        record.createdAt, record.updatedAt,
      ],
    );
    await writeLines(db, record.id, record.lines);
  });

  return record;
}

type Db = Awaited<ReturnType<typeof getDb>>;

async function writeLines(db: Db, quoteId: string, lines: QuoteLine[]): Promise<void> {
  await db.runAsync('DELETE FROM quote_line WHERE quoteId = ?', [quoteId]);
  let sortIndex = 0;
  for (const line of lines) {
    await db.runAsync(
      `INSERT INTO quote_line
         (id, quoteId, section, sortIndex, description, unit, quantity, unitCents,
          sourceKind, sourceLabel, sourceUrl, sourceConf, fromCodes, defectCount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        // Line ids are stable per quote, not globally, so the same material on
        // two quotes does not collide.
        `${quoteId}:${line.id}`, quoteId, line.section, sortIndex++, line.description, line.unit,
        line.quantity,
        // Whole cents or nothing. Math.round here guards against a float
        // arriving from a screen; undefined stays NULL and never becomes zero.
        line.unitCents === undefined ? null : Math.round(line.unitCents),
        line.source?.kind ?? null, line.source?.label ?? null, line.source?.url ?? null,
        line.source?.confidence ?? null,
        line.fromCodes.join(','), line.defectCount,
      ],
    );
  }
}

export async function getQuote(id: string): Promise<Quote | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<QuoteRow>('SELECT * FROM quote WHERE id = ?', [id]);
  if (!row) return null;
  return toQuote(row, await listQuoteLines(id));
}

export async function listQuoteLines(quoteId: string): Promise<QuoteLine[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<QuoteLineRow>(
    `SELECT * FROM quote_line WHERE quoteId = ?
     ORDER BY CASE section WHEN 'materials' THEN 0 ELSE 1 END, sortIndex`,
    [quoteId],
  );
  // The stored id carries the quote id as a prefix so two quotes can hold the
  // same line; the domain sees the line's own key back.
  return rows.map((r) => toLine({ ...r, id: r.id.startsWith(`${quoteId}:`) ? r.id.slice(quoteId.length + 1) : r.id }));
}

/**
 * Quotes for a site, or every quote.
 *
 * Newest first by issue date, then by creation, so the drafts a technician is
 * part way through sit at the top with the quote they issued this morning.
 */
export async function listQuotes(siteId?: string): Promise<Quote[]> {
  const db = await getDb();
  const rows = siteId
    ? await db.getAllAsync<QuoteRow>(
      'SELECT * FROM quote WHERE siteId = ? ORDER BY COALESCE(issuedAt, createdAt) DESC', [siteId],
    )
    : await db.getAllAsync<QuoteRow>('SELECT * FROM quote ORDER BY COALESCE(issuedAt, createdAt) DESC');
  const out: Quote[] = [];
  for (const row of rows) out.push(toQuote(row, await listQuoteLines(row.id)));
  return out;
}

/**
 * The next sequence number for a site, for formatQuoteReference.
 *
 * Taken from the highest number the site has already used rather than from how
 * many quotes it has now. Counting hands a deleted quote's number to the next
 * one, and the reference index is unique, so the second quote to carry
 * Q-NPWTP-2026-004 does not save at all — the technician loses the quote they
 * just built and the client is holding the number.
 */
export async function nextQuoteSeq(siteId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ reference: string }>(
    'SELECT reference FROM quote WHERE siteId = ?', [siteId],
  );
  let highest = 0;
  for (const row of rows) {
    const m = /-(\d+)$/.exec(row.reference ?? '');
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return Math.max(highest, rows.length) + 1;
}

export type QuotePatch = Partial<Omit<Quote, 'id' | 'siteId' | 'createdAt' | 'updatedAt' | 'status'>>;

/**
 * Edits a draft.
 *
 * Refuses anything that is not a draft, with the reason the screen would give.
 * Status is deliberately not patchable here — moving a quote along goes through
 * the transition functions below, which check whether the move is allowed.
 */
export async function updateQuote(id: string, patch: QuotePatch): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<QuoteRow>('SELECT status FROM quote WHERE id = ?', [id]);
  if (!row) throw new Error('That quote no longer exists.');
  const refusal = editRefusal({ status: readStatus(row.status) });
  if (refusal) throw new Error(refusal);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const put = (col: string, value: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(value);
  };

  if (patch.reference !== undefined) put('reference', patch.reference);
  if (patch.jobReference !== undefined) put('jobReference', patch.jobReference ?? '');
  if (patch.clientName !== undefined) put('clientName', patch.clientName);
  if (patch.siteName !== undefined) put('siteName', patch.siteName);
  if (patch.siteAddress !== undefined) put('siteAddress', patch.siteAddress ?? '');
  if (patch.contactName !== undefined) put('contactName', patch.contactName ?? '');
  if (patch.preparedBy !== undefined) put('preparedBy', patch.preparedBy);
  if (patch.validityDays !== undefined) put('validityDays', Math.round(patch.validityDays));
  if (patch.discountCents !== undefined) put('discountCents', Math.round(patch.discountCents));
  if (patch.discountReason !== undefined) put('discountReason', patch.discountReason ?? '');
  if (patch.unpriceable !== undefined) put('unpriceable', JSON.stringify(patch.unpriceable));
  if (patch.scopeNote !== undefined) put('scopeNote', patch.scopeNote ?? '');
  if (patch.exclusions !== undefined) put('exclusions', JSON.stringify(patch.exclusions));
  if (patch.notes !== undefined) put('notes', patch.notes ?? '');
  if (patch.taxRate !== undefined) put('taxRate', patch.taxRate);

  await inTransaction(db, async () => {
    if (fields.length) {
      put('updatedAt', nowIso());
      await db.runAsync(`UPDATE quote SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    if (patch.lines !== undefined) {
      await writeLines(db, id, patch.lines);
      await db.runAsync('UPDATE quote SET updatedAt = ? WHERE id = ?', [nowIso(), id]);
    }
  });
}

export async function deleteQuote(id: string): Promise<void> {
  const db = await getDb();
  await inTransaction(db, async () => {
    // Lines cascade, but foreign keys are not on in every build, so they go
    // explicitly rather than being left orphaned.
    await db.runAsync('DELETE FROM quote_line WHERE quoteId = ?', [id]);
    await db.runAsync('DELETE FROM quote WHERE id = ?', [id]);
  });
}

/**
 * Moves a quote to a new status, or refuses with the reason.
 *
 * Every path in and out of a status goes through canTransition, so there is one
 * answer to "may this quote be accepted" and both the screen and the database
 * get it from the same place.
 */
export async function setQuoteStatus(
  id: string,
  to: QuoteStatus,
  options: { asAt?: string; acceptedBy?: string } = {},
): Promise<Quote> {
  const quote = await getQuote(id);
  if (!quote) throw new Error('That quote no longer exists.');

  const asAt = options.asAt ?? nowIso();
  const check = canTransition(quote, to, asAt);
  if (!check.allowed) throw new Error(check.reason ?? 'That change is not allowed.');

  const fields: string[] = ['status = ?', 'updatedAt = ?'];
  const values: (string | number | null)[] = [to, asAt];

  if (to === 'issued') {
    const expires = expiryFor(asAt, quote.validityDays);
    if (!expires) {
      throw new Error(
        `A validity of ${quote.validityDays} days cannot be turned into an expiry date. `
        + 'Set it to a whole number of days of at least one before issuing.',
      );
    }
    fields.push('issuedAt = ?', 'expiresAt = ?');
    values.push(asAt, expires);
  }
  if (to === 'accepted') {
    fields.push('acceptedAt = ?', 'acceptedBy = ?');
    // Who accepted is a fact about the acceptance, not a formality: "the client
    // accepted" is not something anyone can stand behind six months later.
    values.push(asAt, options.acceptedBy?.trim() || null);
  }
  if (to === 'declined') {
    fields.push('declinedAt = ?');
    values.push(asAt);
  }

  const db = await getDb();
  await db.runAsync(`UPDATE quote SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  return (await getQuote(id))!;
}

/**
 * Marks issued quotes past their date as expired.
 *
 * Run when the quote list is opened. An issued quote sitting a month past its
 * expiry still reads as live on a screen, and someone accepts it.
 */
export async function expireLapsedQuotes(asAt: string): Promise<string[]> {
  // The Queensland date, not the first ten characters of a UTC timestamp. At
  // eight on a Brisbane morning the slice is still yesterday, so a quote that
  // lapsed overnight would be left reading as live for another day — the exact
  // mistake domain/quote.ts exists to avoid.
  const today = qldDate(asAt);
  if (!today) {
    throw new Error(`"${asAt}" cannot be read as a date, so which quotes have lapsed is unknown.`);
  }
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM quote WHERE status = 'issued' AND expiresAt IS NOT NULL AND expiresAt < ?",
    [today],
  );
  const expired: string[] = [];
  for (const row of rows) {
    try {
      await setQuoteStatus(row.id, 'expired', { asAt });
      expired.push(row.id);
    } catch {
      // A quote the machine refuses to expire is left as it is rather than
      // forced. The refusal is the state machine doing its job.
    }
  }
  return expired;
}
