import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  appendixFFields,
  calculateBattery,
  FC_DEFAULT,
  L_DESIGN,
  L_IN_SERVICE,
  type CalcMode,
  type Issue,
} from '@/calc/battery';
import {
  draftFromFigures, figureText, hasLoadFigures, loadFromDraft, loadsFromDrafts, parseFigure,
  type LoadDraft,
} from '@/calc/batteryLoads';
import { VESDA_PSUS, vesdaDevices, vesdaSupplyNote, type VesdaDevice, type VesdaPsu } from '@/calc/vesda';
import { DevicePicker } from '@/components/DevicePicker';
import type { CatalogueItem } from '@/db/catalogueRepo';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * FIP standby battery calculator.
 *
 * The load schedule is the screen's centre of gravity rather than a pair of
 * total-current boxes: entering loads individually is what makes the standby
 * and alarm figures defensible, and it is the only way door holders and
 * brigade monitoring get counted correctly.
 *
 * It opens empty and shows no battery until the technician's own loads are
 * in. A schedule that arrives pre-filled with typical figures produces a
 * battery size before anyone has looked at the site, and that is the number
 * that gets written down.
 */

let seq = 0;
const nextId = (): string => `load-${++seq}`;

/**
 * The loads a baseline record can hand over.
 *
 * A baseline holds two measured totals — what the panel draws quiescent and
 * what it draws in full alarm — and not the itemised list this screen is built
 * around. That is not a shortcoming of the record: those two numbers are what
 * a technician measures at the panel, and they are more truthful than a list
 * of nameplate figures added up.
 *
 * So they arrive as a single measured line, labelled as measured, and the
 * screen's own list is replaced rather than added to.
 */
function measuredLoads(quiescentA: number, alarmA: number): LoadDraft[] {
  return [draftFromFigures(nextId(), {
    label: 'Measured at panel',
    quantity: 1,
    standbyMa: quiescentA * 1000,
    alarmMa: alarmA * 1000,
  })];
}

/** A number off a form field, where a blank and a nonsense entry both mean "not given". */
function handedOver(v: string | undefined): number | undefined {
  const n = parseFigure(v);
  return n !== undefined && n > 0 ? n : undefined;
}

/** A positive figure off a box, or undefined. */
function positive(text: string): number | undefined {
  const n = parseFigure(text);
  return n !== undefined && n > 0 ? n : undefined;
}

export default function BatteryCalculatorScreen() {
  const t = useTheme();
  /*
   * Opened from the baseline record, with its measured currents.
   *
   * The baseline form asks for the quiescent current, the full alarm current
   * and the battery that is installed, and then had nowhere to send them: the
   * technician read the three numbers off the form and typed them into this
   * screen by hand, which is where a decimal point goes missing. Arriving with
   * an installed battery also means the answer wanted is the service one — is
   * what is in there big enough — not the design one.
   */
  const params = useLocalSearchParams<{ quiescentA?: string; alarmA?: string; installedAh?: string; from?: string }>();
  const handed = {
    quiescent: handedOver(params.quiescentA),
    alarm: handedOver(params.alarmA),
    installed: handedOver(params.installedAh),
  };
  const fromBaseline = handed.quiescent !== undefined && handed.alarm !== undefined;

  const [mode, setMode] = useState<CalcMode>(fromBaseline && handed.installed !== undefined ? 'service' : 'design');
  const [drafts, setDrafts] = useState<LoadDraft[]>(
    fromBaseline ? () => measuredLoads(handed.quiescent!, handed.alarm!) : [],
  );
  const [monitored, setMonitored] = useState(true);
  const [alarmMinutes, setAlarmMinutes] = useState('30');
  const [ageing, setAgeing] = useState(L_DESIGN);
  const [installedAh, setInstalledAh] = useState(handed.installed !== undefined ? figureText(handed.installed) : '');
  const [panelMaxAh, setPanelMaxAh] = useState('');
  const [psuOutput, setPsuOutput] = useState('');
  const [psuCharge, setPsuCharge] = useState('');
  const [tempC, setTempC] = useState('');
  const [showWhy, setShowWhy] = useState(false);
  // Which load row the catalogue picker is filling, if any.
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [vesdaOpen, setVesdaOpen] = useState(false);
  const [vesdaPsu, setVesdaPsu] = useState<VesdaPsu | null>(null);

  const loads = useMemo(() => loadsFromDrafts(drafts), [drafts]);
  const ready = hasLoadFigures(loads);

  const result = useMemo(
    () =>
      calculateBattery({
        mode,
        loads,
        monitored,
        alarmHours: (positive(alarmMinutes) ?? 30) / 60,
        deteriorationFactor: mode === 'design' ? L_DESIGN : ageing,
        capacityDerating: FC_DEFAULT,
        averageTempC: parseFigure(tempC),
        installedBatteryAh: positive(installedAh),
        panelMaxBatteryAh: positive(panelMaxAh),
        psuOutputA: positive(psuOutput),
        psuChargeCurrentA: positive(psuCharge),
      }),
    [mode, loads, monitored, alarmMinutes, ageing, tempC, installedAh, panelMaxAh, psuOutput, psuCharge],
  );

  const update = (id: string, patch: Partial<LoadDraft>) =>
    setDrafts((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const add = (row: LoadDraft) => setDrafts((prev) => [...prev, row]);

  /**
   * Fills a load row from the catalogue.
   *
   * The quantity is left alone — the tech has already set how many there are,
   * and overwriting it would be the wrong kind of helpful.
   */
  const applyDevice = (item: CatalogueItem) => {
    if (!pickingFor) return;
    const noAlarm = item.alarmMa === null || item.alarmMa === undefined;
    update(pickingFor, {
      label: `${item.brand} ${item.partNumber}`,
      standbyMa: figureText(item.quiescentMa ?? 0),
      alarmMa: figureText(item.alarmMa ?? item.quiescentMa ?? 0),
      note: noAlarm ? 'Alarm not published; standby used. Check the datasheet.' : `From ${item.brand} datasheet.`,
    });
    setPickingFor(null);
  };

  const addVesda = (d: VesdaDevice) => {
    add(draftFromFigures(nextId(), { label: d.label, quantity: 1, standbyMa: d.standbyMa, alarmMa: d.alarmMa, note: d.note }));
    setVesdaOpen(false);
  };

  const pickVesdaSupply = (p: VesdaPsu) => {
    setPsuOutput(figureText(p.ratedA));
    setPanelMaxAh(figureText(p.maxBatteryAh));
    setVesdaPsu(p);
    setVesdaOpen(false);
  };
  // The supply line stays only while its two figures are still in the boxes.
  const supplyNote = vesdaPsu && psuOutput === figureText(vesdaPsu.ratedA) && panelMaxAh === figureText(vesdaPsu.maxBatteryAh)
    ? vesdaSupplyNote(vesdaPsu)
    : undefined;

  const shown = ready ? result.issues : [];
  const errors = shown.filter((i) => i.level === 'error');
  const warnings = shown.filter((i) => i.level === 'warning');
  const infos = shown.filter((i) => i.level === 'info');
  const factor = mode === 'design' ? L_DESIGN : ageing;

  return (
    <>
      <Stack.Screen options={{ title: 'FIP battery' }} />
      <Screen>
        {fromBaseline ? (
          <Banner
            tone="info"
            title="Filled from the baseline record"
            body={`Currents from the baseline${params.from ? ` for ${params.from}` : ''}. Edits aren't saved back.`}
          />
        ) : null}
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'design', label: 'Design / new' },
            { value: 'service', label: 'In service' },
          ]}
        />
        <Txt size="sm" tone="muted">
          {mode === 'design' ? `New battery: L = ${L_DESIGN}.` : `Installed battery: L = ${L_IN_SERVICE} after 12 months.`}
        </Txt>

        <ResultBlock
          label={mode === 'design' ? 'Specify battery' : 'Capacity required'}
          value={!ready ? '—' : result.recommendedAh !== null ? String(result.recommendedAh) : result.requiredAh.toFixed(1)}
          unit={ready ? 'Ah' : undefined}
          tone={!ready ? 'muted' : errors.length ? 'fail' : 'accent'}
          detail={
            !ready
              ? 'Add loads to size the battery.'
              : result.recommendedAh !== null
                ? `Calculated ${result.requiredAh.toFixed(2)} Ah. 2 × 12 V ${result.recommendedAh} Ah in series.`
                : 'Above standard sizes. Custom set needed.'
          }
        />

        <Rowed gap={2}>
          <MiniStat label="Standby" value={ready ? `${(result.quiescentA * 1000).toFixed(0)} mA` : '—'} />
          <MiniStat label="Alarm" value={ready ? `${(result.alarmA * 1000).toFixed(0)} mA` : '—'} />
          <MiniStat label="Standby time" value={`${result.standbyHours} h`} />
        </Rowed>

        {errors.map((i, n) => <IssueBanner key={`e${n}`} issue={i} />)}
        {warnings.map((i, n) => <IssueBanner key={`w${n}`} issue={i} />)}

        <H2>Standby period</H2>
        <Card>
          <Pressable onPress={() => setMonitored(true)} style={{ paddingVertical: t.space(2) }}>
            <Rowed gap={3}>
              <Radio on={monitored} />
              <View style={{ flex: 1 }}>
                <Txt weight="600">Supply failure monitored: 24 h</Txt>
                <Txt size="sm" tone="muted">PSU fault monitored, e.g. brigade-connected.</Txt>
              </View>
            </Rowed>
          </Pressable>
          <Divider />
          <Pressable onPress={() => setMonitored(false)} style={{ paddingVertical: t.space(2) }}>
            <Rowed gap={3}>
              <Radio on={!monitored} />
              <View style={{ flex: 1 }}>
                <Txt weight="600">Not monitored: 72 h</Txt>
                <Txt size="sm" tone="muted">About three times the battery.</Txt>
              </View>
            </Rowed>
          </Pressable>
        </Card>

        <H2>Load schedule</H2>
        <Txt size="sm" tone="muted">Standby and alarm current per line, in mA.</Txt>

        {drafts.length === 0 ? (
          <Txt size="sm" tone="faint">No loads yet. Start with the panel.</Txt>
        ) : null}

        {drafts.map((l) => (
          <LoadRow
            key={l.id}
            load={l}
            onChange={(patch) => update(l.id, patch)}
            onRemove={() => setDrafts((prev) => prev.filter((x) => x.id !== l.id))}
            onPickDevice={() => setPickingFor(l.id)}
          />
        ))}

        <Rowed gap={2}>
          <Button
            title="Add load"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => add(draftFromFigures(nextId(), { label: '' }))}
            icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
          />
          <Button
            title="Door holders"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => add(draftFromFigures(nextId(), { label: 'Door holders', alarmMa: 0, note: 'Draw in standby, release in alarm.' }))}
          />
        </Rowed>
        <Rowed gap={2}>
          <Button
            title="ASE"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => add(draftFromFigures(nextId(), { label: 'ASE', isAse: true, note: 'Qty 0 if the site has none.' }))}
          />
          <Button title="VESDA" variant="secondary" style={{ flex: 1 }} onPress={() => setVesdaOpen(true)} />
        </Rowed>

        <H2>Conditions</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Alarm time" value={alarmMinutes} onChangeText={setAlarmMinutes} keyboardType="decimal-pad" suffix="min" />
          </View>
          <View style={{ flex: 1 }}>
            {/* The default keyboard, because a battery room can sit below zero and decimal-pad has no minus. */}
            <Field
              label="Battery temp"
              value={tempC}
              onChangeText={setTempC}
              keyboardType="default"
              suffix="°C"
              hint="Formula valid 15–30 °C"
            />
          </View>
        </Rowed>

        {mode === 'service' ? (
          <>
            <Segmented
              value={String(ageing)}
              onChange={(v) => setAgeing(parseFloat(v))}
              options={[
                { value: String(L_DESIGN), label: `Under 12 months (${L_DESIGN})` },
                { value: String(L_IN_SERVICE), label: `Over 12 months (${L_IN_SERVICE})` },
              ]}
            />
            <Field
              label="Installed battery"
              value={installedAh}
              onChangeText={setInstalledAh}
              keyboardType="decimal-pad"
              suffix="Ah"
              hint="Nameplate Ah of the fitted battery"
            />
            {ready && result.installedPasses !== undefined ? (
              <Banner
                tone={result.installedPasses ? 'pass' : 'fail'}
                title={result.installedPasses ? 'Installed battery is adequate' : 'Installed battery is undersized'}
                body={`${installedAh} Ah fitted, ${result.requiredAh.toFixed(2)} Ah required.`}
              />
            ) : null}
          </>
        ) : null}

        <H2>Panel and power supply</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Panel max battery" value={panelMaxAh} onChangeText={setPanelMaxAh} keyboardType="decimal-pad" suffix="Ah" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="PSU output" value={psuOutput} onChangeText={setPsuOutput} keyboardType="decimal-pad" suffix="A" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Charge current" value={psuCharge} onChangeText={setPsuCharge} keyboardType="decimal-pad" suffix="A" />
          </View>
        </Rowed>
        {supplyNote ? <Txt size="xs" tone="faint">{supplyNote}</Txt> : null}

        {ready && result.charger ? (
          <Card>
            <Label>Charger check</Label>
            <View style={{ gap: t.space(1.5), marginTop: t.space(2) }}>
              <CheckLine
                label="Restores 80% within 24 h"
                detail={`Needs at least ${result.charger.minimumChargeA.toFixed(2)} A`}
                state={result.charger.rechargeOk}
              />
              <CheckLine
                label="Charges while carrying the load"
                detail={`Needs at least ${result.charger.requiredContinuousA.toFixed(2)} A continuous`}
                state={result.charger.simultaneousOk}
              />
            </View>
          </Card>
        ) : null}

        {ready ? (
          <>
            <H2>Working</H2>
            <Card>
              <Txt mono size="sm" tone="muted" style={{ lineHeight: 21 }}>
                C20 = L × [(Iq × Tq) + Fc × (Ia × Ta)]
              </Txt>
              <Divider />
              <WorkingLine label="Standby term (Iq × Tq)" value={`${result.standbyAh.toFixed(3)} Ah`} />
              <WorkingLine label={`Alarm term (Fc=${FC_DEFAULT} × Ia × Ta)`} value={`${result.alarmAh.toFixed(3)} Ah`} />
              <WorkingLine label="Subtotal" value={`${result.subtotalAh.toFixed(3)} Ah`} />
              <WorkingLine label={`× L = ${factor}`} value={`${result.requiredAh.toFixed(2)} Ah`} strong />
            </Card>
          </>
        ) : null}

        {ready && result.effectiveDerating !== undefined ? (
          <>
            <Pressable onPress={() => setShowWhy((v) => !v)}>
              <Rowed gap={1}>
                <Txt size="sm" tone="accent" weight="700">
                  {showWhy ? 'Hide' : `Why Fc = ${FC_DEFAULT}?`}
                </Txt>
                <MaterialCommunityIcons
                  name={showWhy ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={t.color.accentText}
                />
              </Rowed>
            </Pressable>
            {showWhy ? (
              <Card>
                <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
                  Fast discharge cuts capacity. At {result.alarmCRate?.toFixed(3)}C this system needs about{' '}
                  {result.effectiveDerating.toFixed(2)}×. Always use Fc = {FC_DEFAULT}.
                </Txt>
              </Card>
            ) : null}
          </>
        ) : null}

        {ready ? (
          <>
            <H2>Baseline data</H2>
            <Card>
              <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2) }}>Power supply items for the record.</Txt>
              {appendixFFields(result).map((f) => (
                <View key={f.item} style={{ paddingVertical: t.space(1.5) }}>
                  <Txt size="xs" tone="faint" weight="700">{f.item}  {f.field}</Txt>
                  <Txt size="sm" weight="600">{f.value}</Txt>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {infos.map((i, n) => <IssueBanner key={`i${n}`} issue={i} />)}

        <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>Confirm against AS 1670.1 and the panel manual.</Txt>
        <DevicePicker
          visible={pickingFor !== null}
          onClose={() => setPickingFor(null)}
          onPick={applyDevice}
        />
        <VesdaPicker
          visible={vesdaOpen}
          onClose={() => setVesdaOpen(false)}
          onPickDevice={addVesda}
          onPickSupply={pickVesdaSupply}
        />
      </Screen>
    </>
  );
}

function LoadRow({
  load,
  onChange,
  onRemove,
  onPickDevice,
}: {
  load: LoadDraft;
  onChange: (patch: Partial<LoadDraft>) => void;
  onRemove: () => void;
  onPickDevice: () => void;
}) {
  const t = useTheme();
  const figures = loadFromDraft(load);
  return (
    <Card>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Load" value={load.label} onChangeText={(v) => onChange({ label: v })} placeholder="Description" />
        </View>
        <Pressable onPress={onRemove} hitSlop={10} style={{ paddingTop: 22 }}>
          <MaterialCommunityIcons name="close-circle-outline" size={22} color={t.color.textFaint} />
        </Pressable>
      </Rowed>
      <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
        <View style={{ flex: 0.8 }}>
          <Field label="Qty" value={load.quantity} onChangeText={(v) => onChange({ quantity: v })} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1.1 }}>
          <Field
            label="Standby"
            value={load.standbyMa}
            onChangeText={(v) => onChange({ standbyMa: v })}
            keyboardType="decimal-pad"
            suffix="mA"
          />
        </View>
        <View style={{ flex: 1.1 }}>
          <Field
            label="Alarm"
            value={load.alarmMa}
            onChangeText={(v) => onChange({ alarmMa: v })}
            keyboardType="decimal-pad"
            suffix="mA"
          />
        </View>
      </Rowed>
      {load.note ? <Txt size="xs" tone="faint" style={{ marginTop: 6 }}>{load.note}</Txt> : null}
      <Rowed style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <Txt size="xs" tone="faint" style={{ flex: 1 }}>
          Subtotal {(figures.quantity * figures.standbyMa).toFixed(1)} mA standby · {(figures.quantity * figures.alarmMa).toFixed(1)} mA alarm
        </Txt>
        <Button title="From catalogue" variant="ghost" compact onPress={onPickDevice} />
      </Rowed>
    </Card>
  );
}

/**
 * VESDA detectors, accessories and supplies, picked into the schedule.
 *
 * These were a screen of their own running this same calculation. As devices
 * here, a VESDA on a panel's supply and a VESDA on its own are sized the same
 * way, with the rest of the schedule beside them.
 */
function VesdaPicker({
  visible,
  onClose,
  onPickDevice,
  onPickSupply,
}: {
  visible: boolean;
  onClose: () => void;
  onPickDevice: (d: VesdaDevice) => void;
  onPickSupply: (p: VesdaPsu) => void;
}) {
  const t = useTheme();
  const [tab, setTab] = useState<'detector' | 'accessory' | 'supply'>('detector');
  const devices = useMemo(() => vesdaDevices(), []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <Screen scroll={false} padded={false} edges={['top']}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt size="lg" weight="700">VESDA</Txt>
            <Button title="Close" variant="ghost" compact onPress={onClose} />
          </Rowed>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'detector', label: 'Detectors' },
              { value: 'accessory', label: 'Accessories' },
              { value: 'supply', label: 'Supplies' },
            ]}
          />
          <Txt size="xs" tone="faint">
            {tab === 'supply' ? 'Fills panel max battery and PSU output.' : 'Watts converted at 24 V. Adds a load line.'}
          </Txt>
        </View>
        {tab === 'supply' ? (
          <FlatList
            data={VESDA_PSUS}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(10), gap: t.space(2) }}
            renderItem={({ item }) => (
              <Card onPress={() => onPickSupply(item)}>
                <Txt mono size="sm" weight="700" tone="accent">{item.model}</Txt>
                <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
                  {item.ratedA} A · {item.maxBatteryAh} Ah max{item.note ? ` · ${item.note}` : ''}
                </Txt>
                {!item.verified ? <Chip label="Distributor figures" tone="warn" /> : null}
              </Card>
            )}
          />
        ) : (
          <FlatList
            data={devices.filter((d) => d.kind === tab)}
            keyExtractor={(d) => d.id}
            contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(10), gap: t.space(2) }}
            renderItem={({ item }) => (
              <Card onPress={() => onPickDevice(item)}>
                <Txt weight="600">{item.label}</Txt>
                <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>{item.detail}</Txt>
                <Txt size="xs" tone="faint" style={{ marginTop: 2 }}>
                  {figureText(item.standbyMa)} mA standby · {figureText(item.alarmMa)} mA alarm
                </Txt>
              </Card>
            )}
          />
        )}
      </Screen>
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.color.surface,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.color.border,
        padding: t.space(2.5),
      }}
    >
      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Txt>
      <Txt size="lg" weight="700">{value}</Txt>
    </View>
  );
}

function Radio({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: on ? t.color.accent : t.color.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
      }}
    >
      {on ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: t.color.accent }} /> : null}
    </View>
  );
}

function CheckLine({ label, detail, state }: { label: string; detail: string; state: boolean | null }) {
  const t = useTheme();
  const icon = state === null ? 'help-circle-outline' : state ? 'check-circle' : 'alert-circle';
  const colour = state === null ? t.color.textFaint : state ? t.color.pass : t.color.fail;
  return (
    <Rowed gap={2} align="flex-start">
      <MaterialCommunityIcons name={icon} size={18} color={colour} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight="600">{label}</Txt>
        <Txt size="xs" tone="muted">{state === null ? 'Enter the supply figures to check' : detail}</Txt>
      </View>
    </Rowed>
  );
}

function WorkingLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
      <Txt size="sm" tone={strong ? 'default' : 'muted'} weight={strong ? '700' : '400'}>{label}</Txt>
      <Txt size="sm" mono weight={strong ? '700' : '400'}>{value}</Txt>
    </Rowed>
  );
}

function IssueBanner({ issue }: { issue: Issue }) {
  return (
    <Banner
      tone={issue.level === 'error' ? 'fail' : issue.level === 'warning' ? 'warn' : 'info'}
      title={issue.title}
      body={issue.detail}
    />
  );
}
