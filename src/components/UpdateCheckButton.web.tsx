import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { askForUpdate, onUpdateReady, updateReady } from '@/web/updateSignal';
import { useTheme } from '@/theme';
import { showAlert } from '@/components/alert';

/**
 * "Is there a newer version?", asked on purpose, in a browser.
 *
 * The phone's version of this button asks GitHub about an Android package. In
 * a browser that question is nonsense — there is nothing to install a package
 * into — and the answer a person wants here is a different one: whether the
 * page they are looking at is the current build.
 *
 * So this asks the service worker instead. The registration script already
 * asks on load, every half hour, when the tab comes back to the front and when
 * the signal returns; this is the deliberate ask, for somebody who has just
 * been told something was fixed.
 *
 * The answer comes back through the same flag and event that drive the strip
 * across the top of the page, because that is the only route by which "a newer
 * version is ready" ever travels. Two routes to one fact would drift.
 *
 * It waits a few seconds for that answer rather than claiming one immediately.
 * A worker asked to look has to fetch, compare and install before it can say
 * anything, and a button that reported "you are up to date" the instant it was
 * pressed would be reporting the question, not the answer. Nothing newer
 * arriving inside the wait is reported as exactly that — nothing has come back
 * — rather than as a guarantee.
 */

/** Long enough for a worker to fetch and compare on a slow connection. */
const WAIT_MS = 6_000;

export function UpdateCheckButton(): React.ReactElement {
  const t = useTheme();
  const [ready, setReady] = useState(() => updateReady());
  const [asking, setAsking] = useState(false);
  /** Set while a press is waiting, so the arriving news can be reported to them. */
  const pressed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onUpdateReady(() => {
    setReady(true);
    if (!pressed.current) return;
    pressed.current = false;
    if (timer.current) clearTimeout(timer.current);
    setAsking(false);
    showAlert(
      'A newer version is ready',
      'The bar across the top of the page loads it. Anything you are part way through is kept — it '
      + 'is the same app, reloaded.',
    );
  }), []);

  // A press left waiting when this unmounts must not fire a timer into nothing.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const press = () => {
    if (asking) return;
    if (ready) {
      showAlert(
        'A newer version is ready',
        'The bar across the top of the page loads it.',
      );
      return;
    }
    if (!askForUpdate()) {
      /*
       * No registration script, or a browser that refused it. The app still
       * works — it is online and current whenever it is loaded by hand — and
       * that is what to say, rather than reporting a failure.
       */
      showAlert(
        'This browser cannot be asked',
        'It has no service worker running, so there is nothing here to check. Reloading the page '
        + 'gets the current version.',
      );
      return;
    }
    pressed.current = true;
    setAsking(true);
    timer.current = setTimeout(() => {
      pressed.current = false;
      setAsking(false);
      showAlert(
        'Checked for updates',
        'Nothing newer has come back. If one arrives in a moment the bar across the top of the '
        + 'page will offer it.',
      );
    }, WAIT_MS);
  };

  return (
    <Pressable
      onPress={press}
      disabled={asking}
      accessibilityRole="button"
      accessibilityLabel={ready ? 'Check for updates — a newer version is ready' : 'Check for updates'}
      accessibilityState={{ busy: asking }}
      hitSlop={10}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {asking ? (
        <ActivityIndicator size="small" color={t.color.accentText} />
      ) : (
        <View>
          <MaterialCommunityIcons
            name={ready ? 'cloud-download-outline' : 'refresh'}
            size={20}
            color={ready ? t.color.accentText : t.color.textFaint}
          />
          {ready ? (
            <View
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: t.color.accent,
              }}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
