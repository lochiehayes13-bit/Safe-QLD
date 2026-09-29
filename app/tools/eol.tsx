import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { EOL_VALUES, ZONE_STATE_TABLES, eolBrands } from '@/calc/eol';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, Divider, H2, Label, Rowed, Screen, Txt } from '@/components/ui';

/**
 * End-of-line reference.
 *
 * Deliberately per-panel with sources rather than one universal table, because
 * a universal table would be wrong on most sites.
 */
export default function EolScreen() {
  const t = useTheme();
  const [brand, setBrand] = useState<string>();
  const brands = useMemo(() => eolBrands(), []);
  const entries = useMemo(() => (brand ? EOL_VALUES.filter((e) => e.brand === brand) : EOL_VALUES), [brand]);
  const tables = useMemo(() => (brand ? ZONE_STATE_TABLES.filter((s) => s.panel.startsWith(brand)) : ZONE_STATE_TABLES), [brand]);

  return (
    <>
      <Stack.Screen options={{ title: 'End of line' }} />
      <Screen>
        <Banner
          tone="warn"
          title="There is no universal EOL value"
          body="It varies by panel, by card and often by configured mode, and several Australian panels sense current or voltage bands rather than resistance. Always confirm against the panel manual and the as-installed configuration."
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label="All" selected={!brand} onPress={() => setBrand(undefined)} />
          {brands.map((b) => (
            <Chip key={b} label={b} selected={brand === b} onPress={() => setBrand(brand === b ? undefined : b)} />
          ))}
        </ScrollView>

        <H2>Values</H2>
        {entries.map((e, i) => (
          <Card key={`${e.panel}-${e.circuit}-${i}`}>
            <Rowed style={{ justifyContent: 'space-between' }}>
              <Label>{e.brand}</Label>
              <Chip
                label={e.confidence}
                tone={e.confidence === 'high' ? 'pass' : e.confidence === 'low' ? 'warn' : 'default'}
              />
            </Rowed>
            <Txt weight="700" style={{ marginTop: 4 }}>{e.panel}</Txt>
            <Txt size="sm" tone="muted">{e.circuit}</Txt>
            <Divider />
            <Txt size="lg" weight="700" mono tone="accent">{e.value}</Txt>
            {e.notes ? <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>{e.notes}</Txt> : null}
            {e.source ? <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>{e.source}</Txt> : null}
          </Card>
        ))}

        <H2>Published state boundaries</H2>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Only a minority of panels publish these. Do not extrapolate one panel's bands to another.
        </Txt>
        {tables.map((s, i) => (
          <Card key={`${s.panel}-${i}`}>
            <Txt weight="700">{s.panel}</Txt>
            <Txt size="sm" tone="muted">{s.circuit}</Txt>
            <Divider />
            <Label>{s.method}</Label>
            {s.bands ? (
              <View style={{ marginTop: t.space(2), gap: 6 }}>
                {s.bands.map((b) => (
                  <Rowed key={b.range} style={{ justifyContent: 'space-between' }}>
                    <Txt size="sm" mono tone="muted">{b.range}</Txt>
                    <Txt
                      size="sm"
                      weight="700"
                      tone={b.state === 'Alarm' ? 'fail' : b.state === 'Normal' ? 'pass' : 'warn'}
                    >
                      {b.state}
                    </Txt>
                  </Rowed>
                ))}
              </View>
            ) : (
              <Txt size="sm" tone="warn" style={{ marginTop: t.space(2), lineHeight: 19 }}>
                This panel does not sense by resistance, so no band table applies.
              </Txt>
            )}
            {s.notes ? <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>{s.notes}</Txt> : null}
            {s.source ? <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>{s.source}</Txt> : null}
          </Card>
        ))}
      </Screen>
    </>
  );
}
