import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createDefect, listSites } from '@/db/repo';
import { newId } from '@/db';
import { CAPTURE_QUALITY } from '@/domain/photoStore';
import { shrinkForStorage } from '@/export/photoResize';
import { keepPhoto } from '@/export/photoFiles';
import { addAssetEvent } from '@/db/assetRepo';
import { SYSTEM_LABELS, type SystemKind } from '@/seed/assetTypes';
import {
  DEFECT_LIBRARY, SEVERITY_LABEL, defectComponents, defectsForSystem, searchDefects,
  type DefectCode, type Severity,
} from '@/seed/defectLibrary';
import type { Site } from '@/domain/types';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Defect capture.
 *
 * A technician picks system, component and defect rather than writing prose.
 * The library supplies the severity, the formal wording and the work needed to
 * clear it, so the record reads the same whoever raised it and turns into a
 * quote without anyone retyping it. Free text is still there for the specifics
 * only the person standing in front of it knows.
 */
export default function NewDefectScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; assetId?: string; location?: string }>();

  const [search, setSearch] = useState('');
  const [system, setSystem] = useState<SystemKind | null>(null);
  const [component, setComponent] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);

  /**
   * Everything the user actually typed lives in a draft, so a lock screen, a
   * phone call or a low-memory kill costs nothing. Keyed by asset or site so
   * two half-written defects never overwrite each other.
   */
  const draft = useDraft(`defect:new:${params.assetId ?? params.siteId ?? 'unassigned'}`, {
    code: null as string | null,
    location: params.location ?? '',
    extra: '',
    photos: [] as string[],
    severity: null as Severity | null,
    siteId: params.siteId as string | undefined,
  });
  const d = draft.value;
  const selected = d.code ? (DEFECT_LIBRARY.find((x) => x.code === d.code) ?? null) : null;

  const setLocation = (v: string) => draft.setValue((p) => ({ ...p, location: v }));
  const setExtra = (v: string) => draft.setValue((p) => ({ ...p, extra: v }));
  const setSeverity = (v: Severity) => draft.setValue((p) => ({ ...p, severity: v }));
  const setSiteId = (v: string | undefined) => draft.setValue((p) => ({ ...p, siteId: v }));
  const setPhotos = (fn: (prev: string[]) => string[]) =>
    draft.setValue((p) => ({ ...p, photos: fn(p.photos) }));
  const setSelected = (v: DefectCode | null) =>
    draft.setValue((p) => ({ ...p, code: v?.code ?? null }));

  const location = d.location;
  const extra = d.extra;
  const photos = d.photos;
  const severity = d.severity;
  const siteId = d.siteId;

  React.useEffect(() => {
    void listSites().then((list) => {
      setSites(list);
      if (!siteId && list.length === 1) setSiteId(list[0]!.id);
    });
    // Only runs once the draft has loaded, so a recovered site choice wins.
  }, [siteId, draft.ready]);

  const systems = useMemo(
    () => [...new Set(DEFECT_LIBRARY.map((d) => d.system))],
    [],
  );

  const searchResults = useMemo(() => (search.trim().length >= 2 ? searchDefects(search).slice(0, 25) : []), [search]);
  const components = useMemo(() => (system ? defectComponents(system) : []), [system]);
  const defects = useMemo(
    () => (system && component ? defectsForSystem(system).filter((d) => d.component === component) : []),
    [system, component],
  );

  const pick = (code: DefectCode) => {
    draft.setValue((p) => ({ ...p, code: code.code, severity: code.severity }));
    setSystem(code.system);
    setComponent(code.component);
    setSearch('');
  };

  const addPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Safe QLD needs access to attach a photo to this defect.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: CAPTURE_QUALITY })
      : await ImagePicker.launchImageLibraryAsync({ quality: CAPTURE_QUALITY });
    if (result.canceled || !result.assets[0]) return;
    // Down to MAX_DIMENSION before it is kept. The picker's quality setting is
    // compression only, so without this a photograph is stored at whatever the
    // camera shot — a couple of megabytes each, on a handset already holding
    // every site offline.
    const sourceUri = await shrinkForStorage(result.assets[0]!);

    // Copy it out of the cache now rather than at save. The picker hands back a
    // URI the operating system may clear at any point, and a defect photograph
    // is evidence on a statutory notice — losing it produces no error, just a
    // record that quietly stops pointing at anything.
    try {
      const kept = keepPhoto({
        id: newId(),
        sourceUri,
        subject: 'defect',
        // The defect does not exist yet; its photographs are filed against it
        // on save, when it has an id.
        subjectId: 'pending',
        takenAt: new Date().toISOString(),
      });
      setPhotos((prev) => [...prev, kept.path]);
    } catch (e) {
      Alert.alert(
        'Could not keep that photo',
        `The photo was taken but could not be saved to this device, so it has not been attached. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  };

  const save = async () => {
    if (!selected) return;
    if (!siteId) {
      Alert.alert('Which site?', 'Pick the site this defect belongs to.');
      return;
    }
    if (selected.photoRequired && !photos.length) {
      Alert.alert('Photo required', 'This defect type needs a photo as evidence. Add one before saving.');
      return;
    }

    setSaving(true);
    try {
      const description = [selected.reportWording, extra.trim()].filter(Boolean).join(' ');
      const defect = await createDefect({
        siteId,
        pointId: params.assetId,
        location: location.trim() || 'Location not recorded',
        description,
        severity: (severity ?? selected.severity) === 'critical' ? 'critical' : 'non-critical',
        status: 'open',
        photos,
        notes: `${selected.code}${extra.trim() ? `\n\nTechnician note: ${extra.trim()}` : ''}`,
      });

      // The asset timeline is what makes recurring failures visible later.
      if (params.assetId) {
        await addAssetEvent({
          assetId: params.assetId,
          kind: 'defect-raised',
          occurredAt: defect.raisedAt,
          summary: `${selected.defect} (${selected.code})`,
          detail: description,
          photos,
        });
      }

      await draft.discard();
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Raise defect' }} />
      <Screen>
        {draft.recovered ? (
          <Banner
            tone="info"
            title="Picked up where you left off"
            body="This defect was still being written when the app last closed. Nothing was lost."
          />
        ) : null}

        {!selected ? (
          <>
            <Field
              label="Search the defect library"
              value={search}
              onChangeText={setSearch}
              placeholder="e.g. failed discharge, contaminated, wedged open"
              autoCapitalize="none"
            />

            {searchResults.length ? (
              <>
                <Label>{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</Label>
                {searchResults.map((d) => <DefectRow key={d.code} defect={d} onPress={() => pick(d)} />)}
              </>
            ) : (
              <>
                <H2>System</H2>
                <Rowed gap={2} wrap>
                  {systems.map((s) => (
                    <Chip
                      key={s}
                      label={SYSTEM_LABELS[s]}
                      selected={system === s}
                      onPress={() => { setSystem(s); setComponent(null); }}
                    />
                  ))}
                </Rowed>

                {system ? (
                  <>
                    <H2>Component</H2>
                    <Rowed gap={2} wrap>
                      {components.map((c) => (
                        <Chip key={c} label={c} selected={component === c} onPress={() => setComponent(c)} />
                      ))}
                    </Rowed>
                  </>
                ) : null}

                {defects.length ? (
                  <>
                    <H2>Defect</H2>
                    {defects.map((d) => <DefectRow key={d.code} defect={d} onPress={() => pick(d)} />)}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <Card>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Label>{selected.code}</Label>
                <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                  <Txt size="sm" tone="accent" weight="700">Change</Txt>
                </Pressable>
              </Rowed>
              <Txt size="lg" weight="700" style={{ marginTop: 4 }}>{selected.defect}</Txt>
              <Txt size="sm" tone="muted">{SYSTEM_LABELS[selected.system]} · {selected.component}</Txt>
              <Divider />
              <Label>Report wording</Label>
              <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{selected.reportWording}</Txt>
              {selected.clientWording ? (
                <>
                  <View style={{ height: t.space(2) }} />
                  <Label>Client wording</Label>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>{selected.clientWording}</Txt>
                </>
              ) : null}
              {selected.rectification ? (
                <>
                  <View style={{ height: t.space(2) }} />
                  <Label>Rectification</Label>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>{selected.rectification}</Txt>
                </>
              ) : null}
            </Card>

            {selected.quoteItems?.length ? (
              <Card>
                <Label>Quote lines this generates</Label>
                <View style={{ marginTop: t.space(2), gap: 6 }}>
                  {selected.quoteItems.map((q, i) => (
                    <Rowed key={i} style={{ justifyContent: 'space-between' }}>
                      <Txt size="sm" style={{ flex: 1 }}>{q.description}</Txt>
                      <Txt size="sm" tone="muted">{q.qtyPerDefect} {q.unit}</Txt>
                    </Rowed>
                  ))}
                </View>
              </Card>
            ) : null}

            <H2>Severity</H2>
            <Rowed gap={2}>
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
                <Chip key={s} label={SEVERITY_LABEL[s]} selected={severity === s} onPress={() => setSeverity(s)} />
              ))}
            </Rowed>
            {severity !== selected.severity ? (
              <Banner
                tone="info"
                title="Severity changed from the library default"
                body={`The library rates this ${SEVERITY_LABEL[selected.severity].toLowerCase()}. Your reason for changing it should go in the note below.`}
              />
            ) : null}

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

            <Field label="Location" value={location} onChangeText={setLocation} placeholder="Level 3, east corridor, near stair 2" />
            <Field
              label="Anything specific to this one"
              value={extra}
              onChangeText={setExtra}
              multiline
              placeholder="Only what the standard wording does not already say"
            />

            <H2>Photos{selected.photoRequired ? ' — required' : ''}</H2>
            <Rowed gap={2}>
              <Button title="Camera" variant="secondary" style={{ flex: 1 }} onPress={() => void addPhoto(true)} icon={<MaterialCommunityIcons name="camera-outline" size={16} color={t.color.text} />} />
              <Button title="Library" variant="secondary" style={{ flex: 1 }} onPress={() => void addPhoto(false)} />
            </Rowed>
            {photos.length ? (
              <Txt size="sm" tone="pass">{photos.length} photo{photos.length === 1 ? '' : 's'} attached</Txt>
            ) : selected.photoRequired ? (
              <Txt size="sm" tone="warn">This defect type needs photographic evidence.</Txt>
            ) : null}

            <Button title="Save defect" onPress={save} loading={saving} />
          </>
        )}
      </Screen>
    </>
  );
}

function DefectRow({ defect, onPress }: { defect: DefectCode; onPress: () => void }) {
  const t = useTheme();
  const tone = defect.severity === 'critical' ? 'fail' : defect.severity === 'high' ? 'warn' : 'default';
  return (
    <Card onPress={onPress}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="600">{defect.defect}</Txt>
          <Txt size="sm" tone="muted">{SYSTEM_LABELS[defect.system]} · {defect.component}</Txt>
        </View>
        <Chip label={SEVERITY_LABEL[defect.severity]} tone={tone === 'fail' ? 'fail' : tone === 'warn' ? 'warn' : 'default'} />
      </Rowed>
      <Txt size="xs" tone="faint" style={{ marginTop: 6 }} numberOfLines={2}>{defect.reportWording}</Txt>
    </Card>
  );
}
