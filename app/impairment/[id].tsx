import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  getImpairment, impairmentElapsedMs, impairmentOutstanding, updateImpairment,
  type ImpairmentRecord,
} from '@/db/opsRepo';
import { getSite } from '@/db/repo';
import type { Site } from '@/domain/types';
import { nowIso } from '@/db';
import { qldMoment } from '@/domain/qldTime';
import { loadPrefs } from '@/app-prefs';
import { impairmentNoticeHtml } from '@/export/impairmentNotice';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { safeFileName } from '@/export/fileNames';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { JobFileCard } from '@/components/JobFileCard';
import { useRecordPatch } from '@/hooks/useRecordPatch';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Live impairment.
 *
 * The elapsed timer is the whole point — an impairment that has been running
 * eleven hours reads very differently from one declared twenty minutes ago, and
 * a number that does not move gets ignored.
 */
export default function ImpairmentScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<ImpairmentRecord | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [prefs, setPrefs] = useState({ companyName: '', technicianName: '', licence: '' });
  const [busy, setBusy] = useState(false);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const found = await getImpairment(id);
      setRec(found);
      setMissing(!found);
      if (found) {
        const [s, p] = await Promise.all([getSite(found.siteId), loadPrefs()]);
        setSite(s);
        setPrefs({
          companyName: p.companyName,
          technicianName: p.technicianName,
          licence: p.technicianLicence,
        });
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this impairment'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (rec?.restoredAt) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [rec?.restoredAt]);

  const update = useRecordPatch<ImpairmentRecord>({
    record: rec,
    setRecord: setRec,
    write: (next, patch) => updateImpairment(next.id, patch),
    what: 'impairment record',
    reload: load,
  });

  /*
   * The notice, built the same way for every route out of the screen.
   *
   * Share, hand-to-the-occupier and file-on-the-job all print exactly the same
   * document, because a technician who hands over one thing and the office who
   * receives another is the worst outcome this screen can produce.
   */
  const notice = useCallback(async () => {
    if (!rec || !site) throw new Error('The impairment is not loaded.');
    const html = impairmentNoticeHtml({
      record: rec,
      site,
      companyName: prefs.companyName,
      technicianName: prefs.technicianName || rec.technician,
      technicianLicence: prefs.licence,
      generatedAt: nowIso(),
    });
    return writePdf(`Impairment notice ${site.name}`.trim(), html);
  }, [rec, site, prefs]);

  const shareNotice = useCallback(async () => {
    setBusy(true);
    try {
      const file = await notice();
      const shared = await shareFile(file, 'Impairment notice');
      if (!shared) {
        const said = notSharedNotice(file.name, 'impairment notice');
        showAlert(said.title, said.body);
      }
    } catch (e) {
      showAlert('Could not produce the notice', describeActionFailure(e, 'producing the impairment notice'));
    } finally {
      setBusy(false);
    }
  }, [notice]);

  if (!rec) return <RecordGate missing={missing} what="impairment record" failed={failed} onRetry={() => { void load(); }} />;

  const ms = impairmentElapsedMs(rec);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const outstanding = impairmentOutstanding(rec);
  const restored = !!rec.restoredAt;

  const close = () => {
    if (outstanding.length) {
      showAlert(
        'Still outstanding',
        `${outstanding.join('\n')}\n\nClose anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close anyway', style: 'destructive', onPress: () => update({ restoredAt: nowIso() }) },
        ],
      );
      return;
    }
    update({ restoredAt: nowIso() });
  };

  return (
    <>
      <Stack.Screen options={{ title: restored ? 'Impairment closed' : 'System impaired' }} />
      <Screen>
        <View
          style={{
            backgroundColor: restored ? t.color.passBg : t.color.failBg,
            borderRadius: t.radius.lg,
            borderLeftWidth: 4,
            borderLeftColor: restored ? t.color.pass : t.color.fail,
            padding: t.space(4),
            gap: t.space(1),
          }}
        >
          <Rowed gap={2}>
            <MaterialCommunityIcons
              name={restored ? 'check-decagram' : 'alert-octagon'}
              size={20}
              color={restored ? t.color.pass : t.color.fail}
            />
            <Txt weight="700" tone={restored ? 'pass' : 'fail'}>
              {restored ? 'RESTORED' : 'OUT OF SERVICE'}
            </Txt>
          </Rowed>
          <Txt size="display" weight="700" mono tone={restored ? 'pass' : 'fail'} style={{ letterSpacing: -1 }}>
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </Txt>
          <Txt size="sm" tone="muted">
            {restored ? 'Total time out of service' : 'Elapsed since declared'}
          </Txt>
        </View>

        <Card>
          <Label>System</Label>
          <Txt weight="700" style={{ marginTop: 2 }}>{rec.system}</Txt>
          <Divider />
          <Label>Scope</Label>
          <Txt size="sm" style={{ marginTop: 2, lineHeight: 20 }}>{rec.scope || '—'}</Txt>
          {rec.reason ? (
            <>
              <Divider />
              <Label>Reason</Label>
              <Txt size="sm" tone="muted" style={{ marginTop: 2, lineHeight: 20 }}>{rec.reason}</Txt>
            </>
          ) : null}
        </Card>

        {!restored && outstanding.length ? (
          <Banner
            tone="warn"
            title={`${outstanding.length} thing${outstanding.length === 1 ? '' : 's'} still to do`}
            body={outstanding.join('\n')}
          />
        ) : null}

        <H2>Notifications and controls</H2>
        <Card>
          <CheckRow label="Responsible person notified" on={rec.responsibleNotified} onToggle={() => update({ responsibleNotified: !rec.responsibleNotified })} />
          {rec.responsibleNotified ? (
            <View style={{ marginVertical: t.space(2) }}>
              <Field label="Who was notified" value={rec.responsibleName ?? ''} onChangeText={(v) => update({ responsibleName: v })} autoCapitalize="words" />
            </View>
          ) : null}
          <Divider />
          <CheckRow label="Monitoring provider notified" on={rec.monitoringNotified} onToggle={() => update({ monitoringNotified: !rec.monitoringNotified })} />
          <Divider />
          <CheckRow label="Fire brigade notified (where required)" on={rec.brigadeNotified} onToggle={() => update({ brigadeNotified: !rec.brigadeNotified })} />
          <Divider />
          <CheckRow label="Fire watch or alternative measures in place" on={rec.fireWatchInPlace} onToggle={() => update({ fireWatchInPlace: !rec.fireWatchInPlace })} />
          <Divider />
          <CheckRow label="Signage placed at the panel" on={rec.signagePlaced} onToggle={() => update({ signagePlaced: !rec.signagePlaced })} />
        </Card>

        <Field
          label="Alternative measures"
          value={rec.alternativeMeasures ?? ''}
          onChangeText={(v) => update({ alternativeMeasures: v })}
          multiline
          placeholder="e.g. Hourly fire watch by site security, portable extinguishers staged at stair cores"
        />
        <Field label="Notes" value={rec.notes ?? ''} onChangeText={(v) => update({ notes: v })} multiline />

        <H2>The notice</H2>
        <Card>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Ticking &ldquo;responsible person notified&rdquo; records that a conversation happened. It is not the notice.
            This is: what is off, what is being done instead, and when it goes back on, in words a building manager can
            read.
          </Txt>
          <Rowed gap={2} style={{ marginTop: t.space(3) }}>
            <Button title="Print or share" style={{ flex: 1 }} loading={busy} onPress={() => { void shareNotice(); }} />
            <Button
              title={rec.noticeIssuedAt ? 'Issued' : 'Mark as handed over'}
              variant="secondary"
              style={{ flex: 1 }}
              disabled={!!rec.noticeIssuedAt}
              onPress={() => { void update({ noticeIssuedAt: nowIso() }); }}
            />
          </Rowed>
          {rec.noticeIssuedAt ? (
            <Txt size="sm" tone="pass" style={{ marginTop: t.space(2) }}>
              Handed to {rec.responsibleName || 'the responsible person'} {qldMoment(rec.noticeIssuedAt) ?? rec.noticeIssuedAt}
            </Txt>
          ) : null}
        </Card>

        <JobFileCard
          siteId={rec.siteId}
          jobExternalId={rec.jobExternalId}
          jobTitle={rec.jobTitle}
          attachedAt={rec.attachedAt}
          what="impairment notice"
          filename={`${safeFileName(`Impairment notice ${site?.name ?? ''}`, 'impairment-notice')}.pdf`}
          subject={`Impairment — ${rec.system}${site?.name ? ` — ${site.name}` : ''}`}
          buildFile={notice}
          onPickJob={(job) => update({ jobExternalId: job?.externalId, jobTitle: job?.title })}
          onAttached={(at) => update({ attachedAt: at })}
          disabled={!site}
          disabledWhy={site ? undefined : 'The site this impairment belongs to is not on this phone yet. Sync first.'}
        />

        {!restored ? (
          <Button title="System restored — close impairment" onPress={close} />
        ) : (
          <Txt size="sm" tone="pass">Closed {qldMoment(rec.restoredAt) ?? rec.restoredAt}</Txt>
        )}
      </Screen>
    </>
  );
}

function CheckRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onToggle} style={{ paddingVertical: t.space(2) }}>
      <Rowed gap={3}>
        <MaterialCommunityIcons
          name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={24}
          color={on ? t.color.pass : t.color.textFaint}
        />
        <Txt style={{ flex: 1 }} weight={on ? '600' : '400'} tone={on ? 'default' : 'muted'}>{label}</Txt>
      </Rowed>
    </Pressable>
  );
}
