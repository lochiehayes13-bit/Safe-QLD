import { matchTemplates, preselectedTemplates, type MatchContext, type TemplateMatch } from './swmsMatch';
import { swmsTitleFor, type SwmsTemplate, type SwmsWorker } from './swms';

/**
 * Building today's statement: the job, the works, the statements.
 *
 * The screen is app/swms/new.tsx and holds none of this. Everything a person
 * could disagree with — which statements the words produced, what the record
 * is called, what carries across from the job — is here, where a test can
 * reach it. Jest only sees `.ts`, so a decision left in the screen is a
 * decision nobody checks.
 *
 * The order is the order a technician thinks in. Which job, because that is
 * the one fact they always know. Then what the work actually is, which the
 * office's own job description usually already says. Then the statements,
 * which follow from the work rather than from a list somebody scrolls.
 */

/** As much of a Simpro job as the builder needs. Deliberately not the database's type. */
export interface BuilderJob {
  externalId: string;
  /** The site as the office spells it. */
  siteName?: string;
  /** The local site row, where one matched. Absent is ordinary, not an error. */
  siteId?: string;
  customerName?: string;
  title?: string;
  /** The office's own description of the work, HTML already stripped. */
  descriptionText?: string;
}

/**
 * What to put in the "what sort of works" box before anybody types.
 *
 * The office has usually already written it. A technician confirming a line
 * that is nearly right is a different act from a technician facing an empty
 * box at seven in the morning, and it is the difference between this being
 * used and not.
 *
 * The job title and the description are both carried when they say different
 * things, because a title of "Detection annual" and a description of "replace
 * three heads in the loading dock, core the slab for the new riser" are two
 * useful halves of the same day.
 */
export function worksFromJob(job: BuilderJob | null): string {
  if (!job) return '';
  const title = job.title?.trim() ?? '';
  const description = job.descriptionText?.trim() ?? '';
  if (!description) return title;
  if (!title) return description;
  // A description that already contains the title says it once.
  if (description.toLowerCase().includes(title.toLowerCase())) return description;
  return `${title}. ${description}`;
}

export interface BuilderContext {
  job: BuilderJob | null;
  /** What the technician typed, or what came off the job. */
  works: string;
  /** Asset systems on the site's register, where the site is known. */
  systems?: readonly string[];
  /** Routines due at the site today. */
  routineIds?: readonly string[];
}

/**
 * The statements this work needs, and which of them start ticked.
 *
 * The job's own title and description are matched alongside what the
 * technician typed, so a box they never touched still produces the right
 * answer — which is the difference between the builder working for the
 * person in a hurry and only for the person being careful.
 */
export function matchesFor(
  templates: readonly SwmsTemplate[],
  context: BuilderContext,
): TemplateMatch[] {
  const fromJob = [context.job?.title, context.job?.descriptionText].filter(Boolean).join(' ');
  const text = [context.works, fromJob].filter((s) => s && s.trim()).join(' ');
  const match: MatchContext = {
    text,
    systems: context.systems,
    routineIds: context.routineIds,
  };
  return matchTemplates(templates, match);
}

/**
 * What the screen should say above the checkboxes.
 *
 * Three situations and three different sentences, because "nothing matched"
 * and "we matched four" are not the same problem and the second is not a
 * problem at all.
 */
export function matchSummary(matches: readonly TemplateMatch[], works: string): string {
  const ticked = matches.filter((m) => m.verdict === 'preselect').length;
  if (!works.trim()) {
    return 'Say what the work is and the statements it needs come up below.';
  }
  if (!matches.length) {
    return 'Nothing in the library matches that. Every statement is listed below — pick the ones that cover it.';
  }
  if (!ticked) {
    return `${matches.length} statement${matches.length === 1 ? '' : 's'} might cover this. None of them is a `
      + 'clear match, so none is ticked — read them and choose.';
  }
  const offered = matches.length - ticked;
  return `${ticked} statement${ticked === 1 ? '' : 's'} ticked for this work`
    + (offered ? `, and ${offered} more worth a look.` : '.')
    + ' Take off anything that does not apply.';
}

export interface BuilderDraft {
  templateIds: string[];
  date: string;
  title: string;
  siteId?: string;
  siteName?: string;
  jobExternalId?: string;
  jobTitle?: string;
  workers: SwmsWorker[];
  notes: string;
}

/**
 * The record to create, from everything the builder collected.
 *
 * `notes` is where the description of the works goes. That column already
 * existed, was already carried forward, and already printed on the PDF — and
 * nothing had ever written to it. It is exactly the field the owner asked for
 * and it was sitting there empty.
 */
export function builderDraft(input: {
  job: BuilderJob | null;
  works: string;
  templateIds: readonly string[];
  templates: readonly SwmsTemplate[];
  date: string;
  technicianName?: string;
  technicianLicence?: string;
}): BuilderDraft {
  const chosen = input.templates.filter((t) => input.templateIds.includes(t.id));
  const name = input.technicianName?.trim() ?? '';

  return {
    templateIds: chosen.map((t) => t.id),
    date: input.date,
    title: builderTitle(input.job, chosen),
    siteId: input.job?.siteId,
    // The site comes off the job rather than being asked for again. A statement
    // with no site on it cannot be signed, and the job always knows.
    siteName: input.job?.siteName?.trim() || undefined,
    jobExternalId: input.job?.externalId,
    jobTitle: input.job?.title?.trim() || undefined,
    // The person building it is on the crew. They can take themselves off, but
    // starting with an empty crew list is a step nobody would ever want.
    workers: name ? [{ name, licence: input.technicianLicence?.trim() || undefined }] : [],
    notes: input.works.trim(),
  };
}

/**
 * What the statement is called in a list six weeks later.
 *
 * The job number first where there is one: it is what somebody searching for
 * this will have in their hand. Then the statements, which is what
 * `swmsTitleFor` already words.
 */
export function builderTitle(job: BuilderJob | null, templates: readonly SwmsTemplate[]): string {
  const work = swmsTitleFor(templates);
  const number = job?.externalId?.trim();
  return number ? `Job ${number} — ${work}` : work;
}

/**
 * Why this cannot be started yet, or null.
 *
 * Deliberately short. The builder's job is to get a crew to a statement, not
 * to collect a form — everything else the record needs is asked for on the
 * record itself, where there is room to explain it.
 */
export function builderNotReady(input: { job: BuilderJob | null; templateIds: readonly string[] }): string | null {
  if (!input.job) return 'Pick the job this is for.';
  if (!input.templateIds.length) return 'Tick at least one statement. Nothing below covers the work? Say more about it above.';
  return null;
}

/** The ids ticked for the crew, for the screen's initial state. */
export function initialSelection(matches: readonly TemplateMatch[]): string[] {
  return preselectedTemplates(matches);
}
