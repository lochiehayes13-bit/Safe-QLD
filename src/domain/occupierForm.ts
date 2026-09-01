/**
 * The occupier's statement, as the form the Queensland Development Code
 * actually prescribes.
 *
 * The app has been producing a lookalike and saying so on the page: "this is
 * not the regulator's approved form". That disclaimer was the right call while
 * the schedule was unread, but it costs the occupier a second document. They
 * sign ours on site, then go and copy the same answers onto the real one, and
 * the copy is where the errors get in — a row that gets skipped, a standard
 * that gets typed as "AS1851" against a fire door, a rectification date that
 * goes missing between the two pages.
 *
 * The disclaimer was also slightly wrong about what the real thing is. Section
 * 53(2) of the Building Fire Safety Regulation 2008 uses "the approved form",
 * but only for the critical defect notice. Section 55A, which is the occupier
 * statement, says the occupier must prepare a statement that **complies with
 * QDC part MP 6.1** — and MP 6.1 sets that form out in its own Schedule 2.
 * There is no separate approved form to go and find. Reproduce Schedule 2
 * faithfully and you have the statutory document, because the schedule is it.
 *
 * So this module holds the schedule, not a rendering of it:
 *
 *  - **Schedule 1** — the maintenance schedule for passive fire safety
 *    installations. Worth being precise about, because Schedule 1 is *not* a
 *    master list of prescribed installations, which is how it is often quoted.
 *    It is four passive installations, tabulated twice, at a different
 *    frequency depending on the building's BCA class. The list of installations
 *    a statement has to address is in Schedule 2, and only there.
 *  - **Schedule 2** — the occupier's statement itself: the header fields, the
 *    four columns, the twenty-one installations in the order the schedule
 *    prints them, the declaration sentence with each of its blanks, and the
 *    seven footnotes.
 *
 * On reproduction: Queensland Crown material published to be filled in and
 * lodged is reproduced here word for word, which is what makes the form the
 * form. Australian Standards are not. Where the schedule cites AS 1851:2005 the
 * citation is a clause number and nothing else; the method behind that number
 * is transcribed by the licence holder from their purchased copy.
 *
 * On the ten business days: section 55A(3) does not run from the day the
 * occupier signs. It runs from the day the occupier was **required to prepare**
 * the statement, which MP 6.1 A2(b) fixes as one year from the last statement
 * or from taking up occupation. A statement prepared three weeks late has a
 * deadline that has been running for three weeks, and an app that counts from
 * the signature quietly tells the occupier they have longer than they do. This
 * module counts from the statutory anchor where it knows it, falls back to the
 * signature only with the fallback named, and refuses when it knows neither.
 *
 * On public holidays: a business day under the Acts Interpretation Act 1954
 * excludes a public holiday "in the place in which any relevant act is to be or
 * may be done". Statewide Queensland holidays are tabulated here with their
 * source. District show holidays are not, and cannot be — they are appointed
 * per local government area, and the Royal Queensland Show holiday itself is
 * Brisbane-area only. Rather than guess, every count reports which holidays it
 * applied, which it could not, and the one fact that makes the answer safe to
 * work to anyway: a holiday we failed to skip can only move the true deadline
 * **later**, never earlier, so the date returned is never late.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low';

export type SourceId =
  | 'qdc-mp61'
  | 'bfsr-2008'
  | 'acts-interpretation'
  | 'qld-public-holidays'
  | 'qld-show-holidays'
  | 'bq-fire-safety-installations';

export interface Source {
  id: SourceId;
  /** What this source is relied on for, in one line. */
  what: string;
  /** The document, and the section or schedule within it. */
  ref: string;
  url: string;
  confidence: Confidence;
  /**
   * Why the confidence is what it is. Crown material published to be used is
   * not the same kind of fact as a page listing next year's holidays, and a
   * statement printed for a regulator should never treat them alike.
   */
  basis: string;
}

export const SOURCES: Record<SourceId, Source> = {
  'qdc-mp61': {
    id: 'qdc-mp61',
    what: 'The occupier statement form itself — Schedule 2 — and the passive maintenance schedule in Schedule 1, '
      + 'plus the yearly interval and two-year retention in A2(b) and A2(c)',
    ref: 'Queensland Development Code Mandatory Part 6.1 — Maintenance of fire safety installations, '
      + 'published 20/11/2008, commenced 1 January 2009. Schedules 1 and 2, performance criteria P1/P2, '
      + 'acceptable solutions A1/A2',
    url: 'https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code/mandatory-parts',
    confidence: 'high',
    basis: 'Queensland Crown material, published to be filled in and lodged. Reproduced verbatim, which is what '
      + 'makes the reproduction the form rather than a lookalike.',
  },
  'bfsr-2008': {
    id: 'bfsr-2008',
    what: 'The duties: who must prepare the statement, the ten business days to give the commissioner a copy, '
      + 'the two-year retention, what a critical defect is and the 24 hours to notify one',
    ref: 'Building Fire Safety Regulation 2008 (Qld), ss 49, 50, 53, 54, 55, 55A, 55B '
      + '(reprint 2C effective 1 January 2012)',
    url: 'https://www.legislation.qld.gov.au/view/html/inforce/current/sl-2008-0160',
    confidence: 'high',
    basis: 'Queensland subordinate legislation, read from the reprint. Section numbers and penalties are quoted; '
      + 'the obligations are stated in the regulation\'s own terms.',
  },
  'acts-interpretation': {
    id: 'acts-interpretation',
    what: 'What a business day is: not a Saturday, Sunday, or a public, special or bank holiday in the place '
      + 'where the act is to be done',
    ref: 'Acts Interpretation Act 1954 (Qld), schedule 1, definition of business day',
    url: 'https://www.legislation.qld.gov.au/view/html/inforce/current/act-1954-003',
    confidence: 'high',
    basis: 'The general definition that governs "business day" in section 55A(3), which does not define it itself. '
      + 'The "in the place" limb is why a district show holiday cannot be applied without knowing the locality.',
  },
  'qld-public-holidays': {
    id: 'qld-public-holidays',
    what: 'Statewide Queensland public holiday dates for 2025 to 2029, and the Brisbane-area Royal Queensland '
      + 'Show holiday, including the extra day added when Christmas or New Year falls on a weekend',
    ref: 'Queensland Government, Public holidays (dates for 2025, and the 2026–2029 table)',
    url: 'https://www.qld.gov.au/recreation/travel/holidays/public',
    confidence: 'high',
    basis: 'The state\'s own published dates, appointed under the Holidays Act 1983. Dates beyond the table are '
      + 'not yet appointed, so this module refuses to count into them rather than projecting the pattern.',
  },
  'qld-show-holidays': {
    id: 'qld-show-holidays',
    what: 'That show holidays are appointed per district and local government area, on dates spread from January '
      + 'to November, so there is no single statewide show holiday date',
    ref: 'Queensland Government, Show holiday dates',
    url: 'https://www.qld.gov.au/recreation/travel/holidays/show',
    confidence: 'high',
    basis: 'The state\'s own published tables. Relied on for the fact that the date is locality-dependent, which '
      + 'is the reason this module will not assume one.',
  },
  'bq-fire-safety-installations': {
    id: 'bq-fire-safety-installations',
    what: 'Where the copy goes: the regional Queensland Fire Department office, or the occupier statements mailbox',
    ref: 'Business Queensland, Fire safety installations (Queensland Development Code)',
    url: 'https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code/fire-safety-installations',
    confidence: 'medium',
    basis: 'A Queensland Government page, not the regulation. Lodgement addresses are administrative and change '
      + 'without amending the regulation, so confirm it before a first lodgement.',
  },
};

/** Every source behind a result, in the order a report should list them. */
export function citeSources(ids: SourceId[]): Source[] {
  const seen = new Set<SourceId>();
  const out: Source[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = SOURCES[id];
    if (s) out.push(s);
  }
  return out;
}

/**
 * Where a copy of the statement goes.
 *
 * Administrative rather than statutory — section 55A(3) says "the
 * commissioner" and stops there — so this is carried with its source and its
 * confidence rather than printed as though the regulation said it.
 */
export const COMMISSIONER_LODGEMENT = {
  who: 'The commissioner, Queensland Fire Department',
  how: 'The regional Queensland Fire Department office, or the occupier statements mailbox',
  email: 'occupier.statements@fire.qld.gov.au',
  sourceId: 'bq-fire-safety-installations' as SourceId,
  confidence: 'medium' as Confidence,
} as const;

// ---------------------------------------------------------------------------
// Dates
//
// All date arithmetic is anchored to UTC midnight and all dates are ISO
// yyyy-mm-dd. Queensland is UTC+10 with no daylight saving, so a local calendar
// day maps cleanly onto a UTC day as long as nothing here ever constructs a
// date from a local-time clock.
//
// Every date this module returns as a *value* is ISO, because the caller has to
// compare and store it. Every date this module writes into a *sentence* is
// d/m/yyyy, because those sentences are read by an occupier standing next to a
// fire panel and this app prints one date format.
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIsoDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = ISO_DATE.exec(iso);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  // Rejects 2026-02-30, which Date rolls forward rather than refusing.
  return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? d : undefined;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * d/m/yyyy, which is the only date format this app prints.
 *
 * Held here rather than taken from the export layer because the sentences this
 * module builds — "the copy went late", "signing late does not restart the ten
 * days" — are read by a person, and a person reading "2026-04-30" on a
 * Queensland form has to stop and work out which number is the month.
 */
export function formatAuDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : iso;
}

/**
 * Adds whole years, clamping 29 February into a non-leap year.
 *
 * A statement made on 29 February 2028 is due again on 28 February 2029, not on
 * 1 March. Rolling forward would put the next statement a day outside the "yearly"
 * that MP 6.1 A2(b)(ii) requires.
 */
function addYears(d: Date, years: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCFullYear(out.getUTCFullYear() + years);
  if (out.getUTCDate() !== day) out.setUTCDate(0);
  return out;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCMonth(out.getUTCMonth() + months);
  if (out.getUTCDate() < day) out.setUTCDate(0);
  return out;
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

// ---------------------------------------------------------------------------
// Schedule 1 — passive fire safety installations
// ---------------------------------------------------------------------------

/**
 * Which of Schedule 1's two tables a building falls under.
 *
 * Class 5, 6, 9a and 9c go in table 1 at six-monthly. Everything else the code
 * applies to goes in table 2 at yearly. Class 1a is neither: MP 6.1 does not
 * apply to a class 1a building at all.
 */
export type Schedule1Table = 1 | 2;

export interface Schedule1Item {
  /** Where it sits in the code: "Schedule 1, table 1, row 3". */
  ref: string;
  table: Schedule1Table;
  /** The building classes the table covers, as the schedule words them. */
  appliesToClasses: string;
  /** The installation name, verbatim from the schedule. */
  installation: string;
  /**
   * The AS 1851:2005 clause the schedule cites. A number and nothing else — the
   * clause's own text is copyright Standards Australia and is transcribed from
   * the purchased copy, never from here.
   */
  as1851Clause: string;
  /** The frequency as the schedule prints it. */
  requiredFrequency: string;
  /** The same frequency in months, for scheduling. */
  intervalMonths: number;
  sourceId: SourceId;
}

const PASSIVE_INSTALLATIONS: { installation: string; as1851Clause: string }[] = [
  { installation: 'Hinged and pivoted fire-resistant doorsets', as1851Clause: '17.4.3.1' },
  { installation: 'Horizontal fire-resistant sliding doorsets', as1851Clause: '17.4.3.2' },
  { installation: 'Smoke doorsets – hinged and pivoted', as1851Clause: '17.4.4' },
  { installation: 'Fire shutters', as1851Clause: '17.4.5' },
];

/**
 * Schedule 1, both tables, in the order the schedule prints them.
 *
 * The two tables carry the same four installations and the same four clause
 * numbers. Only the frequency differs, which is exactly why they are held as
 * eight rows rather than four rows with a conditional: a technician reading a
 * six-monthly against a class 9b building needs to see that it came from the
 * wrong table, not that a flag was set wrongly.
 */
export const SCHEDULE_1_ITEMS: Schedule1Item[] = [
  ...PASSIVE_INSTALLATIONS.map((p, i) => ({
    ref: `Schedule 1, table 1, row ${i + 1}`,
    table: 1 as Schedule1Table,
    appliesToClasses: 'class 5, 6, 9a and 9c buildings',
    installation: p.installation,
    as1851Clause: p.as1851Clause,
    requiredFrequency: '6 monthly',
    intervalMonths: 6,
    sourceId: 'qdc-mp61' as SourceId,
  })),
  ...PASSIVE_INSTALLATIONS.map((p, i) => ({
    ref: `Schedule 1, table 2, row ${i + 1}`,
    table: 2 as Schedule1Table,
    appliesToClasses: 'buildings other than class 5, 6, 9a and 9c buildings',
    installation: p.installation,
    as1851Clause: p.as1851Clause,
    requiredFrequency: 'Yearly',
    intervalMonths: 12,
    sourceId: 'qdc-mp61' as SourceId,
  })),
];

/** Every BCA class the Building Code of Australia defines, for input checking. */
const BCA_CLASSES = [
  '1a', '1b', '2', '3', '4', '5', '6', '7a', '7b', '8', '9a', '9b', '9c', '10a', '10b', '10c',
];

const TABLE_1_CLASSES = ['5', '6', '9a', '9c'];

export interface Schedule1TableChoice {
  table?: Schedule1Table;
  /** Present when the table cannot be chosen. Never a nearest plausible guess. */
  reason?: string;
  legalRef: string;
}

/**
 * Which Schedule 1 table a BCA class falls under.
 *
 * Refuses on class 1a rather than defaulting it into table 2. MP 6.1's
 * Application section excludes class 1a outright, and the difference between
 * "yearly" and "this code does not apply" is the difference between a technician
 * quoting a house for fire door inspections and not.
 */
export function schedule1TableForClass(bcaClass: string): Schedule1TableChoice {
  const legalRef = 'QDC MP 6.1, Schedule 1 (1) and (2); Application';
  const key = bcaClass.trim().toLowerCase().replace(/^class\s*/, '');
  if (!key) {
    return { reason: 'No BCA class given, so neither Schedule 1 table can be chosen.', legalRef };
  }
  if (!BCA_CLASSES.includes(key)) {
    return {
      reason: `"${bcaClass}" is not a BCA class this app recognises, so neither Schedule 1 table can be chosen. `
        + 'Read the class off the building\'s certificate of classification.',
      legalRef,
    };
  }
  if (key === '1a') {
    return {
      reason: 'MP 6.1 does not apply to a class 1a building, so Schedule 1 sets no frequency for it.',
      legalRef,
    };
  }
  return { table: TABLE_1_CLASSES.includes(key) ? 1 : 2, legalRef };
}

export interface PassiveMaintenanceAnswer {
  item?: Schedule1Item;
  /** Present when there is no answer. */
  reason?: string;
  legalRef: string;
  sourceIds: SourceId[];
}

/**
 * The Schedule 1 frequency for one passive installation in one building.
 *
 * Returns the schedule row rather than a bare interval, so a report can show
 * which table the answer came out of. Both halves can refuse: an unrecognised
 * class, or an installation that Schedule 1 simply does not tabulate. Solid
 * core doors are the case that catches people — they are a passive installation
 * under MP 6.1's definition and they have a row on the Schedule 2 statement,
 * but Schedule 1 sets no frequency for them, so the frequency comes from A1(a)
 * or A1(b) instead. Answering "yearly" here would be inventing a row.
 */
export function passiveMaintenance(installation: string, bcaClass: string): PassiveMaintenanceAnswer {
  const legalRef = 'QDC MP 6.1, Schedule 1, tables 1 and 2';
  const sourceIds: SourceId[] = ['qdc-mp61'];
  const choice = schedule1TableForClass(bcaClass);
  if (!choice.table) {
    return { reason: choice.reason, legalRef, sourceIds };
  }
  const wanted = normaliseName(installation);
  const item = SCHEDULE_1_ITEMS.find(
    (s) => s.table === choice.table && normaliseName(s.installation) === wanted,
  );
  if (!item) {
    return {
      reason: `Schedule 1 does not tabulate "${installation}", so it sets no frequency for it. `
        + 'Maintenance falls to A1(a) or A1(b) of the code instead — the relevant standard, the manufacturer\'s '
        + 'instructions, or the directions of an appropriately qualified person.',
      legalRef,
      sourceIds,
    };
  }
  return { item, legalRef, sourceIds };
}

// ---------------------------------------------------------------------------
// Schedule 2 — the occupier's statement
// ---------------------------------------------------------------------------

/** Normalises a name for matching. Punctuation and case vary; the row does not. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface Schedule2Installation {
  /** "Schedule 2, row 7" — the row's place in the printed table. */
  ref: string;
  /** 1-based position in the schedule's own alphabetical order. */
  row: number;
  /** The name, verbatim from the schedule, including any parenthetical. */
  name: string;
  /** The schedule's footnote number against this row, where it carries one. */
  footnote?: number;
  /**
   * Names that mean the same row on a filled statement. The schedule prints one
   * name; a register, an export and a technician may each shorten it.
   */
  aliases?: string[];
  /** True where the row itself asks for detail to be written in. */
  detailsRequired?: boolean;
}

/**
 * The twenty-one prescribed fire safety installations of Schedule 2, verbatim
 * and in the schedule's own order.
 *
 * The order is the schedule's, which is alphabetical, and it is kept because
 * the statement is read against the printed form by someone checking rows off.
 * Sorting it by trade or by system would be more useful on a phone and would
 * make the document harder to check, which is the wrong trade for a statutory
 * form.
 *
 * Footnote 2 governs what to do with a row the building does not have: delete
 * it. Nothing here invents a row the schedule does not print, and nothing here
 * omits one — a building with no lift still has "Emergency lifts" on its form,
 * struck out, which is a positive answer rather than an oversight.
 */
export const SCHEDULE_2_INSTALLATIONS: Schedule2Installation[] = [
  { ref: 'Schedule 2, row 1', row: 1, name: 'Air handling systems' },
  { ref: 'Schedule 2, row 2', row: 2, name: 'Emergency lifts' },
  { ref: 'Schedule 2, row 3', row: 3, name: 'Emergency lighting' },
  { ref: 'Schedule 2, row 4', row: 4, name: 'Emergency power supply' },
  {
    ref: 'Schedule 2, row 5',
    row: 5,
    name: 'Emergency warning and intercommunication systems',
    footnote: 5,
    aliases: ['EWIS', 'Sound systems and intercommunication systems for emergency purposes'],
  },
  { ref: 'Schedule 2, row 6', row: 6, name: 'Exit signs' },
  { ref: 'Schedule 2, row 7', row: 7, name: 'Fire detection and alarm systems' },
  { ref: 'Schedule 2, row 8', row: 8, name: 'Fire doorsets' },
  { ref: 'Schedule 2, row 9', row: 9, name: 'Fire extinguishers' },
  { ref: 'Schedule 2, row 10', row: 10, name: 'Fire hose reels' },
  { ref: 'Schedule 2, row 11', row: 11, name: 'Fire hydrants (including boosters)' },
  { ref: 'Schedule 2, row 12', row: 12, name: 'Fire mains' },
  { ref: 'Schedule 2, row 13', row: 13, name: 'Fire shutters' },
  {
    ref: 'Schedule 2, row 14',
    row: 14,
    name: 'Other features (provide details)',
    footnote: 6,
    aliases: ['Other features'],
    detailsRequired: true,
  },
  { ref: 'Schedule 2, row 15', row: 15, name: 'Smoke and heat venting systems' },
  { ref: 'Schedule 2, row 16', row: 16, name: 'Smoke doorsets' },
  { ref: 'Schedule 2, row 17', row: 17, name: 'Smoke exhaust systems' },
  { ref: 'Schedule 2, row 18', row: 18, name: 'Solid core doors' },
  { ref: 'Schedule 2, row 19', row: 19, name: 'Special automatic fire suppression systems' },
  { ref: 'Schedule 2, row 20', row: 20, name: 'Sprinklers' },
  { ref: 'Schedule 2, row 21', row: 21, name: 'Stairwell pressurisation systems' },
];

const INSTALLATION_BY_NAME = ((): Map<string, Schedule2Installation> => {
  const m = new Map<string, Schedule2Installation>();
  for (const item of SCHEDULE_2_INSTALLATIONS) {
    m.set(normaliseName(item.name), item);
    // "Other features (provide details)" is the schedule's wording; a register
    // that stores "Other features" means the same row and must not be treated
    // as an installation the schedule has never heard of.
    m.set(normaliseName(item.name.replace(/\s*\([^)]*\)\s*$/, '')), item);
    for (const alias of item.aliases ?? []) m.set(normaliseName(alias), item);
  }
  return m;
})();

/** The Schedule 2 row a name refers to, or undefined where it is not one. */
export function schedule2Installation(name: string): Schedule2Installation | undefined {
  return INSTALLATION_BY_NAME.get(normaliseName(name));
}

/** The seven footnotes, verbatim, in the schedule's order. */
export const SCHEDULE_2_FOOTNOTES: { n: number; text: string }[] = [
  {
    n: 1,
    text: 'This yearly statement must be kept with the building’s maintenance records in accordance with A2(c) '
      + 'and be produced on demand by local government officers and authorised officers of the Queensland Fire and '
      + 'Rescue Service.',
  },
  { n: 2, text: 'Note: delete prescribed fire safety installations that are not installed in/for the building.' },
  {
    n: 3,
    text: 'For example, in accordance with manufacturer’s instruction manual date day/month/year or in '
      + 'accordance with the building’s certificate of classification.',
  },
  {
    n: 4,
    text: 'Copies of critical defect notices issued and proof of rectification within the period of this statement '
      + 'must be attached.',
  },
  { n: 5, text: 'This is also known as sound systems and intercommunication systems for emergency purposes.' },
  {
    n: 6,
    text: 'Includes additional fire safety installations or conditions that are required under the building’s '
      + 'alternative solution of the Building Act 1975 or BCA clauses E1.10 and E2.3.',
  },
  {
    n: 7,
    text: 'If the owner is signing or the occupier is not employed by a body corporate the ‘name of '
      + 'organisation’ section does not need to be completed.',
  },
];

export type Schedule2FieldKind = 'header' | 'column' | 'declaration';

export interface Schedule2Field {
  id: string;
  ref: string;
  kind: Schedule2FieldKind;
  /** The label, verbatim from the schedule. */
  label: string;
  footnote?: number;
  /**
   * False only where a footnote makes the field conditional. Everything else on
   * the schedule is required, because a schedule that prints a box expects it
   * filled.
   */
  alwaysRequired: boolean;
}

/**
 * Every field Schedule 2 sets out, in the order the schedule sets them out:
 * the two header boxes, the four table columns, then the declaration.
 *
 * One thing worth saying out loud, because it looks like an omission and is
 * not: Schedule 2 has **no field for the period covered by the statement**,
 * even though three of its four columns and the declaration all refer to "the
 * period covered by this statement". The schedule leaves the period to be
 * inferred from the yearly interval in A2(b). An app can and should capture it
 * — but capturing it is an addition to the schedule, not a Schedule 2 field, so
 * a missing period does not stop the document being the Schedule 2 form.
 */
export const SCHEDULE_2_FIELDS: Schedule2Field[] = [
  {
    id: 'buildingNameAndAddress',
    ref: 'Schedule 2, header',
    kind: 'header',
    label: 'Name of building and address',
    alwaysRequired: true,
  },
  {
    id: 'occupierName',
    ref: 'Schedule 2, header',
    kind: 'header',
    label: 'Name of occupier',
    alwaysRequired: true,
  },
  {
    id: 'installation',
    ref: 'Schedule 2, column 1',
    kind: 'column',
    label: 'Prescribed fire safety installation',
    footnote: 2,
    alwaysRequired: true,
  },
  {
    id: 'nominatedStandard',
    ref: 'Schedule 2, column 2',
    kind: 'column',
    label: 'Nominated Australian Standard or relevant maintenance requirements',
    footnote: 3,
    alwaysRequired: true,
  },
  {
    id: 'criticalDefectNoticeIssued',
    ref: 'Schedule 2, column 3',
    kind: 'column',
    label: 'Was a critical defect notice issued during the period covered by this statement (Yes/No)',
    footnote: 4,
    alwaysRequired: true,
  },
  {
    id: 'rectificationDate',
    ref: 'Schedule 2, column 4',
    kind: 'column',
    label: 'Date of rectification of critical defect',
    footnote: 4,
    // Only reachable where column 3 is Yes, so it cannot be demanded of every row.
    alwaysRequired: false,
  },
  {
    id: 'fullName',
    ref: 'Schedule 2, declaration',
    kind: 'declaration',
    label: 'Full name',
    alwaysRequired: true,
  },
  {
    id: 'organisation',
    ref: 'Schedule 2, declaration',
    kind: 'declaration',
    label: 'Name of organisation',
    footnote: 7,
    alwaysRequired: false,
  },
  {
    id: 'signature',
    ref: 'Schedule 2, declaration',
    kind: 'declaration',
    label: 'Signature',
    alwaysRequired: true,
  },
  {
    id: 'date',
    ref: 'Schedule 2, declaration',
    kind: 'declaration',
    label: 'Date',
    alwaysRequired: true,
  },
];

/**
 * The declaration, verbatim, with each blank named where the schedule rules a
 * line.
 *
 * Held as a template rather than as prose so the print layer cannot quietly
 * reword it. "as an authorised person on behalf of" is doing real work: the
 * signer is declaring authority, not merely presence, and an occupier who
 * hands the pen to whoever is at reception has not made the declaration the
 * schedule asks for.
 */
export const SCHEDULE_2_DECLARATION = {
  ref: 'Schedule 2, declaration',
  legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 55A(1); QDC MP 6.1 A2(b), Schedule 2',
  template:
    'I {fullName} as an authorised person on behalf of {organisation} declare the above listed prescribed fire '
    + 'safety installations have been maintained during the period covered by this statement in accordance with '
    + 'this code and as specified, {signature} on {date}',
  blanks: [
    { id: 'fullName', label: 'Full name' },
    { id: 'organisation', label: 'Name of organisation', footnote: 7 },
    { id: 'signature', label: 'Signature' },
    { id: 'date', label: 'Date' },
  ],
} as const;

export interface DeclarationValues {
  fullName?: string;
  organisation?: string;
  /** What goes on the signature line in print: a name, or a placeholder. */
  signature?: string;
  /** Formatted for print by the caller — this module never formats dates. */
  date?: string;
}

/**
 * The declaration sentence with the blanks filled.
 *
 * An unfilled blank prints as a ruled line, exactly as the paper form does,
 * rather than collapsing to nothing. A declaration that reads "I as an
 * authorised person on behalf of declare..." is obviously incomplete; one that
 * silently closes the gap reads as finished and is not.
 */
export function renderDeclaration(values: DeclarationValues): string {
  const blank = '——————————';
  return SCHEDULE_2_DECLARATION.template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = (values as Record<string, string | undefined>)[key];
    return v && v.trim() ? v.trim() : blank;
  });
}

// ---------------------------------------------------------------------------
// Queensland public holidays and business days
// ---------------------------------------------------------------------------

/**
 * Where a holiday is appointed.
 *
 * 'district' is for a holiday the caller handed in rather than one this module
 * knows: a show holiday or a special holiday appointed for one local government
 * area. It is kept distinct from 'brisbane-area' because holidaysApplied is
 * printed as the working behind a deadline, and a document that describes the
 * Toowoomba show holiday as a Brisbane one is wrong in a way a reader would
 * have no way to catch.
 */
export type HolidayScope = 'statewide' | 'brisbane-area' | 'district';

/** Where the act is to be done, for the "in the place" limb of business day. */
export type Locality = 'brisbane-area' | 'elsewhere-in-queensland' | 'unknown';

export interface PublicHoliday {
  /** ISO date. */
  date: string;
  /** The holiday's name as the state publishes it. */
  name: string;
  scope: HolidayScope;
  /**
   * True for Christmas Eve, which Queensland appoints only from 6pm to
   * midnight. Whether a part-day holiday makes the whole day a non-business day
   * is not settled by the Acts Interpretation Act, so it is flagged rather than
   * decided. See PART_DAY_TREATMENT.
   */
  partDay?: boolean;
  sourceId: SourceId;
}

const SW = 'statewide' as const;
const BNE = 'brisbane-area' as const;
const H = 'qld-public-holidays' as SourceId;

/**
 * Queensland public holidays, 2025 to 2029.
 *
 * Only what the state has actually appointed. The pattern is tempting to
 * project — Labour Day is the first Monday in May, the King's Birthday the
 * first Monday in October — but Christmas and New Year carry an extra appointed
 * day when they fall on a weekend, Anzac Day shifts only when it falls on a
 * Sunday, and Easter moves. Projecting past the published table would produce a
 * confident wrong deadline, so counts that would run past 31 December 2029
 * refuse instead.
 *
 * The Royal Queensland Show holiday is here but scoped: it is appointed for the
 * Brisbane area only, and other districts have their own show holiday on their
 * own date. It is applied only when the caller says the act is being done in
 * the Brisbane area.
 */
export const QLD_PUBLIC_HOLIDAYS: PublicHoliday[] = [
  // 2025
  { date: '2025-01-01', name: "New Year's Day", scope: SW, sourceId: H },
  { date: '2025-01-27', name: 'Australia Day', scope: SW, sourceId: H },
  { date: '2025-04-18', name: 'Good Friday', scope: SW, sourceId: H },
  { date: '2025-04-19', name: 'The day after Good Friday', scope: SW, sourceId: H },
  { date: '2025-04-20', name: 'Easter Sunday', scope: SW, sourceId: H },
  { date: '2025-04-21', name: 'Easter Monday', scope: SW, sourceId: H },
  { date: '2025-04-25', name: 'Anzac Day', scope: SW, sourceId: H },
  { date: '2025-05-05', name: 'Labour Day', scope: SW, sourceId: H },
  { date: '2025-08-13', name: 'Royal Queensland Show', scope: BNE, sourceId: H },
  { date: '2025-10-06', name: "King's Birthday", scope: SW, sourceId: H },
  { date: '2025-12-24', name: 'Christmas Eve', scope: SW, partDay: true, sourceId: H },
  { date: '2025-12-25', name: 'Christmas Day', scope: SW, sourceId: H },
  { date: '2025-12-26', name: 'Boxing Day', scope: SW, sourceId: H },

  // 2026
  { date: '2026-01-01', name: "New Year's Day", scope: SW, sourceId: H },
  { date: '2026-01-26', name: 'Australia Day', scope: SW, sourceId: H },
  { date: '2026-04-03', name: 'Good Friday', scope: SW, sourceId: H },
  { date: '2026-04-04', name: 'The day after Good Friday', scope: SW, sourceId: H },
  { date: '2026-04-05', name: 'Easter Sunday', scope: SW, sourceId: H },
  { date: '2026-04-06', name: 'Easter Monday', scope: SW, sourceId: H },
  { date: '2026-04-25', name: 'Anzac Day', scope: SW, sourceId: H },
  { date: '2026-05-04', name: 'Labour Day', scope: SW, sourceId: H },
  { date: '2026-08-12', name: 'Royal Queensland Show', scope: BNE, sourceId: H },
  { date: '2026-10-05', name: "King's Birthday", scope: SW, sourceId: H },
  { date: '2026-12-24', name: 'Christmas Eve', scope: SW, partDay: true, sourceId: H },
  { date: '2026-12-25', name: 'Christmas Day', scope: SW, sourceId: H },
  { date: '2026-12-26', name: 'Boxing Day', scope: SW, sourceId: H },
  { date: '2026-12-28', name: 'Boxing Day (additional day)', scope: SW, sourceId: H },

  // 2027
  { date: '2027-01-01', name: "New Year's Day", scope: SW, sourceId: H },
  { date: '2027-01-26', name: 'Australia Day', scope: SW, sourceId: H },
  { date: '2027-03-26', name: 'Good Friday', scope: SW, sourceId: H },
  { date: '2027-03-27', name: 'The day after Good Friday', scope: SW, sourceId: H },
  { date: '2027-03-28', name: 'Easter Sunday', scope: SW, sourceId: H },
  { date: '2027-03-29', name: 'Easter Monday', scope: SW, sourceId: H },
  { date: '2027-04-26', name: 'Anzac Day', scope: SW, sourceId: H },
  { date: '2027-05-03', name: 'Labour Day', scope: SW, sourceId: H },
  { date: '2027-08-11', name: 'Royal Queensland Show', scope: BNE, sourceId: H },
  { date: '2027-10-04', name: "King's Birthday", scope: SW, sourceId: H },
  { date: '2027-12-24', name: 'Christmas Eve', scope: SW, partDay: true, sourceId: H },
  { date: '2027-12-25', name: 'Christmas Day', scope: SW, sourceId: H },
  { date: '2027-12-26', name: 'Boxing Day', scope: SW, sourceId: H },
  { date: '2027-12-27', name: 'Christmas Day (additional day)', scope: SW, sourceId: H },
  { date: '2027-12-28', name: 'Boxing Day (additional day)', scope: SW, sourceId: H },

  // 2028
  { date: '2028-01-01', name: "New Year's Day", scope: SW, sourceId: H },
  { date: '2028-01-03', name: "New Year's Day (additional day)", scope: SW, sourceId: H },
  { date: '2028-01-26', name: 'Australia Day', scope: SW, sourceId: H },
  { date: '2028-04-14', name: 'Good Friday', scope: SW, sourceId: H },
  { date: '2028-04-15', name: 'The day after Good Friday', scope: SW, sourceId: H },
  { date: '2028-04-16', name: 'Easter Sunday', scope: SW, sourceId: H },
  { date: '2028-04-17', name: 'Easter Monday', scope: SW, sourceId: H },
  { date: '2028-04-25', name: 'Anzac Day', scope: SW, sourceId: H },
  { date: '2028-05-01', name: 'Labour Day', scope: SW, sourceId: H },
  { date: '2028-08-16', name: 'Royal Queensland Show', scope: BNE, sourceId: H },
  { date: '2028-10-02', name: "King's Birthday", scope: SW, sourceId: H },
  { date: '2028-12-24', name: 'Christmas Eve', scope: SW, partDay: true, sourceId: H },
  { date: '2028-12-25', name: 'Christmas Day', scope: SW, sourceId: H },
  { date: '2028-12-26', name: 'Boxing Day', scope: SW, sourceId: H },

  // 2029
  { date: '2029-01-01', name: "New Year's Day", scope: SW, sourceId: H },
  { date: '2029-01-26', name: 'Australia Day', scope: SW, sourceId: H },
  { date: '2029-03-30', name: 'Good Friday', scope: SW, sourceId: H },
  { date: '2029-03-31', name: 'The day after Good Friday', scope: SW, sourceId: H },
  { date: '2029-04-01', name: 'Easter Sunday', scope: SW, sourceId: H },
  { date: '2029-04-02', name: 'Easter Monday', scope: SW, sourceId: H },
  { date: '2029-04-25', name: 'Anzac Day', scope: SW, sourceId: H },
  { date: '2029-05-07', name: 'Labour Day', scope: SW, sourceId: H },
  { date: '2029-08-15', name: 'Royal Queensland Show', scope: BNE, sourceId: H },
  { date: '2029-10-01', name: "King's Birthday", scope: SW, sourceId: H },
  { date: '2029-12-24', name: 'Christmas Eve', scope: SW, partDay: true, sourceId: H },
  { date: '2029-12-25', name: 'Christmas Day', scope: SW, sourceId: H },
  { date: '2029-12-26', name: 'Boxing Day', scope: SW, sourceId: H },
];

/** The range the holiday table covers. Outside it, counts refuse. */
export const HOLIDAY_COVERAGE = { from: '2025-01-01', to: '2029-12-31' } as const;

/**
 * How a part-day public holiday is treated.
 *
 * Christmas Eve is a public holiday in Queensland from 6pm. Normal business
 * hours on 24 December are unaffected, so it is counted as a business day — but
 * the Acts Interpretation Act does not distinguish part-day holidays, and
 * nobody has litigated it. Counting it as a business day is the choice that
 * produces the earlier deadline, which is the safe direction to be wrong in.
 */
export const PART_DAY_TREATMENT = 'counted-as-a-business-day' as const;

const HOLIDAYS_BY_DATE = ((): Map<string, PublicHoliday[]> => {
  const m = new Map<string, PublicHoliday[]>();
  for (const h of QLD_PUBLIC_HOLIDAYS) {
    const list = m.get(h.date);
    if (list) list.push(h);
    else m.set(h.date, [h]);
  }
  return m;
})();

/** Every appointed holiday on a date, whatever its scope. */
export function publicHolidaysOn(iso: string): PublicHoliday[] {
  return HOLIDAYS_BY_DATE.get(iso.slice(0, 10)) ?? [];
}

export interface BusinessDayOptions {
  /**
   * Where the act is to be done. Only the Brisbane area gets the Royal
   * Queensland Show holiday, and only a caller who knows the locality can say
   * so. Defaults to unknown, which applies statewide holidays and says what it
   * could not apply.
   */
  locality?: Locality;
  /**
   * The district show or special holiday dates for the locality, if the caller
   * knows them. Appointed per local government area, so this module has no way
   * to look them up and will not pretend otherwise.
   */
  districtHolidays?: { date: string; name: string }[];
}

export interface BusinessDayCount {
  /** The date arrived at, or undefined where it cannot be known. */
  date?: string;
  /** Why there is no date. Present exactly when date is undefined. */
  reason?: string;
  /** Weekend days passed over. */
  weekendDaysSkipped: number;
  /** Holidays applied, so a document can show its working. */
  holidaysApplied: PublicHoliday[];
  /** Holidays that fell in the window and were deliberately not applied, and why. */
  holidaysNotApplied: { holiday: PublicHoliday; why: string }[];
  caveats: string[];
  /**
   * Whether the date returned is on or before the true statutory date.
   *
   * The whole point of the flag. Every holiday this module fails to apply — a
   * district show holiday it cannot know, a part-day holiday it counts as
   * working — pushes the real deadline later, never earlier. So a true value
   * means: work to this date and you cannot be late. It goes false only if a
   * future change starts skipping days it should not.
   */
  noLaterThanStatutory: boolean;
  confidence: Confidence;
  legalRef: string;
  sourceIds: SourceId[];
}

function inCoverage(iso: string): boolean {
  return iso >= HOLIDAY_COVERAGE.from && iso <= HOLIDAY_COVERAGE.to;
}

/**
 * Counts forward a number of business days from a date, the way section 55A(3)
 * counts: the starting day is day zero, and the count lands on the last day the
 * act can still be done in time.
 *
 * Refuses rather than approximates. A start date outside the published holiday
 * table, or a count that would run off the end of it, returns no date and says
 * why — because a deadline computed against holidays nobody has appointed yet
 * is a guess wearing a date's clothes.
 */
export function addQldBusinessDays(
  fromIso: string,
  days: number,
  options: BusinessDayOptions = {},
): BusinessDayCount {
  const legalRef = 'Acts Interpretation Act 1954 (Qld), sch 1 (business day)';
  const sourceIds: SourceId[] = ['acts-interpretation', 'qld-public-holidays'];
  const base: BusinessDayCount = {
    weekendDaysSkipped: 0,
    holidaysApplied: [],
    holidaysNotApplied: [],
    caveats: [],
    noLaterThanStatutory: true,
    confidence: 'high',
    legalRef,
    sourceIds,
  };

  const start = parseIsoDate(fromIso);
  if (!start) {
    return { ...base, reason: `"${fromIso}" is not a date this app can read, so no business day count is possible.` };
  }
  if (!Number.isInteger(days) || days < 0) {
    return { ...base, reason: 'A business day count must be a whole number of days, and cannot be negative.' };
  }
  const startIso = toIso(start);
  if (!inCoverage(startIso)) {
    return {
      ...base,
      reason: `Queensland public holidays are only known here for ${formatAuDate(HOLIDAY_COVERAGE.from)} to `
        + `${formatAuDate(HOLIDAY_COVERAGE.to)}, and ${formatAuDate(startIso)} is outside that. Count the business `
        + "days against the state's published holiday dates rather than trusting a figure from here.",
    };
  }

  const locality: Locality = options.locality ?? 'unknown';
  const districtHolidays = new Map<string, string>();
  for (const d of options.districtHolidays ?? []) districtHolidays.set(d.date.slice(0, 10), d.name);

  const weekendSkipped: string[] = [];
  const applied: PublicHoliday[] = [];
  const notApplied: { holiday: PublicHoliday; why: string }[] = [];
  const caveats: string[] = [];
  let sawPartDay = false;
  let sawUnknownLocality = false;

  const cursor = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = toIso(cursor);
    if (!inCoverage(iso)) {
      return {
        ...base,
        reason: `Counting ${days} business days from ${formatAuDate(startIso)} runs past `
          + `${formatAuDate(HOLIDAY_COVERAGE.to)}, beyond the holiday dates Queensland has appointed. No date is `
          + "given rather than one that assumes next decade's holidays.",
      };
    }
    if (isWeekend(cursor)) {
      weekendSkipped.push(iso);
      continue;
    }

    const district = districtHolidays.get(iso);
    if (district) {
      applied.push({ date: iso, name: district, scope: 'district', sourceId: 'qld-show-holidays' });
      continue;
    }

    let skipped = false;
    for (const h of publicHolidaysOn(iso)) {
      if (h.partDay) {
        sawPartDay = true;
        notApplied.push({
          holiday: h,
          why: `${h.name} is a public holiday only from 6pm, so the working day is unaffected. Counting it as a `
            + 'business day gives the earlier deadline.',
        });
        continue;
      }
      if (h.scope === 'brisbane-area' && locality !== 'brisbane-area') {
        notApplied.push({
          holiday: h,
          why: locality === 'elsewhere-in-queensland'
            ? `${h.name} is appointed for the Brisbane area only, and this building is not in it.`
            : `${h.name} is appointed for the Brisbane area only, and the building's locality was not given.`,
        });
        if (locality === 'unknown') sawUnknownLocality = true;
        continue;
      }
      applied.push(h);
      skipped = true;
      break;
    }
    if (skipped) continue;
    remaining--;
  }

  if (sawPartDay) {
    caveats.push(
      'A part-day public holiday falls inside this count and has been treated as a business day. If it were '
      + 'treated otherwise the deadline would be one day later, so this date is the earlier of the two.',
    );
  }
  if (sawUnknownLocality) {
    caveats.push(
      'The Royal Queensland Show holiday falls inside this count but is appointed for the Brisbane area only. '
      + 'Tell this calculation the locality if the building is in it.',
    );
  }
  if (!options.districtHolidays?.length) {
    caveats.push(
      'District show and special holidays are appointed per local government area and are not accounted for. '
      + 'A holiday not applied can only move the real deadline later, so this date is never late.',
    );
  }

  return {
    date: toIso(cursor),
    weekendDaysSkipped: weekendSkipped.length,
    holidaysApplied: applied,
    holidaysNotApplied: notApplied,
    caveats,
    noLaterThanStatutory: true,
    confidence: options.districtHolidays?.length && locality !== 'unknown' ? 'high' : 'medium',
    legalRef,
    sourceIds,
  };
}

/**
 * Business days from one date to another, negative once the target is past.
 *
 * Same arithmetic in both directions, so a screen can say "three days left" and
 * "three days late" without two implementations disagreeing at zero.
 */
export function qldBusinessDaysBetween(
  fromIso: string,
  toIsoDate: string,
  options: BusinessDayOptions = {},
): { days?: number; reason?: string; caveats: string[]; legalRef: string; sourceIds: SourceId[] } {
  // Cited like every other answer here. A screen that prints "three days late"
  // is making a statutory claim, and the definition it rests on is not this
  // app's — it is schedule 1 of the Acts Interpretation Act.
  const legalRef = 'Acts Interpretation Act 1954 (Qld), sch 1 (business day)';
  const sourceIds: SourceId[] = ['acts-interpretation', 'qld-public-holidays'];
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIsoDate);
  if (!from || !to) {
    return {
      reason: 'One of the dates could not be read, so no count is possible.',
      caveats: [], legalRef, sourceIds,
    };
  }
  const forward = to >= from;
  const [start, end] = forward ? [from, to] : [to, from];
  if (!inCoverage(toIso(start)) || !inCoverage(toIso(end))) {
    return {
      reason: `Queensland public holidays are only known here for ${formatAuDate(HOLIDAY_COVERAGE.from)} to `
        + `${formatAuDate(HOLIDAY_COVERAGE.to)}, and this range falls outside that.`,
      caveats: [], legalRef, sourceIds,
    };
  }

  const locality: Locality = options.locality ?? 'unknown';
  const districtHolidays = new Set((options.districtHolidays ?? []).map((d) => d.date.slice(0, 10)));
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWeekend(cursor)) continue;
    const iso = toIso(cursor);
    if (districtHolidays.has(iso)) continue;
    const blocking = publicHolidaysOn(iso).some(
      (h) => !h.partDay && (h.scope === 'statewide' || locality === 'brisbane-area'),
    );
    if (blocking) continue;
    count++;
  }
  return {
    days: forward ? count : -count,
    caveats: options.districtHolidays?.length
      ? []
      : [
        'District show and special holidays are appointed per local government area and are not accounted for, '
        + 'so the true number of business days in this range may be one or two fewer than the count shown.',
      ],
    legalRef,
    sourceIds,
  };
}

// ---------------------------------------------------------------------------
// The statutory clocks
// ---------------------------------------------------------------------------

/** Section 55A(3): the copy goes to the commissioner within ten business days. */
export const COMMISSIONER_COPY_BUSINESS_DAYS = 10;

/** Section 55A(2) and MP 6.1 A2(c): kept with the maintenance records for two years. */
export const STATEMENT_RETENTION_YEARS = 2;

/** MP 6.1 A2(b): within one year of occupation, then yearly. */
export const STATEMENT_INTERVAL_YEARS = 1;

/** Section 54(4): the occupier's month to have the repair done. */
export const RECTIFICATION_MONTHS = 1;

/** Section 53(2): the maintainer's 24 hours to give the critical defect notice. */
export const CRITICAL_DEFECT_NOTICE_HOURS = 24;

export interface DatedAnswer {
  date?: string;
  reason?: string;
  legalRef: string;
  sourceIds: SourceId[];
}

/**
 * When the next statement is due.
 *
 * From the date of the last statement, not from when a service happened. A2(b)
 * runs the year off the statement, which is why an occupier who serviced
 * everything in March but did not sign until August has an August anniversary.
 */
export function nextStatementDue(lastStatementIso: string): DatedAnswer {
  const legalRef = 'QDC MP 6.1 A2(b)(ii)';
  const d = parseIsoDate(lastStatementIso);
  if (!d) {
    return {
      reason: `"${lastStatementIso}" is not a date this app can read, so the next statement date is unknown.`,
      legalRef,
      sourceIds: ['qdc-mp61'],
    };
  }
  return { date: toIso(addYears(d, STATEMENT_INTERVAL_YEARS)), legalRef, sourceIds: ['qdc-mp61'] };
}

/** When the first statement is due, being a year from taking up occupation. */
export function firstStatementDue(occupationIso: string): DatedAnswer {
  const legalRef = 'QDC MP 6.1 A2(b)(i)';
  const d = parseIsoDate(occupationIso);
  if (!d) {
    return {
      reason: `"${occupationIso}" is not a date this app can read, so the first statement date is unknown.`,
      legalRef,
      sourceIds: ['qdc-mp61'],
    };
  }
  return { date: toIso(addYears(d, STATEMENT_INTERVAL_YEARS)), legalRef, sourceIds: ['qdc-mp61'] };
}

/** How long the statement is kept with the maintenance records. */
export function statementRetainedUntil(preparedIso: string): DatedAnswer {
  const legalRef = 'Building Fire Safety Regulation 2008 (Qld) s 55A(2); QDC MP 6.1 A2(c)';
  const d = parseIsoDate(preparedIso);
  if (!d) {
    return {
      reason: `"${preparedIso}" is not a date this app can read, so the retention date is unknown.`,
      legalRef,
      sourceIds: ['bfsr-2008', 'qdc-mp61'],
    };
  }
  return {
    date: toIso(addYears(d, STATEMENT_RETENTION_YEARS)),
    legalRef,
    sourceIds: ['bfsr-2008', 'qdc-mp61'],
  };
}

/** Where the ten business days were counted from. */
export type DeadlineAnchor = 'required-preparation' | 'previous-statement' | 'occupation' | 'signature';

export interface CommissionerCopyInput {
  /** The day the occupier was required to prepare the statement, if known outright. */
  requiredPreparationDate?: string;
  /** The date of the previous statement. The required date is a year after it. */
  previousStatementDate?: string;
  /** When the occupier took up occupation, for a first statement. */
  occupationDate?: string;
  /** When the occupier actually signed. Not the statutory anchor — see below. */
  signedDate?: string;
  locality?: Locality;
  districtHolidays?: { date: string; name: string }[];
}

export interface CommissionerCopyDeadline {
  /** The last day the copy can reach the commissioner in time. */
  due?: string;
  /** Why there is no date. Present exactly when due is undefined. */
  reason?: string;
  anchor?: DeadlineAnchor;
  anchorDate?: string;
  /**
   * 'statutory' where the count ran from the day the statement was required;
   * 'signature-fallback' where it ran from the signature because nothing else
   * was known, which is not what section 55A(3) says.
   */
  basis?: 'statutory' | 'signature-fallback';
  counting?: BusinessDayCount;
  caveats: string[];
  confidence: Confidence;
  legalRef: string;
  sourceIds: SourceId[];
}

/**
 * When the commissioner's copy is due.
 *
 * The trap this exists to close: section 55A(3) counts from the day the
 * occupier **is required to prepare** the statement, not from the day they
 * sign. Those are the same date only for an occupier who signs exactly on their
 * anniversary. Sign a month late and the ten business days have long since run;
 * an app that counts from the signature would have shown a comfortable deadline
 * the whole time.
 *
 * So the anchor is taken in order of what the regulation actually points at:
 * a required-preparation date if the caller knows it, otherwise a year from the
 * previous statement, otherwise a year from taking up occupation. The signature
 * is used only when none of those is known, and then it is labelled as a
 * fallback and carries the warning, because a fallback that looks like an
 * answer is worse than no answer.
 */
export function commissionerCopyDeadline(input: CommissionerCopyInput): CommissionerCopyDeadline {
  const legalRef = 'Building Fire Safety Regulation 2008 (Qld) s 55A(3)';
  const sourceIds: SourceId[] = ['bfsr-2008', 'qdc-mp61', 'acts-interpretation', 'qld-public-holidays'];
  const options: BusinessDayOptions = { locality: input.locality, districtHolidays: input.districtHolidays };

  let anchor: DeadlineAnchor | undefined;
  let anchorDate: string | undefined;

  const required = parseIsoDate(input.requiredPreparationDate);
  if (required) {
    anchor = 'required-preparation';
    anchorDate = toIso(required);
  } else {
    const previous = nextStatementDue(input.previousStatementDate ?? '');
    if (previous.date) {
      anchor = 'previous-statement';
      anchorDate = previous.date;
    } else {
      const first = firstStatementDue(input.occupationDate ?? '');
      if (first.date) {
        anchor = 'occupation';
        anchorDate = first.date;
      }
    }
  }

  const signed = parseIsoDate(input.signedDate);
  const basis: 'statutory' | 'signature-fallback' | undefined =
    anchorDate ? 'statutory' : signed ? 'signature-fallback' : undefined;

  if (!anchorDate && signed) {
    anchor = 'signature';
    anchorDate = toIso(signed);
  }

  if (!anchorDate) {
    return {
      reason: 'The ten business days run from the day the occupier was required to prepare the statement. '
        + 'Without the previous statement date, the date occupation was taken up, or a signature date, there is '
        + 'nothing to count from, so no deadline is given.',
      caveats: [],
      confidence: 'high',
      legalRef,
      sourceIds,
    };
  }

  const counting = addQldBusinessDays(anchorDate, COMMISSIONER_COPY_BUSINESS_DAYS, options);
  const caveats = [...counting.caveats];
  let confidence: Confidence = counting.confidence;

  if (basis === 'signature-fallback') {
    confidence = 'low';
    caveats.unshift(
      'Counted from the signature because the date the statement was required is not recorded. Section 55A(3) '
      + 'runs from the required date, so if this statement was prepared late the real deadline is earlier than '
      + 'this — possibly already past. Record the previous statement date to get the statutory answer.',
    );
  } else if (signed && anchorDate && toIso(signed) > anchorDate) {
    caveats.unshift(
      `The statement was signed on ${formatAuDate(toIso(signed))}, after it was required on `
      + `${formatAuDate(anchorDate)}. Signing late does not restart the ten business days.`,
    );
  } else if (signed && anchorDate && toIso(signed) < anchorDate) {
    // The one place this module can hand back a date *later* than a naive one,
    // so it says so rather than letting the silence read as certainty. Section
    // 55A(3) hangs the clock on the day the statement was required, and MP 6.1
    // A2(b)(ii) fixes that at the anniversary — an occupier who signs in
    // January is not required to lodge until ten business days after April. It
    // is the reading the words support, but it is a reading, and everywhere
    // else here an unknown pushes the date earlier rather than later.
    const fromSignature = addQldBusinessDays(toIso(signed), COMMISSIONER_COPY_BUSINESS_DAYS, options);
    caveats.unshift(
      `The statement was signed on ${formatAuDate(toIso(signed))}, before it was required on `
      + `${formatAuDate(anchorDate)}, and section 55A(3) counts from the day it was required rather than from the `
      + 'signature — so signing early does not shorten the ten business days. This is the one deadline here that '
      + 'is later than the cautious answer'
      + `${fromSignature.date ? `, which would be ${formatAuDate(fromSignature.date)}` : ''}. `
      + 'If the copy can go now, send it now.',
    );
  }

  if (!counting.date) {
    return { reason: counting.reason, anchor, anchorDate, basis, counting, caveats, confidence, legalRef, sourceIds };
  }
  return { due: counting.date, anchor, anchorDate, basis, counting, caveats, confidence, legalRef, sourceIds };
}

export interface RectificationDeadline {
  due?: string;
  reason?: string;
  /** True where the date was derived from the notice rather than the maintenance. */
  approximate: boolean;
  legalRef: string;
  sourceIds: SourceId[];
}

/**
 * When a defect found at a service has to be rectified.
 *
 * Section 54(4) counts one month from when the **maintenance** was carried out,
 * not from when the notice landed. Where only the notice date is known the
 * answer is still usable, because section 53(2) gives the maintainer at most 24
 * hours to issue it: the true deadline is therefore at most one day earlier
 * than the one computed from the notice. That is flagged as approximate rather
 * than presented as the date, and the caller can decide whether one day
 * matters.
 */
export function rectificationDeadline(input: {
  maintenanceDate?: string;
  noticeDate?: string;
}): RectificationDeadline {
  const legalRef = 'Building Fire Safety Regulation 2008 (Qld) s 54(4); s 53(2)';
  const sourceIds: SourceId[] = ['bfsr-2008'];
  const maintenance = parseIsoDate(input.maintenanceDate);
  if (maintenance) {
    return { due: toIso(addMonths(maintenance, RECTIFICATION_MONTHS)), approximate: false, legalRef, sourceIds };
  }
  const notice = parseIsoDate(input.noticeDate);
  if (notice) {
    return { due: toIso(addMonths(notice, RECTIFICATION_MONTHS)), approximate: true, legalRef, sourceIds };
  }
  return {
    reason: 'Section 54(4) runs one month from the maintenance. Without the maintenance date or the notice date '
      + 'there is nothing to count from.',
    approximate: false,
    legalRef,
    sourceIds,
  };
}

// ---------------------------------------------------------------------------
// A filled statement, and what the Regulation requires of it
// ---------------------------------------------------------------------------

export interface FilledInstallationRow {
  /** The Schedule 2 row this answers. Matched loosely; reported when unmatched. */
  installation: string;
  /**
   * Whether the building has it. Undefined means the row has not been answered
   * — which is a different thing from "no", and the schedule wants an answer
   * either way: a row that is not installed is struck out under footnote 2.
   */
  installed?: boolean;
  /** Column 2: the standard or maintenance requirements nominated. */
  nominatedStandard?: string;
  /** Column 3. Undefined means unanswered, not "no". */
  criticalDefectNoticeIssued?: boolean;
  /** Column 4. */
  rectificationDate?: string;
  /** When the maintenance behind this row was carried out, for the s 54(4) check. */
  maintenanceDate?: string;
  /** When the critical defect notice was given, if a maintenance date is not held. */
  criticalDefectNoticeDate?: string;
  /** What "Other features" covers, where the row asks for details. */
  details?: string;
}

export interface FilledOccupierStatement {
  /** Schedule 2 header: name of building and address. Held as two, printed as one. */
  buildingName?: string;
  buildingAddress?: string;
  occupierName?: string;
  /**
   * Not a Schedule 2 field — the schedule has no period box — but the columns
   * and declaration all speak of "the period covered by this statement", so an
   * app that captures it produces a better document than the paper form.
   */
  periodStart?: string;
  periodEnd?: string;
  rows: FilledInstallationRow[];
  /** Declaration: the authorised person's full name. */
  declarationFullName?: string;
  /** Declaration: the organisation they are authorised by. See footnote 7. */
  organisationName?: string;
  /**
   * Footnote 7: the owner is signing, or the occupier is not employed by a body
   * corporate. Either way the organisation box is not needed.
   */
  footnote7Applies?: boolean;
  signature?: string;
  signedDate?: string;
  /** Footnote 4: the notices and the proof of rectification are attached. */
  criticalDefectNoticesAttached?: boolean;
  /** When the copy actually went to the commissioner. */
  sentToCommissionerDate?: string;
  /** Everything the deadline needs; passed straight through. */
  commissionerCopy?: Omit<CommissionerCopyInput, 'signedDate'>;
  /**
   * Who maintained the installations. Used only to notice the occupier handing
   * the pen to their contractor, which does not discharge s 55A(1).
   */
  maintenanceContractorName?: string;
}

export interface StatementIssue {
  /** The field or row the issue is about. */
  field: string;
  /** Where on the form: "Schedule 2, row 7". */
  formRef: string;
  /** The provision that requires it. */
  legalRef: string;
  message: string;
  /** A blocker means the document is not yet the Schedule 2 statement. */
  blocking: boolean;
}

/**
 * Checks a filled statement against what the Regulation and Schedule 2 require.
 *
 * Ordered the way the form is read — header, then rows, then declaration, then
 * the lodgement clock — because the output's job is to be a list of what to go
 * and do, not a verdict. Blocking issues are the ones that stop the document
 * being the statutory statement; the rest are worth knowing and do not.
 *
 * The four things a reviewer will look for are all here and all cited:
 *  - who signs — an authorised person on behalf of the occupier, s 55A(1);
 *  - what is declared — the Schedule 2 declaration, unabridged;
 *  - the ten business days to give the commissioner a copy, s 55A(3);
 *  - what a critical defect notice does to it — footnote 4 attaches the notice
 *    and the proof of rectification, and s 54(4) puts a month on the repair.
 */
export function checkOccupierStatement(
  statement: FilledOccupierStatement,
  todayIso?: string,
): StatementIssue[] {
  const issues: StatementIssue[] = [];
  const add = (i: StatementIssue): void => { issues.push(i); };
  const filled = (s: string | undefined): boolean => !!s && s.trim().length > 0;

  // --- Header -------------------------------------------------------------
  if (!filled(statement.buildingName) || !filled(statement.buildingAddress)) {
    add({
      field: 'buildingNameAndAddress',
      formRef: 'Schedule 2, header',
      legalRef: 'QDC MP 6.1, Schedule 2',
      message: 'The schedule asks for the name of the building and its address. Both are needed — a statement '
        + 'that names a building without saying where it is cannot be matched to a premises on file.',
      blocking: true,
    });
  }
  if (!filled(statement.occupierName)) {
    add({
      field: 'occupierName',
      formRef: 'Schedule 2, header',
      legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 55A(1); QDC MP 6.1, Schedule 2',
      message: 'Name the occupier. The duty to prepare this statement is theirs, and the occupier under MP 6.1 is '
        + 'the person in actual occupation or, if there is none, the owner.',
      blocking: true,
    });
  }
  if (!filled(statement.periodStart) || !filled(statement.periodEnd)) {
    add({
      field: 'period',
      formRef: 'Not a Schedule 2 field',
      legalRef: 'QDC MP 6.1 A2(b)(ii)',
      message: 'The period covered is not stated. Schedule 2 has no box for it, so this does not stop the document '
        + 'being the form — but three of its four columns turn on "the period covered by this statement", and the '
        + 'yearly interval cannot be checked without it.',
      blocking: false,
    });
  }

  // --- Rows ---------------------------------------------------------------
  const seen = new Set<number>();
  for (const row of statement.rows) {
    const item = schedule2Installation(row.installation);
    if (!item) {
      add({
        field: row.installation,
        formRef: 'Not a Schedule 2 row',
        legalRef: 'QDC MP 6.1, Schedule 2, footnote 6',
        message: `"${row.installation}" is not one of the twenty-one installations Schedule 2 lists. Record it `
          + 'under "Other features (provide details)", which is the row the schedule provides for anything required '
          + 'by an alternative solution or by BCA clauses E1.10 and E2.3.',
        blocking: false,
      });
      continue;
    }
    if (seen.has(item.row)) {
      add({
        field: item.name,
        formRef: item.ref,
        legalRef: 'QDC MP 6.1, Schedule 2',
        message: `${item.name} is answered more than once. The schedule prints the row once, so two answers means `
          + 'one of them will not appear on the form.',
        blocking: true,
      });
      continue;
    }
    seen.add(item.row);

    if (row.installed === undefined) {
      add({
        field: item.name,
        formRef: item.ref,
        legalRef: 'QDC MP 6.1, Schedule 2, footnote 2',
        message: `${item.name} has not been answered. Footnote 2 says to delete an installation the building does `
          + 'not have — which is an answer. Leaving the row blank is not.',
        blocking: true,
      });
      continue;
    }
    if (!row.installed) continue;

    if (!filled(row.nominatedStandard)) {
      add({
        field: item.name,
        formRef: `${item.ref}, column 2`,
        legalRef: 'QDC MP 6.1, Schedule 2, column 2 and footnote 3',
        message: `${item.name}: no Australian Standard or maintenance requirement nominated. Footnote 3 accepts a `
          + "manufacturer's instruction manual with its date, or the building's certificate of classification, but "
          + 'it wants one of them named.',
        blocking: true,
      });
    }
    if (item.detailsRequired && !filled(row.details)) {
      add({
        field: item.name,
        formRef: `${item.ref}, column 1`,
        legalRef: 'QDC MP 6.1, Schedule 2, footnote 6',
        message: 'The "Other features" row is marked as installed but says nothing about what it covers. The row '
          + 'asks for details, and a tick with no detail tells a reader nothing.',
        blocking: true,
      });
    }

    if (row.criticalDefectNoticeIssued === undefined) {
      add({
        field: item.name,
        formRef: `${item.ref}, column 3`,
        legalRef: 'QDC MP 6.1, Schedule 2, column 3',
        message: `${item.name}: column 3 asks Yes or No — was a critical defect notice issued during the period. `
          + 'A blank is neither.',
        blocking: true,
      });
      continue;
    }
    if (!row.criticalDefectNoticeIssued) continue;

    if (!filled(row.rectificationDate)) {
      add({
        field: item.name,
        formRef: `${item.ref}, column 4`,
        legalRef: 'QDC MP 6.1, Schedule 2, column 4; Building Fire Safety Regulation 2008 (Qld) s 54(4)',
        message: `${item.name}: a critical defect notice was issued and column 4 has no date of rectification. `
          + 'An unrectified critical defect is exactly what this column exists to surface, so it cannot be left '
          + 'blank on a signed statement.',
        blocking: true,
      });
    } else {
      const deadline = rectificationDeadline({
        maintenanceDate: row.maintenanceDate,
        noticeDate: row.criticalDefectNoticeDate,
      });
      const rectified = parseIsoDate(row.rectificationDate);
      if (deadline.due && rectified && toIso(rectified) > deadline.due) {
        add({
          field: item.name,
          formRef: `${item.ref}, column 4`,
          legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 54(4)',
          message: `${item.name}: rectified on ${formatAuDate(toIso(rectified))}, which is after the one month `
            + `s 54(4) allows (${formatAuDate(deadline.due)}`
            + `${deadline.approximate ? ', taken from the notice date and so up to a day late' : ''}). `
            + 'The statement is still true; the delay wants a reasonable excuse recorded against it.',
          blocking: false,
        });
      }
    }
  }

  const answeredNotices = statement.rows.some((r) => r.criticalDefectNoticeIssued === true);
  if (answeredNotices && statement.criticalDefectNoticesAttached !== true) {
    add({
      field: 'criticalDefectNoticesAttached',
      formRef: 'Schedule 2, footnote 4',
      legalRef: 'QDC MP 6.1, Schedule 2, footnote 4; Building Fire Safety Regulation 2008 (Qld) s 53(2)',
      message: 'A critical defect notice was issued in the period, so copies of the notices and proof of the '
        + 'rectification have to be attached to this statement. The statement travels with them or it is '
        + 'incomplete.',
      blocking: true,
    });
  }

  const missingRows = SCHEDULE_2_INSTALLATIONS.filter((i) => !seen.has(i.row));
  if (missingRows.length) {
    add({
      field: 'installations',
      formRef: 'Schedule 2, column 1',
      legalRef: 'QDC MP 6.1, Schedule 2',
      message: `${missingRows.length} of the twenty-one installations Schedule 2 lists are not on this statement: `
        + `${missingRows.map((i) => i.name).join('; ')}. Every row is answered, even if the answer is that the `
        + 'building does not have it.',
      blocking: true,
    });
  }

  // --- Declaration --------------------------------------------------------
  if (!filled(statement.declarationFullName)) {
    add({
      field: 'declarationFullName',
      formRef: 'Schedule 2, declaration',
      legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 55A(1); QDC MP 6.1, Schedule 2',
      message: 'The declaration needs the full name of the authorised person making it. The declaration is that '
        + 'the installations have been maintained — it is made by a person, not by a company.',
      blocking: true,
    });
  }
  if (!filled(statement.organisationName) && !statement.footnote7Applies) {
    add({
      field: 'organisationName',
      formRef: 'Schedule 2, declaration',
      legalRef: 'QDC MP 6.1, Schedule 2, footnote 7',
      message: 'The declaration is made "on behalf of" an organisation and none is named. Footnote 7 excuses this '
        + 'only where the owner is signing, or the occupier is not employed by a body corporate — tick that and '
        + 'the box can stay empty.',
      blocking: true,
    });
  }
  if (!filled(statement.signature)) {
    add({
      field: 'signature',
      formRef: 'Schedule 2, declaration',
      legalRef: 'QDC MP 6.1, Schedule 2',
      message: 'Unsigned. The declaration is the statement; without a signature the rest is a maintenance summary.',
      blocking: true,
    });
  }
  if (!filled(statement.signedDate)) {
    add({
      field: 'signedDate',
      formRef: 'Schedule 2, declaration',
      legalRef: 'QDC MP 6.1, Schedule 2; A2(b)(ii)',
      message: 'No date against the signature. The next statement is due a year from this date, so an undated one '
        + 'leaves the following year with no anniversary to work from.',
      blocking: true,
    });
  }

  const signed = parseIsoDate(statement.signedDate);
  const periodEnd = parseIsoDate(statement.periodEnd);
  if (signed && periodEnd && toIso(signed) < toIso(periodEnd)) {
    add({
      field: 'signedDate',
      formRef: 'Schedule 2, declaration',
      legalRef: 'QDC MP 6.1, Schedule 2',
      message: `Signed on ${formatAuDate(toIso(signed))}, before the period it covers ends on `
        + `${formatAuDate(toIso(periodEnd))}. The `
        + 'declaration speaks of maintenance during the period covered, so part of what is being declared has not '
        + 'happened yet.',
      blocking: false,
    });
  }

  if (
    filled(statement.maintenanceContractorName)
    && filled(statement.organisationName)
    && normaliseName(statement.organisationName ?? '') === normaliseName(statement.maintenanceContractorName ?? '')
  ) {
    add({
      field: 'organisationName',
      formRef: 'Schedule 2, declaration',
      legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 55A(1)',
      message: 'The declaration is signed on behalf of the maintenance contractor rather than the occupier. '
        + 'Section 55A(1) puts the duty on the occupier of the building, and a contractor signing it does not '
        + 'discharge that duty — check the signer is authorised by the occupier.',
      blocking: false,
    });
  }

  // --- The ten business days ---------------------------------------------
  const deadline = commissionerCopyDeadline({
    ...(statement.commissionerCopy ?? {}),
    signedDate: statement.signedDate,
  });
  const sent = parseIsoDate(statement.sentToCommissionerDate);
  if (!deadline.due) {
    add({
      field: 'sentToCommissionerDate',
      formRef: 'Not a Schedule 2 field',
      legalRef: deadline.legalRef,
      message: `The ten business days to give the commissioner a copy cannot be worked out. ${deadline.reason ?? ''}`
        .trim(),
      blocking: false,
    });
  } else if (sent) {
    if (toIso(sent) > deadline.due) {
      add({
        field: 'sentToCommissionerDate',
        formRef: 'Not a Schedule 2 field',
        legalRef: deadline.legalRef,
        message: `The copy went to the commissioner on ${formatAuDate(toIso(sent))}, after the `
          + `${formatAuDate(deadline.due)} deadline. Ten `
          + 'business days is the whole of it, and the maximum penalty for missing it is 20 penalty units.',
        blocking: false,
      });
    }
  } else {
    const late = todayIso && parseIsoDate(todayIso) && todayIso.slice(0, 10) > deadline.due;
    add({
      field: 'sentToCommissionerDate',
      formRef: 'Not a Schedule 2 field',
      legalRef: deadline.legalRef,
      message: late
        ? `No copy recorded as given to the commissioner, and the ${formatAuDate(deadline.due)} deadline has passed. `
          + 'The copy is still owed; send it and record the date.'
        : `A copy has to reach the commissioner by ${formatAuDate(deadline.due)}, being ten business days after `
          + 'the statement was required'
          + `${deadline.basis === 'signature-fallback' ? ' (counted from the signature — see caveats)' : ''}.`,
      blocking: false,
    });
  }

  return issues;
}

/** True when nothing blocking is outstanding. */
export function canSignAsSchedule2(statement: FilledOccupierStatement, todayIso?: string): boolean {
  return !checkOccupierStatement(statement, todayIso).some((i) => i.blocking);
}

// ---------------------------------------------------------------------------
// The approved-form claim
// ---------------------------------------------------------------------------

export interface ApprovedFormClaim {
  /**
   * True only when every Schedule 2 field is present and every Schedule 2
   * installation has been addressed. Nothing else sets it.
   */
  isSchedule2Form: boolean;
  /** The sentence the document prints about itself. Never optimistic. */
  statement: string;
  /** Which Schedule 2 fields are not completed, named. */
  missingFields: { formRef: string; label: string; why: string }[];
  /**
   * Which Schedule 2 rows are not finished, and what is missing from each.
   *
   * The `why` is not decoration. "Sprinklers have not been addressed" sends an
   * occupier back to a row that looks filled in; "the rectification date is
   * blank" sends them to the box.
   */
  unaddressedInstallations: { formRef: string; name: string; why: string }[];
  /**
   * Fields the app carries that Schedule 2 does not print. These improve the
   * document and cannot disqualify it, so they are reported separately rather
   * than counted against it.
   */
  additionsBeyondSchedule: string[];
  /**
   * Why "approved form" is the wrong phrase for this document, and what the
   * right one is. Printed alongside the claim so nobody re-adds the old
   * disclaimer out of caution.
   */
  note: string;
  legalRef: string;
  sourceIds: SourceId[];
}

const APPROVED_FORM_NOTE =
  'Section 53(2) of the Building Fire Safety Regulation 2008 uses "the approved form", but only for a critical '
  + 'defect notice. Section 55A requires an occupier statement that complies with QDC part MP 6.1, and MP 6.1 sets '
  + 'that statement out in its own Schedule 2. There is no separate approved form for it, so a document that '
  + 'reproduces Schedule 2 in full is the statement the regulation requires.';

/**
 * Whether this document can honestly call itself the statutory statement.
 *
 * The test is deliberately narrow and mechanical: every field Schedule 2 prints
 * is completed, and every one of the twenty-one installations has been
 * addressed one way or the other. It does not ask whether the maintenance was
 * any good, whether the standards nominated are the right ones, or whether the
 * copy reached the commissioner. Those are checkOccupierStatement's business.
 * Conflating them would mean a statement failing to be the form because a
 * lodgement was late, which is not what being the form means.
 *
 * When it cannot say yes it says which field is missing. "Not the approved
 * form" told the occupier nothing they could act on; "Name of occupier is
 * blank" tells them everything.
 */
export function approvedFormClaim(statement: FilledOccupierStatement): ApprovedFormClaim {
  const missingFields: { formRef: string; label: string; why: string }[] = [];
  const filled = (s: string | undefined): boolean => !!s && s.trim().length > 0;

  if (!filled(statement.buildingName) || !filled(statement.buildingAddress)) {
    missingFields.push({
      formRef: 'Schedule 2, header',
      label: 'Name of building and address',
      why: !filled(statement.buildingName) && !filled(statement.buildingAddress)
        ? 'Neither the building name nor its address is recorded.'
        : !filled(statement.buildingName)
          ? 'The address is recorded but the building is not named.'
          : 'The building is named but has no address.',
    });
  }
  if (!filled(statement.occupierName)) {
    missingFields.push({
      formRef: 'Schedule 2, header',
      label: 'Name of occupier',
      why: 'The occupier is not named.',
    });
  }
  if (!filled(statement.declarationFullName)) {
    missingFields.push({
      formRef: 'Schedule 2, declaration',
      label: 'Full name',
      why: 'The authorised person making the declaration is not named.',
    });
  }
  if (!filled(statement.organisationName) && !statement.footnote7Applies) {
    missingFields.push({
      formRef: 'Schedule 2, declaration',
      label: 'Name of organisation',
      why: 'No organisation is named and footnote 7 has not been claimed.',
    });
  }
  if (!filled(statement.signature)) {
    missingFields.push({
      formRef: 'Schedule 2, declaration',
      label: 'Signature',
      why: 'The declaration is unsigned.',
    });
  }
  if (!filled(statement.signedDate)) {
    missingFields.push({
      formRef: 'Schedule 2, declaration',
      label: 'Date',
      why: 'The declaration is undated.',
    });
  }

  const answered = new Map<number, FilledInstallationRow>();
  for (const row of statement.rows) {
    const item = schedule2Installation(row.installation);
    if (item && row.installed !== undefined && !answered.has(item.row)) answered.set(item.row, row);
  }

  const unaddressed: { formRef: string; name: string; why: string }[] = [];
  for (const item of SCHEDULE_2_INSTALLATIONS) {
    const row = answered.get(item.row);
    if (!row) {
      unaddressed.push({
        formRef: item.ref,
        name: item.name,
        why: 'The row is not on this statement at all. Footnote 2 deletes an installation the building does not '
          + 'have, which is an answer; leaving the row off is not.',
      });
      continue;
    }
    // A row struck out under footnote 2 is finished: the schedule deletes it
    // rather than asking its columns.
    if (!row.installed) continue;

    // An installation marked as present is addressed only once every box the
    // schedule rules against it carries something. Each of the four below is an
    // empty box on a document about to declare that "every field the schedule
    // sets out has been completed", so a hole here does not make the claim
    // weaker — it makes it untrue.
    if (!filled(row.nominatedStandard)) {
      unaddressed.push({
        formRef: item.ref,
        name: item.name,
        why: 'Column 2 nominates no Australian Standard or maintenance requirement.',
      });
      continue;
    }
    if (row.criticalDefectNoticeIssued === undefined) {
      unaddressed.push({
        formRef: item.ref,
        name: item.name,
        why: 'Column 3 asks Yes or No — whether a critical defect notice was issued during the period — and is '
          + 'blank.',
      });
      continue;
    }
    if (row.criticalDefectNoticeIssued && !filled(row.rectificationDate)) {
      // The worst of them to get wrong, and the one the old test suite let
      // through: the row says a critical defect notice was issued and column 4
      // does not say the defect was ever fixed. Calling that document the
      // statutory statement puts a declaration over an installation that may
      // still be inoperable.
      unaddressed.push({
        formRef: item.ref,
        name: item.name,
        why: 'Column 3 says a critical defect notice was issued during the period and column 4 gives no date of '
          + 'rectification.',
      });
      continue;
    }
    if (item.detailsRequired && !filled(row.details)) {
      // Column 1 of this row is not a name, it is a name and a blank: the
      // schedule prints "Other features (provide details)".
      unaddressed.push({
        formRef: item.ref,
        name: item.name,
        why: 'The row is marked as installed and column 1 asks for details of what it covers, which are not given.',
      });
    }
  }

  const additions: string[] = [];
  if (filled(statement.periodStart) || filled(statement.periodEnd)) {
    additions.push('The period covered by the statement, which Schedule 2 refers to throughout but provides no box for.');
  }
  if (filled(statement.sentToCommissionerDate)) {
    additions.push('The date the copy went to the commissioner, which is a section 55A(3) matter rather than a Schedule 2 field.');
  }
  if (statement.rows.some((r) => filled(r.maintenanceDate))) {
    additions.push('The maintenance date behind each row, which lets the one month in section 54(4) be checked.');
  }

  const ok = missingFields.length === 0 && unaddressed.length === 0;
  const legalRef = 'Building Fire Safety Regulation 2008 (Qld) s 55A(1); QDC MP 6.1 A2(b), Schedule 2';
  const sourceIds: SourceId[] = ['qdc-mp61', 'bfsr-2008'];

  if (ok) {
    return {
      isSchedule2Form: true,
      statement:
        'This statement is in the form of Schedule 2 of the Queensland Development Code Mandatory Part 6.1 — '
        + 'Maintenance of fire safety installations, and is the occupier statement required by section 55A of the '
        + 'Building Fire Safety Regulation 2008. Every installation Schedule 2 lists has been addressed and every '
        + 'field the schedule sets out has been completed.',
      missingFields,
      unaddressedInstallations: unaddressed,
      additionsBeyondSchedule: additions,
      note: APPROVED_FORM_NOTE,
      legalRef,
      sourceIds,
    };
  }

  const parts: string[] = [];
  if (missingFields.length) {
    parts.push(
      `${missingFields.length} field${missingFields.length === 1 ? '' : 's'} Schedule 2 sets out `
      + `${missingFields.length === 1 ? 'is' : 'are'} not completed: `
      + `${missingFields.map((f) => f.label).join('; ')}`,
    );
  }
  if (unaddressed.length) {
    // A row can now be unaddressed for four different reasons, so where there
    // are few enough to read the sentence says which. Past a handful the
    // document is a blank form and the list of names is the useful thing; the
    // reasons are still on every entry for a screen to show against the row.
    const detailed = unaddressed.length <= 3;
    parts.push(
      `${unaddressed.length} of the twenty-one installations ${unaddressed.length === 1 ? 'has' : 'have'} not been `
      + `addressed: ${unaddressed
        .map((u) => (detailed ? `${u.name} — ${u.why.replace(/\.$/, '')}` : u.name))
        .join('; ')}`,
    );
  }

  return {
    isSchedule2Form: false,
    statement:
      'This document is not yet the Schedule 2 occupier statement. '
      + `${parts.join('. ')}. Complete ${missingFields.length + unaddressed.length === 1 ? 'it' : 'them'} and this `
      + 'document is the statement the regulation requires.',
    missingFields,
    unaddressedInstallations: unaddressed,
    additionsBeyondSchedule: additions,
    note: APPROVED_FORM_NOTE,
    legalRef,
    sourceIds,
  };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * The shape the app already stores a statement row in.
 *
 * Declared structurally rather than imported, so this module stays free of the
 * persistence layer and can be read without pulling a database driver into a
 * test runner.
 */
export interface StoredStatementRow {
  installation: string;
  present: boolean;
  nominatedStandard?: string;
  criticalDefectNoticeGiven: boolean;
  rectifiedDate?: string;
}

/**
 * A stored row as a filled Schedule 2 row.
 *
 * One asymmetry is deliberate. `present` is a boolean in storage and cannot be
 * unanswered, so it maps straight across; `criticalDefectNoticeGiven` is also a
 * boolean, and a false there genuinely means "No" was recorded, because the app
 * writes both halves of that answer together. If either ever becomes nullable
 * in storage, map the null to undefined here rather than to false — an
 * unanswered column and a No are different answers on this form.
 */
export function toFilledRow(row: StoredStatementRow): FilledInstallationRow {
  return {
    installation: row.installation,
    installed: row.present,
    nominatedStandard: row.nominatedStandard,
    criticalDefectNoticeIssued: row.present ? row.criticalDefectNoticeGiven : undefined,
    rectificationDate: row.rectifiedDate,
  };
}
