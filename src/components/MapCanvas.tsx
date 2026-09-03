import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * The map page, on a phone.
 *
 * A thin wrapper over the WebView, and the reason it exists is the browser:
 * `react-native-webview` has no web build, so on the web bundle the map area
 * renders the library's own "does not support this platform" message. Metro
 * picks `MapCanvas.web.tsx` there instead, which draws the same page in an
 * `<iframe>`. Everything the map screen does with the page — the html, the
 * messages back, the scripts pushed in — goes through the props and the handle
 * below, so the screen has one component to talk to and neither copy knows
 * about the other's platform.
 */

/** What the screen's `onMessage` reads, and all it reads: the WebView's event, narrowed. */
export interface MapCanvasMessage {
  nativeEvent: { data: string };
}

export interface MapCanvasProps {
  style?: StyleProp<ViewStyle>;
  /** The whole page, as a string. The map screen builds it with `mapHtml`. */
  source: { html: string };
  javaScriptEnabled?: boolean;
  domStorageEnabled?: boolean;
  setSupportMultipleWindows?: boolean;
  /** Appended to the User-Agent, for OpenStreetMap's tile policy. See `mapUserAgent`. */
  applicationNameForUserAgent?: string;
  /** False keeps the navigation out of the page; the screen opens the link itself. */
  onShouldStartLoadWithRequest?: (request: { url: string }) => boolean;
  onMessage?: (event: MapCanvasMessage) => void;
  onLoadEnd?: () => void;
}

export interface MapCanvasHandle {
  /**
   * Run a script in the page, the way `injectJavaScript` does: the filter, the
   * search results, the selection and the technician's dot are all pushed in
   * this way rather than by rebuilding the page, which would throw away
   * wherever they had panned to. True when there was a page to take it.
   */
  inject: (script: string) => boolean;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    style,
    source,
    javaScriptEnabled,
    domStorageEnabled,
    setSupportMultipleWindows,
    applicationNameForUserAgent,
    onShouldStartLoadWithRequest,
    onMessage,
    onLoadEnd,
  },
  ref,
) {
  const web = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    inject: (script: string) => {
      if (!web.current) return false;
      web.current.injectJavaScript(script);
      return true;
    },
  }), []);

  return (
    <WebView
      ref={web}
      style={style}
      source={source}
      javaScriptEnabled={javaScriptEnabled}
      domStorageEnabled={domStorageEnabled}
      setSupportMultipleWindows={setSupportMultipleWindows}
      applicationNameForUserAgent={applicationNameForUserAgent}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onMessage={onMessage}
      onLoadEnd={onLoadEnd}
    />
  );
});
