import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { readNumber, toggleSign } from '@/calc/fieldNumber';
import { QUANTITIES, convertAll, formatValue, type Quantity, type Unit } from '@/calc/units';
import { useTheme } from '@/theme';
import { Button, Card, Chip, Field, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Quantities a reading can go below zero in: a temperature, or a compound
 * gauge on the suction side of a pump. These get a ± key, because the iPhone's
 * decimal keypad has no minus.
 */
const SIGNED = new Set(['temperature', 'pressure']);

/** How long the "Copied" mark stays on a row. */
const COPIED_MS = 1500;

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
  const [text, setText] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const value = useMemo(() => readNumber(text) ?? Number.NaN, [text]);
  const results = useMemo(() => convertAll(value, unit, quantity), [value, unit, quantity]);
  const signed = SIGNED.has(quantity.id);

  const pickQuantity = (q: Quantity) => {
    setQuantity(q);
    setUnit(q.units[0]!);
    // A minus carried over from a temperature means nothing on a length.
    if (!SIGNED.has(q.id)) setText((prev) => prev.replace(/^\s*-/, ''));
  };

  const copy = (unitId: string, v: number) => {
    if (!Number.isFinite(v)) return;
    Clipboard.setStringAsync(formatValue(v))
      .then((ok) => {
        if (ok === false) return;
        setCopied(unitId);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
      })
      .catch(() => undefined);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Unit converter' }} />
      <Screen>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          {QUANTITIES.map((q) => (
            <Chip
              key={q.id}
              label={q.label}
              selected={quantity.id === q.id}
              onPress={() => pickQuantity(q)}
            />
          ))}
        </ScrollView>

        <Rowed gap={2} align="flex-end">
          <View style={{ flex: 1 }}>
            <Field label="Value" value={text} onChangeText={setText} keyboardType="decimal-pad" suffix={unit.symbol} />
          </View>
          {signed ? (
            <Button title="±" variant="secondary" onPress={() => setText(toggleSign(text))} />
          ) : null}
        </Rowed>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          {quantity.units.map((u) => (
            <Chip key={u.id} label={u.symbol} selected={unit.id === u.id} onPress={() => setUnit(u)} />
          ))}
        </ScrollView>

        <Card>
          {results.map((r, i) => {
            const isSource = r.unit.id === unit.id;
            const justCopied = copied === r.unit.id;
            return (
              <Pressable
                key={r.unit.id}
                onPress={() => copy(r.unit.id, r.value)}
                disabled={!Number.isFinite(r.value)}
                style={{
                  paddingVertical: t.space(2.5),
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.color.border,
                }}
              >
                <Rowed style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    {justCopied ? (
                      <Rowed gap={1}>
                        <MaterialCommunityIcons name="check" size={14} color={t.color.pass} />
                        <Txt size="sm" tone="pass" weight="700">Copied</Txt>
                      </Rowed>
                    ) : (
                      <Txt size="sm" tone={isSource ? 'accent' : 'muted'} weight={isSource ? '700' : '400'}>
                        {r.unit.label}
                      </Txt>
                    )}
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
          <Txt size="xs" tone="faint">Tap a row to copy it.</Txt>
        </Rowed>
      </Screen>
    </>
  );
}
