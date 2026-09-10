/**
 * Nice photos of fire systems, for the website.
 *
 * The office wants pictures — a clean panel, a tidy hydrant booster, a
 * sprinkler valve set that looks like somebody cares — and the people who
 * stand in front of those things all day are the technicians. So the home
 * screen carries one big button that asks for them and sends whatever is
 * picked straight to Lachlan by email.
 *
 * Nothing here is stored on the phone and nothing goes to Simpro: this is a
 * favour to the website, not a record of work, and a photo that went to the
 * wrong place would be a photo of a customer's building in an odd inbox.
 * The address is fixed rather than a setting, because the person who set
 * this up said where they go and a technician should not have to know.
 */

export const WEBSITE_PHOTOS_INBOX = 'lachlan@safeqld.com.au';

export const PHOTO_DROP_TITLE = 'Upload nice photos of fire equipment systems here';
export const PHOTO_DROP_SUBTITLE = '(for the website etc)';

/** How many can go in one email before the mail app chokes on the size. */
export const MAX_PHOTOS_PER_EMAIL = 10;

export function photoDropSubject(technicianName: string, count: number): string {
  const who = technicianName.trim() || 'a technician';
  return `${count} photo${count === 1 ? '' : 's'} for the website — from ${who}`;
}

export function photoDropBody(technicianName: string, count: number, note?: string): string {
  const who = technicianName.trim() || 'A technician';
  const lines = [
    `${who} picked ${count} photo${count === 1 ? '' : 's'} of fire equipment on site for the website.`,
    '',
    'Sent from the Safe QLD app.',
  ];
  const n = (note ?? '').trim();
  if (n) lines.splice(1, 0, '', n);
  return lines.join('\n');
}

/**
 * What to say about a pick before it is sent.
 *
 * Over the cap it is trimmed rather than refused: ten good photos in one
 * email beats a message saying "too many" to somebody standing in a plant
 * room, and the sentence tells them what was left off.
 */
export function describePick(count: number): { send: number; note?: string } {
  if (count <= 0) return { send: 0, note: 'Nothing was picked.' };
  if (count <= MAX_PHOTOS_PER_EMAIL) return { send: count };
  return {
    send: MAX_PHOTOS_PER_EMAIL,
    note: `The first ${MAX_PHOTOS_PER_EMAIL} go in this email; pick the rest again for a second one.`,
  };
}
