import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getDefect, getSite, updateDefect } from '@/db/repo';
import type { Defect, Site } from '@/domain/types';
import {
  AS1851_CLASS_LABEL, AS1851_CLASS_OBLIGATION, criticalNoticeDueAt, isQldCriticalDefect,
  rectificationDueAt, type As1851Class,
} from '@/domain/qldCompliance';
import { criticalDefectNoticeHtml } from '@/export/criticalDefectNotice';
import { shareFile, writePdf } from '@/export/files';
import { formatAuDate } from '@/export/sheets';
import { qldMoment } from '@/domain/qldTime';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

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
  const [site, setSite] = useState<Site | null>(null);
  const [occupier, setOccupier] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const d = await getDefect(id);
      setDefect(d);
      setMissing(!d);
      setOccupier(d?.noticeRecipient ?? '');
      if (d) setSite(await getSite(d.siteId));
    })();
  }, [id]);

  useEffect(() => {
    if (defect?.noticeIssuedAt) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [defect?.noticeIssuedAt]);

  const update = (patch: Partial<Defect>) => {
    setDefect((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void updateDefect(next.id, patch);
      return next;
    });
  };

  if (!defect) return <RecordGate missing={missing} what="defect notice" />;

  const isCritical = isQldCriticalDefect(!!defect.qldLimbInoperable, !!defect.qldLimbAdverseImpact);
  const dueAt = criticalNoticeDueAt(defect.raisedAt);
  const remainingMs = dueAt ? Date.parse(dueAt) - Date.now() : 0;
  const overdue = remainingMs < 0;
  const hours = Math.floor(Math.abs(remainingMs) / 3_600_000);
  const minutes = Math.floor((Math.abs(remainingMs) % 3_600_000) / 60_000);

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

      // Only record it as issued once it has actually been handed over.
      if (shared) {
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
        update({
          noticeIssuedAt: defect.noticeIssuedAt ?? now,
          noticeRecipient: recipient,
          rectificationDueAt: rectifyBy,
          ...(reissue ? { notes: [defect.notes?.trim(), reissue].filter(Boolean).join('\n') } : {}),
        });
      }
    } catch (e) {
      Alert.alert('Could not create the notice', e instanceof Error ? e.message : String(e));
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

        <Button
          title={defect.noticeIssuedAt ? 'Reissue notice' : 'Create and hand over notice'}
          onPress={issue}
          loading={busy}
          disabled={!isCritical}
        />

        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          This carries the same information as the regulator's approved form so it can be handed over on site
          immediately. It is not itself the approved form — obtain that from the Queensland Fire Department and lodge it
          as required, and attach both to the annual occupier statement with evidence of rectification.
        </Txt>
      </Screen>
    </>
  );
}
