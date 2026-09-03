import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { addAssetEvent, queryAssets, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { createDefect, getSite } from '@/db/repo';
import { recordRoutineRun } from '@/db/routineRunRepo';
import { defectByCode } from '@/seed/defectLibrary';
import {
  FREQUENCY_LABEL, SERVICE_ROUTINES, SOURCE_LABEL, routineById,
  type ServiceRoutine, type TestDef,
} from '@/seed/serviceRoutines';
import { SYSTEM_LABELS, assetTypeById } from '@/seed/assetTypes';
import type { Site } from '@/domain/types';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, Field, H2, Label, Rowed, Screen, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

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
 *
 * The assets are a list that narrows as you type, and the whole screen is that
 * list. A site with three hundred extinguishers is the normal case, not the
 * edge, and a horizontal strip of three hundred chips is a strip nobody can
 * find anything on. Tapping an asset opens its checks underneath it, so the
 * thing being answered stays on screen next to the thing it is about.
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

/** The words a technician might type to find an asset. */
function searchText(a: AssetRecord): string {
  return [a.name, a.code, a.level, a.room, a.locationNote, a.serial, assetTypeById(a.assetTypeId)?.label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function RunRoutineScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; routineId?: string }>();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(params.siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [routine, setRoutine] = useState<ServiceRoutine | null>(
    params.routineId ? (routineById(params.routineId) ?? null) : null,
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [activeAsset, setActiveAsset] = useState<string>();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const draft = useDraft<Record<string, Answer>>(
    `routine:${siteId ?? 'x'}:${routine?.id ?? 'x'}`,
    {},
  );

  useEffect(() => {
    if (siteId) void getSite(siteId).then(setSite);
  }, [siteId]);

  const load = useCallback(async () => {
    if (!routine || !siteId) return;
    setAssets(await queryAssets({ siteId, system: routine.system, limit: 2000 }));
  }, [routine, siteId]);

  useEffect(() => { void load(); }, [load]);

  const answer = (key: string, patch: Partial<Answer>) =>
    draft.setValue((p) => ({ ...p, [key]: { verdict: 'not-tested', ...p[key], ...patch } }));

  const systemChecks = useMemo(() => routine?.tests.filter((x) => !x.assetTypeId) ?? [], [routine]);
  const assetChecks = useMemo(() => routine?.tests.filter((x) => x.assetTypeId) ?? [], [routine]);

  /*
   * The assets this routine has checks for. A site's extinguishers and its
   * hose reels share a system, and a routine written for one has nothing to
   * ask about the other — listing it would be a row that can never be answered.
   */
  const applicable = useMemo(
    () => assets.filter((a) => assetChecks.some((c) => c.assetTypeId === a.assetTypeId)),
    [assets, assetChecks],
  );

  const progress = useMemo(() => {
    if (!routine) return { done: 0, total: 0, failed: 0, gaps: 0 };
    let total = 0;
    let done = 0;
    let failed = 0;
    // A check that could not be carried out, with the reason given. Not a
    // result, but not nothing either: it is what makes the run recordable
    // when every device was behind a locked door.
    let gaps = 0;
    const tally = (a: Answer | undefined) => {
      total++;
      if (a && a.verdict !== 'not-tested') done++;
      else if (a?.verdict === 'not-tested' && a.reason) gaps++;
      if (a?.verdict === 'fail') failed++;
    };
    // System-level checks are answered once; asset checks once per asset.
    for (const test of routine.tests) {
      if (!test.assetTypeId) {
        tally(draft.value[test.id]);
      } else {
        for (const asset of assets.filter((x) => x.assetTypeId === test.assetTypeId)) {
          tally(draft.value[`${test.id}:${asset.id}`]);
        }
      }
    }
    return { done, total, failed, gaps };
  }, [routine, assets, draft.value]);

  /** Nothing answered and nothing explained: the run is empty. */
  const nothingAnswered = progress.done + progress.gaps === 0;
  /** Checks with no answer at all, which the record will show as a gap. */
  const blank = progress.total - progress.done - progress.gaps;

  /** Whether every check on an asset has an answer. */
  const answered = useCallback((a: AssetRecord) => {
    const checks = assetChecks.filter((c) => c.assetTypeId === a.assetTypeId);
    return checks.length > 0 && checks.every((c) => {
      const v = draft.value[`${c.id}:${a.id}`]?.verdict;
      return v !== undefined && v !== 'not-tested';
    });
  }, [assetChecks, draft.value]);

  const answeredCount = useMemo(() => applicable.filter(answered).length, [applicable, answered]);

  const shownAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return applicable;
    return applicable.filter((a) => searchText(a).includes(q));
  }, [applicable, search]);

  const record = async () => {
    if (!routine || !site) return;
    setSaving(true);
    try {
      const prefs = await loadPrefs();
      const now = nowIso();
      let defectsRaised = 0;
      let recorded = 0;
      let gaps = 0;
      let passed = 0;
      let failed = 0;

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
          if (a.verdict === 'fail') failed++;
          else if (a.verdict === 'pass') passed++;

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
                // The code it was raised from, kept as a field rather than only
                // in the note, so the quote and the parts list can find it. The
                // library's rating stands in for the AS 1851 class until the
                // notice screen asks the question properly.
                defectCode: code.code,
                as1851Class: code.severity === 'critical' ? 'critical' : 'non-critical',
              });
              defectsRaised++;
            }
          }
        }
      }

      // Recorded even when every check was a pass: the run itself is what the
      // schedule counts, and a routine carried out but not recorded is one the
      // app will keep reporting as due.
      await recordRoutineRun({
        siteId: site.id,
        routineId: routine.id,
        routineLabel: routine.label,
        frequency: routine.frequency,
        system: routine.system,
        completedAt: now,
        technician: prefs.technicianName || undefined,
        checksPassed: passed,
        checksFailed: failed,
        checksNotTested: gaps,
        defectsRaised,
      });

      await draft.discard();
      showAlert(
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
      showAlert('Could not record', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /**
   * The gate in front of the record.
   *
   * Recording a run is what the schedule counts, so a run with nothing on it
   * would stamp the routine as done and push its next due date out on the
   * strength of a screen nobody touched. And a run with checks left blank is
   * legitimate — a locked riser is a locked riser — but the number of blanks
   * is put in front of the technician before it becomes the record.
   */
  const finish = () => {
    if (!routine || !site || nothingAnswered) return;
    if (blank > 0) {
      showAlert(
        `${blank} check${blank === 1 ? ' has' : 's have'} no answer`,
        `${blank === 1 ? 'It' : 'They'} will be recorded as a coverage gap, not as a pass. Record the routine anyway?`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Record', onPress: () => void record() },
        ],
      );
      return;
    }
    void record();
  };

  /*
   * A routine is recorded against a site, and `record()` returned silently when
   * there was not one — so opened from search rather than from a site, this
   * screen let a whole annual be answered and then did nothing at all when
   * "Record this routine" was pressed. Nothing was saved and nothing was said.
   */
  if (!siteId) return <ContextGate kind="site" what="a service routine run against its assets" title="Run a routine" />;

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

  const header = (
    <View style={{ gap: t.space(3) }}>
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
          {!applicable.length ? (
            <EmptyState
              title="No assets for this system yet"
              body="Add them to the site's register first, or import a device list. System checks above can still be recorded."
            />
          ) : (
            <>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Txt size="sm" tone="muted">{answeredCount} of {applicable.length} answered</Txt>
                <Chip
                  label={answeredCount === applicable.length ? 'All answered' : `${applicable.length - answeredCount} to go`}
                  tone={answeredCount === applicable.length ? 'pass' : 'default'}
                />
              </Rowed>
              <Field
                label="Find an asset"
                value={search}
                onChangeText={setSearch}
                placeholder="Name, level, room, serial or type"
                autoCapitalize="none"
              />
              <Txt tone="faint" size="sm">Tap an asset to record its checks; tap it again to close it.</Txt>
            </>
          )}
        </>
      ) : null}
    </View>
  );

  const footer = (
    <View style={{ gap: t.space(3), marginTop: t.space(2) }}>
      <Button title="Record this routine" onPress={finish} loading={saving} disabled={nothingAnswered} />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        {nothingAnswered
          ? 'Answer at least one check first. A run recorded with nothing on it would still count as the routine done, and push its next due date out.'
          : 'Failures raise their coded defect automatically. Anything left untested is reported as a coverage gap, never as a pass.'}
      </Txt>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: routine.label }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={shownAssets}
          keyExtractor={(a) => a.id}
          // The rows read the draft and the selection, neither of which is a
          // prop of the list, so it has to be told when they change.
          extraData={{ answers: draft.value, activeAsset }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(12) }}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={9}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            applicable.length ? (
              <Txt tone="faint" size="sm" style={{ textAlign: 'center' }}>Nothing matches “{search.trim()}”.</Txt>
            ) : null
          }
          renderItem={({ item }) => {
            const active = activeAsset === item.id;
            return (
              <View style={{ gap: t.space(3) }}>
                <AssetRow
                  asset={item}
                  answered={answered(item)}
                  active={active}
                  onPress={() => setActiveAsset(active ? undefined : item.id)}
                />
                {active ? (
                  <View style={{ gap: t.space(3), paddingLeft: t.space(3) }}>
                    {assetChecks
                      .filter((c) => c.assetTypeId === item.assetTypeId)
                      .map((test) => (
                        <CheckCard
                          key={`${test.id}:${item.id}`}
                          test={test}
                          answer={draft.value[`${test.id}:${item.id}`]}
                          onAnswer={(patch) => answer(`${test.id}:${item.id}`, patch)}
                        />
                      ))}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      </Screen>
    </>
  );
}

/** One asset in the list: what it is, where it is, and whether it is done. */
function AssetRow({
  asset, answered, active, onPress,
}: {
  asset: AssetRecord;
  answered: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const type = assetTypeById(asset.assetTypeId);
  const title = asset.name || type?.label || 'Asset';
  const detail = [asset.name ? type?.label : undefined, asset.level, asset.room].filter(Boolean).join(' · ');
  return (
    <Card onPress={onPress} style={active ? { borderWidth: 1, borderColor: t.color.accent } : undefined}>
      <Rowed gap={2.5}>
        <MaterialCommunityIcons
          name={answered ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={22}
          color={answered ? t.color.pass : t.color.textFaint}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="600" numberOfLines={1}>{title}</Txt>
          {detail ? <Txt size="xs" tone="muted" numberOfLines={1}>{detail}</Txt> : null}
        </View>
        <MaterialCommunityIcons name={active ? 'chevron-up' : 'chevron-down'} size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
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
      <Txt size="sm" weight="700" style={{ color: active ? t.color.onAccent : t.color.textMuted }}>{label}</Txt>
    </Pressable>
  );
}
