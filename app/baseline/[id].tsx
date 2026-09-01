import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getBaseline, saveBaseline } from '@/db/baselineRepo';
import { getSite, listPanels, listZones, queryPoints } from '@/db/repo';
import {
  CONFIRMATION_ITEMS, EQUIPMENT_ITEMS, completeness, zoneQtyTotal,
  type BaselineData, type YesNo,
} from '@/domain/baseline';
import { autofillBaseline } from '@/services/baselineAutofill';
import type { Site } from '@/domain/types';
import { baselineSheet } from '@/export/safeqldForms';
import { shareFile, writeXlsx } from '@/export/files';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * Baseline data form.
 *
 * Long forms on a phone get abandoned, so this one leads with what is still
 * missing, fills everything it can from the site's own data, and saves on every
 * keystroke — a tech in a riser cupboard should never lose work to a lock screen.
 */
export default function BaselineScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<BaselineData | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [site, setSite] = useState<Site | null>(null);
  const [open, setOpen] = useState<string | null>('SYSTEM DETAILS');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getBaseline(id).then(async (rec) => {
      setB(rec);
      setMissing(!rec);
      if (rec) setSite(await getSite(rec.siteId));
    });
  }, [id]);

  // Persist on change. The form is small enough that a write per edit is
  // cheaper than the risk of losing a section.
  const update = useCallback((patch: Partial<BaselineData>) => {
    setB((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void saveBaseline(next);
      return next;
    });
  }, []);

  const progress = useMemo(() => (b ? completeness(b) : null), [b]);

  const runAutofill = async () => {
    if (!b || !site) return;
    setBusy(true);
    try {
      const [zones, points, panels] = await Promise.all([
        listPanels(site.id).then((ps) => (ps[0] ? listZones(ps[0].id, false) : Promise.resolve([]))),
        queryPoints({ siteId: site.id, includeUnused: true, limit: 100000 }),
        listPanels(site.id),
      ]);
      const panel = panels[0];
      const { baseline, filled } = autofillBaseline(b, {
        site,
        zones,
        points,
        systemType: panel ? [panel.brand, panel.model].filter(Boolean).join(' ') : undefined,
      });
      setB(baseline);
      await saveBaseline(baseline);
      Alert.alert(
        filled.length ? 'Filled from site data' : 'Nothing to fill',
        filled.length ? filled.join('\n') : 'Every field the app could fill already has something in it.',
      );
    } finally {
      setBusy(false);
    }
  };

  const exportForm = async () => {
    if (!b) return;
    setBusy(true);
    try {
      const file = writeXlsx(`Baseline Data - ${b.premisesName || site?.name || 'Site'}`, [baselineSheet(b)]);
      await shareFile(file, 'Baseline data');
    } finally {
      setBusy(false);
    }
  };

  if (!b) return <RecordGate missing={missing} what="baseline record" />;

  const section = (title: string, children: React.ReactNode) => (
    <Card key={title}>
      <Pressable onPress={() => setOpen((cur) => (cur === title ? null : title))}>
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt weight="700" size="md">{title}</Txt>
          <MaterialCommunityIcons
            name={open === title ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={t.color.textFaint}
          />
        </Rowed>
      </Pressable>
      {open === title ? <View style={{ gap: t.space(2.5), marginTop: t.space(3) }}>{children}</View> : null}
    </Card>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Baseline data' }} />
      <Screen>
        <Txt size="xs" tone="faint" weight="700" style={{ letterSpacing: 1 }}>SAFE QLD PTY LTD</Txt>
        <Txt size="xl" weight="700">Test results, baseline data</Txt>

        {progress ? (
          <Card>
            <Rowed style={{ justifyContent: 'space-between' }}>
              <Label>Completeness</Label>
              <Txt size="sm" weight="700" tone={progress.fraction === 1 ? 'pass' : 'muted'}>
                {progress.filled} of {progress.total}
              </Txt>
            </Rowed>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.color.surfaceAlt, marginTop: t.space(2), overflow: 'hidden' }}>
              <View
                style={{
                  width: `${progress.fraction * 100}%`,
                  height: '100%',
                  backgroundColor: progress.fraction === 1 ? t.color.pass : t.color.accent,
                }}
              />
            </View>
            {progress.missing.length ? (
              <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>
                Still needed: {progress.missing.join(', ')}
              </Txt>
            ) : (
              <Txt size="sm" tone="pass" style={{ marginTop: t.space(2) }}>Every required field is filled.</Txt>
            )}
          </Card>
        ) : null}

        <Rowed gap={2}>
          <Button
            title="Fill from site"
            variant="secondary"
            onPress={runAutofill}
            loading={busy}
            style={{ flex: 1 }}
            icon={<MaterialCommunityIcons name="auto-fix" size={16} color={t.color.text} />}
          />
          <Button title="Export" onPress={exportForm} loading={busy} style={{ flex: 1 }} />
        </Rowed>

        {section('SYSTEM DETAILS', (
          <>
            <Field label="Name of premises" value={b.premisesName} onChangeText={(v) => update({ premisesName: v })} />
            <Field label="Premises address" value={b.premisesAddress} onChangeText={(v) => update({ premisesAddress: v })} />
            <Label>New install or alteration</Label>
            <Segmented
              value={b.installType || 'New install'}
              onChange={(v) => update({ installType: v as BaselineData['installType'] })}
              options={[
                { value: 'New install', label: 'New install' },
                { value: 'Alteration', label: 'Alteration' },
              ]}
            />
            {b.installType === 'Alteration' ? (
              <Field
                label="Alteration details"
                value={b.alterationDetails}
                onChangeText={(v) => update({ alterationDetails: v })}
                multiline
              />
            ) : null}
            <Field
              label="Type of system"
              value={b.systemType}
              onChangeText={(v) => update({ systemType: v })}
              placeholder="Ampac / Pertronic"
            />
            <Field
              label="OWS amplifier size and qty"
              value={b.owsAmplifier}
              onChangeText={(v) => update({ owsAmplifier: v })}
              suffix="W"
            />
            <Field label="Monitoring provider" value={b.monitoringProvider} onChangeText={(v) => update({ monitoringProvider: v })} />
          </>
        ))}

        {section('OWS SPEAKER CIRCUITS', (
          <>
            {b.speakerCircuits.map((c, i) => (
              <Rowed key={c.zone} gap={2} align="flex-end">
                <View style={{ width: 46 }}>
                  <Txt size="sm" tone="muted" weight="700">Zone {c.zone}</Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={i === 0 ? 'Impedance' : undefined}
                    value={c.impedanceOhms}
                    onChangeText={(v) => {
                      const next = [...b.speakerCircuits];
                      next[i] = { ...c, impedanceOhms: v };
                      update({ speakerCircuits: next });
                    }}
                    keyboardType="decimal-pad"
                    suffix="Ω"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={i === 0 ? 'Load' : undefined}
                    value={c.loadW}
                    onChangeText={(v) => {
                      const next = [...b.speakerCircuits];
                      next[i] = { ...c, loadW: v };
                      update({ speakerCircuits: next });
                    }}
                    keyboardType="decimal-pad"
                    suffix="W"
                  />
                </View>
              </Rowed>
            ))}
          </>
        ))}

        {section('EQUIPMENT FITTED', (
          <>
            {EQUIPMENT_ITEMS.map((item) => (
              <YesNoRow
                key={item}
                label={item}
                value={b.equipment[item] ?? ''}
                onChange={(v) => update({ equipment: { ...b.equipment, [item]: v } })}
              />
            ))}
          </>
        ))}

        {section('FDCIE READINGS', (
          <>
            <Field
              label="Full alarm current"
              value={b.fullAlarmCurrentA}
              onChangeText={(v) => update({ fullAlarmCurrentA: v })}
              keyboardType="decimal-pad"
              suffix="A"
              hint="The battery calculator can supply this"
            />
            <Field
              label="Quiescent current"
              value={b.quiescentCurrentA}
              onChangeText={(v) => update({ quiescentCurrentA: v })}
              keyboardType="decimal-pad"
              suffix="A"
            />
            <Field
              label="Primary power and source"
              value={b.primaryPowerV}
              onChangeText={(v) => update({ primaryPowerV: v })}
              suffix="V"
            />
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field label="Battery volts" value={b.batteryVoltage} onChangeText={(v) => update({ batteryVoltage: v })} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Capacity" value={b.batteryAh} onChangeText={(v) => update({ batteryAh: v })} keyboardType="decimal-pad" suffix="Ah" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Standby" value={b.batteryStandbyHours} onChangeText={(v) => update({ batteryStandbyHours: v })} keyboardType="numeric" suffix="hr" />
              </View>
            </Rowed>
            <Field
              label="Battery manufacture date"
              value={b.batteryManufactureDate}
              onChangeText={(v) => update({ batteryManufactureDate: v })}
              placeholder="YYYY-MM-DD"
            />
            <Field
              label="Battery install date"
              value={b.batteryInstallDate}
              onChangeText={(v) => update({ batteryInstallDate: v })}
              placeholder="YYYY-MM-DD"
            />
          </>
        ))}

        {section('CONFIRMATIONS', (
          <>
            {CONFIRMATION_ITEMS.map((item) => (
              <YesNoRow
                key={item}
                label={item}
                value={b.confirmations[item] ?? ''}
                onChange={(v) => update({ confirmations: { ...b.confirmations, [item]: v } })}
              />
            ))}
          </>
        ))}

        {section('ZONE TEST RESULTS', (
          <>
            <Banner
              tone="info"
              title={`Total ${zoneQtyTotal(b.zoneResults)} devices`}
              body="Fill from site fills this table straight from the imported device list."
            />
            {b.zoneResults.map((z, i) => (
              <View key={z.zone} style={{ gap: t.space(1.5) }}>
                <Rowed gap={2} align="flex-end">
                  <View style={{ width: 46 }}>
                    <Txt size="sm" tone="muted" weight="700">Z{z.zone}</Txt>
                  </View>
                  <View style={{ width: 74 }}>
                    <Field
                      label={i === 0 ? 'Qty' : undefined}
                      value={z.qty}
                      onChangeText={(v) => {
                        const next = [...b.zoneResults];
                        next[i] = { ...z, qty: v };
                        update({ zoneResults: next });
                      }}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={i === 0 ? 'Device types' : undefined}
                      value={z.deviceTypes}
                      onChangeText={(v) => {
                        const next = [...b.zoneResults];
                        next[i] = { ...z, deviceTypes: v };
                        update({ zoneResults: next });
                      }}
                      placeholder="24 smoke, 3 heat"
                    />
                  </View>
                </Rowed>
              </View>
            ))}
          </>
        ))}

        {section('SIGN OFF', (
          <>
            <Field label="Tester name(s)" value={b.testerNames} onChangeText={(v) => update({ testerNames: v })} autoCapitalize="words" />
            <Field label="Test date" value={b.testDate} onChangeText={(v) => update({ testDate: v })} placeholder="YYYY-MM-DD" />
          </>
        ))}

        <Divider />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Saved on this device as you type. Export produces the Safe QLD baseline data workbook.
        </Txt>
      </Screen>
    </>
  );
}

function YesNoRow({ label, value, onChange }: { label: string; value: YesNo; onChange: (v: YesNo) => void }) {
  const t = useTheme();
  const options: YesNo[] = ['YES', 'NO', 'N/A'];
  return (
    <View style={{ gap: t.space(1.5) }}>
      <Txt size="sm" style={{ lineHeight: 19 }}>{label}</Txt>
      <Rowed gap={2}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressable
              key={o}
              onPress={() => onChange(on ? '' : o)}
              style={{
                flex: 1,
                minHeight: 42,
                borderRadius: t.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on
                  ? o === 'YES' ? t.color.passBg : o === 'NO' ? t.color.failBg : t.color.warnBg
                  : t.color.surfaceAlt,
                borderWidth: 1,
                borderColor: on
                  ? o === 'YES' ? t.color.pass : o === 'NO' ? t.color.fail : t.color.warn
                  : t.color.border,
              }}
            >
              <Txt
                size="sm"
                weight="700"
                tone={on ? (o === 'YES' ? 'pass' : o === 'NO' ? 'fail' : 'warn') : 'muted'}
              >
                {o}
              </Txt>
            </Pressable>
          );
        })}
      </Rowed>
    </View>
  );
}
