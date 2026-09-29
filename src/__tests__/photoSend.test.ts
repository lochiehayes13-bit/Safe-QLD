import {
  MAX_PHOTOS_PER_SEND, PHOTO_DROP_SUBTITLE, PHOTO_DROP_TITLE, WEBSITE_PHOTOS_INBOX,
  describePick, describeRoute, describeSent, endpointProblem, photoBody, photoSendNotReady,
  photoSubject, routeFor, validEndpoint,
} from '@/domain/photoSend';

/**
 * Photographs for the website, and how they get off the phone.
 *
 * What was shipped before downloaded every picture into a downloads folder and
 * opened an empty addressed draft with an alert telling the person to drag the
 * files onto it. The ask was "the photos load in the app then bang send,
 * without them opening their emails", so most of what is tested here is the
 * choice of route: which one this device takes, and — just as much — what the
 * person is told is about to happen, because the one thing worse than a mail
 * app opening is a mail app opening when the screen promised it would not.
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

describe('which route this device takes', () => {
  it('takes the endpoint wherever there is one, because it is the only route with no mail app in it', () => {
    expect(routeFor({ endpointUrl: 'https://photos.safeqld.com.au/drop', canShare: true, canCompose: true }))
      .toBe('endpoint');
    // Even where the device can do neither of the other two.
    expect(routeFor({ endpointUrl: 'https://photos.safeqld.com.au/drop', canShare: false, canCompose: false }))
      .toBe('endpoint');
  });

  it('prefers the share sheet to the composer, because it shows the photos before anything is sent', () => {
    expect(routeFor({ canShare: true, canCompose: true })).toBe('share');
  });

  it('falls back to the composer, then to nothing at all', () => {
    expect(routeFor({ canShare: false, canCompose: true })).toBe('composer');
    expect(routeFor({ canShare: false, canCompose: false })).toBe('nothing');
  });

  it('does not treat an unusable endpoint as an endpoint', () => {
    // The whole point of validating: a typo in Settings must fall through to a
    // route that works, not strand the send on an address that cannot be
    // posted to.
    expect(routeFor({ endpointUrl: 'photos.safeqld', canShare: true, canCompose: true })).toBe('share');
    expect(routeFor({ endpointUrl: '   ', canShare: false, canCompose: true })).toBe('composer');
  });
});

describe('the endpoint address', () => {
  it('takes an https address, trimmed', () => {
    expect(validEndpoint('  https://photos.safeqld.com.au/drop  ')).toBe('https://photos.safeqld.com.au/drop');
  });

  it('refuses plain http, because these are photographs of a customer’s building', () => {
    expect(validEndpoint('http://photos.safeqld.com.au/drop')).toBeNull();
    expect(endpointProblem('http://photos.safeqld.com.au/drop')).toContain('https');
  });

  it('refuses anything that is not a web address, and says which it was', () => {
    expect(validEndpoint('photos.safeqld.com.au')).toBeNull();
    expect(endpointProblem('photos.safeqld.com.au')).toBe('That is not a web address.');
  });

  it('says nothing at all about an empty box', () => {
    // Not an error: most installs have no endpoint and take the share sheet.
    expect(validEndpoint('')).toBeNull();
    expect(validEndpoint(undefined)).toBeNull();
    expect(endpointProblem('')).toBeNull();
    expect(endpointProblem(undefined)).toBeNull();
    expect(endpointProblem('https://photos.safeqld.com.au/drop')).toBeNull();
  });
});

describe('what the screen says before the button is pressed', () => {
  it('promises no mail app only on the route that opens none', () => {
    expect(describeRoute('endpoint')).toMatch(/no email/i);
    expect(describeRoute('endpoint')).toContain('straight to the office');
  });

  it('says a mail app is coming on the two routes that end in one', () => {
    expect(describeRoute('share')).toContain(WEBSITE_PHOTOS_INBOX);
    expect(describeRoute('share')).toMatch(/ask which app/i);
    expect(describeRoute('composer')).toContain(WEBSITE_PHOTOS_INBOX);
    expect(describeRoute('composer')).toMatch(/opens with the photos attached/i);
  });

  it('says plainly when there is nowhere to send from', () => {
    expect(describeRoute('nothing')).toMatch(/no way to send/i);
  });
});

describe('what the person is told afterwards', () => {
  it('claims a send only where this app saw one', () => {
    expect(describeSent('endpoint', 3).title).toBe('Sent');
  });

  it('never claims a send the operating system took over', () => {
    // A share sheet does not report back. Saying "Sent" for one is how a
    // week's timesheet got marked submitted that nobody had sent.
    const said = describeSent('share', 3);
    expect(said.title).not.toBe('Sent');
    expect(said.body).toMatch(/if you changed your mind, nothing was sent/i);
  });

  it('tells the composer route there is still a button to press', () => {
    expect(describeSent('composer', 2).body).toMatch(/press send/i);
  });

  it('counts one photo as one', () => {
    expect(describeSent('endpoint', 1).body).toContain('1 photo is');
    expect(describeSent('endpoint', 2).body).toContain('2 photos are');
  });

  it('carries the trimming note through to the end', () => {
    expect(describeSent('endpoint', 10, 'The rest need a second send.').body)
      .toContain('The rest need a second send.');
  });
});

describe('the email, where one is written', () => {
  it('says who and how many in the subject', () => {
    expect(photoSubject('Dan', 3)).toBe('3 photos for the website — from Dan');
    expect(photoSubject('  ', 1)).toBe('1 photo for the website — from a technician');
  });

  it('carries what the technician wrote about them', () => {
    const body = photoBody('Dan', 10, 'Booster at the Wickham Street job.');
    expect(body).toContain('Dan picked 10 photos');
    expect(body).toContain('Booster at the Wickham Street job.');
    expect(photoBody('Dan', 2)).not.toContain('Booster');
  });

  it('does not leave a blank gap where nothing was written', () => {
    expect(photoBody('Dan', 2, '   ')).toBe(photoBody('Dan', 2));
  });
});

describe('how many go at once', () => {
  it('trims rather than refuses, and says what was left off', () => {
    expect(describePick(3)).toEqual({ send: 3 });
    const over = describePick(MAX_PHOTOS_PER_SEND + 4);
    expect(over.send).toBe(MAX_PHOTOS_PER_SEND);
    expect(over.note).toContain(`first ${MAX_PHOTOS_PER_SEND}`);
  });

  it('sends nothing for nothing', () => {
    expect(describePick(0).send).toBe(0);
  });
});

describe('why a send is blocked', () => {
  it('asks for a photo first', () => {
    expect(photoSendNotReady(0, 'share')).toBe('Add a photo first.');
  });

  it('names both ways out where the device has no route', () => {
    const why = photoSendNotReady(2, 'nothing');
    expect(why).toContain('Settings');
    expect(why).toMatch(/email account/i);
  });

  it('blocks nothing where there is a route and a photo', () => {
    expect(photoSendNotReady(2, 'endpoint')).toBeNull();
    expect(photoSendNotReady(1, 'share')).toBeNull();
    expect(photoSendNotReady(1, 'composer')).toBeNull();
  });
});
