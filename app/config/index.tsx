import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listConfigFiles, configLibrarySize } from '@/db/configRepo';
import { openConfig, NotAConfigError } from '@/services/configOpen';
import { byBuilding, describeSummary, type ConfigFileRecord, type ConfigVersions } from '@/domain/configLibrary';
import { PANEL_CATALOGUE } from '@/parsers';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Rowed, Screen, SectionHeader, Txt,
} from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Config Explorer.
 *
 * Opening a panel configuration used to mean importing it: the devices, zones
 * and logic went into a site, and there was no way back. So the only way to
 * look at a file was to commit to it, which is the wrong shape for nearly
 * every reason anybody opens one — checking a config is the right building
 * before it touches the register, reading what is programmed at a panel that
 * is misbehaving, or seeing what a builder changed since last year.
 *
 * This is the other way. A file opened here is kept whole and read, and
 * nothing is written into a site until somebody presses the button that does
 * that. The library below is what this phone is holding.
 */

/** How big the library is, in the units a phone reports. */
function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The brands whose own files open with no export step. */
const nativeBrands = [
  ...new Set(PANEL_CATALOGUE.filter((p) => p.status === 'native').map((p) => p.brandLabel)),
].join(', ');

export default function ConfigExplorerScreen() {
  const t = useTheme();
  const [groups, setGroups] = useState<ConfigVersions[]>([]);
  const [size, setSize] = useState<{ files: number; bytes: number }>({ files: 0, bytes: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const [library, used] = await Promise.all([listConfigFiles(), configLibrarySize()]);
      setGroups(byBuilding(library));
      setSize(used);
    } catch (e) {
      // An empty library and a library that could not be read look identical,
      // and one of them sends a technician off to find a file they already have.
      setGroups([]);
      setFailed(describeLoadFailure(e, 'the configurations on this phone'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const pick = async () => {
    let result;
    try {
      result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    } catch (e) {
      showAlert('Could not open the file picker', describeActionFailure(e, 'choose a file'));
      return;
    }
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setOpening(true);
    try {
      const bytes = new Uint8Array(await new File(asset.uri).bytes());
      const opened = await openConfig(asset.name, bytes);
      // Straight into it. A file that is opened and then left on a list is a
      // file somebody has to find again on a screen they have never used.
      router.push({ pathname: '/config/[id]', params: { id: opened.record.id } });
    } catch (e) {
      showAlert(
        e instanceof NotAConfigError ? 'Not a panel configuration' : 'Could not open the file',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Config Explorer' }} />

      <Button
        title="Open a configuration"
        onPress={pick}
        loading={opening}
        icon={<MaterialCommunityIcons name="folder-open-outline" size={18} color={t.color.onAccent} />}
      />

      {failed ? (
        <>
          <Banner tone="fail" title="The library could not be read" body={failed} />
          <Button title="Try again" variant="secondary" onPress={() => void load()} />
        </>
      ) : null}

      {loading && !groups.length ? (
        <Txt size="sm" tone="muted">Reading the library…</Txt>
      ) : null}

      {!loading && !failed && !groups.length ? (
        <EmptyState
          icon="file-cog-outline"
          title="Nothing open yet"
          body={
            `Open a site file from ${nativeBrands}, a Safe QLD share pack, or a device list exported as CSV `
            + 'from any panel programming tool. Nothing is written into a site: the file is read, kept, and '
            + 'yours to look through.'
          }
          action={<Button title="Open a configuration" onPress={pick} loading={opening} />}
        />
      ) : null}

      {groups.map((group) => (
        <View key={group.label}>
          <SectionHeader title={group.label} />
          <Card>
            {group.records.map((record, i) => (
              <View key={record.id}>
                {i > 0 ? <Divider /> : null}
                <ConfigRow record={record} versions={group.records.length} index={i} />
              </View>
            ))}
          </Card>
        </View>
      ))}

      {size.files ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>
          {`${size.files} ${size.files === 1 ? 'file' : 'files'} kept on this phone, `}
          {`${readableSize(size.bytes)} in all. A configuration is the largest single thing this app stores; `}
          <Txt size="xs" tone="faint">open one and remove it from there when you are done with it.</Txt>
        </Txt>
      ) : null}
    </Screen>
  );
}

/** One file in the library. */
function ConfigRow({ record, versions, index }: { record: ConfigFileRecord; versions: number; index: number }) {
  const t = useTheme();
  const warnings = record.summary.warnings.length;

  return (
    <Card onPress={() => router.push({ pathname: '/config/[id]', params: { id: record.id } })}>
      <Rowed gap={2}>
        <Txt weight="700" style={{ flex: 1 }} numberOfLines={1}>{record.fileName}</Txt>
        {/*
          * The newest of several is marked rather than the older ones, because
          * "current" is the fact somebody is looking for and "superseded" is
          * three words about the same thing said four times.
          */}
        {versions > 1 && index === 0 ? <Chip label="Newest" tone="pass" /> : null}
      </Rowed>
      <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
        {describeSummary(record.summary)}
      </Txt>
      <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>
        {`Opened ${formatAuDate(record.lastOpenedAt)}`}
        {record.siteName ? ` · tied to ${record.siteName}` : ''}
        {record.importedAt ? ' · imported' : ''}
        {warnings ? ` · ${warnings} thing${warnings === 1 ? '' : 's'} the reader could not do` : ''}
      </Txt>
    </Card>
  );
}
