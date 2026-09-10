/**
 * Safe work method statements, and the job safety analysis a crew signs on the day.
 *
 * A SWMS is not paperwork the way a certificate is paperwork. Under the Work
 * Health and Safety Regulation 2011 (Qld) a safe work method statement must
 * exist *before* high-risk construction work starts, must be on site while it
 * is going on, and must be reviewed when the work changes. A folder of PDFs on
 * a laptop in the ute satisfies none of that, which is the state most fire
 * companies are actually in: the document exists, the crew has not read it, and
 * nobody can produce the signed copy when the principal contractor asks.
 *
 * So this holds the method statements as structured work — steps, the hazards
 * in each step, the controls in hierarchy order, and the risk that is left
 * after those controls — and the thing a technician fills in is the day's
 * analysis built from them. That ordering matters:
 *
 * - The library is the company's method. It changes rarely and deliberately.
 * - The record is one crew, one site, one day. It carries the site's own
 *   answers, anything the crew added on arrival, and their signatures.
 *
 * Three rules are enforced here rather than left to good intentions.
 *
 * **Signatures do not carry forward.** Yesterday's analysis can be copied — the
 * same crew doing the same work at the same site should not retype it — but
 * every signature is cleared, because a signature is a statement that this
 * person read this document today. Carrying one forward would forge it.
 *
 * **A prompt with no answer blocks the sign-off.** The site-specific questions
 * are the only part of a method statement that cannot be written in an office:
 * where the isolation point is, where the assembly area is, who holds the key.
 * A SWMS signed with those blank is the generic document the regulator does not
 * accept.
 *
 * **High-risk construction work is named, not implied.** Where an activity
 * falls under regulation 291 the category is quoted on the record, because the
 * question a principal contractor asks is "which category", and "safety is our
 * priority" is not an answer.
 *
 * Nothing here reads the database or the network. The screens hold the
 * records; this decides what a record means.
 */

/** The hierarchy of control, highest first. Anything below isolate is a last resort. */
export type ControlLevel = 'eliminate' | 'substitute' | 'isolate' | 'engineering' | 'administrative' | 'ppe';

export const CONTROL_LEVEL_LABEL: Record<ControlLevel, string> = {
  eliminate: 'Eliminate',
  substitute: 'Substitute',
  isolate: 'Isolate',
  engineering: 'Engineering',
  administrative: 'Administrative',
  ppe: 'PPE',
};

/** Where each level sits in the hierarchy, 1 being the most effective. */
export const CONTROL_LEVEL_ORDER: Record<ControlLevel, number> = {
  eliminate: 1, substitute: 2, isolate: 3, engineering: 4, administrative: 5, ppe: 6,
};

export type RiskLevel = 'extreme' | 'high' | 'medium' | 'low';

export const RISK_ORDER: Record<RiskLevel, number> = { extreme: 4, high: 3, medium: 2, low: 1 };

export const RISK_LABEL: Record<RiskLevel, string> = {
  extreme: 'Extreme', high: 'High', medium: 'Medium', low: 'Low',
};

/** A category of high-risk construction work, quoted from the regulation. */
export interface HrcwCategory {
  /** "s291(a)" or the description where the numbering is not certain. */
  clause: string;
  text: string;
}

export interface SwmsControl {
  level: ControlLevel;
  control: string;
}

export interface SwmsStep {
  step: string;
  hazards: string[];
  initialRisk: RiskLevel;
  controls: SwmsControl[];
  residualRisk: RiskLevel;
  /** Who does it: "Technician", "Second person", "Supervisor". */
  responsible: string;
}

/**
 * What suggests a template on a given day.
 *
 * A technician standing at a site should not have to remember that a hydrant
 * flow test means the traffic statement as well. The register and the routines
 * due already say what the work is, so they can say which statements apply.
 */
export interface SwmsSuggestion {
  /** Asset systems at the site: 'hydrant', 'detection', 'sprinkler', 'extinguisher'. */
  systems?: string[];
  /** Service routine ids, as in @/seed/serviceRoutines. */
  routineIds?: string[];
  /** Words in the job title or the technician's own description of the day. */
  words?: string[];
}

export interface SwmsTemplate {
  id: string;
  title: string;
  /** The work in one line, as a technician would name it. */
  activity: string;
  /** Empty where the work is not high-risk construction work. */
  hrcw: HrcwCategory[];
  whenRequired: string;
  permits: string[];
  ppe: string[];
  training: string[];
  steps: SwmsStep[];
  emergency: string;
  references: string[];
  siteSpecificPrompts: string[];
  suggestFor?: SwmsSuggestion;
}

// ---------------------------------------------------------------------------
// The record a crew fills in
// ---------------------------------------------------------------------------

export interface SwmsWorker {
  name: string;
  /** Fire protection licence, electrical licence, or whatever ticket the work needs. */
  licence?: string;
  /** Data URI of the signature, set when they sign. */
  signature?: string;
  signedAt?: string;
}

export interface AddedHazard {
  hazard: string;
  control: string;
}

export interface PermitHeld {
  permit: string;
  reference?: string;
  held: boolean;
}

export type SwmsStatus = 'draft' | 'signed';

export interface SwmsRecord {
  id: string;
  /** One or more templates. More than one is a JSEA covering the day's work. */
  templateIds: string[];
  /** What the crew is calling it. Defaults to the templates' titles. */
  title: string;
  siteId?: string;
  siteName?: string;
  /** The Simpro job it belongs to, so the signed PDF can be filed on it. */
  jobExternalId?: string;
  jobTitle?: string;
  /** The Queensland calendar day the work is being done. */
  date: string;
  supervisor?: string;
  supervisorPhone?: string;
  /** Answers to the site-specific prompts, keyed by the prompt itself. */
  answers: Record<string, string>;
  /** What the crew found on arrival that the office could not have known. */
  addedHazards: AddedHazard[];
  /** Step keys the crew has ticked as read. See stepKey. */
  ticked: string[];
  ppeChecked: string[];
  permits: PermitHeld[];
  workers: SwmsWorker[];
  status: SwmsStatus;
  signedAt?: string;
  /** When the PDF was queued onto the Simpro job. */
  attachedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The identity of one step inside a record.
 *
 * Records reference steps by template and position rather than by their words,
 * so a typo fixed in the library does not silently untick a signed record's
 * steps — and so two templates with a step called "Set up" stay distinct.
 */
export function stepKey(templateId: string, index: number): string {
  return `${templateId}#${index}`;
}

// ---------------------------------------------------------------------------
// Merging templates into the day's analysis
// ---------------------------------------------------------------------------

export interface MergedStep extends SwmsStep {
  templateId: string;
  templateTitle: string;
  key: string;
}

export interface MergedSwms {
  templates: SwmsTemplate[];
  steps: MergedStep[];
  hrcw: HrcwCategory[];
  permits: string[];
  ppe: string[];
  training: string[];
  references: string[];
  prompts: string[];
  /** The worst residual risk anywhere in the day, after controls. */
  residualRisk?: RiskLevel;
  /** True when any part of the day is high-risk construction work. */
  highRisk: boolean;
}

/**
 * Everything the crew has to read today, in one document.
 *
 * Duplicates are collapsed by their words rather than kept per template: a crew
 * doing hot work at height should tick "wear a harness" once, not twice, and a
 * PPE list that repeats itself is a list nobody reads to the bottom of.
 */
export function mergeSwms(templates: readonly SwmsTemplate[]): MergedSwms {
  const steps: MergedStep[] = [];
  for (const t of templates) {
    t.steps.forEach((s, i) => {
      steps.push({ ...s, templateId: t.id, templateTitle: t.title, key: stepKey(t.id, i) });
    });
  }
  const merged: MergedSwms = {
    templates: [...templates],
    steps,
    hrcw: dedupeBy(templates.flatMap((t) => t.hrcw), (h) => `${h.clause}|${h.text}`),
    permits: dedupe(templates.flatMap((t) => t.permits ?? [])),
    ppe: dedupe(templates.flatMap((t) => t.ppe ?? [])),
    training: dedupe(templates.flatMap((t) => t.training ?? [])),
    references: dedupe(templates.flatMap((t) => t.references ?? [])),
    prompts: dedupe(templates.flatMap((t) => t.siteSpecificPrompts ?? [])),
    residualRisk: worstRisk(steps.map((s) => s.residualRisk)),
    highRisk: templates.some((t) => (t.hrcw ?? []).length > 0),
  };
  return merged;
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function dedupeBy<T>(values: readonly T[], key: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of values) {
    const k = key(v).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** The worst of a set of risk levels, or undefined when there are none. */
export function worstRisk(levels: readonly RiskLevel[]): RiskLevel | undefined {
  let worst: RiskLevel | undefined;
  for (const l of levels) {
    if (!worst || RISK_ORDER[l] > RISK_ORDER[worst]) worst = l;
  }
  return worst;
}

/** Controls in hierarchy order, so the page never leads with a hard hat. */
export function orderedControls(controls: readonly SwmsControl[]): SwmsControl[] {
  return [...controls].sort((a, b) => CONTROL_LEVEL_ORDER[a.level] - CONTROL_LEVEL_ORDER[b.level]);
}

// ---------------------------------------------------------------------------
// What has to be true before anybody signs
// ---------------------------------------------------------------------------

export interface SwmsIssue {
  /** Blocking issues stop the sign-off. Advisory ones print on the page. */
  blocking: boolean;
  what: string;
  /** What to do about it, in a technician's words. */
  fix: string;
}

export function validateSwms(record: SwmsRecord, merged: MergedSwms): SwmsIssue[] {
  const issues: SwmsIssue[] = [];

  if (!record.templateIds.length) {
    issues.push({ blocking: true, what: 'No method statement chosen', fix: 'Pick the work you are doing today.' });
  }
  if (!record.date) {
    issues.push({ blocking: true, what: 'No date', fix: 'A statement covers one day. Set the day.' });
  }
  if (!record.siteName?.trim()) {
    issues.push({ blocking: true, what: 'No site', fix: 'Say where the work is. A statement without an address covers nothing.' });
  }

  const unanswered = merged.prompts.filter((p) => !record.answers[p]?.trim());
  for (const p of unanswered) {
    issues.push({
      blocking: true,
      what: `Not answered: ${p}`,
      fix: 'This is the part of the statement that can only be answered here, on this site.',
    });
  }

  const unticked = merged.steps.filter((s) => !record.ticked.includes(s.key));
  if (unticked.length) {
    issues.push({
      blocking: true,
      what: `${unticked.length} step${unticked.length === 1 ? '' : 's'} not read`,
      fix: 'Every step has to be read before it is signed. Tick them as you go through them with the crew.',
    });
  }

  const missingPermits = merged.permits.filter((p) => !record.permits.some((h) => h.permit === p && h.held));
  for (const p of missingPermits) {
    issues.push({
      blocking: true,
      what: `No ${p}`,
      fix: 'This work does not start without it. Get it from the site or the principal contractor and put its number on here.',
    });
  }

  const signed = record.workers.filter((w) => w.name.trim() && w.signature);
  if (!signed.length) {
    issues.push({
      blocking: true,
      what: 'Nobody has signed',
      fix: 'Everybody doing the work signs, including you.',
    });
  }
  const unsigned = record.workers.filter((w) => w.name.trim() && !w.signature);
  for (const w of unsigned) {
    issues.push({
      blocking: true,
      what: `${w.name.trim()} has not signed`,
      fix: 'Either they sign it or take them off the list. A name on a SWMS without a signature reads as a person who never saw it.',
    });
  }

  const missingPpe = merged.ppe.filter((p) => !record.ppeChecked.includes(p));
  if (missingPpe.length) {
    issues.push({
      blocking: false,
      what: `${missingPpe.length} item${missingPpe.length === 1 ? '' : 's'} of PPE not confirmed`,
      fix: `Not blocking, but it prints on the page: ${missingPpe.join(', ')}.`,
    });
  }

  if (!record.supervisor?.trim()) {
    issues.push({
      blocking: false,
      what: 'No supervisor named',
      fix: 'The person to ring when the work changes. It prints on the page for the crew and the principal contractor.',
    });
  }

  if (merged.highRisk && !record.jobExternalId) {
    issues.push({
      blocking: false,
      what: 'Not linked to a Simpro job',
      fix: 'High-risk work should end up on the job file. Pick the job and the signed PDF goes onto it.',
    });
  }

  return issues;
}

export function canSign(record: SwmsRecord, merged: MergedSwms): boolean {
  return !validateSwms(record, merged).some((i) => i.blocking);
}

/** The one-line reason a sign-off is blocked, for a button that is greyed out. */
export function whyNotSigned(record: SwmsRecord, merged: MergedSwms): string | undefined {
  const first = validateSwms(record, merged).find((i) => i.blocking);
  return first ? `${first.what}. ${first.fix}` : undefined;
}

// ---------------------------------------------------------------------------
// Choosing the statements for today
// ---------------------------------------------------------------------------

export interface SuggestContext {
  /** Asset systems held at the site. */
  systems?: readonly string[];
  /** Routines due or being done there. */
  routineIds?: readonly string[];
  /** The job title, or whatever the technician typed about the day. */
  text?: string;
}

/**
 * Which statements apply, worked out rather than remembered.
 *
 * A hydrant flow test is also a traffic job, because the booster is on the
 * street; a detection annual is also a height job, because the detectors are on
 * the ceiling. The one a crew forgets is the second one, every time — so the
 * suggestion is deliberately generous and the screen lets them take one off,
 * rather than being cautious and letting them start without it.
 */
export function suggestTemplates(templates: readonly SwmsTemplate[], context: SuggestContext): string[] {
  const text = (context.text ?? '').toLowerCase();
  const systems = new Set((context.systems ?? []).map((s) => s.toLowerCase()));
  const routines = new Set(context.routineIds ?? []);
  const out: string[] = [];

  for (const t of templates) {
    const s = t.suggestFor;
    if (!s) continue;
    const bySystem = (s.systems ?? []).some((x) => systems.has(x.toLowerCase()));
    const byRoutine = (s.routineIds ?? []).some((x) => routines.has(x));
    const byWord = text ? (s.words ?? []).some((w) => text.includes(w.toLowerCase())) : false;
    if (bySystem || byRoutine || byWord) out.push(t.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Yesterday's, again
// ---------------------------------------------------------------------------

export interface CarryForwardResult {
  record: Omit<SwmsRecord, 'id' | 'createdAt' | 'updatedAt'>;
  /** What was deliberately not carried, so the screen can say so. */
  cleared: string[];
}

/**
 * The same work, the next day.
 *
 * Everything that describes the work carries: the statements, the site, the
 * job, the answers, the hazards the crew added, the PPE they confirmed, the
 * crew's names. Two things do not.
 *
 * The signatures, because a signature says this person read this document
 * today, and copying it forward is forging it. And the ticks, because the
 * reading is the point — a crew that ticked eleven steps yesterday and starts
 * today with them already ticked has not been walked through anything.
 */
export function carryForwardSwms(previous: SwmsRecord, date: string): CarryForwardResult {
  return {
    record: {
      templateIds: [...previous.templateIds],
      title: previous.title,
      siteId: previous.siteId,
      siteName: previous.siteName,
      jobExternalId: previous.jobExternalId,
      jobTitle: previous.jobTitle,
      date,
      supervisor: previous.supervisor,
      supervisorPhone: previous.supervisorPhone,
      answers: { ...previous.answers },
      addedHazards: previous.addedHazards.map((h) => ({ ...h })),
      ticked: [],
      ppeChecked: [...previous.ppeChecked],
      permits: previous.permits.map((p) => ({ permit: p.permit, held: false, reference: p.reference })),
      workers: previous.workers.map((w) => ({ name: w.name, licence: w.licence })),
      status: 'draft',
      notes: previous.notes,
    },
    cleared: [
      'Signatures — everybody signs again today.',
      'The steps — they get read again before they are ticked.',
      'Permits — a permit is for a day, so its box is unticked and its number kept.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Words for the screens
// ---------------------------------------------------------------------------

/** "Hot work and one other, 3 of 11 steps read" — the line under a draft. */
export function swmsProgressLine(record: SwmsRecord, merged: MergedSwms): string {
  const read = merged.steps.filter((s) => record.ticked.includes(s.key)).length;
  const signed = record.workers.filter((w) => w.signature).length;
  const parts = [`${read} of ${merged.steps.length} steps read`];
  if (record.workers.length) parts.push(`${signed} of ${record.workers.length} signed`);
  return parts.join(' · ');
}

export function swmsTitleFor(templates: readonly SwmsTemplate[]): string {
  if (!templates.length) return 'Safe work method statement';
  if (templates.length === 1) return templates[0]!.title;
  return `${templates[0]!.title} and ${templates.length - 1} other${templates.length === 2 ? '' : 's'}`;
}

/**
 * When a signed statement stops covering the work.
 *
 * Not a date on a calendar: a SWMS covers the work it describes, at the site it
 * names, on the day it was signed. The regulation's own trigger for review is
 * a change in the work — which is why this is a list of events rather than a
 * countdown.
 */
export const SWMS_REVIEW_TRIGGERS: readonly string[] = [
  'The work changed — a different method, a different tool, a different part of the building.',
  'Somebody new joined the crew. They sign, or the statement does not cover them.',
  'A control did not work, or a near miss happened.',
  'The site changed around you: new trades, a scaffold moved, power isolated.',
  'A new day. A statement signed yesterday does not cover today.',
];

/**
 * Whether a signed record still covers what is happening now.
 *
 * Only the day is decidable in code — the rest are events a person notices —
 * so this answers the one it can, and the screen prints the rest as the
 * triggers to think about.
 */
export function stillCovers(record: SwmsRecord, today: string): boolean {
  return record.status === 'signed' && record.date === today;
}
