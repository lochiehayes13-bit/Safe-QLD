/**
 * What stands in for the WebView when the map runs in a browser.
 *
 * On a phone the Leaflet page lives inside a WebView, which hands it two
 * things an ordinary page does not have: `window.ReactNativeWebView.postMessage`
 * to talk back to the app, and `injectJavaScript` to push a script in from the
 * app. In a browser the same page is an `<iframe>` and has neither, so a short
 * prelude is spliced into the front of the document that builds both out of
 * `postMessage` between the two windows. The page itself is not changed by
 * any of this: it still calls `window.ReactNativeWebView.postMessage`, and the
 * screen still reads `event.nativeEvent.data`, on both platforms.
 *
 * The parsing lives here, away from the DOM, because it is the part that has
 * to be right. Any window holding a handle on ours can post to it — another
 * tab, a script on the hosting page, a browser extension — so a message counts
 * as the map's only when it comes from the frame we put there and carries one
 * of our keys with the payload the key promises.
 */

/** Page → app: whatever the page passed to `ReactNativeWebView.postMessage`. */
export const MAP_BRIDGE_PAGE_KEY = '__safeqldMap';
/** Page → app: a link the page was about to follow, which the app opens instead. */
export const MAP_BRIDGE_NAV_KEY = '__safeqldNav';
/** App → page: a script to run, standing in for `injectJavaScript`. */
export const MAP_BRIDGE_INJECT_KEY = '__safeqldInject';

export type BridgeMessage =
  /** The page's own message, still the string the page posted; the screen parses it. */
  | { kind: 'page'; data: string }
  /** A navigation the page started, for the app to decide about. */
  | { kind: 'navigate'; url: string };

/**
 * The prelude, run before the page's own script.
 *
 * ES5 and no dependencies, so it is the same code whatever the browser, and
 * short enough to read in one go — everything it does has a counterpart the
 * WebView provides for free on a phone.
 *
 * The click handler is the navigation half. It sits in the bubble phase and
 * steps aside for an already-prevented click on purpose: the map page catches
 * its own attribution link in the capture phase and posts it as a message, so
 * this only ever sees a link nothing else handled — which, in a browser, is
 * exactly the click that would otherwise replace the map with a web page the
 * tab has no way back from.
 */
export const MAP_BRIDGE_PRELUDE = `(function () {
  function send(key, value) {
    var msg = {};
    msg[key] = value;
    parent.postMessage(msg, '*');
  }

  window.ReactNativeWebView = {
    postMessage: function (data) { send('${MAP_BRIDGE_PAGE_KEY}', String(data)); }
  };

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var script = e.data ? e.data['${MAP_BRIDGE_INJECT_KEY}'] : null;
    if (typeof script !== 'string') return;
    try {
      (0, eval)(script);
    } catch (err) {
      // Same as a WebView: a script that throws leaves the map as it was.
    }
  });

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var el = e.target;
    while (el && el !== document && !(el.tagName === 'A' && el.href)) el = el.parentNode;
    if (!el || el === document) return;
    if (!el.target && !/^https?:/i.test(el.href)) return;
    e.preventDefault();
    send('${MAP_BRIDGE_NAV_KEY}', el.href);
  }, false);
}());`;

/**
 * The page with the prelude in front of it.
 *
 * Into the `<head>`, so the bridge exists before anything the page does with
 * it — the page's script is the last thing in the body, but Leaflet's own
 * script is not, and neither is a stylesheet that could fail.
 */
export function bridgedHtml(html: string): string {
  const script = `<script>${MAP_BRIDGE_PRELUDE}</script>`;
  const head = html.search(/<head[^>]*>/i);
  if (head < 0) return script + html;
  const end = html.indexOf('>', head) + 1;
  return html.slice(0, end) + script + html.slice(end);
}

/**
 * What the page posted, or null for anything that is not one of its messages.
 *
 * The payload is checked rather than trusted, the same way `parseMapMessage`
 * checks the page's own messages: a key with the wrong sort of value under it
 * is somebody else's message that happens to share a name, and a link is only
 * a link when it is a web address.
 */
export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  const page = m[MAP_BRIDGE_PAGE_KEY];
  if (typeof page === 'string') return { kind: 'page', data: page };
  const url = m[MAP_BRIDGE_NAV_KEY];
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return { kind: 'navigate', url };
  return null;
}

/**
 * The same, for a message event, and only from the window we are listening
 * for.
 *
 * `window` receives every `postMessage` aimed at the page, whoever sent it, so
 * the sender is checked against the frame the map was put in. Without that,
 * anything else on the page — or a popup it opened — could post a site id and
 * open a customer's card, or a `https://` URL the app would then open.
 */
export function bridgeMessageFrom(event: { data: unknown; source: unknown }, frame: unknown): BridgeMessage | null {
  if (!frame || event.source !== frame) return null;
  return parseBridgeMessage(event.data);
}
