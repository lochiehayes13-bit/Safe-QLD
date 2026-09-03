import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import {
  LEAVE_TYPES, leaveBody, leaveNotReady, leaveSubject, parseAuDate, workingDays, type LeaveRequest,
} from '@/domain/requests';
import { TIMESHEET_INBOX } from '@/domain/timesheetEmail';
import { useTheme } from '@/theme';
import { Button, Card, Field, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * A leave request.
 *
 * Emailed to the supervisor with accounts copied in, because a day off is both
 * a roster question and a payroll one and the two offices do not always talk.
 * The body says plainly that it is a request, not an approval — an email that
 * reads like a confirmation is how someone books a flight before anyone has
 * said yes.
 */
export default function LeaveRequestScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [leaveType, setLeaveType] = useState('Annual');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  const fromDate = useMemo(() => parseAuDate(fromText), [fromText]);
  // A single day is the common case, so an empty "to" means the same day.
  const toDate = useMemo(() => (toText.trim() ? parseAuDate(toText) : fromDate), [toText, fromDate]);
  const days = fromDate && toDate ? workingDays(fromDate, toDate) : 0;

  const request = (): LeaveRequest => ({
    technicianName: prefs?.technicianName ?? '',
    leaveType,
    fromDate: fromDate ?? '',
    toDate: toDate ?? '',
    reason,
  });

  const send = async () => {
    if (!prefs) return;
    if (fromText.trim() && !fromDate) {
      showAlert('Check the first day', 'Write it as day/month/year, like 7/9/2026.');
      return;
    }
    if (toText.trim() && !toDate) {
      showAlert('Check the last day', 'Write it as day/month/year, like 11/9/2026.');
      return;
    }
    const r = request();
    const blocked = leaveNotReady(r);
    if (blocked) {
      showAlert('Not ready to send', blocked);
      return;
    }
    if (!prefs.supervisorEmail.trim()) {
      showAlert('No supervisor address', 'Set where requests go in Settings first.');
      return;
    }
    setBusy(true);
    try {
      if (!(await MailComposer.isAvailableAsync())) {
        showAlert('No mail app set up', 'This phone has no email account configured, so the request cannot be sent from here.');
        return;
      }
      const { status } = await MailComposer.composeAsync({
        recipients: [prefs.supervisorEmail.trim()],
        ccRecipients: [TIMESHEET_INBOX],
        subject: leaveSubject(r),
        body: leaveBody(r),
      });
      if (status === MailComposer.MailComposerStatus.SENT) {
        showAlert('Sent', `Your request has gone to ${prefs.supervisorEmail}, with ${TIMESHEET_INBOX} copied in. It is a request until someone says yes.`, [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        showAlert('Not sent', 'The email was not sent. Nothing has reached the office.');
      }
    } catch (e) {
      showAlert('Could not send', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Leave request' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          Goes to {prefs?.supervisorEmail || 'the supervisor address in Settings'}, with accounts copied
          in. This asks; it does not approve.
        </Txt>

        {prefs && !prefs.technicianName.trim() ? (
          <Card onPress={() => router.push('/settings')}>
            <Txt weight="700">Set your name first</Txt>
            <Txt size="sm" tone="muted">A leave request with no name on it cannot be filed against anyone.</Txt>
          </Card>
        ) : null}

        <Card>
          <Segmented options={LEAVE_TYPES.map((l) => ({ value: l.value, label: l.label }))} value={leaveType} onChange={setLeaveType} />
        </Card>

        <Card>
          {/* The default keyboard, not the numeric one: the date wants slashes, and the number pad has none. */}
          <Field label="First day" value={fromText} onChangeText={setFromText} placeholder="7/9/2026" />
          <View style={{ height: t.space(2.5) }} />
          <Field label="Last day" value={toText} onChangeText={setToText} placeholder="Leave blank for one day" />
          <View style={{ height: t.space(2.5) }} />
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.space(2.5),
              backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, padding: t.space(3),
            }}
          >
            <MaterialCommunityIcons name="calendar-check-outline" size={22} color={days ? t.color.accentText : t.color.textFaint} />
            <Txt weight="700" style={{ flex: 1 }}>
              {fromDate && toDate
                ? `${days} working day${days === 1 ? '' : 's'}`
                : 'Type the dates as day/month/year'}
            </Txt>
          </View>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
            Weekends are not counted. Public holidays are, because the app does not carry a holiday
            calendar and the office checks the count anyway.
          </Txt>
        </Card>

        <Card>
          <Field label="Reason (optional)" value={reason} onChangeText={setReason} multiline placeholder="Anything the roster needs to know" />
        </Card>

        <Button
          title="Send request"
          onPress={() => { void send(); }}
          loading={busy}
          icon={<MaterialCommunityIcons name="send-outline" size={20} color={t.color.onAccent} />}
        />
      </Screen>
    </>
  );
}
