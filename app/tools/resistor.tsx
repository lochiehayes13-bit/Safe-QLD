import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  COLOURS,
  DIGIT_COLOURS,
  MULTIPLIER_COLOURS,
  TCR_COLOURS,
  TOLERANCE_COLOURS,
  colourSpec,
  decodeBands,
  encodeBands,
  formatOhms,
  isPreferredValue,
  nearestPreferred,
  parseOhms,
  shorthandOhms,
  type BandColour,
  type BandCount,
} from '@/calc/resistor';
import { useTheme } from '@/theme';
import { Banner, Card, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/**
 * Resistor decoder.
 *
 * Works both ways. Decoding is what you reach for with an unknown part in your
 * hand; encoding is what you reach for when the drawing says 4k7 and you want
 * to confirm the bands before fitting it.
 */

type Mode = 'decode' | 'encode';

const DEFAULT_BANDS: BandColour[] = ['yellow', 'violet', 'red', 'gold', 'brown', 'brown'];

export default function ResistorScreen() {
  const [mode, setMode] = useState<Mode>('decode');
  const [count, setCount] = useState<BandCount>(4);
  const [bands, setBands] = useState<BandColour[]>(DEFAULT_BANDS);
  const [valueText, setValueText] = useState('4k7');
  const [tolerance, setTolerance] = useState(5);

  return (
    <>
      <Stack.Screen options={{ title: 'Resistor decoder' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'decode', label: 'Bands → value' },
            { value: 'encode', label: 'Value → bands' },
          ]}
        />

        <Segmented
          value={String(count)}
          onChange={(v) => setCount(Number(v) as BandCount)}
          options={[
            { value: '3', label: '3 band' },
            { value: '4', label: '4 band' },
            { value: '5', label: '5 band' },
            { value: '6', label: '6 band' },
          ]}
        />

        {mode === 'decode' ? (
          <DecodeView count={count} bands={bands} setBands={setBands} />
        ) : (
          <EncodeView
            count={count}
            valueText={valueText}
            setValueText={setValueText}
            tolerance={tolerance}
            setTolerance={setTolerance}
          />
        )}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------

function DecodeView({
  count,
  bands,
  setBands,
}: {
  count: BandCount;
  bands: BandColour[];
  setBands: (b: BandColour[]) => void;
}) {
  const t = useTheme();
  const result = useMemo(() => decodeBands(bands, count), [bands, count]);

  const setBand = (i: number, c: BandColour) => {
    const next = [...bands];
    next[i] = c;
    setBands(next);
  };

  const digitCount = count >= 5 ? 3 : 2;
  const slots: { label: string; options: BandColour[]; index: number }[] = [];
  for (let i = 0; i < digitCount; i++) {
    slots.push({ label: `Digit ${i + 1}`, options: DIGIT_COLOURS, index: i });
  }
  slots.push({ label: 'Multiplier', options: MULTIPLIER_COLOURS, index: digitCount });
  if (count >= 4) slots.push({ label: 'Tolerance', options: TOLERANCE_COLOURS, index: digitCount + 1 });
  if (count === 6) slots.push({ label: 'Temp. coeff.', options: TCR_COLOURS, index: digitCount + 2 });

  return (
    <>
      <ResistorGraphic bands={bands.slice(0, count)} />

      {result.ok ? (
        <ResultBlock
          label="Resistance"
          value={result.display ?? ''}
          detail={`${result.shorthand}  ·  ±${result.tolerancePct}%  ·  ${formatOhms(result.minOhms!)} to ${formatOhms(result.maxOhms!)}${
            result.tcrPpm !== undefined ? `  ·  ${result.tcrPpm} ppm/K` : ''
          }`}
        />
      ) : (
        <Banner tone="fail" title="That band combination is not valid" body={result.error} />
      )}

      {result.ok && result.ohms !== undefined ? <PreferredNote ohms={result.ohms} /> : null}

      {slots.map((s) => (
        <View key={s.label} style={{ gap: t.space(1.5) }}>
          <Label>{s.label}</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
            {s.options.map((c) => (
              <Swatch key={c} colour={c} selected={bands[s.index] === c} onPress={() => setBand(s.index, c)} />
            ))}
          </ScrollView>
        </View>
      ))}
    </>
  );
}

function EncodeView({
  count,
  valueText,
  setValueText,
  tolerance,
  setTolerance,
}: {
  count: BandCount;
  valueText: string;
  setValueText: (v: string) => void;
  tolerance: number;
  setTolerance: (v: number) => void;
}) {
  const ohms = useMemo(() => parseOhms(valueText), [valueText]);
  const bands = useMemo(
    () => (ohms === null ? null : encodeBands(ohms, count, tolerance, count === 6 ? 100 : undefined)),
    [ohms, count, tolerance],
  );

  return (
    <>
      <Field
        label="Resistance"
        value={valueText}
        onChangeText={setValueText}
        placeholder="4k7, 470R, 10k, 1M"
        autoCapitalize="none"
        hint="Accepts shorthand (4k7), decimals (4.7k) or plain ohms (4700)"
      />

      <Segmented
        value={String(tolerance)}
        onChange={(v) => setTolerance(parseFloat(v))}
        options={[
          { value: '1', label: '±1%' },
          { value: '2', label: '±2%' },
          { value: '5', label: '±5%' },
          { value: '10', label: '±10%' },
        ]}
      />

      {ohms === null ? (
        <Banner tone="warn" title="Enter a resistance" body="Try 4k7, 470R, 10k or 4700." />
      ) : bands === null ? (
        <Banner
          tone="warn"
          title="Not representable with these bands"
          body={`${formatOhms(ohms)} at ±${tolerance}% cannot be shown on a ${count}-band resistor. A three-significant-figure value needs 5 or 6 bands.`}
        />
      ) : (
        <>
          <ResistorGraphic bands={bands} />
          <ResultBlock
            label="Bands"
            value={bands.map((b) => colourSpec(b)?.label ?? b).join(' · ')}
            detail={`${formatOhms(ohms)}  ·  ${shorthandOhms(ohms)}  ·  ±${tolerance}%`}
          />
          <PreferredNote ohms={ohms} />
        </>
      )}
    </>
  );
}

function PreferredNote({ ohms }: { ohms: number }) {
  const inE24 = isPreferredValue(ohms, 'E24');
  const inE96 = isPreferredValue(ohms, 'E96');
  if (inE24) return <Banner tone="pass" title="E24 preferred value" body="A standard 5% series value — readily available." />;
  if (inE96) return <Banner tone="pass" title="E96 preferred value" body="A standard 1% series value." />;

  const near24 = nearestPreferred(ohms, 'E24');
  return (
    <Banner
      tone="info"
      title="Not a preferred value"
      body={`This is not in the E24 or E96 series. The nearest E24 value is ${near24 !== null ? formatOhms(near24) : '—'}.`}
    />
  );
}

/** Draws the resistor body with its bands, so the picker matches the part in hand. */
function ResistorGraphic({ bands }: { bands: BandColour[] }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: t.space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
        <View style={{ flex: 1, height: 3, backgroundColor: t.color.borderStrong }} />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            height: 74,
            width: 224,
            borderRadius: 26,
            backgroundColor: t.mode === 'dark' ? '#D8CBAE' : '#E8DCC0',
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.25)',
            paddingHorizontal: 14,
          }}
        >
          {bands.map((b, i) => {
            const spec = colourSpec(b);
            return (
              <View
                key={`${b}-${i}`}
                style={{
                  width: 15,
                  height: 74,
                  backgroundColor: spec?.hex ?? 'transparent',
                  borderWidth: spec?.needsOutline ? 1 : 0,
                  borderColor: 'rgba(0,0,0,0.45)',
                }}
              />
            );
          })}
        </View>
        <View style={{ flex: 1, height: 3, backgroundColor: t.color.borderStrong }} />
      </View>
    </View>
  );
}

function Swatch({ colour, selected, onPress }: { colour: BandColour; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const spec = colourSpec(colour);
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 5, width: 58 }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: t.radius.md,
          backgroundColor: spec?.hex ?? 'transparent',
          borderWidth: selected ? 3 : spec?.needsOutline ? 1 : 0,
          borderColor: selected ? t.color.accent : t.color.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {colour === 'none' ? <Txt size="xs" tone="faint">—</Txt> : null}
      </View>
      <Txt size="xs" tone={selected ? 'accent' : 'muted'} weight={selected ? '700' : '400'} numberOfLines={1}>
        {spec?.label ?? colour}
      </Txt>
    </Pressable>
  );
}
