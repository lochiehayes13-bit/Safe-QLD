import React, { useState } from 'react';
import { View } from 'react-native';
import { qldMoment } from '@/domain/qldTime';
import { readRestoreTime, restorePicks } from '@/domain/restoreTime';
import { useTheme } from '@/theme';
import { Chip, Field, Label, Rowed, Txt } from '@/components/ui';

/**
 * Date and time boxes for when an impaired system is expected back.
 *
 * Typed rather than picked: there is no native date picker in this build, and
 * the web build is what an iPhone runs. The boxes take what typedDay and
 * typedClock read (ddmmyyyy and 1430 straight off a keypad included), and the
 * chips fill both for the common answers. What the boxes resolve to is shown
 * underneath, so a wrong reading is seen before it is saved.
 */
export function RestoreTimeFields({
  date,
  time,
  onChange,
  label = 'Expected back in service',
}: {
  date: string;
  time: string;
  onChange: (next: { date: string; time: string }) => void;
  label?: string;
}) {
  const t = useTheme();
  // When the boxes opened. Only the hint below reads it; saving checks against
  // the clock at the time of the tap.
  const [openedAt] = useState(() => Date.now());
  const read = readRestoreTime(date, time, openedAt);

  return (
    <View style={{ gap: t.space(1.5) }}>
      <Label>{label}</Label>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 3 }}>
          <Field
            value={date}
            onChangeText={(v) => onChange({ date: v, time })}
            placeholder="dd/mm/yyyy"
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 2 }}>
          <Field
            value={time}
            onChangeText={(v) => onChange({ date, time: v })}
            placeholder="hh:mm"
            keyboardType="numeric"
          />
        </View>
      </Rowed>
      <Rowed gap={2} wrap>
        {restorePicks(openedAt).map((p, i) => (
          <Chip
            key={p.label}
            label={p.label}
            onPress={() => {
              // Worked out again at the tap, so a screen left open does not offer a time already gone.
              const fresh = restorePicks(Date.now())[i] ?? p;
              onChange({ date: fresh.date, time: fresh.time });
            }}
          />
        ))}
        {date || time ? <Chip label="Not known" onPress={() => onChange({ date: '', time: '' })} /> : null}
      </Rowed>
      {'at' in read && read.at ? (
        <Txt size="xs" tone="muted">{qldMoment(read.at)}</Txt>
      ) : null}
      {'why' in read && date.trim() && time.trim() ? (
        <Txt size="xs" tone="warn">{read.why}</Txt>
      ) : null}
    </View>
  );
}
