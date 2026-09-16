import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createDefect, listSitePicks, type SitePick } from '@/db/repo';
import { newId } from '@/db';
import { listJobsFor } from '@/db/mirrorRepo';
import type { JobRecord } from '@/db/opsRepo';
import { CAPTURE_QUALITY } from '@/domain/photoStore';
import { jobIsOpen } from '@/domain/jobPresentation';
import { attachmentsForDefect } from '@/domain/outboundWork';
import { shrinkForStorage } from '@/export/photoResize';
import { keepPhoto } from '@/export/photoFiles';
import { addAssetEvent } from '@/db/assetRepo';
import { photosWithSizes } from '@/simpro/attachmentFiles';
import { queueJobAttachment } from '@/simpro/sync';
import { hasKey } from '@/ai/client';
import { draftDefectWording, MAX_CANDIDATES } from '@/ai/defectWording';
import { SYSTEM_LABELS, type SystemKind } from '@/seed/assetTypes';
import {
  DEFECT_LIBRARY, SEVERITY_LABEL, defectComponents, defectsForSystem, searchDefects,
  type DefectCode, type Severity,
} from '@/seed/defectLibrary';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { SitePicker } from '@/components/SitePicker';

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
  const [sites, setSites] = useState<SitePick[]>([]);
  const [saving, setSaving] = useState(false);
  /**
   * The office's open jobs at the chosen site, and which of them the
   * photographs go to. A photograph of a defect belongs on the job the
   * office raised for the visit, where the scheduler and the customer's
   * report both find it; until now it stayed on the phone until a routine
   * run was sent. Nothing is chosen by default where there is more than
   * one open job, because the wrong job files the evidence against
   * somebody else's work.
   */
  const [officeJobs, setOfficeJobs] = useState<JobRecord[]>([]);
  const [attachTo, setAttachTo] = useState<string | null>(null);
  /*
   * The model's offer to write the specifics up in the record's register.
   * Optional and small: with no key the button says why, and nothing else
   * on the screen changes. It sends the type's system, the picked code and
   * what was typed — never the site, the location or the customer.
   */
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  /**
   * Everything the user actually typed lives in a draft, so a lock screen, a
   * phone call or a low-memory kill costs nothing. Keyed by asset or site so
   * two half-written defects never overwrite each other.
   */
  const draft = useDraft(`defect:new:${params.assetId ?? params.siteId ?? 'unassigned'}`, {
    code: null as string | null,
    location: params.location ?? '',
    extra: '',
    /**
     * The sentence that goes on the record, kept apart from `extra` so the
     * model's draft never replaces what the technician typed. Blank, the
     * record is the library wording with the specifics after it, as ever.
     */
    wording: '',
    photos: [] as string[],
    severity: null as Severity | null,
    siteId: params.siteId as string | undefined,
  });
  const d = draft.value;
  const selected = d.code ? (DEFECT_LIBRARY.find((x) => x.code === d.code) ?? null) : null;

  const setLocation = (v: string) => draft.setValue((p) => ({ ...p, location: v }));
  const setExtra = (v: string) => draft.setValue((p) => ({ ...p, extra: v }));
  const setWording = (v: string) => draft.setValue((p) => ({ ...p, wording: v }));
  const setSeverity = (v: Severity) => draft.setValue((p) => ({ ...p, severity: v }));
  const setSiteId = (v: string | undefined) => draft.setValue((p) => ({ ...p, siteId: v }));
  const setPhotos = (fn: (prev: string[]) => string[]) =>
    draft.setValue((p) => ({ ...p, photos: fn(p.photos) }));
  const setSelected = (v: DefectCode | null) =>
    draft.setValue((p) => ({ ...p, code: v?.code ?? null }));

  const location = d.location;
  const extra = d.extra;
  // A draft saved before this field existed has no wording; that is blank, not lost.
  const wording = d.wording ?? '';
  const photos = d.photos;
  const severity = d.severity;
  const siteId = d.siteId;

  React.useEffect(() => {
    void listSitePicks().then((list) => {
      setSites(list);
      if (!siteId && list.length === 1) setSiteId(list[0]!.id);
    });
    // Only runs once the draft has loaded, so a recovered site choice wins.
  }, [siteId, draft.ready]);

  React.useEffect(() => { void hasKey().then(setAiOn); }, []);

  const writeUp = async () => {
    if (!selected) return;
    setAiBusy(true);
    setAiNote(null);
    try {
      // The picked code goes first so the model keeps it; the rest of its
      // component fills the candidate list, in case the specifics say the
      // technician picked a neighbour.
      const siblings = defectsForSystem(selected.system)
        .filter((c) => c.code !== selected.code && c.component === selected.component)
        .slice(0, MAX_CANDIDATES - 1);
      const result = await draftDefectWording({
        assetTypeLabel: selected.component,
        system: selected.system,
        observation: extra,
        candidates: [selected, ...siblings],
      });
      if (result.wording) {
        // Into its own field, beside what was typed rather than over it:
        // the observation is still the note, and still on the timeline.
        setWording(result.wording);
        setAiNote(result.code && result.code !== selected.code
          ? `Drafted, but under ${result.code} rather than ${selected.code}. Read it before you save; the code stays as you picked it and your words stay in the note.`
          : 'Drafted from what you wrote. Read it before you save — it is your record. Your words stay in the note.');
      } else {
        setAiNote(result.refusal ?? 'No wording came back.');
      }
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  React.useEffect(() => {
    let cancelled = false;
    if (!siteId) { setOfficeJobs([]); setAttachTo(null); return; }
    void listJobsFor({ siteId, limit: 50 }).then((rows) => {
      if (cancelled) return;
      const open = rows.filter((j) => j.externalId && jobIsOpen(j));
      setOfficeJobs(open);
      setAttachTo(open.length === 1 ? open[0]!.externalId! : null);
    });
    return () => { cancelled = true; };
  }, [siteId]);

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
      showAlert('Permission needed', 'Safe QLD needs access to attach a photo to this defect.');
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
      showAlert(
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
      showAlert('Which site?', 'Pick the site this defect belongs to.');
      return;
    }
    if (selected.photoRequired && !photos.length) {
      showAlert('Photo required', 'This defect type needs a photo as evidence. Add one before saving.');
      return;
    }

    setSaving(true);
    try {
      // The drafted (or hand-written) wording is the record where there is
      // one; otherwise the library wording with the specifics after it. The
      // observation goes in the note either way, so nothing typed is lost
      // to a better-worded sentence.
      const own = wording.trim();
      const observation = extra.trim();
      const description = own || [selected.reportWording, observation].filter(Boolean).join(' ');
      const technicianNote = observation ? `Technician note: ${observation}` : undefined;
      const grade = severity ?? selected.severity;
      const critical = grade === 'critical';
      const defect = await createDefect({
        siteId,
        pointId: params.assetId,
        location: location.trim() || 'Location not recorded',
        description,
        severity: critical ? 'critical' : 'non-critical',
        // The grade the technician picked, kept. Critical is carried by
        // `severity` because the statutory tests hang off that word; High,
        // Medium and Low used to land identically and vanish.
        priority: critical ? undefined : grade,
        status: 'open',
        photos,
        // The library code and the AS 1851 class go on the record itself, not
        // only into the notes: the notice screen and the outbound report read
        // them from the row, and a row without them reads as non-critical.
        defectCode: selected.code,
        as1851Class: critical ? 'critical' : 'non-critical',
        notes: [selected.code, technicianNote].filter(Boolean).join('\n\n'),
      });

      // The asset timeline is what makes recurring failures visible later.
      // The observation rides with it where the wording replaced it in the
      // description, because "what the technician saw" is the useful half.
      if (params.assetId) {
        await addAssetEvent({
          assetId: params.assetId,
          kind: 'defect-raised',
          occurredAt: defect.raisedAt,
          summary: `${selected.defect} (${selected.code})`,
          detail: [description, own ? technicianNote : undefined].filter(Boolean).join('\n'),
          photos,
        });
      }

      await draft.discard();

      // The photographs to the office's job, queued rather than sent, after
      // the defect is safely on the phone: a queue that cannot be written
      // must not take the defect with it. The plan declines a photograph
      // whose file has gone and the queue declines one it already holds,
      // and both are said out loud rather than counted as sent.
      const jobId = attachTo && officeJobs.some((j) => j.externalId === attachTo) ? attachTo : null;
      if (jobId && defect.photos.length) {
        const siteName = sites.find((s) => s.id === siteId)?.name ?? '';
        try {
          const plan = attachmentsForDefect(
            { id: defect.id, location: defect.location, raisedAt: defect.raisedAt, photos: photosWithSizes(defect.photos) },
            { jobId, siteName },
          );
          let queued = 0;
          let duplicate = 0;
          for (const item of plan.items) {
            const row = await queueJobAttachment(item.payload);
            if (row.duplicate) duplicate++; else queued++;
          }
          const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
          const lines = [
            queued ? `${plural(queued)} queued for job #${jobId}. They go up with the next send.` : undefined,
            duplicate ? `${plural(duplicate)} already queued or on the job, so not sent twice.` : undefined,
            plan.missing ? `${plural(plan.missing)} could not be found on this device and stay with the defect only.` : undefined,
          ].filter(Boolean);
          await new Promise<void>((resolve) => {
            showAlert(queued ? 'Photos queued for the office' : 'Nothing new to send', lines.join('\n'), [{ text: 'OK', onPress: () => resolve() }]);
          });
        } catch (e) {
          await new Promise<void>((resolve) => {
            showAlert(
              'Defect saved, photos not queued',
              `The defect is on the phone. Its photos could not be queued for job #${jobId}: ${e instanceof Error ? e.message : String(e)}`,
              [{ text: 'OK', onPress: () => resolve() }],
            );
          });
        }
      }

      router.back();
    } catch (e) {
      showAlert('Could not save', e instanceof Error ? e.message : String(e));
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
              <SitePicker sites={sites} value={siteId} onChange={setSiteId} />
            ) : null}

            <Field label="Location" value={location} onChangeText={setLocation} placeholder="Level 3, east corridor, near stair 2" />
            <Field
              label="Anything specific to this one"
              value={extra}
              onChangeText={setExtra}
              multiline
              placeholder="Only what the standard wording does not already say"
            />
            <Rowed gap={2} align="flex-start">
              <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 17 }}>
                {aiOn
                  ? 'Write it up puts what you typed into the record\'s register. It sends the code, the system and your words — never the site or the location.'
                  : 'No API key is set, so the wording above is the record. A key goes in Settings.'}
              </Txt>
              <Button
                title="Write it up"
                variant="secondary"
                compact
                disabled={!aiOn || extra.trim().length < 4}
                loading={aiBusy}
                onPress={() => void writeUp()}
                icon={<MaterialCommunityIcons name="auto-fix" size={16} color={t.color.text} />}
              />
            </Rowed>
            {aiNote ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{aiNote}</Txt> : null}
            <Field
              label="Wording on the record"
              value={wording}
              onChangeText={setWording}
              multiline
              placeholder={[selected.reportWording, extra.trim()].filter(Boolean).join(' ')}
              hint={wording.trim() ? 'What you typed above still goes in the note.' : 'Left blank, the record reads as the placeholder above.'}
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

            {photos.length && officeJobs.length ? (
              <Card>
                <Label>Send to the office</Label>
                <Txt size="sm" style={{ marginTop: 4, lineHeight: 20 }}>
                  {attachTo
                    ? `Attach ${photos.length === 1 ? 'the photo' : `these ${photos.length} photos`} to job #${attachTo} in Simpro when the defect is saved.`
                    : officeJobs.length === 1
                      ? 'The photos stay on the phone with the defect.'
                      : `The office has ${officeJobs.length} open jobs here. Pick the one this defect belongs to, or leave the photos on the phone.`}
                </Txt>
                <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                  {officeJobs.map((j) => (
                    <Chip
                      key={j.id}
                      label={`Job #${j.externalId}${j.title ? ` · ${j.title}` : ''}`}
                      selected={attachTo === j.externalId}
                      onPress={() => setAttachTo(attachTo === j.externalId ? null : j.externalId!)}
                    />
                  ))}
                  <Chip label="Keep on the phone" selected={attachTo === null} onPress={() => setAttachTo(null)} />
                </Rowed>
              </Card>
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
