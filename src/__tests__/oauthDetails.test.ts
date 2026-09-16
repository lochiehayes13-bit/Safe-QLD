import { describePastedConnection, readPastedConnection } from '@/simpro/oauthDetails';

/**
 * Reading the block Simpro hands out when an API key is made.
 *
 * Every fixture here is in the shape of the real page — the rule lines, the
 * documentation link, the stray closing script tag that comes with a
 * copy-and-paste out of the browser — with invented credentials. The real
 * ones are not in this repository and never will be.
 */

const page = (id: string, secret: string) => `====================================================================

oAuth2 Details for Safe QLD Fire Protection - Operations Dashboard
See our documentation at: http://developer.simprogroup.com/apidoc/?page=client_id#tag/Authentication

====================================================================

Type: Client Credentials
Token URL: https://safeqld.simprosuite.com/oauth2/token

client_id: ${id}
client_secret: ${secret}
grant_type: client_credentials
<script type="text/javascript" defer>loadPage("system-setup");</script>`;

describe('a pasted oAuth2 details block', () => {
  const read = () => readPastedConnection(page('a1b2c3d4e5f6a7b8', 'ffee00ff11'));

  it('takes the client ID', () => {
    expect(read().found.clientId).toBe('a1b2c3d4e5f6a7b8');
  });

  it('takes the client secret', () => {
    expect(read().found.clientSecret).toBe('ffee00ff11');
  });

  it('takes the build domain out of the token URL', () => {
    expect(read().found.domain).toBe('safeqld.simprosuite.com');
  });

  it('never takes the documentation link as the build', () => {
    // The link at the top of the page is on Simpro's own documentation site
    // and contains the words "client" and "id". Pointing the app at it would
    // send every request for four thousand jobs to a documentation server.
    expect(read().found.domain).not.toContain('simprogroup');
  });

  it('says what it read, so somebody can see the secret landed', () => {
    expect(describePastedConnection(read()))
      .toBe('Read the build domain, client ID and client secret out of that.'
        + ' The secret went straight to this device’s keystore, not into ordinary storage.');
  });
});

describe('the shapes it arrives in', () => {
  it('reads it out of an email with the fields quoted', () => {
    const r = readPastedConnection('client_id = "abc123def456"\nclient_secret = "998877ff"');
    expect(r.found.clientId).toBe('abc123def456');
    expect(r.found.clientSecret).toBe('998877ff');
  });

  it('reads it out of JSON', () => {
    const r = readPastedConnection('{\n "client_id": "abc123def456",\n "client_secret": "998877ff"\n}');
    expect(r.found.clientId).toBe('abc123def456');
    expect(r.found.clientSecret).toBe('998877ff');
  });

  it('reads "Client ID" and "Client Secret" with a space and a capital', () => {
    const r = readPastedConnection('Client ID: abc123def456\nClient Secret: 998877ff');
    expect(r.found.clientId).toBe('abc123def456');
    expect(r.found.clientSecret).toBe('998877ff');
  });

  it('reads the token URL of a build on its own domain', () => {
    const r = readPastedConnection('Token URL: https://simpro.safeqld.com.au/oauth2/token\nclient_id: abc123def456');
    expect(r.found.domain).toBe('simpro.safeqld.com.au');
  });
});

describe('what it refuses to guess', () => {
  it('takes nothing at all from an empty paste', () => {
    const r = readPastedConnection('   ');
    expect(r.found).toEqual({});
    expect(r.problem).toBe('Nothing was pasted.');
  });

  it('takes nothing from text that has none of the three in it', () => {
    // Somebody pastes the wrong thing off the clipboard. Filling three
    // fields with fragments of it is worse than filling none: the
    // connection then fails with the office rejecting the device, and the
    // fields look filled in.
    const r = readPastedConnection('Hi Lochie, can you look at the panel at Bowen Hills tomorrow morning?');
    expect(r.found).toEqual({});
    expect(r.problem).toContain('no client ID, client secret or token URL');
  });

  it('refuses a client id that is a sentence rather than a token', () => {
    const r = readPastedConnection('client_id: ask Sarah for this\nclient_secret: 998877ff');
    expect(r.found.clientId).toBeUndefined();
    expect(r.found.clientSecret).toBe('998877ff');
  });

  it('leaves out a field the block does not mention', () => {
    // A half block is normal — a rotated secret is sent on its own. What it
    // does not carry must not come back as an empty string, because the
    // screen writes what comes back over what is already set.
    const r = readPastedConnection('client_secret: 998877ff');
    expect(r.found.clientId).toBeUndefined();
    expect(r.found.domain).toBeUndefined();
    expect(r.found.clientSecret).toBe('998877ff');
    expect(r.fields).toEqual(['client secret']);
  });

  it('says so plainly when only the secret came through', () => {
    expect(describePastedConnection(readPastedConnection('client_secret: 998877ff')))
      .toContain('Read the client secret out of that.');
  });

  it('does not mention the keystore when no secret was in the paste', () => {
    expect(describePastedConnection(readPastedConnection('client_id: abc123def456')))
      .toBe('Read the client ID out of that.');
  });
});
