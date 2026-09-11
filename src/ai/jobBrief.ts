import { complete } from './client';
import { loadPrefs } from '@/app-prefs';
import { qldDay } from '@/domain/qldTime';
import { numbersIn } from './defectWording';

/**
 * Three sentences before you walk in.
 *
 * A job card holds everything the office knows: the description, the notes,
 * the site's open defects, when it was last serviced. It is all there and
 * none of it is read in the van, because reading a job card is a two-minute
 * job and a technician between sites has thirty seconds. This turns the card
 * into the three sentences they would get from the scheduler on the phone:
 * what the job is, what the office said, what is already broken there, and
 * when it was last done.
 *
 * This is the one language-model feature in the app that sends customer
 * data, and it is treated differently for it. The grounded search and the
 * defect wording send nothing about the site by construction; this one
 * cannot do its job without the job description and the notes, which name
 * the customer and describe their building. So it is behind its own switch
 * (`aiShareJobRecords`, off until somebody turns it on) with a note in
 * Settings saying exactly what leaves the phone, and the switch is checked
 * here, in the module, rather than trusted to the screen.
 *
 * The brief is checked on the way back the same way the others are: it may
 * not contain a number that is not in what it was given. A brief that says
 * "last serviced in March, 4 open defects" when the card says two is not a
 * summary, it is a new fact, and a technician walks in believing it.
 */

export interface JobBriefInput {
  /** Simpro's job number, so the brief can refer to it. */
  jobNumber?: string;
  title?: string;
  jobType?: string;
  /** The office's description of the work, HTML stripped. */
  description?: string;
  /** The office's notes field on the job. */
  officeNotes?: string;
  /** Notes filed against the job, newest first. */
  notes?: { subject?: string; note?: string; createdAt?: string }[];
  /** The office's public notes on the site — where to park, who to sign in with. */
  siteNotes?: string;
  /** What is already open at the site. */
  openDefects?: { location: string; description: string; severity: 'critical' | 'non-critical' }[];
  /** The most recent service recorded at the site, as an ISO instant, and what it was. */
  lastServicedAt?: string;
  lastServiceSummary?: string;
  scheduledFor?: string;
}

export interface JobBrief {
  text?: string;
  refusal?: string;
}

/** The most of each list worth sending. Beyond this the brief is reading a report, not a card. */
export const MAX_NOTES = 8;
export const MAX_DEFECTS = 12;
/** Characters per free-text field. */
export const MAX_FIELD_CHARS = 1500;

export const BRIEF_SYSTEM_PROMPT = [
  'You brief a fire protection technician in Queensland, Australia, who is about to walk into',
  'a site. You are given the office\'s record of the job. Write exactly three sentences:',
  '',
  '1. What the job is.',
  '2. What the office noted, and what is already known to be broken at the site.',
  '3. When the site was last serviced, or that no service is on record.',
  '',
  'Rules, all absolute:',
  '- Use only what is in the record. Never state a figure, date, count or clause number',
  '  that is not there. If the record does not say, say it does not say.',
  '- Plain words, no headings, no bullet points. Three sentences and nothing else.',
  '- Australian conventions: metric, dates as d/m/yyyy.',
].join('\n');

function clip(text: string | undefined): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > MAX_FIELD_CHARS ? `${clean.slice(0, MAX_FIELD_CHARS)}…` : clean;
}

/**
 * Builds the message. Everything the model sees is in this string and every
 * field in it was handed in by name, so what leaves the phone is the input
 * type and nothing else.
 */
export function buildBriefPrompt(input: JobBriefInput): string {
  const notes = (input.notes ?? []).slice(0, MAX_NOTES)
    .map((n) => `- ${[n.createdAt ? qldDay(n.createdAt) : undefined, n.subject, clip(n.note)].filter(Boolean).join(': ')}`)
    .join('\n');
  const defects = (input.openDefects ?? []).slice(0, MAX_DEFECTS)
    .map((d) => `- ${d.severity === 'critical' ? 'CRITICAL' : 'Non-critical'} — ${d.location}: ${clip(d.description)}`)
    .join('\n');

  return [
    input.jobNumber ? `Job number: ${input.jobNumber}` : undefined,
    input.title ? `Title: ${clip(input.title)}` : undefined,
    input.jobType ? `Type: ${input.jobType}` : undefined,
    input.scheduledFor ? `Scheduled: ${qldDay(input.scheduledFor) ?? input.scheduledFor}` : undefined,
    `Description: ${clip(input.description) ?? '(none)'}`,
    `Office notes on the job: ${clip(input.officeNotes) ?? '(none)'}`,
    `Notes filed against the job:\n${notes || '(none)'}`,
    `Site notes from the office: ${clip(input.siteNotes) ?? '(none)'}`,
    `Open defects at the site:\n${defects || '(none on record)'}`,
    `Last serviced: ${input.lastServicedAt ? `${qldDay(input.lastServicedAt) ?? input.lastServicedAt}${input.lastServiceSummary ? ` — ${clip(input.lastServiceSummary)}` : ''}` : '(no service on record)'}`,
  ].filter((l) => l !== undefined).join('\n');
}

/**
 * Checks the brief before anybody reads it.
 *
 * Numbers only, because a number is the thing a summary can get wrong in a
 * way that reads exactly like getting it right. A date repeated in any
 * order passes, since its parts are on the card; what cannot pass is a day,
 * a count or a job number the card never had.
 */
export function checkBrief(raw: string, input: JobBriefInput): JobBrief {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { refusal: 'The model returned nothing. The job card is below.' };
  const allowed = numbersIn(buildBriefPrompt(input));
  const foreign = [...numbersIn(text)].filter((n) => !allowed.has(n));
  if (foreign.length) {
    return {
      refusal: `The brief states "${foreign[0]}", which is nowhere on the job card. A number from nowhere `
        + 'is the failure this check exists for, so the brief has been discarded. The card is below.',
    };
  }
  return { text };
}

/** Whether there is a card to brief from at all. */
export function worthBriefing(input: JobBriefInput): { ok: boolean; reason?: string } {
  const has = [input.description, input.officeNotes, input.siteNotes, input.title]
    .some((s) => s?.trim())
    || (input.notes?.length ?? 0) > 0
    || (input.openDefects?.length ?? 0) > 0;
  if (!has) return { ok: false, reason: 'The job card is empty on this phone, so there is nothing to brief from. Open the job with signal first.' };
  return { ok: true };
}

/** What the switch reader has to answer. The real one is loadPrefs; a test hands in its own. */
export type SwitchReader = () => Promise<{ aiShareJobRecords: boolean }>;

/**
 * Drafts the brief, or says why it did not.
 *
 * `aiShareJobRecords` is the switch. It is checked first and it is checked
 * here, read from the phone's own settings rather than taken from the
 * caller: a screen cannot turn the feature on by passing a flag, only the
 * person at the switch can. With it off nothing is built and nothing is
 * sent, and the refusal says where the switch is. The reader can be swapped
 * for a test; nothing else should swap it. Never throws.
 */
export async function draftJobBrief(
  input: JobBriefInput,
  options: { readPrefs?: SwitchReader } = {},
): Promise<JobBrief> {
  const prefs = await (options.readPrefs ?? loadPrefs)();
  if (!prefs.aiShareJobRecords) {
    return {
      refusal: 'Sharing job records with the model is off, so the job card stays on the phone. '
        + 'Settings has the switch and says exactly what would be sent.',
    };
  }
  const worth = worthBriefing(input);
  if (!worth.ok) return { refusal: worth.reason };

  const result = await complete({ system: BRIEF_SYSTEM_PROMPT, user: buildBriefPrompt(input), maxTokens: 300 });
  if (result.text === undefined) {
    switch (result.failure) {
      case 'no-key':
        return { refusal: 'No API key is set. The job card below is the brief; add a key in Settings to have it summarised.' };
      case 'no-answer':
        return { refusal: 'No answer came back — most likely no signal. The job card below is on this phone and does not need one.' };
      default:
        return { refusal: `${result.refusal ?? 'No answer.'} The job card is below.` };
    }
  }
  return checkBrief(result.text, input);
}

/**
 * What leaves the phone when the switch is on, stated plainly. Shown beside
 * the switch, because a technician agreeing to this should know what it means.
 */
export const JOB_RECORDS_PRIVACY_NOTE = [
  'When this is on, pressing "Brief me" on a job sends that job\'s record to Anthropic to be',
  'summarised: the job number and title, the office\'s description and notes, the notes filed',
  'against the job, the office\'s site notes, the site\'s open defects, and the date of its last',
  'service. That includes the customer\'s name where the office wrote it in those fields.',
  '',
  'Nothing is sent until the button is pressed, and nothing else goes with it: not the asset',
  'register, not your photographs, not any other job. Off, the job card is the brief.',
].join('\n');
