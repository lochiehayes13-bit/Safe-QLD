import { complete } from './client';
import { numbersIn } from './defectWording';

/**
 * Writing up a note to the office from what a technician actually says.
 *
 * A note on a job is read by a scheduler who was not there, and often
 * again months later by whoever picks the job up. What gets typed on a
 * phone at the end of a job is "cant finish panel dead need sparky back
 * tues". Everything the office needs is in it; none of it is in a form
 * they can act on, and the technician who typed it is standing in a car
 * park with the van running.
 *
 * So the rough words can be written up. The rules are the defect
 * wording's rules, for the same reason: the note becomes the company's
 * record of what happened on a site, and a sentence somebody invented is
 * worse than no sentence.
 *
 * **Only the rough words go up.** Not the job, not the customer, not the
 * site, not the notes already on the record. What leaves the phone is what
 * was typed into the box, which the person is about to send to the office
 * anyway.
 *
 * **No new facts.** A number not in the rough words is refused outright —
 * a date, a quantity, a part number, a pressure. The model may order and
 * spell what it was given and nothing else.
 *
 * **It stays a note.** Short, plain, no greeting, no sign-off, no promises
 * on somebody else's behalf. A draft the technician reads and sends, or
 * edits, or throws away: the box still holds their own words until they
 * replace them.
 */

/** Past this the rough words are already a note, and the model is padding. */
export const MAX_ROUGH_CHARS = 1200;
/** A written-up note longer than this is not a note. */
export const MAX_NOTE_CHARS = 700;

export interface NoteDraft {
  /** The written-up note, ready to read and send. */
  note?: string;
  /** A subject line, where the words gave one plainly. */
  subject?: string;
  /** Why nothing came back. Present exactly when `note` is not. */
  refusal?: string;
}

export const NOTE_SYSTEM_PROMPT = [
  'You tidy up a note a fire protection technician has typed on their phone, so the office can read it.',
  'The note goes onto a job record in Simpro and is read by a scheduler who was not on site.',
  '',
  'Rules, all absolute:',
  '1. Use only the facts in what you are given. Never add a number, a date, a quantity, a part number,',
  '   a name or an outcome that is not there. If something is unclear, leave it as it was typed.',
  '2. Never promise anything on anybody\'s behalf, and never say when someone will attend unless the',
  '   technician said it.',
  '3. Plain Australian English, past tense, at most four short sentences. No greeting, no sign-off,',
  '   no "please find", no apology, no filler.',
  '4. Answer with a subject line of at most eight words, then a blank line, then the note. Nothing else.',
].join('\n');

/** The rough words, and nothing else about the job. */
export function buildNotePrompt(rough: string): string {
  return `Technician's words:\n${rough.trim()}`;
}

/** Whether there is enough to write up. */
export function worthWriting(rough: string): { ok: boolean; reason?: string } {
  const trimmed = rough.trim();
  if (trimmed.split(/\s+/).filter(Boolean).length < 3) {
    return { ok: false, reason: 'Write a few words first and it can be tidied up.' };
  }
  if (trimmed.length > MAX_ROUGH_CHARS) {
    return { ok: false, reason: 'That is long enough to send as it is.' };
  }
  return { ok: true };
}

/**
 * Checks the draft against the words it came from.
 *
 * Two refusals, both the ways a model composes rather than tidies: a number
 * from nowhere, and a note long enough to be padding. Either is thrown away
 * rather than shown with a caveat, because a caveat above an invented date
 * does not stop it reaching the office.
 */
export function checkNote(raw: string, rough: string): NoteDraft {
  const text = raw.trim();
  if (!text) return { refusal: 'Nothing came back. Your own words still stand.' };

  const lines = text.split('\n');
  const first = (lines[0] ?? '').trim();
  const rest = lines.slice(1).join('\n').trim();
  // A subject and a note, where it answered as asked; the whole thing as the
  // note where it did not, since a note is the part that matters.
  const hasSubject = Boolean(rest) && first.length <= 60 && !/[.!?]$/.test(first);
  const subject = hasSubject ? first.replace(/^subject:\s*/i, '').trim() : undefined;
  const note = (hasSubject ? rest : text).trim();

  if (note.length > MAX_NOTE_CHARS) {
    return { refusal: 'What came back was longer than the note itself. Your own words still stand.' };
  }

  const allowed = numbersIn(rough);
  const invented = [...numbersIn(`${subject ?? ''} ${note}`)].filter((n) => !allowed.has(n));
  if (invented.length) {
    return { refusal: `It wrote a number that was not in your words: "${invented[0]}". Your own words still stand.` };
  }

  return { note, subject };
}

/**
 * Writes up the rough words, or says why it did not.
 *
 * Never throws. Every refusal leaves the technician's own words in the box,
 * because those are already a note the office can read; this only ever
 * offers a better-ordered one.
 */
export async function draftOfficeNote(rough: string): Promise<NoteDraft> {
  const worth = worthWriting(rough);
  if (!worth.ok) return { refusal: worth.reason };

  const result = await complete({
    system: NOTE_SYSTEM_PROMPT,
    user: buildNotePrompt(rough),
    maxTokens: 400,
  });

  if (result.text === undefined) {
    switch (result.failure) {
      case 'no-key':
        return { refusal: 'No API key is set. Add one in Settings to have a note written up; your own words send either way.' };
      case 'no-answer':
        return { refusal: 'No answer came back — most likely no signal. Your own words still stand.' };
      default:
        return { refusal: `${result.refusal ?? 'No answer.'} Your own words still stand.` };
    }
  }

  return checkNote(result.text, rough);
}
