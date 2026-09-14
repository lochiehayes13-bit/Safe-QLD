import React, { useState } from 'react';
import { View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  MAX_PHOTOS_PER_EMAIL, PHOTO_DROP_SUBTITLE, PHOTO_DROP_TITLE, WEBSITE_PHOTOS_INBOX,
  describePick, photoDropBody, photoDropSubject,
} from '@/domain/photoDrop';
import { sendMail } from '@/export/mail';
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
 * technician sees exactly what goes and can add a line. A browser cannot put
 * a photo on an email, so there the photos are handed to the person first and
 * the addressed draft opens second, with the pictures a drag away in their
 * downloads.
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
      // Named and sized the way an export is, so the mail layer can attach
      // them on a phone and hand them over in a browser without knowing they
      // came from a camera roll rather than a spreadsheet writer.
      const photos = result.assets.slice(0, pickNote.send).map((a, i) => ({
        uri: a.uri,
        name: a.fileName?.trim() || `photo-${i + 1}.jpg`,
        size: a.fileSize ?? 0,
      }));
      const many = photos.length === 1 ? '' : 's';
      const tail = pickNote.note ? `\n\n${pickNote.note}` : '';

      const outcome = await sendMail({
        to: WEBSITE_PHOTOS_INBOX,
        subject: photoDropSubject(technicianName, photos.length),
        body: photoDropBody(technicianName, photos.length, pickNote.note),
      }, photos);

      if (outcome === 'no-mail-app') {
        showAlert('No mail app set up', `This phone has no email account configured, so the photos cannot be sent from here. They go to ${WEBSITE_PHOTOS_INBOX}.`);
      } else if (outcome === 'sent') {
        showAlert('Sent', `${photos.length} photo${many} on the way to ${WEBSITE_PHOTOS_INBOX}. Thanks.${tail}`);
      } else if (outcome === 'handed-over') {
        showAlert(
          'Draft opened — drag the photos in',
          `An email to ${WEBSITE_PHOTOS_INBOX} is open and ${photos.length} photo${many} ${photos.length === 1 ? 'has' : 'have'} downloaded. Drag them onto the email and send it.${tail}`,
        );
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
