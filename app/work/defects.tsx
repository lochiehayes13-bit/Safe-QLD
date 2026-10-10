import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { getDefect, listDefects, listSitePicks, reopenDefect, updateDefect } from '@/db/repo';
import { queueDefectNote } from '@/db/opsRepo';
import {
  defectMove, defectStatusLabel, describeDefectReport, type DefectReportNotice, type DefectReportOccasion,
} from '@/domain/defectReport';
import { nowIso } from '@/db';
import type { Defect } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Outstanding works — defects across every site, worst first.
 *
 * The tab is the query. This screen used to read every defect the company
 * holds — fourteen hundred of them — and every column of all three thousand
 * sites to put a name under each one, on every focus, and then drop the
 * rectified ones in JavaScript. The Open tab asks the database for the open
 * ones, and the site names come across as two columns.
 */

/** How many rows the list draws at once. Where it cuts, the list says so. */
const PAGE = 300;

export default function DefectsScreen() {
  const t = useTheme();
  const [defects, setDefects] = useState<Defect[]>([]);
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  // Quoted has its own tab: a quoted defect is not fixed, and it has to be
  // somewhere it can be found and marked rectified.
  const [status, setStatus] = useState<'open' | 'quoted' | 'all'>('open');
  const [capped, setCapped] = useState(false);
  // When the list was read, for each defect's age. Moved on with every load.
  const [readAt, setReadAt] = useState(() => Date.now());

  // "Nothing outstanding" across every site is the strongest claim this app
  // makes. It must not be made on the strength of a read nobody checked.
  const [failed, setFailed] = useState<string | null>(null);

  /*
   * What happened the last time this screen tried to tell the office something.
   * A banner rather than a modal: this is the list a technician works down at
   * the end of the week, and an alert per row would make clearing six defects
   * six dialogs. The one outcome that needs acting on -- a defect with no job,
   * which cannot reach Simpro at all -- reads just as loudly in a warn banner.
   */
  const [report, setReport] = useState<DefectReportNotice | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      // One more than the page, which is how the list knows it was cut
      // without a second count of a table nobody is counting.
      const [d, s] = await Promise.all([
        listDefects(undefined, status === 'all' ? undefined : status, PAGE + 1),
        listSitePicks(),
      ]);
      setDefects(d.slice(0, PAGE));
      setReadAt(Date.now());
      setCapped(d.length > PAGE);
      setSites(new Map(s.map((x) => [x.id, x.name])));
    } catch (e) {
      setDefects([]);
      setFailed(describeLoadFailure(e, 'the defects'));
    }
  }, [status]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = defects;

  /**
   * Puts the defect's new state onto the Simpro job it belongs to.
   *
   * The office was told a defect existed and then never told anything else about
   * it, so a scheduler on this build kept booking return visits for work that had
   * already been done and the only thing that ever corrected that was a phone
   * call. The job comes off the defect's own row: the technician answered that
   * question when they raised it, and asking again from a list of three hundred
   * defects is not a question anybody would answer honestly.
   *
   * Read back from SQLite rather than composed from the row this list is holding,
   * because the note is what the office reads and it should say what is stored.
   * This list can sit open on a bench for an hour while the same defects are
   * edited on the detail screen.
   *
   * No name is passed. The note's one person line says "Raised by", and whoever
   * taps Rectified on a list of every site's defects is very often not the person
   * who found it -- a name there would be a false statement in a record the
   * occupier statement reads back, so it stays "not recorded".
   */
  const reportToOffice = async (defectId: string, siteName: string | undefined, occasion: DefectReportOccasion) => {
    try {
      const fresh = await getDefect(defectId);
      // Gone between the write and the read -- deleted on the detail screen or
      // on another handset. Nothing to report, nothing broken.
      if (!fresh) return;
      // Outside both halves of the note's key, so passing it saves the queue a
      // read and cannot fork one defect into two notes.
      const { queued } = await queueDefectNote(fresh, undefined, { siteName });
      // A row holding "   " is what an older import left behind; trimmed to
      // nothing it counts as no job rather than printing as "Job    ".
      setReport(describeDefectReport({ occasion, jobId: fresh.jobId?.trim() || undefined, queued }));
    } catch (e) {
      setReport({
        tone: 'warn',
        title: 'Office not told',
        body: describeActionFailure(e, 'queue the note for the office'),
      });
    }
  };

  /**
   * One deliberate status change, written and then reported.
   *
   * All three buttons on a row come through here so the guard is written once:
   * `defectMove` returns nothing when the status has not actually moved, and a
   * tap on the chip a defect is already on is the commonest tap on this screen.
   * Without that, a technician nudging a row three times would put three notes on
   * a Simpro job -- and because the wording sits in the identity half of the
   * note's key while the status sits in the content half, only some of those are
   * recognised as the same defect.
   */
  const moveStatus = (d: Defect, next: Defect['status']) => {
    void (async () => {
      setReport(null);
      // Worked out before the write, because afterwards the row holds the new
      // status and there is nothing left to compare it against.
      const move = defectMove(d.status, next);
      try {
        // Reopening goes through its own statement: `updateDefect` skips a field
        // set to undefined, so it cannot take the rectification date off a row,
        // and a reopened defect still carrying the date it was fixed is what the
        // occupier statement would print.
        if (next === 'open') await reopenDefect(d.id);
        else await updateDefect(d.id, next === 'rectified' ? { status: 'rectified', rectifiedAt: nowIso() } : { status: next });
      } catch (e) {
        // These writes used to be unhandled rejections inside `void`, so a full
        // disk reloaded the list, left the defect as it was, and said nothing.
        showAlert('Not saved', describeActionFailure(e, 'save this defect'));
        return;
      }
      if (move) await reportToOffice(d.id, sites.get(d.siteId), move);
      void load();
    })();
  };

  /*
   * Rectified is a statutory fact, not a tidy-up. The date it stamps is what
   * the occupier statement and a critical defect notice read back, so one tap
   * on the wrong row used to put a rectification date on a defect nobody had
   * touched, with no way back. It asks now, and a slip can be reopened.
   */
  const markRectified = (d: Defect) => {
    showAlert(
      'Mark rectified?',
      `${sites.get(d.siteId) ?? 'Unknown site'}, ${d.location}\n\nRecords today as the rectification date.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rectified', onPress: () => moveStatus(d, 'rectified') },
      ],
    );
  };

  const reopen = (d: Defect) => {
    showAlert('Reopen this defect?', 'Clears the rectification date.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', style: 'destructive', onPress: () => moveStatus(d, 'open') },
    ]);
  };

  /** Age in days, which is what makes an outstanding list feel urgent. */
  const ageDays = (iso: string): number => {
    const then = Date.parse(iso);
    return Number.isFinite(then) ? Math.floor((readAt - then) / 86_400_000) : 0;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Defects' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[{ value: 'open', label: 'Open' }, { value: 'quoted', label: 'Quoted' }, { value: 'all', label: 'All' }]}
          />
          <Button title="Raise defect" onPress={() => router.push('/work/defect/new')} />
          {/* Said out loud where the list is cut, rather than a list that
              quietly stops at three hundred of the fourteen hundred on the
              book. */}
          {capped ? <Txt size="xs" tone="faint">First {PAGE} shown, critical first. Open a site for all of its defects.</Txt> : null}
          {report ? <Banner tone={report.tone} title={report.title} body={report.body} /> : null}
        </View>
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={failed ? (
            <View style={{ gap: t.space(2) }}>
              <Banner tone="fail" title="Defects not loaded" body={failed} />
              <Button title="Try again" variant="secondary" onPress={() => { void load(); }} />
            </View>
          ) : null}
          ListEmptyComponent={failed ? null : (
            <EmptyState
              icon="alert-circle-check-outline"
              title={status === 'open' ? 'No open defects' : status === 'quoted' ? 'No quoted defects' : 'No defects recorded'}
            />
          )}
          renderItem={({ item }) => {
            const days = ageDays(item.raisedAt);
            return (
              <Card onPress={() => router.push({ pathname: '/defect/[id]', params: { id: item.id } })}>
                <Rowed align="flex-start" gap={2}>
                  <View style={{ flex: 1 }}>
                    <Rowed gap={2} wrap>
                      <Chip label={item.severity === 'critical' ? 'Critical' : 'Non-critical'} tone={item.severity === 'critical' ? 'fail' : 'warn'} />
                      <Chip label={defectStatusLabel(item.status)} tone={item.status === 'rectified' || item.status === 'closed' ? 'pass' : 'default'} />
                      {days > 30 ? <Chip label={`${days} days old`} tone="fail" /> : days > 0 ? <Chip label={`${days}d`} /> : null}
                    </Rowed>
                    <Txt weight="700" style={{ marginTop: t.space(1.5) }} numberOfLines={1}>{item.location}</Txt>
                    <Txt size="sm" tone="muted" numberOfLines={3} style={{ lineHeight: 19 }}>{item.description}</Txt>
                    <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>
                      {sites.get(item.siteId) ?? 'Unknown site'} · raised {formatAuDate(item.raisedAt)}
                      {item.photos.length ? ` · ${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}` : ''}
                    </Txt>
                  </View>
                </Rowed>
                {item.severity === 'critical' && !item.noticeIssuedAt ? (
                  <Button
                    title="Write occupier notice"
                    variant="secondary"
                    compact
                    style={{ marginTop: t.space(2.5) }}
                    onPress={() => router.push({ pathname: '/work/notice/[id]', params: { id: item.id } })}
                  />
                ) : null}
                {item.status === 'open' || item.status === 'quoted' ? (
                  <Rowed gap={2} style={{ marginTop: t.space(2.5) }}>
                    <Button
                      title="Rectified"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      onPress={() => markRectified(item)}
                    />
                    {item.status === 'open' ? (
                      <Button
                        title="Quoted"
                        variant="secondary"
                        compact
                        style={{ flex: 1 }}
                        onPress={() => moveStatus(item, 'quoted')}
                      />
                    ) : null}
                  </Rowed>
                ) : item.status === 'rectified' ? (
                  <Button
                    title="Reopen"
                    variant="ghost"
                    compact
                    style={{ marginTop: t.space(2.5) }}
                    onPress={() => reopen(item)}
                  />
                ) : null}
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
