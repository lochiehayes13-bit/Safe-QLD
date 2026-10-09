import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import {
  DIGIT_COLOURS,
  MULTIPLIER_COLOURS,
  TCR_COLOURS,
  TOLERANCE_COLOURS,
  colourSpec,
  decodeBands,
  encodeBands,
  fewestBandsFor,
  formatOhms,
  isPreferredValue,
  nearestPreferred,
  parseOhms,
  shorthandOhms,
  type BandColour,
  type BandCount,
} from '@/calc/resistor';
import { useTheme } from '@/theme';
import { Banner, Field, Label, ResultBlock, Screen, Segmented, Txt } from '@/components/ui';

/**
 * Resistor decoder.
 *
 * Works both ways. Decoding is what you reach for with an unknown part in your
 * hand; encoding is what you reach for when the drawing says 4k7 and you want
 * to confirm the bands before fitting it.
 */

type Mode = 'decode' | 'encode';

/**
 * Each band is held by what it means rather than where it sits, so changing
 * the band count keeps the digits, multiplier and tolerance already picked.
 */
type Slot = 'd1' | 'd2' | 'd3' | 'mult' | 'tol' | 'tcr';
type Picks = Record<Slot, BandColour | null>;

const NO_PICKS: Picks = { d1: null, d2: null, d3: null, mult: null, tol: null, tcr: null };

const SLOT_LABEL: Record<Slot, string> = {
  d1: 'Digit 1', d2: 'Digit 2', d3: 'Digit 3', mult: 'Multiplier', tol: 'Tolerance', tcr: 'Temp. coefficient',
};

const SLOT_OPTIONS: Record<Slot, BandColour[]> = {
  d1: DIGIT_COLOURS, d2: DIGIT_COLOURS, d3: DIGIT_COLOURS,
  mult: MULTIPLIER_COLOURS, tol: TOLERANCE_COLOURS, tcr: TCR_COLOURS,
};

/** The slots on a resistor of this many bands, in the order they sit on the body. */
function slotsFor(count: BandCount): Slot[] {
  const slots: Slot[] = count >= 5 ? ['d1', 'd2', 'd3', 'mult'] : ['d1', 'd2', 'mult'];
  if (count >= 4) slots.push('tol');
  if (count === 6) slots.push('tcr');
  return slots;
}

/** A 3-band resistor has no tolerance band and is ±20%. */
const THREE_BAND_TOLERANCE = 20;

/** The temperature coefficient shown on a 6-band encode. */
const SIX_BAND_TCR = 100;

export default function ResistorScreen() {
  const [mode, setMode] = useState<Mode>('decode');
  const [count, setCount] = useState<BandCount>(4);
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const [valueText, setValueText] = useState('');
  const [tolerance, setTolerance] = useState(5);

  return (
    <>
      <Stack.Screen options={{ title: 'Resistor values' }} />
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
          <DecodeView count={count} picks={picks} setPicks={setPicks} />
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
  picks,
  setPicks,
}: {
  count: BandCount;
  picks: Picks;
  setPicks: (p: Picks) => void;
}) {
  const t = useTheme();
  const slots = slotsFor(count);
  const sequence = slots.map((s) => picks[s]);
  const complete = sequence.every((b): b is BandColour => b !== null);
  const result = complete ? decodeBands(sequence as BandColour[], count) : null;

  return (
    <>
      <ResistorGraphic bands={sequence} />

      {result === null ? (
        <Txt size="sm" tone="muted">Pick each band.</Txt>
      ) : result.ok ? (
        <ResultBlock
          label="Resistance"
          value={result.display ?? ''}
          detail={`${result.shorthand}  ·  ±${result.tolerancePct}%  ·  ${formatOhms(result.minOhms!)} to ${formatOhms(result.maxOhms!)}${
            result.tcrPpm !== undefined ? `  ·  ${result.tcrPpm} ppm/K` : ''
          }`}
        />
      ) : (
        <Banner tone="fail" title="Check the bands" body={result.error} />
      )}

      {result?.ok && result.ohms !== undefined ? <PreferredNote ohms={result.ohms} /> : null}

      {slots.map((s) => (
        <View key={s} style={{ gap: t.space(1.5) }}>
          <Label>{SLOT_LABEL[s]}</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
            {SLOT_OPTIONS[s].map((c) => (
              <Swatch key={c} colour={c} selected={picks[s] === c} onPress={() => setPicks({ ...picks, [s]: c })} />
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
  const shownTolerance = count === 3 ? THREE_BAND_TOLERANCE : tolerance;
  const bands = useMemo(
    () => (ohms === null ? null : encodeBands(ohms, count, tolerance, count === 6 ? SIX_BAND_TCR : undefined)),
    [ohms, count, tolerance],
  );
  const fewest = ohms === null ? null : fewestBandsFor(ohms);

  return (
    <>
      <Field
        label="Resistance"
        value={valueText}
        onChangeText={setValueText}
        autoCapitalize="none"
        hint="e.g. 4k7, 4.7k or 4700"
      />

      {count === 3 ? (
        <Txt size="sm" tone="muted">3 band is ±20%.</Txt>
      ) : (
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
      )}

      {!valueText.trim() ? null : ohms === null ? (
        <Banner tone="warn" title="Check the value" body="e.g. 4k7, 470R or 4700." />
      ) : bands === null ? (
        fewest !== null && fewest > count ? (
          <Banner tone="warn" title={`Can't show on ${count} bands`} body="Needs a 5 or 6 band resistor." />
        ) : (
          <Banner tone="warn" title="No colour code for this value" body="Too many significant figures, or out of range." />
        )
      ) : (
        <>
          <ResistorGraphic bands={bands} />
          <ResultBlock
            label="Bands"
            value={bands.map((b) => colourSpec(b)?.label ?? b).join(' · ')}
            detail={`${formatOhms(ohms)}  ·  ${shorthandOhms(ohms)}  ·  ±${shownTolerance}%${count === 6 ? `  ·  ${SIX_BAND_TCR} ppm/K` : ''}`}
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
  if (inE24) return <Banner tone="pass" title="E24 value" body="Standard 5% value." />;
  if (inE96) return <Banner tone="pass" title="E96 value" body="Standard 1% value." />;

  const near24 = nearestPreferred(ohms, 'E24');
  return (
    <Banner
      tone="info"
      title="Not a standard value"
      body={near24 !== null ? `Nearest E24 value: ${formatOhms(near24)}.` : undefined}
    />
  );
}

/** Draws the resistor body with its bands, so the picker matches the part in hand. */
function ResistorGraphic({ bands }: { bands: (BandColour | null)[] }) {
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
            const spec = b ? colourSpec(b) : undefined;
            return (
              <View
                key={`${b ?? 'unset'}-${i}`}
                style={{
                  width: 15,
                  height: 74,
                  backgroundColor: spec?.hex ?? 'transparent',
                  // An unpicked band is a faint outline, so the positions still show.
                  borderWidth: !spec || spec.needsOutline ? 1 : 0,
                  borderColor: spec ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)',
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
