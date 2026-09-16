import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useConfig } from '@/hooks/useConfig';
import { setConfigSite } from '@/db/configRepo';
import { countPoints, listPanels, listSitePicks, listZones, queryPoints, type SitePick } from '@/db/repo';
import {
  compareConfig, describeComparison, noChanges, siteMismatches,
  type ComparedPoint, type ConfigComparison, type PointDifference, type SiteMismatch,
} from '@/domain/configCompare';
import type { ConfigPoint, ConfigZone } from '@/domain/configBrowse';
import { contextId } from '@/domain/screenContext';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Rowed, Screen, SectionHeader, StatTile, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { RecordGate } from '@/components/RecordGate';
import { SitePicker } from '@/components/SitePicker';
import { describeLoadFailure } from '@/domain/loadFailure';

/**
 * The file against the register.
 *
 * This is the question a configuration is most often fetched to answer, and
 * the app could not answer it: the only way to find out what a builder changed
 * was to import the new file over the top of the old one and watch the site
 * become the answer. Here nothing is written. The file is read, the register is
 * read, and the difference is a list.
 *
 * Spares are left out. A panel with sixty programmed spare addresses would
 * otherwise produce sixty lines, and the question being asked is about the
 * devices in the building.
 */
export default function ConfigCompareScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = contextId(params.id);
  const { opened, failed, missing, reload } = useConfig(id);

  const [sites, setSites] = useState<SitePick[]>([]);
  const [comparison, setComparison] = useState<ConfigComparison | null>(null);
  const [siteCaveats, setSiteCaveats] = useState<string[]>([]);
  /** Reasons to think this file is not this building at all. */
  const [mismatches, setMismatches] = useState<SiteMismatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [readFailed, setReadFailed] = useState<string | null>(null);

  useEffect(() => {
    void listSitePicks().then(setSites).catch(() => setSites([]));
  }, []);

  const siteId = opened?.record.siteId;
  const parsed = opened?.parsed;
  const siteNameInFile = opened?.record.siteNameInFile;
  const siteName = opened?.record.siteName;

  const compare = useCallback(async () => {
    if (!siteId || !parsed) return;
    setBusy(true);
    setReadFailed(null);
    try {
      const panels = await listPanels(siteId);
      /*
       * The point query caps at two thousand rows by default, and a comparison
       * that quietly stops at two thousand is not a smaller answer — it is a
       * wrong one, and every device past the cap would read as removed. So the
       * cap is the count, asked for first.
       */
      const total = await countPoints(siteId, true);
      const held = await queryPoints({ siteId, includeUnused: true, limit: Math.max(1, total) });
      const heldZones: ConfigZone[] = [];
      const seen = new Set<number>();
      for (const panel of panels) {
        for (const zone of await listZones(panel.id, true)) {
          if (seen.has(zone.number)) continue;
          seen.add(zone.number);
          heldZones.push(zone);
        }
      }

      const fileZones: ConfigZone[] = [];
      const fileSeen = new Set<number>();
      const filePoints: ConfigPoint[] = [];
      for (const panel of parsed.panels) {
        filePoints.push(...panel.points);
        for (const zone of panel.zones) {
          if (fileSeen.has(zone.number)) continue;
          fileSeen.add(zone.number);
          fileZones.push(zone);
        }
      }

      const notes: string[] = [];
      if (panels.length > 1 || parsed.panels.length > 1) {
        notes.push(
          'This site or this file has more than one panel, and zone numbers start again on each of them. '
          + 'The devices compare correctly; a zone difference may be two panels\' zone 3 rather than a change.',
        );
      }

      setSiteCaveats(notes);
      /*
       * Asked before the difference is drawn, because it is a different
       * question and a more urgent one. A list of two hundred added devices is
       * what "the wrong building" looks like, and a technician reading it as a
       * fit-out will act on it.
       */
      setMismatches(siteMismatches({
        siteNameInFile,
        siteName,
        fileBrand: parsed.brand,
        heldBrands: panels.map((p) => p.brand),
      }));
      setComparison(compareConfig(filePoints, held, fileZones, heldZones));
    } catch (e) {
      setComparison(null);
      setReadFailed(describeLoadFailure(e, 'what this site already holds'));
    } finally {
      setBusy(false);
    }
  }, [siteId, parsed, siteNameInFile, siteName]);

  useFocusEffect(useCallback(() => { void compare(); }, [compare]));

  const tie = (pickedSiteId: string) => {
    if (!id) return;
    setBusy(true);
    void setConfigSite(id, pickedSiteId)
      .then(() => reload())
      .catch((e: unknown) => setReadFailed(describeLoadFailure(e, 'the site for this configuration')))
      .finally(() => setBusy(false));
  };

  if (!id) return <ContextGate kind="configuration" what="what has changed since the register was written" title="Compare" />;
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

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Compare with a site' }} />

      {!parsed ? (
        <Banner
          tone="warn"
          title="There is nothing to compare"
          body={opened.unreadable ?? 'This build could not read any devices out of the file.'}
        />
      ) : null}

      {parsed && !siteId ? (
        <>
          <Banner
            tone="info"
            title="Which site is this?"
            body="Pick the building this configuration belongs to and the comparison reads its register. Nothing is written either way."
          />
          <Card>
            <SitePicker sites={sites} onChange={tie} label="Compare against" />
          </Card>
        </>
      ) : null}

      {readFailed ? (
        <>
          <Banner tone="fail" title="The register could not be read" body={readFailed} />
          <Button title="Try again" variant="secondary" onPress={() => void compare()} />
        </>
      ) : null}

      {siteId && busy && !comparison ? <Txt size="sm" tone="muted">Reading the register…</Txt> : null}

      {mismatches.map((m) => (
        <Banner key={m.kind} tone="warn" title={m.title} body={m.body} />
      ))}

      {comparison ? (
        <>
          <Card variant="raised">
            <Rowed gap={2}>
              <Txt weight="700" style={{ flex: 1 }}>{opened.record.siteName ?? 'This site'}</Txt>
              <Button title="Change" variant="ghost" compact onPress={() => { void setConfigSite(id).then(reload).catch(() => undefined); }} />
            </Rowed>
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
              {describeComparison(comparison)}
            </Txt>
          </Card>

          <Rowed gap={2}>
            <StatTile label="In the file only" value={comparison.added.length} tone={comparison.added.length ? 'accent' : 'default'} />
            <StatTile label="Here only" value={comparison.removed.length} tone={comparison.removed.length ? 'warn' : 'default'} />
          </Rowed>
          <Rowed gap={2}>
            <StatTile label="Different" value={comparison.changed.length} tone={comparison.changed.length ? 'warn' : 'default'} />
            <StatTile label="The same" value={comparison.unchanged.toLocaleString()} tone="pass" />
          </Rowed>

          {[...comparison.caveats, ...siteCaveats].length ? (
            <Banner
              tone="info"
              title="What this comparison could not do"
              body={[...comparison.caveats, ...siteCaveats].join('\n\n')}
            />
          ) : null}

          {noChanges(comparison) ? (
            <EmptyState
              icon="check-decagram-outline"
              title="Nothing has changed"
              body={
                comparison.unchanged
                  ? `Every one of the ${comparison.unchanged.toLocaleString()} devices in the file is on the register, `
                    + 'in the same place, with the same text.'
                  : 'There was nothing on either side to compare.'
              }
              action={
                <Button
                  title="Open the site"
                  variant="secondary"
                  compact
                  onPress={() => router.push({ pathname: '/site/[id]', params: { id: siteId ?? '' } })}
                />
              }
            />
          ) : null}

          {comparison.changed.length ? (
            <>
              <SectionHeader title={`${comparison.changed.length} different`} />
              <Card>
                {comparison.changed.map((d, i) => (
                  <View key={`${d.inFile.where}-${i}`}>
                    {i > 0 ? <Divider /> : null}
                    <Difference difference={d} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {comparison.added.length ? (
            <>
              <SectionHeader title={`${comparison.added.length} in the file and not on the register`} />
              <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2), lineHeight: 19 }}>
                Devices somebody has added since the register was written, or devices the register never had.
              </Txt>
              <Card>
                {comparison.added.map((p, i) => (
                  <View key={`${p.where}-${i}`}>
                    {i > 0 ? <Divider /> : null}
                    <PointLine point={p} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {comparison.removed.length ? (
            <>
              <SectionHeader title={`${comparison.removed.length} on the register and not in the file`} />
              <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2), lineHeight: 19 }}>
                Devices that have come out, or that this file does not cover — a config for one panel of a
                networked site will read this way about the rest of them.
              </Txt>
              <Card>
                {comparison.removed.map((p, i) => (
                  <View key={`${p.where}-${i}`}>
                    {i > 0 ? <Divider /> : null}
                    <PointLine point={p} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {comparison.zonesAdded.length || comparison.zonesRemoved.length || comparison.zonesRetexted.length ? (
            <>
              <SectionHeader title="Zones" />
              <Card>
                {comparison.zonesRetexted.map((z) => (
                  <Txt key={`r${z.number}`} size="sm" style={{ lineHeight: 19 }}>
                    <Txt size="sm" weight="700">{`Zone ${z.number}: `}</Txt>
                    {`"${z.held}" → "${z.inFile}"`}
                  </Txt>
                ))}
                {comparison.zonesAdded.map((z) => (
                  <Txt key={`a${z.number}`} size="sm" style={{ lineHeight: 19 }}>
                    <Txt size="sm" weight="700">{`Zone ${z.number}: `}</Txt>
                    {`"${z.inFile}" — in the file, not on the register`}
                  </Txt>
                ))}
                {comparison.zonesRemoved.map((z) => (
                  <Txt key={`d${z.number}`} size="sm" style={{ lineHeight: 19 }}>
                    <Txt size="sm" weight="700">{`Zone ${z.number}: `}</Txt>
                    {`"${z.held}" — on the register, not in the file`}
                  </Txt>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function PointLine({ point }: { point: ComparedPoint }) {
  return (
    <View>
      <Rowed gap={2}>
        <Txt weight="600" style={{ flex: 1 }} numberOfLines={2}>{point.text || '(no device text)'}</Txt>
        {point.where ? <Chip label={point.where} /> : null}
      </Rowed>
      {point.zoneNumber !== undefined ? (
        <Txt size="xs" tone="faint" style={{ marginTop: 2 }}>{`Zone ${point.zoneNumber}`}</Txt>
      ) : null}
    </View>
  );
}

function Difference({ difference }: { difference: PointDifference }) {
  const t = useTheme();
  return (
    <View>
      <Rowed gap={2}>
        <Txt weight="600" style={{ flex: 1 }} numberOfLines={2}>
          {difference.inFile.text || difference.held.text || '(no device text)'}
        </Txt>
        {difference.inFile.where ? <Chip label={difference.inFile.where} tone={difference.moved ? 'warn' : 'default'} /> : null}
      </Rowed>
      {difference.differences.map((line, i) => (
        <Txt key={i} size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>{line}</Txt>
      ))}
    </View>
  );
}
