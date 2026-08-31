import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { QUANTITIES, convertAll, formatValue, type Quantity, type Unit } from '@/calc/units';
import { useTheme } from '@/theme';
import { Card, Chip, Field, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Unit converter.
 *
 * Shows every unit at once rather than making you pick a target — on site the
 * useful question is "what is this in everything else", and picking a second
 * unit is an extra tap for no information.
 */
export default function ConverterScreen() {
  const t = useTheme();
  const [quantity, setQuantity] = useState<Quantity>(QUANTITIES[0]!);
  const [unit, setUnit] = useState<Unit>(QUANTITIES[0]!.units[0]!);
  const [text, setText] = useState('700');

  const value = useMemo(() => {
    const v = parseFloat(text);
    return Number.isFinite(v) ? v : Number.NaN;
  }, [text]);

  const results = useMemo(() => convertAll(value, unit, quantity), [value, unit, quantity]);

  return (
    <>
      <Stack.Screen options={{ title: 'Converter' }} />
      <Screen>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          {QUANTITIES.map((q) => (
            <Chip
              key={q.id}
              label={q.label}
              selected={quantity.id === q.id}
              onPress={() => { setQuantity(q); setUnit(q.units[0]!); }}
            />
          ))}
        </ScrollView>

        <Field label="Value" value={text} onChangeText={setText} keyboardType="numeric" suffix={unit.symbol} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          {quantity.units.map((u) => (
            <Chip key={u.id} label={u.symbol} selected={unit.id === u.id} onPress={() => setUnit(u)} />
          ))}
        </ScrollView>

        <Card>
          {results.map((r, i) => {
            const isSource = r.unit.id === unit.id;
            return (
              <Pressable
                key={r.unit.id}
                onPress={() => void Clipboard.setStringAsync(formatValue(r.value))}
                style={{
                  paddingVertical: t.space(2.5),
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.color.border,
                }}
              >
                <Rowed style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Txt size="sm" tone={isSource ? 'accent' : 'muted'} weight={isSource ? '700' : '400'}>
                      {r.unit.label}
                    </Txt>
                  </View>
                  <Rowed gap={2} align="baseline">
                    <Txt size="lg" weight="700" mono tone={isSource ? 'accent' : 'default'}>
                      {formatValue(r.value)}
                    </Txt>
                    <Txt size="sm" tone="muted" style={{ minWidth: 52 }}>{r.unit.symbol}</Txt>
                  </Rowed>
                </Rowed>
              </Pressable>
            );
          })}
        </Card>

        <Rowed gap={2}>
          <MaterialCommunityIcons name="content-copy" size={14} color={t.color.textFaint} />
          <Txt size="xs" tone="faint">Tap any row to copy it.</Txt>
        </Rowed>
      </Screen>
    </>
  );
}
