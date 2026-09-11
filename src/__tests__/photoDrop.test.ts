import {
  MAX_PHOTOS_PER_EMAIL, PHOTO_DROP_SUBTITLE, PHOTO_DROP_TITLE, WEBSITE_PHOTOS_INBOX,
  describePick, photoDropBody, photoDropSubject,
} from '@/domain/photoDrop';

/**
 * Photos for the website.
 *
 * A favour to the website, not a record of work, so the one thing that has
 * to be right is where they go and what the email says about who sent them.
 */

describe('where the photos go', () => {
  it('is Lachlan, fixed, so a technician never has to know', () => {
    expect(WEBSITE_PHOTOS_INBOX).toBe('lachlan@safeqld.com.au');
  });

  it('says on the button what it is for', () => {
    expect(PHOTO_DROP_TITLE).toBe('Upload nice photos of fire equipment systems here');
    expect(PHOTO_DROP_SUBTITLE).toBe('(for the website etc)');
  });
});

describe('the email', () => {
  it('says who and how many in the subject', () => {
    expect(photoDropSubject('Dan', 3)).toBe('3 photos for the website — from Dan');
    expect(photoDropSubject('  ', 1)).toBe('1 photo for the website — from a technician');
  });

  it('carries a note where the pick was trimmed', () => {
    const body = photoDropBody('Dan', 10, 'The first 10 go in this email; pick the rest again for a second one.');
    expect(body).toContain('Dan picked 10 photos');
    expect(body).toContain('pick the rest again');
    expect(photoDropBody('Dan', 2)).not.toContain('pick the rest');
  });
});

describe('how many go in one email', () => {
  it('trims rather than refuses, and says what was left off', () => {
    expect(describePick(3)).toEqual({ send: 3 });
    const over = describePick(MAX_PHOTOS_PER_EMAIL + 4);
    expect(over.send).toBe(MAX_PHOTOS_PER_EMAIL);
    expect(over.note).toContain(`first ${MAX_PHOTOS_PER_EMAIL}`);
  });

  it('sends nothing for nothing', () => {
    expect(describePick(0).send).toBe(0);
  });
});
