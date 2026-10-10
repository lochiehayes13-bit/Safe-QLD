import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useConfig } from '@/hooks/useConfig';
import { contextId } from '@/domain/screenContext';
import { EFFECT_LABEL } from '@/export/sheets';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, EmptyState, Rowed, Screen, SearchBox, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { RecordGate } from '@/components/RecordGate';
import type { CauseKind } from '@/domain/types';

/**
 * The cause and effect as the panel holds it.
 *
 * The site version of this screen edits a matrix that a technician built. This
 * one shows what a vendor tool wrote, and shows the equation underneath it,
 * because that equation is the only thing that is definitely true: every
 * parser in this app turns vendor logic into causes and effects, and the
 * turning is where the reading can be wrong. Somebody checking whether zone 4
 * really does drop the dampers needs the line the panel was programmed with,
 * not this app's summary of it.
 *
 * Nothing here is editable, deliberately. This is a file, and a file that
 * changes when you look at it is no longer the record of anything.
 */

/** How each cause kind reads. The parsers use 'other' liberally; it is left plain. */
const CAUSE_LABEL: Record<CauseKind, string> = {
  'zone-alarm': 'Zone alarm',
  'point-alarm': 'Point alarm',
  mcp: 'Call point',
  'sprinkler-flow': 'Sprinkler flow',
  'gas-release': 'Gas release',
  'aspirating-alert': 'ASD alert',
  'aspirating-action': 'ASD action',
  'aspirating-fire1': 'ASD fire 1',
  'aspirating-fire2': 'ASD fire 2',
  fault: 'Fault',
  isolate: 'Isolate',
  manual: 'Manual',
  other: '',
};

export default function ConfigLogicScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = contextId(params.id);
  const { opened, failed, missing, reload } = useConfig(id);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [panelIndex, setPanelIndex] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim().toLowerCase()), 180);
    return () => clearTimeout(handle);
  }, [search]);

  const panels = opened?.parsed?.panels ?? [];
  const panel = panels[Math.min(panelIndex, Math.max(0, panels.length - 1))];

  const rules = useMemo(() => {
    const all = panel?.causeEffect ?? [];
    if (!debounced) return all;
    const words = debounced.split(/\s+/).filter(Boolean);
    return all.filter((rule) => {
      const text = [
        rule.causeLabel,
        rule.sourceLogic ?? '',
        rule.notes ?? '',
        rule.causePointRef ?? '',
        rule.causeZoneNumber !== undefined ? `zone ${rule.causeZoneNumber}` : '',
        ...rule.effects.map((e) => `${e.effectLabel} ${EFFECT_LABEL[e.effectKind]}`),
      ].join(' ').toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [panel, debounced]);

  /*
   * Which panels actually carry logic, so the chips do not offer four panels
   * where three of them are empty by construction. Several formats attach a
   * network's whole cause and effect to the first panel, and a technician who
   * taps panel 3 and finds nothing has no way to tell that from a bad read.
   */
  const withLogic = panels.filter((p) => p.causeEffect.length).length;

  if (!id) return <ContextGate kind="configuration" what="the cause and effect" title="Cause and effect" />;
  if (!opened) {
    return (
      <RecordGate
        missing={missing}
        what="configuration"
        why="It may have been removed from this phone."
        failed={failed}
        onRetry={reload}
      />
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Cause and effect' }} />

      {panels.length > 1 ? (
        <Rowed gap={2} wrap>
          {panels.map((p, i) => (
            <Chip
              key={`${p.name}-${i}`}
              label={`${p.name || `Panel ${i + 1}`}${p.causeEffect.length ? ` (${p.causeEffect.length})` : ''}`}
              selected={i === panelIndex}
              onPress={() => setPanelIndex(i)}
            />
          ))}
        </Rowed>
      ) : null}

      {panels.length > 1 && withLogic === 1 ? (
        <Banner
          tone="info"
          title="Logic is on one panel"
          body="The file stores the whole network's rules there."
        />
      ) : null}

      {(panel?.causeEffect.length ?? 0) > 6 ? (
        <SearchBox value={search} onChange={setSearch} placeholder="Zone, output or equation text" />
      ) : null}

      {/*
        * Said once, at the top, rather than left as an absence. None of the
        * seven readers brings a programmed delay across, so a rule shown here
        * with no delay against it is a rule whose delay was not read — not one
        * that operates immediately. The real Kentec file this was checked
        * against has a rule called "Roller Shutter Release O/P (30s Delay)",
        * and the thirty seconds is in the name because there is nowhere else
        * for it to be.
        */}
      {rules.length ? (
        <Banner
          tone="info"
          title="Delays aren't read from these files"
          body="No delay shown doesn't mean none. Check the rule name and confirm at the panel."
        />
      ) : null}

      {!rules.length ? (
        <EmptyState
          icon="sitemap-outline"
          title={debounced ? 'Nothing matches' : 'No cause and effect in this file'}
          body={
            debounced
              ? 'Try fewer words or just the zone number.'
              : 'Check Inside the file for the raw tables.'
          }
        />
      ) : (
        <>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            {`${rules.length.toLocaleString()} of ${(panel?.causeEffect.length ?? 0).toLocaleString()} rules. `}
            The equation is what the panel runs.
          </Txt>
          {rules.map((rule, i) => (
            <Card key={`${rule.causeLabel}-${i}`}>
              <Rowed gap={2} align="flex-start">
                <Txt weight="700" style={{ flex: 1 }}>{rule.causeLabel || `Rule ${i + 1}`}</Txt>
                {CAUSE_LABEL[rule.causeKind] ? <Chip label={CAUSE_LABEL[rule.causeKind]} /> : null}
              </Rowed>

              {rule.causeZoneNumber !== undefined || rule.causePointRef ? (
                <Txt size="xs" tone="muted" style={{ marginTop: t.space(1) }}>
                  {[
                    rule.causeZoneNumber !== undefined ? `Zone ${rule.causeZoneNumber}` : undefined,
                    rule.causePointRef,
                  ].filter(Boolean).join(' · ')}
                </Txt>
              ) : null}

              {rule.effects.length ? (
                <>
                  <View style={{ marginVertical: t.space(2) }}><Divider /></View>
                  {rule.effects.map((effect, e) => (
                    <Txt key={`${effect.id}-${e}`} size="sm" style={{ lineHeight: 19 }}>
                      {'→ '}
                      {effect.effectLabel || EFFECT_LABEL[effect.effectKind]}
                      {effect.delaySeconds ? (
                        <Txt size="sm" tone="warn">{` after ${effect.delaySeconds}s`}</Txt>
                      ) : null}
                      {effect.state === 'not-linked' ? <Txt size="sm" tone="faint"> (not linked)</Txt> : null}
                      {effect.state === 'conditional' ? <Txt size="sm" tone="faint"> (conditional)</Txt> : null}
                    </Txt>
                  ))}
                </>
              ) : (
                <Txt size="sm" tone="faint" style={{ marginTop: t.space(1) }}>
                  No outputs.
                </Txt>
              )}

              {rule.sourceLogic ? (
                <View style={{ marginTop: t.space(2), backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.sm, padding: t.space(2) }}>
                  <Txt size="xs" tone="muted" mono style={{ lineHeight: 17 }}>{rule.sourceLogic}</Txt>
                </View>
              ) : null}

              {rule.notes ? (
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>{rule.notes}</Txt>
              ) : null}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
