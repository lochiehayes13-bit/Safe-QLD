import React, { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatBuildMoment, offeredRelease } from '@/domain/updateCheck';
import { checkForUpdate, snoozeUpdate, useUpdateCheck } from '@/update/check';
import { formatBytes } from '@/share/pack';
import { useTheme } from '@/theme';
import { Button, Card, Rowed, Txt } from '@/components/ui';

/**
 * "A newer build is available", on the home screen.
 *
 * Renders nothing until a newer build is known for certain — the domain rule
 * never says newer on a guess — and then a card with the brand colour round
 * it, since it is the one thing on the screen asking to be pressed. Mounting
 * it is what runs the check, throttled to once every six hours by the runner.
 *
 * Download opens the APK's URL in the phone's browser, which downloads it and
 * offers to install it. That works only while the URL is on a public
 * repository: on the private one the browser lands on a GitHub login page
 * instead, and technicians do not have a GitHub login. That is why CI mirrors
 * the file to a public releases repository and the build is pointed at that.
 */
export function UpdateBanner(): React.ReactElement | null {
  const t = useTheme();
  const { record } = useUpdateCheck();

  useEffect(() => {
    void checkForUpdate();
  }, []);

  const release = offeredRelease(record, new Date());
  if (!release?.apkUrl) return null;
  const url = release.apkUrl;
  const when = formatBuildMoment(release.publishedAt);

  return (
    <Card style={{ borderWidth: 1, borderColor: t.color.accent }}>
      <Rowed gap={3} align="flex-start">
        <MaterialCommunityIcons name="cellphone-arrow-down" size={22} color={t.color.accentText} />
        <View style={{ flex: 1 }}>
          <Txt weight="700">New build available{when ? ` · built ${when}` : ''}</Txt>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>
            Tap to download it, then open the file when it finishes and install over this one. Nothing
            on the phone is lost.
            {release.sizeBytes ? ` About ${formatBytes(release.sizeBytes)}.` : ''}
          </Txt>
        </View>
      </Rowed>
      <View style={{ height: t.space(3) }} />
      <Rowed gap={2}>
        <Button
          title="Download and install"
          style={{ flex: 1 }}
          onPress={() => {
            void Linking.openURL(url).catch(() => undefined);
          }}
        />
        <Button
          title="Not now"
          variant="ghost"
          onPress={() => {
            void snoozeUpdate();
          }}
        />
      </Rowed>
    </Card>
  );
}
