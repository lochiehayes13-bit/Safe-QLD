import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  addFinding, deleteFinding, getAssessment, listFindings, resequence, updateAssessment,
  updateFinding, type Assessment,
} from '@/db/assessmentRepo';
import { getSite, listDefects } from '@/db/repo';
import {
  KIND_LABEL, PRIORITY_LABEL, findingRef, openDefectCaution, recommendationList,
  summariseFindings, validateFindings, type Finding, type FindingKind, type FindingPriority,
} from '@/domain/findings';
import { effectivenessReportHtml } from '@/export/effectivenessReport';
import { keepPhoto, photoUri } from '@/export/photoFiles';
import {
  CAPTURE_QUALITY, groupForRegister, numberRegister, type PhotoRef,
} from '@/domain/photoStore';
import { shrinkForStorage } from '@/export/photoResize';
import { shareFile, writePdf } from '@/export/files';
import { loadPrefs } from '@/app-prefs';
import { newId } from '@/db';
import type { Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * A fire system effectiveness assessment.
 *
 * This is not a service. Nothing is tested, nothing is activated, and nothing
 * found here is a defect — the findings are recommendations for an upcoming
 * project and observations noted for the record. The screen keeps that
 * separation visible rather than assuming a technician will remember it, and
 * the report it produces states it three times in its own text.
 *
 * The one thing the app can check that a person reading the document cannot:
 * whether the site already has open defects. "No defects were identified" is
 * true of an attendance that tested nothing, and will not read that way to a
 * client whose building has four outstanding.
 */
export default function AssessmentScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [site, setSite] = useState<Site | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [defects, setDefects] = useState({ open: 0, critical: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const a = await getAssessment(id);
    setAssessment(a);
    setMissing(!a);
    if (!a) return;
    const [s, f, d] = await Promise.all([getSite(a.siteId), listFindings(id), listDefects(a.siteId)]);
    setSite(s);
    setFindings(f);
    const open = d.filter((x) => x.status === 'open');
    setDefects({ open: open.length, critical: open.filter((x) => x.severity === 'critical').length });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback((next: Partial<Assessment>) => {
    setAssessment((prev) => {
      if (!prev) return prev;
      void updateAssessment(prev.id, next);
      return { ...prev, ...next };
    });
  }, []);

  const tally = useMemo(() => summariseFindings(findings), [findings]);
  const issues = useMemo(() => validateFindings(findings), [findings]);
  const caution = useMemo(() => openDefectCaution(defects.open, defects.critical), [defects]);

  const add = async (kind: FindingKind) => {
    if (!assessment) return;
    const created = await addFinding(assessment.id, {
      kind,
      priority: kind === 'recommendation' ? 'medium' : undefined,
    });
    setFindings(await listFindings(assessment.id));
    setEditing(created.id);
  };

  const remove = (finding: Finding) => {
    Alert.alert(
      `Remove ${findingRef(finding.kind, finding.seq)}?`,
      'The findings after it renumber, so the register has no gap in it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteFinding(finding.id);
              if (assessment) setFindings(await listFindings(assessment.id));
            })();
          },
        },
      ],
    );
  };

  const change = async (finding: Finding, next: Partial<Finding>) => {
    setFindings((prev) => prev.map((f) => (f.id === finding.id ? { ...f, ...next } : f)));
    await updateFinding(finding.id, next);
  };

  const issue = async () => {
    if (!assessment || !site) return;
    setBusy(true);
    try {
      await resequence(assessment.id);
      const fresh = await listFindings(assessment.id);
      setFindings(fresh);
      const prefs = await loadPrefs();
      const html = effectivenessReportHtml({
        reportReference: assessment.reportReference,
        jobReference: assessment.jobReference,
        assessmentType: assessment.assessmentType,
        clientName: assessment.clientName || site.clientName || '',
        siteName: site.name,
        siteAddress: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' '),
        scopeLabel: assessment.scopeLabel,
        attendanceDate: assessment.attendanceDate,
        issueDate: assessment.issueDate,
        assessedBy: assessment.assessedBy || prefs.companyName,
        preparedBy: assessment.preparedBy || prefs.technicianName,
        companyName: prefs.companyName,
        summary: assessment.summary,
        boundary: assessment.boundary,
        systemDescription: assessment.systemDescription,
        panelStatus: assessment.panelStatus,
        findings: fresh,
        // Grouped and numbered by the same functions the register was written
        // for, rather than counted again here: the findings cite photographs by
        // number, so there can only be one answer to which one is Photo 7.
        photos: numberRegister(groupForRegister(
          fresh.flatMap((f): PhotoRef[] => f.photos.map((path, i) => ({
            id: `${f.id}-${i}`,
            subject: 'report',
            subjectId: f.id,
            path,
            caption: f.item || f.location,
            // Every photograph on a finding shares its timestamp, so the sort
            // is stable and they stay in the order they were attached.
            takenAt: f.createdAt,
          }))),
          (_subject, subjectId) => {
            const f = fresh.find((x) => x.id === subjectId);
            return f ? `${findingRef(f.kind, f.seq)} — ${f.item || f.location}` : 'General';
          },
        )).map(({ ref, photo, group }) => ({
          ref,
          uri: photoUri(photo.path),
          caption: photo.caption ?? group.label,
          group: group.label,
        })),
        statement: assessment.statement,
        openDefectCaution: caution,
      });
      const file = await writePdf(
        `${assessment.reportReference || 'effectiveness-report'}-${site.name}`,
        html,
      );
      await shareFile(file, 'Fire system effectiveness report');
    } catch (e) {
      Alert.alert('Could not produce the report', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!assessment) return <RecordGate missing={missing} what="assessment" />;

  return (
    <>
      <Stack.Screen options={{ title: assessment.reportReference || 'Effectiveness assessment' }} />
      <Screen>
        <Banner
          tone="info"
          title="Nothing here is a defect"
          body={
            'An effectiveness assessment is visual and advisory. No device is activated and nothing '
            + 'is tested, so its findings are recommendations for an upcoming project and '
            + 'observations noted for the record. A recommendation written up as a defect starts '
            + 'statutory clocks that have no business running.'
          }
        />

        <Rowed gap={2}>
          <StatTile
            label="Recommendations"
            value={tally.recommendations}
            tone={tally.recommendations ? 'accent' : 'default'}
          />
          <StatTile label="Observations" value={tally.observations} />
          <StatTile label="High priority" value={tally.high} tone={tally.high ? 'warn' : 'default'} />
        </Rowed>

        {caution ? (
          <Banner tone="warn" title="Defects are already open at this site" body={caution} />
        ) : null}

        {issues.length ? (
          <Banner
            tone="warn"
            title={`${issues.length} thing${issues.length === 1 ? '' : 's'} to fix before issuing`}
            body={issues.slice(0, 6).map((i) => i.message).join('\n')}
          />
        ) : null}

        <H2>The report</H2>
        <Card>
          <Field
            label="Report reference"
            value={assessment.reportReference}
            onChangeText={(v) => patch({ reportReference: v })}
            autoCapitalize="characters"
            placeholder="SQLD-SITE-FSE-01"
          />
          <View style={{ height: t.space(2.5) }} />
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field
                label="Job reference"
                value={assessment.jobReference}
                onChangeText={(v) => patch({ jobReference: v })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Attendance date"
                value={assessment.attendanceDate ?? ''}
                onChangeText={(v) => patch({ attendanceDate: v })}
                placeholder="2026-07-03"
              />
            </View>
          </Rowed>
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Client"
            value={assessment.clientName}
            onChangeText={(v) => patch({ clientName: v })}
            placeholder={site?.clientName ?? ''}
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="What this covers"
            value={assessment.scopeLabel}
            onChangeText={(v) => patch({ scopeLabel: v })}
            placeholder="Administration Building"
            hint="Usually one building, not the whole site"
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="What it does not cover"
            value={assessment.boundary}
            onChangeText={(v) => patch({ boundary: v })}
            multiline
            hint="An unstated boundary reads as a whole-site assessment"
          />
        </Card>

        <H2>What was seen</H2>
        <Card>
          <Field
            label="Executive summary"
            value={assessment.summary}
            onChangeText={(v) => patch({ summary: v })}
            multiline
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="System description"
            value={assessment.systemDescription}
            onChangeText={(v) => patch({ systemDescription: v })}
            multiline
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Panel condition and status"
            value={assessment.panelStatus}
            onChangeText={(v) => patch({ panelStatus: v })}
            multiline
          />
        </Card>

        <H2>Findings</H2>
        <Rowed gap={2}>
          <Button
            title="Add a recommendation"
            variant="secondary"
            compact
            style={{ flex: 1 }}
            onPress={() => void add('recommendation')}
          />
          <Button
            title="Add an observation"
            variant="ghost"
            compact
            style={{ flex: 1 }}
            onPress={() => void add('observation')}
          />
        </Rowed>

        {!findings.length ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            Nothing recorded yet. An assessment that finds nothing is a real outcome and the report
            says so — it does not print an empty table.
          </Txt>
        ) : null}

        {findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            open={editing === f.id}
            onToggle={() => setEditing(editing === f.id ? null : f.id)}
            onChange={(next) => void change(f, next)}
            onRemove={() => remove(f)}
          />
        ))}

        <H2>Sign off</H2>
        <Card>
          <Field
            label="Assessed by"
            value={assessment.assessedBy}
            onChangeText={(v) => patch({ assessedBy: v })}
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Prepared by"
            value={assessment.preparedBy}
            onChangeText={(v) => patch({ preparedBy: v })}
            autoCapitalize="words"
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Issue date"
            value={assessment.issueDate ?? ''}
            onChangeText={(v) => patch({ issueDate: v })}
            placeholder="2026-07-06"
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Assessment statement"
            value={assessment.statement}
            onChangeText={(v) => patch({ statement: v })}
            multiline
            hint="The list of recommendations is added automatically"
          />
          {tally.recommendations ? (
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
              The report will append: “As areas of recommended improvement, the upcoming project
              should incorporate: {recommendationList(findings)}.”
            </Txt>
          ) : null}
        </Card>

        <Button title="Produce the report" onPress={issue} loading={busy} />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Findings renumber on issue so the register has no gaps in it.
        </Txt>
      </Screen>
    </>
  );
}

const PRIORITIES: FindingPriority[] = ['high', 'medium', 'low'];

function FindingCard({
  finding, open, onToggle, onChange, onRemove,
}: {
  finding: Finding;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Finding>) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const ref = findingRef(finding.kind, finding.seq);

  /**
   * A photograph for the register.
   *
   * Copied out of the picker's cache immediately. The operating system may
   * clear that directory at any point, and a register entry pointing at a file
   * that is no longer there produces no error — just a gap in an issued report.
   */
  const addPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Safe QLD needs access to add a photograph to this finding.');
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
    try {
      const kept = keepPhoto({
        id: newId(),
        sourceUri,
        subject: 'report',
        subjectId: finding.id,
        takenAt: new Date().toISOString(),
        caption: finding.item,
      });
      onChange({ photos: [...finding.photos, kept.path] });
    } catch (e) {
      Alert.alert(
        'Could not keep that photograph',
        `It was taken but could not be saved to this device, so it has not been attached. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  };

  return (
    <Card>
      <Pressable onPress={onToggle}>
        <Rowed gap={2} align="flex-start">
          <Chip label={ref} tone={finding.kind === 'recommendation' ? 'default' : 'muted'} />
          <View style={{ flex: 1 }}>
            <Txt weight="700">{finding.item || 'Untitled finding'}</Txt>
            <Txt size="xs" tone="faint">
              {KIND_LABEL[finding.kind]}
              {finding.location ? ` · ${finding.location}` : ''}
              {finding.priority ? ` · ${PRIORITY_LABEL[finding.priority]}` : ''}
            </Txt>
          </View>
          <MaterialCommunityIcons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={t.color.textFaint}
          />
        </Rowed>
      </Pressable>

      {open ? (
        <>
          <Divider />
          <Label>Classification</Label>
          <Segmented
            value={finding.kind}
            onChange={(kind) => onChange({
              kind,
              // An observation is note-only, so a priority on one is a
              // contradiction rather than extra information.
              priority: kind === 'observation' ? undefined : (finding.priority ?? 'medium'),
            })}
            options={[
              { value: 'recommendation' as FindingKind, label: 'Recommendation' },
              { value: 'observation' as FindingKind, label: 'Observation' },
            ]}
          />
          <View style={{ height: t.space(2.5) }} />
          <Field label="Item" value={finding.item} onChangeText={(v) => onChange({ item: v })} />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Location"
            value={finding.location}
            onChangeText={(v) => onChange({ location: v })}
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Reference"
            value={finding.reference ?? ''}
            onChangeText={(v) => onChange({ reference: v || undefined })}
            hint="What it is measured against — a manufacturer's product status, a service life"
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Detail"
            value={finding.detail}
            onChangeText={(v) => onChange({ detail: v })}
            multiline
          />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label={finding.kind === 'recommendation' ? 'Action' : 'Note'}
            value={finding.action}
            onChangeText={(v) => onChange({ action: v })}
            multiline
            hint={finding.kind === 'recommendation'
              ? 'What is proposed, and within what scope'
              : 'Note only — no action required'}
          />

          {finding.kind === 'recommendation' ? (
            <>
              <View style={{ height: t.space(2.5) }} />
              <Label>Priority</Label>
              <Segmented
                value={finding.priority ?? 'medium'}
                onChange={(priority) => onChange({ priority })}
                options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              />
              <View style={{ height: t.space(2.5) }} />
              <Field
                label="Programmed with"
                value={finding.relatedRefs.join(', ')}
                onChangeText={(v) => onChange({
                  relatedRefs: v.split(',').map((s) => s.trim()).filter(Boolean),
                })}
                autoCapitalize="characters"
                placeholder="R-01"
                hint="Other findings this one is scoped alongside"
              />
            </>
          ) : null}

          <View style={{ height: t.space(3) }} />
          <Label>Photographs</Label>
          <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
            These print in the report's photographic register, grouped under {ref} and numbered in
            the order they were taken.
          </Txt>
          {finding.photos.length ? (
            <Rowed gap={2} style={{ flexWrap: 'wrap', marginTop: t.space(2) }}>
              {finding.photos.map((path) => (
                <Pressable
                  key={path}
                  onPress={() => Alert.alert('Remove this photograph?', 'It stays on the device; it just leaves the register.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => onChange({ photos: finding.photos.filter((p) => p !== path) }),
                    },
                  ])}
                >
                  <Image
                    source={{ uri: photoUri(path) }}
                    style={{ width: 76, height: 76, borderRadius: t.radius.sm }}
                  />
                </Pressable>
              ))}
            </Rowed>
          ) : null}
          <Rowed gap={2} style={{ marginTop: t.space(2) }}>
            <Button title="Take one" variant="secondary" compact style={{ flex: 1 }} onPress={() => void addPhoto(true)} />
            <Button title="From the gallery" variant="ghost" compact style={{ flex: 1 }} onPress={() => void addPhoto(false)} />
          </Rowed>

          <View style={{ height: t.space(3) }} />
          <Button title={`Remove ${ref}`} variant="ghost" compact onPress={onRemove} />
        </>
      ) : null}
    </Card>
  );
}
