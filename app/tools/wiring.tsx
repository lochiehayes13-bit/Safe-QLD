import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  WIRING_DOC_LABEL, searchWiringTables, tablesFor, wiringFigureCount,
  type WiringDoc, type WiringTable,
} from '@/seed/wiring';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, EmptyState, Label, Rowed, Screen, SearchBox, Txt,
} from '@/components/ui';

/**
 * The wiring rules tables, as a book you can search.
 *
 * A sparky looking something up in AS/NZS 3008 is not looking for "Table 4" —
 * they are looking for two singles in conduit in a wall, or for what buried
 * direct does to a 25 mm², and the words they use are in the column headings
 * rather than the title. So the search covers the headings, the notes and the
 * table's own metadata as well as its number, and every result says which of
 * those matched: a hit on a note is a different kind of answer from a hit on a
 * heading, and pretending otherwise makes the list look arbitrary.
 *
 * The table itself is printed as the standard prints it — same column order,
 * same units, same notes underneath, blanks left blank. A blank cell in the
 * book means the arrangement does not apply to that size, and filling it with
 * a dash or a zero is how somebody ends up reading a figure across from the
 * wrong row.
 *
 * The edition and the page are on every table, because the question asked in
 * front of somebody six months later is "which book is that from".
 */
export default function WiringTablesScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [doc, setDoc] = useState<WiringDoc | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => wiringFigureCount(), []);

  const results = useMemo(() => {
    const hits = query.trim()
      ? searchWiringTables(query, 60)
      : tablesFor(doc === 'all' ? undefined : doc).map((table) => ({ table, matched: 'title' as const, detail: undefined }));
    return doc === 'all' ? hits : hits.filter((h) => h.table.doc === doc);
  }, [query, doc]);

  return (
    <>
      <Stack.Screen options={{ title: 'Wiring rules tables' }} />
      <Screen>
        <Card>
          <Rowed align="flex-start">
            <MaterialCommunityIcons name="table-search" size={26} color={t.color.accent} />
            <View style={{ flex: 1, marginLeft: t.space(3) }}>
              <Txt weight="700">{counts.tables} tables, {counts.figures.toLocaleString()} figures</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                Every numbered table in AS/NZS 3008.1.1 and the sizing tables of AS/NZS 3000, from the company’s
                licensed copies. Search by what is in them, not by their number.
              </Txt>
            </View>
          </Rowed>
        </Card>

        <SearchBox value={query} onChange={setQuery} placeholder="buried direct, trefoil, thermal insulation, table 4…" />
        <Rowed gap={2} wrap>
          <Chip label="Both books" selected={doc === 'all'} onPress={() => setDoc('all')} />
          <Chip label={WIRING_DOC_LABEL.as3008} selected={doc === 'as3008'} onPress={() => setDoc('as3008')} />
          <Chip label={WIRING_DOC_LABEL.as3000} selected={doc === 'as3000'} onPress={() => setDoc('as3000')} />
        </Rowed>

        {results.length === 0 ? (
          <EmptyState
          icon="magnify-close"
            title="Nothing matched"
            body="Try the words on the column heading: unenclosed, enclosed in conduit, buried direct, trefoil, ambient."
          />
        ) : null}

        {results.map(({ table, matched, detail }) => (
          <Card key={`${table.doc}-${table.ref}`} onPress={() => setOpen(open === table.ref ? null : table.ref)}>
            <Rowed align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt weight="700">{table.ref} · {WIRING_DOC_LABEL[table.doc]}</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{shortTitle(table)}</Txt>
                {detail ? (
                  <Txt size="xs" tone="accent" style={{ marginTop: t.space(1) }}>
                    {matched === 'column' ? 'Column: ' : matched === 'note' ? 'Note: ' : ''}{detail}
                  </Txt>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {table.page ? <Chip label={`p.${table.page}`} /> : null}
                {table.problems.length ? <Chip label="Check" tone="warn" /> : null}
              </View>
            </Rowed>
            {open === table.ref ? <TableView table={table} /> : null}
          </Card>
        ))}
      </Screen>
    </>
  );
}

/** The title without the shouted preamble the standard prints above every table. */
function shortTitle(table: WiringTable): string {
  const t = table.title.replace(/^TABLE\s+[0-9A-Z.()]+\s*/i, '');
  return t.length > 150 ? `${t.slice(0, 150)}…` : t;
}

function TableView({ table }: { table: WiringTable }) {
  const t = useTheme();
  const metaEntries = Object.entries(table.meta).filter(([k]) => !k.startsWith('column_') && k !== 'values_layout');

  return (
    <View style={{ marginTop: t.space(3) }}>
      <Divider />

      {table.problems.length ? (
        <Banner
          tone="warn"
          title="Read this one against the book"
          body={table.problems.join('\n\n')}
        />
      ) : null}

      {metaEntries.length ? (
        <View style={{ marginBottom: t.space(2) }}>
          {metaEntries.map(([k, v]) => (
            <Rowed key={k} align="flex-start" style={{ marginTop: t.space(1) }}>
              <Txt size="xs" tone="faint" style={{ width: 120 }}>{k.replace(/_/g, ' ')}</Txt>
              <Txt size="xs" style={{ flex: 1, lineHeight: 17 }}>{String(v)}</Txt>
            </Rowed>
          ))}
        </View>
      ) : null}

      {/*
        The grid scrolls sideways rather than wrapping. A capacity table is 28
        columns wide and wrapping it puts column 15 underneath column 1, where
        it reads as another row — which is exactly the mistake that ends with a
        cable sized off the wrong arrangement.
      */}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <Rowed gap={0} style={{ borderBottomWidth: 1, borderBottomColor: t.color.border, paddingBottom: t.space(1) }}>
            {table.columns.map((c) => (
              <View key={c.n} style={{ width: c.n === 1 ? 120 : 96, paddingRight: t.space(2) }}>
                <Txt size="xs" tone="faint">{c.n}</Txt>
                <Txt size="xs" weight="600" style={{ lineHeight: 15 }}>{c.label}</Txt>
                {c.unit ? <Txt size="xs" tone="faint">{c.unit}</Txt> : null}
              </View>
            ))}
          </Rowed>
          {table.rows.map((row, i) => (
            <Rowed
              key={`${row.key}-${i}`}
              gap={0}
              style={{ paddingVertical: t.space(1), borderBottomWidth: 1, borderBottomColor: t.color.border }}
            >
              <View style={{ width: 120, paddingRight: t.space(2) }}>
                <Txt size="xs" weight="600">{row.key}</Txt>
              </View>
              {row.values.map((v, j) => (
                <View key={j} style={{ width: 96, paddingRight: t.space(2) }}>
                  <Txt size="xs" tone={v === null || v === undefined ? 'faint' : 'default'}>
                    {v === null || v === undefined ? '' : String(v)}
                  </Txt>
                </View>
              ))}
            </Rowed>
          ))}
        </View>
      </ScrollView>

      {table.notes.length ? (
        <View style={{ marginTop: t.space(3) }}>
          <Label>Notes, as printed</Label>
          {table.notes.map((n, i) => (
            <Txt key={i} size="xs" tone="muted" style={{ marginTop: t.space(1), lineHeight: 17 }}>{n}</Txt>
          ))}
        </View>
      ) : null}

      <Divider />
      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
        {table.source}{table.page ? `, p.${table.page}` : ''}. Transcribed twice and checked; a figure that matters
        is worth reading against the book.
      </Txt>
    </View>
  );
}
