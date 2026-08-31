import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  FIELD_SPECS, PANEL_CATALOGUE, classifyFile, importTabular, previewTabular,
  type ColumnMapping, type FieldKey, type TabularPreview,
} from '@/parsers';
import { decodePack, PackError } from '@/share/pack';
import { fromBase64 } from '@/export/zip';
import { createSite, importParsedConfig, listSites } from '@/db/repo';
import type { PanelBrand, Site } from '@/domain/types';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Import.
 *
 * Two paths, and the app works out which without asking: a Safe QLD share pack,
 * or a delimited device list exported from any panel's programming tool. The
 * second is the one that matters — it means the app is useful on a panel nobody
 * has written a dedicated parser for.
 */
export default function ImportScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string }>();

  const [fileName, setFileName] = useState<string>();
  const [preview, setPreview] = useState<TabularPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [text, setText] = useState<string>();
  const [panelName, setPanelName] = useState('');
  const [brand, setBrand] = useState<PanelBrand>('other');
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | undefined>(params.siteId);
  const [newSiteName, setNewSiteName] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    void listSites().then((s) => {
      setSites(s);
      if (!siteId && s.length === 1) setSiteId(s[0]!.id);
    });
  }, [siteId]);

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      const file = new File(asset.uri);
      // Read as text first; a pack is detected from its magic bytes either way.
      const raw = await file.text();
      const kind = classifyFile(asset.name, raw.slice(0, 400));

      if (kind.kind === 'pack') {
        await importPack(file, asset.name);
        return;
      }

      if (kind.kind === 'unknown') {
        Alert.alert(
          'Not a recognised file',
          'Safe QLD reads Safe QLD share packs and delimited device lists (CSV, TSV, tab-separated text). Export a device or point list from the panel software as CSV and try that.',
        );
        return;
      }

      const p = previewTabular(raw);
      if (!p.totalRows) {
        Alert.alert('Nothing to import', 'The file had no readable rows.');
        return;
      }
      setText(raw);
      setFileName(asset.name);
      setPreview(p);
      setMapping(p.mapping);
      setPanelName(asset.name.replace(/\.[^.]+$/, '').slice(0, 60));
    } catch (e) {
      Alert.alert('Could not read the file', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importPack = async (file: File, name: string) => {
    try {
      const bytes = fromBase64(await file.base64());
      const pack = decodePack(bytes);
      const targetSite = siteId ?? (await createSite({ name: pack.meta.siteName || name })).id;
      const res = await importParsedConfig(targetSite, pack.config, 'shared-pack');
      Alert.alert(
        'Pack imported',
        `${res.pointCount.toLocaleString()} points and ${res.zoneCount} zones across ${res.panelIds.length} panel${res.panelIds.length === 1 ? '' : 's'}.`,
      );
      router.replace({ pathname: '/site/[id]', params: { id: targetSite } });
    } catch (e) {
      Alert.alert(
        'Could not open the pack',
        e instanceof PackError ? e.message : e instanceof Error ? e.message : String(e),
      );
    }
  };

  const runImport = async () => {
    if (!text || !preview) return;
    setBusy(true);
    try {
      let target = siteId;
      if (!target) {
        if (!newSiteName.trim()) {
          Alert.alert('Which site?', 'Pick an existing site, or give the new one a name.');
          return;
        }
        target = (await createSite({ name: newSiteName.trim() })).id;
      }

      const parsed = importTabular(text, {
        panelName: panelName.trim() || 'Imported panel',
        brand,
        mapping,
        hasHeader: preview.hasHeader,
      });

      const res = await importParsedConfig(target, parsed, 'tabular-import');
      const warnings = parsed.warnings.length ? `\n\n${parsed.warnings.join('\n')}` : '';
      Alert.alert(
        'Imported',
        `${res.pointCount.toLocaleString()} points and ${res.zoneCount} zones.${warnings}`,
      );
      router.replace({ pathname: '/site/[id]', params: { id: target } });
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setColumn = (index: number, key: FieldKey) => {
    setMapping((prev) => {
      const next = [...prev];
      // A field can only be claimed once, so assigning it clears any other holder.
      if (key !== 'ignore') {
        for (let i = 0; i < next.length; i++) if (next[i] === key) next[i] = 'ignore';
      }
      next[index] = key;
      return next;
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Import' }} />
      <Screen>
        {!preview ? (
          <>
            <Button
              title="Choose a file"
              onPress={pick}
              loading={busy}
              icon={<MaterialCommunityIcons name="file-import-outline" size={18} color={t.color.onAccent} />}
            />

            <Banner
              tone="info"
              title="What this reads"
              body="A Safe QLD share pack (.sqld), or a device list exported as CSV, TSV or tab-separated text from any panel programming tool. Column names are matched automatically and you confirm them before anything is written."
            />

            <H2>Getting a list out of your panel software</H2>
            {PANEL_CATALOGUE.map((p) => (
              <Card key={p.id}>
                <Rowed style={{ justifyContent: 'space-between' }}>
                  <Txt weight="700">{p.brandLabel}</Txt>
                  <Chip
                    label={p.status === 'native' ? 'Reads config directly' : p.status === 'export' ? 'Reads exports' : 'Via CSV export'}
                    tone={p.status === 'planned' ? 'default' : 'pass'}
                  />
                </Rowed>
                <Txt size="sm" tone="muted">{p.models.join(', ')}</Txt>
                {p.howToExport ? (
                  <Txt size="sm" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 19 }}>{p.howToExport}</Txt>
                ) : null}
              </Card>
            ))}

            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Reading vendor config files directly needs sample files to work from — the formats are proprietary and
              undocumented. Until then the CSV path works for every panel, which is why it is the one that is built.
            </Txt>
          </>
        ) : (
          <>
            <Card>
              <Label>File</Label>
              <Txt weight="700" style={{ marginTop: 2 }}>{fileName}</Txt>
              <Txt size="sm" tone="muted">
                {preview.totalRows.toLocaleString()} rows · {preview.headers.length} columns
                {preview.hasHeader ? ' · header row detected' : ' · no header row'}
              </Txt>
            </Card>

            <H2>Where does it go?</H2>
            {sites.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
                <Chip label="New site" selected={!siteId} onPress={() => setSiteId(undefined)} />
                {sites.map((s) => (
                  <Chip key={s.id} label={s.name} selected={siteId === s.id} onPress={() => setSiteId(s.id)} />
                ))}
              </ScrollView>
            ) : null}
            {!siteId ? (
              <Field label="New site name" value={newSiteName} onChangeText={setNewSiteName} autoCapitalize="words" />
            ) : null}

            <Field label="Panel name" value={panelName} onChangeText={setPanelName} />

            <Label>Panel brand</Label>
            <Rowed gap={2} wrap>
              {PANEL_CATALOGUE.map((p) => (
                <Chip key={p.brand} label={p.brandLabel} selected={brand === p.brand} onPress={() => setBrand(p.brand)} />
              ))}
              <Chip label="Other" selected={brand === 'other'} onPress={() => setBrand('other')} />
            </Rowed>

            <H2>Columns</H2>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              Check these before importing. Device text and zone text are the two that matter most — they are what makes a
              point list searchable.
            </Txt>

            {preview.headers.map((h, i) => (
              <Card key={`${h}-${i}`}>
                <Rowed style={{ justifyContent: 'space-between' }}>
                  <Txt weight="600" numberOfLines={1} style={{ flex: 1 }}>{h}</Txt>
                  <Txt size="xs" tone="faint" numberOfLines={1} style={{ maxWidth: '45%' }}>
                    {preview.sampleRows[0]?.[i] ?? ''}
                  </Txt>
                </Rowed>
                <Divider />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
                  <Chip label="Ignore" selected={mapping[i] === 'ignore'} onPress={() => setColumn(i, 'ignore')} />
                  {FIELD_SPECS.map((spec) => (
                    <Chip
                      key={spec.key}
                      label={spec.label}
                      selected={mapping[i] === spec.key}
                      onPress={() => setColumn(i, spec.key)}
                    />
                  ))}
                </ScrollView>
              </Card>
            ))}

            <Rowed gap={2}>
              <Button title="Back" variant="secondary" style={{ flex: 1 }} onPress={() => { setPreview(null); setText(undefined); }} />
              <Button title="Import" style={{ flex: 1 }} onPress={runImport} loading={busy} />
            </Rowed>
          </>
        )}
      </Screen>
    </>
  );
}
