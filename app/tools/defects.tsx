import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  DEFECT_LIBRARY, SEVERITY_LABEL, type DefectCode,
} from '@/seed/defectLibrary';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { defectSearchText, filterByWords } from '@/domain/docSearch';
import { useTheme } from '@/theme';
import { Card, Chip, Divider, EmptyState, Label, Rowed, Screen, SearchBox, Txt } from '@/components/ui';

/**
 * Defect library reference — the wording that goes on a report.
 *
 * Opened with `?code=` from a search result, the code goes into the search box
 * so that defect's card is the one on screen; clearing the box shows the rest.
 */
export default function DefectLibraryScreen() {
  const t = useTheme();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [search, setSearch] = useState(code ?? '');
  const [system, setSystem] = useState<string>();

  // A second search result opening this screen again brings a new code.
  const [lastCode, setLastCode] = useState(code);
  if (code !== lastCode) {
    setLastCode(code);
    if (code) { setSearch(code); setSystem(undefined); }
  }

  const systems = useMemo(() => [...new Set(DEFECT_LIBRARY.map((d) => d.system))], []);
  const shown = useMemo(() => {
    const exact = DEFECT_LIBRARY.find((d) => d.code.toLowerCase() === search.trim().toLowerCase());
    let list = exact ? [exact] : filterByWords(DEFECT_LIBRARY, search, defectSearchText);
    if (system) list = list.filter((d) => d.system === system);
    return list;
  }, [search, system]);

  return (
    <>
      <Stack.Screen options={{ title: 'Defect wording' }} />
      <Screen>
        <SearchBox value={search} onChange={setSearch} placeholder="Search defects and wording" />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label={`All ${DEFECT_LIBRARY.length}`} selected={!system} onPress={() => setSystem(undefined)} />
          {systems.map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(system === s ? undefined : s)} />
          ))}
        </ScrollView>

        <Txt size="sm" tone="muted">{shown.length} shown</Txt>

        {shown.length ? shown.map((d) => <DefectCard key={d.code} defect={d} />) : (
          <EmptyState
            icon="magnify-close"
            title="No match"
            body="Try fewer words or clear the system filter."
          />
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
