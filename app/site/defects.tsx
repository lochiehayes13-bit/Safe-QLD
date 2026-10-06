import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getDefect, getSite, listDefects, reopenDefect, updateDefect } from '@/db/repo';
import { queueDefectNote } from '@/db/opsRepo';
import { defectMove, describeDefectReport, type DefectReportNotice, type DefectReportOccasion } from '@/domain/defectReport';
import { nowIso } from '@/db';
import type { Defect, Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { defectSheet } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/** Defects for one site. */
export default function SiteDefectsScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState(false);

  // An empty list under "Nothing outstanding here" is a compliance statement
  // about the site, so a read that threw says so instead of making it.
  const [failed, setFailed] = useState<string | null>(null);

  /*
   * What happened the last time this screen tried to tell the office something.
   * A banner rather than a modal on purpose: a technician clearing six defects
   * on the way out of a building should not have to dismiss six alerts, and the
   * one outcome they have to act on -- a defect with no job, which cannot reach
   * Simpro at all -- reads just as loudly in a warn banner as in a dialog and
   * does not block the next tap. Deliberately not cleared by `load`, which runs
   * on every focus, so walking into the defect and back out does not wipe the
   * only record that the office was or was not told.
   */
  const [report, setReport] = useState<DefectReportNotice | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    setFailed(null);
    try {
      const [s, d] = await Promise.all([getSite(siteId), listDefects(siteId)]);
      setSite(s);
      setDefects(d);
    } catch (e) {
      setDefects([]);
      setFailed(describeLoadFailure(e, "this site's defects"));
    }
  }, [siteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = defects.filter((d) => (status === 'open' ? d.status === 'open' : true));

  /**
   * Puts the defect's new state onto the Simpro job it belongs to.
   *
   * Until this existed, a defect's life ended at the phone the moment it was
   * raised: the office was told it was there and never told it had been fixed,
   * so a scheduler kept booking a return visit for work that was done weeks ago
   * and the only thing that ever corrected it was somebody ringing up. The job
   * comes off the defect's own row rather than out of a picker, because the
   * technician already answered that question when the defect was raised and
   * being asked it again on the way out of a plant room is how a step gets
   * skipped.
   *
   * The row is read back rather than composed from the copy this list is holding.
   * The note is what the office reads, so it is built from what is actually
   * stored -- a write that half landed, or a row another screen changed while
   * this list sat open, then shows up as a note that disagrees with the record
   * rather than one that quietly invents a state nothing on the phone holds.
   *
   * Nobody's name is passed. The note's only person line reads "Raised by", and
   * the technician tapping Rectified today is often not the one who found it
   * last month -- putting the current name there would be a false statement in a
   * record the occupier statement reads back. "Not recorded" is the honest
   * answer, and `queueDefectNote` leaves it at that.
   */
  const reportToOffice = async (defectId: string, occasion: DefectReportOccasion) => {
    try {
      const fresh = await getDefect(defectId);
      // Gone between the write and the read: another handset or the delete on
      // the defect screen. There is nothing to report and nothing broken.
      if (!fresh) return;
      // The site name is outside both halves of the note's key, so handing it
      // over saves the queue a read and cannot fork the note in two.
      const { queued } = await queueDefectNote(fresh, undefined, { siteName: site?.name });
      // Trimmed to nothing counts as no job. A row holding "   " is what an
      // older import left behind and it would otherwise print as "Job    ".
      setReport(describeDefectReport({ occasion, jobId: fresh.jobId?.trim() || undefined, queued }));
    } catch (e) {
      setReport({
        tone: 'warn',
        title: 'The office has not been told',
        body: describeActionFailure(e, 'queueing the note for the office'),
      });
    }
  };

  /*
   * Rectified is a statutory fact, not a tidy-up. The date it stamps is what
   * the occupier statement and a critical defect notice read back, so one tap
   * on the wrong row used to put a rectification date on a defect nobody had
   * touched, with no way back. It asks now, and a slip can be reopened.
   */
  const markRectified = (d: Defect) => {
    showAlert(
      'Mark this defect rectified?',
      `${d.location}\n\nThis records today as the rectification date, which the occupier statement and any critical defect notice read back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rectified',
          onPress: () => {
            void (async () => {
              setReport(null);
              // Worked out before the write, because afterwards the row says
              // rectified and there is no longer anything to compare against.
              const move = defectMove(d.status, 'rectified');
              try {
                await updateDefect(d.id, { status: 'rectified', rectifiedAt: nowIso() });
              } catch (e) {
                // This used to be an unhandled rejection inside `void`, which
                // goes nowhere at all: the list reloaded, the defect was still
                // open, and nothing said why.
                showAlert('Not saved', describeActionFailure(e, 'marking this defect rectified'));
                return;
              }
              if (move) await reportToOffice(d.id, move);
              void load();
            })();
          },
        },
      ],
    );
  };

  const reopen = (d: Defect) => {
    showAlert('Reopen this defect?', 'It goes back to open and the rectification date is cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reopen',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setReport(null);
            const move = defectMove(d.status, 'open');
            try {
              await reopenDefect(d.id);
            } catch (e) {
              showAlert('Not saved', describeActionFailure(e, 'reopening this defect'));
              return;
            }
            if (move) await reportToOffice(d.id, move);
            void load();
          })();
        },
      },
    ]);
  };

  const exportList = async () => {
    // The button is always on screen, so an empty list used to make it do
    // nothing at all — press, no spinner, no sheet, no word.
    if (!shown.length) {
      showAlert(
        'Nothing to export',
        status === 'open'
          ? 'There are no open defects at this site. Switch to All if you want the ones already cleared.'
          : 'No defects have been recorded at this site yet.',
      );
      return;
    }
    setBusy(true);
    try {
      const file = writeXlsx(`Defects - ${site?.name ?? 'Site'}`, [defectSheet(shown)]);
      const shared = await shareFile(file, 'Defect list');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'spreadsheet');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not export', describeActionFailure(e, 'export this defect list'));
    } finally {
      setBusy(false);
    }
  };

  if (!siteId) return <ContextGate kind="site" what="the defects raised" title="Defects" backTo="/site/defects" />;

  return (
    <>
      <Stack.Screen options={{ title: site ? `${site.name} — defects` : 'Defects' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2) }}>
          <Segmented value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
          <Rowed gap={2}>
            <Button
              title="Raise defect"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/work/defect/new', params: { siteId: siteId ?? '' } })}
            />
            <Button title="Export" variant="secondary" style={{ flex: 1 }} onPress={exportList} loading={busy} />
          </Rowed>
          {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
          {report ? <Banner tone={report.tone} title={report.title} body={report.body} /> : null}
        </View>

        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={
            failed ? null : (
              <EmptyState
          icon="alert-circle-check-outline"
                title={status === 'open' ? 'Nothing outstanding here' : 'No defects recorded'}
                body="Defects raised on this site appear here until they are cleared."
              />
            )
          }
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/defect/[id]', params: { id: item.id } })}>
              <Rowed gap={2} wrap>
                <Chip label={item.severity === 'critical' ? 'CRITICAL' : 'Non-critical'} tone={item.severity === 'critical' ? 'fail' : 'warn'} />
                <Chip label={item.status} tone={item.status === 'open' ? 'default' : 'pass'} />
                {item.photos.length ? <Chip label={`${item.photos.length} photo`} /> : null}
              </Rowed>
              <Txt weight="700" style={{ marginTop: t.space(1.5) }}>{item.location}</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{item.description}</Txt>
              <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>Raised {formatAuDate(item.raisedAt)}</Txt>
              {item.severity === 'critical' && !item.noticeIssuedAt ? (
                <Button
                  title="The occupier’s notice is not written"
                  variant="secondary"
                  compact
                  style={{ marginTop: t.space(2.5) }}
                  onPress={() => router.push({ pathname: '/work/notice/[id]', params: { id: item.id } })}
                />
              ) : null}
              {item.status === 'open' ? (
                <Button
                  title="Mark rectified"
                  variant="secondary"
                  compact
                  style={{ marginTop: t.space(2.5) }}
                  onPress={() => markRectified(item)}
                />
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
          )}
        />
      </Screen>
    </>
  );
}
