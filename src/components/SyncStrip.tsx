import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { runAutoSync, useAutoSync } from '@/simpro/autoSync';
import { syncStripWords } from '@/domain/syncWords';
import { useTheme } from '@/theme';
import { Button, Card, Rowed, Txt } from '@/components/ui';

/**
 * What the sync is doing, on the home screen, while it is doing it.
 *
 * "Sync that nobody thinks about" cuts both ways: it has to run without
 * being asked, and it has to be visible when it is running, or a first
 * launch is six minutes of lists filling in for no stated reason. So while
 * a pull is under way this shows the stage and how far through it is, and
 * when the last run hit a problem it says so with the one thing to press.
 * Between runs it is nothing at all — a status line nobody needs is noise.
 */
export function SyncStrip(): React.ReactElement | null {
  const t = useTheme();
  const { inFlight, progress, record, trigger } = useAutoSync();
  const words = syncStripWords({ inFlight, progress, trigger, lastError: record.lastError });
  if (!words) return null;

  if (words.kind === 'running') {
    return (
      <Card>
        <Rowed gap={3}>
          <MaterialCommunityIcons name="cloud-sync-outline" size={22} color={t.color.accentText} />
          <View style={{ flex: 1 }}>
            <Txt weight="700">{words.title}</Txt>
            <Txt size="sm" tone="muted" numberOfLines={1}>{words.detail}</Txt>
          </View>
        </Rowed>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.color.surfaceAlt, marginTop: t.space(3), overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(words.fraction * 100)}%`, height: 6, backgroundColor: t.color.accent }} />
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ borderWidth: 1, borderColor: t.color.warn }}>
      <Rowed gap={3} align="flex-start">
        <MaterialCommunityIcons name="cloud-alert-outline" size={22} color={t.color.warn} />
        <View style={{ flex: 1 }}>
          <Txt weight="700">{words.title}</Txt>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{words.detail}</Txt>
        </View>
      </Rowed>
      <View style={{ height: t.space(2.5) }} />
      <Button title="Try again" variant="secondary" compact onPress={() => { void runAutoSync('foreground'); }} />
    </Card>
  );
}
