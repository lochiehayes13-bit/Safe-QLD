import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  assessCombinedFlow, combinedFlowCertificateHtml,
  type CombinedFlowInput, type FlowTestEquipment,
} from '@/export/combinedFlowCertificate';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import { showAlert } from '@/components/alert';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * The combined sprinkler and hydrant flow test certificate.
 *
 * Two arithmetic slips on this document are worth more attention than
 * everything else on it, because both produce a certificate that reads as a
 * pass.
 *
 * The sprinkler demand is written in litres per minute and the hydrant duty in
 * litres per second, on the same form, because that is how each trade writes
 * its own figure. Adding them as written overstates the duty sixtyfold, which
 * fails a system that is fine — or, in the other direction, passes one that is
 * not. The conversion is done here and stated on the page, so the arithmetic is
 * visible to whoever reads the certificate rather than buried in this app.
 *
 * And a pump tested only at its rated duty has not been tested. One on the way
 * out still makes its number at the easy end of the curve; the run that finds
 * it is 150% of duty flow at 65% of duty pressure. So the screen asks for both
 * runs and refuses to call it a pass on the duty alone.
 *
 * Where the figures do not reach, the verdict stays undetermined. A certificate
 * that says "pass" because a field was blank is worse than one that says
 * nothing.
 */

const num = (s: string): number | undefined => {
  const v = s.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

type Tab = 'duty' | 'test' | 'gear' | 'who';

const TABS: { value: Tab; label: string }[] = [
  { value: 'duty', label: 'Duty' },
  { value: 'test', label: 'Test' },
  { value: 'gear', label: 'Gauges' },
  { value: 'who', label: 'Details' },
];

export default function FlowCertificateScreen() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('duty');
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState<CombinedFlowInput>({
    buildingName: '',
    equipment: [],
    testPoints: [],
    testedBy: '',
  });

  useEffect(() => {
    void (async () => {
      const prefs = await loadPrefs();
      setInput((prev) => ({
        ...prev,
        testedBy: prev.testedBy || prefs.technicianName,
        licenceNumber: prev.licenceNumber || prefs.technicianLicence,
        company: prev.company || prefs.companyName,
      }));
    })();
  }, []);

  const set = useCallback((p: Partial<CombinedFlowInput>) => {
    setInput((prev) => ({ ...prev, ...p }));
  }, []);

  const assessment = useMemo(() => assessCombinedFlow(input), [input]);

  const onPdf = useCallback(async () => {
    setBusy(true);
    try {
      const html = combinedFlowCertificateHtml(input);
      const file = await writePdf(
        `Flow test certificate ${input.buildingName || 'untitled'}`,
        html,
      );
      const shared = await shareFile(file, 'Flow test certificate');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'certificate');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not produce the certificate', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [input]);

  const verdictTone = assessment.passed === true ? 'pass'
    : assessment.passed === false ? 'fail' : 'warn';
  const verdictText = assessment.passed === true ? 'Passed'
    : assessment.passed === false ? 'Failed'
      : 'Not determined';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Flow certificate' }} />

      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        Sprinkler demand is written in L/min and hydrant duty in L/s. This converts before it adds
        them — adding as written overstates the duty sixtyfold.
      </Txt>

      <Card>
        <Rowed gap={2} wrap>
          <View style={{ flex: 1, minWidth: 140 }}>
            <ResultBlock
              label="Combined duty"
              value={assessment.combinedLps === undefined ? '—' : String(assessment.combinedLps)}
              unit="L/s"
              detail={input.sprinklerFlowLpm
                ? `${input.hydrantFlowLps ?? 0} L/s of hydrants plus ${input.sprinklerFlowLpm} L/min of sprinklers`
                : 'Hydrant duty alone — no sprinkler demand entered'}
            />
          </View>
        </Rowed>
        <Rowed gap={2}>
          <Chip label={verdictText} tone={verdictTone} />
          {assessment.overload ? (
            <Chip
              label={`Overload ${assessment.overload.requiredFlowLps} L/s @ ${assessment.overload.requiredPressureKpa} kPa`}
              tone={assessment.overload.achieved === true ? 'pass'
                : assessment.overload.achieved === false ? 'fail' : 'default'}
            />
          ) : null}
        </Rowed>
      </Card>

      {assessment.warnings.map((w, i) => (
        <Banner key={i} tone="warn" title="Before this is signed" body={w} />
      ))}

      <Segmented options={TABS} value={tab} onChange={setTab} />

      {tab === 'duty' ? <DutyTab input={input} set={set} assessment={assessment} /> : null}
      {tab === 'test' ? <TestTab input={input} set={set} /> : null}
      {tab === 'gear' ? <GearTab input={input} set={set} stale={assessment.staleEquipment} /> : null}
      {tab === 'who' ? <DetailsTab input={input} set={set} /> : null}

      <Divider />

      <Button
        title="Produce certificate"
        onPress={onPdf}
        loading={busy}
        icon={<MaterialCommunityIcons name="file-pdf-box" size={18} color={t.color.onAccent} />}
      />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Nothing here is stored. The certificate is produced from what is on screen and shared
        straight out — this is the one-off run, not a site record.
      </Txt>
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}

type TabProps = {
  input: CombinedFlowInput;
  set: (p: Partial<CombinedFlowInput>) => void;
};

function DutyTab({
  input, set, assessment,
}: TabProps & { assessment: ReturnType<typeof assessCombinedFlow> }) {
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <H2>Hydrants</H2>
        <Txt size="sm" tone="muted">Off the block plan at the booster.</Txt>
        <NumField label="Duty flow" suffix="L/s" value={input.hydrantFlowLps} onChange={(v) => set({ hydrantFlowLps: v })} />
        <NumField label="Duty pressure" suffix="kPa" value={input.hydrantPressureKpa} onChange={(v) => set({ hydrantPressureKpa: v })} />
        <NumField label="Hydrants running together" value={input.hydrantsSimultaneous} onChange={(v) => set({ hydrantsSimultaneous: v })} />
      </Card>

      <Card>
        <H2>Sprinklers</H2>
        <Txt size="sm" tone="muted">
          Entered in litres per minute, as the sprinkler trade writes it. It is converted before it
          is added to the hydrant duty.
        </Txt>
        <Field
          label="Classification"
          value={input.sprinklerClassification ?? ''}
          onChangeText={(v) => set({ sprinklerClassification: v })}
          placeholder="OH1, ELH, EHH"
          autoCapitalize="characters"
        />
        <NumField label="Demand" suffix="L/min" value={input.sprinklerFlowLpm} onChange={(v) => set({ sprinklerFlowLpm: v })} />
        {input.sprinklerFlowLpm ? (
          <Banner
            tone="info"
            title={`${input.sprinklerFlowLpm} L/min is ${Math.round((input.sprinklerFlowLpm / 60) * 100) / 100} L/s`}
            body="Added to the hydrant duty in litres per second. Added as written it would overstate the duty sixtyfold."
          />
        ) : null}
        <NumField label="Highest head above datum" suffix="m" value={input.sprinklerHeadHeightM} onChange={(v) => set({ sprinklerHeadHeightM: v })} />
      </Card>

      {assessment.overload ? (
        <Card>
          <H2>Overload requirement</H2>
          <Banner
            tone={assessment.overload.achieved === true ? 'pass'
              : assessment.overload.achieved === false ? 'fail' : 'info'}
            title={`${assessment.overload.requiredFlowLps} L/s at ${assessment.overload.requiredPressureKpa} kPa`}
            body={assessment.overload.note}
          />
        </Card>
      ) : null}
    </View>
  );
}

function TestTab({ input, set }: TabProps) {
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <H2>Static pressures</H2>
        <NumField label="At the most disadvantaged point" suffix="kPa" value={input.staticAtMostDisadvantagedKpa} onChange={(v) => set({ staticAtMostDisadvantagedKpa: v })} />
        <NumField label="At the booster" suffix="kPa" value={input.staticAtBoosterKpa} onChange={(v) => set({ staticAtBoosterKpa: v })} />
        <NumField label="At the pump discharge" suffix="kPa" value={input.staticAtPumpDischargeKpa} onChange={(v) => set({ staticAtPumpDischargeKpa: v })} />
        <Field label="Pressure zone" value={input.pressureZone ?? ''} onChangeText={(v) => set({ pressureZone: v })} />
      </Card>

      <Card>
        <H2>At 100% of duty</H2>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <NumField
              label="Flow"
              suffix="L/s"
              value={input.achievedAt100?.flowLps}
              onChange={(v) => set({
                achievedAt100: v === undefined && input.achievedAt100?.residualKpa === undefined
                  ? undefined
                  : { flowLps: v ?? 0, residualKpa: input.achievedAt100?.residualKpa ?? 0 },
              })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumField
              label="Residual"
              suffix="kPa"
              value={input.achievedAt100?.residualKpa}
              onChange={(v) => set({
                achievedAt100: v === undefined && input.achievedAt100?.flowLps === undefined
                  ? undefined
                  : { flowLps: input.achievedAt100?.flowLps ?? 0, residualKpa: v ?? 0 },
              })}
            />
          </View>
        </Rowed>
      </Card>

      <Card>
        <H2>At 150% of duty</H2>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          The run that finds a tiring pump. Below the required flow it has proved nothing, whatever
          pressure it held.
        </Txt>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <NumField
              label="Flow"
              suffix="L/s"
              value={input.achievedAt150?.flowLps}
              onChange={(v) => set({
                achievedAt150: v === undefined && input.achievedAt150?.residualKpa === undefined
                  ? undefined
                  : { flowLps: v ?? 0, residualKpa: input.achievedAt150?.residualKpa ?? 0 },
              })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumField
              label="Residual"
              suffix="kPa"
              value={input.achievedAt150?.residualKpa}
              onChange={(v) => set({
                achievedAt150: v === undefined && input.achievedAt150?.flowLps === undefined
                  ? undefined
                  : { flowLps: input.achievedAt150?.flowLps ?? 0, residualKpa: v ?? 0 },
              })}
            />
          </View>
        </Rowed>
      </Card>

      <Card>
        <H2>Where</H2>
        <Field label="Most disadvantaged point" value={input.mostDisadvantagedLocation ?? ''} onChangeText={(v) => set({ mostDisadvantagedLocation: v })} />
        <Field label="Sprinkler flow device" value={input.sprinklerFlowDeviceLocation ?? ''} onChangeText={(v) => set({ sprinklerFlowDeviceLocation: v })} />
        <Divider />
        <Label>Test points</Label>
        {input.testPoints.map((p, i) => (
          <Rowed key={i} gap={2}>
            <View style={{ flex: 1 }}>
              <Field
                label={p.label || `Point ${i + 1}`}
                value={p.location ?? ''}
                onChangeText={(v) => set({
                  testPoints: input.testPoints.map((x, n) => (n === i ? { ...x, location: v } : x)),
                })}
              />
            </View>
            <RemoveButton what="test point" onRemove={() => set({ testPoints: input.testPoints.filter((_, n) => n !== i) })} />
          </Rowed>
        ))}
        <Button
          title="Add a test point"
          variant="secondary"
          onPress={() => set({
            testPoints: [...input.testPoints, { label: `Point ${input.testPoints.length + 1}` }],
          })}
        />
      </Card>
    </View>
  );
}

/**
 * The gauges.
 *
 * Every pressure on the certificate was read with one of these, so a
 * calibration date that does not cover the test date is not a detail — it makes
 * the whole page unusable, and it is the one thing a reader of the printed
 * certificate cannot check for themselves.
 */
function GearTab({ input, set, stale }: TabProps & { stale: string[] }) {
  const t = useTheme();
  const setItem = (i: number, p: Partial<FlowTestEquipment>) => set({
    equipment: input.equipment.map((e, n) => (n === i ? { ...e, ...p } : e)),
  });

  return (
    <View style={{ gap: 12 }}>
      {stale.length ? (
        <Banner
          tone="fail"
          title={`${stale.length} item${stale.length === 1 ? '' : 's'} out of calibration on the test date`}
          body={stale.join('\n')}
        />
      ) : null}

      {input.equipment.map((e, i) => (
        <Card key={i}>
          <Rowed>
            <Txt weight="700" style={{ flex: 1 }}>{e.item || `Item ${i + 1}`}</Txt>
            <RemoveButton what="gauge" onRemove={() => set({ equipment: input.equipment.filter((_, n) => n !== i) })} />
          </Rowed>
          <Field label="Item" value={e.item} onChangeText={(v) => setItem(i, { item: v })} placeholder="Pressure gauge" />
          <Rowed gap={2}>
            <View style={{ flex: 1 }}>
              <Field label="Model" value={e.model ?? ''} onChangeText={(v) => setItem(i, { model: v })} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="ID" value={e.idNumber ?? ''} onChangeText={(v) => setItem(i, { idNumber: v })} />
            </View>
          </Rowed>
          <Field
            label="Calibrated"
            value={e.certificationDate ?? ''}
            onChangeText={(v) => setItem(i, { certificationDate: v })}
            placeholder="2026-01-15"
            hint={e.certificationDate ? formatAuDate(e.certificationDate) : undefined}
          />
          <Field label="Certificate" value={e.certificationReference ?? ''} onChangeText={(v) => setItem(i, { certificationReference: v })} />
        </Card>
      ))}

      <Button
        title="Add a gauge"
        variant="secondary"
        onPress={() => set({ equipment: [...input.equipment, { item: '' }] })}
      />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        A gauge out of calibration on the day makes every pressure on this certificate unusable.
        That is checked here because the printed page does not carry the test date beside the
        calibration date, so nobody reading it can check it themselves.
      </Txt>
      <View style={{ height: t.space(2) }} />
    </View>
  );
}

function DetailsTab({ input, set }: TabProps) {
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <H2>Building</H2>
        <Field label="Name" value={input.buildingName} onChangeText={(v) => set({ buildingName: v })} />
        <Field label="Address" value={input.buildingAddress ?? ''} onChangeText={(v) => set({ buildingAddress: v })} />
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <Field label="Class" value={input.buildingClass ?? ''} onChangeText={(v) => set({ buildingClass: v })} placeholder="5" />
          </View>
          <View style={{ flex: 1 }}>
            <NumField label="Height" suffix="m" value={input.buildingHeightM} onChange={(v) => set({ buildingHeightM: v })} />
          </View>
        </Rowed>
        <Field label="Area" value={input.buildingArea ?? ''} onChangeText={(v) => set({ buildingArea: v })} />
      </Card>

      <Card>
        <H2>Test</H2>
        <Rowed gap={2}>
          <View style={{ flex: 2 }}>
            <Field label="Date" value={input.testDate ?? ''} onChangeText={(v) => set({ testDate: v })} placeholder="2026-07-03" hint="Prints as d/m/yyyy" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Time" value={input.testTime ?? ''} onChangeText={(v) => set({ testTime: v })} placeholder="09:30" />
          </View>
        </Rowed>
        <Field label="Applicable standards" value={input.applicableStandards ?? ''} onChangeText={(v) => set({ applicableStandards: v })} placeholder="AS 2419.1, AS 2118.1" />
        {/*
          * The certificate prints a "Year of standard" row and there was no
          * field for it, so it came out blank on every one. It is not the same
          * question as year of design: a system designed in 2015 was designed
          * to the edition current then, and which edition applied is what a
          * certifier reads that row to find out.
          */}
        <Field label="Year of standard" value={input.standardYear ?? ''} onChangeText={(v) => set({ standardYear: v })} keyboardType="numeric" placeholder="2005" hint="The edition the system was designed to, which is not always the year it was designed." />
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <Field label="Year of design" value={input.yearOfDesign ?? ''} onChangeText={(v) => set({ yearOfDesign: v })} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Year installed" value={input.yearOfInstallation ?? ''} onChangeText={(v) => set({ yearOfInstallation: v })} keyboardType="numeric" />
          </View>
        </Rowed>
      </Card>

      <Card>
        <H2>Who</H2>
        <Field label="Tested by" value={input.testedBy} onChangeText={(v) => set({ testedBy: v })} />
        <Field label="Licence number" value={input.licenceNumber ?? ''} onChangeText={(v) => set({ licenceNumber: v })} />
        <Field label="Position" value={input.position ?? ''} onChangeText={(v) => set({ position: v })} />
        <Field label="Company" value={input.company ?? ''} onChangeText={(v) => set({ company: v })} />
        <Divider />
        <Field label="Occupier's representative" value={input.occupierRepresentative ?? ''} onChangeText={(v) => set({ occupierRepresentative: v })} />
        <Field label="Phone" value={input.contactPhone ?? ''} onChangeText={(v) => set({ contactPhone: v })} keyboardType="numeric" />
        <Field label="Email" value={input.email ?? ''} onChangeText={(v) => set({ email: v })} keyboardType="email-address" autoCapitalize="none" />
      </Card>

      <Card>
        <Field label="Comments" value={input.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline />
      </Card>
    </View>
  );
}

/**
 * The bin beside a row. It asks first: nothing on this screen is stored, so a
 * row taken out is simply gone, and a 20dp icon beside a text box is what a
 * gloved thumb reaching for the box lands on.
 */
function RemoveButton({ what, onRemove }: { what: string; onRemove: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => showAlert(`Remove this ${what}?`, 'It cannot be put back.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onRemove },
      ])}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Remove this ${what}`}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name="trash-can-outline" size={20} color={t.color.textFaint} />
    </Pressable>
  );
}

/** A numeric box that leaves an empty box empty rather than reading it as zero. */
function NumField({
  label, value, onChange, suffix,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText((prev) => (num(prev) === value ? prev : value === undefined ? '' : String(value)));
  }, [value]);
  return (
    <Field
      label={label}
      value={text}
      onChangeText={(v) => { setText(v); onChange(num(v)); }}
      keyboardType="decimal-pad"
      suffix={suffix}
    />
  );
}
