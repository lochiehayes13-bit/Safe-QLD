import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { describeUpdateCheck, offeredRelease } from '@/domain/updateCheck';
import { buildInfo } from '@/update/buildInfo';
import { checkForUpdate, useUpdateCheck } from '@/update/check';
import { useTheme } from '@/theme';
import { showAlert } from '@/components/alert';

/**
 * "Is there a newer build?", asked on purpose, from the home screen.
 *
 * The banner below already appears when a newer build is known, and Settings
 * already has a button. Neither covers the thing a technician actually does:
 * standing in a car park being told over the phone that something has been
 * fixed, and wanting to know now whether their phone has it. The automatic
 * check runs at most once every six hours, so the honest answer to "has it
 * come through?" was to go three screens into Settings and look.
 *
 * So the question is on the front page, top right of the header, and pressing
 * it goes to the network whether or not a check is due.
 *
 * It reports back, which the banner cannot. A banner that stays absent is
 * indistinguishable from a check that failed, and "nothing happened" is the
 * one answer a person who deliberately pressed a button will not accept. So
 * the result is said out loud: up to date, newer available, or why not.
 *
 * The dot is the state the button carries between presses — a newer build
 * known about and not yet installed. It is drawn from the same rule the banner
 * uses, so the two can never disagree about whether there is something to
 * install.
 */
export function UpdateCheckButton(): React.ReactElement {
  const t = useTheme();
  const { record, inFlight } = useUpdateCheck();
  const build = buildInfo();
  const offered = offeredRelease(record, new Date(), build);

  const press = () => {
    void checkForUpdate({ force: true }).then((next) => {
      const release = offeredRelease(next, new Date(), build);
      if (release) {
        showAlert(
          'A newer build is available',
          'The card on the home screen downloads it. Installing it over this one loses nothing '
          + 'that is on the phone.',
        );
        return;
      }
      showAlert('Checked for updates', describeUpdateCheck(next, new Date(), build));
    });
  };

  return (
    <Pressable
      onPress={press}
      disabled={inFlight}
      accessibilityRole="button"
      accessibilityLabel={offered ? 'Check for updates — a newer build is available' : 'Check for updates'}
      accessibilityState={{ busy: inFlight }}
      hitSlop={10}
      style={{
        // The 44dp floor: pressed with gloves on, and it sits in a corner.
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {inFlight ? (
        <ActivityIndicator size="small" color={t.color.accentText} />
      ) : (
        <View>
          <MaterialCommunityIcons
            name={offered ? 'cellphone-arrow-down' : 'refresh'}
            size={20}
            color={offered ? t.color.accentText : t.color.textFaint}
          />
          {offered ? (
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
