import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ISSUED_REFUSAL, getForm72, issueForm72, recordOccupierCopy, updateForm72,
  type Form72Patch, type StoredForm72,
} from '@/db/form72Repo';
import {
  CALIBRATION_MONTHS, PART_RESULT_LABEL, deviceCalibration, elevationHeadKpa, frictionalLossKpa,
  overloadCheck, validateForm72,
  type BoosterTest, type FlowDeviceKind, type FlowRow, type FormIssue, type HydrostaticTest,
  type PartResult, type SprinklerFlowTest, type SprinklerHydrostatic, type SprinklerTestPoint,
  type TestDevice,
} from '@/domain/form72';
import {
  DECLARATION, FORM_SUBTITLE, FORM_TITLE, FORM_VERSION, OCCUPIER_COPY_BUSINESS_DAYS,
  PART_B_NOTE, PART_C_NOTE, PART_D_NOTE, PART_E_NOTE, PART_F_NOTE, PART_G_NOTE,
  STANDARD_FLOW_RATES_LPS, TESTER_RETENTION_YEARS, form72Html, frictionalLossGaps,
  occupierCopyDueBy, testPointOutcome, testerCopyKeepUntil,
} from '@/export/form72';
import { shareFile, writePdf } from '@/export/files';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { SignaturePad } from '@/components/SignaturePad';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * Form 72 — the Queensland statutory hydrant and sprinkler form.
 *
 * The department publishes this as a nine-part A3 sheet, and filling it on a
 * phone by scrolling one enormous column is how a technician ends up in Part G
 * having silently skipped Part D. So the parts are the navigation: one part on
 * screen at a time, with the strip along the top saying which ones are answered
 * and which are still 'na'. That strip is the only progress indicator worth
 * having, because on this form "not applicable" and "not yet filled in" are
 * genuinely the same stored value and only the technician can tell them apart.
 *
 * Everything saves as it is typed. A form part-filled in a plant room with no
 * signal, on a phone that dies, must still be there — there is no draft state
 * living only in React.
 *
 * The screen does two things the paper cannot. It checks each gauge's
 * calibration date against the test date, because a gauge out of calibration
 * makes every pressure on the page unusable and nobody notices until the form
 * is challenged. And it answers the overload run — 150% of duty flow at 65% of
 * duty pressure — which the department's form has no box for at all, so a pump
 * on the way out passes the printed form while failing the only test that finds
 * it.
 *
 * Issuing is a one-way door. After that the form is a statement somebody is
 * held to, so it stops being editable and starts counting the ten business days
 * the occupier's copy is due within.
 */

type PartKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

const PARTS: { key: PartKey; title: string; blurb: string }[] = [
  { key: 'A', title: 'Details', blurb: 'Site, contractor, date and which maintenance test this covers' },
  { key: 'B', title: 'Hydrostatic', blurb: 'Hydrant pipework pressure test' },
  { key: 'C', title: 'Devices', blurb: 'Gauges and flow devices, and their calibration' },
  { key: 'D', title: 'Flow test', blurb: 'The flow table — duty proved at each rate' },
  { key: 'E', title: 'Booster', blurb: 'Pump appliance boost test' },
  { key: 'F', title: 'Sprinkler hydro', blurb: 'Sprinkler pipework pressure test' },
  { key: 'G', title: 'Sprinkler flow', blurb: 'Test points, required against achieved' },
  { key: 'H', title: 'Result', blurb: 'Defects, repairs and the system result' },
  { key: 'I', title: 'Declaration', blurb: 'Licensee, licence number and signature' },
];

const RESULT_OPTIONS: { value: PartResult; label: string }[] = [
  { value: 'na', label: 'N/A' },
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
];

const FLOW_DEVICE_LABEL: Record<FlowDeviceKind, string> = {
  orifice: 'Orifice plate',
  mechanical: 'Mechanical',
  electromagnetic: 'Electromagnetic',
};

/** Reads a typed number without turning an empty box into a zero. */
const num = (s: string): number | undefined => {
  const v = s.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const str = (n: number | undefined): string => (n === undefined ? '' : String(n));

const auDate = (iso?: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export default function Form72Screen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [form, setForm] = useState<StoredForm72 | null>(null);
  const [part, setPart] = useState<PartKey>('A');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const [f, prefs] = await Promise.all([getForm72(id), loadPrefs()]);
      setForm(f);
      setCompanyName(prefs.companyName);
    })();
  }, [id]);

  const locked = form?.status === 'issued';

  /*
   * Writes land immediately rather than on a save button. The patch is the
   * changed field only, so two parts edited in quick succession cannot
   * overwrite each other with a stale copy of the other's JSON.
   */
  const pending = useRef<Promise<void>>(Promise.resolve());
  const patch = useCallback((p: Form72Patch) => {
    if (!id || locked) return;
    setForm((prev) => (prev ? { ...prev, ...p } as StoredForm72 : prev));
    pending.current = pending.current
      .then(() => updateForm72(id, p))
      .catch((e: unknown) => {
        Alert.alert('Not saved', e instanceof Error ? e.message : 'That change did not save.');
      });
  }, [id, locked]);

  const issues = useMemo(() => (form ? validateForm72(form) : []), [form]);
  const blockers = issues.filter((i) => i.blocking);
  const cautions = issues.filter((i) => !i.blocking);

  const onIssue = useCallback(() => {
    if (!form) return;
    if (blockers.length) {
      Alert.alert(
        'Not ready to issue',
        blockers.map((b) => `• Part ${b.part} — ${b.message}`).join('\n\n'),
      );
      return;
    }
    Alert.alert(
      'Issue this Form 72?',
      'Once issued it cannot be edited — a correction needs a new form. The occupier’s copy is '
      + `then due within ${OCCUPIER_COPY_BUSINESS_DAYS} business days, and you keep yours for `
      + `${TESTER_RETENTION_YEARS} years.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Issue',
          style: 'destructive',
          onPress: async () => {
            try {
              setForm(await issueForm72(form.id));
            } catch (e) {
              Alert.alert('Cannot issue', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [form, blockers]);

  const onPdf = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    try {
      const html = form72Html({
        form,
        systemLabel: form.systemLabel,
        companyName,
        generatedAt: nowIso(),
        overload: form.overload,
      });
      const file = await writePdf(`Form 72 ${form.siteName}`, html);
      await shareFile(file, 'Form 72');
    } catch (e) {
      Alert.alert('Could not produce the form', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [form, companyName]);

  const onCopyGiven = useCallback(() => {
    if (!form) return;
    Alert.alert(
      'Occupier has their copy?',
      'This records the date they were given it, which is the fact the ten business days actually '
      + 'runs against. Producing the PDF is not the same event as handing it over.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'They have it',
          onPress: async () => {
            const at = nowIso();
            try {
              await recordOccupierCopy(form.id, at);
              setForm({ ...form, copyGivenAt: at });
            } catch (e) {
              Alert.alert('Not recorded', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [form]);

  if (!form) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Form 72' }} />
        <Txt tone="muted">Loading…</Txt>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `Form 72 — ${form.siteName}` }} />

      <Card>
        <Rowed>
          <View style={{ flex: 1 }}>
            <Txt size="lg" weight="700">{FORM_TITLE}</Txt>
            <Txt size="sm" tone="muted">{FORM_SUBTITLE} · {FORM_VERSION}</Txt>
          </View>
          <Chip
            label={form.status === 'issued' ? 'Issued' : 'Draft'}
            tone={form.status === 'issued' ? 'pass' : 'warn'}
          />
        </Rowed>
        {form.systemLabel ? <Txt size="sm" tone="muted">{form.systemLabel}</Txt> : null}
      </Card>

      {locked ? (
        <Banner tone="info" title="Issued — no longer editable" body={ISSUED_REFUSAL} />
      ) : null}

      {locked ? <OccupierCopyCard form={form} onPress={onCopyGiven} /> : null}

      {!locked && blockers.length ? (
        <Banner
          tone="warn"
          title={`${blockers.length} thing${blockers.length === 1 ? '' : 's'} still to do before this can be issued`}
          body={blockers.map((b) => `Part ${b.part} — ${b.message}`).join('\n')}
        />
      ) : null}

      {!locked && !blockers.length ? (
        <Banner tone="pass" title="Ready to issue" body="Nothing blocking is outstanding." />
      ) : null}

      {cautions.length ? (
        <Banner
          tone="fail"
          title="Worth a look before you sign"
          body={cautions.map((c) => `Part ${c.part} — ${c.message}`).join('\n')}
        />
      ) : null}

      <PartStrip form={form} issues={issues} value={part} onChange={setPart} />

      <PartBody
        part={part}
        form={form}
        locked={!!locked}
        patch={patch}
      />

      <Divider />

      <Rowed gap={2}>
        <Button
          title="Produce PDF"
          onPress={onPdf}
          loading={busy}
          variant="secondary"
          style={{ flex: 1 }}
          icon={<MaterialCommunityIcons name="file-pdf-box" size={18} color={t.color.text} />}
        />
        {!locked ? (
          <Button
            title="Issue"
            onPress={onIssue}
            disabled={blockers.length > 0}
            style={{ flex: 1 }}
          />
        ) : null}
      </Rowed>

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        {DECLARATION}
      </Txt>
    </Screen>
  );
}

/**
 * The part strip.
 *
 * A part with a blocker is marked; a part left at 'na' is dimmed rather than
 * flagged, because "not applicable" is a legitimate and common answer on this
 * form and colouring it as a problem trains people to ignore the colour.
 */
function PartStrip({
  form, issues, value, onChange,
}: {
  form: StoredForm72;
  issues: FormIssue[];
  value: PartKey;
  onChange: (p: PartKey) => void;
}) {
  const t = useTheme();
  const answered: Record<PartKey, boolean> = {
    A: !!form.testDate && !!form.contractor.trim(),
    B: form.hydrostatic.result !== 'na',
    C: form.devices.length > 0,
    D: form.flowTest.result !== 'na',
    E: form.booster.result !== 'na',
    F: form.sprinklerHydrostatic.result !== 'na',
    G: form.sprinklerFlow.result !== 'na',
    H: form.systemResult !== 'na' || form.criticalDefectsIdentified !== undefined,
    I: !!form.licenceNumber.trim() && !!form.signature,
  };

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(1.5) }}>
      {PARTS.map((p) => {
        const blocked = issues.some((i) => i.part === p.key && i.blocking);
        const on = value === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => onChange(p.key)}
            style={{
              paddingVertical: t.space(1.5),
              paddingHorizontal: t.space(2.5),
              borderRadius: t.radius.md,
              backgroundColor: on ? t.color.accent : t.color.surfaceAlt,
              borderWidth: 1,
              borderColor: blocked && !on ? t.color.warn : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Txt
              size="sm"
              weight="700"
              style={{ color: on ? '#fff' : t.color.text }}
            >
              {p.key}
            </Txt>
            <Txt size="sm" style={{ color: on ? '#fff' : answered[p.key] ? t.color.text : t.color.textFaint }}>
              {p.title}
            </Txt>
            {blocked ? (
              <MaterialCommunityIcons
                name="alert-circle"
                size={13}
                color={on ? '#fff' : t.color.warn}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function PartBody({
  part, form, locked, patch,
}: {
  part: PartKey;
  form: StoredForm72;
  locked: boolean;
  patch: (p: Form72Patch) => void;
}) {
  const meta = PARTS.find((p) => p.key === part)!;
  return (
    <View style={{ gap: 12 }}>
      <View>
        <H2>{`Part ${part} — ${meta.title}`}</H2>
        <Txt size="sm" tone="muted">{meta.blurb}</Txt>
      </View>
      {part === 'A' ? <PartA form={form} locked={locked} patch={patch} /> : null}
      {part === 'B' ? <PartB form={form} locked={locked} patch={patch} /> : null}
      {part === 'C' ? <PartC form={form} locked={locked} patch={patch} /> : null}
      {part === 'D' ? <PartD form={form} locked={locked} patch={patch} /> : null}
      {part === 'E' ? <PartE form={form} locked={locked} patch={patch} /> : null}
      {part === 'F' ? <PartF form={form} locked={locked} patch={patch} /> : null}
      {part === 'G' ? <PartG form={form} locked={locked} patch={patch} /> : null}
      {part === 'H' ? <PartH form={form} locked={locked} patch={patch} /> : null}
      {part === 'I' ? <PartI form={form} locked={locked} patch={patch} /> : null}
    </View>
  );
}

type PartProps = {
  form: StoredForm72;
  locked: boolean;
  patch: (p: Form72Patch) => void;
};

/** A part's na/pass/fail selector, which every part but A and C carries. */
function ResultPicker({
  value, onChange, locked,
}: {
  value: PartResult;
  onChange: (v: PartResult) => void;
  locked: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Label>Result</Label>
      {locked ? (
        <Chip label={PART_RESULT_LABEL[value]} tone={value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'muted'} />
      ) : (
        <Segmented options={RESULT_OPTIONS} value={value} onChange={onChange} />
      )}
    </View>
  );
}

const TEST_KINDS: { key: keyof StoredForm72['maintenanceTest']; label: string }[] = [
  { key: 'hydrantAnnual', label: 'Hydrant — annual' },
  { key: 'hydrantFiveYear', label: 'Hydrant — 5 yearly' },
  { key: 'sprinklerAnnual', label: 'Sprinkler — annual' },
  { key: 'sprinklerFiveYear', label: 'Sprinkler — 5 yearly' },
  { key: 'combinedAnnual', label: 'Combined — annual' },
  { key: 'combinedFiveYear', label: 'Combined — 5 yearly' },
];

function PartA({ form, locked, patch }: PartProps) {
  return (
    <Card>
      <Field
        label="Site"
        value={form.siteName}
        onChangeText={(v) => patch({ siteName: v })}
        editable={!locked}
      />
      <Field
        label="Address"
        value={form.siteAddress ?? ''}
        onChangeText={(v) => patch({ siteAddress: v })}
        editable={!locked}
      />
      <Field
        label="System"
        value={form.systemLabel}
        onChangeText={(v) => patch({ systemLabel: v })}
        placeholder="Towns Main System"
        hint="The descriptor in the form's top right corner. Without it, two forms for this site on the same day are indistinguishable."
        editable={!locked}
      />
      <Field
        label="Contractor"
        value={form.contractor}
        onChangeText={(v) => patch({ contractor: v })}
        editable={!locked}
      />
      <Rowed gap={2}>
        <View style={{ flex: 2 }}>
          <Field
            label="Test date"
            value={form.testDate ?? ''}
            onChangeText={(v) => patch({ testDate: v })}
            placeholder="2026-07-03"
            hint="Prints as d/m/yyyy"
            editable={!locked}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Time"
            value={form.testTime ?? ''}
            onChangeText={(v) => patch({ testTime: v })}
            placeholder="09:30"
            editable={!locked}
          />
        </View>
      </Rowed>

      <Divider />
      <Label>Maintenance test carried out</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TEST_KINDS.map((k) => (
          <Chip
            key={k.key}
            label={k.label}
            selected={form.maintenanceTest[k.key]}
            tone={form.maintenanceTest[k.key] ? 'accent' : 'default'}
            onPress={locked ? undefined : () => patch({
              maintenanceTest: { ...form.maintenanceTest, [k.key]: !form.maintenanceTest[k.key] },
            })}
          />
        ))}
      </View>
    </Card>
  );
}

function PartB({ form, locked, patch }: PartProps) {
  const h = form.hydrostatic;
  const set = (p: Partial<HydrostaticTest>) => patch({ hydrostatic: { ...h, ...p } });
  const loss = h.testPressureKpa !== undefined && h.endPressureKpa !== undefined
    ? h.testPressureKpa - h.endPressureKpa
    : undefined;

  return (
    <Card>
      <Txt size="sm" tone="muted">{PART_B_NOTE}</Txt>
      <ResultPicker value={h.result} onChange={(v) => set({ result: v })} locked={locked} />
      <NumField label="Boost pressure" suffix="kPa" value={h.boostPressureKpa} onChange={(v) => set({ boostPressureKpa: v })} locked={locked} />
      <NumField label="Test pressure" suffix="kPa" value={h.testPressureKpa} onChange={(v) => set({ testPressureKpa: v })} locked={locked} />
      <NumField label="Held for" suffix="min" value={h.durationMinutes} onChange={(v) => set({ durationMinutes: v })} locked={locked} />
      <NumField label="Pressure at end" suffix="kPa" value={h.endPressureKpa} onChange={(v) => set({ endPressureKpa: v })} locked={locked} />
      {loss !== undefined ? (
        <Banner
          tone={loss > 0 ? 'warn' : 'pass'}
          title={loss > 0 ? `Dropped ${loss} kPa over the hold` : 'Held pressure'}
        />
      ) : null}
      <NumField label="Loss" suffix="L/min" value={h.lossLpm} onChange={(v) => set({ lossLpm: v })} locked={locked} />
      <Field
        label="Comments"
        value={h.comments ?? ''}
        onChangeText={(v) => set({ comments: v })}
        multiline
        hint="Your line breaks are kept on the printed form."
        editable={!locked}
      />
    </Card>
  );
}

/**
 * Part C — the devices.
 *
 * The calibration check is the reason this part is worth filling in on a phone
 * rather than on paper. A gauge out of calibration makes every pressure on the
 * page unusable, and it is the one thing a person reading the printed form
 * cannot check, because the paper does not carry the test date beside it.
 */
function PartC({ form, locked, patch }: PartProps) {
  const t = useTheme();
  const devices = form.devices;
  const setDevice = (i: number, p: Partial<TestDevice>) => patch({
    devices: devices.map((d, n) => (n === i ? { ...d, ...p } : d)),
  });


  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_C_NOTE}</Txt>
        <Divider />
        <Label>Flow device type</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['orifice', 'mechanical', 'electromagnetic'] as FlowDeviceKind[]).map((k) => (
            <Chip
              key={k}
              label={FLOW_DEVICE_LABEL[k]}
              selected={form.flowDeviceKinds.includes(k)}
              tone={form.flowDeviceKinds.includes(k) ? 'accent' : 'default'}
              onPress={locked ? undefined : () => patch({
                flowDeviceKinds: form.flowDeviceKinds.includes(k)
                  ? form.flowDeviceKinds.filter((x) => x !== k)
                  : [...form.flowDeviceKinds, k],
              })}
            />
          ))}
        </View>
      </Card>

      {devices.map((d, i) => {
        /*
         * The same judgement the validation makes, not a second one. When the
         * screen had its own it answered a narrower question: it flagged a
         * gauge past twelve months and said nothing at all about one with no
         * calibration date, which is the same unusable reading with less
         * evidence behind it.
         */
        const cal = deviceCalibration(d, form.testDate);
        return (
        <Card key={`${d.slot}-${i}`}>
          <Rowed>
            <Txt weight="700" style={{ flex: 1 }}>{d.slot || `Device ${i + 1}`}</Txt>
            {cal.issue ? (
              <Chip
                label={cal.state === 'out-of-calibration' ? 'Out of calibration'
                  : cal.state === 'no-date' ? 'No calibration date'
                    : cal.state === 'calibrated-after-test' ? 'Date conflict' : 'Unreadable date'}
                tone={cal.issue.blocking ? 'fail' : 'warn'}
              />
            ) : null}
            {!locked ? (
              <Pressable onPress={() => patch({ devices: devices.filter((_, n) => n !== i) })}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color={t.color.textFaint} />
              </Pressable>
            ) : null}
          </Rowed>
          <Field label="Serial number" value={d.serialNumber} onChangeText={(v) => setDevice(i, { serialNumber: v })} editable={!locked} />
          <Field
            label="Calibrated"
            value={d.dateCalibrated ?? ''}
            onChangeText={(v) => setDevice(i, { dateCalibrated: v })}
            placeholder="2026-01-15"
            editable={!locked}
          />
          {cal.issue ? (
            <Banner
              tone={cal.issue.blocking ? 'fail' : 'warn'}
              title={cal.state === 'out-of-calibration'
                ? `Calibrated ${auDate(d.dateCalibrated)}, more than ${CALIBRATION_MONTHS} months before this test`
                : 'This gauge cannot be relied on'}
              body={cal.issue.message}
            />
          ) : null}
          <Field label="Certificate" value={d.calibrationCertificate ?? ''} onChangeText={(v) => setDevice(i, { calibrationCertificate: v })} editable={!locked} />
          <Rowed gap={2}>
            <View style={{ flex: 1 }}>
              <Field label="Face size" value={d.faceSize ?? ''} onChangeText={(v) => setDevice(i, { faceSize: v })} placeholder="100 mm" editable={!locked} />
            </View>
            <View style={{ flex: 1 }}>
              <NumField label="Increments" suffix="kPa" value={d.incrementsKpa} onChange={(v) => setDevice(i, { incrementsKpa: v })} locked={locked} />
            </View>
          </Rowed>
          <Chip
            label={d.digitalReader ? 'Digital reader' : 'Analogue'}
            onPress={locked ? undefined : () => setDevice(i, { digitalReader: !d.digitalReader })}
          />
        </Card>
        );
      })}

      {!locked ? (
        <Button
          title="Add a device"
          variant="secondary"
          onPress={() => patch({
            devices: [...devices, { slot: `Device ${devices.length + 1}`, serialNumber: '' }],
          })}
        />
      ) : null}
    </View>
  );
}

/**
 * Part D — the flow table.
 *
 * The department prints rows at 5, 10, 15, 20 and 30 L/s. A row at some other
 * rate is legitimate — it is what the block plan asked for — but it is worth
 * marking, because a rate typed in error reads exactly like a rate chosen on
 * purpose once the form is printed.
 */
function PartD({ form, locked, patch }: PartProps) {
  const t = useTheme();
  const f = form.flowTest;
  const set = (p: Partial<typeof f>) => patch({ flowTest: { ...f, ...p } });
  const setRow = (i: number, p: Partial<FlowRow>) => set({
    rows: f.rows.map((r, n) => (n === i ? { ...r, ...p } : r)),
  });

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_D_NOTE}</Txt>
        <View style={{ gap: 6 }}>
          <Label>Result</Label>
          {locked ? (
            <Chip label={f.result === 'refer-to-report' ? 'Refer to report' : PART_RESULT_LABEL[f.result]} />
          ) : (
            <Segmented
              options={[...RESULT_OPTIONS, { value: 'refer-to-report' as const, label: 'Refer' }]}
              value={f.result}
              onChange={(v) => set({ result: v })}
            />
          )}
        </View>
        <NumField label="Static pressure" suffix="kPa" value={f.staticPressureKpa} onChange={(v) => set({ staticPressureKpa: v })} locked={locked} />
        <Field label="Pressure zone" value={f.pressureZone ?? ''} onChangeText={(v) => set({ pressureZone: v })} editable={!locked} />
        <Field
          label="Hydrants tested"
          value={f.hydrantLocations.join(', ')}
          onChangeText={(v) => set({ hydrantLocations: v.split(',').map((s) => s.trim()).filter(Boolean) })}
          placeholder="Booster, Level 3 east, Roof"
          hint="Comma separated"
          editable={!locked}
        />
        <Chip
          label={f.onSitePumpSet ? 'On-site pump set' : 'No on-site pump set'}
          tone={f.onSitePumpSet ? 'accent' : 'default'}
          onPress={locked ? undefined : () => set({ onSitePumpSet: !f.onSitePumpSet })}
        />
      </Card>

      {f.rows.map((r, i) => {
        const standard = STANDARD_FLOW_RATES_LPS.includes(r.rateLps);
        return (
          <Card key={i}>
            <Rowed>
              <Txt weight="700" style={{ flex: 1 }}>{r.rateLps} L/s</Txt>
              {!standard ? <Chip label="Non-standard rate" tone="warn" /> : null}
              {!locked ? (
                <Pressable onPress={() => set({ rows: f.rows.filter((_, n) => n !== i) })}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={t.color.textFaint} />
                </Pressable>
              ) : null}
            </Rowed>
            <NumField label="Rate" suffix="L/s" value={r.rateLps} onChange={(v) => setRow(i, { rateLps: v ?? 0 })} locked={locked} />
            <Field label="Devices used" value={r.devices} onChangeText={(v) => setRow(i, { devices: v })} editable={!locked} />
            <NumField label="Hydrant 1" suffix="kPa" value={r.hydrant1Kpa} onChange={(v) => setRow(i, { hydrant1Kpa: v })} locked={locked} />
            <NumField label="Hydrants 1+2" suffix="kPa" value={r.hydrants12Kpa} onChange={(v) => setRow(i, { hydrants12Kpa: v })} locked={locked} />
            <NumField label="Hydrants 1+2+3" suffix="kPa" value={r.hydrants123Kpa} onChange={(v) => setRow(i, { hydrants123Kpa: v })} locked={locked} />
          </Card>
        );
      })}

      {!locked ? (
        <Rowed gap={2} wrap>
          {STANDARD_FLOW_RATES_LPS.filter((r) => !f.rows.some((x) => x.rateLps === r)).map((rate) => (
            <Chip
              key={rate}
              label={`+ ${rate} L/s`}
              onPress={() => set({ rows: [...f.rows, { rateLps: rate, devices: '' }].sort((a, b) => a.rateLps - b.rateLps) })}
            />
          ))}
        </Rowed>
      ) : null}

      <Card>
        <Field label="System achieved" value={f.systemAchieved ?? ''} onChangeText={(v) => set({ systemAchieved: v })} editable={!locked} />
        <Field label="Comment" value={f.comment ?? ''} onChangeText={(v) => set({ comment: v })} multiline editable={!locked} />
      </Card>
    </View>
  );
}

/**
 * Part E — the booster, and the overload run the department's form omits.
 *
 * A pump tested only at its rated duty has not been tested: one on the way out
 * still makes its number at the easy end of the curve. The run that finds it is
 * 150% of duty flow at 65% of duty pressure, and this is the only place in the
 * app that asks for it.
 */
function PartE({ form, locked, patch }: PartProps) {
  const b = form.booster;
  const set = (p: Partial<BoosterTest>) => patch({ booster: { ...b, ...p } });
  const head = b.highestHydrantAboveBoosterM !== undefined
    ? elevationHeadKpa(b.highestHydrantAboveBoosterM)
    : undefined;
  const friction = frictionalLossKpa(b);
  const gaps = frictionalLossGaps(b);
  const check = b.requiredLps !== undefined && b.requiredKpa !== undefined
    ? overloadCheck(b.requiredLps, b.requiredKpa, form.overload)
    : undefined;

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_E_NOTE}</Txt>
        <ResultPicker value={b.result} onChange={(v) => set({ result: v })} locked={locked} />
        <Field label="Hydrants tested" value={b.hydrantLocations ?? ''} onChangeText={(v) => set({ hydrantLocations: v })} editable={!locked} />
        <NumField
          label="Highest hydrant above booster"
          suffix="m"
          value={b.highestHydrantAboveBoosterM}
          onChange={(v) => set({ highestHydrantAboveBoosterM: v })}
          locked={locked}
        />
        {head !== undefined ? (
          <Banner tone="info" title={`Elevation head ${head} kPa`} body="Static lift to the highest hydrant, before any friction." />
        ) : null}
        <NumField label="Required flow" suffix="L/s" value={b.requiredLps} onChange={(v) => set({ requiredLps: v })} locked={locked} />
        <NumField label="Required pressure" suffix="kPa" value={b.requiredKpa} onChange={(v) => set({ requiredKpa: v })} locked={locked} />
      </Card>

      <Card>
        <Label>Measured</Label>
        <NumField label="Static pressure" suffix="kPa" value={b.staticPressureKpa} onChange={(v) => set({ staticPressureKpa: v })} locked={locked} />
        <NumField label="Pump inlet" suffix="kPa" value={b.pumpInletKpa} onChange={(v) => set({ pumpInletKpa: v })} locked={locked} />
        <NumField label="Pump discharge" suffix="kPa" value={b.pumpDischargeKpa} onChange={(v) => set({ pumpDischargeKpa: v })} locked={locked} />
        <NumField label="Boost pressure" suffix="kPa" value={b.boostPressureKpa} onChange={(v) => set({ boostPressureKpa: v })} locked={locked} />
        <NumField label="Residual at the hydrant" suffix="kPa" value={b.hydrantResidualKpa} onChange={(v) => set({ hydrantResidualKpa: v })} locked={locked} />
        {friction !== undefined ? (
          <Banner tone="info" title={`Frictional loss ${friction} kPa`} body="Discharge at the pump less what arrived at the hydrant." />
        ) : gaps.length ? (
          <Banner tone="warn" title="Frictional loss cannot be worked out" body={gaps.join('\n')} />
        ) : null}
      </Card>

      <Card>
        <Rowed>
          <View style={{ flex: 1 }}>
            <Txt weight="700">Overload run</Txt>
            <Txt size="sm" tone="muted">150% of duty flow at 65% of duty pressure</Txt>
          </View>
        </Rowed>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          The department&rsquo;s form has no box for this. A pump on the way out still makes its
          rated duty at the easy end of the curve, so the duty alone proves very little.
        </Txt>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <NumField
              label="Achieved flow"
              suffix="L/s"
              value={form.overload?.flowLps}
              onChange={(v) => patch({
                overload: v === undefined && form.overload?.pressureKpa === undefined
                  ? undefined
                  : { flowLps: v ?? 0, pressureKpa: form.overload?.pressureKpa ?? 0 },
              })}
              locked={locked}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumField
              label="Residual"
              suffix="kPa"
              value={form.overload?.pressureKpa}
              onChange={(v) => patch({
                overload: v === undefined && form.overload?.flowLps === undefined
                  ? undefined
                  : { flowLps: form.overload?.flowLps ?? 0, pressureKpa: v ?? 0 },
              })}
              locked={locked}
            />
          </View>
        </Rowed>
        {check ? (
          <Banner
            tone={check.achieved === true ? 'pass' : check.achieved === false ? 'fail' : 'info'}
            title={`Needs ${check.requiredFlowLps} L/s at ${check.requiredPressureKpa} kPa`}
            body={check.note}
          />
        ) : (
          <Banner
            tone="info"
            title="Enter the required flow and pressure above"
            body="Without the duty there is nothing to work the overload requirement out from."
          />
        )}
      </Card>

      <Card>
        <Field label="Comments" value={b.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
      </Card>
    </View>
  );
}

function PartF({ form, locked, patch }: PartProps) {
  const s = form.sprinklerHydrostatic;
  const set = (p: Partial<SprinklerHydrostatic>) => patch({ sprinklerHydrostatic: { ...s, ...p } });
  return (
    <Card>
      <Txt size="sm" tone="muted">{PART_F_NOTE}</Txt>
      <ResultPicker value={s.result} onChange={(v) => set({ result: v })} locked={locked} />
      <NumField label="Test pressure" suffix="kPa" value={s.pressureKpa} onChange={(v) => set({ pressureKpa: v })} locked={locked} />
      <NumField label="Held for" suffix="min" value={s.timeHeldMinutes} onChange={(v) => set({ timeHeldMinutes: v })} locked={locked} />
      <Field label="Comments" value={s.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
    </Card>
  );
}

/**
 * Part G — the sprinkler test points.
 *
 * Required against achieved, point by point. The comparison is done here rather
 * than left to whoever reads the form, because a point that made its flow but
 * not its pressure is easy to miss in a table of four columns.
 */
function PartG({ form, locked, patch }: PartProps) {
  const t = useTheme();
  const g = form.sprinklerFlow;
  const set = (p: Partial<SprinklerFlowTest>) => patch({ sprinklerFlow: { ...g, ...p } });
  const setPoint = (i: number, p: Partial<SprinklerTestPoint>) => set({
    testPoints: g.testPoints.map((x, n) => (n === i ? { ...x, ...p } : x)),
  });

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_G_NOTE}</Txt>
        <ResultPicker value={g.result} onChange={(v) => set({ result: v })} locked={locked} />
        <Field label="System specification" value={g.systemSpec ?? ''} onChangeText={(v) => set({ systemSpec: v })} editable={!locked} />
        <NumField label="Running test gauge" suffix="kPa" value={g.runningTestGaugeKpa} onChange={(v) => set({ runningTestGaugeKpa: v })} locked={locked} />
      </Card>

      {g.testPoints.map((p, i) => {
        const flow = testPointOutcome(p.requiredFlowLpm, p.resultFlowLpm);
        const press = testPointOutcome(p.requiredPressureKpa, p.resultPressureKpa);
        return (
          <Card key={i}>
            <Rowed>
              <Txt weight="700" style={{ flex: 1 }}>{p.location || `Test point ${i + 1}`}</Txt>
              {flow ? <Chip label={`Flow ${flow}`} tone={flow === 'pass' ? 'pass' : 'fail'} /> : null}
              {press ? <Chip label={`Pressure ${press}`} tone={press === 'pass' ? 'pass' : 'fail'} /> : null}
              {!locked ? (
                <Pressable onPress={() => set({ testPoints: g.testPoints.filter((_, n) => n !== i) })}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={t.color.textFaint} />
                </Pressable>
              ) : null}
            </Rowed>
            <Field label="Location" value={p.location} onChangeText={(v) => setPoint(i, { location: v })} editable={!locked} />
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="Required flow" suffix="L/min" value={p.requiredFlowLpm} onChange={(v) => setPoint(i, { requiredFlowLpm: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="Achieved" suffix="L/min" value={p.resultFlowLpm} onChange={(v) => setPoint(i, { resultFlowLpm: v })} locked={locked} />
              </View>
            </Rowed>
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="Required pressure" suffix="kPa" value={p.requiredPressureKpa} onChange={(v) => setPoint(i, { requiredPressureKpa: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="Achieved" suffix="kPa" value={p.resultPressureKpa} onChange={(v) => setPoint(i, { resultPressureKpa: v })} locked={locked} />
              </View>
            </Rowed>
          </Card>
        );
      })}

      {!locked ? (
        <Button
          title="Add a test point"
          variant="secondary"
          onPress={() => set({ testPoints: [...g.testPoints, { location: '' }] })}
        />
      ) : null}

      <Card>
        <Field label="Comments" value={g.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
      </Card>
    </View>
  );
}

/**
 * Part H — the result.
 *
 * The two questions have three states on the printed form: Yes, No, and nobody
 * ticked either. The third is kept as a third state rather than defaulted,
 * because "unanswered" defaulting to "no critical defects" is the answer that
 * decides whether an occupier is given a statutory notice.
 */
function PartH({ form, locked, patch }: PartProps) {
  return (
    <Card>
      <TriState
        label="Critical defects identified"
        value={form.criticalDefectsIdentified}
        onChange={(v) => patch({ criticalDefectsIdentified: v })}
        locked={locked}
      />
      {form.criticalDefectsIdentified ? (
        <Banner
          tone="fail"
          title="A critical defect starts its own clock"
          body="The occupier has to be told in writing, and the notice is a separate document from this form."
        />
      ) : null}
      <TriState
        label="Repairs required"
        value={form.repairsRequired}
        onChange={(v) => patch({ repairsRequired: v })}
        locked={locked}
      />
      <Divider />
      <ResultPicker value={form.systemResult} onChange={(v) => patch({ systemResult: v })} locked={locked} />
      <Field
        label="Notes"
        value={form.systemNotes ?? ''}
        onChangeText={(v) => patch({ systemNotes: v })}
        multiline
        editable={!locked}
      />
    </Card>
  );
}

function PartI({ form, locked, patch }: PartProps) {
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Field label="Licensee" value={form.licenseeName} onChangeText={(v) => patch({ licenseeName: v })} editable={!locked} />
        <Field
          label="QBCC / PIC licence number"
          value={form.licenceNumber}
          onChangeText={(v) => patch({ licenceNumber: v })}
          hint="The form is a statement by a licensed person and is not valid without it."
          editable={!locked}
        />
        <Field label="Report number" value={form.licenseeReportNumber ?? ''} onChangeText={(v) => patch({ licenseeReportNumber: v })} editable={!locked} />
      </Card>

      <Card>
        <Label>Signature</Label>
        {locked ? (
          <Txt size="sm" tone="muted">Signed and issued {auDate(form.issuedAt)}.</Txt>
        ) : (
          <SignaturePad
            label="Sign here"
            value={form.signature}
            onChange={(v) => patch({ signature: v ?? '' })}
          />
        )}
      </Card>

      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{DECLARATION}</Txt>
      </Card>
    </View>
  );
}

function TriState({
  label, value, onChange, locked,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  locked: boolean;
}) {
  const shown = value === undefined ? 'unanswered' : value ? 'yes' : 'no';
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      {locked ? (
        <Chip
          label={shown === 'unanswered' ? 'Not answered' : shown === 'yes' ? 'Yes' : 'No'}
          tone={shown === 'yes' ? 'fail' : shown === 'no' ? 'pass' : 'muted'}
        />
      ) : (
        <Segmented
          options={[
            { value: 'unanswered' as const, label: 'Not answered' },
            { value: 'no' as const, label: 'No' },
            { value: 'yes' as const, label: 'Yes' },
          ]}
          value={shown}
          onChange={(v) => onChange(v === 'unanswered' ? undefined : v === 'yes')}
        />
      )}
    </View>
  );
}

/**
 * The occupier's copy, and the deadline it runs against.
 *
 * Producing the PDF is not the same event as handing it over, so the app asks
 * separately and counts from the answer.
 */
function OccupierCopyCard({ form, onPress }: { form: StoredForm72; onPress: () => void }) {
  const due = occupierCopyDueBy(form.testDate);
  const keep = testerCopyKeepUntil(form.testDate);

  if (form.copyGivenAt) {
    return (
      <Card>
        <Rowed gap={2}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color="#2E9E5B" />
          <View style={{ flex: 1 }}>
            <Txt weight="600">Occupier has their copy</Txt>
            <Txt size="sm" tone="muted">
              Given {auDate(form.copyGivenAt)}
              {keep ? ` · keep yours until ${auDate(keep)}` : ''}
            </Txt>
          </View>
        </Rowed>
      </Card>
    );
  }

  return (
    <Card>
      <Txt weight="600">The occupier still needs their copy</Txt>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        {OCCUPIER_COPY_BUSINESS_DAYS} business days from the work
        {due ? `, so by ${auDate(due)}` : ''}. You keep yours for {TESTER_RETENTION_YEARS} years
        {keep ? `, until ${auDate(keep)}` : ''}.
      </Txt>
      <Button title="They have their copy" variant="secondary" onPress={onPress} />
    </Card>
  );
}

/** A numeric box that leaves an empty box empty rather than reading it as zero. */
function NumField({
  label, value, onChange, suffix, locked,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
  locked: boolean;
}) {
  const [text, setText] = useState(str(value));
  useEffect(() => { setText(str(value)); }, [value]);
  return (
    <Field
      label={label}
      value={text}
      onChangeText={(v) => { setText(v); onChange(num(v)); }}
      keyboardType="decimal-pad"
      suffix={suffix}
      editable={!locked}
    />
  );
}
