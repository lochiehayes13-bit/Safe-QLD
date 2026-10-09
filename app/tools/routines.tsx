import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  FREQUENCY_LABEL, SERVICE_ROUTINES, SOURCE_LABEL, type ServiceRoutine, type TestDef,
} from '@/seed/serviceRoutines';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { findRoutines } from '@/domain/docSearch';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, EmptyState, Label, Rowed, Screen, SearchBox, Txt } from '@/components/ui';

/**
 * Service routine reference.
 *
 * Answers "what am I actually meant to do here", and — just as usefully — "why
 * am I doing it", by naming the source of every check.
 *
 * Opened with `?id=` from a search result, that routine's system is filtered
 * to and the routine opens expanded, so it is on screen without scrolling.
 */
export default function RoutinesScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const linked = useMemo(() => SERVICE_ROUTINES.find((r) => r.id === id), [id]);
  const [system, setSystem] = useState<string | undefined>(linked?.system);
  const [open, setOpen] = useState<string | undefined>(linked?.id);
  const [search, setSearch] = useState('');

  // A second search result opening this screen again brings a new routine.
  const [lastLinked, setLastLinked] = useState(linked);
  if (linked !== lastLinked) {
    setLastLinked(linked);
    if (linked) {
      setSystem(linked.system);
      setOpen(linked.id);
      setSearch('');
    }
  }

  const systems = useMemo(() => [...new Set(SERVICE_ROUTINES.map((r) => r.system))], []);
  const searching = search.trim().length > 0;
  const shown = useMemo(() => {
    const inSystem = system ? SERVICE_ROUTINES.filter((r) => r.system === system) : SERVICE_ROUTINES;
    return findRoutines(inSystem, search);
  }, [system, search]);

  return (
    <>
      <Stack.Screen options={{ title: 'Service routines' }} />
      <Screen>
        <Banner
          tone="info"
          title="Our summary"
          body="Confirm figures in AS 1851 or the panel manual."
        />

        <SearchBox value={search} onChange={setSearch} placeholder="Search routines and checks" />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label="All" selected={!system} onPress={() => setSystem(undefined)} />
          {systems.map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(system === s ? undefined : s)} />
          ))}
        </ScrollView>

        {shown.length ? shown.map(({ routine, checks }) => (
          <RoutineCard
            key={routine.id}
            routine={routine}
            checks={checks}
            open={open === routine.id}
            onToggle={() => setOpen(open === routine.id ? undefined : routine.id)}
          />
        )) : (
          <EmptyState
            icon="magnify-close"
            title="No match"
            body={searching ? 'Try fewer words or clear the system filter.' : 'No routines for this system.'}
          />
        )}
      </Screen>
    </>
  );
}

function RoutineCard({
  routine, checks, open, onToggle,
}: { routine: ServiceRoutine; checks: TestDef[]; open: boolean; onToggle: () => void }) {
  const t = useTheme();
  const narrowed = checks.length < routine.tests.length;
  return (
    <Card>
      <Pressable onPress={onToggle}>
        <Rowed align="flex-start" gap={2}>
          <View style={{ flex: 1 }}>
            <Txt weight="700">{routine.label}</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{routine.description}</Txt>
            <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
              <Chip label={FREQUENCY_LABEL[routine.frequency]} />
              <Chip
                label={narrowed
                  ? `${checks.length} of ${routine.tests.length} checks match`
                  : `${routine.tests.length} checks`}
                tone={narrowed ? 'accent' : 'default'}
              />
            </Rowed>
          </View>
          <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={t.color.textFaint} />
        </Rowed>
      </Pressable>

      {open ? (
        <View style={{ marginTop: t.space(3), gap: t.space(3) }}>
          {routine.sourceRef ? <Txt size="xs" tone="faint">{routine.sourceRef}</Txt> : null}
          {checks.map((test) => <TestCard key={test.id} test={test} />)}
        </View>
      ) : null}
    </Card>
  );
}

function TestCard({ test }: { test: TestDef }) {
  const t = useTheme();
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: t.color.border, paddingLeft: t.space(3), gap: 4 }}>
      <Label>{test.section}</Label>
      <Txt weight="600" style={{ lineHeight: 20 }}>{test.label}</Txt>

      {test.whatToDo ? <Detail label="Do" text={test.whatToDo} /> : null}
      {test.whatToLookFor ? <Detail label="Look for" text={test.whatToLookFor} /> : null}
      {test.passCriteria ? <Detail label="Pass" text={test.passCriteria} tone="pass" /> : null}
      {test.failCriteria ? <Detail label="Fail" text={test.failCriteria} tone="fail" /> : null}

      <Rowed gap={2} wrap style={{ marginTop: 4 }}>
        <Chip label={SOURCE_LABEL[test.sourceKind]} tone={test.sourceKind === 'internal' ? 'warn' : 'default'} />
        {test.photoRequired ? <Chip label="Photo required" tone="accent" /> : null}
        {test.measurementKey ? <Chip label={`Record ${test.measurementKey}${test.measurementUnit ? ` (${test.measurementUnit})` : ''}`} /> : null}
        {test.defectCode ? <Chip label={test.defectCode} /> : null}
      </Rowed>

      {test.verify ? (
        <Txt size="xs" tone="warn" style={{ marginTop: 4, lineHeight: 17 }}>
          Confirm this figure in the standard or manual.
        </Txt>
      ) : null}
    </View>
  );
}

function Detail({ label, text, tone }: { label: string; text: string; tone?: 'pass' | 'fail' }) {
  return (
    <Rowed gap={2} align="flex-start">
      <Txt size="xs" tone={tone ?? 'faint'} weight="700" style={{ minWidth: 58 }}>{label}</Txt>
      <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{text}</Txt>
    </Rowed>
  );
}
