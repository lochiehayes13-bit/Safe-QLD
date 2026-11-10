/**
 * What a browser can do with a generated file, decided away from the browser.
 *
 * A page cannot write to a file system, but it can hand the person a file to
 * save, it can open the operating system's share sheet with the file on it —
 * which on an iPhone is how a PDF reaches Mail, Files or Simpro in one tap —
 * and it can put a document in front of the printer. So the web build does
 * produce paperwork; it produces it differently, and the difference belongs in
 * one place rather than spread across twenty screens.
 *
 * Pure on purpose: no DOM, no expo, nothing that only exists in one of the two
 * builds. The web file layer asks these functions what to do and then does it.
 */

/**
 * How a browser should deliver a generated file.
 *
 * `offer` is the sheet of buttons the file layer draws for a PDF: share, save,
 * print. A PDF used to go straight to the printer, because a browser had no
 * PDF writer and the print dialogue was the one way to a file — and on an
 * iPhone added to the home screen that dialogue never opens at all. The web
 * build writes PDFs now (see rasterPdf.web.ts), so a PDF is a file like any
 * other, with one more thing that can be done with it. Anything already a file
 * — a spreadsheet, a CSV, a share pack — is handed to the downloads as before.
 */
export type WebDelivery = 'download' | 'offer';

export function deliveryFor(fileName: string): WebDelivery {
  return /\.pdf$/i.test(fileName) ? 'offer' : 'download';
}

/**
 * What the person is told once the browser has done its part.
 *
 * Written as what happened rather than what was attempted: a download that the
 * browser has taken is in their downloads whatever the page believes, and a
 * print dialogue that has opened is on their screen. Neither is a share sheet,
 * so neither pretends to be one. A share needs no notice: the sheet it opened
 * is the whole screen.
 */
export function webShareNotice(fileName: string, how: 'download' | 'print' | 'preview' = 'download'): { title: string; body: string } {
  if (how === 'preview') {
    // The home-screen app opens a download as a preview rather than saving
    // it. The preview's own share button is the way to Files or Mail.
    return {
      title: 'Opened as a preview',
      body:
        `${fileName} opens as a preview in this app rather than saving. Use the preview's share button to `
        + 'put it in Files or on an email, or go back and choose Share here.',
    };
  }
  if (how === 'print') {
    return {
      title: 'Sent to print',
      body:
        `${fileName} could not be written as a file in this browser, so it has been handed to the `
        + 'print dialogue instead. Choose "Save as PDF" to keep a copy — on an iPhone, Print then pinch the '
        + 'preview to open the share sheet, and it can go to Files, Mail or anywhere else.',
    };
  }
  return {
    title: 'Saved to this device',
    body:
      `${fileName} has been handed to the browser, so it is with your downloads. On an iPhone `
      + 'that is Files, under Downloads, and it can be attached to a mail from there.',
  };
}

/**
 * The one line under the title of the sheet that offers a PDF.
 *
 * Says what each button does in a technician's words, and where the file is
 * going when there is somewhere it should go — the office inbox for a Form 72,
 * the occupier for their copy — so the person picking Mail off the share sheet
 * is not left to remember the address.
 */
export function readyHint(input: { canShare: boolean; sendTo?: string; standalone?: boolean; touch?: boolean }): string {
  const where = input.touch === false ? 'any app on this computer' : 'any app on this phone';
  const share = input.canShare
    ? (input.sendTo
      ? `Share puts it straight into Mail — send it to ${input.sendTo}. `
      : `Share puts it straight into Mail, Files or ${where}. `)
    : '';
  const save = input.standalone
    ? 'Preview opens it here; its share button can save it to Files.'
    : input.canShare ? 'Save keeps a copy on this device.' : 'Download keeps a copy on this device.';
  return `${share}${save}`;
}

/**
 * The document a browser prints, around the HTML the app already builds.
 *
 * The title matters more than it looks: every browser offers it as the file
 * name when the person chooses "Save as PDF", so a report that would otherwise
 * be saved as "about:blank" or "index" arrives named after the site and the
 * date, the same as it does from a phone.
 */
export function printableDocument(title: string, html: string): string {
  const safeTitle = title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  if (/<title>/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><title>${safeTitle}</title>`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head><title>${safeTitle}</title></head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${safeTitle}</title></head><body>${html}</body></html>`;
}

/** The MIME type a Blob is given, so a saved file opens in the right thing. */
export function blobTypeFor(fileName: string): string {
  const name = fileName.toLowerCase();
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.csv')) return 'text/csv;charset=utf-8';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.html')) return 'text/html;charset=utf-8';
  if (name.endsWith('.sqld')) return 'application/octet-stream';
  return 'application/octet-stream';
}
