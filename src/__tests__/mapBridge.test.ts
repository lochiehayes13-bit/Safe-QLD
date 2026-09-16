import {
  MAP_BRIDGE_INJECT_KEY, MAP_BRIDGE_NAV_KEY, MAP_BRIDGE_PAGE_KEY, MAP_BRIDGE_PRELUDE,
  bridgeMessageFrom, bridgedHtml, parseBridgeMessage,
} from '@/domain/mapBridge';

/**
 * The bridge that stands in for the WebView in a browser.
 *
 * What is worth testing here is the door, not the plumbing. In a WebView the
 * app is the only thing that can talk to the page and the page the only thing
 * that can talk back; in a browser, `window.postMessage` is open to every
 * frame, tab and extension on the page, and the map's messages open customer
 * cards and hand URLs to the app to open. So the checks below are the two that
 * keep somebody else's message out: it has to come from the frame the map was
 * put in, and it has to carry the payload its key promises.
 */

/** A message as `window` delivers it, from the frame the map is in. */
const FRAME = { name: 'the map frame' };
const from = (data: unknown, source: unknown = FRAME) => bridgeMessageFrom({ data, source }, FRAME);

describe('a message from the page', () => {
  it('is the page\'s own string, handed on untouched for the screen to parse', () => {
    // Deliberately not parsed here: the screen's parseMapMessage is the one
    // check on what the page says, on both platforms, and two would drift.
    expect(from({ [MAP_BRIDGE_PAGE_KEY]: '{"type":"select","siteId":"s1"}' }))
      .toEqual({ kind: 'page', data: '{"type":"select","siteId":"s1"}' });
  });

  it('is the payload check on its own when there is no window to check', () => {
    // parseBridgeMessage is the half a test can hold: what a message has to
    // look like. bridgeMessageFrom is that plus who it came from.
    expect(parseBridgeMessage({ [MAP_BRIDGE_PAGE_KEY]: 'ours' })).toEqual({ kind: 'page', data: 'ours' });
    expect(parseBridgeMessage({ [MAP_BRIDGE_PAGE_KEY]: 7 })).toBeNull();
  });

  it('is refused when it comes from another window', () => {
    const elsewhere = { name: 'a popup, or the page hosting us' };
    expect(from({ [MAP_BRIDGE_PAGE_KEY]: '{"type":"clear"}' }, elsewhere)).toBeNull();
    // And refused when there is no frame yet to have sent it, rather than
    // matching an undefined source against an undefined frame.
    expect(bridgeMessageFrom({ data: { [MAP_BRIDGE_PAGE_KEY]: 'x' }, source: undefined }, undefined)).toBeNull();
  });

  it('is refused when the payload is not a string', () => {
    // A frame can post any structured value, and everything downstream of
    // here assumes a string it can JSON.parse.
    expect(from({ [MAP_BRIDGE_PAGE_KEY]: { type: 'select', siteId: 's1' } })).toBeNull();
    expect(from({ [MAP_BRIDGE_PAGE_KEY]: 42 })).toBeNull();
    expect(from({ [MAP_BRIDGE_PAGE_KEY]: null })).toBeNull();
  });

  it('is refused when it is not one of ours at all', () => {
    // Other libraries post through the same window. React Native Web's own
    // dev tooling and every browser extension are on this channel.
    expect(from({ type: 'webpackOk' })).toBeNull();
    expect(from('a plain string')).toBeNull();
    expect(from(null)).toBeNull();
  });
});

describe('a navigation the page started', () => {
  it('is recognised, so the app can decide where the link opens', () => {
    expect(from({ [MAP_BRIDGE_NAV_KEY]: 'https://www.openstreetmap.org/copyright' }))
      .toEqual({ kind: 'navigate', url: 'https://www.openstreetmap.org/copyright' });
  });

  it('is refused unless it is a web address', () => {
    // The app answers a navigate message by opening the URL. A javascript:
    // or data: URL handed to the phone's browser is a different thing
    // entirely from the attribution link this exists for.
    expect(from({ [MAP_BRIDGE_NAV_KEY]: 'javascript:alert(1)' })).toBeNull();
    expect(from({ [MAP_BRIDGE_NAV_KEY]: 'data:text/html,<h1>hi</h1>' })).toBeNull();
    expect(from({ [MAP_BRIDGE_NAV_KEY]: ['https://example.com'] })).toBeNull();
  });
});

describe('the prelude', () => {
  it('gives the page the two things the WebView was giving it', () => {
    expect(MAP_BRIDGE_PRELUDE).toContain('window.ReactNativeWebView');
    // The keys the parser above reads are the keys the page posts. They are
    // written once and interpolated, and this is what says so.
    expect(MAP_BRIDGE_PRELUDE).toContain(MAP_BRIDGE_PAGE_KEY);
    expect(MAP_BRIDGE_PRELUDE).toContain(MAP_BRIDGE_NAV_KEY);
    expect(MAP_BRIDGE_PRELUDE).toContain(MAP_BRIDGE_INJECT_KEY);
  });

  it('takes a script only from the window above it', () => {
    // The other half of the door: the page evals what it is sent, so it may
    // only take it from the app.
    expect(MAP_BRIDGE_PRELUDE).toContain('e.source !== parent');
  });

  it('carries nothing that would end the script block it is written into', () => {
    // It is spliced into a document as a <script>. A stray closing tag would
    // hand the rest of the bridge to the HTML parser as markup.
    expect(MAP_BRIDGE_PRELUDE).not.toContain('<');
  });
});

describe('the page with the bridge in front of it', () => {
  const PAGE = [
    '<!doctype html>', '<html>', '<head>', '<meta charset="utf-8">', '</head>',
    '<body><script>var page = 1;</script></body>', '</html>',
  ].join('\n');

  it('runs before anything in the page, including the stylesheet', () => {
    const out = bridgedHtml(PAGE);
    expect(out.indexOf(MAP_BRIDGE_PRELUDE)).toBeLessThan(out.indexOf('<meta charset'));
    expect(out.indexOf(MAP_BRIDGE_PRELUDE)).toBeLessThan(out.indexOf('var page = 1;'));
    // And the page itself is untouched, so the phone and the browser are
    // drawing the same document.
    expect(out).toContain('var page = 1;');
    expect(out).toContain('<!doctype html>');
  });

  it('still bridges a document with no head to put it in', () => {
    expect(bridgedHtml('<body>bare</body>')).toContain(MAP_BRIDGE_PRELUDE);
  });
});
