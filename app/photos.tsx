import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  MAX_PHOTOS_PER_SEND, WEBSITE_PHOTOS_INBOX, describePick, describeRoute, describeSent,
  photoBody, photoSendNotReady, photoSubject, routeFor, type PhotoRoute,
} from '@/domain/photoSend';
import { canSharePhotos, postPhotos, sharePhotos, shareTakesAll, type PhotoToSend } from '@/export/photos';
import { sendMail } from '@/export/mail';
import { loadPrefs } from '@/app-prefs';
import { describeActionFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Field, H2, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Photographs for the website: the whole thing, on one screen.
 *
 * The button on the home screen used to open the photo library and then, the
 * moment anything was picked, go straight to a mail app — so nobody ever saw
 * what they had chosen, and in a browser they got their pictures downloaded
 * into a folder and an empty draft with instructions to drag them onto it.
 *
 * This is what was asked for instead: the photos load in the app, you look at
 * them, you can take one off, you can write a line about them, and one button
 * sends. Where the office has an address set up, that button is the whole
 * story and no mail app opens at all. Where it has not, the photos go to the
 * operating system's share sheet already attached, which is one tap.
 *
 * Which of those happens is decided in @/domain/photoSend and said on screen
 * before the button is pressed, so nobody is surprised by where they land.
 */
export default function WebsitePhotosScreen() {
  const t = useTheme();
  const [photos, setPhotos] = useState<PhotoToSend[]>([]);
  const [note, setNote] = useState('');
  const [technician, setTechnician] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [canShare, setCanShare] = useState(false);
  /*
   * Assumed, not probed. The only way to ask whether a mail app exists is to
   * ask the composer, and asking it opens one — so a screen that checked on
   * mount would put a blank email in front of somebody who had opened the
   * photo picker. The send handles the answer instead: `no-mail-app` comes
   * back from the one call that was going to be made anyway.
   */
  const canCompose = true;
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [prefs, shareable] = await Promise.all([
        loadPrefs().catch(() => null),
        canSharePhotos().catch(() => false),
      ]);
      if (!live) return;
      if (prefs) {
        setTechnician(prefs.technicianName);
        setEndpointUrl(prefs.websitePhotoUrl);
      }
      setCanShare(shareable);
    })();
    return () => { live = false; };
  }, []);

  const route: PhotoRoute = routeFor({ endpointUrl, canShare, canCompose });

  const add = useCallback(async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert('Permission needed', 'Safe QLD needs to see your photos to pick the ones to send.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_PER_SEND,
        quality: 0.85,
      });
      if (result.canceled || !result.assets.length) return;

      setPhotos((prev) => {
        const added = result.assets.map((a, i) => ({
          uri: a.uri,
          name: a.fileName?.trim() || `photo-${prev.length + i + 1}.jpg`,
          size: a.fileSize ?? 0,
        }));
        // Adding to what is there rather than replacing it, so two trips to
        // the library is two lots of photos and not the second lot only.
        const merged = [...prev];
        for (const one of added) if (!merged.some((p) => p.uri === one.uri)) merged.push(one);
        return merged.slice(0, MAX_PHOTOS_PER_SEND);
      });
    } catch (e) {
      showAlert('Could not open your photos', describeActionFailure(e, 'opening the photo library'));
    } finally {
      setPicking(false);
    }
  }, []);

  const remove = (uri: string) => setPhotos((prev) => prev.filter((p) => p.uri !== uri));

  const blocked = photoSendNotReady(photos.length, route);

  const send = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const pick = describePick(photos.length);
      const going = photos.slice(0, pick.send);
      const subject = photoSubject(technician, going.length);
      const body = photoBody(technician, going.length, note);

      if (route === 'endpoint') {
        await postPhotos({ endpointUrl, subject, body, technicianName: technician, photos: going });
        const said = describeSent('endpoint', going.length, pick.note);
        showAlert(said.title, said.body);
        router.back();
        return;
      }

      if (route === 'share') {
        // A browser's sheet takes the whole pick; a phone's takes one file, so
        // there it is the composer that carries them all and the sheet is only
        // the fallback where there is no mail app at all.
        const shared = shareTakesAll() || photos.length === 1
          ? await sharePhotos(going, subject)
          : false;
        if (shared) {
          const said = describeSent('share', going.length, pick.note);
          showAlert(said.title, said.body);
          router.back();
          return;
        }
      }

      const outcome = await sendMail({ to: WEBSITE_PHOTOS_INBOX, subject, body }, going);
      if (outcome === 'no-mail-app') {
        showAlert(
          'Nowhere to send them',
          `This device has no email account and no photo address set up. Set one in Settings, or add a `
          + `mail account. They go to ${WEBSITE_PHOTOS_INBOX}.`,
        );
        return;
      }
      if (outcome === 'not-sent') {
        showAlert('Not sent', 'The email was not sent, so the photos have not gone anywhere.');
        return;
      }
      const said = describeSent('composer', going.length, pick.note);
      showAlert(said.title, said.body);
      router.back();
    } catch (e) {
      showAlert('Could not send them', describeActionFailure(e, 'sending the photos'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Photos for the website' }} />

      <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
        A clean panel, a tidy booster, a valve set that looks like somebody cares. Pick them, check them,
        send them.
      </Txt>

      {photos.length ? (
        <>
          <H2>{photos.length} picked</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
            {photos.map((p) => (
              <View key={p.uri} style={{ width: 104 }}>
                <Image
                  source={{ uri: p.uri }}
                  style={{ width: 104, height: 104, borderRadius: t.radius.md, backgroundColor: t.color.bgElevated }}
                  resizeMode="cover"
                  accessibilityLabel={p.name}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Take ${p.name} off`}
                  onPress={() => remove(p.uri)}
                  hitSlop={8}
                  style={{
                    position: 'absolute', top: 4, right: 4,
                    backgroundColor: t.color.bg, borderRadius: 999, padding: 2,
                  }}
                >
                  <MaterialCommunityIcons name="close-circle" size={20} color={t.color.text} />
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Button
        title={photos.length ? 'Add more' : 'Pick photos'}
        variant={photos.length ? 'secondary' : 'primary'}
        onPress={() => { void add(); }}
        loading={picking}
      />
      {photos.length >= MAX_PHOTOS_PER_SEND ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
          {MAX_PHOTOS_PER_SEND} is as many as go at once. Send these and pick the rest after.
        </Txt>
      ) : null}

      {photos.length ? (
        <>
          <H2>Anything to say about them</H2>
          <Card>
            <Field
              label="Optional"
              value={note}
              onChangeText={setNote}
              placeholder="Booster at the Wickham Street job, done Tuesday"
              multiline
            />
          </Card>

          <Card>
            <Rowed gap={2} align="flex-start">
              <MaterialCommunityIcons
                name={route === 'endpoint' ? 'cloud-upload-outline' : 'share-variant-outline'}
                size={20}
                color={t.color.accentText}
              />
              <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{describeRoute(route)}</Txt>
            </Rowed>
          </Card>
        </>
      ) : null}

      {route === 'nothing' && photos.length ? (
        <Banner
          tone="warn"
          title="Nowhere to send them from this device"
          body={'No photo address is set up in Settings and there is no mail app on this device. '
            + 'Either fixes it; the address is the one that needs no email at all.'}
        />
      ) : null}

      <View style={{ height: t.space(2) }} />
      <Button
        title={photos.length > 1 ? `Send ${photos.length} photos` : 'Send it'}
        onPress={() => { void send(); }}
        loading={busy}
        disabled={!!blocked}
      />
      {blocked ? (
        <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>{blocked}</Txt>
      ) : null}
    </Screen>
  );
}
