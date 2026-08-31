import React, { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  getImpairment, impairmentElapsedMs, impairmentOutstanding, updateImpairment,
  type ImpairmentRecord,
} from '@/db/opsRepo';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Live impairment.
 *
 * The elapsed timer is the whole point — an impairment that has been running
 * eleven hours reads very differently from one declared twenty minutes ago, and
 * a number that does not move gets ignored.
 */
export default function ImpairmentScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<ImpairmentRecord | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (id) void getImpairment(id).then(setRec);
  }, [id]);

  useEffect(() => {
    if (rec?.restoredAt) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [rec?.restoredAt]);

  const update = (patch: Partial<ImpairmentRecord>) => {
    setRec((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void updateImpairment(next.id, patch);
      return next;
    });
  };

  if (!rec) {
    return <Screen><Txt tone="muted">Loading…</Txt></Screen>;
  }

  const ms = impairmentElapsedMs(rec);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const outstanding = impairmentOutstanding(rec);
  const restored = !!rec.restoredAt;

  const close = () => {
    if (outstanding.length) {
      Alert.alert(
        'Still outstanding',
        `${outstanding.join('\n')}\n\nClose anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close anyway', style: 'destructive', onPress: () => update({ restoredAt: nowIso() }) },
        ],
      );
      return;
    }
    update({ restoredAt: nowIso() });
  };

  return (
    <>
      <Stack.Screen options={{ title: restored ? 'Impairment closed' : 'System impaired' }} />
      <Screen>
        <View
          style={{
            backgroundColor: restored ? t.color.passBg : t.color.failBg,
            borderRadius: t.radius.lg,
            borderLeftWidth: 4,
            borderLeftColor: restored ? t.color.pass : t.color.fail,
            padding: t.space(4),
            gap: t.space(1),
          }}
        >
          <Rowed gap={2}>
            <MaterialCommunityIcons
              name={restored ? 'check-decagram' : 'alert-octagon'}
              size={20}
              color={restored ? t.color.pass : t.color.fail}
            />
            <Txt weight="700" tone={restored ? 'pass' : 'fail'}>
              {restored ? 'RESTORED' : 'OUT OF SERVICE'}
            </Txt>
          </Rowed>
          <Txt size="display" weight="700" mono tone={restored ? 'pass' : 'fail'} style={{ letterSpacing: -1 }}>
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </Txt>
          <Txt size="sm" tone="muted">
            {restored ? 'Total time out of service' : 'Elapsed since declared'}
          </Txt>
        </View>

        <Card>
          <Label>System</Label>
          <Txt weight="700" style={{ marginTop: 2 }}>{rec.system}</Txt>
          <Divider />
          <Label>Scope</Label>
          <Txt size="sm" style={{ marginTop: 2, lineHeight: 20 }}>{rec.scope || '—'}</Txt>
          {rec.reason ? (
            <>
              <Divider />
              <Label>Reason</Label>
              <Txt size="sm" tone="muted" style={{ marginTop: 2, lineHeight: 20 }}>{rec.reason}</Txt>
            </>
          ) : null}
        </Card>

        {!restored && outstanding.length ? (
          <Banner
            tone="warn"
            title={`${outstanding.length} thing${outstanding.length === 1 ? '' : 's'} still to do`}
            body={outstanding.join('\n')}
          />
        ) : null}

        <H2>Notifications and controls</H2>
        <Card>
          <CheckRow label="Responsible person notified" on={rec.responsibleNotified} onToggle={() => update({ responsibleNotified: !rec.responsibleNotified })} />
          {rec.responsibleNotified ? (
            <View style={{ marginVertical: t.space(2) }}>
              <Field label="Who was notified" value={rec.responsibleName ?? ''} onChangeText={(v) => update({ responsibleName: v })} autoCapitalize="words" />
            </View>
          ) : null}
          <Divider />
          <CheckRow label="Monitoring provider notified" on={rec.monitoringNotified} onToggle={() => update({ monitoringNotified: !rec.monitoringNotified })} />
          <Divider />
          <CheckRow label="Fire brigade notified (where required)" on={rec.brigadeNotified} onToggle={() => update({ brigadeNotified: !rec.brigadeNotified })} />
          <Divider />
          <CheckRow label="Fire watch or alternative measures in place" on={rec.fireWatchInPlace} onToggle={() => update({ fireWatchInPlace: !rec.fireWatchInPlace })} />
          <Divider />
          <CheckRow label="Signage placed at the panel" on={rec.signagePlaced} onToggle={() => update({ signagePlaced: !rec.signagePlaced })} />
        </Card>

        <Field
          label="Alternative measures"
          value={rec.alternativeMeasures ?? ''}
          onChangeText={(v) => update({ alternativeMeasures: v })}
          multiline
          placeholder="e.g. Hourly fire watch by site security, portable extinguishers staged at stair cores"
        />
        <Field label="Notes" value={rec.notes ?? ''} onChangeText={(v) => update({ notes: v })} multiline />

        {!restored ? (
          <Button title="System restored — close impairment" onPress={close} />
        ) : (
          <Txt size="sm" tone="pass">Closed {rec.restoredAt}</Txt>
        )}
      </Screen>
    </>
  );
}

function CheckRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onToggle} style={{ paddingVertical: t.space(2) }}>
      <Rowed gap={3}>
        <MaterialCommunityIcons
          name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={24}
          color={on ? t.color.pass : t.color.textFaint}
        />
        <Txt style={{ flex: 1 }} weight={on ? '600' : '400'} tone={on ? 'default' : 'muted'}>{label}</Txt>
      </Rowed>
    </Pressable>
  );
}
