/**
 * Turning a native alert into something a browser can show.
 *
 * `Alert.alert` is a no-op in react-native-web. Not a stub that logs, not a
 * fallback that shows a bar at the top — the whole implementation is
 * `static alert() {}`. Every message this app raises that way therefore
 * disappears in a browser, and the browser is how this app reaches an iPhone.
 *
 * That is a hundred and seventy-eight messages, and the ones that matter most
 * are the ones a technician is meant to act on: "Photo required", "Not ready to
 * send", "This records today as the rectification date", "No mail app set up".
 * All of them silent. Press the button, nothing happens, and every failure this
 * audit has just given words to would have been given them into the void.
 *
 * A browser has two things that work and nothing else: `window.alert`, which
 * says one thing, and `window.confirm`, which asks one question with two
 * answers. This module decides which of those a native alert becomes, and which
 * of its buttons ran — kept pure and separate from the calling of it, because
 * the mapping is the part with the judgement in it and the part worth testing.
 *
 * The judgement it makes: a cancel button is the browser's Cancel, whatever it
 * is labelled, and everything else is OK. That is the honest reading of every
 * two-button alert in this app — one of them backs out, the other goes ahead —
 * and it means a destructive confirm cannot be answered by accident, because a
 * browser's Cancel is what a dismissed dialog returns.
 */

/** The shape react-native's Alert takes, narrowed to what this app passes. */
export interface AlertChoice {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

/**
 * Whether the browser should ask rather than tell.
 *
 * One button, or none, is a statement: the person has read it and pressed OK.
 * Two is a question, and it has to be asked with `confirm` or the "Cancel" half
 * cannot be chosen at all.
 */
export function isQuestion(buttons?: readonly AlertChoice[]): boolean {
  return (buttons?.length ?? 0) > 1;
}

/**
 * What the browser dialog says.
 *
 * `window.alert` takes one string, so the title and the body are joined. The
 * title first and on its own line: it is the sentence written to be read in a
 * hurry, and the body is the detail underneath it.
 */
export function dialogText(title: string, message?: string): string {
  const body = message?.trim();
  return body ? `${title}\n\n${body}` : title;
}

/**
 * The button whose `onPress` should run, given what the browser came back with.
 *
 * `confirmed` is what `window.confirm` returned, or true for a plain alert,
 * which the person can only agree with.
 *
 * A dismissed dialog — Escape, or the tab losing the prompt — is a false, and
 * that has to be the cancelling button rather than nothing at all: several of
 * these alerts have a cancel branch that puts the screen back the way it was.
 */
export function chosenButton(
  buttons: readonly AlertChoice[] | undefined,
  confirmed: boolean,
): AlertChoice | undefined {
  if (!buttons?.length) return undefined;
  const cancel = buttons.find((b) => b.style === 'cancel');
  if (!confirmed) return cancel ?? undefined;
  // The one that goes ahead: anything that is not the cancel. With a single
  // button there is no cancel and the one button is the answer, which is why
  // this is written as "not cancel" rather than "the last one".
  return buttons.find((b) => b !== cancel) ?? cancel;
}

/**
 * How the question reads once it is a browser's OK-or-Cancel.
 *
 * A browser will not relabel its buttons, so an alert whose choices are
 * "Rectified" and "Cancel" becomes a dialog offering OK and Cancel — and OK on
 * its own does not say what it will do. The labels go into the text instead, so
 * the sentence still names the action being agreed to.
 */
export function labelledText(
  title: string,
  message: string | undefined,
  buttons: readonly AlertChoice[] | undefined,
): string {
  const base = dialogText(title, message);
  if (!isQuestion(buttons)) return base;
  const go = chosenButton(buttons, true)?.text?.trim();
  const back = chosenButton(buttons, false)?.text?.trim();
  if (!go) return base;
  return `${base}\n\nOK — ${go}${back ? `\nCancel — ${back}` : ''}`;
}
