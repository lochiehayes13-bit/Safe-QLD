import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { listSites } from '@/db/repo';
import { createImpairment } from '@/db/opsRepo';
import { SYSTEM_LABELS, activeSystems, type SystemKind } from '@/seed/assetTypes';
import type { Site } from '@/domain/types';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import { describeActionFailure } from '@/domain/loadFailure';
import { Banner, Button, Chip, Field, H2, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

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
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>();
  const [system, setSystem] = useState<SystemKind>('detection');
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const [expected, setExpected] = useState('');
  const [technician, setTechnician] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listSites().then((s) => {
      setSites(s);
      if (s.length === 1) setSiteId(s[0]!.id);
    });
    void loadPrefs().then((p) => setTechnician(p.technicianName));
  }, []);

  const start = async () => {
    if (!siteId) {
      showAlert('Which site?', 'Pick the site the system belongs to.');
      return;
    }
    if (!scope.trim()) {
      showAlert('What is out of service?', 'Record what is affected — a whole panel, a loop, a zone, one device. The person taking over needs to know.');
      return;
    }
    setSaving(true);
    try {
      const rec = await createImpairment({
        siteId,
        system: SYSTEM_LABELS[system],
        scope: scope.trim(),
        reason: reason.trim(),
        expectedRestoreAt: expected.trim() || undefined,
        technician: technician.trim() || undefined,
      });
      router.replace({ pathname: '/impairment/[id]', params: { id: rec.id } });
    } catch (e) {
      showAlert('Could not declare it', describeActionFailure(e, 'record this impairment'));
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
          title="This starts a clock"
          body="From the moment you declare it, the app tracks how long the system has been down and shows it on your home screen until it is restored. Notifications and fire watch are tracked on the next screen."
        />

        {sites.length > 1 ? (
          <>
            <H2>Site</H2>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              {sites.map((s) => (
                <Chip key={s.id} label={s.name} selected={siteId === s.id} onPress={() => setSiteId(s.id)} />
              ))}
            </ScrollView>
          </>
        ) : null}

        <H2>System affected</H2>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
          {activeSystems().filter((s) => s !== 'structure').map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(s)} />
          ))}
        </View>

        <Field
          label="What exactly is out of service"
          value={scope}
          onChangeText={setScope}
          multiline
          placeholder="e.g. Loop 2 isolated — levels 4 to 7 detection offline"
        />
        <Field label="Why" value={reason} onChangeText={setReason} multiline placeholder="e.g. Cable damaged by ceiling works" />
        <Field label="Expected back in service" value={expected} onChangeText={setExpected} placeholder="YYYY-MM-DD HH:MM" />
        <Field label="Technician" value={technician} onChangeText={setTechnician} autoCapitalize="words" />

        <Button title="Declare impairment" onPress={start} loading={saving} />
      </Screen>
    </>
  );
}
