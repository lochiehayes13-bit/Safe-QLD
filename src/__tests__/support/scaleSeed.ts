import type { NodeSqliteDb } from './nodeSqlite';

/**
 * The office, on one phone, at the size it actually is.
 *
 * Every read a screen makes is fast on the twenty rows a test writes and slow
 * on the four and a half thousand the owner's phone holds, and nothing in the
 * suite could tell the two apart. So this builds a database at the volumes
 * that came down from the live Simpro build — 4,562 jobs, 3,059 sites, 12,568
 * customer assets, 2,482 customers, 970 quotes, 2,232 invoices and some
 * thirty-one thousand routine schedule rows — and the scale test times the
 * screens' reads against it.
 *
 * The values are invented. Nothing here is a real customer, a real site or a
 * real address: the shape and the size are what matter, and a fixture that
 * carried the book's actual names would be the book, checked in.
 *
 * The generator is a fixed-seed LCG rather than Math.random, so two runs
 * measure the same database and a timing that moves means the query moved.
 */

export const SCALE = {
  sites: 3059,
  customers: 2482,
  jobs: 4562,
  assets: 12568,
  /** Three or four routines on most register assets: the real import wrote ~31,000. */
  assetSchedules: 31000,
  quotes: 970,
  invoices: 2232,
  defects: 1400,
  /** Panels and points only exist where somebody imported a panel file. */
  panels: 260,
  points: 22000,
  /** A month of the office's schedule, the window the sync keeps. */
  scheduleBlocks: 1400,
  timesheets: 30,
} as const;

/** The Queensland day everything is generated around, so "today" is a fixed day. */
export const TODAY = '2026-09-03';

/** The person the phone belongs to, for the Mine filter. */
export const ME = { id: '17', name: 'Dale Whitmore' };

const STAFF = [
  ME,
  { id: '18', name: 'Corey Nankervis' }, { id: '19', name: 'Brett Alderson' },
  { id: '20', name: 'Hayden Mullins' }, { id: '21', name: 'Sam Okafor' },
  { id: '22', name: 'Tim Ruddick' }, { id: '23', name: 'Josh Tanevski' },
  { id: '24', name: 'Nick Farrelly' }, { id: '25', name: 'Wes Kimball' },
  { id: '26', name: 'Aaron Blythe' }, { id: '27', name: 'Ravi Chandran' },
  { id: '28', name: 'Marcus Hoy' },
];

/** Simpro's stages, in roughly the proportions a five-year book carries. */
const STAGES: { stage: string; weight: number }[] = [
  { stage: 'Pending', weight: 8 },
  { stage: 'Progress', weight: 7 },
  { stage: 'Complete', weight: 25 },
  { stage: 'Invoiced', weight: 35 },
  { stage: 'Archived', weight: 25 },
];

const CLOSED = new Set(['complete', 'invoiced', 'archived']);

const SUBURBS = [
  'Newstead', 'Woolloongabba', 'Chermside', 'Cleveland', 'Ipswich', 'Springwood', 'Toowong',
  'Nundah', 'Carindale', 'Redbank', 'Loganholme', 'Caboolture', 'Strathpine', 'Wynnum',
];
const STREETS = ['Wharf', 'Baldwin', 'Emsworth', 'Kingsford', 'Marlowe', 'Petrie', 'Sandgate', 'Turbot', 'Vulture', 'Hale'];
const PREFIX = ['Harbourline', 'Baldwin Living', 'Storage Choice', 'Luggage Direct', 'Kingsford Plaza', 'Northgate Works',
  'Riverbend Estate', 'Cathedral Chambers', 'Milton Reach', 'Pinelands', 'Everton Village', 'Sunnybank Central'];
const SUFFIX = ['Apartments', 'Body Corporate', 'Industrial', 'Retail', 'Depot', 'Chambers', 'Terraces', 'Warehouse', 'Precinct'];
const JOB_TITLES = ['Six-monthly routine', 'Annual routine', 'Monthly routine', 'Callout — panel in fault',
  'Extinguisher service', 'Emergency lighting 6-monthly', 'Hydrant flow test', 'Repair quote works',
  'Detector replacement', 'Baseline data test'];
const TYPES = ['Service', 'Project', 'Prepaid'];
const COLOURS = ['#f5a623', '#4a90d9', '#7ed321', '#d0021b', '#9013fe', '#50e3c2'];
const SYSTEMS = ['detection', 'suppression', 'extinguisher', 'emergency-lighting', 'hydrant', 'hose-reel', 'passive'];
const ASSET_TYPES = ['detector', 'panel', 'extinguisher', 'emergency-light', 'hydrant', 'hose-reel', 'fire-door', 'sprinkler-head'];
const FREQUENCIES = ['monthly', 'six-monthly', 'annual', 'five-yearly'];

/** A deterministic pseudo-random source. Same database every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A day n days either side of TODAY, as yyyy-mm-dd. */
function day(offset: number): string {
  const ms = Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Filler of a given length, so a row is the weight a real one is. */
function filler(rand: () => number, length: number): string {
  const words = ['riser', 'level', 'panel', 'zone', 'isolate', 'attend', 'sprinkler', 'booster', 'occupier',
    'reinstate', 'monitoring', 'confirm', 'access', 'tenancy', 'contractor', 'test', 'report', 'defect'];
  let out = '';
  while (out.length < length) out += `${words[Math.floor(rand() * words.length)]!} `;
  return out.slice(0, length).trim();
}

export interface SeededScale {
  /** A site with a lot of assets on it, for the register screens. */
  bigSiteId: string;
  /** A site with a handful of jobs, for the jobs-at-a-site read. */
  siteId: string;
  customerExternalId: string;
  /** A word that matches a few hundred jobs, as a technician's search does. */
  searchTerm: string;
  /** An office job number that exists, for the number-first search. */
  jobNumber: string;
}

/**
 * Fills an already-migrated database at the volumes above.
 *
 * Written as raw inserts in one transaction rather than through the
 * repositories: the repositories are what is being measured, and running
 * fifty thousand of their upserts to build the fixture would take longer than
 * the measurement.
 */
export function seedScale(db: NodeSqliteDb): SeededScale {
  const rand = lcg(20260903);
  const raw = db.raw;

  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const stageOf = (): string => {
    const total = STAGES.reduce((n, s) => n + s.weight, 0);
    let r = rand() * total;
    for (const s of STAGES) { r -= s.weight; if (r <= 0) return s.stage; }
    return 'Archived';
  };

  raw.exec('BEGIN');

  // ---- Sites, and the customers they belong to -----------------------------
  const site = raw.prepare(
    `INSERT INTO site (id,name,address,suburb,state,postcode,clientName,siteRef,notes,
       contactName,contactEmail,contactWorkPhone,contactMobile,externalId,externalSource,
       customerExternalId,publicNotes,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const siteIds: string[] = [];
  for (let i = 0; i < SCALE.sites; i++) {
    const id = `site-${i}`;
    siteIds.push(id);
    const name = `${pick(PREFIX)} ${pick(SUFFIX)} ${i}`;
    site.run(
      id, name, `${1 + Math.floor(rand() * 400)} ${pick(STREETS)} St`, pick(SUBURBS), 'QLD',
      String(4000 + Math.floor(rand() * 500)), `${pick(PREFIX)} Pty Ltd`, `SR-${i}`,
      filler(rand, 90), 'Site manager', `site${i}@example.invalid`, '07 3000 0000', '0400 000 000',
      String(9000 + i), 'simpro', String(i % SCALE.customers), filler(rand, 140), '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    );
  }

  const customer = raw.prepare(
    `INSERT INTO customer (externalId,customerKind,name,phone,email,address,suburb,state,postcode,
       customerType,archived,notes,tagsJson,sitesJson,contactsJson,dateModified,syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < SCALE.customers; i++) {
    customer.run(
      String(i), i % 9 === 0 ? 'Individual' : 'Company', `${pick(PREFIX)} ${pick(SUFFIX)} Pty Ltd ${i}`,
      '07 3000 0000', `acc${i}@example.invalid`, `${1 + Math.floor(rand() * 400)} ${pick(STREETS)} St`,
      pick(SUBURBS), 'QLD', String(4000 + Math.floor(rand() * 500)), 'Strata', i % 40 === 0 ? 1 : 0,
      filler(rand, 60), '["Strata"]',
      JSON.stringify([{ id: String(i), name: `Site ${i}` }]),
      JSON.stringify([{ id: '1', name: 'Accounts', email: `acc${i}@example.invalid` }]),
      '2026-08-01T00:00:00+10:00', '2026-09-01T00:00:00.000Z',
    );
  }

  // ---- Jobs ---------------------------------------------------------------
  const job = raw.prepare(
    `INSERT INTO job (id,externalId,siteId,siteName,customerName,title,jobType,stage,priority,
       scheduledFor,dueAt,technician,address,status,completedAt,notes,createdAt,updatedAt,
       orderNo,requestNo,statusName,statusColor,stageRaw,jobTypeRaw,customerExternalId,siteExternalId,
       siteContactJson,techniciansJson,tagsJson,projectManager,descriptionText,notesText,completedDate,
       totalExTaxCents,totalIncTaxCents,dateModified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const openJobNumbers: string[] = [];
  for (let i = 0; i < SCALE.jobs; i++) {
    const externalId = String(40000 + i);
    const siteIndex = Math.floor(rand() * SCALE.sites);
    const stage = stageOf();
    const closed = CLOSED.has(stage.toLowerCase());
    // Five years of work, weighted to the recent end the way a live book is.
    const offset = closed ? -Math.floor(rand() * 1800) : Math.floor(rand() * 40) - 25;
    const crew = [pick(STAFF), ...(rand() < 0.25 ? [pick(STAFF)] : [])];
    if (!closed) openJobNumbers.push(externalId);
    job.run(
      `simpro-${externalId}`, externalId, siteIds[siteIndex]!, `${pick(PREFIX)} ${pick(SUFFIX)} ${siteIndex}`,
      `${pick(PREFIX)} Pty Ltd ${siteIndex % SCALE.customers}`, pick(JOB_TITLES), pick(TYPES), stage,
      rand() < 0.05 ? 'urgent' : rand() < 0.2 ? 'high' : 'normal',
      day(offset), rand() < 0.4 ? day(offset + 14) : null,
      crew.map((s) => s.name).join(', '), `${1 + Math.floor(rand() * 400)} ${pick(STREETS)} St`,
      closed ? 'complete' : 'scheduled', closed && rand() < 0.1 ? `${day(offset)}T04:12:00.000Z` : null,
      null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
      `PO-${Math.floor(rand() * 90000)}`, `RQ-${Math.floor(rand() * 90000)}`,
      stage === 'Progress' ? 'On site' : stage, pick(COLOURS), stage, pick(TYPES),
      String(siteIndex % SCALE.customers), String(9000 + siteIndex),
      JSON.stringify({ id: '4', name: 'Building manager', mobile: '0400 000 000', email: 'bm@example.invalid' }),
      JSON.stringify(crew.map((s) => ({ id: s.id, name: s.name }))),
      '["Strata","Routine"]', pick(STAFF).name,
      // The two long columns the list never showed and always carried.
      filler(rand, 420), rand() < 0.35 ? filler(rand, 260) : null,
      closed ? day(offset) : null,
      Math.floor(rand() * 800000), Math.floor(rand() * 900000),
      `${day(offset)}T09:00:00+10:00`,
    );
  }

  // ---- Quotes and invoices -------------------------------------------------
  const quote = raw.prepare(
    `INSERT INTO simpro_quote (externalId,name,descriptionText,customerExternalId,customerName,
       siteExternalId,siteId,siteName,stage,statusName,statusColor,dateIssued,orderNo,isClosed,
       jobExternalId,totalExTaxCents,totalIncTaxCents,techniciansJson,tagsJson,dateModified,syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < SCALE.quotes; i++) {
    const siteIndex = Math.floor(rand() * SCALE.sites);
    const closed = rand() < 0.55;
    const converted = !closed && rand() < 0.3;
    quote.run(
      String(20000 + i), `${pick(JOB_TITLES)} quote`, filler(rand, 380), String(siteIndex % SCALE.customers),
      `${pick(PREFIX)} Pty Ltd ${siteIndex % SCALE.customers}`, String(9000 + siteIndex), siteIds[siteIndex]!,
      `${pick(PREFIX)} ${pick(SUFFIX)} ${siteIndex}`, closed ? 'Complete' : pick(['Pending', 'Progress', 'Approved']),
      closed ? 'Closed' : 'Open', pick(COLOURS), day(-Math.floor(rand() * 900)), `PO-${Math.floor(rand() * 90000)}`,
      closed ? 1 : 0, converted ? String(40000 + Math.floor(rand() * SCALE.jobs)) : null,
      Math.floor(rand() * 600000), Math.floor(rand() * 700000), '[]', '["Strata"]',
      `${day(-Math.floor(rand() * 900))}T09:00:00+10:00`, '2026-09-01T00:00:00.000Z',
    );
  }

  const invoice = raw.prepare(
    `INSERT INTO invoice (externalId,invoiceType,customerExternalId,customerName,dateIssued,stage,
       statusName,isPaid,datePaid,dueDate,orderNo,descriptionText,totalExTaxCents,totalIncTaxCents,
       amountAppliedCents,balanceDueCents,dateModified,syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const invoiceJob = raw.prepare(
    'INSERT OR IGNORE INTO invoice_job (invoiceExternalId,jobExternalId,jobType,description,totalExTaxCents,totalIncTaxCents) VALUES (?,?,?,?,?,?)',
  );
  for (let i = 0; i < SCALE.invoices; i++) {
    const id = String(70000 + i);
    const issued = day(-Math.floor(rand() * 730));
    const paid = rand() < 0.86;
    const total = Math.floor(rand() * 500000);
    invoice.run(
      id, 'Invoice', String(Math.floor(rand() * SCALE.customers)),
      `${pick(PREFIX)} Pty Ltd ${Math.floor(rand() * SCALE.customers)}`, issued, paid ? 'Paid' : 'Approved',
      paid ? 'Paid' : 'Unpaid', paid ? 1 : 0, paid ? issued : null, day(-Math.floor(rand() * 730) + 30),
      `PO-${Math.floor(rand() * 90000)}`, filler(rand, 200), total, Math.round(total * 1.1),
      paid ? Math.round(total * 1.1) : 0, paid ? 0 : Math.round(total * 1.1),
      `${issued}T09:00:00+10:00`, '2026-09-01T00:00:00.000Z',
    );
    const bills = 1 + (rand() < 0.2 ? 1 : 0);
    for (let k = 0; k < bills; k++) {
      invoiceJob.run(id, String(40000 + Math.floor(rand() * SCALE.jobs)), 'Service', filler(rand, 40), total, Math.round(total * 1.1));
    }
  }

  // ---- The asset register --------------------------------------------------
  const assetType = raw.prepare(
    'INSERT OR IGNORE INTO asset_type (id,label,system,attributes,sortIndex) VALUES (?,?,?,?,?)',
  );
  ASSET_TYPES.forEach((id, i) => assetType.run(id, id, SYSTEMS[i % SYSTEMS.length]!, '[]', i));

  const asset = raw.prepare(
    `INSERT INTO asset (id,siteId,assetTypeId,code,name,level,room,manufacturer,model,serial,
       installedDate,status,attributes,lastServicedAt,lastResult,nextDueAt,openDefects,notes,
       externalId,externalSource,walkOrder,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // One site carries a tenth of the register, the way a hospital or a
  // university campus does on the real book.
  const bigSiteId = siteIds[0]!;
  for (let i = 0; i < SCALE.assets; i++) {
    const siteId = i < SCALE.assets / 10 ? bigSiteId : siteIds[Math.floor(rand() * SCALE.sites)]!;
    asset.run(
      `asset-${i}`, siteId, pick(ASSET_TYPES), `SQ-DET-${String(i).padStart(7, '0')}`,
      `${pick(ASSET_TYPES)} ${i}`, `Level ${Math.floor(rand() * 12)}`, `Room ${Math.floor(rand() * 90)}`,
      'Pertronic', `M-${Math.floor(rand() * 900)}`, `SN${Math.floor(rand() * 9000000)}`,
      day(-Math.floor(rand() * 4000)), 'in-service', '{"loop":1,"address":12}',
      `${day(-Math.floor(rand() * 200))}T00:00:00.000Z`, rand() < 0.9 ? 'pass' : 'fail',
      day(Math.floor(rand() * 200) - 40), rand() < 0.06 ? 1 : 0, filler(rand, 50),
      String(500000 + i), 'simpro', i % 400, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    );
  }

  const schedule = raw.prepare(
    `INSERT OR IGNORE INTO asset_schedule (id,assetId,frequency,nextDueAt,lastDoneAt,lastDonePrecision,
       lastDoneRaw,source,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < SCALE.assetSchedules; i++) {
    const assetIndex = i % SCALE.assets;
    schedule.run(
      `sched-${i}`, `asset-${assetIndex}`, FREQUENCIES[Math.floor(i / SCALE.assets) % FREQUENCIES.length]!,
      day(Math.floor(rand() * 300) - 60), day(-Math.floor(rand() * 400)), 'day', 'Jun-25',
      'register-import', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    );
  }

  // ---- Panels, points and defects ------------------------------------------
  const panel = raw.prepare(
    'INSERT INTO panel (id,siteId,name,brand,model,nodeNumber,location,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < SCALE.panels; i++) {
    panel.run(`panel-${i}`, siteIds[i % SCALE.sites]!, `FIP ${i}`, 'Pertronic', 'F120', 1, 'Ground floor riser', 'import', '', '');
  }
  const point = raw.prepare(
    'INSERT INTO point (id,panelId,loopNumber,address,pointRef,text,deviceTypeRaw,deviceType,zoneNumber,zoneText,unused) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < SCALE.points; i++) {
    point.run(`point-${i}`, `panel-${i % SCALE.panels}`, 1 + (i % 4), i % 240, `L1.${i % 240}`,
      `${pick(SUBURBS)} ${pick(STREETS)} level ${i % 12}`, 'PHOTO', 'smoke', 1 + (i % 20), `Zone ${1 + (i % 20)}`, 0);
  }
  const defect = raw.prepare(
    `INSERT INTO defect (id,siteId,location,description,severity,status,raisedAt,photos,notes,
       qldLimbInoperable,qldLimbAdverseImpact,as1851Class)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < SCALE.defects; i++) {
    defect.run(`defect-${i}`, siteIds[Math.floor(rand() * SCALE.sites)]!, `Level ${i % 12} riser`,
      filler(rand, 120), rand() < 0.15 ? 'critical' : 'non-critical', rand() < 0.4 ? 'open' : 'rectified',
      `${day(-Math.floor(rand() * 600))}T04:00:00.000Z`, '[]', filler(rand, 60), 0, 0, 'non-critical');
  }

  // ---- The office's schedule ----------------------------------------------
  const block = raw.prepare(
    'INSERT INTO schedule (id,jobId,staffId,staffName,date,startTime,endTime,type,syncedAt) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < SCALE.scheduleBlocks; i++) {
    const who = pick(STAFF);
    // A quarter of them on today, so the Today filter and the home strip both
    // have something real to find.
    const on = i % 4 === 0 ? TODAY : day(Math.floor(rand() * 30) - 15);
    block.run(`block-${i}`, openJobNumbers.length ? openJobNumbers[i % openJobNumbers.length]! : null,
      who.id, who.name, on, '07:00', '15:00', 'Job', '2026-09-01T00:00:00.000Z');
  }

  // ---- Timesheets ----------------------------------------------------------
  const sheet = raw.prepare(
    `INSERT INTO timesheet (id,employeeName,vehicleRego,kilometerReading,weekStarting,entries,
       managerName,checkedBy,status,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < SCALE.timesheets; i++) {
    const entries = Array.from({ length: 12 }, (_, k) => ({
      id: `e-${i}-${k}`, date: day(-i * 7 - (k % 5)), jobNumber: String(40000 + Math.floor(rand() * SCALE.jobs)),
      siteName: `${pick(PREFIX)} ${pick(SUFFIX)}`, startTime: '07:00', finishTime: '15:30', hourKind: 'normal', extras: [],
    }));
    sheet.run(`sheet-${i}`, ME.name, 'ABC123', '120000', day(-i * 7 - 7), JSON.stringify(entries),
      'Office', '', i === 0 ? 'draft' : 'sent', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  }

  raw.exec('COMMIT');
  // No ANALYZE: a technician's phone has never run one, and a plan chosen
  // from statistics this fixture has and the handset does not would be a
  // measurement of a database nobody owns.

  return {
    bigSiteId,
    siteId: siteIds[7]!,
    customerExternalId: '12',
    searchTerm: 'routine',
    jobNumber: openJobNumbers[0] ?? '40000',
  };
}
