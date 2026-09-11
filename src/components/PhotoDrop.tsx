import React, { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MailComposer from 'expo-mail-composer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  MAX_PHOTOS_PER_EMAIL, PHOTO_DROP_SUBTITLE, PHOTO_DROP_TITLE, WEBSITE_PHOTOS_INBOX,
  describePick, photoDropBody, photoDropSubject,
} from '@/domain/photoDrop';
import { useTheme } from '@/theme';
import { Txt } from '@/components/ui';
import { Bounce } from '@/components/motion';
import { showAlert } from '@/components/alert';
import { describeActionFailure } from '@/domain/loadFailure';

/**
 * The big button on the front page that asks for photos for the website.
 *
 * Pick from the library, and the mail app opens addressed to Lachlan with
 * the photos attached. The phone's own mail app does the sending, so the
 * technician sees exactly what goes and can add a line. On the web build
 * there is no mail composer that can carry an attachment, so the button
 * says so and opens an addressed email instead — the photos have to be
 * dragged in by hand there, which is still better than a dead button.
 */
export function PhotoDrop({ technicianName }: { technicianName: string }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert('Permission needed', 'Safe QLD needs to see your photos to pick the ones to send.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_PER_EMAIL,
        quality: 0.85,
      });
      if (result.canceled || !result.assets.length) return;

      const pickNote = describePick(result.assets.length);
      const uris = result.assets.slice(0, pickNote.send).map((a) => a.uri);

      if (!(await MailComposer.isAvailableAsync())) {
        const subject = encodeURIComponent(photoDropSubject(technicianName, uris.length));
        const body = encodeURIComponent(photoDropBody(technicianName, uris.length));
        showAlert(
          Platform.OS === 'web' ? 'Attach them in your email' : 'No mail app set up',
          Platform.OS === 'web'
            ? `The browser cannot attach photos for you. An email to ${WEBSITE_PHOTOS_INBOX} will open; drag the photos into it.`
            : `This phone has no email account configured, so the photos cannot be sent from here. They go to ${WEBSITE_PHOTOS_INBOX}.`,
          [{ text: 'OK', onPress: () => { void Linking.openURL(`mailto:${WEBSITE_PHOTOS_INBOX}?subject=${subject}&body=${body}`).catch(() => undefined); } }],
        );
        return;
      }

      const { status } = await MailComposer.composeAsync({
        recipients: [WEBSITE_PHOTOS_INBOX],
        subject: photoDropSubject(technicianName, uris.length),
        body: photoDropBody(technicianName, uris.length, pickNote.note),
        attachments: uris,
      });
      if (status === MailComposer.MailComposerStatus.SENT) {
        showAlert('Sent', `${uris.length} photo${uris.length === 1 ? '' : 's'} on the way to ${WEBSITE_PHOTOS_INBOX}. Thanks.${pickNote.note ? `\n\n${pickNote.note}` : ''}`);
      } else {
        showAlert('Not sent', 'The email was not sent, so the photos have not gone anywhere.');
      }
    } catch (e) {
      showAlert('Could not send', describeActionFailure(e, 'sending the photos'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Bounce onPress={() => { if (!busy) void pick(); }} haptic="light" scaleTo={0.97} style={{ opacity: busy ? 0.6 : 1 }}>
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
        <MaterialCommunityIcons name="send-outline" size={22} color={t.color.onAccent} />
      </View>
    </Bounce>
  );
}
