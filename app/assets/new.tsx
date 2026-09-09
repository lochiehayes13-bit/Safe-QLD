import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { createAsset, nextAssetCode } from '@/db/assetRepo';
import { getSite, listSites } from '@/db/repo';
import { nextChangeNo, queueAssetChange } from '@/db/assetChangeRepo';
import { listOfficeAssetTypes } from '@/db/assetTypeRepo';
import {
  ASSET_TYPES, SYSTEM_LABELS, activeSystems, assetTypeById,
  type AssetTypeDef, type AttributeDef, type SystemKind,
} from '@/seed/assetTypes';
import { DevicePicker } from '@/components/DevicePicker';
import type { CatalogueItem } from '@/db/catalogueRepo';
import type { Site } from '@/domain/types';
import { buildCreate } from '@/domain/assetChanges';
import { customFieldsFor, officeTypeForApp, refreshAssetTypes, tagFor, type OfficeAssetType } from '@/simpro/assetTypes';
import { simproConfigFromPrefs } from '@/simpro/config';
import { flushSoon } from '@/simpro/flushSoon';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Field, H2, Label, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Adding an asset by hand.
 *
 * Attributes come from the type definition, so this one screen covers a
 * detector, a fire pump, an extinguisher and a fire door without knowing
 * anything about any of them.
 *
 * On a site the office holds, the asset can go to the office too. The
 * office files an asset under its own type, and that is chosen for the
 * person from the phone's type where the words match and asked for where
 * they do not. The create is queued rather than sent — the phone may be in
 * a basement — and the asset's own screen, which this one opens on save,
 * gives half a minute to take it back.
 */
export default function NewAssetScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; parentAssetId?: string; system?: string }>();
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [officeTypes, setOfficeTypes] = useState<OfficeAssetType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  // The office could not be asked for its types: the words, or null.
  const [typesFailed, setTypesFailed] = useState<string | null>(null);
  const [alsoInSimpro, setAlsoInSimpro] = useState(true);
  // The person's own choice of office type, over the suggestion.
  const [officeTypeOverride, setOfficeTypeOverride] = useState('');

  const draft = useDraft(`asset:new:${params.siteId ?? 'unassigned'}`, {
    siteId: params.siteId as string | undefined,
    system: (params.system as SystemKind | undefined) ?? ('detection' as SystemKind),
    assetTypeId: '',
    name: '',
    level: '',
    room: '',
    manufacturer: '',
    model: '',
    partNumber: '',
    serial: '',
    installedDate: '',
    attributes: {} as Record<string, string>,
  });
  const d = draft.value;
  const set = (patch: Partial<typeof d>) => draft.setValue((p) => ({ ...p, ...patch }));

  useEffect(() => {
    void listSites().then((list) => {
      setSites(list);
      if (!d.siteId && list.length === 1) set({ siteId: list[0]!.id });
    });
    // Runs once the draft is loaded so a recovered choice is not overwritten.
  }, [draft.ready]);

  useEffect(() => {
    if (!d.siteId) { setSite(null); return; }
    void getSite(d.siteId).then(setSite).catch(() => setSite(null));
  }, [d.siteId]);

  const simproSite = site?.externalSource === 'simpro' && site.externalId ? site : null;

  /**
   * The office's types, from the table, and from the office when the table
   * is empty: one read of the list and one per type for its fields, made
   * once. A failure is words on the screen, not a dead switch — the person
   * can still save the asset on the phone.
   */
  const loadOfficeTypes = async (force = false) => {
    setLoadingTypes(true);
    setTypesFailed(null);
    try {
      const held = force ? [] : await listOfficeAssetTypes();
      if (held.length) { setOfficeTypes(held); return; }
      const prefs = await loadPrefs();
      setOfficeTypes(await refreshAssetTypes(simproConfigFromPrefs(prefs)));
    } catch (e) {
      setTypesFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTypes(false);
    }
  };

  useEffect(() => {
    if (simproSite) void loadOfficeTypes();
  }, [simproSite?.id]);

  const type = useMemo(() => (d.assetTypeId ? assetTypeById(d.assetTypeId) : undefined), [d.assetTypeId]);
  const typesForSystem = useMemo(() => ASSET_TYPES.filter((x) => x.system === d.system), [d.system]);
  const suggestedOfficeType = useMemo(
    () => (d.assetTypeId ? officeTypeForApp(d.assetTypeId, officeTypes) : undefined),
    [d.assetTypeId, officeTypes],
  );
  const officeType = officeTypes.find((x) => x.id === officeTypeOverride) ?? suggestedOfficeType;

  useEffect(() => {
    if (d.assetTypeId) void nextAssetCode(d.assetTypeId).then(setCode);
  }, [d.assetTypeId]);

  const applyCatalogue = (item: CatalogueItem) => {
    set({
      manufacturer: item.brand,
      model: item.name,
      partNumber: item.partNumber,
      name: d.name || item.name,
    });
  };

  const save = async () => {
    if (!d.siteId) {
      showAlert('Which site?', 'Pick the site this asset belongs to.');
      return;
    }
    if (!d.assetTypeId) {
      showAlert('What is it?', 'Choose the asset type so the right details are recorded.');
      return;
    }
    const toSimpro = Boolean(simproSite && alsoInSimpro);
    if (toSimpro && !officeType) {
      showAlert(
        'Which office type?',
        officeTypes.length
          ? 'Pick the type the office files this under, or turn off "Also create in Simpro" to keep it on the phone only.'
          : 'The office\'s asset types have not been read yet, so the asset cannot be created there. Try again with signal, or turn off "Also create in Simpro" to keep it on the phone only.',
      );
      return;
    }
    setSaving(true);
    try {
      const asset = await createAsset({
        siteId: d.siteId,
        assetTypeId: d.assetTypeId,
        parentAssetId: params.parentAssetId,
        name: d.name.trim() || type?.label || 'Asset',
        level: d.level.trim() || undefined,
        room: d.room.trim() || undefined,
        manufacturer: d.manufacturer.trim() || undefined,
        model: d.model.trim() || undefined,
        partNumber: d.partNumber.trim() || undefined,
        serial: d.serial.trim() || undefined,
        installedDate: d.installedDate.trim() || undefined,
        attributes: d.attributes,
      });
      await draft.discard();

      let changeId: string | undefined;
      if (toSimpro && simproSite?.externalId && officeType) {
        const tag = tagFor(asset);
        const built = buildCreate({
          assetId: asset.id,
          siteExternalId: simproSite.externalId,
          assetTypeExternalId: officeType.id,
          assetTypeName: officeType.name,
          fields: customFieldsFor(asset, officeType),
          // Typed as a day already; nothing here turns an instant into one.
          startDate: asset.installedDate,
          tag,
          label: [asset.name, tag].filter(Boolean).join(' '),
        }, { now: nowIso(), changeNo: await nextChangeNo(asset.id) });
        const { change } = await queueAssetChange(built);
        changeId = change.id;
        // The queue answers "later" for the next half minute; asking now
        // costs nothing and means a phone with signal sends the moment the
        // window closes, if the asset screen is still open to ask again.
        flushSoon();
      }
      router.replace({ pathname: '/assets/[id]', params: changeId ? { id: asset.id, change: changeId } : { id: asset.id } });
    } catch (e) {
      showAlert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New asset' }} />
      <Screen>
        {draft.recovered ? (
          <Banner tone="info" title="Picked up where you left off" body="This asset was still being entered when the app last closed." />
        ) : null}

        {sites.length > 1 ? (
          <>
            <Label>Site</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingTop: t.space(1.5) }}>
              {sites.map((s) => (
                <Chip key={s.id} label={s.name} selected={d.siteId === s.id} onPress={() => set({ siteId: s.id })} />
              ))}
            </ScrollView>
          </>
        ) : null}

        <Label>System</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2), marginTop: t.space(1.5) }}>
          {activeSystems().map((sys) => (
            <Chip
              key={sys}
              label={SYSTEM_LABELS[sys]}
              selected={d.system === sys}
              onPress={() => set({ system: sys, assetTypeId: '', attributes: {} })}
            />
          ))}
        </View>

        <Label>Type</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2), marginTop: t.space(1.5) }}>
          {typesForSystem.map((x) => (
            <Chip
              key={x.id}
              label={x.label}
              selected={d.assetTypeId === x.id}
              onPress={() => { set({ assetTypeId: x.id, attributes: {} }); setOfficeTypeOverride(''); }}
            />
          ))}
        </View>

        {type ? (
          <>
            {code ? (
              <Card>
                <Label>Asset code</Label>
                <Txt size="lg" mono weight="700" tone="accent" style={{ marginTop: 4 }}>{code}</Txt>
                <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>Assigned automatically when you save.</Txt>
              </Card>
            ) : null}

            {simproSite ? (
              <OfficeTypeCard
                alsoInSimpro={alsoInSimpro}
                onToggle={setAlsoInSimpro}
                officeTypes={officeTypes}
                loading={loadingTypes}
                failed={typesFailed}
                suggested={suggestedOfficeType}
                chosen={officeType}
                onChoose={(id) => setOfficeTypeOverride(id)}
                onRetry={() => { void loadOfficeTypes(true); }}
              />
            ) : null}

            <Field label="Name or description" value={d.name} onChangeText={(v) => set({ name: v })} placeholder={type.label} />
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Level" value={d.level} onChangeText={(v) => set({ level: v })} /></View>
              <View style={{ flex: 1 }}><Field label="Room / area" value={d.room} onChangeText={(v) => set({ room: v })} /></View>
            </Rowed>

            <H2>Make and model</H2>
            <Button title="Find in the parts catalogue" variant="secondary" onPress={() => setPicking(true)} />
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Manufacturer" value={d.manufacturer} onChangeText={(v) => set({ manufacturer: v })} /></View>
              <View style={{ flex: 1 }}><Field label="Model" value={d.model} onChangeText={(v) => set({ model: v })} /></View>
            </Rowed>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Part number" value={d.partNumber} onChangeText={(v) => set({ partNumber: v })} autoCapitalize="characters" /></View>
              <View style={{ flex: 1 }}><Field label="Serial" value={d.serial} onChangeText={(v) => set({ serial: v })} autoCapitalize="characters" /></View>
            </Rowed>
            <Field label="Installed" value={d.installedDate} onChangeText={(v) => set({ installedDate: v })} placeholder="YYYY-MM-DD" />

            {type.attributes.length ? (
              <>
                <H2>{type.label} details</H2>
                {type.attributes.map((attr) => (
                  <AttributeField
                    key={attr.key}
                    attr={attr}
                    value={d.attributes[attr.key] ?? ''}
                    onChange={(v) => set({ attributes: { ...d.attributes, [attr.key]: v } })}
                  />
                ))}
              </>
            ) : null}

            <Button title="Save asset" onPress={save} loading={saving} />
          </>
        ) : (
          <Txt tone="muted" size="sm">Pick a system and type to see the details that apply.</Txt>
        )}

        <DevicePicker visible={picking} onClose={() => setPicking(false)} onPick={applyCatalogue} />
      </Screen>
    </>
  );
}

/**
 * Whether the asset goes to the office too, and as which of its types.
 *
 * The suggestion is made from the phone's type; every office type is
 * offered beside it because the words do not always match — a lay-flat
 * hose is not a hose reel to the office — and the person standing in front
 * of the equipment knows which register it belongs on.
 */
function OfficeTypeCard({ alsoInSimpro, onToggle, officeTypes, loading, failed, suggested, chosen, onChoose, onRetry }: {
  alsoInSimpro: boolean;
  onToggle: (on: boolean) => void;
  officeTypes: OfficeAssetType[];
  loading: boolean;
  failed: string | null;
  suggested?: OfficeAssetType;
  chosen?: OfficeAssetType;
  onChoose: (id: string) => void;
  onRetry: () => void;
}) {
  const t = useTheme();
  return (
    <Card>
      <Label>Also create in Simpro</Label>
      <View style={{ marginTop: t.space(1.5) }}>
        <Segmented
          value={alsoInSimpro ? 'yes' : 'no'}
          onChange={(v) => onToggle(v === 'yes')}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Phone only' }]}
        />
      </View>
      {alsoInSimpro ? (
        <View style={{ marginTop: t.space(2), gap: t.space(1.5) }}>
          {loading ? <Txt size="sm" tone="muted">Reading the office's asset types…</Txt> : null}
          {failed ? (
            <>
              <Banner tone="warn" title="The office's asset types could not be read" body={failed} />
              <Button title="Try again" variant="secondary" compact onPress={onRetry} />
            </>
          ) : null}
          {officeTypes.length ? (
            <>
              <Txt size="sm" tone="muted">
                {chosen
                  ? `Filed in the office as “${chosen.name}”${suggested && chosen.id === suggested.id ? ' — suggested from the type above' : ''}.`
                  : 'No office type matches this one. Pick the register it belongs on.'}
              </Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
                {officeTypes.map((o) => (
                  <Chip key={o.id} label={o.name} selected={chosen?.id === o.id} onPress={() => onChoose(o.id)} />
                ))}
              </ScrollView>
            </>
          ) : null}
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            Queued, not sent straight away: you get half a minute on the asset's screen to take it back, and it waits for signal.
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

/** Renders whichever input the attribute definition calls for. */
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
