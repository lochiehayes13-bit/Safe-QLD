import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  addAssetEvent, assetTimeline, getAsset, updateAsset,
  type AssetEvent, type AssetEventKind, type AssetRecord,
} from '@/db/assetRepo';
import {
  changesForAsset, nextChangeNo, queueAssetChange, undoAssetChange, type AssetChangeView,
} from '@/db/assetChangeRepo';
import { assetTypeById, SYSTEM_LABELS, type AttributeDef } from '@/seed/assetTypes';
import { getSite } from '@/db/repo';
import { assetSchedule } from '@/db/registerRepo';
import {
  REGISTER_DUE_LABEL, registerAttributes, registerScheduleLines,
  type RegisterScheduleLine, type RegisterScheduleRow,
} from '@/domain/registerSchedule';
import {
  buildArchive, buildDelete, buildUpdate, changedFields, describeAssetChange, describeChangeState, diffFields,
  undoMsLeft, updateHasContent, type BuiltChange,
} from '@/domain/assetChanges';
import { customFieldsByName, officeTypeForApp, type OfficeCustomField } from '@/simpro/assetTypes';
import { listOfficeAssetTypes } from '@/db/assetTypeRepo';
import { flushSoon } from '@/simpro/flushSoon';
import type { Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { RecordGate } from '@/components/RecordGate';
import { describeLoadFailure } from '@/domain/loadFailure';

/**
 * Asset detail and timeline.
 *
 * The timeline is the reason this screen exists. A list of attributes tells you
 * what something is; the history tells you whether it can be trusted, and why
 * it keeps failing.
 *
 * It is also where the register is corrected. An asset the office holds can
 * be edited here and the edit goes to Simpro, or archived there, or deleted
 * there; each is queued with half a minute to take it back, and the list at
 * the bottom says what became of every change asked for from this screen.
 */
const EVENT_ICON: Record<AssetEventKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  installed: 'plus-circle-outline',
  tested: 'clipboard-check-outline',
  passed: 'check-circle-outline',
  failed: 'close-circle-outline',
  cleaned: 'spray-bottle',
  repaired: 'wrench-outline',
  replaced: 'autorenew',
  isolated: 'pause-circle-outline',
  restored: 'play-circle-outline',
  'defect-raised': 'alert-circle-outline',
  'defect-cleared': 'check-decagram-outline',
  'not-tested': 'help-circle-outline',
  moved: 'map-marker-outline',
  noted: 'note-text-outline',
};

const EVENT_TONE: Partial<Record<AssetEventKind, 'pass' | 'fail' | 'warn'>> = {
  passed: 'pass',
  restored: 'pass',
  'defect-cleared': 'pass',
  failed: 'fail',
  'defect-raised': 'fail',
  isolated: 'warn',
  'not-tested': 'warn',
};

/** The columns a person can change here; the type attributes and register fields ride beside them. */
interface EditForm {
  name: string;
  locationNote: string;
  level: string;
  room: string;
  manufacturer: string;
  model: string;
  serial: string;
  installedDate: string;
  notes: string;
  attributes: Record<string, string>;
}

const formFrom = (a: AssetRecord): EditForm => ({
  name: a.name ?? '',
  locationNote: a.locationNote ?? '',
  level: a.level ?? '',
  room: a.room ?? '',
  manufacturer: a.manufacturer ?? '',
  model: a.model ?? '',
  serial: a.serial ?? '',
  installedDate: a.installedDate ?? '',
  notes: a.notes ?? '',
  attributes: Object.fromEntries(Object.entries(a.attributes).map(([k, v]) => [k, String(v)])),
});

const blank = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

/** A change still inside its window, and what to put back if it is taken back. */
interface Undoable {
  changeId: string;
  notBefore: string;
  label: string;
  revert: Partial<AssetRecord>;
}

const isSimproAsset = (a: AssetRecord): a is AssetRecord & { externalId: string } =>
  a.externalSource === 'simpro' && Boolean(a.externalId);

export default function AssetScreen() {
  const t = useTheme();
  const { id, change: changeParam } = useLocalSearchParams<{ id: string; change?: string }>();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [schedule, setSchedule] = useState<RegisterScheduleRow[]>([]);
  const [changes, setChanges] = useState<AssetChangeView[]>([]);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<Undoable | null>(null);
  // Ticks once a second while a change can still be taken back, for the countdown.
  const [now, setNow] = useState(nowIso());
  /*
   * The office's own fields for this asset's type, by name, read from the
   * table the sync fills and never from the network: a List field the
   * office wrote 26 choices for should be those 26 choices here, not a
   * free-text box where "Dry Chem" gets typed at a list that says "Dry
   * Chemical Powder". Empty where the table has not been filled, and then
   * every field is a box as before.
   */
  const [officeFields, setOfficeFields] = useState<Map<string, OfficeCustomField>>(new Map());

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const a = await getAsset(id);
      setAsset(a);
      setMissing(!a);
      if (a) {
        const [s, e, sched, ch] = await Promise.all([
          getSite(a.siteId), assetTimeline(a.id), assetSchedule(a.id), changesForAsset(a.id),
        ]);
        setSite(s);
        setEvents(e);
        setSchedule(sched);
        setChanges(ch);
        const officeTypes = await listOfficeAssetTypes();
        const mine = officeTypes.length
          ? officeTypeForApp(a.assetTypeId, officeTypes, {
            simproType: typeof a.attributes.simproType === 'string' ? a.attributes.simproType : undefined,
            registerSystem: typeof a.attributes.registerSystem === 'string' ? a.attributes.registerSystem : undefined,
          })
          : undefined;
        setOfficeFields(new Map((mine?.customFields ?? []).map((f) => [f.name.trim().toLowerCase(), f])));
        // Opened from New asset with the create just queued: the window is
        // still open, and the banner offers it.
        const fresh = changeParam ? ch.find((c) => c.id === changeParam && c.state === 'undoable') : undefined;
        if (fresh) {
          setUndo((held) => held ?? {
            changeId: fresh.id, notBefore: fresh.notBefore, label: describeAssetChange(fresh.kind, fresh.payload), revert: {},
          });
        }
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this asset'));
    }
  }, [id, changeParam]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!undo) return;
    const timer = setInterval(() => {
      const at = nowIso();
      setNow(at);
      if (undoMsLeft(at, undo.notBefore) === 0) {
        setUndo(null);
        // The window has closed: ask the queue to go now rather than at
        // the next timer, so a phone with signal sends within seconds.
        flushSoon();
        void load();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [undo, load]);

  const record = async (kind: AssetEventKind, summary: string) => {
    if (!asset) return;
    const prefs = await loadPrefs();
    await addAssetEvent({
      assetId: asset.id,
      kind,
      occurredAt: nowIso(),
      technician: prefs.technicianName || undefined,
      summary,
    });
    // Keep the denormalised service state on the asset in step with its history.
    if (kind === 'passed' || kind === 'failed') {
      await updateAsset(asset.id, { lastServicedAt: nowIso(), lastResult: kind === 'passed' ? 'pass' : 'fail' });
    }
    void load();
  };

  /** Queues a built change and opens its window on the screen. */
  const queue = async (built: BuiltChange, revert: Partial<AssetRecord>) => {
    const { change } = await queueAssetChange(built);
    setUndo({ changeId: change.id, notBefore: change.notBefore, label: describeAssetChange(change.kind, change.payload), revert });
    setNow(nowIso());
    flushSoon();
  };

  const takeBack = async () => {
    if (!asset || !undo) return;
    const held = undo;
    try {
      const outcome = await undoAssetChange(held.changeId);
      if (outcome.status === 'undone') {
        if (Object.keys(held.revert).length) await updateAsset(asset.id, held.revert);
        setUndo(null);
        showAlert('Taken back', 'Nothing was sent to the office.');
      } else {
        setUndo(null);
        showAlert('Too late to take back', 'The change has already left the phone. Ask the office to reverse it, or make the opposite change here.');
      }
      void load();
    } catch (e) {
      showAlert('Could not take it back', e instanceof Error ? e.message : String(e));
    }
  };

  const saveEdit = async () => {
    if (!asset || !form) return;
    setSaving(true);
    try {
      const after: AssetRecord = {
        ...asset,
        name: form.name.trim() || asset.name,
        locationNote: blank(form.locationNote),
        level: blank(form.level),
        room: blank(form.room),
        manufacturer: blank(form.manufacturer),
        model: blank(form.model),
        serial: blank(form.serial),
        installedDate: blank(form.installedDate),
        notes: blank(form.notes),
        attributes: Object.fromEntries(Object.entries(form.attributes).filter(([, v]) => v.trim() !== '')),
      };
      const changed = changedFields(asset, after);
      if (!changed.length) {
        setEditing(false);
        return;
      }
      const revert: Partial<AssetRecord> = {
        name: asset.name, locationNote: asset.locationNote ?? undefined, level: asset.level ?? undefined,
        room: asset.room ?? undefined, manufacturer: asset.manufacturer ?? undefined, model: asset.model ?? undefined,
        serial: asset.serial ?? undefined, installedDate: asset.installedDate ?? undefined,
        notes: asset.notes ?? undefined, attributes: asset.attributes,
      };
      await updateAsset(asset.id, {
        name: after.name, locationNote: after.locationNote, level: after.level, room: after.room,
        manufacturer: after.manufacturer, model: after.model, serial: after.serial,
        installedDate: after.installedDate, notes: after.notes, attributes: after.attributes,
      });
      setEditing(false);

      if (isSimproAsset(asset)) {
        // Only what the office would notice: its own fields, by name, and
        // the start date. The phone's name for the asset and its notes are
        // the phone's.
        const fields = diffFields(customFieldsByName(asset), customFieldsByName(after));
        const startDate = changed.includes('installedDate') ? after.installedDate ?? '' : undefined;
        const built = buildUpdate({
          assetId: asset.id,
          assetExternalId: asset.externalId,
          fields,
          startDate,
          label: after.name,
        }, { now: nowIso(), changeNo: await nextChangeNo(asset.id) });
        if (updateHasContent(built.payload)) await queue(built, revert);
        else showAlert('Saved on the phone', 'Nothing the office holds changed, so nothing was sent to Simpro.');
      }
      void load();
    } catch (e) {
      showAlert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const archiveInSimpro = async () => {
    if (!asset || !isSimproAsset(asset)) return;
    try {
      await updateAsset(asset.id, { status: 'decommissioned' });
      const built = buildArchive(
        { assetId: asset.id, assetExternalId: asset.externalId, previousStatus: asset.status, label: asset.name },
        { now: nowIso(), changeNo: await nextChangeNo(asset.id) },
      );
      await queue(built, { status: asset.status });
      void load();
    } catch (e) {
      showAlert('Could not queue it', e instanceof Error ? e.message : String(e));
    }
  };

  const deleteFromSimpro = async () => {
    if (!asset || !isSimproAsset(asset)) return;
    try {
      await updateAsset(asset.id, { status: 'removed' });
      const built = buildDelete(
        { assetId: asset.id, assetExternalId: asset.externalId, previousStatus: asset.status, label: asset.name },
        { now: nowIso(), changeNo: await nextChangeNo(asset.id) },
      );
      await queue(built, { status: asset.status });
      void load();
    } catch (e) {
      showAlert('Could not queue it', e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Archive by default, delete behind a second question. An archived asset
   * the office can bring back; a deleted one it cannot, and the words say
   * so before the tap that does it.
   */
  const askToRemove = () => {
    showAlert(
      'Remove from Simpro?',
      'Archiving takes it off the register but the office can bring it back. Deleting removes it for good.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', onPress: () => { void archiveInSimpro(); } },
        {
          text: 'Delete for good',
          style: 'destructive',
          onPress: () => showAlert(
            'Delete from Simpro?',
            'This cannot be undone in the office once it has gone. You have half a minute on this screen to take it back before it is sent.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => { void deleteFromSimpro(); } },
            ],
          ),
        },
      ],
    );
  };

  if (!asset) return <RecordGate missing={missing} what="asset" failed={failed} onRetry={() => { void load(); }} />;

  const type = assetTypeById(asset.assetTypeId);
  const failures = events.filter((e) => e.kind === 'failed').length;
  const attributes: AttributeDef[] = type?.attributes ?? [];
  const routines = registerScheduleLines(schedule, nowIso());
  const fromRegister = registerAttributes(asset.attributes, attributes.map((a) => a.key));
  const simpro = isSimproAsset(asset);
  const secondsLeft = undo ? Math.ceil(undoMsLeft(now, undo.notBefore) / 1000) : 0;

  return (
    <>
      <Stack.Screen options={{ title: asset.name || type?.label || 'Asset' }} />
      <Screen>
        <View>
          <Txt size="xl" weight="700">{asset.name || type?.label}</Txt>
          {asset.code ? <Txt size="sm" mono tone="accent">{asset.code}</Txt> : null}
          <Txt size="sm" tone="muted">
            {[type?.label, site?.name, asset.level, asset.room].filter(Boolean).join(' · ')}
          </Txt>
        </View>

        {undo && secondsLeft > 0 ? (
          <Card>
            <Txt weight="700">{undo.label}</Txt>
            <Txt size="sm" tone="muted" style={{ marginTop: 4 }}>
              Not sent yet. Goes to the office in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}, or when the phone next has signal after that.
            </Txt>
            <Rowed gap={2} style={{ marginTop: t.space(2) }}>
              <Button title="Undo" variant="secondary" compact onPress={() => { void takeBack(); }} />
            </Rowed>
          </Card>
        ) : null}

        <Rowed gap={2} wrap>
          {type ? <Chip label={SYSTEM_LABELS[type.system]} /> : null}
          <Chip
            label={asset.status}
            tone={asset.status === 'in-service' ? 'pass' : asset.status === 'isolated' ? 'warn' : 'fail'}
          />
          {asset.lastResult ? (
            <Chip label={`Last ${asset.lastResult}`} tone={asset.lastResult === 'pass' ? 'pass' : 'fail'} />
          ) : null}
          {asset.openDefects ? <Chip label={`${asset.openDefects} open defect`} tone="fail" /> : null}
          {simpro ? <Chip label="In Simpro" /> : null}
        </Rowed>

        {asset.notes?.trim() && !editing ? (
          /*
            * The asset's own note, off the register — 453 of the real ones
            * carry it and nothing was showing it. "Switchboard in office, use
            * test switch" and "logbook inside switchboard" are read before the
            * work starts, not after, so this sits above the record buttons
            * rather than under the details at the bottom.
            */
          <Banner tone="info" title="Note on this asset" body={asset.notes.trim()} />
        ) : null}

        {failures >= 3 ? (
          <Banner
            tone="warn"
            title={`This has failed ${failures} times`}
            body="Repeated failure on one asset is usually the environment, the location or the device type — worth a root cause rather than another replacement."
          />
        ) : null}

        {editing && form ? (
          <>
            <H2>Edit</H2>
            {simpro ? (
              <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                The office identifies this asset by its Location and the fields from the register below; those go to Simpro when you save. The name, notes, level and room are the phone's own.
              </Txt>
            ) : null}
            <Field label="Name or description" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
            <Field
              label={simpro ? 'Location (as the office records it)' : 'Location'}
              value={form.locationNote}
              onChangeText={(v) => setForm({ ...form, locationNote: v })}
            />
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Level" value={form.level} onChangeText={(v) => setForm({ ...form, level: v })} /></View>
              <View style={{ flex: 1 }}><Field label="Room / area" value={form.room} onChangeText={(v) => setForm({ ...form, room: v })} /></View>
            </Rowed>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Manufacturer" value={form.manufacturer} onChangeText={(v) => setForm({ ...form, manufacturer: v })} /></View>
              <View style={{ flex: 1 }}><Field label="Model" value={form.model} onChangeText={(v) => setForm({ ...form, model: v })} /></View>
            </Rowed>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Serial" value={form.serial} onChangeText={(v) => setForm({ ...form, serial: v })} autoCapitalize="characters" /></View>
              <View style={{ flex: 1 }}><Field label="Installed" value={form.installedDate} onChangeText={(v) => setForm({ ...form, installedDate: v })} placeholder="YYYY-MM-DD" /></View>
            </Rowed>
            <Field label="Note on this asset" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline />

            {fromRegister.length ? (
              <>
                <H2>From the register</H2>
                {fromRegister.map((a) => (
                  <RegisterField
                    key={a.key}
                    label={a.label}
                    office={officeFields.get(a.key.trim().toLowerCase())}
                    value={form.attributes[a.key] ?? ''}
                    onChange={(v) => setForm({ ...form, attributes: { ...form.attributes, [a.key]: v } })}
                  />
                ))}
              </>
            ) : null}

            {attributes.length ? (
              <>
                <H2>{type?.label ?? 'Type'} details</H2>
                {attributes.map((attr) => (
                  <AttributeField
                    key={attr.key}
                    attr={attr}
                    value={form.attributes[attr.key] ?? ''}
                    onChange={(v) => setForm({ ...form, attributes: { ...form.attributes, [attr.key]: v } })}
                  />
                ))}
              </>
            ) : null}

            <Rowed gap={2}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => { setEditing(false); setForm(null); }} />
              <Button title="Save" style={{ flex: 1 }} loading={saving} onPress={() => { void saveEdit(); }} />
            </Rowed>
          </>
        ) : null}

        {routines.length ? (
          <>
            <H2>What the register says is due</H2>
            {/*
              * One line per routine, because they are different visits. An
              * extinguisher's six-monthly is a look and a tag; its five-yearly
              * takes the extinguisher off site. The asset's own due date is the
              * soonest of these and cannot say which.
              */}
            <Card>
              {routines.map((r, i) => (
                <View key={r.frequency}>
                  {i > 0 ? <Divider /> : null}
                  <Rowed>
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">{r.label}</Txt>
                      {r.lastDone ? (
                        <Txt size="sm" tone="muted">
                          Last done {r.lastDone}
                          {r.lastDoneImprecise ? ' — the register records no day for it' : ''}
                        </Txt>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Chip label={REGISTER_DUE_LABEL[r.state]} tone={toneForDue(r)} />
                      {r.nextDueAt ? <Txt size="sm">{formatAuDate(r.nextDueAt)}</Txt> : null}
                    </View>
                  </Rowed>
                </View>
              ))}
            </Card>
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              These dates come from the office system's own register, as exported. They are not
              worked out from the service history on this device, and where the two disagree the
              service history is the record of what was actually done.
            </Txt>
          </>
        ) : null}

        <H2>Record</H2>
        <Rowed gap={2} wrap>
          <Button title="Passed" variant="secondary" compact onPress={() => record('passed', 'Tested — passed')} />
          <Button title="Failed" variant="danger" compact onPress={() => record('failed', 'Tested — failed')} />
          <Button title="Cleaned" variant="secondary" compact onPress={() => record('cleaned', 'Cleaned')} />
          <Button title="Replaced" variant="secondary" compact onPress={() => record('replaced', 'Replaced')} />
        </Rowed>
        <Rowed gap={2}>
          <Button
            title="Raise defect"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              router.push({
                pathname: '/work/defect/new',
                params: { siteId: asset.siteId, assetId: asset.id, location: [asset.level, asset.room, asset.name].filter(Boolean).join(' ') },
              })
            }
          />
          {/*
            The timeline above says what happened at each service. This says
            what has been happening across them, which is the question a single
            reading cannot answer.
          */}
          <Button
            title="Trend"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/assets/trend', params: { id: asset.id } })}
          />
        </Rowed>
        {!editing ? (
          <Rowed gap={2}>
            <Button
              title="Edit"
              variant="secondary"
              style={{ flex: 1 }}
              disabled={asset.status === 'removed'}
              onPress={() => { setForm(formFrom(asset)); setEditing(true); }}
            />
            {simpro ? (
              <Button
                title="Remove from Simpro"
                variant="danger"
                style={{ flex: 1 }}
                disabled={asset.status === 'removed' || Boolean(undo)}
                onPress={askToRemove}
              />
            ) : null}
          </Rowed>
        ) : null}

        <Rowed gap={2} align="flex-end">
          <View style={{ flex: 1 }}>
            <Field label="Add a note" value={note} onChangeText={setNote} placeholder="Anything the next person should know" />
          </View>
          <Button
            title="Add"
            compact
            disabled={!note.trim()}
            onPress={async () => { await record('noted', note.trim()); setNote(''); }}
          />
        </Rowed>

        {fromRegister.length && !editing ? (
          <>
            <H2>From the register</H2>
            {/*
              * What the office system said about this asset that the type
              * definition has no field for. The importer keeps these columns
              * deliberately and nothing was showing them — including the asset
              * number, which is how somebody holding the device says which row
              * of the register this is.
              */}
            <Card>
              {fromRegister.map((a, i) => (
                <View key={a.key}>
                  {i > 0 ? <Divider /> : null}
                  <Label>{a.label}</Label>
                  <Txt mono={a.key === 'assetNumber'}>{a.value}</Txt>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {attributes.length && !editing ? (
          <>
            <H2>Details</H2>
            <Card>
              {attributes.map((a, i) => {
                const value = asset.attributes[a.key];
                if (value === undefined || value === '') return null;
                return (
                  <View key={a.key}>
                    {i > 0 ? <Divider /> : null}
                    <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                      <Txt size="sm" tone="muted">{a.label}</Txt>
                      <Txt size="sm" weight="600">
                        {String(value)}{a.unit ? ` ${a.unit}` : ''}
                      </Txt>
                    </Rowed>
                  </View>
                );
              })}
              {asset.manufacturer || asset.model ? (
                <>
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                    <Txt size="sm" tone="muted">Make and model</Txt>
                    <Txt size="sm" weight="600">{[asset.manufacturer, asset.model].filter(Boolean).join(' ')}</Txt>
                  </Rowed>
                </>
              ) : null}
              {asset.serial ? (
                <>
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                    <Txt size="sm" tone="muted">Serial</Txt>
                    <Txt size="sm" mono weight="600">{asset.serial}</Txt>
                  </Rowed>
                </>
              ) : null}
              {asset.installedDate ? (
                <>
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
                    <Txt size="sm" tone="muted">Installed</Txt>
                    <Txt size="sm" weight="600">{formatAuDate(asset.installedDate)}</Txt>
                  </Rowed>
                </>
              ) : null}
            </Card>
          </>
        ) : null}

        {changes.length ? (
          <>
            <H2>Changes sent to the office</H2>
            {/*
              * Every change asked for from this screen and where it has got
              * to, in words: waiting for its window, waiting for signal,
              * sent, refused in the server's own words, or in doubt. A
              * refusal here is the same row as on Waiting to send, which is
              * where it can be sent again or let go.
              */}
            <Card>
              {changes.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Divider /> : null}
                  <Rowed align="flex-start" style={{ paddingVertical: t.space(1) }}>
                    <View style={{ flex: 1 }}>
                      <Txt size="sm" weight="600">{describeAssetChange(c.kind, c.payload)}</Txt>
                      <Txt size="xs" tone={c.state === 'failed' ? 'fail' : c.state === 'sent' ? 'pass' : 'muted'} style={{ lineHeight: 17 }}>
                        {describeChangeState(c.state, c.lastError ?? c.error)} · {formatAuDate(c.createdAt)}
                      </Txt>
                    </View>
                    {c.state === 'undoable' && undo?.changeId !== c.id ? (
                      <Button
                        title="Undo"
                        variant="secondary"
                        compact
                        onPress={() => {
                          setUndo({ changeId: c.id, notBefore: c.notBefore, label: describeAssetChange(c.kind, c.payload), revert: {} });
                          setNow(nowIso());
                        }}
                      />
                    ) : null}
                  </Rowed>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <H2>History</H2>
        {events.length ? (
          <Card>
            {events.map((e, i) => (
              <View key={e.id}>
                {i > 0 ? <Divider /> : null}
                <Rowed gap={3} align="flex-start" style={{ paddingVertical: t.space(2) }}>
                  <MaterialCommunityIcons
                    name={EVENT_ICON[e.kind] ?? 'circle-small'}
                    size={18}
                    color={
                      EVENT_TONE[e.kind] === 'pass' ? t.color.pass
                      : EVENT_TONE[e.kind] === 'fail' ? t.color.fail
                      : EVENT_TONE[e.kind] === 'warn' ? t.color.warn
                      : t.color.textFaint
                    }
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Txt size="sm" weight="600">{e.summary}</Txt>
                    {e.detail ? <Txt size="xs" tone="muted" style={{ lineHeight: 18 }}>{e.detail}</Txt> : null}
                    <Txt size="xs" tone="faint">
                      {formatAuDate(e.occurredAt)}{e.technician ? ` · ${e.technician}` : ''}
                      {e.photos.length ? ` · ${e.photos.length} photo${e.photos.length === 1 ? '' : 's'}` : ''}
                    </Txt>
                  </View>
                </Rowed>
              </View>
            ))}
          </Card>
        ) : (
          <Txt tone="faint" size="sm">Nothing recorded yet. Everything done to this asset from now on lands here.</Txt>
        )}
      </Screen>
    </>
  );
}

function toneForDue(line: RegisterScheduleLine): 'default' | 'pass' | 'warn' | 'fail' {
  if (line.state === 'overdue') return 'fail';
  if (line.state === 'due') return 'warn';
  // Inside a fortnight is the one worth noticing on a screen somebody opens
  // while standing in front of the asset.
  if (line.state === 'upcoming' && (line.daysUntil ?? Infinity) <= 14) return 'warn';
  return 'default';
}

/**
 * Whichever input the attribute definition calls for — the same three
 * shapes New asset renders, kept here rather than imported from a route
 * file, which expo-router treats as a screen.
 */
/**
 * One field the office owns, edited the way the office defines it.
 *
 * A List field is its own choices and nothing else, because a value the
 * office's list does not have is a value Simpro refuses — and the refusal
 * arrives long after the technician has driven away. A locked field is the
 * office's to set: shown, never edited, and said so, since a box that
 * silently discards what is typed into it is worse than no box.
 */
function RegisterField({ label, office, value, onChange }: {
  label: string; office: OfficeCustomField | undefined; value: string; onChange: (v: string) => void;
}) {
  const t = useTheme();

  if (office?.locked) {
    return (
      <View style={{ gap: 2 }}>
        <Label>{label}</Label>
        <Txt size="sm" tone={value ? 'default' : 'faint'}>{value || 'Not set'}</Txt>
        <Txt size="xs" tone="faint">The office locked this one; it can only be changed in Simpro.</Txt>
      </View>
    );
  }

  if (office?.type === 'List' && office.listItems.length) {
    return (
      <View style={{ gap: t.space(1.5) }}>
        <Label>{label}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
          {office.listItems.map((o) => (
            <Chip key={o} label={o} selected={value === o} onPress={() => onChange(value === o ? '' : o)} />
          ))}
        </View>
        {value && !office.listItems.includes(value) ? (
          <Txt size="xs" tone="warn">
            This asset holds "{value}", which is not on the office's list. Picking one above replaces it.
          </Txt>
        ) : null}
      </View>
    );
  }

  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChange}
      keyboardType={office?.type === 'Numeric' ? 'decimal-pad' : 'default'}
      placeholder={office?.type === 'Date' ? 'YYYY-MM-DD' : undefined}
    />
  );
}

function AttributeField({ attr, value, onChange }: { attr: AttributeDef; value: string; onChange: (v: string) => void }) {
  const t = useTheme();

  if (attr.type === 'select' && attr.options?.length) {
    return (
      <View style={{ gap: t.space(1.5) }}>
        <Label>{attr.label}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
          {attr.options.map((o) => (
            <Chip key={o} label={o} selected={value === o} onPress={() => onChange(value === o ? '' : o)} />
          ))}
        </View>
      </View>
    );
  }

  if (attr.type === 'boolean') {
    return (
      <View style={{ gap: t.space(1.5) }}>
        <Label>{attr.label}</Label>
        <Segmented
          value={value || 'no'}
          onChange={onChange}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        />
      </View>
    );
  }

  return (
    <Field
      label={attr.label}
      value={value}
      onChangeText={onChange}
      keyboardType={attr.type === 'number' ? 'decimal-pad' : 'default'}
      suffix={attr.unit}
      placeholder={attr.type === 'date' ? 'YYYY-MM-DD' : undefined}
    />
  );
}
