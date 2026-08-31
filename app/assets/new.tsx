import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { createAsset, nextAssetCode } from '@/db/assetRepo';
import { listSites } from '@/db/repo';
import {
  ASSET_TYPES, SYSTEM_LABELS, activeSystems, assetTypeById,
  type AssetTypeDef, type AttributeDef, type SystemKind,
} from '@/seed/assetTypes';
import { DevicePicker } from '@/components/DevicePicker';
import type { CatalogueItem } from '@/db/catalogueRepo';
import type { Site } from '@/domain/types';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Field, H2, Label, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/**
 * Adding an asset by hand.
 *
 * Attributes come from the type definition, so this one screen covers a
 * detector, a fire pump, an extinguisher and a fire door without knowing
 * anything about any of them.
 */
export default function NewAssetScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; parentAssetId?: string; system?: string }>();
  const [sites, setSites] = useState<Site[]>([]);
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

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

  const type = useMemo(() => (d.assetTypeId ? assetTypeById(d.assetTypeId) : undefined), [d.assetTypeId]);
  const typesForSystem = useMemo(() => ASSET_TYPES.filter((x) => x.system === d.system), [d.system]);

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
      Alert.alert('Which site?', 'Pick the site this asset belongs to.');
      return;
    }
    if (!d.assetTypeId) {
      Alert.alert('What is it?', 'Choose the asset type so the right details are recorded.');
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
      router.replace({ pathname: '/assets/[id]', params: { id: asset.id } });
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
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
              onPress={() => set({ assetTypeId: x.id, attributes: {} })}
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
