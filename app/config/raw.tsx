import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useConfig } from '@/hooks/useConfig';
import {
  readConfigStructure, readGroupPage, type ConfigStructure, type GroupPage,
} from '@/parsers/container';
import { contextId } from '@/domain/screenContext';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Rowed, Screen, SectionHeader, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { RecordGate } from '@/components/RecordGate';
import { describeLoadFailure } from '@/domain/loadFailure';

/**
 * What is actually inside the file.
 *
 * Every other screen in the Explorer shows what a parser made of a
 * configuration. This one shows the configuration: the tables Loop Explorer
 * wrote into its SQLite database, the element kinds in a Notifier .pci, the
 * records in a Pertronic archive, the sections of an Ampac .ffp — including
 * every one this build does not read.
 *
 * That last part is the reason it exists. A technician looking at a device
 * this app has imported with no type, or a zone it did not pick up, has no way
 * to tell whether the fact is missing from the file or missing from the
 * reader. Here they can look. And the first thing anybody needs before writing
 * the code to read a new format is the list of what is in one.
 *
 * `@/parsers/container` does the work and knows about no screen; this draws it.
 */
const PAGE = 50;

export default function ConfigRawScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = contextId(params.id);
  const { opened, failed, missing, reload } = useConfig(id);

  const [structure, setStructure] = useState<ConfigStructure | null>(null);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [page, setPage] = useState<GroupPage | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const bytes = opened?.bytes;
  const fileName = opened?.record.fileName ?? '';

  /*
   * Read on focus rather than during render, so the screen paints first. A
   * configuration is a few megabytes and walking every table of it is not
   * instant on a handset; done in a `useMemo` it is a frozen tap, which reads
   * as the app having crashed.
   */
  useFocusEffect(useCallback(() => {
    if (!bytes) return;
    setReading(true);
    setReadFailed(null);
    try {
      setStructure(readConfigStructure(bytes, fileName));
    } catch (e) {
      setStructure(null);
      setReadFailed(describeLoadFailure(e, 'the inside of this file'));
    } finally {
      setReading(false);
    }
  }, [bytes, fileName]));

  /**
   * Opens a table, or closes the one that is open.
   *
   * The rows are read here in the press rather than in an effect watching the
   * selection. Both work; this one reads as what it is — a table is walked
   * because somebody asked for it — and it keeps the walk out of the render
   * path, where a table of four thousand rows would be felt.
   */
  const openTable = (groupName: string | null, rows: number) => {
    setOpenGroup(groupName);
    setLimit(rows);
    if (!bytes || !groupName) {
      setPage(null);
      return;
    }
    try {
      setPage(readGroupPage(bytes, fileName, groupName, 0, rows) ?? null);
    } catch {
      // One table that will not read is not the file failing. The group card
      // says so below and the rest of them stay open.
      setPage(null);
    }
  };

  if (!id) return <ContextGate kind="configuration" what="what is inside the file" title="Inside the file" />;
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
      <Stack.Screen options={{ title: 'Inside the file' }} />

      {readFailed ? <Banner tone="fail" title="The file could not be opened" body={readFailed} /> : null}

      {!bytes ? (
        <Banner
          tone="warn"
          title="The file itself is gone"
          body="The library has a record of this configuration but not its bytes. Open it again from wherever you got it."
        />
      ) : null}

      {reading && !structure ? <Txt size="sm" tone="muted">Opening the file…</Txt> : null}

      {structure ? (
        <>
          <Card>
            <Txt size="sm" style={{ lineHeight: 20 }}>{structure.headline}</Txt>
            <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
              <Chip label={structure.packaging.replace(/-/g, ' ')} />
              <Chip label={`${(structure.byteLength / 1024).toFixed(0)} KB`} />
              <Chip label={`${structure.groups.length} ${structure.groups.length === 1 ? 'table' : 'tables'}`} />
            </Rowed>
          </Card>

          {structure.warnings.length ? (
            <Banner tone="warn" title="Not everything could be opened" body={structure.warnings.join('\n\n')} />
          ) : null}

          {structure.entries.length ? (
            <>
              <SectionHeader title="Files in the archive" />
              <Card>
                {structure.entries.map((entry, i) => (
                  <View key={entry.name}>
                    {i > 0 ? <Divider /> : null}
                    <Rowed gap={2}>
                      <Txt size="sm" weight={entry.isConfig ? '700' : '400'} style={{ flex: 1 }} numberOfLines={1}>
                        {entry.name}
                      </Txt>
                      {entry.isConfig ? <Chip label="The configuration" tone="pass" /> : null}
                      <Txt size="xs" tone="faint">{`${Math.max(1, Math.round(entry.byteLength / 1024))} KB`}</Txt>
                    </Rowed>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {structure.groups.length === 0 ? (
            <EmptyState
              icon="file-question-outline"
              title="Nothing readable inside"
              body={structure.headline}
            />
          ) : (
            <>
              <SectionHeader title="What the vendor tool wrote" />
              {structure.groups.map((group) => {
                const open = openGroup === group.name;
                return (
                  <Card key={`${group.entry ?? ''}/${group.name}`}>
                    <Card onPress={() => openTable(open ? null : group.name, PAGE)}>
                      <Rowed gap={2}>
                        <Txt weight="700" style={{ flex: 1 }} numberOfLines={1}>{group.name}</Txt>
                        <Txt size="xs" tone="faint">
                          {`${group.rowCount.toLocaleString()} ${group.rowCount === 1 ? 'row' : 'rows'}`}
                        </Txt>
                        <MaterialCommunityIcons
                          name={open ? 'chevron-up' : 'chevron-down'}
                          size={20}
                          color={t.color.textFaint}
                        />
                      </Rowed>
                      <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }} numberOfLines={open ? undefined : 2}>
                        {group.note ? `${group.note} ` : ''}
                        {group.columns.join(', ')}
                      </Txt>
                    </Card>

                    {open && page ? (
                      <>
                        <View style={{ marginVertical: t.space(2) }}><Divider /></View>
                        <Table page={page} />
                        {page.total > page.rows.length ? (
                          <Button
                            title={`Show ${Math.min(PAGE, page.total - page.rows.length)} more of ${page.total.toLocaleString()}`}
                            variant="ghost"
                            compact
                            onPress={() => openTable(group.name, limit + PAGE)}
                          />
                        ) : null}
                      </>
                    ) : null}

                    {open && !page ? (
                      <Txt size="sm" tone="muted" style={{ marginTop: t.space(2) }}>
                        This table could not be read.
                      </Txt>
                    ) : null}
                  </Card>
                );
              })}
            </>
          )}

          <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>
            This is the file, not what the app made of it. A column here that appears nowhere else in the
            Explorer is a column this build does not read — which is worth knowing, and worth sending in.
          </Txt>
        </>
      ) : null}
    </Screen>
  );
}

/**
 * One table, scrolled sideways.
 *
 * A vendor table runs to twenty columns and a phone is four hundred points
 * wide, so something has to give. Wrapping the cells would make every row a
 * different height and the columns would stop lining up, which is the one
 * thing a table is for — so it scrolls, and the first column stays the width
 * of the rest rather than being pinned. Pinning it sounds better and is worse
 * here: none of these formats puts the identifying column first.
 */
function Table({ page }: { page: GroupPage }) {
  const t = useTheme();
  const width = 132;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <Rowed gap={0} style={{ paddingBottom: t.space(1) }}>
          {page.columns.map((c, i) => (
            <Txt
              key={`${c}-${i}`}
              size="xs"
              weight="700"
              tone="muted"
              numberOfLines={1}
              style={{ width, paddingRight: t.space(2) }}
            >
              {c}
            </Txt>
          ))}
        </Rowed>
        <Divider />
        {page.rows.map((row, r) => (
          <Rowed key={r} gap={0} style={{ paddingVertical: t.space(1) }}>
            {page.columns.map((c, i) => (
              <Txt key={`${c}-${i}`} size="xs" numberOfLines={2} style={{ width, paddingRight: t.space(2), lineHeight: 16 }}>
                {row[i] ?? ''}
              </Txt>
            ))}
          </Rowed>
        ))}
      </View>
    </ScrollView>
  );
}
