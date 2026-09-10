import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  deleteCableTable, deleteDeratingEntry, importRatings, listCableTables,
  listDeratingEntries, listRatings, saveCableTable, saveDeratingEntry,
  searchCableTables,
} from '@/db/cableRepo';
import {
  INSTALL_METHOD_SUGGESTIONS, INSULATION_PRESETS, checkTable, formatRatingCsv,
  type CableTable, type DeratingEntry, type RatingHit,
} from '@/domain/cableTables';
import { DERATING_KINDS, DERATING_LABEL, type ConductorMaterial, type DeratingKind } from '@/calc/cable';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { qldMoment } from '@/domain/qldTime';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed,
  Screen, SearchBox, Segmented, SectionHeader, Txt,
} from '@/components/ui';

/**
 * Cable tables — the office's own figures, on the phone.
 *
 * The cable sizing calculator next door works AS/NZS 3008's method and ships
 * none of its numbers. This is where the numbers come from.
 *
 * That is worth stating on the screen rather than only in a comment, because a
 * calculator that opens empty looks broken and the honest explanation is
 * short: those tables are the licensed part of a document Safe QLD buys per
 * copy, this app is public, and a capacity figure recited from memory that is
 * confidently wrong by ten per cent puts an undersized cable in a wall. So the
 * figures are typed or pasted once, from the office's own copy or from a
 * manufacturer's catalogue, they carry where they were read from, and they
 * export as a CSV that reaches every other phone.
 *
 * The search is built for the question actually asked on site, which is not
 * "show me table 4(1)" but "what is 6 mil rated at" — so a bare number means a
 * size or a capacity, across every table at once, which is the comparison
 * somebody was about to make by flipping between two pages.
 */
export default function CableTablesScreen() {
  const t = useTheme();

  const [tables, setTables] = useState<CableTable[]>([]);
  const [hits, setHits] = useState<RatingHit[]>([]);
  const [derating, setDerating] = useState<DeratingEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [material, setMaterial] = useState<ConductorMaterial | undefined>();
  const [minAmps, setMinAmps] = useState('');

  const [tab, setTab] = useState<'find' | 'tables' | 'derating'>('find');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<CableTable | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [ts, ds] = await Promise.all([listCableTables(), listDeratingEntries()]);
      setTables(ts);
      setDerating(ds);
      const pairs = await Promise.all(ts.map(async (x) => [x.id, (await listRatings(x.id)).length] as const));
      setCounts(Object.fromEntries(pairs));
    } catch (e) {
      setTables([]);
      setDerating([]);
      setFailed(describeLoadFailure(e, 'the cable tables on this device'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * The search, re-run whenever the query changes.
   *
   * A failure here empties the results and says why on the banner rather than
   * silently showing nothing: "no rows carry 40 A" and "the database would not
   * open" look identical on a list, and only one of them means load more
   * tables.
   */
  const runSearch = useCallback(async () => {
    try {
      const amps = parseFloat(minAmps);
      setHits(await searchCableTables({
        text: search.trim() || undefined,
        material,
        minAmps: Number.isFinite(amps) && amps > 0 ? amps : undefined,
      }));
    } catch (e) {
      setHits([]);
      setFailed(describeLoadFailure(e, 'the cable tables on this device'));
    }
  }, [search, material, minAmps]);

  useFocusEffect(useCallback(() => { void runSearch(); }, [runSearch]));

  const totalRows = useMemo(() => Object.values(counts).reduce((n, c) => n + c, 0), [counts]);

  return (
    <>
      <Stack.Screen options={{ title: 'Cable tables' }} />
      <Screen>
        {failed ? <Banner tone="fail" title="Could not read the tables" body={failed} /> : null}

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'find', label: 'Find' },
            { value: 'tables', label: `Tables ${tables.length}` },
            { value: 'derating', label: `Derating ${derating.length}` },
          ]}
        />

        {tab === 'find' ? (
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="A size, a capacity, or how it is installed" />
            <Rowed gap={2} wrap>
              <Chip label="Any conductor" selected={!material} onPress={() => setMaterial(undefined)} />
              <Chip label="Copper" selected={material === 'copper'} onPress={() => setMaterial('copper')} />
              <Chip label="Aluminium" selected={material === 'aluminium'} onPress={() => setMaterial('aluminium')} />
            </Rowed>
            <Field label="Carries at least" value={minAmps} onChangeText={setMinAmps} keyboardType="decimal-pad" suffix="A" />

            <Txt size="sm" tone="muted">
              {totalRows === 0
                ? 'No figures loaded yet.'
                : `${hits.length} of ${totalRows} row${totalRows === 1 ? '' : 's'} across ${tables.length} table${tables.length === 1 ? '' : 's'}.`}
            </Txt>

            {totalRows === 0 ? (
              <EmptyState
                title="No figures loaded yet"
                body="This app carries no standard's tables — they are licensed per copy and this one is public. Add a table, paste the sizes out of your own copy or a manufacturer's catalogue, and everything here and in the sizing calculator runs off them."
              />
            ) : hits.length === 0 ? (
              <EmptyState title="Nothing matched" body="A bare number means a size or a capacity. Try one word of the installation method instead." />
            ) : (
              hits.map((h) => <RatingRow key={h.rating.id} hit={h} />)
            )}
          </>
        ) : null}

        {tab === 'tables' ? (
          <>
            {importing ? (
              <ImportCard
                table={importing}
                rowCount={counts[importing.id] ?? 0}
                onDone={() => { setImporting(null); void load(); void runSearch(); }}
              />
            ) : adding ? (
              <TableForm onDone={() => { setAdding(false); void load(); void runSearch(); }} />
            ) : (
              <Button title="Add a table" onPress={() => setAdding(true)} />
            )}

            {tables.length === 0 && !adding ? (
              <EmptyState
                title="No tables yet"
                body="A table is one cable construction installed one way — which is how the printed tables are laid out, and how you will look for the figure again."
              />
            ) : (
              tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  rows={counts[table.id] ?? 0}
                  onImport={() => setImporting(table)}
                  onChanged={() => { void load(); void runSearch(); }}
                />
              ))
            )}
          </>
        ) : null}

        {tab === 'derating' ? (
          <DeratingTab entries={derating} onChanged={() => void load()} />
        ) : null}

        <Card>
          <Label>Why you type these in</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            Current-carrying capacity tables are Standards Australia&rsquo;s, licensed per copy, and this app is public — so it
            carries the method and none of the figures. What it does carry is real: resistance at the conductor&rsquo;s operating
            temperature, the reactive part of a volt drop, and the short-circuit constant derived from the metal&rsquo;s own
            properties rather than looked up.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            Every table records where its figures were read. &ldquo;Where did this 63 A come from&rdquo; has one honest answer six
            months later if the table says, and none if it does not.
          </Txt>
          <View style={{ height: t.space(3) }} />
          <Button title="Open the sizing calculator" variant="secondary" onPress={() => router.push('/tools/cable')} />
          <Button title="The standard’s own tables" variant="ghost" onPress={() => router.push('/tools/wiring')} />
        </Card>
      </Screen>
    </>
  );
}

/** One row of one table, with the table it came from underneath it. */
function RatingRow({ hit }: { hit: RatingHit }) {
  const t = useTheme();
  const { rating, table } = hit;
  return (
    <Card>
      <Rowed style={{ justifyContent: 'space-between' }} align="baseline">
        <Txt size="lg" weight="700">{rating.areaMm2} mm²</Txt>
        <Txt size="lg" weight="700" tone="accent">{rating.amps} A</Txt>
      </Rowed>
      <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
        {table.insulation} · {table.material === 'aluminium' ? 'Aluminium' : 'Copper'} · {table.installMethod}
        {table.cores ? ` · ${table.cores}` : ''}
      </Txt>
      {rating.mvPerAmpMetre !== undefined || rating.reactanceOhmPerKm !== undefined ? (
        <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
          {rating.mvPerAmpMetre !== undefined ? `${rating.mvPerAmpMetre} mV/A·m` : ''}
          {rating.mvPerAmpMetre !== undefined && rating.reactanceOhmPerKm !== undefined ? ' · ' : ''}
          {rating.reactanceOhmPerKm !== undefined ? `${rating.reactanceOhmPerKm} Ω/km reactance` : ''}
        </Txt>
      ) : null}
      <Txt size="sm" tone="faint" style={{ marginTop: t.space(2) }}>{table.source}</Txt>
      {rating.note ? <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>{rating.note}</Txt> : null}
    </Card>
  );
}

/** One table, its row count, and what can be done to it. */
function TableCard({
  table, rows, onImport, onChanged,
}: {
  table: CableTable; rows: number; onImport: () => void; onChanged: () => void;
}) {
  const t = useTheme();
  const [copying, setCopying] = useState(false);

  const copy = async () => {
    setCopying(true);
    try {
      const csv = formatRatingCsv(await listRatings(table.id));
      await Clipboard.setStringAsync(csv);
      showAlert('Copied', `${rows} row${rows === 1 ? '' : 's'} as CSV. Paste it into another phone's import box.`);
    } catch (e) {
      showAlert('Not copied', describeActionFailure(e, 'copying the table'));
    } finally {
      setCopying(false);
    }
  };

  const remove = () => {
    showAlert(
      `Delete ${table.label}?`,
      `Its ${rows} row${rows === 1 ? '' : 's'} go with it. A capacity figure with no table behind it has no source, so nothing is kept back.`,
      [
        { text: 'Keep it' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteCableTable(table.id);
                onChanged();
              } catch (e) {
                showAlert('Not deleted', describeActionFailure(e, 'deleting the table'));
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Card>
      <Txt weight="700">{table.label}</Txt>
      <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
        {table.insulation} · {table.material === 'aluminium' ? 'Aluminium' : 'Copper'} · {table.operatingC} °C
        {table.cores ? ` · ${table.cores}` : ''}
      </Txt>
      <Txt size="sm" tone="muted">{table.installMethod}</Txt>
      <Txt size="sm" tone="faint" style={{ marginTop: t.space(2) }}>{table.source}</Txt>
      <Txt size="sm" tone="faint">
        {rows} size{rows === 1 ? '' : 's'} · added {qldMoment(table.addedAt) ?? table.addedAt}
      </Txt>
      {table.note ? <Txt size="sm" tone="muted" style={{ marginTop: t.space(2) }}>{table.note}</Txt> : null}
      <Divider />
      <Rowed gap={2} wrap>
        <Button title={rows ? 'Add or replace sizes' : 'Paste the sizes in'} compact onPress={onImport} />
        <Button title="Copy as CSV" variant="secondary" compact loading={copying} onPress={() => void copy()} />
        <Button title="Delete" variant="danger" compact onPress={remove} />
      </Rowed>
    </Card>
  );
}

/** The paste box for one table's sizes. */
function ImportCard({ table, rowCount, onDone }: { table: CableTable; rowCount: number; onDone: () => void }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(rowCount > 0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ imported: number; replaced: number; skipped: { line: number; text: string; reason: string }[] } | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      setOutcome(await importRatings(table.id, text, { replace }));
      setText('');
    } catch (e) {
      showAlert('Not loaded', describeActionFailure(e, 'loading the sizes'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionHeader title={`Sizes for ${table.label}`} />
      <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
        Paste a column selection straight out of a spreadsheet or a PDF. Tabs, commas or spaces all read. With a header
        row the columns are matched by name — size, amps, mv, x, note — and without one the first two numbers on each
        line are taken as the size and the capacity, which is the order these tables are printed in.
      </Txt>
      <View style={{ height: t.space(3) }} />
      <Field
        label="The sizes"
        value={text}
        onChangeText={setText}
        multiline
        autoCapitalize="none"
        placeholder={'size,amps,mv\n1.5,…\n2.5,…'}
      />
      {rowCount > 0 ? (
        <Segmented
          value={replace ? 'replace' : 'merge'}
          onChange={(v) => setReplace(v === 'replace')}
          options={[
            { value: 'replace', label: `Replace all ${rowCount}` },
            { value: 'merge', label: 'Add to them' },
          ]}
        />
      ) : null}

      {outcome ? (
        <>
          <View style={{ height: t.space(3) }} />
          <Banner
            tone={outcome.skipped.length ? 'warn' : 'pass'}
            title={`${outcome.imported} size${outcome.imported === 1 ? '' : 's'} loaded`}
            body={outcome.replaced ? `${outcome.replaced} already there were replaced.` : undefined}
          />
          {outcome.skipped.map((s) => (
            <Txt key={s.line} size="sm" tone="warn" style={{ marginTop: 4 }}>
              Line {s.line} — {s.reason}: {s.text}
            </Txt>
          ))}
        </>
      ) : null}

      <View style={{ height: t.space(3) }} />
      <Rowed gap={2}>
        <View style={{ flex: 1 }}>
          <Button title="Load the sizes" loading={busy} disabled={!text.trim()} onPress={() => void run()} />
        </View>
        <Button title="Done" variant="secondary" onPress={onDone} />
      </Rowed>
    </Card>
  );
}

/** Making a table. */
function TableForm({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [material, setMaterial] = useState<ConductorMaterial>('copper');
  const [insulation, setInsulation] = useState('V-75');
  const [operatingC, setOperatingC] = useState('75');
  const [installMethod, setInstallMethod] = useState('');
  const [cores, setCores] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const draft = {
    label, source, material, insulation, installMethod,
    cores: cores || undefined, operatingC: parseFloat(operatingC), note: note || undefined,
  };
  const problems = checkTable(draft);

  const save = async () => {
    setBusy(true);
    try {
      await saveCableTable({ ...draft, operatingC: parseFloat(operatingC) });
      onDone();
    } catch (e) {
      showAlert('Not saved', describeActionFailure(e, 'saving the table'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="A new table" />
      <Field label="Name it" value={label} onChangeText={setLabel} placeholder="V-75 2C+E, enclosed in a wall" />
      <Field
        label="Where the figures come from"
        value={source}
        onChangeText={setSource}
        placeholder="Our copy of AS/NZS 3008.1.1, table and column — or the catalogue and page"
        hint="Required. This is the answer to “where did this come from” when somebody asks in six months."
      />

      <Label>Conductor</Label>
      <Segmented
        value={material}
        onChange={setMaterial}
        options={[{ value: 'copper', label: 'Copper' }, { value: 'aluminium', label: 'Aluminium' }]}
      />

      <Label>Insulation</Label>
      <Rowed gap={2} wrap>
        {INSULATION_PRESETS.map((p) => (
          <Chip
            key={p.id}
            label={p.label}
            selected={insulation === p.label}
            onPress={() => { setInsulation(p.label); setOperatingC(String(p.operatingC)); }}
          />
        ))}
      </Rowed>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 2 }}><Field label="As written on the cable" value={insulation} onChangeText={setInsulation} /></View>
        <View style={{ flex: 1 }}><Field label="Runs at" value={operatingC} onChangeText={setOperatingC} keyboardType="decimal-pad" suffix="°C" /></View>
      </Rowed>

      <Label>How it is installed</Label>
      <Rowed gap={2} wrap>
        {INSTALL_METHOD_SUGGESTIONS.map((m) => (
          <Chip key={m} label={m} selected={installMethod === m} onPress={() => setInstallMethod(m)} />
        ))}
      </Rowed>
      <Field label="In your own copy's words" value={installMethod} onChangeText={setInstallMethod} />
      <Field label="Cores" value={cores} onChangeText={setCores} placeholder="2C+E, 4C, single core" />
      <Field label="Anything else worth knowing" value={note} onChangeText={setNote} multiline />

      {problems.length ? (
        <>
          <View style={{ height: t.space(2) }} />
          {problems.map((p) => <Txt key={p.field} size="sm" tone="warn">{p.reason}</Txt>)}
        </>
      ) : null}

      <View style={{ height: t.space(3) }} />
      <Rowed gap={2}>
        <View style={{ flex: 1 }}>
          <Button title="Save the table" loading={busy} disabled={problems.length > 0} onPress={() => void save()} />
        </View>
        <Button title="Cancel" variant="secondary" onPress={onDone} />
      </Rowed>
    </Card>
  );
}

/**
 * The derating factors, kept apart from the tables.
 *
 * Grouping and ambient temperature apply across every cable construction
 * rather than belonging to one of them, which is how the standard lays them
 * out too — and it means a factor typed once is offered to every sizing.
 */
function DeratingTab({ entries, onChanged }: { entries: DeratingEntry[]; onChanged: () => void }) {
  const t = useTheme();
  const [kind, setKind] = useState<DeratingKind>('ambient');
  const [condition, setCondition] = useState('');
  const [factor, setFactor] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  const value = parseFloat(factor);
  const usable = condition.trim() && source.trim() && Number.isFinite(value) && value > 0 && value <= 2;

  const add = async () => {
    setBusy(true);
    try {
      await saveDeratingEntry({ kind, condition, factor: value, source });
      setCondition('');
      setFactor('');
      onChanged();
    } catch (e) {
      showAlert('Not saved', describeActionFailure(e, 'saving the factor'));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    void (async () => {
      try {
        await deleteDeratingEntry(id);
        onChanged();
      } catch (e) {
        showAlert('Not deleted', describeActionFailure(e, 'deleting the factor'));
      }
    })();
  };

  return (
    <>
      <Card>
        <SectionHeader title="A derating factor" />
        <Rowed gap={2} wrap>
          {DERATING_KINDS.map((k) => (
            <Chip key={k} label={DERATING_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </Rowed>
        <Field label="The condition" value={condition} onChangeText={setCondition} placeholder="40 °C in air" />
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Factor" value={factor} onChangeText={setFactor} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 2 }}><Field label="Read from" value={source} onChangeText={setSource} placeholder="Our copy, table and column" /></View>
        </Rowed>
        <View style={{ height: t.space(3) }} />
        <Button title="Add it" loading={busy} disabled={!usable} onPress={() => void add()} />
      </Card>

      {entries.length === 0 ? (
        <EmptyState
          title="No factors yet"
          body="Ambient temperature, grouping, thermal insulation, depth of burial. Type them once and every sizing offers them."
        />
      ) : (
        DERATING_KINDS.filter((k) => entries.some((e) => e.kind === k)).map((k) => (
          <View key={k}>
            <H2>{DERATING_LABEL[k]}</H2>
            {entries.filter((e) => e.kind === k).map((e) => (
              <Card key={e.id}>
                <Rowed style={{ justifyContent: 'space-between' }} align="baseline">
                  <Txt weight="700">{e.condition}</Txt>
                  <Txt size="lg" weight="700" tone="accent">{e.factor}</Txt>
                </Rowed>
                <Txt size="sm" tone="faint" style={{ marginTop: 2 }}>{e.source}</Txt>
                <View style={{ height: t.space(2) }} />
                <Chip label="Remove" onPress={() => remove(e.id)} />
              </Card>
            ))}
          </View>
        ))
      )}
    </>
  );
}
