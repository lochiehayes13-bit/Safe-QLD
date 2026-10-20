import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { qldIsoDay } from '@/domain/qldTime';
import { formatAuDate } from '@/export/sheets';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  getOccupierStatement, updateOccupierStatement, type OccupierRow, type OccupierStatement,
} from '@/db/occupierRepo';
import { queryAssets } from '@/db/assetRepo';
import { listDefects } from '@/db/repo';
import { assetTypeById } from '@/seed/assetTypes';
import { occupierStatementIssues } from '@/domain/qldCompliance';
import { occupierEvidenceFromAssets, prefillOccupierRows } from '@/domain/formsFromAssets';
import {
  COMMISSIONER_COPY_BUSINESS_DAYS, commissionerCopyDeadline, qldBusinessDaysBetween, toFilledRow,
} from '@/domain/occupierForm';
import { dayBox, readDayBox } from '@/domain/dayEntry';
import {
  checkStatementAgainstRecords, contradictions, evidenceSummary, installationForSystem,
  type EvidenceProblem, type RecordedNotice,
} from '@/domain/statementEvidence';
import { occupierStatementHtml } from '@/export/occupierStatement';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { SignaturePad } from '@/components/SignaturePad';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { safeFileName } from '@/export/fileNames';
import { JobFileCard } from '@/components/JobFileCard';
import { useRecordPatch } from '@/hooks/useRecordPatch';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * The annual occupier statement.
 *
 * Queensland puts this duty on the occupier, not on us — which in practice
 * means someone who does not know what a prescribed installation is has to
 * declare, installation by installation, that each one was maintained. So the
 * useful thing this screen can do is arrive already filled in from the year's
 * own work: which installations the site actually has, and which of them had a
 * critical defect notice issued against them.
 *
 * It proposes; it does not assert. Every prefilled row can be changed, because
 * the register is our record of the site and the statement is theirs.
 */
export default function OccupierStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<OccupierStatement | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const found = await getOccupierStatement(id);
      setRec(found);
      setMissing(!found);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this occupier statement'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const patch = useRecordPatch<OccupierStatement>({
    record: rec,
    setRecord: setRec,
    write: (next, p) => updateOccupierStatement(next.id, p),
    what: 'occupier statement',
    reload: load,
  });

  const setRow = (installation: string, p: Partial<OccupierRow>) => {
    if (!rec) return;
    void patch({
      rows: rec.rows.map((r) => (r.installation === installation ? { ...r, ...p } : r)),
    });
  };

  /**
   * Fills the list from the site's own register and defect history.
   *
   * An installation is proposed as present when the register holds equipment
   * for it; a row the register cannot speak to — lifts, air handling, fire
   * mains — is left as the occupier had it. So is a row the register holds
   * nothing for: the register is the equipment Safe QLD services, not the
   * building's installation list, and a panel another contractor maintains
   * must not be struck from a statement to the Commissioner because it is
   * not on our file. Those rows are named for checking instead. The dates
   * the register holds go on the row beside the answer, so the occupier is
   * signing against a last-test date rather than a memory. A critical defect
   * against a system inside the period marks the notice column. Nothing is
   * ticked that the site's own data does not support.
   */
  const prefill = async () => {
    if (!rec) return;
    setSaving(true);
    try {
      const [assets, defects] = await Promise.all([
        queryAssets({ siteId: rec.siteId, limit: 5000 }),
        listDefects(rec.siteId),
      ]);

      const evidence = occupierEvidenceFromAssets(assets);
      const present = new Set(
        evidence.installations.filter((e) => e.knowledge === 'present').map((e) => e.installation),
      );
      const absent = evidence.installations.filter((e) => e.knowledge === 'absent').map((e) => e.installation);
      // Ticked by the occupier and not on our file: left ticked, and named,
      // because it may well be another contractor's equipment.
      const tickedNotHeld = absent.filter((name) => rec.rows.find((r) => r.installation === name)?.present);
      const notHeld = absent.filter((name) => !tickedNotHeld.includes(name));

      const inPeriod = (iso?: string | null) => {
        // The Queensland day, not the UTC one: a notice given at eight on a
        // Brisbane morning is still the day before in UTC.
        const d = qldIsoDay(iso ?? undefined);
        if (!d) return false;
        if (rec.periodStart && d < rec.periodStart) return false;
        if (rec.periodEnd && d > rec.periodEnd) return false;
        return true;
      };

      const noticed = new Map<string, string | undefined>();
      /*
       * Critical defects the prefill could not file against a row.
       *
       * These used to be skipped without a word. A fire pumpset that will not
       * start fails both limbs of the Queensland critical test, has no Schedule
       * 2 row of its own — it belongs to whichever installation it feeds — and
       * so fell straight through, leaving a statement that said no notice was
       * issued over a record of one. Named now, so the occupier places it by
       * hand instead of never seeing it.
       */
      const unplaced: string[] = [];
      for (const d of defects) {
        if (d.severity !== 'critical' || !inPeriod(d.noticeIssuedAt ?? d.raisedAt)) continue;
        const system = d.pointId
          ? assetTypeById(assets.find((a) => a.id === d.pointId)?.assetTypeId ?? '')?.system
          : undefined;
        const placed = system ? installationForSystem(system) : undefined;
        const installation = placed?.installation;
        if (!installation) {
          unplaced.push([d.location?.trim(), d.description?.trim()].filter(Boolean).join(' — ')
            || 'a critical defect');
          continue;
        }
        // Keep the latest rectification we know of, so a row that was fixed
        // shows a date rather than an unanswered notice.
        const existing = noticed.get(installation);
        const rectified = qldIsoDay(d.rectifiedAt ?? undefined);
        noticed.set(installation, !existing || (rectified && rectified > existing) ? rectified : existing);
      }

      const rows = prefillOccupierRows(rec.rows, evidence).map((r) => {
        // A notice the register knows of is ticked whether or not the register
        // knows the installation is there: the defect was recorded against
        // this site, and an occupier who unticks it is contradicting our file.
        const hadNotice = r.criticalDefectNoticeGiven || noticed.has(r.installation);
        return {
          ...r,
          present: r.present || noticed.has(r.installation),
          criticalDefectNoticeGiven: hadNotice,
          rectifiedDate: r.rectifiedDate || noticed.get(r.installation) || undefined,
        };
      });

      await patch({ rows });
      const equipment = evidence.unplaced.map((u) => `${u.count} ${u.label.toLowerCase()}${u.count === 1 ? '' : 's'}`);
      setPrefilled(
        `${present.size} installation${present.size === 1 ? '' : 's'} on our register` +
        (noticed.size ? `, ${noticed.size} with a critical defect notice.` : '.') +
        (tickedNotHeld.length
          ? `\n\nTicked but not on our register, left ticked. Check with the occupier: ${tickedNotHeld.join('; ')}.`
          : '') +
        (notHeld.length
          ? `\n\nNot on our register. Check with the occupier: ${notHeld.join('; ')}.`
          : '') +
        (equipment.length
          ? `\n\nPlace by hand: ${equipment.join(', ')}.`
          : '') +
        (evidence.unrecognised
          ? `\n\n${evidence.unrecognised} asset${evidence.unrecognised === 1 ? '' : 's'} of an unknown type not counted.`
          : '') +
        (!evidence.total
          ? '\n\nNo equipment on our register for this site.'
          : '') +
        (unplaced.length
          ? `\n\nCritical defect${unplaced.length === 1 ? '' : 's'} not on a row. Place by hand: ${unplaced.join('; ')}.`
          : ''),
      );
    } catch (e) {
      showAlert('Not filled', describeActionFailure(e, 'fill from the site records'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Produces the statement as a PDF.
   *
   * Deliberately allowed while issues remain: an occupier reading a draft with
   * "not nominated" printed against a row is how the gap gets filled. The
   * document itself carries the warning, so an unfinished one cannot be
   * mistaken for a complete one.
   */
  /*
   * One builder for the statement, so the copy that is shared and the copy the
   * office receives are the same document.
   */
  const statementPdf = useCallback(async () => {
    if (!rec) throw new Error('The statement is not loaded.');
    const prefs = await loadPrefs();
    const html = occupierStatementHtml({
      statement: rec,
      companyName: prefs.companyName,
      preparedBy: prefs.technicianName || undefined,
      generatedAt: nowIso(),
    });
    const name = `occupier-statement-${(rec.premisesName || 'premises').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    return writePdf(name, html);
  }, [rec]);

  const exportPdf = async () => {
    if (!rec) return;
    setExporting(true);
    try {
      const file = await statementPdf();
      const shared = await shareFile(file, 'Occupier statement');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'statement');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Statement not printed', describeActionFailure(e, 'print the statement'));
    } finally {
      setExporting(false);
    }
  };

  const issues = useMemo(() => (rec ? occupierStatementIssues(rec.rows) : []), [rec]);

  /*
   * The statement checked against Safe QLD's own file.
   *
   * The prefill proposes; the occupier can then change any answer, and until
   * now nothing looked again. A row prefilled Yes from a recorded notice and
   * then switched to No was signed and sent saying the opposite of what this
   * company recorded and handed to that occupier.
   *
   * Loaded separately from the prefill because it has to be true of the
   * statement as it stands now, not as it was when somebody last pressed a
   * button.
   */
  const [evidence, setEvidence] = useState<EvidenceProblem[]>([]);
  // Keyed on what the check reads, not on the record. `patch` replaces the
  // record on every keystroke, so keyed on the record this re-read two
  // thousand assets for each character typed into the occupier's phone number.
  const rowsKey = JSON.stringify(rec?.rows ?? []);
  useEffect(() => {
    if (!rec) return;
    let live = true;
    void (async () => {
      try {
        const [assets, defects] = await Promise.all([
          queryAssets({ siteId: rec.siteId }),
          listDefects(rec.siteId),
        ]);
        const notices: RecordedNotice[] = defects
          .filter((d) => d.severity === 'critical' && d.noticeIssuedAt)
          .map((d) => ({
            defectId: d.id,
            noticeIssuedAt: d.noticeIssuedAt!,
            system: d.pointId
              ? assetTypeById(assets.find((a) => a.id === d.pointId)?.assetTypeId ?? '')?.system
              : undefined,
            rectifiedAt: d.rectifiedAt ?? undefined,
            location: d.location,
            description: d.description,
          }));
        const problems = checkStatementAgainstRecords(
          {
            periodStart: rec.periodStart,
            periodEnd: rec.periodEnd,
            rows: rec.rows.map(toFilledRow),
          },
          notices,
        );
        if (live) setEvidence(problems);
      } catch {
        // A statement that cannot be checked is not a statement that is wrong.
        // The banner simply does not appear; every other check still runs.
        if (live) setEvidence([]);
      }
    })();
    return () => { live = false; };
  }, [rec?.siteId, rec?.periodStart, rec?.periodEnd, rowsKey]);
  const presentCount = rec?.rows.filter((r) => r.present).length ?? 0;

  /*
   * Section 55A(3) counts from the day the occupier is *required to prepare*
   * the statement, not from the day they sign it. Those are the same date only
   * for an occupier who signs exactly on their anniversary — sign a month late
   * and the ten business days have long since run, while a screen counting from
   * the signature would have shown a comfortable deadline the whole time.
   *
   * So the period end is offered as the anchor, and the signature is passed
   * only as the fallback the module labels as one.
   */
  const deadline = useMemo(() => commissionerCopyDeadline({
    requiredPreparationDate: rec?.periodEnd || undefined,
    signedDate: qldIsoDay(rec?.signedAt ?? undefined),
  }), [rec?.periodEnd, rec?.signedAt]);

  const daysLeft = useMemo(() => {
    if (!deadline.due) return null;
    const count = qldBusinessDaysBetween(qldIsoDay(nowIso()) ?? '', deadline.due);
    return count.days ?? null;
  }, [deadline.due]);

  if (!rec) return <RecordGate missing={missing} what="occupier statement" failed={failed} onRetry={() => { void load(); }} />;

  return (
    <>
      <Stack.Screen options={{ title: 'Occupier statement' }} />
      <Screen>
        <Banner
          tone="info"
          title="Occupier's declaration"
          body={`We prepare it; the occupier signs it. The Commissioner's copy is due ${COMMISSIONER_COPY_BUSINESS_DAYS} `
            + 'business days after the period end.'}
        />

        {rec.sentToCommissionerAt ? (
          <Banner
            tone="pass"
            title="Copy sent to the Commissioner"
            body={`On ${formatAuDate(rec.sentToCommissionerAt)}.`}
          />
        ) : (
          <CommissionerDeadline deadline={deadline} daysLeft={daysLeft} signedDay={qldIsoDay(rec.signedAt ?? undefined)} />
        )}

        <H2>Premises and occupier</H2>
        <Card>
          <Field label="Premises name" value={rec.premisesName} onChangeText={(v) => void patch({ premisesName: v })} />
          <Field label="Address" value={rec.premisesAddress} onChangeText={(v) => void patch({ premisesAddress: v })} multiline />
          <Field label="Occupier" value={rec.occupierName} onChangeText={(v) => void patch({ occupierName: v })} />
          <Field label="Phone" value={rec.occupierPhone} onChangeText={(v) => void patch({ occupierPhone: v })} />
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}>
              <DayField label="Period from" value={rec.periodStart} onChange={(day) => void patch({ periodStart: day ?? '' })} />
            </View>
            <View style={{ flex: 1 }}>
              <DayField label="Period to" value={rec.periodEnd} onChange={(day) => void patch({ periodEnd: day ?? '' })} />
            </View>
          </Rowed>
        </Card>

        <Rowed style={{ justifyContent: 'space-between' }}>
          <H2>Prescribed installations</H2>
          <Chip label={`${presentCount} present`} tone={presentCount ? 'default' : 'warn'} />
        </Rowed>

        <Button title="Fill from site records" variant="secondary" onPress={prefill} loading={saving} />
        {prefilled ? <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{prefilled}{'\n\n'}Check every row with the occupier.</Txt> : null}

        {rec.rows.map((row) => (
          <InstallationRow key={row.installation} row={row} onChange={(p) => setRow(row.installation, p)} />
        ))}

        {evidence.length ? (
          <Banner
            tone={contradictions(evidence).length ? 'fail' : 'warn'}
            title={evidenceSummary(evidence) ?? ''}
            body={evidence.map((p) => p.message).join('\n\n')}
          />
        ) : null}

        <H2>Signature</H2>
        {issues.length ? (
          <Banner
            tone="warn"
            title={`${issues.length} thing${issues.length === 1 ? '' : 's'} to resolve before signing`}
            body={issues.join('\n')}
          />
        ) : (
          <Banner tone="pass" title="Ready to sign" body="Every row is complete." />
        )}

        <Card>
          <Field label="Signed by" value={rec.signedBy} onChangeText={(v) => void patch({ signedBy: v })} />
          <Field label="Position held" value={rec.signedPosition} onChangeText={(v) => void patch({ signedPosition: v })} />
          <SignaturePad
            label="Signature"
            value={rec.signature ?? undefined}
            onChange={(sig) => void patch({ signature: sig, signedAt: sig ? (rec.signedAt ?? nowIso()) : null })}
          />
          {rec.signedAt ? <Txt size="xs" tone="faint">Signed {formatAuDate(rec.signedAt)}</Txt> : null}
        </Card>

        <Button
          title={issues.length ? 'Print the draft for the occupier' : 'Print the statement'}
          onPress={exportPdf}
          loading={exporting}
        />

        <JobFileCard
          siteId={rec.siteId}
          jobExternalId={rec.jobExternalId ?? undefined}
          jobTitle={rec.jobTitle ?? undefined}
          attachedAt={rec.attachedAt ?? undefined}
          what="occupier statement"
          filename={`${safeFileName(`Occupier statement ${rec.premisesName || 'premises'}`, 'occupier-statement')}.pdf`}
          subject={`Occupier statement — ${rec.premisesName || 'premises'}`}
          buildFile={statementPdf}
          onPickJob={(job) => patch({ jobExternalId: job?.externalId ?? null, jobTitle: job?.title ?? null })}
          onAttached={(at) => patch({ attachedAt: at })}
          disabled={!rec.signedAt}
          disabledWhy="Attach after the occupier signs."
        />

        <Card>
          {/*
            * Saved only once what is typed reads as a date: saving every
            * keystroke pushed a half-written one through as nothing, which the
            * box then showed as empty, so it could not be typed into at all.
            */}
          <DayField
            label="Sent to the Commissioner"
            value={rec.sentToCommissionerAt ?? undefined}
            onChange={(day) => void patch({ sentToCommissionerAt: day })}
            hint={deadline.due ? `Due ${formatAuDate(deadline.due)}.` : undefined}
          />
        </Card>
      </Screen>
    </>
  );
}

function InstallationRow({
  row, onChange,
}: {
  row: OccupierRow;
  onChange: (p: Partial<OccupierRow>) => void;
}) {
  const t = useTheme();
  const needsDate = row.criticalDefectNoticeGiven && !row.rectifiedDate?.trim();
  // What the register holds for this row, where the prefill found any. Shown
  // as a line rather than a field: it is ours to report, not theirs to edit.
  const register = [
    row.lastMaintainedDate ? `last tested ${formatAuDate(row.lastMaintainedDate)}` : null,
    row.nextDueDate ? `next due ${formatAuDate(row.nextDueDate)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card>
      <Pressable onPress={() => onChange({ present: !row.present })}>
        <Rowed gap={2} align="center">
          <MaterialCommunityIcons
            name={row.present ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={24}
            color={row.present ? t.color.accent : t.color.textFaint}
          />
          <Txt weight={row.present ? '700' : '400'} tone={row.present ? undefined : 'muted'} style={{ flex: 1, lineHeight: 20 }}>
            {row.installation}
          </Txt>
        </Rowed>
      </Pressable>

      {row.present ? (
        <View style={{ marginTop: t.space(2.5), gap: t.space(2) }}>
          <Divider />
          {register ? <Txt size="xs" tone="muted">Register: {register}</Txt> : null}
          <Field
            label="Maintained to"
            value={row.nominatedStandard ?? ''}
            onChangeText={(v) => onChange({ nominatedStandard: v })}
            placeholder="e.g. AS 1851-2012"
          />
          <Pressable onPress={() => onChange({ criticalDefectNoticeGiven: !row.criticalDefectNoticeGiven })}>
            <Rowed gap={2} align="center">
              <MaterialCommunityIcons
                name={row.criticalDefectNoticeGiven ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={22}
                color={row.criticalDefectNoticeGiven ? t.color.fail : t.color.textFaint}
              />
              <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>A critical defect notice was given for this installation</Txt>
            </Rowed>
          </Pressable>
          {row.criticalDefectNoticeGiven ? (
            <DayField
              label="Rectified on"
              value={row.rectifiedDate}
              onChange={(day) => onChange({ rectifiedDate: day ?? undefined })}
              hint={needsDate ? 'Needed before signing.' : undefined}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * The commissioner's copy deadline, showing its working.
 *
 * The date alone is not enough on this one. Section 55A(3) counts from the day
 * the statement was *required to be prepared*, and an occupier who signs late
 * has a deadline that has already run — so the screen says which date it
 * counted from and whether that was the statutory anchor or a fallback. It also
 * says which public holidays it applied. A district show holiday it cannot know
 * pushes the real deadline later, never earlier. Work to this date and you
 * cannot be late.
 */
function CommissionerDeadline({
  deadline,
  daysLeft,
  signedDay,
}: {
  deadline: ReturnType<typeof commissionerCopyDeadline>;
  daysLeft: number | null;
  signedDay?: string;
}) {
  if (!deadline.due) {
    return (
      <Banner
        tone="info"
        title={`Copy to the Commissioner: ${COMMISSIONER_COPY_BUSINESS_DAYS} business days`}
        body={deadline.anchorDate
          ? `No public holidays on file for that year. Count ${COMMISSIONER_COPY_BUSINESS_DAYS} business days from `
            + `${formatAuDate(deadline.anchorDate)}.`
          : 'Set the period end to see the due date.'}
      />
    );
  }

  const late = daysLeft !== null && daysLeft < 0;
  const close = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
  const applied = deadline.counting?.holidaysApplied ?? [];
  const lines = [
    daysLeft === null
      ? null
      : late
        ? `${Math.abs(daysLeft)} business day${Math.abs(daysLeft) === 1 ? '' : 's'} late. Send it and record the date below.`
        : `${daysLeft} business day${daysLeft === 1 ? '' : 's'} left.`,
    deadline.basis === 'signature-fallback'
      ? 'Counted from the signature. Set the period end for the real deadline.'
      : `Counted from the period end, ${formatAuDate(deadline.anchorDate)}.`,
    deadline.basis === 'statutory' && signedDay && deadline.anchorDate && signedDay > deadline.anchorDate
      ? 'Signed late: the clock still runs from the period end.'
      : null,
    applied.length ? `Public holidays skipped: ${applied.map((h) => h.name).join(', ')}.` : null,
    deadline.legalRef,
  ].filter((l): l is string => Boolean(l));

  return (
    <Banner
      tone={late ? 'fail' : close ? 'warn' : 'info'}
      title={late
        ? `Copy to the Commissioner was due ${formatAuDate(deadline.due)}`
        : `Copy to the Commissioner due ${formatAuDate(deadline.due)}`}
      body={lines.join('\n')}
    />
  );
}

/**
 * A date box: dd/mm/yyyy on screen, the ISO day stored.
 *
 * What is typed stays in the box as typed and is stored only once it reads as
 * a day; an emptied box stores null.
 */
function DayField({
  label, value, onChange, hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (day: string | null) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const read = draft === null ? null : readDayBox(draft);
  return (
    <Field
      label={label}
      value={draft ?? dayBox(value)}
      onChangeText={(v) => {
        setDraft(v);
        const next = readDayBox(v);
        if ('day' in next) onChange(next.day);
      }}
      onBlur={() => { if (read && !('why' in read)) setDraft(null); }}
      placeholder="dd/mm/yyyy"
      keyboardType="numeric"
      hint={read && 'why' in read ? read.why : hint}
    />
  );
}
