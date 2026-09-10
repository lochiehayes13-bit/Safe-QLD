import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { attachmentQueueSummary, queueHealth } from '@/db/opsRepo';
import { assessQueue, stuckWords, type StuckWords } from '@/domain/stuckWork';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { Button, Card, Rowed, Txt } from '@/components/ui';

/**
 * Saying, on the home screen, that work has not reached the office.
 *
 * SyncStrip covers the pull: what is coming down from Simpro, while it is
 * coming. Nothing covered the other direction. A defect written in a basement,
 * a photograph attached to a job, a note the office refused — all of it goes
 * into the outbound queue, and the queue has a screen nobody opens because
 * nothing ever tells them to.
 *
 * So the one place a technician does look says it. It is silent when the queue
 * is healthy, which is nearly always: an item made this morning and still
 * waiting is a phone doing its job, not a fault.
 */
export function StuckWorkStrip(): React.ReactElement | null {
  const t = useTheme();
  const [words, setWords] = useState<StuckWords | undefined>(undefined);

  const look = useCallback(async () => {
    try {
      const [rows, attachments] = await Promise.all([queueHealth(), attachmentQueueSummary()]);
      setWords(stuckWords(assessQueue(rows, attachments, nowIso())));
    } catch {
      /*
       * A read that fails says nothing rather than crying wolf. The queue not
       * being readable is a real problem, but it is the database's problem and
       * every other strip on this screen will be saying so already.
       */
      setWords(undefined);
    }
  }, []);

  useFocusEffect(useCallback(() => { void look(); }, [look]));

  if (!words) return null;

  const colour = words.tone === 'fail' ? t.color.fail : t.color.warn;

  return (
    <Card style={{ borderWidth: 1, borderColor: colour }}>
      <Rowed gap={3} align="flex-start">
        <MaterialCommunityIcons name="cloud-off-outline" size={22} color={colour} />
        <View style={{ flex: 1 }}>
          <Txt weight="700">{words.title}</Txt>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{words.body}</Txt>
        </View>
      </Rowed>
      <View style={{ height: t.space(2.5) }} />
      <Button
        title="Waiting to send"
        variant="secondary"
        compact
        onPress={() => router.push('/work/outbound')}
      />
    </Card>
  );
}
