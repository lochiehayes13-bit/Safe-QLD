import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { listSitePicks, type SitePick } from '@/db/repo';
import { createImpairment } from '@/db/opsRepo';
import { SYSTEM_LABELS, activeSystems, type SystemKind } from '@/seed/assetTypes';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import { describeActionFailure } from '@/domain/loadFailure';
import { readRestoreTime } from '@/domain/restoreTime';
import { Banner, Button, Chip, Field, H2, Screen } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { SitePicker } from '@/components/SitePicker';
import { RestoreTimeFields } from '@/components/RestoreTimeFields';

/**
 * Declaring an impairment.
 *
 * Taking a fire system out of service starts a clock and a set of obligations.
 * The point of doing it here rather than in a notebook is that the app then
 * keeps the clock visible and will not let the job close with the system still
 * down.
 */
export default function NewImpairmentScreen() {
  const t = useTheme();
  const [sites, setSites] = useState<SitePick[]>([]);
  const [siteId, setSiteId] = useState<string>();
  const [system, setSystem] = useState<SystemKind>('detection');
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const [expected, setExpected] = useState({ date: '', time: '' });
  const [technician, setTechnician] = useState('');
  const [saving, setSaving] = useState(false);

  /*
   * The site list, and what happens when it cannot be read.
   *
   * This had no catch, so a read that rejected — a database locked by a sync
   * is the realistic case — left `sites` empty for ever with nothing on screen
   * saying so. Paired with the gate below it, that was a dead end on a
   * time-critical document: the technician filled in the scope, tapped
   * Declare impairment, and got "Which site? Pick the site the system belongs
   * to" pointing at a picker that was not on the page. impairment.siteId is
   * NOT NULL REFERENCES site(id), so there is no saving it without one.
   */
  const [sitesFailed, setSitesFailed] = useState(false);
  /** Bumped by Try again, which re-runs the read below. */
  const [siteAttempt, setSiteAttempt] = useState(0);
  useEffect(() => {
    void (async () => {
      const rows = await listSitePicks().catch(() => null);
      if (rows === null) { setSitesFailed(true); return; }
      setSites(rows);
      if (rows.length === 1) setSiteId(rows[0]!.id);
    })();
  }, [siteAttempt]);
  useEffect(() => {
    void loadPrefs().then((p) => setTechnician(p.technicianName)).catch(() => undefined);
  }, []);

  const start = async () => {
    if (!siteId) {
      showAlert('Which site?', 'Pick the site the system belongs to.');
      return;
    }
    if (!scope.trim()) {
      showAlert("What's out?", 'Say what is out: panel, loop, zone or device.');
      return;
    }
    const restore = readRestoreTime(expected.date, expected.time, Date.now());
    if ('why' in restore) {
      showAlert('Check the restore time', restore.why);
      return;
    }
    setSaving(true);
    try {
      const rec = await createImpairment({
        siteId,
        system: SYSTEM_LABELS[system],
        scope: scope.trim(),
        reason: reason.trim(),
        expectedRestoreAt: restore.at,
        technician: technician.trim() || undefined,
      });
      router.replace({ pathname: '/impairment/[id]', params: { id: rec.id } });
    } catch (e) {
      showAlert("Couldn't save it", describeActionFailure(e, 'record this impairment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Declare impairment' }} />
      <Screen>
        <Banner
          tone="fail"
          title="Starts a timer"
          body="Shows on your home screen until the system is restored."
        />

        {/*
          * Shown whenever there is a site to pick, and whenever there is not.
          *
          * It rendered only above one site, so a phone holding exactly one
          * site never showed which one had been chosen, and a phone holding
          * none showed nothing at all — while the button still demanded a
          * site. SitePicker already has the right words for an empty list
          * ("No sites on this phone yet — sync first"); the gate stopped them
          * ever being read.
          */}
        {sitesFailed ? (
          <>
            <Banner tone="fail" title="Couldn't load sites" body="An impairment needs a site." />
            <Button
              title="Try again"
              variant="secondary"
              onPress={() => { setSitesFailed(false); setSiteAttempt((n) => n + 1); }}
            />
          </>
        ) : (
          <SitePicker sites={sites} value={siteId} onChange={setSiteId} />
        )}

        <H2>System</H2>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
          {activeSystems().filter((s) => s !== 'structure').map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(s)} />
          ))}
        </View>

        <Field
          label="What's out of service"
          value={scope}
          onChangeText={setScope}
          multiline
          placeholder="e.g. Loop 2 isolated, levels 4 to 7"
        />
        <Field label="Why" value={reason} onChangeText={setReason} multiline placeholder="e.g. Cable damaged by ceiling works" />
        <RestoreTimeFields date={expected.date} time={expected.time} onChange={setExpected} />
        <Field label="Technician" value={technician} onChangeText={setTechnician} autoCapitalize="words" />

        <Button title="Declare impairment" onPress={start} loading={saving} />
      </Screen>
    </>
  );
}
