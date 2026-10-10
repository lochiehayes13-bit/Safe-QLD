import { maintenanceTestFromAxes, type MaintenanceTest, type SystemType, type TestInterval } from '@/domain/form72';
import type { Site } from '@/domain/types';

/**
 * A Form 72 started from a job.
 *
 * A technician standing at a booster has the job open on their phone. The job
 * already knows the site, the address, the customer, the day it was scheduled
 * and often what kind of service it is. Typing all of that again into a Form 72
 * is the slowest part of filling one in and the likeliest place for the site
 * name on a statutory document to come out different from the site name on the
 * job it was done under.
 *
 * So this maps a job row onto the fields of a new form. What it will not do is
 * guess. A Form 72 is signed, and a field filled from a plausible inference
 * reads exactly like a field somebody checked:
 *
 *  - The contractor is us, from the app's own preferences. It is never the
 *    job's customer, who is who the work was done *for*.
 *  - The system descriptor stays blank. A job title is "Annual hydrant
 *    service" or an order number; the descriptor is "Towns Main System", and
 *    it is the one thing that tells two forms for the same site apart. A wrong
 *    one is worse than none.
 *  - The licensee is whoever signs, from preferences. The job's rostered
 *    technician goes on the attachment page as the person who did the work,
 *    which is a different claim and the one the job row actually supports.
 *  - The maintenance test grid is ticked only on an unambiguous match in the
 *    job's own type or title, and every tick says what it was read from, so
 *    the technician can see the inference rather than discover it on the page.
 */

/** The job fields this reads. A subset of JobSummary, so a partial row will do. */
export interface JobForForm {
  externalId?: string;
  siteId?: string;
  siteName: string;
  title: string;
  address?: string;
  customerName?: string;
  jobType?: string;
  jobTypeRaw?: string;
  technician?: string;
  status: 'scheduled' | 'in-progress' | 'complete' | 'blocked';
  /**
   * When the job was raised in Simpro — its issue date, not its schedule.
   *
   * Named for what it holds, because it was not: the mirror fills this from
   * `job.issuedAt` (src/db/mirrorRepo.ts), the job list sorts and groups by it,
   * and a field called `scheduledFor` invited exactly the mistake that was
   * here — a Form 72 dated the day the job was raised rather than the day the
   * test was done. Simpro's job payload carries no schedule; the bookings live
   * in their own resource.
   */
  issuedOn?: string;
  completedDate?: string;
  completedAt?: string;
}

/** The app's own details, which the job cannot supply. */
export interface OwnDetails {
  companyName: string;
  technicianName: string;
  technicianLicence: string;
}

export interface Form72FromJob {
  jobExternalId?: string;
  jobTitle?: string;
  siteId?: string;
  siteName: string;
  siteAddress?: string;
  contractor: string;
  licenseeName: string;
  licenceNumber: string;
  /** The person who did the work, for the attachment page. */
  technician?: string;
  testDate?: string;
  maintenanceTest?: MaintenanceTest;
  /** What was filled and where each value came from, one line each. */
  filled: string[];
  /** What this job could not supply, and what the technician has to answer. */
  notFilled: string[];
}

/**
 * The day the test was done, as well as the job can say it.
 *
 * A completed job knows: the office's completion date is the day the work
 * happened. An open job does not, and the honest default is today — the
 * technician is filling the form because they are doing the test now.
 *
 * The one guess deliberately not made is the scheduled date of a job that has
 * not happened yet. A job booked for Friday, opened on Wednesday, would stamp
 * Friday on a statutory record of a test nobody has done, and the date on this
 * form is what the occupier's ten-day deadline and the five-year retention are
 * both counted from.
 */
export function testDateFromJob(job: JobForForm, today: string): string {
  const day = (v: string | undefined): string | undefined => v?.slice(0, 10) || undefined;
  /*
   * A completed job was done on the day it says it was done. Anything else is
   * being filled in now, so the test date is today.
   *
   * There used to be a middle branch taking the job's `scheduledFor` where
   * that was not in the future — and `scheduledFor` is the job's ISSUE date,
   * filled from Simpro's `issuedAt`. So a job raised in August and tested in
   * October produced a Form 72 dated August: the day somebody in the office
   * typed the job up. On a document whose ten-business-day notice to the
   * occupier and five-year retention both run from the test date, and which a
   * licensee signs. The screen compounded it by reporting the source as "the
   * day the job was scheduled", which the field has never held.
   *
   * There is a real schedule in the bookings resource, and reading it would
   * mean an async lookup this function cannot do and should not: a test is
   * dated by when it happened, and only the person doing it knows that. Today,
   * which the technician can see and change, is the honest default.
   */
  if (job.status === 'complete') {
    const done = day(job.completedDate) ?? day(job.completedAt);
    if (done) return done;
  }
  return today;
}

/** Why that date, in one line, so the screen can say it rather than imply it. */
export function testDateSource(job: JobForForm, today: string): string {
  const chosen = testDateFromJob(job, today);
  if (job.status === 'complete' && chosen !== today) return 'the job’s completion date';
  return 'today — change it if the test was done on another day';
}

/*
 * Reading the maintenance test out of a job's own words.
 *
 * Deliberately narrow. The office names its service jobs for the service, and
 * "Annual Fire Hydrant Service" says exactly which two boxes Part A wants. But
 * "Fire Service Maintenance" says neither, and a grid ticked from that would be
 * a statutory claim about which standard's test was carried out, made by a
 * substring match.
 *
 * So each axis is read separately, each needs an unambiguous hit, and a text
 * that hits two values on one axis — "hydrant and sprinkler" — is treated as
 * no hit on that axis rather than as both. Both axes must land before anything
 * is ticked, because half a grid is not an answer Part A has a box for.
 */
const SYSTEM_WORDS: { type: SystemType; any: RegExp }[] = [
  { type: 'combined', any: /\bcombined\b/i },
  { type: 'hydrant', any: /\bhydrants?\b/i },
  { type: 'sprinkler', any: /\bsprinklers?\b/i },
];

const INTERVAL_WORDS: { interval: TestInterval; any: RegExp }[] = [
  { interval: 'fiveYear', any: /\b(5|five)[\s-]*year(ly)?\b/i },
  { interval: 'annual', any: /\bannual(ly)?\b|\byearly\b|\b12[\s-]*month(ly)?\b/i },
];

export interface MaintenanceGuess {
  maintenanceTest?: MaintenanceTest;
  /** The words it was read from, for the line the screen shows. */
  evidence?: string;
}

export function maintenanceTestFromJobWords(text: string): MaintenanceGuess {
  if (!text.trim()) return {};

  const systems = SYSTEM_WORDS.filter((w) => w.any.test(text));
  const intervals = INTERVAL_WORDS.filter((w) => w.any.test(text));

  // A combined system names both the hydrant and the sprinkler by definition,
  // so "combined" winning alongside them is one answer, not three.
  const system = systems.some((s) => s.type === 'combined')
    ? SYSTEM_WORDS.find((s) => s.type === 'combined')
    : systems.length === 1 ? systems[0] : undefined;

  // Five-yearly work includes the annual tests, so a title naming both is a
  // five-yearly. Anything else ambiguous is left alone.
  const interval = intervals.some((i) => i.interval === 'fiveYear')
    ? INTERVAL_WORDS.find((i) => i.interval === 'fiveYear')
    : intervals.length === 1 ? intervals[0] : undefined;

  if (!system || !interval) return {};

  return {
    maintenanceTest: maintenanceTestFromAxes([system.type], [interval.interval]),
    evidence: text.trim(),
  };
}

/**
 * The whole mapping.
 *
 * `site` is the local site record where the job's siteId resolved to one. It is
 * preferred for the address because it holds the suburb, the state and the
 * postcode as separate fields, and a Form 72 printed with the street alone has
 * left the suburb off a statutory document. The job's own address is the
 * fallback, which is better than nothing and is what the office posted.
 */
export function form72FromJob(
  job: JobForForm,
  own: OwnDetails,
  today: string,
  site?: Site | null,
): Form72FromJob {
  const filled: string[] = [];
  const notFilled: string[] = [];

  /*
   * Which source actually supplied each value, not which record happened to
   * exist.
   *
   * Both of these branched on `site` being present, which is a different
   * question and got both of them wrong. A site record with every address
   * field blank produced no address at all and never tried the job's, because
   * the fallback was reached only when there was no site record. And the site
   * name line said "from the job" whichever source it came from, so the one
   * thing these lines exist for — letting a technician see where a prefilled
   * value came from before consenting to it — was false half the time.
   */
  const fromSite = site
    ? [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ') || undefined
    : undefined;
  const fromJob = job.address?.trim() || undefined;
  const siteAddress = fromSite ?? fromJob;

  if (siteAddress) {
    filled.push(fromSite
      ? `Site address from the site record — ${siteAddress}`
      : `Site address from the job — ${siteAddress}`);
  } else {
    notFilled.push('Site address. Neither the job nor the site record holds one.');
  }

  const nameFromSite = site?.name?.trim() || undefined;
  const nameFromJob = job.siteName.trim() || undefined;
  const siteName = nameFromSite ?? nameFromJob ?? '';
  if (siteName) {
    filled.push(nameFromSite
      ? `Site name from the site record — ${siteName}`
      : `Site name from the job — ${siteName}`);
  } else {
    notFilled.push('Site name. Neither the job nor the site record names a site.');
  }

  const testDate = testDateFromJob(job, today);
  filled.push(`Test date ${testDate}, from ${testDateSource(job, today)}`);

  // The job's type and title, read together: the office puts the service in
  // one or the other and which one varies by how the job was raised.
  const guess = maintenanceTestFromJobWords(
    [job.jobTypeRaw, job.jobType, job.title].filter(Boolean).join(' · '),
  );
  if (guess.maintenanceTest) filled.push(`Maintenance test read from "${guess.evidence}"`);
  else notFilled.push('Which maintenance test this is. The job does not say unambiguously.');

  filled.push(`Contractor from your settings — ${own.companyName}`);
  if (own.technicianName) filled.push(`Licensee from your settings — ${own.technicianName}`);
  else notFilled.push('Licensee name. Set yours in Settings so it fills itself in.');
  if (!own.technicianLicence) {
    notFilled.push('Licence number. The form is not valid without it — set yours in Settings.');
  }

  /*
   * One name is an answer. A list of names is a roster.
   *
   * `job.technician` is every person booked on the job, joined with commas by
   * the mirror. The attachment page's field is "Technician who carried out the
   * work", singular and deliberately so — the licensee signs Part I, and the
   * person who climbed the roof is often somebody else, which is the only
   * reason the field exists. Filling it with everyone booked answered a
   * different question and defeated the field's purpose: two booked and one
   * attending prints as two who did the work.
   *
   * So a single booked name goes on, and several are reported rather than
   * merged. Split on the separator the mirror actually writes, not on whether
   * the string contains a comma — a name with a comma in it is not two people.
   */
  const booked = (job.technician ?? '').split(/\s*,\s*/).map((n) => n.trim()).filter(Boolean);
  if (booked.length === 1) {
    filled.push(`Technician on the attachment from the job — ${booked[0]}`);
  } else if (booked.length > 1) {
    notFilled.push(
      `Who carried out the work. The job books ${booked.length} people (${booked.join(', ')}), `
      + 'and the attachment asks for whoever did it.',
    );
  }

  notFilled.push(
    'The system descriptor. A job title is not one, and it is what tells two forms '
    + 'for this site apart — type it in Part A.',
  );

  return {
    jobExternalId: job.externalId,
    jobTitle: job.title,
    siteId: job.siteId,
    siteName,
    siteAddress,
    contractor: own.companyName,
    licenseeName: own.technicianName,
    licenceNumber: own.technicianLicence,
    technician: booked.length === 1 ? booked[0] : undefined,
    testDate,
    maintenanceTest: guess.maintenanceTest,
    filled,
    notFilled,
  };
}

/**
 * Which jobs to put in front of somebody raising a Form 72.
 *
 * The one they want is nearly always today's, and the one after that is the one
 * they finished yesterday and are writing up now. So: today first, then the
 * recent past, then the rest — and a job scheduled for next month last, because
 * a Form 72 raised against it would be a record of a test nobody has done.
 *
 * Jobs with no Simpro id still appear. A form against a local-only job is still
 * a form, and the alternative is a technician who cannot find their work.
 */
export function rankJobsForNewForm<T extends JobForForm>(jobs: readonly T[], today: string): T[] {
  const day = (j: T): string => j.issuedOn?.slice(0, 10) ?? '';
  const bucket = (j: T): number => {
    const d = day(j);
    if (d === today) return 0;
    if (d && d < today) return 1;
    if (!d) return 2;
    return 3;
  };
  return [...jobs].sort((a, b) => {
    const byBucket = bucket(a) - bucket(b);
    if (byBucket) return byBucket;
    // Inside a bucket, nearest to today first.
    const da = day(a);
    const db = day(b);
    if (da && db && da !== db) return bucket(a) === 1 ? db.localeCompare(da) : da.localeCompare(db);
    return a.siteName.localeCompare(b.siteName);
  });
}

/** Which of those jobs look like water-based fire work, for the shortlist. */
export function looksLikeHydrantWork(job: JobForForm): boolean {
  const text = [job.jobTypeRaw, job.jobType, job.title].filter(Boolean).join(' ');
  /*
   * A leading \b on every alternative, not on the ends of the expression.
   *
   * Alternation binds looser than anything else in a regex, so
   * /\bhydrant|sprinkler|.../ anchored only "hydrant" at its start and only
   * the last alternative at its end — the middle ones matched anywhere inside
   * a word. The stems stay deliberately open at the trailing edge so
   * "hydrants", "sprinklers" and "boostered" still match, which is the point
   * of matching on job titles at all.
   */
  return /\b(?:hydrant|sprinkler|booster|fire\s*main|combined)/i.test(text);
}
