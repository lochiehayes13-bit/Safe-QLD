import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useConfig } from '@/hooks/useConfig';
import { forgetConfig } from '@/services/configOpen';
import { markConfigImported, setConfigSite } from '@/db/configRepo';
import { createSite, importParsedConfig, listPanels, listSitePicks, type SitePick } from '@/db/repo';
import { describeSummary } from '@/domain/configLibrary';
import { deviceBreakdown, loopRows, zoneChartFor } from '@/domain/configBrowse';
import { contextId } from '@/domain/screenContext';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Rowed, Screen, SectionHeader, StatTile, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { RecordGate } from '@/components/RecordGate';
import { SitePicker } from '@/components/SitePicker';
import { describeActionFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * One configuration, opened and not imported.
 *
 * The banner at the top is the point of the screen and stays there for as long
 * as it is true. Every other path in this app that reads a panel file writes
 * it into a site on the way past, and a technician who has learnt that will
 * assume this one did too — so the screen says, every time, that nothing has
 * been written, and puts the button that would write it somewhere deliberate.
 */
export default function ConfigScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = contextId(params.id);
  const { opened, failed, missing, reload } = useConfig(id);

  const [sites, setSites] = useState<SitePick[]>([]);
  const [tying, setTying] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Panels already on the tied site. Writing this file in adds to them. */
  const [panelsOnSite, setPanelsOnSite] = useState<number | null>(null);

  useEffect(() => {
    // A failure here costs the site picker and nothing else, so it is reported
    // where the picker would have been rather than over the whole screen.
    void listSitePicks().then(setSites).catch(() => setSites([]));
  }, []);

  const parsed = opened?.parsed;
  const record = opened?.record;
  const tiedSiteId = record?.siteId;

  useEffect(() => {
    /*
     * Null means "not counted yet", which is why the confirmation below refuses
     * to claim the site is empty when it does not know. Both answers arrive the
     * same way — through the promise rather than straight out of the effect —
     * so untying a site cannot set the count twice in one render.
     */
    void (tiedSiteId ? listPanels(tiedSiteId).then((p) => p.length) : Promise.resolve(null))
      .then(setPanelsOnSite)
      .catch(() => setPanelsOnSite(null));
  }, [tiedSiteId]);

  const panels = useMemo(() => (parsed?.panels ?? []).map((panel) => ({
    panel,
    loops: loopRows(panel),
    chart: zoneChartFor(panel),
    devices: deviceBreakdown(panel.points),
  })), [parsed]);

  const tie = useCallback(async (siteId: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await setConfigSite(id, siteId);
      setTying(false);
      reload();
    } catch (e) {
      showAlert('Could not tie it to that site', describeActionFailure(e, 'tie this configuration to a site'));
    } finally {
      setBusy(false);
    }
  }, [id, reload]);

  /**
   * Writes the configuration into a site, which is the one thing on this
   * screen that cannot be undone.
   *
   * Confirmed rather than done, and the confirmation says what it will do in
   * the words of the consequence — devices and zones appearing in the register
   * — because "import" is a word this app uses for half a dozen different
   * outcomes and none of them is obvious from the button.
   */
  const runImport = useCallback(async (siteId: string, siteName: string) => {
    if (!parsed || !id) return;
    setBusy(true);
    try {
      const result = await importParsedConfig(siteId, parsed, 'config-import');
      await markConfigImported(id, siteId);
      showAlert(
        'Written in',
        `${result.pointCount.toLocaleString()} devices and ${result.zoneCount.toLocaleString()} zones `
        + `are now on ${siteName}.`,
      );
      router.push({ pathname: '/site/[id]', params: { id: siteId } });
    } catch (e) {
      showAlert('Could not write it in', describeActionFailure(e, 'write this configuration into the site'));
    } finally {
      setBusy(false);
    }
  }, [parsed, id]);

  const confirmImport = () => {
    const siteId = record?.siteId;
    const siteName = record?.siteName;
    if (!siteId || !siteName) {
      showAlert('Which site?', 'Tie this configuration to a site first, so it is clear where the devices go.');
      return;
    }
    /*
     * The second paragraph is the one that matters, and it is here because
     * `importParsedConfig` inserts panels and never replaces them. Writing the
     * same configuration in twice gives a site two panels, two sets of points
     * and two sets of zones, and every zone chart and test sheet built
     * afterwards counts the building twice. Nothing in the app undoes that
     * except deleting the panels by hand.
     */
    const already = panelsOnSite ?? 0;
    showAlert(
      `Write into ${siteName}?`,
      `${record.summary.points.toLocaleString()} devices and ${record.summary.zones.toLocaleString()} zones `
      + `will be added to that site's register.\n\n`
      + (already > 0
        ? `${siteName} already has ${already} panel${already === 1 ? '' : 's'} on it, and this adds to them `
          + 'rather than replacing them. If this file is a newer version of what is already there, delete the '
          + 'old panel first — otherwise the site holds the building twice.'
        : 'This adds panels to the site rather than replacing anything, so writing the same file in twice '
          + 'would hold the building twice.'),
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Write it in', onPress: () => { void runImport(siteId, siteName); } },
      ],
    );
  };

  const confirmForget = () => {
    if (!id || !record) return;
    showAlert(
      `Remove ${record.fileName}?`,
      'The file goes off this phone. Anything already written into a site stays where it is.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void forgetConfig(id)
              .then(() => router.replace('/config'))
              .catch((e: unknown) => showAlert('Could not remove it', describeActionFailure(e, 'remove this configuration')));
          },
        },
      ],
    );
  };

  const newSiteFromFile = () => {
    const name = record?.siteNameInFile?.trim() || record?.fileName.replace(/\.[^.]+$/, '') || 'New site';
    setBusy(true);
    void createSite({ name })
      .then((site) => tie(site.id))
      .catch((e: unknown) => showAlert('Could not create the site', describeActionFailure(e, 'create a site')))
      .finally(() => setBusy(false));
  };

  if (!id) return <ContextGate kind="configuration" what="what is inside it" title="Configuration" />;
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

  const summary = record?.summary;

  return (
    <Screen>
      <Stack.Screen options={{ title: record?.siteNameInFile || record?.fileName || 'Configuration' }} />

      <Card variant="raised">
        <Rowed align="flex-start" gap={3}>
          <MaterialCommunityIcons name="file-cog-outline" size={22} color={t.color.accentText} />
          <View style={{ flex: 1 }}>
            <Txt weight="700" numberOfLines={2}>{record?.fileName}</Txt>
            <Txt size="sm" tone="muted" style={{ marginTop: 2, lineHeight: 19 }}>
              {summary ? describeSummary(summary) : ''}
            </Txt>
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>
              {[
                opened.parser?.brandLabel,
                parsed?.model,
                `opened ${formatAuDate(record?.lastOpenedAt)}`,
              ].filter(Boolean).join(' · ')}
            </Txt>
          </View>
        </Rowed>
      </Card>

      {record?.importedAt ? (
        <Banner
          tone="pass"
          title={`Written into ${record.siteName ?? 'a site'}`}
          body={`This configuration's devices and zones were added to the register on ${formatAuDate(record.importedAt)}.`}
        />
      ) : (
        <Banner
          tone="info"
          title="Nothing has been written into a site"
          body="This file has been read, not imported. The register is untouched, and stays that way until you use Write into a site below."
        />
      )}

      {opened.unreadable ? (
        <Banner tone="warn" title="This build could not read the contents" body={opened.unreadable} />
      ) : null}

      {summary?.warnings.length ? (
        <Banner
          tone="warn"
          title={`${summary.warnings.length} thing${summary.warnings.length === 1 ? '' : 's'} the reader could not do`}
          body={summary.warnings.join('\n\n')}
        />
      ) : null}

      {summary && parsed ? (
        <>
          <Rowed gap={2}>
            <StatTile label="Devices" value={summary.points.toLocaleString()} />
            <StatTile label="Zones" value={summary.zones.toLocaleString()} />
          </Rowed>
          <Rowed gap={2}>
            <StatTile label="Loops" value={summary.loops.toLocaleString()} />
            <StatTile label="Rules" value={summary.rules.toLocaleString()} />
          </Rowed>
        </>
      ) : null}

      <SectionHeader title="Look through it" />
      <Card>
        <Row
          icon="format-list-bulleted"
          title="Devices"
          body="Every point, searchable by text, address, zone or what it is."
          onPress={() => router.push({ pathname: '/config/points', params: { id } })}
        />
        <Divider />
        <Row
          icon="shield-check-outline"
          title="Check it"
          body="What is wrong with this configuration, and what each finding would mean on site."
          onPress={() => router.push({ pathname: '/config/verify', params: { id } })}
        />
        <Divider />
        <Row
          icon="sitemap-outline"
          title="Cause and effect"
          body="The logic as the panel holds it, with the equations it was written from."
          onPress={() => router.push({ pathname: '/config/logic', params: { id } })}
        />
        <Divider />
        <Row
          icon="compare-horizontal"
          title="Compare with a site"
          body="What is in the file that is not on the register, and the other way round."
          onPress={() => router.push({ pathname: '/config/compare', params: { id } })}
        />
        <Divider />
        <Row
          icon="table-eye"
          title="Inside the file"
          body="The vendor tool's own tables, including the ones this app does not read."
          onPress={() => router.push({ pathname: '/config/raw', params: { id } })}
        />
      </Card>

      {panels.map(({ panel, loops, chart, devices }, i) => (
        <View key={`${panel.name}-${i}`}>
          <SectionHeader title={panel.name || `Panel ${i + 1}`} />
          <Card>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              {[
                panel.model,
                panel.nodeNumber !== undefined ? `node ${panel.nodeNumber}` : undefined,
                `${panel.points.length.toLocaleString()} devices`,
                `${chart.rows.length.toLocaleString()} zones in use`,
              ].filter(Boolean).join(' · ')}
            </Txt>

            {devices.length ? (
              <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                {devices.slice(0, 8).map((d) => <Chip key={d.type} label={`${d.count} × ${d.label.toLowerCase()}`} />)}
              </Rowed>
            ) : null}

            {loops.length ? (
              <>
                <View style={{ marginVertical: t.space(2) }}><Divider /></View>
                {loops.map((loop) => (
                  <Txt key={loop.number} size="xs" tone="muted" style={{ lineHeight: 18 }}>
                    {`Loop ${loop.number}${loop.label ? ` — ${loop.label}` : ''}: `}
                    {loop.empty
                      ? 'declared, nothing addressed on it'
                      : `${loop.devices} device${loop.devices === 1 ? '' : 's'}`
                        + `${loop.spare ? `, ${loop.spare} spare` : ''}`
                        + `${loop.lowestAddress !== undefined ? `, addresses ${loop.lowestAddress}–${loop.highestAddress}` : ''}`
                        + `${loop.freeInRange ? `, ${loop.freeInRange} free between them` : ''}`}
                  </Txt>
                ))}
              </>
            ) : null}
          </Card>

          {chart.rows.length ? (
            <Card>
              <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Zones
              </Txt>
              {chart.rows.slice(0, 40).map((row) => (
                <Txt key={row.number} size="sm" style={{ marginTop: t.space(1), lineHeight: 19 }}>
                  <Txt size="sm" weight="700">{`${row.number}. `}</Txt>
                  {row.text || '(no zone text)'}
                  {row.summary ? <Txt size="xs" tone="faint">{`  ${row.summary}`}</Txt> : null}
                </Txt>
              ))}
              {chart.rows.length > 40 ? (
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
                  {`${(chart.rows.length - 40).toLocaleString()} more zones. Devices lists every one of them.`}
                </Txt>
              ) : null}
            </Card>
          ) : null}
        </View>
      ))}

      <SectionHeader title="Where it belongs" />
      {record?.siteName ? (
        <Card>
          <Rowed gap={2}>
            <Txt weight="700" style={{ flex: 1 }}>{record.siteName}</Txt>
            <Button title="Change" variant="ghost" compact onPress={() => setTying(true)} />
          </Rowed>
          <Txt size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>
            Tying it to a site is a label, not an import. It is what lets the comparison know which register to read.
          </Txt>
        </Card>
      ) : (
        <Card>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Not tied to a site yet. Tie it to one and the comparison knows which register to read against.
          </Txt>
          <View style={{ height: t.space(2) }} />
          <Rowed gap={2}>
            <Button title="Choose a site" variant="secondary" compact onPress={() => setTying(true)} />
            <Button title="Create one from the file" variant="ghost" compact onPress={newSiteFromFile} />
          </Rowed>
        </Card>
      )}

      {tying ? (
        <Card>
          <SitePicker
            sites={sites}
            value={record?.siteId}
            onChange={(siteId) => { void tie(siteId); }}
            label="Tie this configuration to"
            suggested={record?.siteId ? [record.siteId] : []}
          />
          <View style={{ height: t.space(2) }} />
          <Button title="Cancel" variant="ghost" compact onPress={() => setTying(false)} />
        </Card>
      ) : null}

      {parsed && summary?.points ? (
        <Button
          title={record?.importedAt ? 'Write it in again' : 'Write into a site'}
          variant="secondary"
          onPress={confirmImport}
          loading={busy}
        />
      ) : null}

      <Button title="Remove from this phone" variant="danger" onPress={confirmForget} />
    </Screen>
  );
}

/** One way into the configuration. */
function Row({
  icon, title, body, onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Card onPress={onPress}>
      <Rowed align="flex-start" gap={3}>
        <MaterialCommunityIcons name={icon} size={20} color={t.color.accentText} />
        <View style={{ flex: 1 }}>
          <Txt weight="700">{title}</Txt>
          <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }}>{body}</Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
