import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  SIGNED_REFUSAL, getSwms, linkSwmsJob, recordSwmsAttached, signSwms, templatesFor, updateSwms,
} from '@/db/swmsRepo';
import { SWMS_TEMPLATES } from '@/seed/swms';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
import { queueJobAttachment } from '@/simpro/sync';
import {
  CONTROL_LEVEL_LABEL, RISK_LABEL, SWMS_REVIEW_TRIGGERS, mergeSwms, orderedControls, validateSwms,
  whyNotSigned, type AddedHazard, type MergedSwms, type RiskLevel, type SwmsRecord, type SwmsWorker,
} from '@/domain/swms';
import { attachmentContentKey } from '@/domain/outboundWork';
import { qldIsoDay } from '@/domain/qldTime';
import { swmsHtml } from '@/export/swms';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { showAlert } from '@/components/alert';
import { RecordGate } from '@/components/RecordGate';
import { SignaturePad } from '@/components/SignaturePad';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, StatusPill, Txt,
} from '@/components/ui';

/**
 * The day's safe work method statement, as a crew works through it.
 *
 * Four tabs rather than one long scroll, because a statement is four different
 * jobs: agreeing what is being done, reading the steps, answering the things
 * only this site can answer, and signing. A single column ends with a crew
 * signing at the bottom having scrolled past the middle.
 *
 * The steps tab is the one that matters. Each step is a card the technician
 * opens, reads out, and ticks — and the tick is stored, so the printed page can
 * say which steps were actually read on site rather than implying all of them
 * were. A crew that has not read a step cannot sign, which is deliberately
 * inconvenient: it is the whole mechanism.
 *
 * Everything saves as it is typed. A statement half-filled in a basement
 * carpark on a phone that dies must still be there.
 *
 * Signing is a one-way door. After it, the statement is what the crew is
 * working under and what a principal contractor may hold a copy of; changing it
 * afterwards would leave two documents that disagree. What is still allowed is
 * filing it: naming the Simpro job and sending the PDF to it.
 */

type Tab = 'work' | 'steps' | 'site' | 'sign';

const TABS: { value: Tab; label: string }[] = [
  { value: 'work', label: 'The work' },
  { value: 'steps', label: 'Steps' },
  { value: 'site', label: 'This site' },
  { value: 'sign', label: 'Sign' },
];

const RISK_TONE: Record<RiskLevel, 'fail' | 'warn' | 'pass'> = {
  extreme: 'fail', high: 'fail', medium: 'warn', low: 'pass',
};

export default function SwmsRecordScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [record, setRecord] = useState<SwmsRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither.
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('work');
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [pickingJob, setPickingJob] = useState(false);
  const [newWorker, setNewWorker] = useState('');
  const [signingFor, setSigningFor] = useState<number | null>(null);
  const [companyName, setCompanyName] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const [r, prefs] = await Promise.all([getSwms(id), loadPrefs()]);
      setRecord(r);
      setMissing(!r);
      setCompanyName(prefs.companyName);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this statement'));
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const templates = useMemo(() => (record ? templatesFor(record) : []), [record]);
  const merged: MergedSwms = useMemo(() => mergeSwms(templates), [templates]);
  const locked = record?.status === 'signed';
  const issues = useMemo(() => (record ? validateSwms(record, merged) : []), [record, merged]);
  const blocking = issues.filter((i) => i.blocking);

  /**
   * Writes land immediately rather than on a save button, and the screen keeps
   * the record it just wrote rather than re-reading it — a re-read mid-typing
   * is what makes a field jump back a character on a slow phone.
   */
  const save = async (patch: Partial<SwmsRecord>) => {
    if (!record) return;
    if (locked) {
      showAlert('Already signed', SIGNED_REFUSAL);
      return;
    }
    const next = { ...record, ...patch } as SwmsRecord;
    setRecord(next);
    try {
      await updateSwms(record.id, patch);
    } catch (e) {
      showAlert('Not saved', describeActionFailure(e, 'saving the statement'));
      await load();
    }
  };

  const toggleStep = (key: string) => {
    if (!record) return;
    const ticked = record.ticked.includes(key)
      ? record.ticked.filter((k) => k !== key)
      : [...record.ticked, key];
    void save({ ticked });
  };

  const togglePpe = (item: string) => {
    if (!record) return;
    const ppeChecked = record.ppeChecked.includes(item)
      ? record.ppeChecked.filter((p) => p !== item)
      : [...record.ppeChecked, item];
    void save({ ppeChecked });
  };

  const togglePermit = (permit: string) => {
    if (!record) return;
    const permits = record.permits.some((p) => p.permit === permit)
      ? record.permits.map((p) => (p.permit === permit ? { ...p, held: !p.held } : p))
      : [...record.permits, { permit, held: true }];
    void save({ permits });
  };

  const toggleTemplate = (templateId: string) => {
    if (!record) return;
    const templateIds = record.templateIds.includes(templateId)
      ? record.templateIds.filter((x) => x !== templateId)
      : [...record.templateIds, templateId];
    // Ticks belong to the statements that were on the record when they were
    // made. Dropping a statement drops its ticks with it, rather than leaving
    // orphans that would count towards a different document's total.
    const ticked = record.ticked.filter((k) => templateIds.some((x) => k.startsWith(`${x}#`)));
    void save({ templateIds, ticked });
  };

  const sign = async () => {
    if (!record) return;
    setBusy(true);
    try {
      const signed = await signSwms(record.id);
      setRecord(signed);
      showAlert(
        'Signed',
        'Everybody on the list has signed and the statement covers today’s work at this site. '
        + 'It stays on the phone, and the PDF can go onto the Simpro job.',
      );
    } catch (e) {
      showAlert('Not signed', e instanceof Error ? e.message : describeActionFailure(e, 'signing the statement'));
    } finally {
      setBusy(false);
    }
  };

  const pdfFor = async (r: SwmsRecord) => {
    const html = swmsHtml({
      record: r,
      templates: templatesFor(r),
      preparedBy: companyName || undefined,
      generatedAt: nowIso(),
    });
    const name = `SWMS ${r.siteName ?? 'site'} ${r.date}`.replace(/[^A-Za-z0-9 .-]/g, '');
    return writePdf(name, html);
  };

  const share = async () => {
    if (!record) return;
    setBusy(true);
    try {
      const file = await pdfFor(record);
      const shared = await shareFile(file, 'Safe work method statement');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'statement');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not make the PDF', describeActionFailure(e, 'making the PDF'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Puts the signed statement on the Simpro job.
   *
   * The same queue every other attachment goes through, so it survives a flat
   * connection and the job card shows it when it lands. Only a signed statement
   * is worth filing: a draft on the job file is the thing that gets produced
   * later as evidence of a briefing that never happened.
   */
  const attach = async () => {
    if (!record?.jobExternalId) return;
    setBusy(true);
    try {
      const file = await pdfFor(record);
      const filename = `SWMS-${record.date}-${record.siteName ?? 'site'}.pdf`.replace(/[^A-Za-z0-9.-]/g, '-');
      await queueJobAttachment({
        jobId: record.jobExternalId,
        localUri: file.uri,
        filename,
        mimeType: 'application/pdf',
        subject: `Safe work method statement — ${record.siteName ?? ''} ${formatAuDate(record.date)}`.trim(),
        sizeBytes: file.size,
        key: attachmentContentKey({ jobId: record.jobExternalId, filename, sizeBytes: file.size }),
      });
      await recordSwmsAttached(record.id);
      setRecord({ ...record, attachedAt: nowIso() });
      showAlert('On its way to the job', `It goes onto Simpro job ${record.jobExternalId} with the next sync.`);
    } catch (e) {
      showAlert('Not attached', describeActionFailure(e, 'attaching it to the job'));
    } finally {
      setBusy(false);
    }
  };

  const openJobPicker = async () => {
    if (!record) return;
    setPickingJob(true);
    try {
      const today = qldIsoDay(nowIso()) ?? record.date;
      const page = await listJobPage({ filter: 'all', today, siteId: record.siteId, limit: 50 });
      setJobs(page.rows);
    } catch (e) {
      showAlert('Could not read the jobs', describeActionFailure(e, 'reading the jobs'));
    }
  };

  const linkJob = async (job: JobSummary) => {
    if (!record || !job.externalId) return;
    try {
      await linkSwmsJob(record.id, { externalId: job.externalId, title: job.title });
      setRecord({ ...record, jobExternalId: job.externalId, jobTitle: job.title });
      setPickingJob(false);
    } catch (e) {
      showAlert('Not linked', describeActionFailure(e, 'linking the job'));
    }
  };

  const addWorker = () => {
    if (!record || !newWorker.trim()) return;
    void save({ workers: [...record.workers, { name: newWorker.trim() }] });
    setNewWorker('');
  };

  const setWorker = (index: number, patch: Partial<SwmsWorker>) => {
    if (!record) return;
    void save({ workers: record.workers.map((w, i) => (i === index ? { ...w, ...patch } : w)) });
  };

  const removeWorker = (index: number) => {
    if (!record) return;
    void save({ workers: record.workers.filter((_, i) => i !== index) });
  };

  const addHazard = () => {
    if (!record) return;
    void save({ addedHazards: [...record.addedHazards, { hazard: '', control: '' }] });
  };

  const setHazard = (index: number, patch: Partial<AddedHazard>) => {
    if (!record) return;
    void save({ addedHazards: record.addedHazards.map((h, i) => (i === index ? { ...h, ...patch } : h)) });
  };

  if (!record) {
    return (
      <>
        <Stack.Screen options={{ title: 'Statement' }} />
        <RecordGate
          missing={missing}
          what="safe work method statement"
          why="It may have been deleted from this phone, or the link came from another device."
          failed={failed}
          onRetry={() => void load()}
        />
      </>
    );
  }

  const readCount = merged.steps.filter((s) => record.ticked.includes(s.key)).length;

  return (
    <>
      <Stack.Screen options={{ title: record.title || 'Statement' }} />
      <Screen>
        <Card>
          <Rowed align="flex-start">
            <View style={{ flex: 1 }}>
              <Txt weight="700" size="lg">{record.title}</Txt>
              <Txt size="sm" tone="muted">
                {record.siteName ?? 'No site named'} · {formatAuDate(record.date)}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end', gap: t.space(1) }}>
              <StatusPill label={locked ? 'Signed' : 'Draft'} tone={locked ? 'pass' : 'warn'} />
              {merged.residualRisk ? (
                <Chip label={`${RISK_LABEL[merged.residualRisk]} after controls`} tone={RISK_TONE[merged.residualRisk]} />
              ) : null}
            </View>
          </Rowed>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
            {readCount} of {merged.steps.length} steps read · {record.workers.filter((w) => w.signature).length} of {record.workers.length} signed
          </Txt>
        </Card>

        {merged.notCleared.length ? (
          <Banner
            tone="fail"
            title={merged.notCleared.length === 1
              ? 'This statement has not been cleared for signature'
              : `${merged.notCleared.length} of these statements have not been cleared for signature`}
            body={[
              merged.notCleared.map((n) => {
                const head = `${n.title} — ${n.reason}`;
                return n.findings.length ? `${head}\n${n.findings.map((f) => `  • ${f}`).join('\n')}` : head;
              }).join('\n\n'),
              '',
              'Read it and use it to brief the crew if it helps. It cannot be signed as the statement for this '
              + 'work: a signature says the document describes how the work will actually be done, and a hazard '
              + 'named in it with nothing written against it is the opposite of that.',
            ].join('\n')}
          />
        ) : null}

        {merged.highRisk ? (
          <Banner
            tone="fail"
            title="High-risk construction work"
            body={merged.hrcw.map((h) => `${h.clause} — ${h.text}`).join('\n\n')}
          />
        ) : null}

        {locked ? (
          <Banner
            tone="pass"
            title="Signed, and not editable"
            body={`Signed ${record.signedAt ? formatAuDate(qldIsoDay(record.signedAt) ?? record.date) : ''}. `
              + 'If the work changes, start a new statement for the change rather than editing this one.'}
          />
        ) : null}

        <Segmented value={tab} onChange={setTab} options={TABS} />

        {tab === 'work' ? (
          <>
            <H2>What is being done today</H2>
            <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2), lineHeight: 20 }}>
              Chosen from what is due at this site and what is on its register. Take off what does not apply, add
              anything else you are doing.
            </Txt>
            {SWMS_TEMPLATES.map((x) => {
              const on = record.templateIds.includes(x.id);
              return (
                <Card key={x.id} onPress={locked ? undefined : () => toggleTemplate(x.id)}>
                  <Rowed align="flex-start">
                    <MaterialCommunityIcons
                      name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={on ? t.color.accent : t.color.textFaint}
                    />
                    <View style={{ flex: 1, marginLeft: t.space(3) }}>
                      <Txt weight={on ? '700' : '400'}>{x.title}</Txt>
                      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{x.activity}</Txt>
                      {x.hrcw.length ? <Chip label="High-risk construction work" tone="fail" /> : null}
                    </View>
                  </Rowed>
                </Card>
              );
            })}

            <H2>Where and who</H2>
            <Field label="Site" value={record.siteName ?? ''} onChangeText={(v) => void save({ siteName: v })} editable={!locked} />
            <Field label="Supervisor" value={record.supervisor ?? ''} onChangeText={(v) => void save({ supervisor: v })} editable={!locked} />
            <Field
              label="Supervisor's phone"
              value={record.supervisorPhone ?? ''}
              onChangeText={(v) => void save({ supervisorPhone: v })}
              editable={!locked}
            />

            <Card>
              <Label>The Simpro job</Label>
              {record.jobExternalId ? (
                <Rowed align="flex-start" style={{ marginTop: t.space(1) }}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="600">Job {record.jobExternalId}</Txt>
                    {record.jobTitle ? <Txt size="sm" tone="muted">{record.jobTitle}</Txt> : null}
                    {record.attachedAt ? <Chip label="PDF sent to the job" tone="pass" /> : null}
                  </View>
                  <Button title="Change" variant="ghost" compact onPress={() => void openJobPicker()} />
                </Rowed>
              ) : (
                <>
                  <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
                    Not linked yet. The signed statement goes onto the job’s attachments by itself once it is.
                  </Txt>
                  <Button title="Pick the job" variant="secondary" onPress={() => void openJobPicker()} style={{ marginTop: t.space(2) }} />
                </>
              )}
              {pickingJob ? (
                <View style={{ marginTop: t.space(2) }}>
                  {jobs.length === 0 ? <Txt size="sm" tone="muted">No jobs on this phone for that site.</Txt> : null}
                  {jobs.slice(0, 25).map((j) => (
                    <Card key={j.id} onPress={() => void linkJob(j)}>
                      <Txt weight="600">{j.externalId ? `Job ${j.externalId}` : j.title}</Txt>
                      <Txt size="sm" tone="muted">{j.title}{j.siteName ? ` · ${j.siteName}` : ''}</Txt>
                    </Card>
                  ))}
                  <Button title="Close" variant="ghost" onPress={() => setPickingJob(false)} />
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        {tab === 'steps' ? (
          <>
            <H2>Read it with the crew</H2>
            <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2), lineHeight: 20 }}>
              Open each step, read it out, tick it. The page says which ones were read on site, so ticking without
              reading is the only way to make it lie.
            </Txt>
            {merged.steps.map((s, i) => {
              const on = openStep === s.key;
              const done = record.ticked.includes(s.key);
              return (
                <Card key={s.key} onPress={() => setOpenStep(on ? null : s.key)}>
                  <Rowed align="flex-start">
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">{i + 1}. {s.step}</Txt>
                      <Txt size="xs" tone="faint">{s.templateTitle} · {s.responsible}</Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: t.space(1) }}>
                      <Chip label={RISK_LABEL[s.residualRisk]} tone={RISK_TONE[s.residualRisk]} />
                      <MaterialCommunityIcons
                        name={done ? 'check-circle' : 'circle-outline'}
                        size={22}
                        color={done ? t.color.pass : t.color.textFaint}
                      />
                    </View>
                  </Rowed>

                  {on ? (
                    <>
                      <Divider />
                      <Label>What can hurt you</Label>
                      {s.hazards.map((h) => (
                        <Txt key={h} size="sm" style={{ marginTop: t.space(1) }}>• {h}</Txt>
                      ))}
                      <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
                        Before controls: {RISK_LABEL[s.initialRisk]}
                      </Txt>

                      <Divider />
                      <Label>What we do about it</Label>
                      {orderedControls(s.controls).map((c) => (
                        <View key={c.control} style={{ marginTop: t.space(1.5) }}>
                          <Txt size="xs" tone="accent">{CONTROL_LEVEL_LABEL[c.level].toUpperCase()}</Txt>
                          <Txt size="sm" style={{ lineHeight: 20 }}>{c.control}</Txt>
                        </View>
                      ))}
                      <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
                        After controls: {RISK_LABEL[s.residualRisk]}
                      </Txt>

                      <Button
                        title={done ? 'Read — tap to untick' : 'We have read this step'}
                        variant={done ? 'ghost' : 'primary'}
                        onPress={() => toggleStep(s.key)}
                        disabled={locked}
                        style={{ marginTop: t.space(3) }}
                      />
                    </>
                  ) : null}
                </Card>
              );
            })}

            <H2>If it goes wrong</H2>
            {merged.templates.map((x) => (
              <Card key={x.id}>
                <Label>{x.title}</Label>
                <Txt size="sm" style={{ marginTop: t.space(1), lineHeight: 20 }}>{x.emergency}</Txt>
              </Card>
            ))}
          </>
        ) : null}

        {tab === 'site' ? (
          <>
            <H2>Only this site can answer these</H2>
            {merged.prompts.length === 0 ? (
              <Txt size="sm" tone="muted">Nothing site-specific on the statements chosen.</Txt>
            ) : null}
            {merged.prompts.map((p) => (
              <Field
                key={p}
                label={p}
                value={record.answers[p] ?? ''}
                onChangeText={(v) => void save({ answers: { ...record.answers, [p]: v } })}
                editable={!locked}
                multiline
              />
            ))}

            {merged.permits.length ? (
              <>
                <H2>Permits</H2>
                {merged.permits.map((p) => {
                  const held = record.permits.find((x) => x.permit === p);
                  return (
                    <Card key={p} onPress={locked ? undefined : () => togglePermit(p)}>
                      <Rowed align="flex-start">
                        <MaterialCommunityIcons
                          name={held?.held ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={held?.held ? t.color.accent : t.color.textFaint}
                        />
                        <View style={{ flex: 1, marginLeft: t.space(3) }}>
                          <Txt weight={held?.held ? '700' : '400'}>{p}</Txt>
                          {held?.held ? (
                            <Field
                              label="Permit number"
                              value={held.reference ?? ''}
                              onChangeText={(v) => void save({
                                permits: record.permits.map((x) => (x.permit === p ? { ...x, reference: v } : x)),
                              })}
                              editable={!locked}
                            />
                          ) : (
                            <Txt size="sm" tone="muted">Work does not start without it.</Txt>
                          )}
                        </View>
                      </Rowed>
                    </Card>
                  );
                })}
              </>
            ) : null}

            <H2>PPE</H2>
            <Rowed gap={2} wrap>
              {merged.ppe.map((p) => (
                <Chip
                  key={p}
                  label={p}
                  selected={record.ppeChecked.includes(p)}
                  onPress={locked ? undefined : () => togglePpe(p)}
                />
              ))}
            </Rowed>

            <H2>Found on arrival</H2>
            <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
              Anything the office could not have known about: a trade working above you, a blocked exit, a pump room
              that is now a storeroom.
            </Txt>
            {record.addedHazards.map((h, i) => (
              <Card key={`hazard-${i}`}>
                <Field label="What you found" value={h.hazard} onChangeText={(v) => setHazard(i, { hazard: v })} editable={!locked} />
                <Field label="What you did about it" value={h.control} onChangeText={(v) => setHazard(i, { control: v })} editable={!locked} multiline />
              </Card>
            ))}
            <Button title="Add something you found" variant="secondary" onPress={addHazard} disabled={locked} />
          </>
        ) : null}

        {tab === 'sign' ? (
          <>
            {blocking.length ? (
              <Banner
                tone="warn"
                title={`${blocking.length} thing${blocking.length === 1 ? '' : 's'} before it can be signed`}
                body={blocking.slice(0, 6).map((b) => `${b.what} — ${b.fix}`).join('\n\n')}
              />
            ) : null}

            <H2>Everybody doing this work</H2>
            {record.workers.map((w, i) => (
              <Card key={`worker-${i}`}>
                <Field label="Name" value={w.name} onChangeText={(v) => setWorker(i, { name: v })} editable={!locked} />
                <Field label="Licence or ticket" value={w.licence ?? ''} onChangeText={(v) => setWorker(i, { licence: v })} editable={!locked} />
                {w.signature ? (
                  <Rowed align="center" style={{ marginTop: t.space(2) }}>
                    <MaterialCommunityIcons name="draw-pen" size={20} color={t.color.pass} />
                    <Txt size="sm" tone="muted" style={{ flex: 1, marginLeft: t.space(2) }}>
                      Signed{w.signedAt ? ` ${formatAuDate(qldIsoDay(w.signedAt) ?? record.date)}` : ''}
                    </Txt>
                    {!locked ? <Button title="Sign again" variant="ghost" compact onPress={() => setSigningFor(i)} /> : null}
                  </Rowed>
                ) : (
                  <Button
                    title={signingFor === i ? 'Sign below' : `${w.name || 'This person'} signs`}
                    variant="secondary"
                    onPress={() => setSigningFor(signingFor === i ? null : i)}
                    disabled={locked}
                    style={{ marginTop: t.space(2) }}
                  />
                )}
                {signingFor === i && !locked ? (
                  <SignaturePad
                    label="Sign here"
                    value={w.signature}
                    onChange={(v) => {
                      setWorker(i, { signature: v, signedAt: v ? nowIso() : undefined });
                      if (v) setSigningFor(null);
                    }}
                  />
                ) : null}
                {!locked ? <Button title="Take off the list" variant="ghost" onPress={() => removeWorker(i)} /> : null}
              </Card>
            ))}

            {!locked ? (
              <Card>
                <Field label="Add somebody" value={newWorker} onChangeText={setNewWorker} placeholder="Their name" />
                <Button title="Add" variant="secondary" onPress={addWorker} disabled={!newWorker.trim()} />
              </Card>
            ) : null}

            {!locked ? (
              <Button
                title="Sign the statement"
                onPress={() => void sign()}
                loading={busy}
                disabled={blocking.length > 0}
              />
            ) : null}
            {!locked && blocking.length ? (
              <Txt size="sm" tone="muted" style={{ textAlign: 'center' }}>{whyNotSigned(record, merged)}</Txt>
            ) : null}

            <H2>Afterwards</H2>
            <Button title="Share the PDF" variant="secondary" onPress={() => void share()} loading={busy} />
            {record.jobExternalId ? (
              <Button
                title={record.attachedAt ? 'Send it to the job again' : 'Put it on the Simpro job'}
                variant="secondary"
                onPress={() => void attach()}
                loading={busy}
                disabled={!locked}
              />
            ) : null}
            {!locked ? (
              <Txt size="sm" tone="muted">
                Only a signed statement goes on the job. A draft filed there reads as a briefing that happened.
              </Txt>
            ) : null}

            <Card>
              <Label>When this stops covering the work</Label>
              {SWMS_REVIEW_TRIGGERS.map((x) => (
                <Txt key={x} size="sm" tone="muted" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>• {x}</Txt>
              ))}
            </Card>

            <Button title="Back to the statements" variant="ghost" onPress={() => router.push('/swms')} />
          </>
        ) : null}
      </Screen>
    </>
  );
}
