/**
 * What a browser can do with a generated file, decided away from the browser.
 *
 * A page cannot write to a file system, but it can hand the person a file to
 * save and it can put a document in front of the printer — and on an iPhone,
 * "Print" is how a PDF is saved to Files or attached to a mail. So the web
 * build does produce paperwork; it produces it differently, and the difference
 * belongs in one place rather than spread across twenty screens.
 *
 * Pure on purpose: no DOM, no expo, nothing that only exists in one of the two
 * builds. The web file layer asks these functions what to do and then does it.
 */

/** How a browser should deliver a generated file. */
export type WebDelivery = 'download' | 'print';

/**
 * A PDF is printed rather than downloaded, because a browser has no PDF
 * writer: the app builds the page's HTML, and the browser's own print dialogue
 * is what turns it into a PDF — "Save as PDF" on a desktop, and on an iPhone
 * the share sheet that Print opens, which offers Files, Mail and everything
 * else. Anything already a file — a spreadsheet, a CSV, a share pack — is
 * handed over as it is.
 */
export function deliveryFor(fileName: string): WebDelivery {
  return /\.pdf$/i.test(fileName) ? 'print' : 'download';
}

/**
 * What the person is told once the browser has done its part.
 *
 * Written as what happened rather than what was attempted: a download that the
 * browser has taken is in their downloads whatever the page believes, and a
 * print dialogue that has opened is on their screen. Neither is a share sheet,
 * so neither pretends to be one.
 */
export function webShareNotice(fileName: string): { title: string; body: string } {
  if (deliveryFor(fileName) === 'print') {
    return {
      title: 'Sent to print',
      body:
        `${fileName} has been laid out and handed to the browser's print dialogue. Choose `
        + '"Save as PDF" to keep a copy — on an iPhone, Print then pinch the preview to open the '
        + 'share sheet, and it can go to Files, Mail or anywhere else.',
    };
  }
  return {
    title: 'Downloaded',
    body:
      `${fileName} has been handed to the browser, so it is with your downloads. On an iPhone `
      + 'that is Files, under Downloads, and it can be attached to a mail from there.',
  };
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
