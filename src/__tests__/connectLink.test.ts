import { buildConnectLink, linkWithoutConnection, readConnectLink } from '@/simpro/connectLink';

/**
 * The link that sets a browser up.
 *
 * Every credential below is invented. The real ones are not in this
 * repository and are not in the published app either — which is the whole
 * reason this exists rather than a key baked into the bundle.
 */

const APP = 'https://example.github.io/Safe-QLD/';
const CONNECTION = {
  domain: 'example.simprosuite.com',
  clientId: 'a1b2c3d4e5f6a7b8',
  clientSecret: 'ffee00ff11',
};

describe('a link that carries the connection', () => {
  it('comes back as what went in', () => {
    expect(readConnectLink(buildConnectLink(APP, CONNECTION))).toEqual(CONNECTION);
  });

  it('puts it after the hash, which never reaches a server', () => {
    // The reason this is not a query string. A fragment is not sent in the
    // request, so it is not in GitHub's logs, not in a proxy's, and not in a
    // Referer header to anywhere the page talks to afterwards.
    const link = buildConnectLink(APP, CONNECTION);
    expect(link.split('#')[0]).toBe(APP);
    expect(link).toContain('#connect=');
  });

  it('does not leave the secret legible in the address bar', () => {
    // Not encryption and not claimed to be — but a bar reading
    // "client_secret=ffee00ff11" is one glance or one screenshot away from
    // being copied by somebody it was never sent to.
    expect(buildConnectLink(APP, CONNECTION)).not.toContain('ffee00ff11');
  });

  it('survives the characters a messaging app breaks', () => {
    // base64url: no + and no / to be mangled, no = to be trimmed off the
    // end by something that thinks it is punctuation.
    const link = buildConnectLink(APP, { clientSecret: '??~/+abc==def/ghi+' });
    expect(link.split('#')[1]).toMatch(/^connect=[A-Za-z0-9\-_]+$/);
    expect(readConnectLink(link)?.clientSecret).toBe('??~/+abc==def/ghi+');
  });

  it('carries only the fields that were set', () => {
    // A rotated secret sent on its own. Carrying empty strings for the other
    // two would blank a working device's client ID on arrival.
    const read = readConnectLink(buildConnectLink(APP, { clientSecret: 'ffee00ff11' }));
    expect(read).toEqual({ domain: undefined, clientId: undefined, clientSecret: 'ffee00ff11' });
  });

  it('replaces an existing fragment rather than stacking one on', () => {
    const link = buildConnectLink(`${APP}#connect=old`, CONNECTION);
    expect(link.match(/#/g)).toHaveLength(1);
    expect(readConnectLink(link)).toEqual(CONNECTION);
  });
});

describe('a link that does not carry one', () => {
  it('is the ordinary case, and reads as nothing', () => {
    expect(readConnectLink(APP)).toBeUndefined();
    expect(readConnectLink(`${APP}#/work/jobs`)).toBeUndefined();
    expect(readConnectLink(`${APP}#connected-already`)).toBeUndefined();
  });

  it('reads as nothing when the link was truncated in the message', () => {
    // A long link wrapped by an email client and pasted back in halves is
    // the likeliest way this arrives broken. Half a connection is worse than
    // none: it would look connected and be refused by the office.
    const link = buildConnectLink(APP, CONNECTION);
    expect(readConnectLink(link.slice(0, link.length - 8))).toBeUndefined();
  });

  it('reads as nothing when the payload is not a connection at all', () => {
    expect(readConnectLink(`${APP}#connect=Zm9vYmFy`)).toBeUndefined();
    expect(readConnectLink(`${APP}#connect=e30`)).toBeUndefined();
  });

  it('is not confused by another parameter that starts the same way', () => {
    expect(readConnectLink(`${APP}#connection=abc`)).toBeUndefined();
  });

  it('finds it beside other fragment parameters', () => {
    const payload = buildConnectLink(APP, CONNECTION).split('#')[1]!;
    expect(readConnectLink(`${APP}#theme=dark&${payload}`)).toEqual(CONNECTION);
  });
});

describe('taking it back out of the address', () => {
  it('leaves the plain address behind', () => {
    expect(linkWithoutConnection(buildConnectLink(APP, CONNECTION))).toBe(APP);
  });

  it('keeps whatever else was in the fragment', () => {
    const payload = buildConnectLink(APP, CONNECTION).split('#')[1]!;
    expect(linkWithoutConnection(`${APP}#theme=dark&${payload}`)).toBe(`${APP}#theme=dark`);
  });

  it('leaves an address with no connection in it alone', () => {
    expect(linkWithoutConnection(APP)).toBe(APP);
    expect(linkWithoutConnection(`${APP}#/work/jobs`)).toBe(`${APP}#/work/jobs`);
  });
});
