import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { MAP_BRIDGE_INJECT_KEY, bridgeMessageFrom, bridgedHtml } from '@/domain/mapBridge';
import type { MapCanvasHandle, MapCanvasProps } from './MapCanvas';

/**
 * The map page, in a browser.
 *
 * The same Leaflet page as on a phone, in an `<iframe>` instead of a WebView,
 * because `react-native-webview` has no web build: on the web bundle it
 * renders "React Native WebView does not support this platform" where the map
 * should be. The page is not changed for this — it is handed the document it
 * always gets, with a prelude in front of it that rebuilds the two things the
 * WebView was providing, `ReactNativeWebView.postMessage` out and
 * `injectJavaScript` in, out of `postMessage` between the two windows. See
 * `@/domain/mapBridge` for the prelude and for what counts as one of our
 * messages.
 *
 * Three props a browser cannot honour, kept in the shared type so the screen
 * stays one piece of code. `javaScriptEnabled` and `domStorageEnabled` are on
 * for any page in a browser and cannot be turned off; `setSupportMultipleWindows`
 * is the sandbox's business here, and the sandbox allows no new windows at
 * all. `applicationNameForUserAgent` is the OpenStreetMap tile policy, and a
 * page cannot set its own User-Agent: the browser sends its own to the tile
 * servers whatever we do. What the policy asks for — a request that says which
 * application made it and who to write to — is instead met by the app
 * identifying itself in the Referer the browser sends with every tile (the
 * host the app is served from) and by the attribution link the page carries.
 * A phone build still sends the full identifying string.
 */
export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { style, source, onShouldStartLoadWithRequest, onMessage, onLoadEnd },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  /**
   * The screen builds a fresh `onMessage` on every render, and the window
   * listener must not be torn down and put back on every keystroke in the
   * search box, so the listener is attached once and reads the current
   * handlers from here.
   */
  const handlers = useRef({ onShouldStartLoadWithRequest, onMessage });
  useEffect(() => { handlers.current = { onShouldStartLoadWithRequest, onMessage }; });

  useImperativeHandle(ref, () => ({
    inject: (script: string) => {
      const page = frame.current?.contentWindow;
      if (!page) return false;
      page.postMessage({ [MAP_BRIDGE_INJECT_KEY]: script }, '*');
      return true;
    },
  }), []);

  useEffect(() => {
    const onWindowMessage = (event: MessageEvent) => {
      const message = bridgeMessageFrom(event, frame.current?.contentWindow);
      if (!message) return;
      if (message.kind === 'page') {
        handlers.current.onMessage?.({ nativeEvent: { data: message.data } });
        return;
      }
      // A link the page would have followed. False means the screen has opened
      // it itself and the map stays put, which is what it answers for the
      // attribution; anything else means the page may go there, and it goes in
      // a new tab rather than over the top of a map with no way back.
      if (handlers.current.onShouldStartLoadWithRequest?.({ url: message.url }) === false) return;
      window.open(message.url, '_blank', 'noopener,noreferrer');
    };
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, []);

  // The page paints its own background; this is only what shows in the moment
  // before it has, so the map area is never a white flash in a dark theme.
  const flat = StyleSheet.flatten(style) ?? {};
  const background = typeof flat.backgroundColor === 'string' ? flat.backgroundColor : 'transparent';
  const html = useMemo(() => bridgedHtml(source.html), [source.html]);

  return (
    <iframe
      ref={frame}
      title="Service map"
      srcDoc={html}
      // The page runs its own script and Leaflet's, and reads the parent's
      // origin so the two windows can tell each other apart. It is given
      // nothing else: no forms, no popups, no top-level navigation.
      sandbox="allow-scripts allow-same-origin"
      onLoad={onLoadEnd}
      style={{ flex: 1, border: 0, background }}
    />
  );
});
