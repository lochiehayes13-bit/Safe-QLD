import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  FREQUENCY_LABEL, SERVICE_ROUTINES, SOURCE_LABEL, type ServiceRoutine, type TestDef,
} from '@/seed/serviceRoutines';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, Divider, Label, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Service routine reference.
 *
 * Answers "what am I actually meant to do here", and — just as usefully — "why
 * am I doing it", by naming the source of every check.
 */
export default function RoutinesScreen() {
  const t = useTheme();
  const [system, setSystem] = useState<string>();
  const [open, setOpen] = useState<string>();

  const systems = [...new Set(SERVICE_ROUTINES.map((r) => r.system))];
  const shown = system ? SERVICE_ROUTINES.filter((r) => r.system === system) : SERVICE_ROUTINES;

  return (
    <>
      <Stack.Screen options={{ title: 'Service routines' }} />
      <Screen>
        <Banner
          tone="info"
          title="Structure, not the standard itself"
          body="These describe what a routine covers in our own words. They are not a copy of any standard — where a figure or interval has to come from the current standard or the panel manual, the check says so."
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label="All" selected={!system} onPress={() => setSystem(undefined)} />
          {systems.map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(system === s ? undefined : s)} />
          ))}
        </ScrollView>

        {shown.map((r) => (
          <RoutineCard key={r.id} routine={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? undefined : r.id)} />
        ))}
      </Screen>
    </>
  );
}

function RoutineCard({ routine, open, onToggle }: { routine: ServiceRoutine; open: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <Card>
      <Pressable onPress={onToggle}>
        <Rowed align="flex-start" gap={2}>
          <View style={{ flex: 1 }}>
            <Txt weight="700">{routine.label}</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{routine.description}</Txt>
            <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
              <Chip label={FREQUENCY_LABEL[routine.frequency]} />
              <Chip label={`${routine.tests.length} checks`} />
            </Rowed>
          </View>
          <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={t.color.textFaint} />
        </Rowed>
      </Pressable>

      {open ? (
        <View style={{ marginTop: t.space(3), gap: t.space(3) }}>
          {routine.sourceRef ? <Txt size="xs" tone="faint">{routine.sourceRef}</Txt> : null}
          {routine.tests.map((test) => <TestCard key={test.id} test={test} />)}
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
          The actual figure or interval must come from the current standard or the manufacturer's documentation.
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
