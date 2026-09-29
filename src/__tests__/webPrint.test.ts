/**
 * The one part of the browser file layer that cannot be reasoned about from
 * the code alone: putting a document in front of the printer. On an iPhone
 * that is the whole point — Print is how a service report becomes a PDF in
 * Files or an attachment on a mail — and it is done with a hidden iframe
 * rather than a new window, because a window opened after an await is a pop-up
 * as far as the browser is concerned and is blocked without a word.
 *
 * A stand-in document rather than a real browser, so the sequence is pinned:
 * built, filled, attached, printed once the browser has laid it out, and taken
 * away afterwards rather than left in the page.
 */
import { printHtml, type PrintDocument, type PrintFrame } from '@/export/files.web';

function fakeDocument(): { doc: PrintDocument; frames: PrintFrame[]; attached: PrintFrame[]; printed: string[] } {
  const frames: PrintFrame[] = [];
  const attached: PrintFrame[] = [];
  const printed: string[] = [];
  const doc: PrintDocument = {
    createElement: () => {
      const frame: PrintFrame = {
        setAttribute: () => undefined,
        style: { cssText: '' },
        srcdoc: '',
        onload: null,
        contentWindow: {
          focus: () => undefined,
          print: () => printed.push(frame.srcdoc),
        },
        remove: () => {
          const at = attached.indexOf(frame);
          if (at >= 0) attached.splice(at, 1);
        },
      };
      frames.push(frame);
      return frame;
    },
    body: { appendChild: (frame) => attached.push(frame) },
  };
  return { doc, frames, attached, printed };
}

describe('printing in a browser', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('puts the document in a frame of its own and prints it once the browser has it', () => {
    const { doc, frames, attached, printed } = fakeDocument();
    const html = '<html><head><title>Service report</title></head><body>Fictional Tower</body></html>';

    expect(printHtml(html, doc)).toBe(true);
    expect(frames).toHaveLength(1);
    expect(attached).toHaveLength(1);
    expect(frames[0]!.srcdoc).toBe(html);

    // Nothing is printed before the browser says the document is laid out:
    // printing an empty frame prints an empty page.
    expect(printed).toEqual([]);
    frames[0]!.onload?.();
    expect(printed).toEqual([html]);
  });

  it('leaves the frame in place while the dialogue is open, then takes it away', () => {
    const { doc, frames, attached } = fakeDocument();
    printHtml('<p>x</p>', doc);
    frames[0]!.onload?.();

    // Removing it while the dialogue is still up prints a blank page.
    expect(attached).toHaveLength(1);
    jest.advanceTimersByTime(59_000);
    expect(attached).toHaveLength(1);
    jest.advanceTimersByTime(2_000);
    expect(attached).toHaveLength(0);
  });

  it('says so rather than throwing when the browser will not have it', () => {
    const doc = { createElement: () => { throw new Error('blocked'); }, body: { appendChild: () => undefined } } as unknown as PrintDocument;
    expect(printHtml('<p>x</p>', doc)).toBe(false);
  });

  it('does not print a frame the browser never gave a window', () => {
    const { doc, frames, printed } = fakeDocument();
    printHtml('<p>x</p>', doc);
    frames[0]!.contentWindow = null;
    expect(() => frames[0]!.onload?.()).not.toThrow();
    expect(printed).toEqual([]);
  });
});
