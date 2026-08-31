import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  PROTOCOLS, XPERT_PIPS, addressToRemovedPips, addressToRotary, addressToSwitches,
  removedPipsToAddress, rotaryToAddress, switchesToAddress, switchesToPattern,
  validateAddress, type AddressingMethod, type Protocol,
} from '@/calc/dipswitch';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/**
 * Device address calculator.
 *
 * The switch bank is drawn rather than described, because the whole point is to
 * match what is in your hand against what the panel expects.
 */
export default function DipswitchScreen() {
  const t = useTheme();
  const [protocol, setProtocol] = useState<Protocol>(PROTOCOLS[0]!);
  const [method, setMethod] = useState<AddressingMethod>('dip');
  const [switches, setSwitches] = useState<boolean[]>(() => addressToSwitches(11, 8));
  const [removed, setRemoved] = useState<number[]>([1, 2, 8]);
  const [tens, setTens] = useState(1);
  const [units, setUnits] = useState(1);
  const [target, setTarget] = useState('');

  const width = protocol.switchCount ?? 8;

  const address = useMemo(() => {
    if (method === 'dip') return switchesToAddress(switches, width);
    if (method === 'xpert7' || method === 'xpert8') return removedPipsToAddress(removed);
    if (method === 'rotary') return rotaryToAddress(tens, units);
    return 0;
  }, [method, switches, width, removed, tens, units]);

  const issues = useMemo(() => validateAddress(address, protocol, method), [address, protocol, method]);
  const errors = issues.filter((i) => i.level === 'error');

  const applyTarget = () => {
    const n = parseInt(target, 10);
    if (!Number.isFinite(n)) return;
    void Haptics.selectionAsync();
    setSwitches(addressToSwitches(n, 8));
    setRemoved(addressToRemovedPips(n, method === 'xpert8'));
    const r = addressToRotary(n);
    setTens(r.tens);
    setUnits(r.units);
  };

  const pickProtocol = (p: Protocol) => {
    setProtocol(p);
    // Land on a method the protocol actually supports.
    setMethod(p.methods[0] ?? 'dip');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Device address' }} />
      <Screen>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          {PROTOCOLS.map((p) => (
            <Chip key={p.id} label={p.label} selected={protocol.id === p.id} onPress={() => pickProtocol(p)} />
          ))}
        </ScrollView>

        <ResultBlock
          label="Address"
          value={String(address)}
          tone={errors.length ? 'fail' : 'accent'}
          detail={`${protocol.label} · valid ${protocol.minAddress} to ${protocol.maxAddress} · up to ${protocol.maxDevicesPerLoop} devices per loop`}
        />

        {protocol.methods.length > 1 ? (
          <Segmented
            value={method}
            onChange={(v) => setMethod(v as AddressingMethod)}
            options={protocol.methods.map((m) => ({
              value: m,
              label: m === 'dip' ? 'DIP switch' : m === 'rotary' ? 'Rotary' : m === 'programmer' ? 'Programmer' : 'XPERT card',
            }))}
          />
        ) : null}

        <Rowed gap={2} align="flex-end">
          <View style={{ flex: 1 }}>
            <Field label="Set to address" value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="e.g. 11" />
          </View>
          <Chip label="Apply" onPress={applyTarget} selected />
        </Rowed>

        {method === 'dip' ? (
          <>
            <H2>Switch bank</H2>
            <Card>
              <SwitchBank
                switches={switches}
                width={width}
                physical={protocol.physicalSwitchCount ?? width}
                onToggle={(i) => {
                  void Haptics.selectionAsync();
                  setSwitches((prev) => {
                    const next = [...prev];
                    next[i] = !next[i];
                    return next;
                  });
                }}
              />
              <Txt size="sm" mono tone="muted" style={{ textAlign: 'center', marginTop: t.space(2) }}>
                {switchesToPattern(switches, width)}
              </Txt>
            </Card>
          </>
        ) : null}

        {method === 'xpert7' || method === 'xpert8' ? (
          <>
            <H2>XPERT card</H2>
            <Card>
              <Txt size="sm" tone="muted" style={{ marginBottom: t.space(3), lineHeight: 19 }}>
                Punch out the pips shown filled. The address is the sum of what you remove — the opposite of a DIP switch.
              </Txt>
              <XpertCard
                removed={removed}
                xpert8={method === 'xpert8'}
                onToggle={(v) => {
                  void Haptics.selectionAsync();
                  setRemoved((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
                }}
              />
            </Card>
          </>
        ) : null}

        {method === 'rotary' ? (
          <>
            <H2>Rotary dials</H2>
            <Card>
              <Label>Tens — sixteen positions, not ten</Label>
              <Rowed gap={1.5} wrap style={{ marginTop: t.space(2) }}>
                {Array.from({ length: 16 }, (_, i) => (
                  <Chip key={i} label={String(i)} selected={tens === i} onPress={() => setTens(i)} />
                ))}
              </Rowed>
              <View style={{ height: t.space(3) }} />
              <Label>Units</Label>
              <Rowed gap={1.5} wrap style={{ marginTop: t.space(2) }}>
                {Array.from({ length: 10 }, (_, i) => (
                  <Chip key={i} label={String(i)} selected={units === i} onPress={() => setUnits(i)} />
                ))}
              </Rowed>
            </Card>
          </>
        ) : null}

        {method === 'programmer' ? (
          <Banner
            tone="info"
            title="No switches on this protocol"
            body={protocol.notes}
          />
        ) : null}

        {issues.map((issue, i) => (
          <Banner
            key={i}
            tone={issue.level === 'error' ? 'fail' : issue.level === 'warning' ? 'warn' : 'info'}
            title={issue.level === 'error' ? 'Not a valid address' : issue.level === 'warning' ? 'Watch for this' : 'Worth knowing'}
            body={issue.message}
          />
        ))}

        <Card>
          <Label>{protocol.label}</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 20 }}>{protocol.notes}</Txt>
        </Card>
      </Screen>
    </>
  );
}

/** Draws the switch block, with any non-address switches shown greyed. */
function SwitchBank({
  switches, width, physical, onToggle,
}: {
  switches: boolean[]; width: number; physical: number; onToggle: (i: number) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.mode === 'dark' ? '#1B3A6B' : '#2C5CA8',
        borderRadius: t.radius.sm,
        padding: t.space(2),
        gap: t.space(1.5),
        justifyContent: 'center',
      }}
    >
      {Array.from({ length: physical }, (_, i) => {
        const isAddress = i < width;
        const on = switches[i] ?? false;
        return (
          <Pressable
            key={i}
            onPress={() => (isAddress ? onToggle(i) : undefined)}
            style={{ alignItems: 'center', gap: 4, opacity: isAddress ? 1 : 0.4 }}
          >
            <Txt size="xs" style={{ color: '#fff', fontSize: 10 }}>{i + 1}</Txt>
            <View
              style={{
                width: 26, height: 46, borderRadius: 3,
                backgroundColor: isAddress ? '#E8E8E8' : '#9AA3AD',
                justifyContent: on ? 'flex-start' : 'flex-end',
                padding: 3,
              }}
            >
              <View style={{ height: 19, borderRadius: 2, backgroundColor: on ? '#D64545' : '#5A5A5A' }} />
            </View>
            <Txt size="xs" style={{ color: '#fff', fontSize: 9 }}>{isAddress ? 2 ** i : '—'}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Draws the card as printed: pairs in a two-row zigzag, not a single line. */
function XpertCard({ removed, xpert8, onToggle }: { removed: number[]; xpert8: boolean; onToggle: (v: number) => void }) {
  const t = useTheme();
  const pips = XPERT_PIPS.filter((p) => xpert8 || p.onXpert7);
  const columns = [...new Set(pips.map((p) => p.column))];

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        gap: t.space(3),
        backgroundColor: t.mode === 'dark' ? '#3A3A3A' : '#E4E4E4',
        borderRadius: t.radius.sm,
        padding: t.space(3),
      }}
    >
      {columns.map((col) => (
        <View key={col} style={{ gap: t.space(2) }}>
          {pips.filter((p) => p.column === col).map((p) => {
            const out = removed.includes(p.value);
            return (
              <Pressable key={p.value} onPress={() => onToggle(p.value)} style={{ alignItems: 'center', gap: 3 }}>
                <View
                  style={{
                    width: 34, height: 34, borderRadius: 17,
                    backgroundColor: out ? 'transparent' : t.mode === 'dark' ? '#8A8A8A' : '#B8B8B8',
                    borderWidth: 2,
                    borderColor: out ? t.color.accent : 'transparent',
                    borderStyle: out ? 'dashed' : 'solid',
                  }}
                />
                <Txt size="xs" weight="700" tone={out ? 'accent' : 'muted'}>{p.value}</Txt>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
