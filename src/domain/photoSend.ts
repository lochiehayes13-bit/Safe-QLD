/**
 * Getting photographs off a phone and to the office, without a mail app.
 *
 * The ask was "the photos load in the app then bang send, without them opening
 * their emails". What it did instead, in a browser, was download each picture
 * into the downloads folder and open an empty addressed draft, with an alert
 * telling the person to drag the files onto it. That is three steps and a
 * different application, and it is what this replaces.
 *
 * The plain fact underneath, said once so nobody has to rediscover it: an
 * application cannot send an email. Sending mail needs a server that speaks
 * SMTP or a provider's API, and a phone in a van has neither. Safe QLD holds
 * three credentials — the Simpro client secret, an Anthropic key and a
 * read-only GitHub token — and not one of them can put a message in an inbox.
 * Anything that claims otherwise is handing the job to somebody's mail client.
 *
 * So there are three routes, and which one is taken is decided here rather
 * than in the screen.
 *
 * **The endpoint.** Where the company has somewhere to POST to, the photos go
 * straight there and no mail app opens at all. This is the one the ask
 * describes exactly, and it is one URL in Settings away — `server/photo-relay`
 * in this repository is about forty lines and deploys free.
 *
 * **The share sheet.** Where there is no endpoint, the photos are handed to
 * the operating system with the message already written. One tap picks Mail,
 * Gmail, WhatsApp or anything else, with the pictures already attached. It is
 * not nothing-at-all, but it is one tap and the photos are on it — which is
 * the part that was broken.
 *
 * **The composer.** The phone's mail app, pre-addressed, photos attached. The
 * oldest route and still the most certain on Android, where the share sheet is
 * the same gesture with an extra choice in it.
 */

/** Where completed photographs go when there is no endpoint. */
export const WEBSITE_PHOTOS_INBOX = 'lachlan@safeqld.com.au';

export const PHOTO_DROP_TITLE = 'Upload nice photos of fire equipment systems here';
export const PHOTO_DROP_SUBTITLE = '(for the website etc)';

export type PhotoRoute =
  /** POSTed to the company's own endpoint. No mail app opens. */
  | 'endpoint'
  /** Handed to the operating system with the photos on it. One tap to anywhere. */
  | 'share'
  /** The phone's mail composer, addressed, with the photos attached. */
  | 'composer'
  /** Nowhere to send them from this device. */
  | 'nothing';

export interface RouteInput {
  /** The company's own endpoint, from Settings. Empty where there is none. */
  endpointUrl?: string;
  /** Whether this device can hand files to the operating system. */
  canShare: boolean;
  /** Whether this device has a mail app to open. */
  canCompose: boolean;
}

/**
 * Which route this device takes.
 *
 * The endpoint first wherever there is one, because it is the only route that
 * does what was actually asked for. Then the share sheet, then the composer:
 * a share sheet shows the photos before anything is sent, and a composer is
 * the older path that a person may be more used to but which commits them to
 * email.
 */
export function routeFor(input: RouteInput): PhotoRoute {
  if (validEndpoint(input.endpointUrl)) return 'endpoint';
  if (input.canShare) return 'share';
  if (input.canCompose) return 'composer';
  return 'nothing';
}

/**
 * Whether a configured endpoint is usable.
 *
 * Https only, and said here rather than trusted: these are photographs of
 * customers' buildings, and a URL typed into a settings box on a phone is
 * exactly where a plain http address gets in.
 */
export function validEndpoint(url: string | undefined): string | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** Why a configured endpoint was refused, for the Settings line. */
export function endpointProblem(url: string | undefined): string | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;
  if (validEndpoint(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:'
      ? 'That address cannot be read.'
      : 'It has to be an https address. Photographs of a customer’s building do not go over plain http.';
  } catch {
    return 'That is not a web address.';
  }
}

/** How many go at once. Past this the request gets long enough to fail on a van's signal. */
export const MAX_PHOTOS_PER_SEND = 10;

/**
 * What to say about a pick before it is sent.
 *
 * Over the cap it is trimmed rather than refused: ten good photos in one send
 * beats a message saying "too many" to somebody standing in a plant room, and
 * the sentence says what was left off.
 */
export function describePick(count: number): { send: number; note?: string } {
  if (count <= 0) return { send: 0, note: 'Nothing was picked.' };
  if (count <= MAX_PHOTOS_PER_SEND) return { send: count };
  return {
    send: MAX_PHOTOS_PER_SEND,
    note: `The first ${MAX_PHOTOS_PER_SEND} go in this one; pick the rest again for a second.`,
  };
}

export function photoSubject(technicianName: string, count: number): string {
  const who = technicianName.trim() || 'a technician';
  return `${count} photo${count === 1 ? '' : 's'} for the website — from ${who}`;
}

export function photoBody(technicianName: string, count: number, note?: string): string {
  const who = technicianName.trim() || 'A technician';
  const lines = [`${who} picked ${count} photo${count === 1 ? '' : 's'} of fire equipment on site for the website.`];
  const said = (note ?? '').trim();
  if (said) { lines.push(''); lines.push(said); }
  lines.push('');
  lines.push('Sent from the Safe QLD app.');
  return lines.join('\n');
}

/**
 * What the screen says before the button is pressed, so nobody is surprised by
 * where they end up.
 *
 * Each one names what will actually happen next, in the order it happens.
 */
export function describeRoute(route: PhotoRoute): string {
  switch (route) {
    case 'endpoint':
      return 'They go straight to the office. No email, nothing else to do.';
    case 'share':
      return `They go to ${WEBSITE_PHOTOS_INBOX}. Your phone will ask which app to send them with — `
        + 'the photos are already on it, so it is one tap.';
    case 'composer':
      return `An email to ${WEBSITE_PHOTOS_INBOX} opens with the photos attached. Press send in there.`;
    default:
      return 'This device has no way to send them: no address is set up and there is no mail app.';
  }
}

/** Why this cannot be sent yet, or null. */
export function photoSendNotReady(count: number, route: PhotoRoute): string | null {
  if (count <= 0) return 'Add a photo first.';
  if (route === 'nothing') {
    return 'There is nowhere to send them from this device. Set the photo address in Settings, or '
      + 'set up an email account on the phone.';
  }
  return null;
}

/** What the person is told afterwards. */
export function describeSent(route: PhotoRoute, count: number, note?: string): { title: string; body: string } {
  const one = count === 1;
  const many = one ? '' : 's';
  const tail = note ? `\n\n${note}` : '';
  if (route === 'endpoint') {
    return {
      title: 'Sent',
      body: `${count} photo${many} ${one ? 'is' : 'are'} with the office.${tail}`,
    };
  }
  if (route === 'share') {
    return {
      // Never "Sent": the operating system takes it from here and does not say
      // what happened next. Claiming a send this app did not see is how a
      // week's timesheet got marked submitted that nobody had sent.
      title: 'Handed over',
      body: `${count} photo${many} went to whichever app you picked. If you changed your mind, nothing was sent.${tail}`,
    };
  }
  if (route === 'composer') {
    return {
      title: 'Draft ready',
      body: `An email with ${count} photo${many} on it is open. Press send in your mail app.${tail}`,
    };
  }
  return { title: 'Not sent', body: 'Nothing left this device.' };
}
