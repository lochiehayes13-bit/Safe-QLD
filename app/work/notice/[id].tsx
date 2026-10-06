import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getDefect, getSite, updateDefect } from '@/db/repo';
import { queueDefectNote } from '@/db/opsRepo';
import { describeDefectReport, type DefectReportNotice } from '@/domain/defectReport';
import type { Defect, Site } from '@/domain/types';
import {
  AS1851_CLASS_LABEL, AS1851_CLASS_OBLIGATION, criticalNoticeDueAt, isQldCriticalDefect,
  rectificationDueAt, type As1851Class,
} from '@/domain/qldCompliance';
import { criticalDefectNoticeHtml } from '@/export/criticalDefectNotice';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { formatAuDate } from '@/export/sheets';
import { qldMoment } from '@/domain/qldTime';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { useRecordPatch } from '@/hooks/useRecordPatch';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Critical defect notice.
 *
 * Queensland gives 24 hours from the maintenance to put a written notice in the
 * occupier's hands, so the clock is the first thing on the screen and counts
 * down rather than sitting as a date someone has to work out.
 */
export default function NoticeScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [defect, setDefect] = useState<Defect | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [occupier, setOccupier] = useState('');
  const [busy, setBusy] = useState(false);
  /** What happened the last time this screen tried to tell the office something. */
  const [report, setReport] = useState<DefectReportNotice | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const d = await getDefect(id);
      setDefect(d);
      setMissing(!d);
      setOccupier(d?.noticeRecipient ?? '');
      if (d) setSite(await getSite(d.siteId));
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this defect'));
      /*
       * The site has to be unknown rather than stale when the read threw.
       *
       * `failed` is only rendered on the no-defect path, and the defect is set
       * before the site is read — so a site read that threw left the whole
       * screen rendered, with no error anywhere on it and site null. The
       * button is disabled only on "not critical", so it stayed live, and
       * pressing it returned at `if (!site) return;` before even the spinner.
       * No PDF, no alert, nothing at all — on the one document in this app
       * with a twenty-four hour statutory clock that this very screen counts
       * down. The technician concludes the button is broken and the clock
       * keeps running.
       */
      setSite(null);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (defect?.noticeIssuedAt) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [defect?.noticeIssuedAt]);

  const update = useRecordPatch<Defect>({
    record: defect,
    setRecord: setDefect,
    write: (next, patch) => updateDefect(next.id, patch),
    what: 'defect notice',
    reload: load,
  });

  if (!defect) return <RecordGate missing={missing} what="defect notice" failed={failed} onRetry={() => { void load(); }} />;

  const isCritical = isQldCriticalDefect(!!defect.qldLimbInoperable, !!defect.qldLimbAdverseImpact);
  const dueAt = criticalNoticeDueAt(defect.raisedAt);
  const remainingMs = dueAt ? Date.parse(dueAt) - Date.now() : 0;
  const overdue = remainingMs < 0;
  const hours = Math.floor(Math.abs(remainingMs) / 3_600_000);
  const minutes = Math.floor((Math.abs(remainingMs) % 3_600_000) / 60_000);

  /**
   * Tells the Simpro job what this screen has established about the defect.
   *
   * Hand-over is the moment to do it, and it is the only moment on this screen.
   * Everything a technician fills in here -- the extent of the impairment, the
   * interim measures, who was told verbally and when -- goes through `update`,
   * which writes once per keystroke; reporting from there would put one note on
   * the job per letter typed. So the typing accumulates on the row and one note
   * goes up when the notice actually changes hands, carrying all of it.
   *
   * Handing the notice over is a reportable fact in its own right, which it was
   * not when this screen was first written. `noticeIssuedAt` and
   * `noticeRecipient` are both in the note's key material and both have a line
   * in its body, so a notice given on a defect that changed in no other way
   * still moves the key and still sends. That matters more than it looks: the
   * handover is usually the ONLY thing that changed that day, and it is the fact
   * a regulator asks about after a fire, because the 24 hour clock in the
   * Queensland provisions runs from it. Before those two fields were in the key
   * the send loop read its own earlier note back off the job, called this one a
   * duplicate and dropped it, so the office was never told at all.
   *
   * No maintenance instant is passed, so `queueDefectNote` falls back to the
   * moment the defect was raised -- which is the same instant this screen already
   * uses for the notice's own 24 hour and one month clocks a few lines above. Two
   * different answers to that question would state two different statutory
   * deadlines and go up as two notes.
   */
  const reportToOffice = async () => {
    try {
      const fresh = await getDefect(defect.id);
      // Deleted underneath us from another handset. Nothing to report.
      if (!fresh) return;
      // The site name is outside both halves of the note's key, so handing it
      // over saves the queue a read and cannot fork one defect into two notes.
      const { queued } = await queueDefectNote(fresh, undefined, { siteName: site?.name });
      // Trimmed to nothing counts as no job rather than printing as "Job    ".
      setReport(describeDefectReport({
        occasion: 'notice issued',
        jobId: fresh.jobId?.trim() || undefined,
        queued,
      }));
    } catch (e) {
      setReport({
        tone: 'warn',
        title: 'The office has not been told',
        body: describeActionFailure(e, 'queueing the note for the office'),
      });
    }
  };

  const issue = async () => {
    if (!site) return;
    setBusy(true);
    try {
      const prefs = await loadPrefs();
      const now = nowIso();
      const rectifyBy = rectificationDueAt(defect.raisedAt) ?? undefined;

      const html = criticalDefectNoticeHtml({
        site,
        defect: { ...defect, rectificationDueAt: rectifyBy },
        technicianName: prefs.technicianName,
        technicianLicence: prefs.technicianLicence,
        companyName: prefs.companyName,
        occupierName: occupier.trim() || undefined,
        maintenanceAt: defect.raisedAt,
        generatedAt: now,
      });

      const file = await writePdf(`Critical Defect Notice - ${site.name}`, html);
      const shared = await shareFile(file, 'Critical defect notice');

      /*
       * Only record it as issued once it has actually been handed over — and
       * say so when it was not. This branch used to end here: no share sheet
       * meant no notice, no record and not a word, on the one document in the
       * app that has twenty-four hours on it.
       */
      if (!shared) {
        const notice = notSharedNotice(file.name, 'notice');
        showAlert(
          notice.title,
          `${notice.body}\n\nNothing has been recorded as issued, because nobody has been given it yet.`,
        );
        return;
      }

      const recipient = occupier.trim() || undefined;
      /*
       * The first hand-over is the statutory event, and whether the notice
       * was given inside the 24 hours is judged against it — so a reissue
       * does not write over that date. It is still a fact worth keeping, so
       * it goes in the notes.
       */
      const reissue = defect.noticeIssuedAt
        ? `Notice reissued ${qldMoment(now) ?? now}${recipient ? ` to ${recipient}` : ''}.`
        : undefined;
      await update({
        noticeIssuedAt: defect.noticeIssuedAt ?? now,
        noticeRecipient: recipient,
        rectificationDueAt: rectifyBy,
        ...(reissue ? { notes: [defect.notes?.trim(), reissue].filter(Boolean).join('\n') } : {}),
      });
      await reportToOffice();
    } catch (e) {
      showAlert('Could not create the notice', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Critical defect notice' }} />
      <Screen>
        {defect.noticeIssuedAt ? (
          <Banner
            tone="pass"
            title="Notice issued"
            body={`Given ${formatAuDate(defect.noticeIssuedAt)}${defect.noticeRecipient ? ` to ${defect.noticeRecipient}` : ''}. Rectification due ${formatAuDate(defect.rectificationDueAt)}.`}
          />
        ) : (
          <View
            style={{
              backgroundColor: overdue ? t.color.failBg : t.color.warnBg,
              borderRadius: t.radius.lg,
              borderLeftWidth: 4,
              borderLeftColor: overdue ? t.color.fail : t.color.warn,
              padding: t.space(4),
              gap: 2,
            }}
          >
            <Rowed gap={2}>
              <MaterialCommunityIcons name="clock-alert-outline" size={18} color={overdue ? t.color.fail : t.color.warn} />
              <Txt weight="700" tone={overdue ? 'fail' : 'warn'}>
                {overdue ? 'NOTICE OVERDUE' : 'NOTICE DUE'}
              </Txt>
            </Rowed>
            <Txt size="xxl" weight="700" mono tone={overdue ? 'fail' : 'warn'}>
              {overdue ? '+' : ''}{hours}h {String(minutes).padStart(2, '0')}m
            </Txt>
            <Txt size="sm" tone="muted">
              {overdue
                ? 'The 24 hour period has passed. Issue the notice now and record why it was late.'
                : 'The occupier must be given a written notice within 24 hours of the maintenance.'}
            </Txt>
          </View>
        )}

        <Card>
          <Label>Defect</Label>
          <Txt weight="700" style={{ marginTop: 4 }}>{defect.location}</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>{defect.description}</Txt>
          <Divider />
          <Txt size="xs" tone="faint">Identified {formatAuDate(defect.raisedAt)}</Txt>
        </Card>

        <H2>How AS 1851 classifies it</H2>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          The technical classification, which carries its own notification and rectification
          expectations. It is not the Queensland test below, and the two can disagree.
        </Txt>
        <Card>
          <Segmented
            value={defect.as1851Class ?? 'non-critical'}
            onChange={(v) => update({ as1851Class: v })}
            options={(Object.keys(AS1851_CLASS_LABEL) as As1851Class[])
              .map((k) => ({ value: k, label: AS1851_CLASS_LABEL[k] }))}
          />
          <View style={{ height: t.space(2.5) }} />
          <Rowed gap={2} align="flex-start">
            <Txt size="xs" tone="faint" style={{ width: 62 }}>Notify</Txt>
            <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>
              {AS1851_CLASS_OBLIGATION[defect.as1851Class ?? 'non-critical'].notify}
            </Txt>
          </Rowed>
          <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
            <Txt size="xs" tone="faint" style={{ width: 62 }}>Rectify</Txt>
            <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>
              {AS1851_CLASS_OBLIGATION[defect.as1851Class ?? 'non-critical'].rectify}
            </Txt>
          </Rowed>
        </Card>

        <H2>Is this a critical defect in Queensland?</H2>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Both limbs must be true. This is a different test from the AS 1851 classification, so answer it on its own terms.
        </Txt>

        <Card>
          <Txt size="sm" style={{ lineHeight: 20 }}>
            (a) The defect is likely to render the installation inoperable
          </Txt>
          <View style={{ height: t.space(2) }} />
          <Segmented
            value={defect.qldLimbInoperable ? 'yes' : 'no'}
            onChange={(v) => update({ qldLimbInoperable: v === 'yes' })}
            options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
          />
          <Divider />
          <Txt size="sm" style={{ lineHeight: 20 }}>
            (b) It is reasonably likely to have a significant adverse impact on the safety of occupants of part or all of
            the building if a fire or hazardous materials emergency happens
          </Txt>
          <View style={{ height: t.space(2) }} />
          <Segmented
            value={defect.qldLimbAdverseImpact ? 'yes' : 'no'}
            onChange={(v) => update({ qldLimbAdverseImpact: v === 'yes' })}
            options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
          />
        </Card>

        {isCritical ? (
          <Banner
            tone="fail"
            title="Both limbs are met — a notice is required"
            body="The occupier must be given a written notice within 24 hours, and has one month from the maintenance to rectify."
          />
        ) : (
          <Banner
            tone="info"
            title="Not a Queensland critical defect"
            body="Only one limb is met, so the statutory notice does not apply. It still has to be reported and rectified — record it in the service record and the yearly condition report."
          />
        )}

        <H2>Details for the notice</H2>
        <Field
          label="Extent of impairment"
          value={defect.extentOfImpairment ?? ''}
          onChangeText={(v) => update({ extentOfImpairment: v })}
          multiline
          placeholder="Which zones, floors or devices are affected"
        />
        <Field
          label="Interim measures"
          value={defect.interimMeasures ?? ''}
          onChangeText={(v) => update({ interimMeasures: v })}
          multiline
          placeholder="e.g. Hourly fire watch by site security until rectified"
        />
        <Field label="Occupier or responsible person" value={occupier} onChangeText={setOccupier} autoCapitalize="words" />

        <H2>Verbal notification</H2>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          A critical defect should be raised verbally before leaving site, ahead of the written notice.
        </Txt>
        <Field
          label="Told to"
          value={defect.verbalNotifiedTo ?? ''}
          onChangeText={(v) => update({ verbalNotifiedTo: v, verbalNotifiedAt: v ? (defect.verbalNotifiedAt ?? nowIso()) : undefined })}
          autoCapitalize="words"
        />
        {defect.verbalNotifiedAt ? (
          <Txt size="xs" tone="pass">Recorded {formatAuDate(defect.verbalNotifiedAt)}</Txt>
        ) : null}

        {/*
          * Said where the site could not be read, rather than leaving a live
          * button that silently does nothing. The notice prints the site's
          * name and address: without them there is no document to hand over.
          */}
        {isCritical && !site ? (
          <Banner
            tone="fail"
            title={failed ? 'The site could not be read' : 'This defect has no site on this phone'}
            body={'A critical defect notice prints the building it is about — its name and its address — so it '
              + 'cannot be made without one. '
              + (failed
                ? 'Nothing is wrong with your sites; this phone could not read them just now. Pull down to try again.'
                : 'Sync, or open the defect from the site it belongs to.')}
          />
        ) : null}
        <Button
          title={defect.noticeIssuedAt ? 'Reissue notice' : 'Create and hand over notice'}
          onPress={issue}
          loading={busy}
          disabled={!isCritical || !site}
        />
        {report ? <Banner tone={report.tone} title={report.title} body={report.body} /> : null}

        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          This carries the same information as the regulator's approved form so it can be handed over on site
          immediately. It is not itself the approved form — obtain that from the Queensland Fire Department and lodge it
          as required, and attach both to the annual occupier statement with evidence of rectification.
        </Txt>
      </Screen>
    </>
  );
}
