import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PHOTO_DROP_SUBTITLE, PHOTO_DROP_TITLE } from '@/domain/photoSend';
import { useTheme } from '@/theme';
import { Txt } from '@/components/ui';
import { Bounce } from '@/components/motion';

/**
 * The big button on the front page that asks for photos for the website.
 *
 * It used to do the whole job itself: open the library and, the instant
 * anything was picked, hand it to a mail app. Nobody ever saw what they had
 * chosen, there was nowhere to write a line about it, and in a browser the
 * pictures went to the downloads folder with an empty draft and instructions
 * to drag them on.
 *
 * So it is a button again, and the screen behind it is app/photos.tsx: the
 * photos load in the app, you check them, and one send goes.
 */
export function PhotoDrop() {
  const t = useTheme();

  return (
    <Bounce onPress={() => router.push('/photos')} haptic="light" scaleTo={0.97}>
      <View
        accessibilityRole="button"
        accessibilityLabel={`${PHOTO_DROP_TITLE} ${PHOTO_DROP_SUBTITLE}`}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: t.space(3),
          backgroundColor: t.color.accent, borderRadius: t.radius.lg,
          paddingVertical: t.space(4), paddingHorizontal: t.space(4),
          minHeight: 84,
        }}
      >
        <MaterialCommunityIcons name="camera-plus-outline" size={34} color={t.color.onAccent} />
        <View style={{ flex: 1 }}>
          <Txt weight="800" size="lg" style={{ color: t.color.onAccent, letterSpacing: -0.2, lineHeight: 22 }}>
            {PHOTO_DROP_TITLE}
          </Txt>
          <Txt size="sm" weight="600" style={{ color: t.color.onAccent, opacity: 0.85, marginTop: 2 }}>
            {PHOTO_DROP_SUBTITLE} — they go straight to Lachlan
          </Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.onAccent} />
      </View>
    </Bounce>
  );
}
