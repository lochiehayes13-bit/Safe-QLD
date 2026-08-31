import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { addAssetEvent, queryAssets, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { createDefect, getSite } from '@/db/repo';
import { defectByCode } from '@/seed/defectLibrary';
import {
  FREQUENCY_LABEL, SERVICE_ROUTINES, SOURCE_LABEL, routineById, testsForAssetType,
  type ServiceRoutine, type TestDef,
} from '@/seed/serviceRoutines';
import { SYSTEM_LABELS, assetTypeById } from '@/seed/assetTypes';
import type { Site } from '@/domain/types';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * Running a service routine against a site's assets.
 *
 * This is what turns the routine definitions from a reference into work. The
 * technician picks a routine, the app finds the assets it applies to, and each
 * check is answered per asset. A failure raises its coded defect automatically
 * and writes the result onto the asset's timeline, so the history builds itself.
 *
 * "Not tested" is a distinct answer from "fail". Inaccessible devices are the
 * dominant real-world outcome on an annual, and treating them as a pass hides a
 * coverage gap while treating them as a failure invents a defect that is not
 * there.
 */
type Verdict = 'pass' | 'fail' | 'na' | 'not-tested';

interface Answer {
  verdict: Verdict;
  comment?: string;
  measurement?: string;
  /** Why it could not be tested — required when the verdict is not-tested. */
  reason?: string;
}

const NOT_TESTED_REASONS = [
  'No access to the area',
  'Access equipment required',
  'Tenant refused entry',
  'Device could not be located',
  'Isolated for other works',
  'Unsafe to test',
];

export default function RunRoutineScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; routineId?: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [routine, setRoutine] = useState<ServiceRoutine | null>(
    params.routineId ? (routineById(params.routineId) ?? null) : null,
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [activeAsset, setActiveAsset] = useState<string>();
  const [saving, setSaving] = useState(false);

  const draft = useDraft<Record<string, Answer>>(
    `routine:${params.siteId ?? 'x'}:${routine?.id ?? 'x'}`,
    {},
  );

  useEffect(() => {
    if (params.siteId) void getSite(params.siteId).then(setSite);
  }, [params.siteId]);

  const load = useCallback(async () => {
    if (!routine || !params.siteId) return;
    setAssets(await queryAssets({ siteId: params.siteId, system: routine.system, limit: 2000 }));
  }, [routine, params.siteId]);

  useEffect(() => { void load(); }, [load]);

  const answer = (key: string, patch: Partial<Answer>) =>
    draft.setValue((p) => ({ ...p, [key]: { verdict: 'not-tested', ...p[key], ...patch } }));

  const progress = useMemo(() => {
    if (!routine) return { done: 0, total: 0, failed: 0 };
    let total = 0;
    let done = 0;
    let failed = 0;
    // System-level checks are answered once; asset checks once per asset.
    for (const test of routine.tests) {
      if (!test.assetTypeId) {
        total++;
        const a = draft.value[test.id];
        if (a && a.verdict !== 'not-tested') done++;
        if (a?.verdict === 'fail') failed++;
      } else {
        for (const asset of assets.filter((x) => x.assetTypeId === test.assetTypeId)) {
          total++;
          const a = draft.value[`${test.id}:${asset.id}`];
          if (a && a.verdict !== 'not-tested') done++;
          if (a?.verdict === 'fail') failed++;
        }
      }
    }
    return { done, total, failed };
  }, [routine, assets, draft.value]);

  const finish = async () => {
    if (!routine || !site) return;
    setSaving(true);
    try {
      const prefs = await loadPrefs();
      const now = nowIso();
      let defectsRaised = 0;
      let recorded = 0;
      let gaps = 0;

      for (const test of routine.tests) {
        const targets = test.assetTypeId
          ? assets.filter((a) => a.assetTypeId === test.assetTypeId)
          : [null];

        for (const asset of targets) {
          const key = asset ? `${test.id}:${asset.id}` : test.id;
          const a = draft.value[key];
          if (!a) continue;

          // A check that could not be carried out is still part of the record.
          // It is written with its reason so the gap is visible and defensible
          // later, but it does not touch lastServicedAt — nothing was serviced.
          if (a.verdict === 'not-tested') {
            if (!a.reason) continue;
            if (asset) {
              await addAssetEvent({
                assetId: asset.id,
                kind: 'not-tested',
                occurredAt: now,
                technician: prefs.technicianName || undefined,
                summary: `${test.label} — not tested: ${a.reason}`,
                detail: a.comment,
                measurements: {},
              });
            }
            gaps++;
            continue;
          }

          if (asset) {
            await addAssetEvent({
              assetId: asset.id,
              kind: a.verdict === 'fail' ? 'failed' : a.verdict === 'pass' ? 'passed' : 'tested',
              occurredAt: now,
              technician: prefs.technicianName || undefined,
              summary: `${test.label} — ${a.verdict === 'fail' ? 'failed' : a.verdict === 'pass' ? 'passed' : 'not applicable'}`,
              detail: a.comment,
              measurements: a.measurement && test.measurementKey ? { [test.measurementKey]: a.measurement } : {},
            });
            await updateAsset(asset.id, {
              lastServicedAt: now,
              lastResult: a.verdict === 'fail' ? 'fail' : 'pass',
            });
            recorded++;
          }

          // A failed check raises its coded defect, so nothing depends on the
          // technician remembering to write one afterwards.
          if (a.verdict === 'fail' && test.defectCode) {
            const code = defectByCode(test.defectCode);
            if (code) {
              await createDefect({
                siteId: site.id,
                pointId: asset?.id,
                location: asset
                  ? [asset.level, asset.room, asset.name || assetTypeById(asset.assetTypeId)?.label].filter(Boolean).join(' ')
                  : site.name,
                description: [code.reportWording, a.comment?.trim()].filter(Boolean).join(' '),
                severity: code.severity === 'critical' ? 'critical' : 'non-critical',
                status: 'open',
                photos: [],
                notes: `${code.code} · raised from ${routine.label}, ${test.label}`,
              });
              defectsRaised++;
            }
          }
        }
      }

      await draft.discard();
      Alert.alert(
        'Routine recorded',
        [
          `${recorded} asset result${recorded === 1 ? '' : 's'} written to history.`,
          defectsRaised ? `${defectsRaised} defect${defectsRaised === 1 ? '' : 's'} raised automatically.` : null,
          gaps ? `${gaps} check${gaps === 1 ? '' : 's'} recorded as not tested, with the reason against the asset.` : null,
          progress.total - progress.done - gaps > 0
            ? `${progress.total - progress.done - gaps} check${progress.total - progress.done - gaps === 1 ? '' : 's'} left blank — these show as a coverage gap, not a pass.`
            : null,
        ].filter(Boolean).join('\n\n'),
      );
      router.back();
    } catch (e) {
      Alert.alert('Could not record', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!routine) {
    return (
      <>
        <Stack.Screen options={{ title: 'Run a routine' }} />
        <Screen>
          <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
            Pick the routine you are carrying out. The app finds the assets it applies to and records the results against
            each one.
          </Txt>
          {SERVICE_ROUTINES.map((r) => (
            <Card key={r.id} onPress={() => setRoutine(r)}>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{r.label}</Txt>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{r.description}</Txt>
                </View>
                <Chip label={FREQUENCY_LABEL[r.frequency]} />
              </Rowed>
            </Card>
          ))}
        </Screen>
      </>
    );
  }

  const systemChecks = routine.tests.filter((x) => !x.assetTypeId);
  const assetChecks = routine.tests.filter((x) => x.assetTypeId);
  const shownAsset = assets.find((a) => a.id === activeAsset);

  return (
    <>
      <Stack.Screen options={{ title: routine.label }} />
      <Screen>
        <Card>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt weight="700">{site?.name ?? 'Site'}</Txt>
              <Txt size="sm" tone="muted">{SYSTEM_LABELS[routine.system]} · {FREQUENCY_LABEL[routine.frequency]}</Txt>
            </View>
            <Chip
              label={`${progress.done}/${progress.total}`}
              tone={progress.failed ? 'fail' : progress.done === progress.total && progress.total > 0 ? 'pass' : 'default'}
            />
          </Rowed>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.color.surfaceAlt, marginTop: t.space(2), overflow: 'hidden' }}>
            <View
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                height: '100%',
                backgroundColor: progress.failed ? t.color.warn : t.color.pass,
              }}
            />
          </View>
        </Card>

        {draft.recovered ? (
          <Banner tone="info" title="Picked up where you left off" body="Answers from your last session were still here." />
        ) : null}

        {systemChecks.length ? (
          <>
            <H2>System checks</H2>
            {systemChecks.map((test) => (
              <CheckCard
                key={test.id}
                test={test}
                answer={draft.value[test.id]}
                onAnswer={(patch) => answer(test.id, patch)}
              />
            ))}
          </>
        ) : null}

        {assetChecks.length ? (
          <>
            <H2>Assets</H2>
            {!assets.length ? (
              <EmptyState
                title="No assets for this system yet"
                body="Add them to the site's register first, or import a device list. System checks above can still be recorded."
              />
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
                  {assets.map((a) => {
                    const type = assetTypeById(a.assetTypeId);
                    const answered = assetChecks
                      .filter((c) => c.assetTypeId === a.assetTypeId)
                      .every((c) => draft.value[`${c.id}:${a.id}`]?.verdict && draft.value[`${c.id}:${a.id}`]!.verdict !== 'not-tested');
                    return (
                      <Chip
                        key={a.id}
                        label={`${a.name || type?.label}${answered ? ' ✓' : ''}`}
                        selected={activeAsset === a.id}
                        onPress={() => setActiveAsset(activeAsset === a.id ? undefined : a.id)}
                      />
                    );
                  })}
                </ScrollView>

                {shownAsset ? (
                  assetChecks
                    .filter((c) => c.assetTypeId === shownAsset.assetTypeId)
                    .map((test) => (
                      <CheckCard
                        key={`${test.id}:${shownAsset.id}`}
                        test={test}
                        answer={draft.value[`${test.id}:${shownAsset.id}`]}
                        onAnswer={(patch) => answer(`${test.id}:${shownAsset.id}`, patch)}
                      />
                    ))
                ) : (
                  <Txt tone="faint" size="sm">Pick an asset above to record its checks.</Txt>
                )}
              </>
            )}
          </>
        ) : null}

        <Button title="Record this routine" onPress={finish} loading={saving} />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Failures raise their coded defect automatically. Anything left untested is reported as a coverage gap, never as a
          pass.
        </Txt>
      </Screen>
    </>
  );
}

function CheckCard({
  test, answer, onAnswer,
}: {
  test: TestDef;
  answer: Answer | undefined;
  onAnswer: (patch: Partial<Answer>) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const verdict = answer?.verdict ?? 'not-tested';

  const set = (v: Verdict) => {
    void Haptics.impactAsync(v === 'fail' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    onAnswer({ verdict: v });
  };

  return (
    <Card>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Rowed align="flex-start" gap={2}>
          <View style={{ flex: 1 }}>
            <Label>{test.section}</Label>
            <Txt weight="600" style={{ marginTop: 3, lineHeight: 20 }}>{test.label}</Txt>
          </View>
          <MaterialCommunityIcons name={open ? 'chevron-up' : 'information-outline'} size={18} color={t.color.textFaint} />
        </Rowed>
      </Pressable>

      {open ? (
        <View style={{ marginTop: t.space(2), gap: 4 }}>
          {test.whatToDo ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>Do: {test.whatToDo}</Txt> : null}
          {test.whatToLookFor ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>Look for: {test.whatToLookFor}</Txt> : null}
          {test.passCriteria ? <Txt size="sm" tone="pass" style={{ lineHeight: 19 }}>Pass: {test.passCriteria}</Txt> : null}
          {test.failCriteria ? <Txt size="sm" tone="fail" style={{ lineHeight: 19 }}>Fail: {test.failCriteria}</Txt> : null}
          <Rowed gap={2} wrap style={{ marginTop: 4 }}>
            <Chip label={SOURCE_LABEL[test.sourceKind]} tone={test.sourceKind === 'internal' ? 'warn' : 'default'} />
            {test.defectCode ? <Chip label={test.defectCode} /> : null}
          </Rowed>
          {test.verify ? (
            <Txt size="xs" tone="warn" style={{ lineHeight: 17 }}>
              The actual figure or interval must come from the current standard or the manufacturer's documentation.
            </Txt>
          ) : null}
        </View>
      ) : null}

      <Rowed gap={2} style={{ marginTop: t.space(2.5) }}>
        <Verdict label="Pass" active={verdict === 'pass'} tone="pass" onPress={() => set('pass')} />
        <Verdict label="Fail" active={verdict === 'fail'} tone="fail" onPress={() => set('fail')} />
        <Verdict label="N/A" active={verdict === 'na'} tone="warn" onPress={() => set('na')} />
      </Rowed>

      {test.measurementKey ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Field
            label={test.measurementKey}
            value={answer?.measurement ?? ''}
            onChangeText={(v) => onAnswer({ measurement: v })}
            keyboardType="decimal-pad"
            suffix={test.measurementUnit}
          />
        </View>
      ) : null}

      {verdict === 'fail' ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Field
            label="What failed"
            value={answer?.comment ?? ''}
            onChangeText={(v) => onAnswer({ comment: v })}
            multiline
            hint={test.defectCode ? `Raises ${test.defectCode} when recorded` : undefined}
          />
        </View>
      ) : null}

      {verdict === 'not-tested' ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Label>Could not test? Say why</Label>
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            {NOT_TESTED_REASONS.map((r) => (
              <Chip
                key={r}
                label={r}
                selected={answer?.reason === r}
                onPress={() => onAnswer({ reason: answer?.reason === r ? undefined : r })}
              />
            ))}
          </Rowed>
        </View>
      ) : null}
    </Card>
  );
}

function Verdict({ label, active, tone, onPress }: { label: string; active: boolean; tone: 'pass' | 'fail' | 'warn'; onPress: () => void }) {
  const t = useTheme();
  const colour = { pass: t.color.pass, fail: t.color.fail, warn: t.color.warn }[tone];
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, minHeight: 44, borderRadius: t.radius.md,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? colour : t.color.surfaceAlt,
        borderWidth: 1, borderColor: active ? colour : t.color.border,
      }}
    >
      <Txt size="sm" weight="700" style={{ color: active ? '#fff' : t.color.textMuted }}>{label}</Txt>
    </Pressable>
  );
}
