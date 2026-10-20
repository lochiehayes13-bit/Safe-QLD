import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { applyUpdate, onUpdateReady } from '@/web/updateSignal';
import { useTheme } from '@/theme';
import { Txt } from '@/components/ui';

/**
 * "A newer version of Safe QLD is ready", across the top of the browser.
 *
 * Twenty documents were added to the standards library, published, and the
 * owner opened the app and could not find them. The site was current; the
 * browser was serving a copy it had taken days earlier and had no way of
 * leaving. Most of that is fixed in the worker and the registration script —
 * the page asks for a new build now, and a page young enough to have nothing
 * on it takes one without being asked. This is the remaining case: the app has
 * been open a while, somebody may be part way through a form, and when to
 * reload is theirs to choose.
 *
 * It mounts in the root layout rather than on the home screen. The home screen
 * is one tab of six and a technician who opens straight into Work would never
 * see it — which is close enough to not telling them at all.
 *
 * One line, tappable, above everything. Not a card and not a dialogue: it is
 * an offer, and the person is in the middle of something.
 */
export function NewVersionStrip(): React.ReactElement | null {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => onUpdateReady(() => setReady(true)), []);

  if (!ready || dismissed) return null;

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t.color.accent,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2), paddingHorizontal: t.space(4), paddingVertical: t.space(3) }}>
        <MaterialCommunityIcons name="refresh" size={18} color={t.color.onAccent} />
        <View style={{ flex: 1 }}>
          <Txt weight="700" size="sm" style={{ color: t.color.onAccent }}>
            {stuck ? 'Reload the page to get the new version' : 'A newer version of Safe QLD is ready'}
          </Txt>
          <Txt size="xs" style={{ color: t.color.onAccent, opacity: 0.85, marginTop: 1, lineHeight: 16 }}>
            {stuck
              ? 'This browser would not hand it over on its own.'
              : 'Already downloaded. Finish what you are typing, then tap.'}
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Load the new version"
          // False means the registration script never ran — no service worker
          // support, or a browser that refused it. Say so rather than leaving
          // a button that does nothing when it is pressed.
          onPress={() => { if (!applyUpdate()) setStuck(true); }}
          style={{
            paddingHorizontal: t.space(3), paddingVertical: t.space(2),
            borderRadius: t.radius.sm, backgroundColor: t.color.onAccent,
          }}
        >
          <Txt weight="800" size="sm" style={{ color: t.color.accent }}>Load it</Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Not now"
          onPress={() => setDismissed(true)}
          hitSlop={8}
          style={{ padding: t.space(1) }}
        >
          <MaterialCommunityIcons name="close" size={18} color={t.color.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}
