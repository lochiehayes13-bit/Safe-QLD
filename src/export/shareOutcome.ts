/**
 * What to say when a file was written and the device would not pass it on.
 *
 * `shareFile` has always returned false rather than throwing when the platform
 * has no share sheet — which is right, because the file itself was written and
 * nothing is wrong. What was wrong is that sixteen of the seventeen callers
 * dropped that answer on the floor: `await shareFile(file, 'Timesheet')`, no
 * result read, no message. Press Export, watch the spinner run and stop, and
 * nothing happens. Not an error, not a share sheet — nothing. A technician
 * presses it three more times and then rings the office to say the app is
 * broken, and the app is not broken; it is silent, which on a job is worse.
 *
 * So the outcome gets words. The file exists and is named, so the sentence
 * leads with that — the work is not lost, it is on the phone — and then says
 * plainly that sharing it is a thing this device cannot do.
 *
 * Pure on purpose: no expo, no react-native, nothing that could itself be the
 * reason there is no share sheet.
 */

/**
 * Why a file cannot be produced at all in a browser.
 *
 * `expo-file-system`'s web module is stubs — its own words are "expo-file-system
 * is not supported on web" — and `expo-print`'s `printToFileAsync` calls
 * `window.print()` and returns nothing. So on the build that reaches an iPhone,
 * every spreadsheet, every PDF and every share pack fails, and until this was
 * written it failed with `this.validatePath is not a function` or `Cannot
 * destructure property 'uri' of undefined`. Both are true and neither is
 * something to read on a roof.
 *
 * The sentence says the two things that matter: nothing was produced, and
 * nothing typed in was lost. The records live in the app's database, which does
 * work in a browser — it is the file layer that does not.
 */
export function filesNeedThePhone(what: string): Error {
  return new Error(
    `${what} needs the phone app. A browser gives a page no way to write a file, print one or `
    + 'open a share sheet, so nothing was produced. Nothing has been lost — everything on this '
    + 'screen is saved, and the same screen in the phone app will produce it.',
  );
}

export interface ShareNotice {
  title: string;
  body: string;
}

/**
 * The notice for a file that was written but not offered on.
 *
 * `where` names what would normally take it — the share sheet on a handset,
 * and nothing at all in a browser, where every file API this app uses is
 * either absent or refused. Saying which one keeps the message true on both.
 */
export function notSharedNotice(fileName: string, what = 'file'): ShareNotice {
  return {
    title: 'Saved, not shared',
    body:
      `${fileName} was written to this device, so nothing has been lost. This device has no way `
      + `to pass a ${what} on, though — the share sheet, the mail app and the printer are all on `
      + `the phone build, and a browser has none of them. Open this screen on the phone to send it.`,
  };
}
