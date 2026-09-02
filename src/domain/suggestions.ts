/**
 * What a technician says about the app itself.
 *
 * The people who use this app know what is wrong with it long before anyone
 * in the office does, and the distance between noticing and telling somebody
 * is the whole problem: a thought on a ladder is gone by the ute. So there is
 * a screen for it, two taps from home, and it sends a structured email — the
 * same subject shape every time — to an inbox that a person (or a script that
 * turns suggestions into changes) can filter on.
 *
 * Pure: wording and validation here, the mail composer in the screen.
 */

export type SuggestionKind = 'idea' | 'problem' | 'information';

export const SUGGESTION_KINDS: readonly { value: SuggestionKind; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'problem', label: 'Something wrong' },
  { value: 'information', label: 'Add information' },
];

export interface Suggestion {
  technicianName: string;
  kind: SuggestionKind;
  /** Where in the app, in the technician's words or a module label. */
  screen: string;
  text: string;
  /** The build it was written on, so a fixed problem is not chased twice. */
  appVersion: string;
}

/**
 * The tag that starts every subject.
 *
 * Fixed and bracketed so an inbox rule can file these without reading them,
 * and so a script watching the inbox can tell a suggestion from a timesheet.
 */
export const SUGGESTION_TAG = '[Safe QLD app]';

export const KIND_LABEL: Record<SuggestionKind, string> = {
  idea: 'Idea',
  problem: 'Something wrong',
  information: 'Information to add',
};

export function suggestionSubject(s: Suggestion): string {
  const who = s.technicianName.trim() || 'Unnamed technician';
  const where = s.screen.trim();
  return `${SUGGESTION_TAG} ${KIND_LABEL[s.kind]}${where ? ` — ${where}` : ''} — ${who}`;
}

export function suggestionBody(s: Suggestion): string {
  const lines: string[] = [];
  lines.push(`Kind: ${KIND_LABEL[s.kind]}`);
  if (s.screen.trim()) lines.push(`Where: ${s.screen.trim()}`);
  lines.push(`From: ${s.technicianName.trim() || 'Unnamed technician'}`);
  if (s.appVersion.trim()) lines.push(`App version: ${s.appVersion.trim()}`);
  lines.push('');
  lines.push(s.text.trim());
  lines.push('');
  lines.push('Sent from the Suggest a change screen in Safe QLD. Reply to the technician if you need more.');
  return lines.join('\n');
}

export function suggestionNotReady(s: Suggestion): string | null {
  if (!s.technicianName.trim()) {
    return 'Set your name in Settings first, so whoever reads this can ask you about it.';
  }
  if (s.text.trim().length < 15) {
    return 'Say a little more. One line about what you expected and what happened is enough.';
  }
  return null;
}
