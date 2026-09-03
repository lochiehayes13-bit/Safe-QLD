import React, { useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  DEFECT_LIBRARY, SEVERITY_LABEL, searchDefects, type DefectCode,
} from '@/seed/defectLibrary';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { useTheme } from '@/theme';
import { Card, Chip, Divider, EmptyState, Label, Rowed, Screen, Txt } from '@/components/ui';

/** Defect library reference — the wording that goes on a report. */
export default function DefectLibraryScreen() {
  const t = useTheme();
  const [search, setSearch] = useState('');
  const [system, setSystem] = useState<string>();

  const systems = useMemo(() => [...new Set(DEFECT_LIBRARY.map((d) => d.system))], []);
  const shown = useMemo(() => {
    let list = search.trim() ? searchDefects(search) : DEFECT_LIBRARY;
    if (system) list = list.filter((d) => d.system === system);
    return list;
  }, [search, system]);

  return (
    <>
      <Stack.Screen options={{ title: 'Defect library' }} />
      <Screen>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: t.space(2),
            backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md,
            borderWidth: 1, borderColor: t.color.border,
            paddingHorizontal: t.space(3), minHeight: t.touch,
          }}
        >
          <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search defects and wording"
            placeholderTextColor={t.color.textFaint}
            style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label={`All ${DEFECT_LIBRARY.length}`} selected={!system} onPress={() => setSystem(undefined)} />
          {systems.map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(system === s ? undefined : s)} />
          ))}
        </ScrollView>

        <Txt size="sm" tone="muted">{shown.length} shown</Txt>

        {shown.length ? shown.map((d) => <DefectCard key={d.code} defect={d} />) : (
          <EmptyState title="Nothing matched" body="Try a shorter search or clear the system filter." />
        )}
      </Screen>
    </>
  );
}

function DefectCard({ defect }: { defect: DefectCode }) {
  const t = useTheme();
  return (
    <Card>
      <Rowed style={{ justifyContent: 'space-between' }}>
        <Label>{defect.code}</Label>
        <Chip
          label={SEVERITY_LABEL[defect.severity]}
          tone={defect.severity === 'critical' ? 'fail' : defect.severity === 'high' ? 'warn' : 'default'}
        />
      </Rowed>
      <Txt weight="700" style={{ marginTop: 4 }}>{defect.defect}</Txt>
      <Txt size="sm" tone="muted">{SYSTEM_LABELS[defect.system]} · {defect.component}</Txt>
      <Divider />
      <Label>Report wording</Label>
      <Txt size="sm" style={{ marginTop: 4, lineHeight: 20 }}>{defect.reportWording}</Txt>
      {defect.clientWording ? (
        <>
          <View style={{ height: t.space(2) }} />
          <Label>Client wording</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 20 }}>{defect.clientWording}</Txt>
        </>
      ) : null}
      {defect.rectification ? (
        <>
          <View style={{ height: t.space(2) }} />
          <Label>Rectification</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 20 }}>{defect.rectification}</Txt>
        </>
      ) : null}
      {defect.photoRequired ? (
        <Rowed gap={2} style={{ marginTop: t.space(2) }}>
          <MaterialCommunityIcons name="camera-outline" size={14} color={t.color.accentText} />
          <Txt size="xs" tone="accent">Photo required</Txt>
        </Rowed>
      ) : null}
    </Card>
  );
}
