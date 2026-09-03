import { filesNeedThePhone, notSharedNotice } from '@/export/shareOutcome';

/**
 * The words for a file that was written and could not be passed on.
 *
 * This is the message that replaces a button doing nothing. `shareFile` returns
 * false where the platform has no share sheet — every browser, and a handset
 * with sharing switched off — and sixteen callers were dropping that answer, so
 * Export ran its spinner and stopped and the technician was left guessing.
 */
describe('a file written but not shared', () => {
  it('leads with the file, because the work is not lost', () => {
    const notice = notSharedNotice('Timesheet Jai 03-09-2026.xlsx', 'timesheet');
    expect(notice.body.startsWith('Timesheet Jai 03-09-2026.xlsx')).toBe(true);
    expect(notice.body).toMatch(/nothing has been lost/i);
  });

  it('says where sharing does live, so the next step is obvious', () => {
    // "Sharing is not available" is true and useless. The phone build is where
    // the share sheet, the mail app and the printer are.
    expect(notSharedNotice('x.pdf', 'report').body).toMatch(/phone/i);
  });

  it('names the kind of thing, so the sentence reads as English', () => {
    expect(notSharedNotice('x.pdf', 'notice').body).toContain('pass a notice on');
    expect(notSharedNotice('x.pdf').body).toContain('pass a file on');
  });

  it('is a heading and a body, not one long string', () => {
    // It goes into Alert.alert, which wants both.
    const notice = notSharedNotice('x.pdf');
    expect(notice.title).toBeTruthy();
    expect(notice.title.length).toBeLessThan(40);
  });
});

describe('a file a browser cannot produce at all', () => {
  it('says which step needs the phone, and that nothing was lost', () => {
    /*
     * `expo-file-system` on web is stubs — its own warning is "expo-file-system
     * is not supported on web" — and every export used to end as
     * `this.validatePath is not a function` in front of a technician. The
     * records are in SQLite, which does work in a browser, so the sentence has
     * to separate "no file was made" from "your work is gone".
     */
    const said = filesNeedThePhone('Producing a PDF').message;
    expect(said).toContain('Producing a PDF needs the phone app');
    expect(said).toMatch(/Nothing has been lost/);
    expect(said).toMatch(/browser/);
  });

  it('is an Error, so it lands in the catch every export already has', () => {
    expect(filesNeedThePhone('x')).toBeInstanceOf(Error);
  });
});
