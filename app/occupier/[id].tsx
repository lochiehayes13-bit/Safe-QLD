import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { qldIsoDay } from '@/domain/qldTime';
import { formatAuDate } from '@/export/sheets';
import { Alert, Pressable, View } from 'react-native';
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
  COMMISSIONER_COPY_BUSINESS_DAYS, citeSources, commissionerCopyDeadline, qldBusinessDaysBetween,
  toFilledRow,
} from '@/domain/occupierForm';
import {
  checkStatementAgainstRecords, contradictions, evidenceSummary, installationForSystem,
  type EvidenceProblem, type RecordedNotice,
} from '@/domain/statementEvidence';
import { occupierStatementHtml } from '@/export/occupierStatement';
import { shareFile, writePdf } from '@/export/files';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { SignaturePad } from '@/components/SignaturePad';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

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
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<OccupierStatement | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // The Commissioner date as it is being typed. Saved only once it reads as a
  // date: saving every keystroke pushed a half-written one through qldIsoDay,
  // which returned nothing, which the box then showed as empty — so it could
  // not be typed into at all.
  const [sentDraft, setSentDraft] = useState<string | null>(null);
  const sentBad = sentDraft !== null && sentDraft.trim() !== '' && !qldIsoDay(sentDraft);

  const load = useCallback(async () => {
    if (id) {
      const found = await getOccupierStatement(id);
      setRec(found);
      setMissing(!found);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const patch = async (p: Partial<OccupierStatement>) => {
    if (!rec) return;
    setRec({ ...rec, ...p });
    await updateOccupierStatement(rec.id, p);
  };

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
        `${present.size} installation${present.size === 1 ? '' : 's'} found in the register` +
        (noticed.size ? `, ${noticed.size} with a critical defect notice this period.` : '.') +
        (tickedNotHeld.length
          ? `\n\nTicked by the occupier but not in Safe QLD's register — left ticked, confirm with the occupier `
            + `whether another contractor services ${tickedNotHeld.length === 1 ? 'it' : 'them'}: ${tickedNotHeld.join('; ')}.`
          : '') +
        (notHeld.length
          ? `\n\nNot in Safe QLD's register — check these with the occupier: ${notHeld.join('; ')}.`
          : '') +
        (equipment.length
          ? `\n\nIn the register but not placed on a row, because the row depends on what it serves: `
            + `${equipment.join(', ')}. Place ${equipment.length === 1 ? 'it' : 'them'} by hand.`
          : '') +
        (evidence.unrecognised
          ? `\n\n${evidence.unrecognised} asset${evidence.unrecognised === 1 ? '' : 's'} of a type the app did not recognise `
            + `${evidence.unrecognised === 1 ? 'was' : 'were'} not counted.`
          : '') +
        (!evidence.total
          ? '\n\nThe register holds no equipment for this site, so nothing was proposed from it.'
          : '') +
        (unplaced.length
          ? `\n\n${unplaced.length} critical defect${unplaced.length === 1 ? '' : 's'} could not be `
            + `put against a row and ${unplaced.length === 1 ? 'is' : 'are'} not on the form: `
            + `${unplaced.join('; ')}. Place ${unplaced.length === 1 ? 'it' : 'them'} by hand.`
          : ''),
      );
    } catch (e) {
      Alert.alert('Could not prefill', e instanceof Error ? e.message : String(e));
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
  const exportPdf = async () => {
    if (!rec) return;
    setExporting(true);
    try {
      const prefs = await loadPrefs();
      const html = occupierStatementHtml({
        statement: rec,
        companyName: prefs.companyName,
        preparedBy: prefs.technicianName || undefined,
        generatedAt: nowIso(),
      });
      const name = `occupier-statement-${(rec.premisesName || 'premises').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
      const file = await writePdf(name, html);
      await shareFile(file, 'Occupier statement');
    } catch (e) {
      Alert.alert('Could not produce the statement', e instanceof Error ? e.message : String(e));
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

  if (!rec) return <RecordGate missing={missing} what="occupier statement" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Occupier statement' }} />
      <Screen>
        <Banner
          tone="info"
          title="This is the occupier's declaration, not ours"
          body="Queensland places the duty to give this statement on the occupier. We prepare it from the year's maintenance so they are signing something they can check, and a copy goes to the Commissioner within ten working days of them signing it."
        />

        {rec.sentToCommissionerAt ? (
          <Banner
            tone="pass"
            title="Copy sent to the Commissioner"
            body={`Recorded as sent on ${formatAuDate(rec.sentToCommissionerAt)}.`}
          />
        ) : (
          <CommissionerDeadline deadline={deadline} daysLeft={daysLeft} />
        )}

        <H2>Premises and occupier</H2>
        <Card>
          <Field label="Premises name" value={rec.premisesName} onChangeText={(v) => void patch({ premisesName: v })} />
          <Field label="Address" value={rec.premisesAddress} onChangeText={(v) => void patch({ premisesAddress: v })} multiline />
          <Field label="Occupier" value={rec.occupierName} onChangeText={(v) => void patch({ occupierName: v })} />
          <Field label="Phone" value={rec.occupierPhone} onChangeText={(v) => void patch({ occupierPhone: v })} />
          <Rowed gap={2}>
            <View style={{ flex: 1 }}>
              <Field label="Period from" value={rec.periodStart} onChangeText={(v) => void patch({ periodStart: v })} placeholder="YYYY-MM-DD" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Period to" value={rec.periodEnd} onChangeText={(v) => void patch({ periodEnd: v })} placeholder="YYYY-MM-DD" />
            </View>
          </Rowed>
        </Card>

        <Rowed style={{ justifyContent: 'space-between' }}>
          <H2>Prescribed installations</H2>
          <Chip label={`${presentCount} present`} tone={presentCount ? 'default' : 'warn'} />
        </Rowed>

        <Button title="Fill from this site's records" variant="secondary" onPress={prefill} loading={saving} />
        {prefilled ? <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{prefilled} Check every row — the register is our record of the site, this statement is the occupier's.</Txt> : null}

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
          <Banner tone="pass" title="Nothing outstanding" body="Every installation marked present has a standard nominated, and every notice given has a rectification date." />
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

        <Card>
          <Field
            label="Copy sent to the Commissioner on"
            value={sentDraft ?? qldIsoDay(rec.sentToCommissionerAt ?? undefined) ?? ''}
            onChangeText={(v) => {
              setSentDraft(v);
              if (v.trim() === '') { void patch({ sentToCommissionerAt: null }); return; }
              if (qldIsoDay(v)) void patch({ sentToCommissionerAt: v.trim() });
            }}
            onBlur={() => {
              // A date that reads has been saved, so the draft can go. One that
              // does not stays on screen with the hint, rather than vanishing.
              if (sentDraft === null || sentDraft.trim() === '' || qldIsoDay(sentDraft)) setSentDraft(null);
            }}
            placeholder="YYYY-MM-DD"
            hint={sentBad
              ? 'Not a date — write it as YYYY-MM-DD.'
              : deadline.due
                ? `Due ${deadline.due} — ${COMMISSIONER_COPY_BUSINESS_DAYS} business days from when the statement `
                  + 'was required to be prepared, not from when it was signed.'
                : `${COMMISSIONER_COPY_BUSINESS_DAYS} business days from when the statement was required to be prepared.`}
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
            hint="The standard nominated for this installation."
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
            <Field
              label="Rectified on"
              value={row.rectifiedDate ?? ''}
              onChangeText={(v) => onChange({ rectifiedDate: v })}
              placeholder="YYYY-MM-DD"
              hint={needsDate ? 'A notice with no rectification date will hold up the statement.' : undefined}
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
 * says which public holidays it applied and which it could not, because a
 * district show holiday it cannot know pushes the real deadline later, never
 * earlier. Work to this date and you cannot be late.
 */
function CommissionerDeadline({
  deadline,
  daysLeft,
}: {
  deadline: ReturnType<typeof commissionerCopyDeadline>;
  daysLeft: number | null;
}) {
  if (!deadline.due) {
    return (
      <Banner
        tone="info"
        title={`Copy to the Commissioner — ${COMMISSIONER_COPY_BUSINESS_DAYS} business days`}
        body={deadline.reason ?? 'Not enough is known yet to count from.'}
      />
    );
  }

  const late = daysLeft !== null && daysLeft < 0;
  const close = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
  const applied = deadline.counting?.holidaysApplied ?? [];
  const lines = [
    daysLeft === null
      ? 'The days remaining could not be counted.'
      : late
        ? `${Math.abs(daysLeft)} business day${Math.abs(daysLeft) === 1 ? '' : 's'} late. Send the copy and record the date below.`
        : `${daysLeft} business day${daysLeft === 1 ? '' : 's'} left.`,
    deadline.basis === 'signature-fallback'
      ? 'Counted from the signature because nothing else was known. That is not what section 55A(3) says — '
        + 'it counts from the day the statement was required to be prepared, so the real deadline may already have passed.'
      : `Counted from ${deadline.anchorDate ?? 'the required preparation date'}, the day the statement was required to be prepared.`,
    applied.length
      ? `Public holidays skipped: ${applied.map((h) => h.name).join(', ')}.`
      : 'No public holidays fell in the window.',
    ...(deadline.counting?.caveats ?? []),
    ...deadline.caveats,
    deadline.legalRef,
    // The rule for this app: nothing states a date without saying where the
    // date comes from and how far that source can be trusted.
    ...citeSources(deadline.sourceIds).map((src) => `${src.ref} — ${src.confidence} confidence.`),
  ];

  return (
    <Banner
      tone={late ? 'fail' : close ? 'warn' : 'info'}
      title={late
        ? `Copy to the Commissioner was due ${deadline.due}`
        : `Copy to the Commissioner due ${deadline.due}`}
      body={lines.join('\n')}
    />
  );
}
