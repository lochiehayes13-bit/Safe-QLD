/**
 * A PDF leaving a browser: the sheet it is offered on, the email it goes
 * into, and what happens where the browser cannot make one.
 *
 * The web build makes a real PDF now (rasterPdf.web.ts, exercised in a real
 * browser by the verification script rather than here). What this suite holds
 * is the wiring around it, with stand-ins for the document and the navigator:
 * the choices a file is offered with, that a tap on Share runs the share
 * inside the tap, that a dismissed share leaves the sheet up, that the email
 * path puts the share sheet up on a phone and opens a composer on a desktop,
 * and that a browser with no page at all falls back to the printer rather than
 * throwing.
 */
import { readyChoices, showReadySheet, type SheetDocument } from '@/export/readySheet.web';
import { sendMail } from '@/export/mail.web';
import { writePdf } from '@/export/files.web';

/** Just enough of a DOM: elements that remember their children and listeners. */
interface FakeElement extends HTMLElement {
  tag: string;
  children_: FakeElement[];
  listeners: Record<string, ((e: unknown) => void)[]>;
  attributes_: Record<string, string>;
}

function fakeDocument(): { doc: SheetDocument; body: FakeElement; make: (tag: string) => FakeElement } {
  const make = (tag: string): FakeElement => {
    const el = {
      tag, children_: [], listeners: {}, attributes_: {}, textContent: '', style: {},
      setAttribute(name: string, value: string) { el.attributes_[name] = value; },
      appendChild(child: FakeElement) { el.children_.push(child); return child; },
      addEventListener(name: string, fn: (e: unknown) => void) { (el.listeners[name] ??= []).push(fn); },
      click() { for (const fn of el.listeners.click ?? []) fn({ target: el }); },
      remove() { const i = body.children_.indexOf(el); if (i >= 0) body.children_.splice(i, 1); },
    } as unknown as FakeElement;
    return el;
  };
  const body = make('body');
  const doc: SheetDocument = { createElement: make, body };
  return { doc, body, make };
}

const click = (el: FakeElement): void => { for (const fn of el.listeners.click ?? []) fn({ target: el }); };
const buttons = (body: FakeElement): FakeElement[] => body.children_[0]!.children_[0]!.children_.filter((c) => c.tag === 'button');
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the choices a finished file is offered with', () => {
  const stub = { share: async () => undefined, save: () => undefined, print: () => undefined };

  it('leads with Share where the browser has a share sheet for files', () => {
    const labels = readyChoices({ canShare: true, canPrint: true, ...stub }).map((c) => `${c.label}${c.primary ? '*' : ''}`);
    expect(labels).toEqual(['Share…*', 'Save to this device', 'Print']);
  });

  it('leads with Download where it does not, since that is all a desktop can do', () => {
    const labels = readyChoices({ canShare: false, canPrint: true, ...stub }).map((c) => `${c.label}${c.primary ? '*' : ''}`);
    expect(labels).toEqual(['Download*', 'Print']);
  });

  it('offers Print only where there is a document to print', () => {
    expect(readyChoices({ canShare: true, canPrint: false, ...stub }).map((c) => c.label)).toEqual(['Share…', 'Save to this device']);
  });

  it('in the home-screen app, calls the download what it does there: a preview', () => {
    expect(readyChoices({ canShare: true, canPrint: false, standalone: true, ...stub }).map((c) => c.label))
      .toEqual(['Share…', 'Open a preview']);
  });
});

describe('the sheet', () => {
  it('draws a button per choice and a way out, and runs a choice inside its own tap', () => {
    const { doc, body } = fakeDocument();
    const ran: string[] = [];
    showReadySheet({
      title: 'Form 72.pdf is ready',
      hint: 'Share puts it straight into Mail.',
      choices: [{ label: 'Share…', primary: true, onPress: () => { ran.push('share'); } }, { label: 'Save', onPress: () => { ran.push('save'); } }],
    }, doc);
    expect(body.children_).toHaveLength(1);
    expect(buttons(body).map((b) => b.textContent)).toEqual(['Share…', 'Save', 'Not now']);
    expect(body.children_[0]!.attributes_.role).toBe('dialog');

    click(buttons(body)[1]!);
    expect(ran).toEqual(['save']);
    // A choice that ran closes the sheet.
    expect(body.children_).toHaveLength(0);
  });

  it('stays up for a share the person dismissed, and closes for one that went', async () => {
    const { doc, body } = fakeDocument();
    let outcome: 'abort' | 'ok' = 'abort';
    showReadySheet({
      title: 'x',
      choices: [{
        label: 'Share…',
        onPress: async () => {
          if (outcome === 'abort') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
        },
      }],
    }, doc);
    click(buttons(body)[0]!);
    await flush();
    // Changing one's mind is not an error: the choices are still there.
    expect(body.children_).toHaveLength(1);

    outcome = 'ok';
    click(buttons(body)[0]!);
    await flush();
    expect(body.children_).toHaveLength(0);
  });

  it('holds a second tap while a share is still coming up', async () => {
    // WebKit refuses a second share while its sheet is animating, and that
    // refusal used to read as the browser failing — a stray download and an
    // alert over the share sheet.
    const { doc, body } = fakeDocument();
    let calls = 0;
    let finish: () => void = () => undefined;
    showReadySheet({
      title: 'x',
      choices: [{ label: 'Share…', onPress: () => { calls += 1; return new Promise<void>((r) => { finish = r; }); } }],
    }, doc);
    click(buttons(body)[0]!);
    click(buttons(body)[0]!);
    expect(calls).toBe(1);
    expect(buttons(body)[0]!.attributes_['aria-disabled']).toBe('true');
    finish();
    await flush();
    expect(body.children_).toHaveLength(0);
  });

  it('closes on Not now and on a tap outside it', () => {
    const { doc, body } = fakeDocument();
    showReadySheet({ title: 'x', choices: [] }, doc);
    click(buttons(body)[0]!); // Not now
    expect(body.children_).toHaveLength(0);

    showReadySheet({ title: 'x', choices: [] }, doc);
    const backdrop = body.children_[0]!;
    for (const fn of backdrop.listeners.click ?? []) fn({ target: backdrop });
    expect(body.children_).toHaveLength(0);
  });
});

describe('emailing a file from a browser', () => {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const keep = (name: string, value: unknown): void => { saved[name] = g[name]; g[name] = value; };
  afterEach(() => { for (const name of Object.keys(saved)) g[name] = saved[name]; });

  const pdf = { uri: 'data:application/pdf;base64,JVBERi0xLjQK', name: 'Form 72.pdf', size: 9 };

  it('is no mail app at all where there is no page', async () => {
    keep('window', undefined);
    expect(await sendMail({ to: 'a@b', subject: 's', body: 'b' }, [pdf])).toBe('no-mail-app');
  });

  it('puts the share sheet up on a phone, naming where to send it', async () => {
    const { doc, body } = fakeDocument();
    const shared: { files: File[]; title?: string }[] = [];
    keep('window', { location: { href: '' } });
    keep('document', doc);
    keep('navigator', {
      canShare: () => true,
      share: async (data: { files: File[]; title?: string }) => { shared.push(data); },
    });

    const outcome = await sendMail({ to: 'form72@example.com', subject: 'Form 72 — Tower', body: 'Attached.' }, [pdf]);
    expect(outcome).toBe('offered');
    expect(buttons(body).map((b) => b.textContent)).toEqual(['Share…', 'Open an email draft instead', 'Save to this device', 'Not now']);
    const hint = body.children_[0]!.children_[0]!.children_[1]!;
    expect(hint.textContent).toContain('send it to form72@example.com');

    click(buttons(body)[0]!);
    await flush();
    expect(shared).toHaveLength(1);
    expect(shared[0]!.title).toBe('Form 72 — Tower');
    expect(shared[0]!.files[0]!.name).toBe('Form 72.pdf');
    expect(shared[0]!.files[0]!.type).toBe('application/pdf');
  });

  it('opens a composer on a browser with no share sheet, after handing the file over', async () => {
    const { doc, body } = fakeDocument();
    const location = { href: '' };
    keep('window', { location });
    keep('document', doc);
    keep('navigator', {});
    const outcome = await sendMail({ to: 'a@b.c', subject: 'Week', body: 'x' }, [pdf]);
    expect(outcome).toBe('handed-over');
    expect(location.href).toMatch(/^mailto:a@b\.c/);
    // The download anchor was made and clicked; the sheet was not drawn.
    expect(body.children_).toHaveLength(0);
  });

  it('skips a file the browser could not write and still opens the composer', async () => {
    const location = { href: '' };
    keep('window', { location });
    keep('document', fakeDocument().doc);
    keep('navigator', { canShare: () => true, share: async () => undefined });
    const outcome = await sendMail({ to: 'a@b.c', subject: 's', body: 'b' }, [{ ...pdf, printed: true }]);
    expect(outcome).toBe('handed-over');
    expect(location.href).toMatch(/^mailto:/);
  });
});

describe('where the browser cannot make the PDF', () => {
  it('keeps the document for the printer rather than failing the button', async () => {
    // No `document` here at all, which is the limiting case of a browser that
    // cannot lay the page out. The file says so and the screens know the word.
    const file = await writePdf('Form 72 Example', '<html><body>x</body></html>');
    expect(file.printed).toBe(true);
    expect(file.name).toBe('Form 72 Example.pdf');
  });
});
