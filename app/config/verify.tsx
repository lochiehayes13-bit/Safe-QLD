import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useConfig } from '@/hooks/useConfig';
import {
  describeVerdict, verifyConfig, type Finding, type FindingSeverity,
} from '@/domain/configVerify';
import { contextId } from '@/domain/screenContext';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Rowed, Screen, SectionHeader, StatTile, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { RecordGate } from '@/components/RecordGate';

/**
 * What is wrong with this configuration, and what could not be looked at.
 *
 * The second list is not an apology, it is the reason the first one is worth
 * reading. Every reader in this app throws something away — Kentec keeps its
 * device types in a library that does not travel with the file, Ampac folds a
 * networked site into one panel so two nodes' addresses land on top of each
 * other — and a check run on ground that is not there produces findings that
 * are confidently wrong. A technician shown a hundred of those stops opening
 * the screen, and then the ten real ones go unread too.
 *
 * So the skipped checks are on the screen with their reasons, underneath.
 * "Not checked, because this file does not carry device types" is a useful
 * sentence. A silent absence is not.
 */

const TONE: Record<FindingSeverity, 'fail' | 'warn' | 'info'> = {
  fail: 'fail',
  warn: 'warn',
  note: 'info',
};

const ICON: Record<FindingSeverity, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  fail: 'alert-octagon-outline',
  warn: 'alert-outline',
  note: 'information-outline',
};

const HEADING: Record<FindingSeverity, string> = {
  fail: 'To fix',
  warn: 'To look at',
  note: 'Worth knowing',
};

export default function ConfigVerifyScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = contextId(params.id);
  const { opened, failed, missing, reload } = useConfig(id);
  const [showSkipped, setShowSkipped] = useState(false);

  const parsed = opened?.parsed;
  const result = useMemo(() => (parsed ? verifyConfig(parsed) : undefined), [parsed]);

  if (!id) return <ContextGate kind="configuration" what="what is wrong with it" title="Check config" />;
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

  const fails = result?.findings.filter((f) => f.severity === 'fail') ?? [];
  const warns = result?.findings.filter((f) => f.severity === 'warn') ?? [];
  const notes = result?.findings.filter((f) => f.severity === 'note') ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Check config' }} />

      {!result ? (
        <Banner
          tone="warn"
          title="Nothing to check"
          body={opened.unreadable ?? 'No devices read from this file.'}
        />
      ) : (
        <>
          <Card variant="raised">
            <Txt weight="700">{describeVerdict(result)}</Txt>
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
              {result.skipped.length
                ? `${result.passed.length + result.findings.length} checks run, ${result.skipped.length} skipped.`
                : `All ${result.passed.length + result.findings.length} checks run.`}
            </Txt>
          </Card>

          <Rowed gap={2}>
            <StatTile label="To fix" value={fails.length} tone={fails.length ? 'fail' : 'default'} />
            <StatTile label="To look at" value={warns.length} tone={warns.length ? 'warn' : 'default'} />
            <StatTile label="Worth knowing" value={notes.length} />
          </Rowed>

          {!result.findings.length ? (
            <EmptyState
              icon="shield-check-outline"
              title="Nothing found"
              body={
                result.passed.length
                  ? `All ${result.passed.length} checks came back clean.`
                  : 'No checks could run. See below.'
              }
              action={
                <Button
                  title="Browse devices"
                  variant="secondary"
                  compact
                  onPress={() => router.push({ pathname: '/config/points', params: { id } })}
                />
              }
            />
          ) : null}

          {([['fail', fails], ['warn', warns], ['note', notes]] as const).map(([severity, list]) => (
            list.length ? (
              <View key={severity}>
                <SectionHeader title={HEADING[severity]} />
                {list.map((finding, i) => (
                  <FindingCard key={`${finding.id}-${finding.panel ?? ''}-${i}`} finding={finding} />
                ))}
              </View>
            ) : null
          ))}

          {result.skipped.length ? (
            <>
              <SectionHeader
                title={`${result.skipped.length} not checked`}
                action={showSkipped ? 'Hide' : 'Why'}
                onAction={() => setShowSkipped((v) => !v)}
                icon={showSkipped ? 'chevron-up' : 'chevron-down'}
              />
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                The file doesn&apos;t carry the data for these.
              </Txt>
              {showSkipped ? (
                <Card>
                  {result.skipped.map((s, i) => (
                    <View key={s.id}>
                      {i > 0 ? <Divider /> : null}
                      <Txt size="sm" weight="700">{s.title}</Txt>
                      <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }}>{s.because}</Txt>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          ) : null}

          <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>
            Checks the file against itself, not the Standard.
          </Txt>
        </>
      )}
    </Screen>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const t = useTheme();
  return (
    <Card>
      <Rowed align="flex-start" gap={3}>
        <MaterialCommunityIcons
          name={ICON[finding.severity]}
          size={20}
          color={finding.severity === 'fail' ? t.color.fail : finding.severity === 'warn' ? t.color.warn : t.color.info}
        />
        <View style={{ flex: 1 }}>
          <Rowed gap={2} align="flex-start">
            <Txt weight="700" style={{ flex: 1 }}>{finding.title}</Txt>
            {finding.panel ? <Chip label={finding.panel} /> : null}
          </Rowed>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>{finding.why}</Txt>
        </View>
      </Rowed>

      <View style={{ marginVertical: t.space(2) }}><Divider /></View>

      {finding.examples.map((example, i) => (
        <Txt key={i} size="xs" tone={TONE[finding.severity] === 'info' ? 'faint' : 'muted'} style={{ lineHeight: 18 }}>
          {example}
        </Txt>
      ))}
      {finding.count > finding.examples.length ? (
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
          {`and ${(finding.count - finding.examples.length).toLocaleString()} more`}
        </Txt>
      ) : null}
    </Card>
  );
}
