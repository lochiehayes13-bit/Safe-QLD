import { reachabilityFailure, sendFailure } from '@/simpro/sendOutcome';
import { SIMPRO_PATHS } from '@/simpro/mirrorResources';

/**
 * What the queue does with a send that failed.
 *
 * Each wrong answer is a different loss — a photograph re-sent five times
 * over mobile data, a note stranded behind a regenerated secret, a vendor
 * order raised twice — so each answer is pinned on its own. The errors are
 * built by hand in the shape SimproError has, since the client cannot be
 * loaded here.
 */

function simproError(status: number | undefined, path?: string, message = `Simpro returned HTTP ${status}`): Error {
  const e = new Error(message) as Error & { status?: number; path?: string };
  e.name = 'SimproError';
  e.status = status;
  e.path = path;
  return e;
}

/** The client's subclasses, by the name each sets on itself; status as each carries it. */
function classed(name: 'SimproNetworkError' | 'SimproCredentialsError' | 'SimproUnreadableReply', status?: number, message: string = name): Error {
  const e = simproError(status, undefined, message);
  e.name = name;
  return e;
}

const attachment = { kind: 'attachment', jobId: '43747' };
const note = { kind: 'job-note', jobId: '43747' };

describe('sendFailure', () => {
  it('gives up on a photograph the attachment endpoint refused by body or name, once', () => {
    for (const status of [400, 413, 415, 422]) {
      const out = sendFailure(attachment, simproError(status, SIMPRO_PATHS.jobAttachments('43747')));
      expect({ status, outcome: out.outcome }).toEqual({ status, outcome: 'abandon' });
    }
  });

  it('does not give up on a 400 that came from somewhere other than the upload itself', () => {
    // The token endpoint answers 400 for a secret the office regenerated;
    // that is fixed in Settings, not by dropping the photograph. A token
    // error carries no path.
    expect(sendFailure(attachment, simproError(400)).outcome).toBe('retry');
    expect(sendFailure(attachment, simproError(422, SIMPRO_PATHS.job('43747'))).outcome).toBe('retry');
    // A note refused with 422 is not megabytes; it takes the ordinary retries.
    expect(sendFailure(note, simproError(422, SIMPRO_PATHS.jobNotes('43747'))).outcome).toBe('retry');
  });

  it('retries the answers that may clear on their own', () => {
    for (const status of [404, 409, 500, 502, 503]) {
      expect({ status, outcome: sendFailure(attachment, simproError(status, SIMPRO_PATHS.jobAttachments('43747'))).outcome })
        .toEqual({ status, outcome: 'retry' });
    }
  });

  it('stops the run, touching nothing, for the problems nothing after it would survive', () => {
    expect(sendFailure(note, simproError(401))).toMatchObject({ outcome: 'stop', why: 'credentials' });
    expect(sendFailure(note, simproError(403))).toMatchObject({ outcome: 'stop', why: 'credentials' });
    expect(sendFailure(note, simproError(429))).toMatchObject({ outcome: 'stop', why: 'throttled' });
    expect(sendFailure(note, simproError(undefined, undefined, 'No company ID is set.')))
      .toMatchObject({ outcome: 'stop', why: 'configuration', reason: 'No company ID is set.' });
  });

  it('tells the client\'s own classes apart from a plain error with the same status', () => {
    // A token fetch that never left the phone sent nothing; it stops the run
    // rather than filing the item as a request that may have landed.
    expect(sendFailure(note, classed('SimproNetworkError', undefined, 'Network request failed')))
      .toEqual({ outcome: 'stop', why: 'offline', reason: 'Network request failed' });
    // The token server's 400 for a regenerated secret is a credentials
    // problem, not a photograph refused by body — even on the upload item.
    expect(sendFailure(attachment, classed('SimproCredentialsError', 400))).toMatchObject({ outcome: 'stop', why: 'credentials' });
    expect(sendFailure(note, classed('SimproCredentialsError', 401))).toMatchObject({ outcome: 'stop', why: 'credentials' });
    // A 2xx the phone could not read is a server that acted: a person decides.
    expect(sendFailure(note, classed('SimproUnreadableReply', undefined, 'The reply could not be read')))
      .toEqual({ outcome: 'unknown', reason: 'The reply could not be read' });
  });

  it('asks a person only when a request may have arrived and no answer came', () => {
    expect(sendFailure(note, new TypeError('Network request failed'))).toEqual({ outcome: 'unknown', reason: 'Network request failed' });
    expect(sendFailure(note, new SyntaxError('Unexpected end of JSON input')).outcome).toBe('unknown');
    expect(sendFailure(note, 'a string').outcome).toBe('unknown');
  });
});

describe('reachabilityFailure', () => {
  it('stops before the first item when the office cannot be reached at all', () => {
    // A token fetch that never came back used to file the first item, and
    // every one after it, as unknown.
    expect(reachabilityFailure(new TypeError('Network request failed'))).toMatchObject({ outcome: 'stop', why: 'offline' });
    expect(reachabilityFailure(new TypeError('Network request failed'))!.reason).toContain('Network request failed');
    expect(reachabilityFailure(simproError(401))).toMatchObject({ why: 'credentials' });
    expect(reachabilityFailure(simproError(429))).toMatchObject({ why: 'throttled' });
    expect(reachabilityFailure(simproError(undefined, undefined, 'Paste the Simpro client secret in Settings.')))
      .toMatchObject({ why: 'configuration' });
  });

  it('reads the client\'s own classes the same way before the loop', () => {
    expect(reachabilityFailure(classed('SimproNetworkError', undefined, 'Network request failed'))).toMatchObject({ why: 'offline' });
    expect(reachabilityFailure(classed('SimproCredentialsError', 400))).toMatchObject({ why: 'credentials' });
    expect(reachabilityFailure(classed('SimproCredentialsError', 403))).toMatchObject({ why: 'credentials' });
    // A 2xx with an unreadable body still came from a server that answered.
    expect(reachabilityFailure(classed('SimproUnreadableReply'))).toBeUndefined();
  });

  it('lets the queue go ahead when the server answered anything else', () => {
    // A key with no permission on the probe endpoint is a server that can be reached.
    expect(reachabilityFailure(simproError(403))).toBeUndefined();
    expect(reachabilityFailure(simproError(404))).toBeUndefined();
    expect(reachabilityFailure(simproError(500))).toBeUndefined();
  });
});
