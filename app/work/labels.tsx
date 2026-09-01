import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nextAssetCode, queryAssets, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { listSites } from '@/db/repo';
import {
  auditTags, parseAssetCode, planTagAssignments, serialsInUse, typeCodeEntry,
  type TaggableAsset,
} from '@/domain/assetTag';
import {
  LABEL_STOCKS, buildLabelSheet, type LabelContent, type LabelStock,
} from '@/export/assetLabels';
import { shareFile, writePdf } from '@/export/files';
import type { Site } from '@/domain/types';
import { assetTypeById } from '@/seed/assetTypes';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, Segmented,
  StatTile, Txt,
} from '@/components/ui';

/**
 * Getting a number onto 12,553 assets.
 *
 * The register has been complete for a while and none of it is identifiable on
 * site: a technician standing at one of nine identical heads in a ward has no
 * way to say which row of the register is this one. This screen is the whole
 * path from that to a printed sheet — pick a site, see what is untagged, issue
 * the numbers, print the labels — because doing it in three places would mean
 * it never got done at all.
 *
 * Two things it deliberately will not do.
 *
 * It will not renumber an asset whose existing code does not validate. There is
 * something stuck to that device and nobody knows what; issuing a fresh number
 * leaves a physical label in the field pointing at a number the register no
 * longer uses. Those are listed, with the reason, for someone to go and look at.
 *
 * And it will not silently start numbering from one. The starting serial comes
 * from the database, and where it cannot be established the assets are skipped
 * and reported rather than given numbers that collide with a decade of existing
 * asset codes.
 */

type Filter = 'needs' | 'ready' | 'problems';

const toTaggable = (a: AssetRecord): TaggableAsset => ({
  id: a.id,
  assetTypeId: a.assetTypeId,
  code: a.code ?? null,
  name: a.name,
});

const locationOf = (a: AssetRecord | undefined): string =>
  a ? [a.level, a.room].filter(Boolean).join(' · ') || a.locationNote || '' : '';

/**
 * A printer offset as typed.
 *
 * An empty field is no nudge. Anything else is handed on exactly as it parses,
 * including NaN, because the sheet builder is where the refusal belongs and it
 * says so in a warning the technician sees. Converting a bad value to 0 here
 * would print a sheet that silently ignored the correction they just made and
 * looked identical to the one that sent them to the drawer for more stock.
 */
const nudgeMm = (typed: string): number => (typed.trim() ? Number(typed.trim()) : 0);

export default function LabelsScreen() {
  const t = useTheme();
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('needs');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stock, setStock] = useState<LabelStock>(LABEL_STOCKS[0] as LabelStock);
  const [startAt, setStartAt] = useState('1');
  const [offsetX, setOffsetX] = useState('');
  const [offsetY, setOffsetY] = useState('');
  const [outlines, setOutlines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { void listSites().then(setSites); }, []);

  const openSite = useCallback(async (s: Site) => {
    setBusy(true);
    try {
      setSite(s);
      // A site's whole register, not a page of it: the audit is only honest if
      // it has seen every asset, and a partial read would report assets as
      // untagged that simply were not loaded.
      const rows = await queryAssets({ siteId: s.id, limit: 20000 });
      setAssets(rows);
      setSelected(new Set());
      setNote(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!site) return;
    setAssets(await queryAssets({ siteId: site.id, limit: 20000 }));
  }, [site]);

  const audit = useMemo(() => auditTags(assets.map(toTaggable)), [assets]);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const needing = useMemo(
    () => [...audit.untagged.map((r) => r.asset), ...audit.upgradeable.map((r) => r.asset)],
    [audit],
  );

  /**
   * Issues tags to everything that needs one.
   *
   * The starting serial is asked of the database twice, per type, and the
   * higher answer wins. nextAssetCode() reads the high-water mark of the
   * pre-tag codes, which is right for most types — but for the four whose
   * catalogue prefix is two letters (RM, LP, SP, FD) the tag carries a
   * different three-letter code, so codes already upgraded to tags are
   * invisible to it. The second read looks for the tag form directly. Without
   * both, a second run over those types would restart numbering at the top and
   * hand out serials that are already on a wall somewhere.
   */
  const assign = async () => {
    if (!site || !needing.length) return;
    setBusy(true);
    try {
      const untaggedTypes = [...new Set(audit.untagged.map((r) => r.asset.assetTypeId))];
      const nextSerials: Record<string, number> = {};

      for (const assetTypeId of untaggedTypes) {
        const candidates: number[] = [];
        const fromCodes = parseAssetCode(await nextAssetCode(assetTypeId))?.serial;
        if (fromCodes !== undefined) candidates.push(fromCodes);

        const code = typeCodeEntry(assetTypeId)?.code;
        if (code) {
          const tagged = await queryAssets({ assetTypeId, search: `SQ-${code}-`, limit: 20000 });
          const fromTags = serialsInUse(tagged.map(toTaggable))[assetTypeId];
          if (fromTags !== undefined) candidates.push(fromTags);
        }
        if (candidates.length) nextSerials[assetTypeId] = Math.max(...candidates);
      }

      const plan = planTagAssignments(needing, nextSerials);
      for (const assignment of plan.assignments) {
        await updateAsset(assignment.assetId, { code: assignment.tag });
      }
      await reload();

      const kept = plan.assignments.filter((a) => a.keptExistingNumber).length;
      setNote(
        `${plan.assignments.length} tagged`
        + (kept ? `, ${kept} keeping the number they already had` : '')
        + (plan.skipped.length ? `. ${plan.skipped.length} left alone — see the list below.` : '.'),
      );
      if (plan.skipped.length && !plan.assignments.length) {
        Alert.alert('Nothing was tagged', plan.skipped.slice(0, 4).map((s) => s.reason).join('\n\n'));
      }
      setFilter('ready');
    } catch (e) {
      Alert.alert('Could not issue tags', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const printable = useMemo(
    () => audit.tagged.filter((r) => typeCodeEntry(r.asset.assetTypeId)?.labelled !== false),
    [audit],
  );

  const makeSheet = async () => {
    if (!site) return;
    const chosen = printable.filter((r) => selected.has(r.asset.id));
    if (!chosen.length) {
      Alert.alert('Nothing selected', 'Tick the assets whose labels you want on the sheet.');
      return;
    }
    setBusy(true);
    try {
      const labels: LabelContent[] = chosen.map((r) => {
        const asset = byId.get(r.asset.id);
        return {
          tag: r.tag.tag,
          typeLabel: r.tag.typeLabel,
          location: locationOf(asset),
          siteName: site.name,
        };
      });

      const sheet = buildLabelSheet(labels, {
        stock,
        startAt: parseInt(startAt, 10) || 1,
        // Passed through as typed, NaN and all, rather than quietly turned into
        // zero here: the sheet builder refuses an unreadable nudge out loud, and
        // a technician who typed "1,5" needs to be told, not silently ignored.
        offsetXMm: nudgeMm(offsetX),
        offsetYMm: nudgeMm(offsetY),
        showOutlines: outlines,
      });

      if (!sheet.printed) {
        Alert.alert('Nothing to print', sheet.warnings.join('\n\n') || 'No tag in this batch validates.');
        return;
      }

      const file = await writePdf(`Asset labels - ${site.name}`, sheet.html);
      const shared = await shareFile(file, 'Asset labels');
      // Every warning the builder raised, not just the barcode one. A start
      // position it had to ignore or a nudge it could not read changes where
      // the ink lands, and a technician who is not told assumes the correction
      // took and throws away the sheet instead of the typo.
      const otherWarnings = sheet.warnings.filter((w) => w !== sheet.barcode.reason);
      const lines = [
        `${sheet.printed} label${sheet.printed === 1 ? '' : 's'} on ${sheet.sheets} sheet${sheet.sheets === 1 ? '' : 's'} of ${stock.productCode}.`,
        sheet.barcode.rendered
          ? `Barcode: Code 39, ${sheet.barcode.narrowMm} mm narrow bar at ${sheet.barcode.ratio}:1.`
          : sheet.barcode.reason,
        ...otherWarnings,
        ...sheet.omitted.map((o) => `Left off: ${o.tag} — ${o.reason}`),
        shared ? '' : `Written to ${file.name}. Sharing is not available on this device.`,
      ].filter(Boolean);
      setNote(lines.join('\n'));
      if (sheet.omitted.length || otherWarnings.length || !sheet.barcode.rendered) {
        Alert.alert('Sheet made, with notes', lines.join('\n\n'));
      }
    } catch (e) {
      Alert.alert('Could not make the sheet', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!site) {
    return (
      <>
        <Stack.Screen options={{ title: 'Asset labels' }} />
        <Screen scroll={false} padded={false}>
          <FlatList
            data={sites}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
            ListHeaderComponent={
              <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginBottom: t.space(1) }}>
                Pick a building. Tags are issued per asset type across the whole company, so the numbers
                stay unique no matter which site they were printed from.
              </Txt>
            }
            ListEmptyComponent={
              <EmptyState
                title="No sites yet"
                body="Add a site and its assets first. There is nothing to label until there is a register."
              />
            }
            renderItem={({ item }) => (
              <Card onPress={() => void openSite(item)}>
                <Rowed>
                  <View style={{ flex: 1 }}>
                    <Txt weight="700" numberOfLines={1}>{item.name}</Txt>
                    <Txt size="sm" tone="muted" numberOfLines={1}>
                      {[item.suburb, item.state].filter(Boolean).join(' ') || item.clientName || 'No address recorded'}
                    </Txt>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
                </Rowed>
              </Card>
            )}
          />
        </Screen>
      </>
    );
  }

  const rows: RowItem[] = filter === 'needs'
    ? [
      ...audit.untagged.map((r) => ({ kind: 'untagged' as const, asset: r.asset, detail: r.blocker })),
      ...audit.upgradeable.map((r) => ({
        kind: 'upgradeable' as const,
        asset: r.asset,
        detail: `${r.code.assetCode} — keeps this number, gains its check characters`,
      })),
    ]
    : filter === 'ready'
      ? printable.map((r) => ({ kind: 'ready' as const, asset: r.asset, detail: r.tag.tag }))
      : audit.invalid.map((r) => ({ kind: 'invalid' as const, asset: r.asset, detail: r.rejection.message }));

  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.asset.id));

  return (
    <>
      <Stack.Screen options={{ title: site.name }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.asset.id}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(2), paddingBottom: t.space(20) }}
          ListHeaderComponent={
            <View style={{ gap: t.space(3), marginBottom: t.space(1) }}>
              <Rowed gap={2}>
                <StatTile label="Tagged" value={audit.tagged.length} tone={audit.tagged.length ? 'pass' : 'default'} />
                <StatTile label="Needs a tag" value={needing.length} tone={needing.length ? 'warn' : 'default'} />
                <StatTile label="Won't validate" value={audit.invalid.length} tone={audit.invalid.length ? 'fail' : 'default'} />
              </Rowed>

              {audit.duplicates.length ? (
                <Banner
                  tone="fail"
                  title={`${audit.duplicates.length} tag${audit.duplicates.length === 1 ? ' is' : 's are'} on more than one asset`}
                  body={`${audit.duplicates.map((d) => d.tag).slice(0, 3).join(', ')}. A scan of these is ambiguous and `
                    + 'nothing in the app can break the tie. Find the labels on site and re-issue one of each pair.'}
                />
              ) : null}

              {audit.invalid.length ? (
                <Banner
                  tone="warn"
                  title={`${audit.invalid.length} asset${audit.invalid.length === 1 ? ' has' : 's have'} a code that does not validate`}
                  body="They are not renumbered automatically. Something is stuck to those devices and a new number would leave it pointing nowhere."
                />
              ) : null}

              {note ? <Banner tone="info" title="Done" body={note} /> : null}

              <Button
                title={needing.length ? `Issue tags to ${needing.length} asset${needing.length === 1 ? '' : 's'}` : 'Everything is tagged'}
                onPress={() => void assign()}
                loading={busy}
                disabled={!needing.length}
              />

              <Segmented
                value={filter}
                onChange={(v) => setFilter(v)}
                options={[
                  { value: 'needs', label: `Needs a tag (${needing.length})` },
                  { value: 'ready', label: `Print (${printable.length})` },
                  { value: 'problems', label: `Problems (${audit.invalid.length})` },
                ]}
              />

              {filter === 'ready' ? (
                <Rowed gap={2} wrap>
                  <Chip
                    label={allShownSelected ? 'Clear selection' : `Select all ${rows.length}`}
                    tone="accent"
                    onPress={() =>
                      setSelected(allShownSelected ? new Set() : new Set(rows.map((r) => r.asset.id)))}
                  />
                  <Chip label={`${selected.size} selected`} />
                </Rowed>
              ) : null}

              {filter === 'ready' && audit.tagged.length !== printable.length ? (
                <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                  {audit.tagged.length - printable.length} tagged {audit.tagged.length - printable.length === 1 ? 'asset is' : 'assets are'}{' '}
                  a level, room or loop. They are numbered like everything else but there is nothing to
                  stick a label to, so they are not offered for printing.
                </Txt>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title={
                filter === 'needs' ? 'Everything here has a tag'
                  : filter === 'ready' ? 'Nothing is tagged yet'
                    : 'No unreadable codes'
              }
              body={
                filter === 'needs'
                  ? 'Every asset at this site carries a tag that validates.'
                  : filter === 'ready'
                    ? 'Issue tags first, then come back to print them.'
                    : 'Every code at this site is either a tag or a recognisable pre-tag asset code.'
              }
            />
          }
          renderItem={({ item }) => (
            <AssetRow
              item={item}
              selectable={filter === 'ready'}
              selected={selected.has(item.asset.id)}
              location={locationOf(byId.get(item.asset.id))}
              onToggle={() => {
                const next = new Set(selected);
                if (next.has(item.asset.id)) next.delete(item.asset.id);
                else next.add(item.asset.id);
                setSelected(next);
              }}
            />
          )}
          ListFooterComponent={
            filter === 'ready' ? (
              <View style={{ gap: t.space(3), marginTop: t.space(4) }}>
                <Divider />
                <H2>Label sheet</H2>

                <Card>
                  <Label>Label stock</Label>
                  <View style={{ marginTop: t.space(1.5) }}>
                    <Segmented
                      value={stock.id}
                      onChange={(id) => setStock(LABEL_STOCKS.find((s) => s.id === id) ?? stock)}
                      options={LABEL_STOCKS.map((s) => ({
                        value: s.id,
                        label: `${s.columns * s.rows}-up`,
                      }))}
                    />
                  </View>
                  <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>
                    {stock.name} · {stock.labelWidthMm} × {stock.labelHeightMm} mm
                    {stock.note ? `. ${stock.note}` : ''}
                  </Txt>
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
                    Dimensions: {stock.confidence} confidence. {stock.source}
                  </Txt>
                </Card>

                <Card>
                  <Field
                    label="Start at label number"
                    value={startAt}
                    onChangeText={setStartAt}
                    keyboardType="numeric"
                    hint={`Counting across then down, 1 to ${stock.columns * stock.rows}. Use it up a part-used sheet instead of wasting the top row.`}
                  />
                  <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(3) }}>
                    <View style={{ flex: 1 }}>
                      {/* Not a numeric keypad: it has no minus sign, and the whole
                          point of this field is that a sheet printing low needs
                          a negative number to bring it back up. */}
                      <Field label="Nudge right (mm)" value={offsetX} onChangeText={setOffsetX} placeholder="0" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Nudge down (mm)" value={offsetY} onChangeText={setOffsetY} placeholder="0" />
                    </View>
                  </Rowed>
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
                    Every printer feeds slightly differently. Print one sheet on plain paper with outlines on,
                    hold it against the label stock, and correct here. Negative numbers move up and left.
                  </Txt>
                  <Rowed gap={2} wrap style={{ marginTop: t.space(2.5) }}>
                    <Chip
                      label={outlines ? 'Outlines on (test print)' : 'Outlines off'}
                      tone={outlines ? 'accent' : 'default'}
                      selected={outlines}
                      onPress={() => setOutlines((v) => !v)}
                    />
                  </Rowed>
                </Card>

                <Button
                  title={`Make the sheet (${selected.size})`}
                  onPress={() => void makeSheet()}
                  loading={busy}
                  disabled={!selected.size}
                />
                <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginBottom: t.space(4) }}>
                  Each label carries the tag, what the asset is, where it is and the building. No date is
                  printed — on a fire asset a printed date reads as a service date.
                </Txt>
              </View>
            ) : null
          }
        />
      </Screen>
    </>
  );
}

interface RowItem {
  kind: 'untagged' | 'upgradeable' | 'ready' | 'invalid';
  asset: TaggableAsset;
  detail?: string;
}

const ROW_ICON: Record<RowItem['kind'], { icon: keyof typeof MaterialCommunityIcons.glyphMap; tone: 'pass' | 'warn' | 'fail' | 'muted' }> = {
  ready: { icon: 'tag-check-outline', tone: 'pass' },
  untagged: { icon: 'tag-off-outline', tone: 'warn' },
  upgradeable: { icon: 'tag-arrow-up-outline', tone: 'warn' },
  invalid: { icon: 'tag-remove-outline', tone: 'fail' },
};

function AssetRow({
  item, selectable, selected, location, onToggle,
}: {
  item: RowItem;
  selectable: boolean;
  selected: boolean;
  location: string;
  onToggle: () => void;
}) {
  const t = useTheme();
  const meta = ROW_ICON[item.kind];
  const colour = meta.tone === 'pass' ? t.color.pass
    : meta.tone === 'warn' ? t.color.warn
      : meta.tone === 'fail' ? t.color.fail : t.color.textMuted;
  const typeLabel = assetTypeById(item.asset.assetTypeId)?.label ?? item.asset.assetTypeId;

  return (
    <Card onPress={selectable ? onToggle : undefined}>
      <Rowed align="flex-start" gap={2}>
        {selectable ? (
          <MaterialCommunityIcons
            name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={22}
            color={selected ? t.color.accent : t.color.textFaint}
          />
        ) : (
          <MaterialCommunityIcons name={meta.icon} size={22} color={colour} />
        )}
        <View style={{ flex: 1 }}>
          <Txt weight="700" numberOfLines={1}>{item.asset.name || typeLabel}</Txt>
          <Txt size="sm" tone="muted" numberOfLines={1}>
            {[typeLabel, location].filter(Boolean).join(' · ')}
          </Txt>
          {item.detail ? (
            <Txt
              size="xs"
              tone={item.kind === 'invalid' ? 'fail' : 'faint'}
              mono={item.kind === 'ready'}
              style={{ marginTop: t.space(1), lineHeight: 17 }}
            >
              {item.detail}
            </Txt>
          ) : null}
        </View>
      </Rowed>
    </Card>
  );
}
