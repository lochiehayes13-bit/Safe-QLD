import { chosenButton, isQuestion, labelledText, type AlertChoice } from '@/domain/alertChoice';

/**
 * The same message, in a browser, where react-native's Alert does nothing.
 *
 * `react-native-web`'s Alert is `static alert() {}` — every message the app
 * raises is discarded, and the browser is how this app reaches an iPhone. So a
 * statement becomes `window.alert` and a question becomes `window.confirm`,
 * and the button the person chose is run exactly as the phone would run it.
 *
 * The two prompts are synchronous and block the page, which is not elegant and
 * is the point: an alert in this app is either a refusal to do something or a
 * confirmation before doing something irreversible, and both have to be
 * answered before the screen moves on. A toast that slides past while somebody
 * is looking at a panel would be worse than what is here now.
 *
 * `globalThis` rather than `window` because this module is also loaded when the
 * page is rendered on the server for the static export, where neither prompt
 * exists; the message is dropped there, which is right, because nobody is
 * looking at it.
 */
export function showAlert(title: string, message?: string, buttons?: AlertChoice[]): void {
  const text = labelledText(title, message, buttons);
  const w = globalThis as { alert?: (m: string) => void; confirm?: (m: string) => boolean };

  let confirmed = true;
  if (isQuestion(buttons)) {
    // No `confirm` means no way to ask, and going ahead with a destructive
    // action nobody agreed to is the one outcome worth avoiding.
    confirmed = w.confirm ? w.confirm(text) : false;
  } else {
    w.alert?.(text);
  }

  chosenButton(buttons, confirmed)?.onPress?.();
}
