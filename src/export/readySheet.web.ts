/**
 * The moment a browser hands over a file it has made.
 *
 * A phone opens its share sheet, which is unmistakable. A browser can open the
 * same sheet — `navigator.share` with a file is on iOS Safari and Android
 * Chrome, and it is how a PDF reaches Mail, Files or Simpro's app in one tap
 * — but only from inside a tap. The file takes a few seconds to make, the
 * tap that asked for it has expired by then, and the app's own alert on the
 * web is `window.alert`, which has no buttons of its own to tap.
 *
 * So this is a small sheet of real buttons, drawn straight into the page: the
 * file is ready, and here is what to do with it. Share, where the browser has
 * a share sheet; save to the device, which every browser can; print, where the
 * document can be printed. Each button's own tap is the gesture the browser
 * wants. It is plain DOM rather than a React component because the file layer
 * has no screen of its own and seventeen screens call it.
 */

export interface ReadyChoice {
  label: string;
  /** The one a technician almost always wants, drawn as the primary. */
  primary?: boolean;
  onPress: () => void | Promise<void>;
}

export interface ReadySheet {
  title: string;
  /** One line under the title: what the file is, or where to send it. */
  hint?: string;
  choices: ReadyChoice[];
}

/**
 * Which buttons a file gets, decided away from the DOM so it can be held to.
 *
 * `canShare` is the browser's own answer for this file, asked with the actual
 * file — a browser that has `share` for links may refuse files, and offering a
 * button that fails is worse than not offering it.
 */
export function readyChoices(input: {
  canShare: boolean;
  canPrint: boolean;
  /** The iOS home-screen app, where a download opens a preview rather than saving. */
  standalone?: boolean;
  share: () => Promise<void>;
  save: () => void;
  print: () => void;
}): ReadyChoice[] {
  const out: ReadyChoice[] = [];
  if (input.canShare) out.push({ label: 'Share…', primary: true, onPress: input.share });
  out.push({
    label: input.standalone ? 'Open a preview' : input.canShare ? 'Save to this device' : 'Download',
    primary: !input.canShare,
    onPress: input.save,
  });
  if (input.canPrint) out.push({ label: 'Print', onPress: input.print });
  return out;
}

/** The smallest piece of a document this needs, so a test can hand it a stand-in. */
export interface SheetDocument {
  createElement: (tag: string) => HTMLElement;
  body: { appendChild: (el: HTMLElement) => unknown };
}

/**
 * Draws the sheet and returns a way to take it down.
 *
 * A choice closes the sheet once it has run, except a share the person
 * dismissed, which leaves it open so they can choose again: changing one's
 * mind is not an error.
 */
export function showReadySheet(sheet: ReadySheet, doc: SheetDocument = document): () => void {
  const backdrop = doc.createElement('div');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', sheet.title);
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;';

  const panel = doc.createElement('div');
  panel.style.cssText = 'background:#fff;color:#111;width:100%;max-width:520px;border-radius:18px 18px 0 0;'
    + 'padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -8px 30px rgba(0,0,0,0.25);'
    + 'font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;';

  const title = doc.createElement('div');
  title.textContent = sheet.title;
  title.style.cssText = 'font-size:18px;font-weight:700;margin:0 0 4px;';
  panel.appendChild(title);

  if (sheet.hint) {
    const hint = doc.createElement('div');
    hint.textContent = sheet.hint;
    hint.style.cssText = 'font-size:14px;line-height:20px;color:#444;margin:0 0 12px;';
    panel.appendChild(hint);
  }

  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    backdrop.remove();
  };

  /*
   * One choice at a time. A share sheet takes a moment to animate up, and a
   * second tap on the same button in that moment asks the browser to share
   * again — which WebKit refuses with an error that used to read as the
   * browser failing. The buttons are held while a choice is running.
   */
  const buttons: HTMLElement[] = [];
  const hold = (held: boolean): void => {
    for (const b of buttons) b.setAttribute('aria-disabled', held ? 'true' : 'false');
  };
  let running = false;

  for (const choice of sheet.choices) {
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.textContent = choice.label;
    button.style.cssText = `display:block;width:100%;min-height:48px;margin:8px 0 0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;`
      + (choice.primary
        ? 'background:#E8611C;color:#fff;border:0;'
        : 'background:#fff;color:#111;border:1px solid #C9CED6;');
    button.addEventListener('click', () => {
      if (running) return;
      // Run inside the tap, not after an await, because a share has to.
      const result = choice.onPress();
      if (result && typeof (result as Promise<void>).then === 'function') {
        running = true;
        hold(true);
        (result as Promise<void>).then(close, () => { running = false; hold(false); });
      } else {
        close();
      }
    });
    buttons.push(button);
    panel.appendChild(button);
  }

  const dismiss = doc.createElement('button');
  dismiss.setAttribute('type', 'button');
  dismiss.textContent = 'Not now';
  dismiss.style.cssText = 'display:block;width:100%;min-height:44px;margin:10px 0 0;background:none;border:0;color:#666;font-size:15px;cursor:pointer;';
  dismiss.addEventListener('click', close);
  panel.appendChild(dismiss);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.appendChild(panel);
  doc.body.appendChild(backdrop);
  return close;
}
