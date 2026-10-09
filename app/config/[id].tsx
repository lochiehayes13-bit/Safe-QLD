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
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
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
  /**
   * Panels already on the tied site. Writing this file in adds to them.
   *
   * Three answers, not two. `null` is "not counted yet", a number is the
   * count, and 'failed' is a read that threw — which used to be stored as
   * null, so the confirmation below told somebody the site had nothing on it
   * when it had not been able to look. See confirmImport.
   */
  const [panelsOnSite, setPanelsOnSite] = useState<number | 'failed' | null>(null);
  /** Why the site list would not read, where it would not. */
  const [sitesFailed, setSitesFailed] = useState<string | null>(null);

  useEffect(() => {
    /*
     * A failure here costs the site picker and nothing else, so it is said
     * where the picker would have been rather than over the whole screen.
     *
     * That sentence was in this comment and nowhere else: the catch stored an
     * empty list, which on screen is a phone with no sites on it. So a
     * database locked by a sync — the realistic case — offered an empty picker
     * beside "Create one from the file", and the technician made a second site
     * for a building the phone already held.
     */
    void listSitePicks()
      .then((rows) => { setSites(rows); setSitesFailed(null); })
      .catch((e: unknown) => { setSites([]); setSitesFailed(describeLoadFailure(e, 'the site list')); });
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
    void (tiedSiteId ? listPanels(tiedSiteId).then((p): number | 'failed' | null => p.length) : Promise.resolve(null))
      .then(setPanelsOnSite)
      .catch(() => setPanelsOnSite('failed'));
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
      showAlert("Couldn't tie it to that site", describeActionFailure(e, 'tie this configuration to a site'));
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
        + `added to ${siteName}.`,
      );
      router.push({ pathname: '/site/[id]', params: { id: siteId } });
    } catch (e) {
      showAlert("Couldn't write it in", describeActionFailure(e, 'write this configuration into the site'));
    } finally {
      setBusy(false);
    }
  }, [parsed, id]);

  const confirmImport = () => {
    const siteId = record?.siteId;
    const siteName = record?.siteName;
    if (!siteId || !siteName) {
      showAlert('Which site?', 'Choose a site first.');
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
    /*
     * What the site already holds, or the fact that it could not be read.
     *
     * A failed count used to be stored as null and read as zero here, so the
     * alert printed the reassuring half — "This adds panels rather than
     * replacing anything" — about a site it had not managed to look at. Doing
     * it anyway is the one mistake on this screen that nothing in the app
     * undoes: importParsedConfig inserts panels and never replaces them, so
     * the site holds the building twice and the only remedy is deleting the
     * panels by hand.
     */
    const already = typeof panelsOnSite === 'number' ? panelsOnSite : 0;
    showAlert(
      `Write into ${siteName}?`,
      `Adds ${record.summary.points.toLocaleString()} devices and ${record.summary.zones.toLocaleString()} zones. `
      + 'Nothing on the site is replaced.'
      + (panelsOnSite === 'failed'
        ? `\n\n${siteName} could not be read. Open the site and check the building isn't already on it.`
        : already > 0
          ? `\n\n${siteName} already has ${already} panel${already === 1 ? '' : 's'}. `
            + 'If this file is newer, delete the old panel first.'
          : ''),
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
      'Anything written into a site stays.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void forgetConfig(id)
              .then(() => router.replace('/config'))
              .catch((e: unknown) => showAlert("Couldn't remove it", describeActionFailure(e, 'remove this configuration')));
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
      .catch((e: unknown) => showAlert("Couldn't create the site", describeActionFailure(e, 'create a site')))
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
          body={`Added to the register ${formatAuDate(record.importedAt)}.`}
        />
      ) : (
        <Banner
          tone="info"
          title="Read only"
          body="Not written into a site."
        />
      )}

      {opened.unreadable ? (
        <Banner tone="warn" title="Couldn't read the contents" body={opened.unreadable} />
      ) : null}

      {summary?.warnings.length ? (
        <Banner
          tone="warn"
          title={`${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'}`}
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

      <SectionHeader title="Browse" />
      <Card>
        <Row
          icon="format-list-bulleted"
          title="Devices"
          body="Search by text, address, zone or type."
          onPress={() => router.push({ pathname: '/config/points', params: { id } })}
        />
        <Divider />
        <Row
          icon="shield-check-outline"
          title="Check it"
          body="Clashes and gaps in the programming."
          onPress={() => router.push({ pathname: '/config/verify', params: { id } })}
        />
        <Divider />
        <Row
          icon="sitemap-outline"
          title="Cause and effect"
          body="Rules and the equations behind them."
          onPress={() => router.push({ pathname: '/config/logic', params: { id } })}
        />
        <Divider />
        <Row
          icon="compare-horizontal"
          title="Compare with a site"
          body="The file against the site register."
          onPress={() => router.push({ pathname: '/config/compare', params: { id } })}
        />
        <Divider />
        <Row
          icon="table-eye"
          title="Inside the file"
          body="Raw tables from the vendor tool."
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
                    {`Loop ${loop.number}${loop.label ? ` (${loop.label})` : ''}: `}
                    {loop.empty
                      ? 'empty'
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
                  {`${(chart.rows.length - 40).toLocaleString()} more. See Devices.`}
                </Txt>
              ) : null}
            </Card>
          ) : null}
        </View>
      ))}

      <SectionHeader title="Site" />
      {record?.siteName ? (
        <Card>
          <Rowed gap={2}>
            <Txt weight="700" style={{ flex: 1 }}>{record.siteName}</Txt>
            <Button title="Change" variant="ghost" compact onPress={() => setTying(true)} />
          </Rowed>
          <Txt size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>
            Sets the register Compare reads. Nothing is written in.
          </Txt>
        </Card>
      ) : (
        <Card>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Not tied to a site. Compare needs one.
          </Txt>
          <View style={{ height: t.space(2) }} />
          <Rowed gap={2}>
            <Button title="Choose a site" variant="secondary" compact onPress={() => setTying(true)} />
            <Button title="New site from file" variant="ghost" compact onPress={newSiteFromFile} />
          </Rowed>
        </Card>
      )}

      {tying ? (
        <Card>
          {/* Said where the picker would have been, which is what the read's
              own comment always claimed and never did. */}
          {sitesFailed ? (
            <Banner tone="fail" title="The site list could not be read" body={sitesFailed} />
          ) : null}
          <SitePicker
            sites={sites}
            value={record?.siteId}
            onChange={(siteId) => { void tie(siteId); }}
            label="Tie to site"
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
