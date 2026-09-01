import {
  SOURCES as QLD_SOURCES, firstStatementDue, nextStatementDue,
} from '@/domain/occupierForm';
import {
  criticalNoticeDueAt, isQldCriticalDefect, rectificationDueAt, type As1851Class,
} from '@/domain/qldCompliance';
import { QLD_UTC_OFFSET_HOURS, qldIsoDay } from '@/domain/qldTime';
import { routineDue, type DueState, type RoutineHistory } from '@/domain/schedule';
import { SYSTEM_LABELS, type SystemKind } from '@/seed/assetTypes';
import { FREQUENCY_LABEL, routineById, type Frequency } from '@/seed/serviceRoutines';

/**
 * How the whole book is going.
 *
 * The app can answer everything about one site and nothing about 897 of them.
 * That is the wrong way round for the business: the question that decides where
 * a technician goes tomorrow is never "how is this site?", it is "of everything
 * we carry, what is worst?" — and answering that on a spreadsheet produces
 * three failures this module exists to stop.
 *
 * **A site nobody has serviced is not a site that is late.** It is a site the
 * app knows nothing about, and the two look identical in a count. Safe QLD took
 * on sites that were being serviced by somebody else for years before this app
 * existed; a site with no history here may be immaculate or may have been left
 * for a decade, and nothing in the data separates those. Counting them as
 * overdue invents a failure; counting them as current hides one. They are kept
 * as their own category, excluded from every percentage, and the reason is
 * printed rather than left to be inferred.
 *
 * **Exposure is not a count.** One site with a critical defect past its
 * rectification month and a lapsed annual is not the same as five sites a week
 * past a monthly, and a list sorted by "number of things overdue" puts the five
 * on top. So sites are ranked by a score — and because a score is a number
 * somebody has to trust, every point in it is itemised: which routine, how many
 * days, which defect, what the weight was and where that weight came from. A
 * technician can read the reason a site is at the top without believing the
 * total. The weights themselves are Safe QLD's own judgement, marked as such,
 * and they are not from any standard.
 *
 * **A statutory clock is not a health metric.** A critical defect notice is due
 * in 24 hours because the regulation says so, and averaging that into a
 * percentage is how a legal obligation goes quiet. Statutory exposure is
 * counted separately, listed item by item, and never enters the health figures.
 *
 * Above all of it sits coverage. A dashboard that reads green because it only
 * knows about forty sites is the most dangerous screen in this app, so the
 * fraction of the book the data can actually judge is computed first and stated
 * first, and the denominator behind every percentage is carried with it.
 *
 * Nothing here touches the database. Plain arrays in, a picture out, which is
 * what makes each of these decisions testable.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low';

export type PortfolioSourceId =
  | 'bfsr-2008'
  | 'qdc-mp61'
  | 'as1851-section-6'
  | 'auspost-localities'
  | 'safe-qld-weighting';

export interface PortfolioSource {
  id: PortfolioSourceId;
  /** What this module relies on the source for, in one line. */
  what: string;
  ref: string;
  /** Absent where there is nothing to link to — a purchased standard, or a judgement. */
  url?: string;
  confidence: Confidence;
  /** Why the confidence is what it is, so a reader can weigh it themselves. */
  basis: string;
}

/**
 * The statutory references and the URLs are taken from the occupier statement
 * module rather than retyped, so the two cannot end up citing different
 * reprints of the same regulation.
 */
export const PORTFOLIO_SOURCES: Record<PortfolioSourceId, PortfolioSource> = {
  'bfsr-2008': {
    id: 'bfsr-2008',
    what: 'The clocks counted here: 24 hours to give the occupier a critical defect notice, one month for the '
      + 'occupier to have the repair carried out, and ten business days to give the commissioner a statement copy',
    ref: QLD_SOURCES['bfsr-2008'].ref,
    url: QLD_SOURCES['bfsr-2008'].url,
    confidence: 'high',
    basis: 'Queensland subordinate legislation. Section 53 runs the 24 hours from when the maintenance was '
      + 'carried out; this app holds when the defect was raised, which is the nearest thing it has, and every '
      + 'figure derived from it says so.',
  },
  'qdc-mp61': {
    id: 'qdc-mp61',
    what: 'That an occupier statement falls due yearly, which is what makes a statement date overdue rather than old',
    ref: QLD_SOURCES['qdc-mp61'].ref,
    url: QLD_SOURCES['qdc-mp61'].url,
    confidence: 'high',
    basis: 'Queensland Crown material. The year runs from the last statement, not from the last service.',
  },
  'as1851-section-6': {
    id: 'as1851-section-6',
    what: 'The intervals and tolerance windows that decide whether a routine is upcoming, due or overdue',
    ref: 'AS 1851:2012 Section 6 schedule tables, as held in this app by table number, interval and tolerance only',
    confidence: 'high',
    basis: 'Applied through this app\'s own scheduling rules, which carry item numbers and tolerances but never '
      + 'the standard\'s text. A frequency with no table behind it is reported as unschedulable rather than '
      + 'given the nearest tolerance.',
  },
  'auspost-localities': {
    id: 'auspost-localities',
    what: 'That one Queensland suburb name can carry more than one postcode, and the worked example the suburb '
      + 'caveat gives: Springfield is 4300 in Ipswich and 4871 in the Shire of Mareeba',
    ref: 'Australia Post postcode search, locality "Springfield"',
    url: 'https://auspost.com.au/postcode/springfield',
    confidence: 'high',
    basis: 'The carrier\'s own locality list, which is where the postcode on a site record comes from. Checked '
      + '1/9/2026. It is used only to justify keeping the postcodes behind a suburb row; no routing, distance or '
      + 'scheduling decision is taken from it.',
  },
  'safe-qld-weighting': {
    id: 'safe-qld-weighting',
    what: 'Every point in a risk score: what each factor is worth relative to the others',
    ref: 'Safe QLD field judgement about relative exposure across a book of work',
    confidence: 'low',
    basis: 'Not from a standard, not a regulator\'s position, and not validated against outcomes. It is one '
      + 'company\'s opinion about what to look at first, which is why every contribution is shown individually '
      + 'and the ranking is never presented as a compliance finding.',
  },
};

/**
 * The example the suburb caveat gives for why a name is not a place.
 *
 * Held here with its source id rather than written into the sentence that
 * prints it, because it is an external fact and the first version of that
 * sentence had it wrong — it said 4870, which is Cairns. A wrong postcode in a
 * caveat about wrong postcodes is the kind of thing a client notices.
 */
export const SUBURB_NAME_COLLISION: {
  name: string;
  postcodes: [string, string];
  places: [string, string];
  sourceId: PortfolioSourceId;
} = {
  name: 'Springfield',
  postcodes: ['4300', '4871'],
  places: ['Ipswich', 'the Shire of Mareeba, in the far north'],
  sourceId: 'auspost-localities',
};

export function portfolioSources(ids: PortfolioSourceId[]): PortfolioSource[] {
  const seen = new Set<PortfolioSourceId>();
  const out: PortfolioSource[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(PORTFOLIO_SOURCES[id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dates — Queensland is UTC+10 all year and never shifts
// ---------------------------------------------------------------------------

export { QLD_UTC_OFFSET_HOURS };

/**
 * The Queensland calendar date at an instant, or nothing when it is not one.
 *
 * Date.parse is never handed a string this has not already recognised as ISO.
 * Given "1/9/2026" — an ordinary Australian date meaning 1 September — Date.parse
 * returns 9 January, silently, and every tolerance window in the book moves
 * eight months. Anything that is not ISO is refused rather than read.
 *
 * That reasoning was right and this was the only one of the six copies of the
 * Queensland day that acted on it. It now lives in qldTime.ts, which is where
 * the other five got it from, and this delegates.
 */
export function qldToday(instantIso: string): string | undefined {
  return qldIsoDay(instantIso);
}

function parseIsoDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // The round trip is the whole check. new Date("2026-02-31T00:00:00Z") does
  // not fail; it rolls forward to 3 March, and a rectification month counted
  // from it is three days out with nothing to show for it.
  return d.toISOString().slice(0, 10) === day ? d : null;
}

/**
 * The ISO day inside a string, or nothing where the string is not ISO at all.
 *
 * The reason this exists is `new Date(x)`. Everything downstream of this module
 * — criticalNoticeDueAt in particular — hands its argument straight to it, and
 * new Date("1/9/2026") returns 9 January 2026 without complaint. A defect
 * raised on 1 September then reports its 24-hour notice as having run out eight
 * months ago, in the statutory block, with a day count beside it. Nothing that
 * has not been recognised as ISO here is passed to a date function.
 */
export function isoDay(text: string | undefined): string | undefined {
  const s = text?.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  return parseIsoDate(s) ? s.slice(0, 10) : undefined;
}

/**
 * The instant a readable ISO string names, or nothing.
 *
 * A date with no time is taken at midnight UTC, which is what every date-only
 * value in this app already means when it is compared against another.
 */
export function isoInstantMs(text: string | undefined): number | undefined {
  const s = text?.trim();
  if (!s || !isoDay(s)) return undefined;
  if (s.length === 10) return Date.parse(`${s}T00:00:00Z`);
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

/** Whole days from one date to another. Negative when `to` is the earlier one. */
export function daysBetween(fromIso: string, toIso: string): number | undefined {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return undefined;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PortfolioSite {
  siteId: string;
  siteName: string;
  clientName?: string;
  suburb?: string;
  postcode?: string;
  /**
   * How many assets the site holds, where the caller knows.
   *
   * Given explicitly this distinguishes the two cases a derived count cannot:
   * a site whose register was imported and is genuinely empty, and a site whose
   * register has never been imported at all. The first is knowledge; the second
   * is a hole, and only the second should dent coverage.
   */
  assetCount?: number;
  /** When the last occupier's statement was signed, where the app has been told. */
  lastStatementAt?: string;
  /** When the occupier took up occupation — the anchor for a first statement. */
  occupationAt?: string;
}

/** A site's history for one routine, as the schedule rules want it. */
export interface PortfolioRoutineHistory extends RoutineHistory {
  siteId: string;
  /** The system it belongs to. Read off the routine when the caller omits it. */
  system?: SystemKind;
}

export interface PortfolioAsset {
  siteId: string;
  assetTypeId?: string;
  system?: SystemKind;
}

/** Statuses that mean the defect is still out there. */
export const OUTSTANDING_STATUSES = ['open', 'quoted'] as const;

export type DefectStatus = 'open' | 'rectified' | 'quoted' | 'closed';

export interface PortfolioDefect {
  defectId: string;
  siteId: string;
  status: DefectStatus;
  severity: 'critical' | 'non-critical';
  raisedAt: string;
  description?: string;
  location?: string;
  as1851Class?: As1851Class;
  /** Limb (a): the defect renders the installation inoperable. */
  qldLimbInoperable?: boolean;
  /** Limb (b): reasonably likely to significantly affect occupant safety. */
  qldLimbAdverseImpact?: boolean;
  noticeIssuedAt?: string;
  verbalNotifiedAt?: string;
  rectificationDueAt?: string;
  rectifiedAt?: string;
}

// ---------------------------------------------------------------------------
// Where a defect stands under the Queensland test
// ---------------------------------------------------------------------------

/**
 * Whether a defect is a Queensland critical defect.
 *
 * Three answers, not two. The regulation's test has two limbs and both have to
 * be answered; a defect a technician flagged as critical without answering them
 * is a defect whose statutory status nobody has established. Calling that
 * "critical" puts a notice obligation on the company that may not exist, and
 * calling it "not critical" drops one that may. It is unanswered, and it is
 * reported as unanswered.
 */
export type QldCriticalVerdict = 'yes' | 'no' | 'unanswered';

export function qldCriticalVerdict(defect: PortfolioDefect): QldCriticalVerdict {
  const { qldLimbInoperable: a, qldLimbAdverseImpact: b } = defect;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return isQldCriticalDefect(a, b) ? 'yes' : 'no';
  }
  // A limb answered false settles it on its own — both must be true.
  if (a === false || b === false) return 'no';
  if (defect.severity === 'critical' || defect.as1851Class === 'critical') return 'unanswered';
  return 'no';
}

export function isOutstanding(defect: PortfolioDefect): boolean {
  return (OUTSTANDING_STATUSES as readonly string[]).includes(defect.status) && !defect.rectifiedAt;
}

export interface DefectClocks {
  /** The raised date as this app can read it. Absent where it cannot read it. */
  raisedDay?: string;
  /** When the written notice fell due. Absent where the raised date is unreadable. */
  noticeDueAt?: string;
  /** True only where the deadline has actually passed and no notice is recorded. */
  noticeOverdue: boolean;
  /** The date the repair had to be carried out by. */
  rectifyBy?: string;
  /** Why there is no rectification date, naming the field that is at fault. */
  rectifyUnknownBecause?: string;
}

/**
 * Both statutory clocks on one defect, worked out once.
 *
 * They are computed here rather than in each of the two places that need them
 * because the two used to disagree: the score and the statutory block each did
 * their own arithmetic, and a legal figure that depends on which function asked
 * is not a legal figure.
 *
 * The important rule is that nothing unreadable is guessed at, in either
 * direction. `criticalNoticeDueAt` calls `new Date()`, which reads the ordinary
 * Australian date "1/9/2026" as 9 January and says nothing — so a defect raised
 * on 1 September was reported as having missed its 24-hour notice by eight
 * months, in the same block that said the date could not be read. Nothing
 * reaches a date function that `isoDay` has not recognised first.
 *
 * A rectification date the office recorded but this app cannot read is refused
 * outright rather than replaced with one counted from the raised date. The
 * recorded date is somebody's decision; substituting a different one behind it
 * asserts a deadline nobody set.
 */
export function defectClocks(defect: PortfolioDefect, nowMs: number): DefectClocks {
  const raisedDay = isoDay(defect.raisedAt);
  const noticeDueAt = raisedDay === undefined
    ? undefined
    : criticalNoticeDueAt(defect.raisedAt) ?? undefined;
  const noticeDueMs = isoInstantMs(noticeDueAt);

  const recorded = defect.rectificationDueAt?.trim();
  const recordedDay = recorded ? isoDay(recorded) : undefined;

  let rectifyBy: string | undefined;
  let rectifyUnknownBecause: string | undefined;
  if (recordedDay) {
    rectifyBy = recordedDay;
  } else if (recorded) {
    rectifyUnknownBecause = `A rectification date of "${recorded}" is recorded against the defect but is not a `
      + 'date this app can read. The month is not counted from the raised date instead, because that would '
      + 'assert a deadline nobody set.';
  } else if (raisedDay) {
    rectifyBy = rectificationDueAt(raisedDay) ?? undefined;
  } else {
    rectifyUnknownBecause = `No rectification date is recorded and the raised date ("${defect.raisedAt}") is not `
      + 'one this app can read, so the month cannot be counted from anything.';
  }

  return {
    raisedDay,
    noticeDueAt,
    noticeOverdue: !defect.noticeIssuedAt && noticeDueMs !== undefined && noticeDueMs < nowMs,
    rectifyBy,
    rectifyUnknownBecause,
  };
}

// ---------------------------------------------------------------------------
// Risk weights — Safe QLD's own judgement, itemised so it can be argued with
// ---------------------------------------------------------------------------

export type RiskFactor =
  | 'critical-defect'
  | 'critical-defect-unclassified'
  | 'rectification-overdue'
  | 'notice-overdue'
  | 'routine-overdue'
  | 'routine-overdue-age'
  | 'routine-due'
  | 'non-critical-defects'
  | 'statement-overdue';

export interface RiskWeight {
  factor: RiskFactor;
  label: string;
  /** Points per occurrence. Whole numbers, so a score is exact arithmetic. */
  points: number;
  /** The most this factor may contribute at one site, where a cap applies. */
  cap?: number;
  /** Why it is weighted where it is, in plain English. */
  why: string;
  sourceIds: PortfolioSourceId[];
}

/**
 * What each factor is worth.
 *
 * Every number here is a judgement and is worth arguing about — which is the
 * point of holding them as data rather than burying them in an expression. An
 * office that disagrees can change one line and see the ranking move, and every
 * score printed anywhere says which weights produced it.
 */
export const RISK_WEIGHTS: Record<RiskFactor, RiskWeight> = {
  'critical-defect': {
    factor: 'critical-defect',
    label: 'Open critical defect',
    points: 40,
    why: 'Both limbs of the Queensland test are answered yes: the installation is inoperable and occupant '
      + 'safety is significantly affected. Nothing else on a site outranks it.',
    sourceIds: ['bfsr-2008', 'safe-qld-weighting'],
  },
  'critical-defect-unclassified': {
    factor: 'critical-defect-unclassified',
    label: 'Defect flagged critical, limbs unanswered',
    points: 20,
    why: 'Somebody called it critical and nobody answered the two limbs. It is scored as exposure because the '
      + 'defect is real, but it is deliberately not counted in the statutory figures, because whether the '
      + 'notice obligation bites has not been established.',
    sourceIds: ['bfsr-2008', 'safe-qld-weighting'],
  },
  'rectification-overdue': {
    factor: 'rectification-overdue',
    label: 'Past the rectification date',
    points: 25,
    why: 'The occupier had one month from the maintenance. Past it, the exposure is the occupier\'s in law and '
      + 'Safe QLD\'s in practice, because the company holds the record showing the defect was found.',
    sourceIds: ['bfsr-2008', 'safe-qld-weighting'],
  },
  'notice-overdue': {
    factor: 'notice-overdue',
    label: 'Written critical defect notice not recorded',
    points: 20,
    why: 'The 24 hours has run and no written notice is recorded against the defect. This is the company\'s own '
      + 'obligation rather than the occupier\'s, which is why it scores even though the defect may be in hand.',
    sourceIds: ['bfsr-2008', 'safe-qld-weighting'],
  },
  'routine-overdue': {
    factor: 'routine-overdue',
    label: 'Routine past its tolerance window',
    points: 0,
    why: 'The base weight depends on the frequency: a lapsed annual is not a lapsed monthly. See the frequency '
      + 'table, which is the number actually applied.',
    sourceIds: ['as1851-section-6', 'safe-qld-weighting'],
  },
  'routine-overdue-age': {
    factor: 'routine-overdue-age',
    label: 'How long it has been overdue',
    points: 1,
    cap: 12,
    why: 'One point per week past the end of the window, to twelve. A month late and three months late are '
      + 'different problems; a year late and two years late are the same problem, so it stops climbing.',
    sourceIds: ['as1851-section-6', 'safe-qld-weighting'],
  },
  'routine-due': {
    factor: 'routine-due',
    label: 'Routine due now, still inside its window',
    points: 2,
    cap: 10,
    why: 'Work to be placed rather than a failure. It scores a little so a site with eight services due sorts '
      + 'above one with none, and never enough to outrank anything that has actually lapsed.',
    sourceIds: ['as1851-section-6', 'safe-qld-weighting'],
  },
  'non-critical-defects': {
    factor: 'non-critical-defects',
    label: 'Open non-critical defects',
    points: 3,
    cap: 15,
    why: 'Real work and real liability, but not an emergency. Capped so that a site with forty small defects '
      + 'cannot out-score a site with one critical one.',
    sourceIds: ['safe-qld-weighting'],
  },
  'statement-overdue': {
    factor: 'statement-overdue',
    label: 'Occupier statement past due',
    points: 10,
    why: 'The occupier\'s obligation, not the maintainer\'s, but Safe QLD is who they will ring on the day they '
      + 'discover it, and the statement cannot be signed while a critical defect is open.',
    sourceIds: ['qdc-mp61', 'safe-qld-weighting'],
  },
};

/**
 * What an overdue routine is worth, by frequency.
 *
 * The yearly is the heaviest because everything else hangs off it — the
 * condition report, the occupier statement, and the only routine at which most
 * of the site's devices are touched at all. A missed monthly is a panel that
 * has not been looked at; a missed annual is a building whose detection has not
 * been tested for over a year.
 *
 * Quarterly and commissioning appear for completeness and score nothing: they
 * have no Section 6 schedule table, so the scheduling rules never call them
 * overdue in the first place.
 */
export const OVERDUE_POINTS_BY_FREQUENCY: Record<Frequency, number> = {
  annual: 30,
  'five-yearly': 24,
  'ten-yearly': 20,
  'six-monthly': 14,
  monthly: 6,
  quarterly: 0,
  commissioning: 0,
};

export type RiskBand = 'severe' | 'high' | 'moderate' | 'low' | 'none';

export interface RiskBandDef {
  band: RiskBand;
  /** Lowest score in the band. */
  from: number;
  label: string;
  meaning: string;
}

/** Bands are a reading aid on the score, not a separate judgement. */
export const RISK_BANDS: RiskBandDef[] = [
  { band: 'severe', from: 60, label: 'Severe', meaning: 'Statutory exposure, lapsed servicing, or both. Go here first.' },
  { band: 'high', from: 30, label: 'High', meaning: 'Something has lapsed or a defect is running past its date.' },
  { band: 'moderate', from: 10, label: 'Moderate', meaning: 'Work is stacking up but nothing has breached.' },
  { band: 'low', from: 1, label: 'Low', meaning: 'Minor exposure only.' },
  { band: 'none', from: 0, label: 'Nothing scored', meaning: 'Nothing this app can see counts against the site.' },
];

export function riskBand(score: number): RiskBand {
  for (const def of RISK_BANDS) if (score >= def.from) return def.band;
  return 'none';
}

// ---------------------------------------------------------------------------
// A site's score, itemised
// ---------------------------------------------------------------------------

export interface RiskContribution {
  factor: RiskFactor;
  /** The short reason, as the screen shows it: "Annual — 62 days past its window". */
  label: string;
  /** Whole points. The sum of these is the score, exactly. */
  points: number;
  /** The long reason, including the arithmetic where there is any. */
  detail: string;
  sourceIds: PortfolioSourceId[];
  /** The routine or defect it came from, for a screen that wants to link to it. */
  routineId?: string;
  defectId?: string;
}

/** Something the app could not weigh, carried with the site rather than scored. */
export interface RiskUnknown {
  code:
    | 'never-serviced'
    | 'routines-never-recorded'
    | 'no-schedule-table'
    | 'no-asset-register'
    | 'critical-limbs-unanswered'
    | 'defect-date-unreadable'
    | 'statement-date-unknown';
  detail: string;
}

export interface SiteRisk {
  siteId: string;
  siteName: string;
  clientName?: string;
  suburb?: string;
  postcode?: string;
  standing: SiteStanding;
  /** Exactly the sum of the contributions below it. */
  score: number;
  band: RiskBand;
  contributions: RiskContribution[];
  /** What could not be weighed here. Never scored, always shown. */
  unknowns: RiskUnknown[];
  overdueRoutines: number;
  dueRoutines: number;
  criticalDefectsOutstanding: number;
  defectsOutstanding: number;
  /** True when a statutory clock is running or has run out at this site. */
  statutoryExposure: boolean;
}

/**
 * Where a site stands on the servicing schedule.
 *
 * "Never serviced" is not a position on the scale — it is the absence of one,
 * and it sits here so that no arithmetic can accidentally place it between
 * current and overdue.
 */
export type SiteStanding = 'overdue' | 'due' | 'current' | 'never-serviced' | 'unschedulable';

export const STANDING_LABEL: Record<SiteStanding, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  current: 'Current',
  'never-serviced': 'Never serviced',
  unschedulable: 'Cannot be scheduled',
};

export const STANDING_MEANING: Record<SiteStanding, string> = {
  overdue: 'At least one routine is past the end of its tolerance window.',
  due: 'At least one routine is inside its window now, and none has lapsed.',
  current: 'Every routine this app can schedule here is still ahead of its window.',
  'never-serviced':
    'No service has ever been recorded here in this app. That is not the same as a site that has lapsed: the '
    + 'app cannot tell a site nobody has serviced from a site serviced for years before the app existed. It is '
    + 'counted on its own and left out of every percentage.',
  unschedulable:
    'Services have been recorded, but nothing here can be placed on a schedule: either no routine carries a '
    + 'Section 6 schedule table, or no first service date is held to anchor one from. Nothing can be called due '
    + 'or overdue without inventing a tolerance.',
};

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------

export interface PortfolioHealth {
  sites: number;
  current: number;
  due: number;
  overdue: number;
  neverServiced: number;
  unschedulable: number;
  /** Sites that can be placed on the current/due/overdue scale at all. */
  judged: number;
  /**
   * Current as a fraction of what can be judged. Undefined when nothing can be
   * judged — which is an answer, and is not zero and is not one.
   */
  currentFractionOfJudged?: number;
  /** The denominator, spelled out, because the denominator is the whole argument. */
  denominator: string;
}

export interface PortfolioCoverage {
  sites: number;
  judged: number;
  neverServiced: number;
  unschedulable: number;
  /** judged / sites. Undefined when there are no sites at all. */
  fraction?: number;
  /** The same figure as a whole percent, for a tile. */
  percent?: number;
  sitesWithAssetsKnown: number;
  sitesWithAssetsUnknown: number;
  assetsCounted: number;
  /** Whether the health figures describe most of the book or a corner of it. */
  enoughToJudge: boolean;
  /** The sentence the screen prints before anything else. */
  headline: string;
  caveats: string[];
}

/**
 * How much of the book has to be judgeable before a health figure is worth reading.
 *
 * Four fifths, and that is Safe QLD's own line rather than anybody's rule —
 * held under the same source as the risk weights and marked the same way. It is
 * not a claim that 79% is a minority; it is a claim that a fifth of the book
 * missing from a percentage is enough that the percentage should carry a
 * warning next to it.
 */
export const COVERAGE_THRESHOLD = 0.8;
export const COVERAGE_THRESHOLD_SOURCE: PortfolioSourceId = 'safe-qld-weighting';

export type StatutoryKind =
  | 'notice-running'
  | 'notice-overdue'
  | 'rectification-overdue'
  | 'rectification-date-unknown'
  | 'notice-date-unknown'
  | 'classification-unanswered'
  | 'statement-overdue'
  | 'statement-due-soon'
  | 'statement-date-unknown';

export const STATUTORY_LABEL: Record<StatutoryKind, string> = {
  'notice-running': 'Notice clock running',
  'notice-overdue': 'Written notice not recorded',
  'rectification-overdue': 'Past rectification date',
  'rectification-date-unknown': 'Rectification date unknown',
  'notice-date-unknown': 'Notice deadline unknown',
  'classification-unanswered': 'Critical limbs unanswered',
  'statement-overdue': 'Occupier statement overdue',
  'statement-due-soon': 'Occupier statement due',
  'statement-date-unknown': 'No statement date held',
};

export interface StatutoryItem {
  kind: StatutoryKind;
  siteId: string;
  siteName: string;
  defectId?: string;
  /** The date the obligation falls, where one can be worked out. */
  dueAt?: string;
  /** Negative when the date has passed. Absent where there is no date. */
  daysRemaining?: number;
  detail: string;
  legalRef: string;
  sourceIds: PortfolioSourceId[];
}

export interface StatutoryExposure {
  /** Both limbs answered yes and the defect is still outstanding. */
  criticalDefectsOutstanding: number;
  noticeClockRunning: number;
  noticeOverdue: number;
  noticeRecorded: number;
  pastRectificationDate: number;
  rectificationDateUnknown: number;
  /** Critical defects whose raised date cannot be read, so the 24 hours has no start. */
  noticeDateUnknown: number;
  /** Flagged critical with the two limbs never answered. Not counted as critical. */
  classificationUnanswered: number;
  statementsOverdue: number;
  statementsDueSoon: number;
  statementDateUnknown: number;
  sitesAffected: number;
  items: StatutoryItem[];
  /** Why none of this is averaged into a health percentage. */
  note: string;
  sources: PortfolioSource[];
}

export interface ConcentrationRow {
  key: string;
  label: string;
  sites: number;
  overdueRoutines: number;
  criticalDefectsOutstanding: number;
  /**
   * Risk points sitting in this row, in the same units everywhere.
   *
   * On a client or a suburb row that is the sum of the member sites' scores. On
   * a system row it is the sum of the contributions the overdue routines of
   * that system actually scored — a subset of the same totals, never a second
   * arithmetic. It used to be the raw frequency weight on system rows, which
   * meant the number in this field meant one thing in two tables and another in
   * the third, and the two could not be compared.
   */
  riskScore: number;
  /** Share of the portfolio's overdue routines, 0..1. Undefined when there are none. */
  shareOfOverdue?: number;
  /** Sites in this group the app cannot judge — the row's own honesty figure. */
  unjudgedSites: number;
  /** Postcodes seen under this suburb name, where more than one turned up. */
  postcodes?: string[];
}

export interface PortfolioConcentration {
  byClient: ConcentrationRow[];
  bySuburb: ConcentrationRow[];
  bySystem: ConcentrationRow[];
  /** Sites with no client recorded. Counted, never bucketed as "Unknown". */
  sitesWithNoClient: number;
  sitesWithNoSuburb: number;
  /** Overdue routines whose system could not be established. */
  overdueWithNoSystem: number;
  caveats: string[];
}

export interface UnjudgedSite {
  siteId: string;
  siteName: string;
  clientName?: string;
  suburb?: string;
  reason: 'never-serviced' | 'unschedulable';
  detail: string;
  /** Defects still count: absence of a service history does not hide a defect. */
  defectsOutstanding: number;
  criticalDefectsOutstanding: number;
}

export interface Portfolio {
  /** The Queensland calendar date everything was judged against. */
  today?: string;
  coverage: PortfolioCoverage;
  health: PortfolioHealth;
  statutory: StatutoryExposure;
  concentration: PortfolioConcentration;
  /** Ranked worst first. Only sites with something to score appear. */
  ranked: SiteRisk[];
  /** How many sites scored above zero, before the list was cut to the limit. */
  rankedTotal: number;
  /** Sites that cannot be placed on the scale, with the reason. */
  unjudged: UnjudgedSite[];
  /** Rows that referred to a site that is not in the book. */
  unmatched: { histories: number; defects: number; assets: number; detail?: string };
  notes: string[];
  /** Questions this picture declines to answer, and why. */
  refusals: string[];
  sources: PortfolioSource[];
}

export interface PortfolioInput {
  /** Today, as an ISO date or timestamp. Judged on the Queensland calendar. */
  today: string;
  sites: PortfolioSite[];
  histories: PortfolioRoutineHistory[];
  assets: PortfolioAsset[];
  defects: PortfolioDefect[];
  /** How many ranked sites to return. The rest are counted, not listed. */
  rankLimit?: number;
  /** How far ahead an occupier statement counts as due. */
  statementLeadDays?: number;
}

export const DEFAULT_RANK_LIMIT = 50;
export const DEFAULT_STATEMENT_LEAD_DAYS = 60;

// ---------------------------------------------------------------------------
// Grouping keys
// ---------------------------------------------------------------------------

/**
 * A client or suburb is free text. "SPRINGWOOD ", "Springwood" and "springwood"
 * are one place, and treating them as three splits the concentration three ways
 * — which is precisely the failure concentration exists to expose.
 */
function groupKey(value: string | undefined): string | undefined {
  const s = value?.trim().replace(/\s+/g, ' ').toLowerCase();
  return s ? s : undefined;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Australian postcodes are four digits. Anything else is not one. */
function normalisePostcode(postcode: string | undefined): string | undefined {
  const p = postcode?.trim();
  return p && /^\d{4}$/.test(p) ? p : undefined;
}

// ---------------------------------------------------------------------------
// Folding routine runs into histories
// ---------------------------------------------------------------------------

export interface PortfolioRun {
  siteId: string;
  routineId: string;
  /** As the database holds it: a plain string, not yet known to be a frequency. */
  frequency: string;
  system?: string;
  completedAt: string;
}

export interface FoldedRuns {
  histories: PortfolioRoutineHistory[];
  /** Runs that could not be folded, each with the reason. Never silently dropped. */
  rejected: { run: PortfolioRun; reason: string }[];
}

const FREQUENCIES = new Set<string>(Object.keys(FREQUENCY_LABEL));
const SYSTEMS = new Set<string>(Object.keys(SYSTEM_LABELS));

/**
 * Turns a flat list of completions into one history per site and routine.
 *
 * The first completion is the anchor the whole schedule counts from, so this
 * takes the earliest and the latest rather than assuming the list arrived in
 * any order — a run list sorted newest first, folded naively, anchors every
 * site to its most recent service and reports the entire book as current.
 *
 * A run whose frequency is not one this app knows is rejected with the reason
 * rather than mapped to the nearest thing. Guessing "yearly" for a frequency
 * string nobody recognises asserts a two-month tolerance the app has no basis
 * for, and the site would look compliant on the strength of it.
 */
export function foldRuns(runs: PortfolioRun[]): FoldedRuns {
  const byKey = new Map<string, PortfolioRoutineHistory>();
  const rejected: FoldedRuns['rejected'] = [];

  for (const run of runs) {
    if (!run.siteId?.trim() || !run.routineId?.trim()) {
      rejected.push({ run, reason: 'The run does not say which site or which routine it belongs to.' });
      continue;
    }
    if (!FREQUENCIES.has(run.frequency)) {
      rejected.push({
        run,
        reason: `"${run.frequency}" is not a frequency this app knows, so nothing can be said about when the `
          + 'next one falls due.',
      });
      continue;
    }
    /*
     * The Queensland day, not the first ten characters of the timestamp.
     *
     * This becomes firstCompletedAt, which is the anchor — every future service
     * at that site is counted from it, and so is every tolerance window. A run
     * finished at seven on a Brisbane morning is 21:00 UTC the day before, so
     * slicing the timestamp anchored the whole routine a day early and left it
     * there.
     *
     * qldToday is in this file, written for this, with a comment saying a job
     * closed at 23:00 UTC belongs to the following day. It refuses a non-ISO
     * string and a date like 2026-02-31 on the round trip, so it does the
     * rejection this used parseIsoDate for as well.
     */
    const completedAt = qldToday(run.completedAt ?? '');
    if (!completedAt) {
      rejected.push({ run, reason: `"${run.completedAt}" is not a date this app can read.` });
      continue;
    }

    // A separator no id can contain, so "s1 " + "x" and "s1" + " x" cannot
    // collide into one history. Written as an escape rather than as the byte
    // itself: a literal NUL in the source makes git diff the whole file as
    // binary and makes grep skip it.
    const key = `${run.siteId}\u0000${run.routineId}`;
    const existing = byKey.get(key);
    const system = run.system && SYSTEMS.has(run.system) ? (run.system as SystemKind) : undefined;
    if (!existing) {
      byKey.set(key, {
        siteId: run.siteId,
        routineId: run.routineId,
        frequency: run.frequency as Frequency,
        system: system ?? routineById(run.routineId)?.system,
        firstCompletedAt: completedAt,
        lastCompletedAt: completedAt,
        completedCount: 1,
      });
      continue;
    }
    existing.completedCount += 1;
    if (!existing.firstCompletedAt || completedAt < existing.firstCompletedAt) {
      existing.firstCompletedAt = completedAt;
    }
    if (!existing.lastCompletedAt || completedAt > existing.lastCompletedAt) {
      existing.lastCompletedAt = completedAt;
    }
  }

  return { histories: [...byKey.values()], rejected };
}

// ---------------------------------------------------------------------------
// Scoring one site
// ---------------------------------------------------------------------------

interface SiteWorkings {
  site: PortfolioSite;
  histories: PortfolioRoutineHistory[];
  defects: PortfolioDefect[];
  assetCount?: number;
}

/** The routine's name as the app knows it, or a readable stand-in for one it does not. */
function routineLabel(h: PortfolioRoutineHistory): string {
  return routineById(h.routineId)?.label ?? `${FREQUENCY_LABEL[h.frequency]} routine ${h.routineId}`;
}

function systemOf(h: PortfolioRoutineHistory): SystemKind | undefined {
  return h.system ?? routineById(h.routineId)?.system;
}

/**
 * Works out a site's standing and its score.
 *
 * The two are deliberately separate. Standing answers "where is this site on
 * the schedule", which has a "nobody knows" answer; the score answers "how much
 * exposure is sitting here", which counts only what is actually known. A site
 * with no service history and one open critical defect therefore stands as
 * never-serviced and scores forty — the defect is a fact, the absent history is
 * not a failure, and neither statement contaminates the other.
 */
function scoreSite(w: SiteWorkings, today: string, nowMs: number, statementLeadDays: number): SiteRisk {
  const contributions: RiskContribution[] = [];
  const unknowns: RiskUnknown[] = [];

  // --- Servicing ----------------------------------------------------------
  const dues = w.histories.map((h) => ({ history: h, due: routineDue(h, today) }));
  const states = new Map<DueState, typeof dues>();
  for (const row of dues) {
    const list = states.get(row.due.state) ?? [];
    list.push(row);
    states.set(row.due.state, list);
  }
  const overdue = states.get('overdue') ?? [];
  const dueNow = states.get('due') ?? [];
  const upcoming = states.get('upcoming') ?? [];
  const neverDone = states.get('never-done') ?? [];
  const notScheduled = states.get('not-scheduled') ?? [];

  const anyServiceRecorded = w.histories.some((h) => h.completedCount > 0);

  let standing: SiteStanding;
  if (!anyServiceRecorded) standing = 'never-serviced';
  else if (overdue.length) standing = 'overdue';
  else if (dueNow.length) standing = 'due';
  else if (upcoming.length) standing = 'current';
  else standing = 'unschedulable';

  for (const { history, due } of overdue) {
    const base = OVERDUE_POINTS_BY_FREQUENCY[history.frequency];
    const label = routineLabel(history);
    // Days past the *end of the window*, not past the scheduled date. A yearly
    // carries two months of tolerance, and calling a service eight weeks late
    // when the standard still allows it is how a technician stops believing the
    // list.
    const daysPastWindow = due.window ? daysBetween(due.window.latest, today) : undefined;
    if (base > 0) {
      contributions.push({
        factor: 'routine-overdue',
        label: `${label} — overdue`,
        points: base,
        detail: `${FREQUENCY_LABEL[history.frequency]} routine, scheduled ${due.scheduledFor ?? 'unknown'}`
          + `${due.window ? `, window closed ${due.window.latest}` : ''}. Weighted ${base} because a lapsed `
          + `${FREQUENCY_LABEL[history.frequency].toLowerCase()} is not equivalent to a lapsed monthly.`,
        sourceIds: RISK_WEIGHTS['routine-overdue'].sourceIds,
        routineId: history.routineId,
      });
    }
    if (daysPastWindow !== undefined && daysPastWindow > 0) {
      const weight = RISK_WEIGHTS['routine-overdue-age'];
      const weeks = Math.floor(daysPastWindow / 7);
      const age = Math.min(weeks * weight.points, weight.cap ?? Number.POSITIVE_INFINITY);
      if (age > 0) {
        contributions.push({
          factor: 'routine-overdue-age',
          label: `${label} — ${daysPastWindow} days past its window`,
          points: age,
          detail: `${weeks} full week${weeks === 1 ? '' : 's'} past the end of the tolerance window, at one point `
            + `a week${weight.cap === undefined ? '' : `, capped at ${weight.cap}`}.`,
          sourceIds: weight.sourceIds,
          routineId: history.routineId,
        });
      }
    }
  }

  if (dueNow.length) {
    const weight = RISK_WEIGHTS['routine-due'];
    const raw = dueNow.length * weight.points;
    const points = Math.min(raw, weight.cap ?? Number.POSITIVE_INFINITY);
    contributions.push({
      factor: 'routine-due',
      label: `${dueNow.length} routine${dueNow.length === 1 ? '' : 's'} due now`,
      points,
      detail: `${dueNow.length} × ${weight.points}${raw > points ? `, capped at ${weight.cap}` : ''}. Inside the `
        + 'tolerance window, so nothing has breached — this is work to place, not a failure.',
      sourceIds: weight.sourceIds,
    });
  }

  if (!anyServiceRecorded) {
    unknowns.push({
      code: 'never-serviced',
      detail: STANDING_MEANING['never-serviced'],
    });
  } else if (neverDone.length) {
    unknowns.push({
      code: 'routines-never-recorded',
      detail: `${neverDone.length} routine${neverDone.length === 1 ? ' has' : 's have'} never been recorded here. `
        + 'Not counted as overdue: with no first service there is no anchor, and no anchor means no due date to '
        + 'be past.',
    });
  }
  if (notScheduled.length) {
    unknowns.push({
      code: 'no-schedule-table',
      detail: `${notScheduled.length} routine${notScheduled.length === 1 ? '' : 's'} here `
        + `${notScheduled.length === 1 ? 'has' : 'have'} no Section 6 schedule table behind the frequency, so `
        + 'nothing can be called due or overdue without inventing a tolerance.',
    });
  }
  if (w.assetCount === undefined) {
    unknowns.push({
      code: 'no-asset-register',
      detail: 'No asset register has been imported for this site, so nothing here knows how big it is or what it '
        + 'holds. The servicing figures still stand; the size of the job behind them does not.',
    });
  }

  // --- Defects ------------------------------------------------------------
  const outstanding = w.defects.filter(isOutstanding);
  const verdicts = outstanding.map((d) => ({ defect: d, verdict: qldCriticalVerdict(d) }));
  const criticals = verdicts.filter((v) => v.verdict === 'yes');
  const unanswered = verdicts.filter((v) => v.verdict === 'unanswered');
  const minor = verdicts.filter((v) => v.verdict === 'no');

  let statutoryExposure = false;

  for (const { defect } of criticals) {
    statutoryExposure = true;
    const clocks = defectClocks(defect, nowMs);
    contributions.push({
      factor: 'critical-defect',
      label: `Critical defect — ${defect.description?.trim() || defect.defectId}`,
      // The raised date is printed only where it was readable. Echoing back an
      // unreadable string as though it were a date is how "Raised 1/9/2026"
      // ends up beside a line saying the date cannot be read.
      detail: `${clocks.raisedDay ? `Raised ${clocks.raisedDay}. ` : 'Raised date unreadable. '}`
        + `Both limbs of the Queensland test answered yes. ${RISK_WEIGHTS['critical-defect'].why}`,
      points: RISK_WEIGHTS['critical-defect'].points,
      sourceIds: RISK_WEIGHTS['critical-defect'].sourceIds,
      defectId: defect.defectId,
    });

    const remaining = clocks.rectifyBy ? daysBetween(today, clocks.rectifyBy) : undefined;
    if (clocks.rectifyBy && remaining !== undefined && remaining < 0) {
      contributions.push({
        factor: 'rectification-overdue',
        label: `Rectification date passed ${Math.abs(remaining)} days ago`,
        points: RISK_WEIGHTS['rectification-overdue'].points,
        detail: `Due ${clocks.rectifyBy}, still outstanding today. ${RISK_WEIGHTS['rectification-overdue'].why}`,
        sourceIds: RISK_WEIGHTS['rectification-overdue'].sourceIds,
        defectId: defect.defectId,
      });
    } else if (clocks.rectifyUnknownBecause) {
      unknowns.push({
        code: 'defect-date-unreadable',
        detail: `Critical defect ${defect.defectId}: ${clocks.rectifyUnknownBecause} It is not assumed to be in `
          + 'time.',
      });
    }

    if (clocks.noticeOverdue) {
      contributions.push({
        factor: 'notice-overdue',
        label: 'Written critical defect notice not recorded',
        points: RISK_WEIGHTS['notice-overdue'].points,
        // The Queensland day the clock ran out on. A defect raised at seven on
        // a Brisbane morning has its 24 hours run out at 21:00 UTC, so the
        // first ten characters of that instant name the day before — on a
        // statutory clock, printed as the day somebody missed.
        detail: `The 24 hours ran out ${qldToday(clocks.noticeDueAt ?? '') ?? 'on a date this app could not read'}. `
          + `${RISK_WEIGHTS['notice-overdue'].why}`,
        sourceIds: RISK_WEIGHTS['notice-overdue'].sourceIds,
        defectId: defect.defectId,
      });
    } else if (clocks.noticeDueAt === undefined && !defect.noticeIssuedAt) {
      unknowns.push({
        code: 'defect-date-unreadable',
        detail: `Critical defect ${defect.defectId} has no written notice recorded and its raised date `
          + `("${defect.raisedAt}") is not one this app can read, so when the 24 hours ran out is unknown. It is `
          + 'not scored as a breach, and it is not treated as in hand either.',
      });
    }
  }

  for (const { defect } of unanswered) {
    contributions.push({
      factor: 'critical-defect-unclassified',
      label: `Flagged critical, limbs unanswered — ${defect.description?.trim() || defect.defectId}`,
      points: RISK_WEIGHTS['critical-defect-unclassified'].points,
      detail: RISK_WEIGHTS['critical-defect-unclassified'].why,
      sourceIds: RISK_WEIGHTS['critical-defect-unclassified'].sourceIds,
      defectId: defect.defectId,
    });
  }
  if (unanswered.length) {
    unknowns.push({
      code: 'critical-limbs-unanswered',
      detail: `${unanswered.length} defect${unanswered.length === 1 ? ' is' : 's are'} flagged critical with the `
        + 'two Queensland limbs unanswered. Until they are answered this app will not count them as critical '
        + 'defects, and will not count them as ordinary ones either.',
    });
  }

  if (minor.length) {
    const weight = RISK_WEIGHTS['non-critical-defects'];
    const raw = minor.length * weight.points;
    const points = Math.min(raw, weight.cap ?? Number.POSITIVE_INFINITY);
    contributions.push({
      factor: 'non-critical-defects',
      label: `${minor.length} open non-critical defect${minor.length === 1 ? '' : 's'}`,
      points,
      detail: `${minor.length} × ${weight.points}${raw > points ? `, capped at ${weight.cap}` : ''}. ${weight.why}`,
      sourceIds: weight.sourceIds,
    });
  }

  // --- Occupier statement -------------------------------------------------
  const statement = statementDue(w.site);
  if (statement.date) {
    const remaining = daysBetween(today, statement.date);
    if (remaining !== undefined && remaining < 0) {
      statutoryExposure = true;
      contributions.push({
        factor: 'statement-overdue',
        label: `Occupier statement ${Math.abs(remaining)} days overdue`,
        points: RISK_WEIGHTS['statement-overdue'].points,
        detail: `Due ${statement.date} (${statement.legalRef}). ${RISK_WEIGHTS['statement-overdue'].why}`,
        sourceIds: RISK_WEIGHTS['statement-overdue'].sourceIds,
      });
    } else if (remaining !== undefined && remaining <= statementLeadDays) {
      statutoryExposure = true;
    }
  } else {
    unknowns.push({
      code: 'statement-date-unknown',
      detail: 'Neither a last statement date nor an occupation date is held for this site, so when the next '
        + 'occupier statement falls due is unknown. It is not assumed to be in hand.',
    });
  }

  if (criticals.length) statutoryExposure = true;

  const score = contributions.reduce((sum, c) => sum + c.points, 0);

  return {
    siteId: w.site.siteId,
    siteName: w.site.siteName,
    clientName: w.site.clientName,
    suburb: w.site.suburb,
    postcode: w.site.postcode,
    standing,
    score,
    band: riskBand(score),
    contributions,
    unknowns,
    overdueRoutines: overdue.length,
    dueRoutines: dueNow.length,
    criticalDefectsOutstanding: criticals.length,
    defectsOutstanding: outstanding.length,
    statutoryExposure,
  };
}

/**
 * When the site's next occupier statement falls due.
 *
 * From the last statement where there is one, otherwise a year from occupation.
 * Where neither is held this returns no date at all: an occupier statement
 * whose anniversary nobody knows is not overdue and is not in hand, it is
 * unknown, and a portfolio screen that shows it as either is lying about a
 * statutory obligation.
 */
export function statementDue(site: PortfolioSite): { date?: string; legalRef: string } {
  // Both anniversaries are counted from a Queensland day. A statement signed at
  // seven on a Brisbane morning is stamped 21:00 UTC the day before, and the
  // next one then falls due a day early for the life of the building.
  if (site.lastStatementAt) {
    const day = qldToday(site.lastStatementAt);
    if (!day) return { legalRef: 'QDC MP 6.1 A2(b)' };
    const answer = nextStatementDue(day);
    return { date: answer.date, legalRef: answer.legalRef };
  }
  if (site.occupationAt) {
    const day = qldToday(site.occupationAt);
    if (!day) return { legalRef: 'QDC MP 6.1 A2(b)' };
    const answer = firstStatementDue(day);
    return { date: answer.date, legalRef: answer.legalRef };
  }
  return { legalRef: 'QDC MP 6.1 A2(b)' };
}

// ---------------------------------------------------------------------------
// The whole book
// ---------------------------------------------------------------------------

export const STATUTORY_NOTE =
  'These are legal obligations with dates attached, not a measure of how the book is going. They are counted '
  + 'here and nowhere else: none of them enters the current/due/overdue figures or any percentage, because a '
  + 'statutory clock that has run out is not offset by ninety sites being up to date.';

function emptyPortfolio(refusal: string): Portfolio {
  return {
    coverage: {
      sites: 0, judged: 0, neverServiced: 0, unschedulable: 0,
      sitesWithAssetsKnown: 0, sitesWithAssetsUnknown: 0, assetsCounted: 0,
      enoughToJudge: false,
      headline: 'Nothing can be judged.',
      caveats: [refusal],
    },
    health: {
      sites: 0, current: 0, due: 0, overdue: 0, neverServiced: 0, unschedulable: 0, judged: 0,
      denominator: 'Nothing was judged, so there is no denominator.',
    },
    statutory: {
      criticalDefectsOutstanding: 0, noticeClockRunning: 0, noticeOverdue: 0, noticeRecorded: 0,
      pastRectificationDate: 0, rectificationDateUnknown: 0, noticeDateUnknown: 0, classificationUnanswered: 0,
      statementsOverdue: 0, statementsDueSoon: 0, statementDateUnknown: 0, sitesAffected: 0,
      items: [], note: STATUTORY_NOTE, sources: portfolioSources(['bfsr-2008', 'qdc-mp61']),
    },
    concentration: {
      byClient: [], bySuburb: [], bySystem: [],
      sitesWithNoClient: 0, sitesWithNoSuburb: 0, overdueWithNoSystem: 0, caveats: [],
    },
    ranked: [],
    rankedTotal: 0,
    unjudged: [],
    unmatched: { histories: 0, defects: 0, assets: 0 },
    notes: [],
    refusals: [refusal],
    sources: portfolioSources(['safe-qld-weighting']),
  };
}

/**
 * The whole picture.
 *
 * Order matters here. Coverage is computed from the standings, the standings
 * come from the schedule rules, and the health percentages are taken over the
 * judged sites only — so a book where forty sites of 897 have a history reports
 * a coverage of 4% and says every figure below it describes those forty.
 */
export function buildPortfolio(input: PortfolioInput): Portfolio {
  const today = qldToday(input.today);
  if (!today) {
    return emptyPortfolio(
      `"${input.today}" is not a date this app can read, so nothing can be judged as due, overdue or current. `
      + 'No figure is offered rather than one counted from today by accident.',
    );
  }

  /**
   * The instant the statutory clocks are read at.
   *
   * A 24-hour deadline is an instant, not a day, so it has to be compared
   * against one. Where the caller passed a full timestamp, that is it.
   *
   * Where the caller passed only a date there is no time of day to work with,
   * and the clocks are read from the *start* of the Queensland day. That can
   * leave a breach uncounted for part of one day. The alternative, which is
   * what this compared against before, was midnight UTC — which is 10am in
   * Brisbane, so a notice falling due at 8am today was reported as missed from
   * the moment the screen opened. Telling an office it has missed a statutory
   * notice it has not yet missed is the worse of the two errors.
   */
  const nowMs = (input.today.trim().length > 10 ? isoInstantMs(input.today) : undefined)
    ?? Date.parse(`${today}T00:00:00+${String(QLD_UTC_OFFSET_HOURS).padStart(2, '0')}:00`);

  const rankLimit = input.rankLimit ?? DEFAULT_RANK_LIMIT;
  const statementLeadDays = input.statementLeadDays ?? DEFAULT_STATEMENT_LEAD_DAYS;
  const notes: string[] = [];
  const refusals: string[] = [];

  // --- Index the book, refusing to merge two sites that share an id --------
  const sites = new Map<string, PortfolioSite>();
  let duplicateSites = 0;
  for (const site of input.sites) {
    if (sites.has(site.siteId)) { duplicateSites++; continue; }
    sites.set(site.siteId, site);
  }
  if (duplicateSites) {
    notes.push(
      `${duplicateSites} site row${duplicateSites === 1 ? '' : 's'} repeated a site id already in the book and `
      + 'were ignored. The first row for each id was kept; nothing was merged, because two rows claiming one id '
      + 'is a data fault rather than two sites.',
    );
  }

  const historiesBySite = new Map<string, PortfolioRoutineHistory[]>();
  let unmatchedHistories = 0;
  for (const h of input.histories) {
    if (!sites.has(h.siteId)) { unmatchedHistories++; continue; }
    const list = historiesBySite.get(h.siteId) ?? [];
    list.push(h);
    historiesBySite.set(h.siteId, list);
  }

  const defectsBySite = new Map<string, PortfolioDefect[]>();
  let unmatchedDefects = 0;
  for (const d of input.defects) {
    if (!sites.has(d.siteId)) { unmatchedDefects++; continue; }
    const list = defectsBySite.get(d.siteId) ?? [];
    list.push(d);
    defectsBySite.set(d.siteId, list);
  }

  const assetCounts = new Map<string, number>();
  let unmatchedAssets = 0;
  let assetsCounted = 0;
  for (const a of input.assets) {
    if (!sites.has(a.siteId)) { unmatchedAssets++; continue; }
    assetCounts.set(a.siteId, (assetCounts.get(a.siteId) ?? 0) + 1);
    assetsCounted++;
  }

  const unmatchedTotal = unmatchedHistories + unmatchedDefects + unmatchedAssets;
  const unmatched = {
    histories: unmatchedHistories,
    defects: unmatchedDefects,
    assets: unmatchedAssets,
    detail: unmatchedTotal
      ? `${unmatchedTotal} row${unmatchedTotal === 1 ? '' : 's'} refer to a site that is not in the book `
        + `(${unmatchedHistories} service histor${unmatchedHistories === 1 ? 'y' : 'ies'}, ${unmatchedDefects} `
        + `defect${unmatchedDefects === 1 ? '' : 's'}, ${unmatchedAssets} asset${unmatchedAssets === 1 ? '' : 's'}). `
        + 'They are counted nowhere below. A defect against a site the app has lost is still a defect, so this '
        + 'number is worth chasing rather than dismissing.'
      : undefined,
  };
  if (unmatched.detail) notes.push(unmatched.detail);

  // --- Score every site ---------------------------------------------------
  const risks: SiteRisk[] = [];
  for (const site of sites.values()) {
    const derived = assetCounts.get(site.siteId);
    risks.push(scoreSite(
      {
        site,
        histories: historiesBySite.get(site.siteId) ?? [],
        defects: defectsBySite.get(site.siteId) ?? [],
        assetCount: site.assetCount ?? derived,
      },
      today,
      nowMs,
      statementLeadDays,
    ));
  }

  // --- Health, with never-serviced kept out of the scale -------------------
  const count = (s: SiteStanding) => risks.filter((r) => r.standing === s).length;
  const current = count('current');
  const due = count('due');
  const overdue = count('overdue');
  const neverServiced = count('never-serviced');
  const unschedulable = count('unschedulable');
  const judged = current + due + overdue;

  const health: PortfolioHealth = {
    sites: risks.length,
    current, due, overdue, neverServiced, unschedulable, judged,
    currentFractionOfJudged: judged > 0 ? current / judged : undefined,
    denominator: judged > 0
      ? `${current} of ${judged} sites with a service history this app can measure, out of ${risks.length} in the `
        + `book. ${neverServiced} have never been serviced in this app's records and ${unschedulable} carry no `
        + 'routine with a schedule table; neither is in the percentage, because neither is a failure or a pass.'
      : `None of the ${risks.length} sites in the book can be placed on the schedule, so there is no percentage `
        + 'to give. That is the finding.',
  };

  if (risks.length > 0 && judged === 0) {
    refusals.push(
      'No site in the book can be placed on the servicing schedule, so no health percentage is offered at all. '
      + 'Every site here has either never been serviced in this app or carries no routine with a schedule table '
      + 'behind it, and a figure over none of them would be a number about nothing.',
    );
  }

  // --- Coverage, stated before anything else ------------------------------
  const sitesWithAssetsKnown = [...sites.values()]
    .filter((s) => s.assetCount !== undefined || (assetCounts.get(s.siteId) ?? 0) > 0).length;
  const fraction = risks.length > 0 ? judged / risks.length : undefined;
  const percent = fraction === undefined ? undefined : Math.round(fraction * 100);

  const coverage: PortfolioCoverage = {
    sites: risks.length,
    judged,
    neverServiced,
    unschedulable,
    fraction,
    percent,
    sitesWithAssetsKnown,
    sitesWithAssetsUnknown: risks.length - sitesWithAssetsKnown,
    assetsCounted,
    enoughToJudge: fraction !== undefined && fraction >= COVERAGE_THRESHOLD,
    headline: risks.length === 0
      ? 'There are no sites in the book, so there is nothing to judge.'
      : `This app can judge ${judged} of ${risks.length} sites — ${percent}% of the book. Everything below `
        + `describes those ${judged}.`,
    caveats: [],
  };
  if (risks.length > 0 && !coverage.enoughToJudge) {
    coverage.caveats.push(
      `${risks.length - judged} of ${risks.length} sites cannot be placed on the schedule at all — more than the `
      + `${Math.round((1 - COVERAGE_THRESHOLD) * 100)}% Safe QLD treats as the point where a percentage needs a `
      + 'warning beside it. Every health figure below is over the remainder and must not be read as the book.',
    );
  }
  if (neverServiced > 0) {
    coverage.caveats.push(
      `${neverServiced} site${neverServiced === 1 ? ' has' : 's have'} no service ever recorded here. That is an `
      + 'unknown, not a failure — this app cannot tell a site nobody has serviced from a site serviced for years '
      + 'before the app existed — so they are counted separately and left out of every percentage.',
    );
  }
  if (coverage.sitesWithAssetsUnknown > 0) {
    coverage.caveats.push(
      `${coverage.sitesWithAssetsUnknown} site${coverage.sitesWithAssetsUnknown === 1 ? '' : 's'} have no asset `
      + 'register imported, so how much work sits behind their servicing figures is unknown. A site with a '
      + 'genuinely empty register looks the same from here unless the count was supplied explicitly.',
    );
  }

  // --- Statutory exposure, counted on its own -----------------------------
  const statutory = statutoryExposure(sites, defectsBySite, today, nowMs, statementLeadDays);

  // --- Ranking ------------------------------------------------------------
  const scored = risks
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      b.score - a.score
      || b.criticalDefectsOutstanding - a.criticalDefectsOutstanding
      || b.overdueRoutines - a.overdueRoutines
      || a.siteName.localeCompare(b.siteName));

  const unjudged: UnjudgedSite[] = risks
    .filter((r) => r.standing === 'never-serviced' || r.standing === 'unschedulable')
    .map((r) => ({
      siteId: r.siteId,
      siteName: r.siteName,
      clientName: r.clientName,
      suburb: r.suburb,
      reason: r.standing === 'never-serviced' ? ('never-serviced' as const) : ('unschedulable' as const),
      detail: STANDING_MEANING[r.standing],
      defectsOutstanding: r.defectsOutstanding,
      criticalDefectsOutstanding: r.criticalDefectsOutstanding,
    }))
    .sort((a, b) => b.criticalDefectsOutstanding - a.criticalDefectsOutstanding
      || b.defectsOutstanding - a.defectsOutstanding
      || a.siteName.localeCompare(b.siteName));

  notes.push(
    'A site is ranked on what is known about it. Absent history contributes nothing to a score in either '
    + 'direction, so a never-serviced site with an open critical defect ranks on the defect alone.',
  );
  if (scored.length > rankLimit) {
    notes.push(
      `${scored.length} sites scored above zero; the ${rankLimit} worst are listed. The rest are in the counts.`,
    );
  }

  return {
    today,
    coverage,
    health,
    statutory,
    concentration: concentrationOf(risks, historiesBySite, today),
    ranked: scored.slice(0, rankLimit),
    rankedTotal: scored.length,
    unjudged,
    unmatched,
    notes,
    refusals,
    sources: portfolioSources([
      'as1851-section-6', 'bfsr-2008', 'qdc-mp61', 'auspost-localities', 'safe-qld-weighting',
    ]),
  };
}

/**
 * The statutory clocks, counted apart from everything else.
 *
 * Deliberately built from the defects rather than from the risk scores: these
 * counts have to be right whatever the weighting does, and a legal obligation
 * must not move because somebody re-tuned a score.
 */
function statutoryExposure(
  sites: Map<string, PortfolioSite>,
  defectsBySite: Map<string, PortfolioDefect[]>,
  today: string,
  nowMs: number,
  statementLeadDays: number,
): StatutoryExposure {
  const items: StatutoryItem[] = [];
  const affected = new Set<string>();
  let criticalDefectsOutstanding = 0;
  let noticeClockRunning = 0;
  let noticeOverdue = 0;
  let noticeRecorded = 0;
  let pastRectificationDate = 0;
  let rectificationDateUnknown = 0;
  let noticeDateUnknown = 0;
  let classificationUnanswered = 0;
  let statementsOverdue = 0;
  let statementsDueSoon = 0;
  let statementDateUnknown = 0;

  for (const [siteId, site] of sites) {
    for (const defect of defectsBySite.get(siteId) ?? []) {
      if (!isOutstanding(defect)) continue;
      const verdict = qldCriticalVerdict(defect);

      if (verdict === 'unanswered') {
        classificationUnanswered++;
        // Deliberately not added to `affected`. That count is sites with a
        // statutory clock established as running, and the whole point of this
        // verdict is that nobody has established whether one is. It has its own
        // counter and its own row; inflating a legal figure with maybes is the
        // same fault as dropping it.
        items.push({
          kind: 'classification-unanswered',
          siteId,
          siteName: site.siteName,
          defectId: defect.defectId,
          detail: `${defect.description?.trim() || defect.defectId} is flagged critical with the two Queensland `
            + 'limbs unanswered. Until somebody answers them, whether a notice is owed is unknown — so it is not '
            + 'counted as a critical defect here, and not counted as a minor one either.',
          legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 53, definition of critical defect',
          sourceIds: ['bfsr-2008'],
        });
        continue;
      }
      if (verdict !== 'yes') continue;

      criticalDefectsOutstanding++;
      affected.add(siteId);

      // The 24 hours runs from the maintenance; the app holds when the defect
      // was raised, which is the nearest thing it has, and every item says so.
      const clocks = defectClocks(defect, nowMs);
      if (defect.noticeIssuedAt) {
        noticeRecorded++;
      } else if (clocks.noticeOverdue && clocks.noticeDueAt) {
        noticeOverdue++;
        items.push({
          kind: 'notice-overdue',
          siteId,
          siteName: site.siteName,
          defectId: defect.defectId,
          dueAt: clocks.noticeDueAt,
          daysRemaining: daysBetween(today, clocks.noticeDueAt.slice(0, 10)),
          detail: 'No written critical defect notice is recorded and the 24 hours has run. Counted from when the '
            + 'defect was raised, which is the closest date this app holds to when the maintenance was carried out.',
          legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 53(2)',
          sourceIds: ['bfsr-2008'],
        });
      } else if (clocks.noticeDueAt) {
        noticeClockRunning++;
        items.push({
          kind: 'notice-running',
          siteId,
          siteName: site.siteName,
          defectId: defect.defectId,
          dueAt: clocks.noticeDueAt,
          daysRemaining: daysBetween(today, clocks.noticeDueAt.slice(0, 10)),
          detail: 'The written critical defect notice is not recorded yet and the 24 hours is still running.',
          legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 53(2)',
          sourceIds: ['bfsr-2008'],
        });
      } else {
        // The raised date is not readable, so there is no deadline to count to.
        // Reported under the rectification-unknown row below rather than being
        // guessed at in either direction.
        noticeDateUnknown++;
      }

      const remaining = clocks.rectifyBy ? daysBetween(today, clocks.rectifyBy) : undefined;
      if (remaining === undefined) {
        rectificationDateUnknown++;
        items.push({
          kind: 'rectification-date-unknown',
          siteId,
          siteName: site.siteName,
          defectId: defect.defectId,
          detail: `${clocks.rectifyUnknownBecause ?? 'The rectification date cannot be worked out.'} It is `
            + 'reported as unknown rather than assumed to be in time.'
            + (clocks.noticeDueAt === undefined && !defect.noticeIssuedAt
              ? ' The 24-hour notice deadline cannot be counted from that date either.'
              : ''),
          legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 54(4)',
          sourceIds: ['bfsr-2008'],
        });
      } else if (remaining < 0) {
        pastRectificationDate++;
        items.push({
          kind: 'rectification-overdue',
          siteId,
          siteName: site.siteName,
          defectId: defect.defectId,
          dueAt: clocks.rectifyBy,
          daysRemaining: remaining,
          detail: `${Math.abs(remaining)} days past the date the repair had to be carried out by, and still `
            + 'outstanding.',
          legalRef: 'Building Fire Safety Regulation 2008 (Qld) s 54(4)',
          sourceIds: ['bfsr-2008'],
        });
      }
    }

    const statement = statementDue(site);
    if (!statement.date) {
      statementDateUnknown++;
      items.push({
        kind: 'statement-date-unknown',
        siteId,
        siteName: site.siteName,
        detail: 'No last statement date and no occupation date, so when the occupier statement falls due is '
          + 'unknown. Not counted as due and not counted as in hand.',
        legalRef: statement.legalRef,
        sourceIds: ['qdc-mp61'],
      });
      continue;
    }
    const remaining = daysBetween(today, statement.date);
    if (remaining === undefined) continue;
    if (remaining < 0) {
      statementsOverdue++;
      affected.add(siteId);
      items.push({
        kind: 'statement-overdue',
        siteId,
        siteName: site.siteName,
        dueAt: statement.date,
        daysRemaining: remaining,
        detail: `${Math.abs(remaining)} days past the yearly statement date.`,
        legalRef: statement.legalRef,
        sourceIds: ['qdc-mp61'],
      });
    } else if (remaining <= statementLeadDays) {
      statementsDueSoon++;
      affected.add(siteId);
      items.push({
        kind: 'statement-due-soon',
        siteId,
        siteName: site.siteName,
        dueAt: statement.date,
        daysRemaining: remaining,
        detail: `Due in ${remaining} day${remaining === 1 ? '' : 's'}.`,
        legalRef: statement.legalRef,
        sourceIds: ['qdc-mp61'],
      });
    }
  }

  const ORDER: Record<StatutoryKind, number> = {
    'notice-overdue': 0,
    'rectification-overdue': 1,
    'notice-running': 2,
    'rectification-date-unknown': 3,
    'notice-date-unknown': 4,
    'classification-unanswered': 5,
    'statement-overdue': 6,
    'statement-due-soon': 7,
    'statement-date-unknown': 8,
  };
  items.sort((a, b) =>
    ORDER[a.kind] - ORDER[b.kind]
    || (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0)
    || a.siteName.localeCompare(b.siteName));

  return {
    criticalDefectsOutstanding,
    noticeClockRunning,
    noticeOverdue,
    noticeRecorded,
    pastRectificationDate,
    rectificationDateUnknown,
    noticeDateUnknown,
    classificationUnanswered,
    statementsOverdue,
    statementsDueSoon,
    statementDateUnknown,
    sitesAffected: affected.size,
    items,
    note: STATUTORY_NOTE,
    sources: portfolioSources(['bfsr-2008', 'qdc-mp61']),
  };
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

interface Bucket {
  label: string;
  siteIds: Set<string>;
  overdueRoutines: number;
  criticalDefectsOutstanding: number;
  riskScore: number;
  unjudgedSites: number;
  postcodes: Set<string>;
}

function bucketOf(map: Map<string, Bucket>, key: string, label: string): Bucket {
  const existing = map.get(key);
  if (existing) return existing;
  const made: Bucket = {
    label,
    siteIds: new Set(),
    overdueRoutines: 0,
    criticalDefectsOutstanding: 0,
    riskScore: 0,
    unjudgedSites: 0,
    postcodes: new Set(),
  };
  map.set(key, made);
  return made;
}

function rowsOf(map: Map<string, Bucket>, totalOverdue: number): ConcentrationRow[] {
  return [...map.entries()]
    .map(([key, b]) => ({
      key,
      label: b.label,
      sites: b.siteIds.size,
      overdueRoutines: b.overdueRoutines,
      criticalDefectsOutstanding: b.criticalDefectsOutstanding,
      riskScore: b.riskScore,
      shareOfOverdue: totalOverdue > 0 ? b.overdueRoutines / totalOverdue : undefined,
      unjudgedSites: b.unjudgedSites,
      postcodes: b.postcodes.size > 1 ? [...b.postcodes].sort() : undefined,
    }))
    .sort((a, b) =>
      b.overdueRoutines - a.overdueRoutines
      || b.criticalDefectsOutstanding - a.criticalDefectsOutstanding
      || b.riskScore - a.riskScore
      || a.label.localeCompare(b.label));
}

/**
 * Which clients, suburbs and systems carry the overdue work.
 *
 * A list of 300 overdue routines is not a decision; "two thirds of them are one
 * client, and half of those are in one suburb" is. Sites with no client or no
 * suburb recorded are counted, never bucketed under a made-up "Unknown" heading
 * — a bucket that large would top the table and send somebody to look for it.
 */
function concentrationOf(
  risks: SiteRisk[],
  historiesBySite: Map<string, PortfolioRoutineHistory[]>,
  today: string,
): PortfolioConcentration {
  const byClient = new Map<string, Bucket>();
  const bySuburb = new Map<string, Bucket>();
  const bySystem = new Map<string, Bucket>();
  const caveats: string[] = [];

  let sitesWithNoClient = 0;
  let sitesWithNoSuburb = 0;
  let overdueWithNoSystem = 0;
  const totalOverdue = risks.reduce((n, r) => n + r.overdueRoutines, 0);

  for (const risk of risks) {
    const unjudged = risk.standing === 'never-serviced' || risk.standing === 'unschedulable' ? 1 : 0;

    const clientKey = groupKey(risk.clientName);
    if (!clientKey) sitesWithNoClient++;
    else {
      const b = bucketOf(byClient, clientKey, risk.clientName!.trim().replace(/\s+/g, ' '));
      b.siteIds.add(risk.siteId);
      b.overdueRoutines += risk.overdueRoutines;
      b.criticalDefectsOutstanding += risk.criticalDefectsOutstanding;
      b.riskScore += risk.score;
      b.unjudgedSites += unjudged;
    }

    const suburbKey = groupKey(risk.suburb);
    if (!suburbKey) sitesWithNoSuburb++;
    else {
      const b = bucketOf(bySuburb, suburbKey, titleCase(suburbKey));
      // Queensland reuses suburb names across postcodes. The row is keyed on
      // the name because that is how the work is handed out, but the postcodes
      // behind it are kept so a row covering two places says so.
      const postcode = normalisePostcode(risk.postcode);
      if (postcode) b.postcodes.add(postcode);
      b.siteIds.add(risk.siteId);
      b.overdueRoutines += risk.overdueRoutines;
      b.criticalDefectsOutstanding += risk.criticalDefectsOutstanding;
      b.riskScore += risk.score;
      b.unjudgedSites += unjudged;
    }
  }

  // Systems are counted per overdue routine rather than per site: one site can
  // be overdue on detection and current on extinguishers, and rolling that up
  // to the site would put the whole site against both.
  for (const risk of risks) {
    if (!risk.overdueRoutines) continue;
    for (const history of historiesBySite.get(risk.siteId) ?? []) {
      if (routineDue(history, today).state !== 'overdue') continue;
      const system = systemOf(history);
      if (!system) { overdueWithNoSystem++; continue; }
      const b = bucketOf(bySystem, system, SYSTEM_LABELS[system]);
      b.siteIds.add(risk.siteId);
      b.overdueRoutines += 1;
      // The points this routine actually put into its site's score, taken from
      // the contributions rather than recomputed from the weight table. A
      // second piece of arithmetic here is a second answer, and the whole
      // module rests on the score being the sum of what is printed under it.
      b.riskScore += risk.contributions
        .filter((c) => c.routineId === history.routineId
          && (c.factor === 'routine-overdue' || c.factor === 'routine-overdue-age'))
        .reduce((sum, c) => sum + c.points, 0);
    }
  }

  if (sitesWithNoClient) {
    caveats.push(
      `${sitesWithNoClient} site${sitesWithNoClient === 1 ? ' has' : 's have'} no client recorded and appear in `
      + 'no client row. The client table therefore does not add up to the book.',
    );
  }
  if (sitesWithNoSuburb) {
    caveats.push(
      `${sitesWithNoSuburb} site${sitesWithNoSuburb === 1 ? ' has' : 's have'} no suburb recorded and appear in `
      + 'no suburb row.',
    );
  }
  if (overdueWithNoSystem) {
    caveats.push(
      `${overdueWithNoSystem} overdue routine${overdueWithNoSystem === 1 ? '' : 's'} could not be tied to a `
      + 'system, because the routine is not one this app holds.',
    );
  }

  const suburbRows = rowsOf(bySuburb, totalOverdue);
  const ambiguous = suburbRows.filter((r) => r.postcodes && r.postcodes.length > 1);
  if (ambiguous.length) {
    const eg = SUBURB_NAME_COLLISION;
    caveats.push(
      `${ambiguous.length} suburb name${ambiguous.length === 1 ? '' : 's'} cover more than one postcode `
      + `(${ambiguous.map((r) => r.label).join(', ')}). Queensland reuses names — ${eg.name} is `
      + `${eg.postcodes[0]} in ${eg.places[0]} and ${eg.postcodes[1]} in ${eg.places[1]} — so read those rows as `
      + 'a name, not a place.',
    );
  }

  return {
    byClient: rowsOf(byClient, totalOverdue),
    bySuburb: suburbRows,
    bySystem: rowsOf(bySystem, totalOverdue),
    sitesWithNoClient,
    sitesWithNoSuburb,
    overdueWithNoSystem,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// Reading a score back
// ---------------------------------------------------------------------------

/**
 * Proves a score is the sum of the reasons given for it.
 *
 * Exported rather than kept in the tests because it is the guarantee the screen
 * makes to a technician: the breakdown you are reading is the whole score. If
 * this ever returns false the number is not defensible and should not be shown.
 */
export function scoreAddsUp(risk: SiteRisk): boolean {
  return risk.contributions.reduce((sum, c) => sum + c.points, 0) === risk.score;
}

/** The site's score written out as lines, worst contribution first. */
export function explainScore(risk: SiteRisk): string[] {
  return [...risk.contributions]
    .sort((a, b) => b.points - a.points)
    .map((c) => `${c.points} — ${c.label}. ${c.detail}`);
}

/** Whole percent, or nothing where the fraction itself is unknown. */
export function percentOf(fraction: number | undefined): number | undefined {
  return fraction === undefined ? undefined : Math.round(fraction * 100);
}
