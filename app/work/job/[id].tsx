import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { setJobStatus, listKnowledge, type KnowledgeNote } from '@/db/opsRepo';
import { getJobFull, type AttachmentRecord, type JobFull } from '@/db/mirrorRepo';
import { getSite, listDefects } from '@/db/repo';
import { assetCountsBySystem } from '@/db/assetRepo';
import type { Defect, Site } from '@/domain/types';
import type { SimproCostCenter, SimproItem, SimproSection } from '@/simpro/mirrorResources';
import {
  attachmentIcon, contactActions, discountLabel, formatFileSize, formatQty, invoiceState, itemHeading, itemPrice, jobDates,
  jobStatusWord, localStateWord, qldClock, relativeQldTime, sectionLineCount, sellTotalLine, stageLabel, statusSwatch, taskState,
  technicianLine,
} from '@/domain/jobPresentation';
import { qldIsoDay, qldMoment } from '@/domain/qldTime';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { simproConfigFromPrefs } from '@/simpro/config';
import { syncJobDetail } from '@/simpro/sync';
import { readUserSession } from '@/simpro/userSession';
import { describeOpenOutcome, openAttachment } from '@/services/simproAttachments';
import { useTheme } from '@/theme';
import { animateNextLayout } from '@/components/motion';
import { Banner, Button, Card, Chip, H2, Label, Rowed, Screen, StatTile, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Job detail — the office's record, and the site briefing under it.
 *
 * This screen used to show a heading and a blank. Everything the office
 * holds on a job is here now: who it is for, who is booked, what the
 * sections and lines are, the files, the activity feed, the tasks and the
 * invoices — read from the phone, so it works in a basement, and refreshed
 * from Simpro in the background when the screen opens with signal.
 *
 * Under that is what the phone knows and the office does not: what is
 * already broken here, what the last person found, how many assets there
 * are. That is the difference between arriving informed and arriving cold.
 *
 * Money on this screen is the sell side only. The mirror never held a cost
 * or a margin, so there is nothing here that could show one.
 */

type Refresh =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; partial: string[] }
  | { state: 'failed'; error: string };

export default function JobScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [full, setFull] = useState<JobFull | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [knowledge, setKnowledge] = useState<KnowledgeNote[]>([]);
  const [refresh, setRefresh] = useState<Refresh>({ state: 'idle' });
  const [opening, setOpening] = useState<string | null>(null);
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  // Set on the way into complete on this screen: the note to the office is
  // queued by the status write, and the person who pressed the button is
  // told so here, once, rather than left to find it on the outbound screen.
  const [noteQueued, setNoteQueued] = useState(false);
  const refreshing = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const f = await getJobFull(id);
      setFull(f);
      setMissing(!f);
      if (f?.job.siteId) {
        const [s, d, a, k] = await Promise.all([
          getSite(f.job.siteId),
          listDefects(f.job.siteId, 'open'),
          // A count, not the rows: the briefing wants a number.
          assetCountsBySystem(f.job.siteId),
          listKnowledge({ siteId: f.job.siteId }),
        ]);
        setSite(s); setDefects(d); setAssetCount(a.reduce((n, x) => n + x.count, 0)); setKnowledge(k);
      }
      return f;
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this job'));
    }
  }, [id]);

  /**
   * The office's copy, read in the background.
   *
   * Never blocks the screen: what the phone holds is on screen first, and
   * the refreshed copy replaces it when it lands. The sync itself skips a
   * job read in the last quarter hour, so flicking back to this screen
   * costs nothing.
   */
  const refreshFromOffice = useCallback(async (jobId: string) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setRefresh({ state: 'running' });
    try {
      const prefs = await loadPrefs();
      const outcome = await syncJobDetail(simproConfigFromPrefs(prefs), jobId);
      if (outcome.status === 'synced') {
        await load();
        setRefresh({ state: 'done', partial: outcome.partial });
      } else if (outcome.status === 'failed') {
        setRefresh({ state: 'failed', error: outcome.error });
      } else {
        setRefresh({ state: 'idle' });
      }
    } catch (e) {
      setRefresh({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      refreshing.current = false;
    }
  }, [load]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const f = await load();
      if (cancelled || !f?.job.externalId) return;
      void refreshFromOffice(f.job.id);
    })();
    return () => { cancelled = true; };
  }, [load, refreshFromOffice]));

  useEffect(() => { setShowAllTimeline(false); setNoteQueued(false); }, [id]);

  /**
   * The phone's own status on the job, then the row read back.
   *
   * Read back rather than patched in memory, because the write stamps
   * startedAt or completedAt and queues the note to the office, and the
   * screen shows both. The name on the note is whoever is signed in to
   * Simpro on this phone, else the technician name in Settings; the job's
   * technician field is everyone the office booked, which is not who
   * pressed the button.
   */
  const setStatus = async (jobId: string, status: 'in-progress' | 'complete') => {
    const [prefs, session] = await Promise.all([loadPrefs(), readUserSession()]);
    const completedBy = session?.label?.trim() || prefs.technicianName.trim() || undefined;
    await setJobStatus(jobId, status, { completedBy });
    const f = await load();
    if (status === 'complete' && f?.job.externalId) setNoteQueued(true);
  };

  if (!full) return <RecordGate missing={missing} what="job" failed={failed} onRetry={() => { void load(); }} />;

  const { job } = full;
  const critical = defects.filter((d) => d.severity === 'critical');
  const status = jobStatusWord(job);
  // What the phone did that the office's pill does not say. The pill keeps
  // the office's word, so after Start job or Mark complete this is the only
  // thing on screen that says the button worked.
  const local = localStateWord(job);
  const localAt = job.status === 'complete' ? job.completedAt : job.status === 'in-progress' ? job.startedAt : undefined;
  const localClock = qldClock(localAt);
  const swatch = statusSwatch(job.statusColor, t.color.surface);
  const stage = stageLabel(job.stageRaw ?? job.stage);
  const isSimpro = !!job.externalId;
  // scheduledFor is Simpro's DateIssued on a mirrored job and the booked day
  // on one added by hand; the office's word is only right for the office's.
  const dates = jobDates(job).map((d) => (d.label === 'Issued' && !isSimpro ? { ...d, label: 'Scheduled' } : d));
  const sell = sellTotalLine(job.totalExTaxCents, job.totalIncTaxCents);
  const technicians = technicianLine(full.technicians, job.technician);
  const contact = full.siteContact;
  const contactWays = contactActions(contact);
  const now = nowIso();
  const today = qldIsoDay(now) ?? '';
  const timeline = showAllTimeline ? full.timeline : full.timeline.slice(0, 12);

  const open = async (a: AttachmentRecord) => {
    if (!job.externalId || opening) return;
    setOpening(a.id);
    try {
      const outcome = await openAttachment({ kind: 'job', localJobId: job.id, externalId: job.externalId }, a);
      const words = describeOpenOutcome(outcome);
      if (words) showAlert(words.title, words.body);
      else await load();
    } catch (e) {
      // The spinner on the row stops either way; without this the tap simply
      // stopped meaning anything, which reads as the attachment being broken.
      showAlert('Could not open that attachment', describeActionFailure(e, 'open this attachment'));
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: job.externalId ? `Job ${job.externalId}` : job.siteName }} />
      <Screen>
        {/* -- The office's header ------------------------------------------ */}
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Txt size="xl" weight="700">{job.title}</Txt>
            <Rowed gap={1.5} wrap style={{ marginTop: t.space(1.5) }}>
              {swatch ? (
                <OfficePill label={status.label} fill={swatch.fill} outlined={swatch.outlined} />
              ) : (
                <StatusPill label={status.label} tone={status.tone} />
              )}
              {stage && stage !== status.label ? <Chip label={stage} /> : null}
              {local ? <Chip label={localClock ? `${local.label} ${localClock}` : local.label} tone={local.tone === 'muted' || local.tone === 'info' ? 'default' : local.tone} /> : null}
              {job.jobTypeRaw ?? job.jobType ? <Chip label={(job.jobTypeRaw ?? job.jobType)!} /> : null}
              {job.priority === 'urgent' ? <Chip label="Urgent" tone="fail" /> : null}
            </Rowed>
          </View>
        </Rowed>

        <Card>
          <MetaRow label="Job no." value={job.externalId ? `#${job.externalId}` : 'On this phone only'} mono={!!job.externalId} />
          {job.orderNo ? <MetaRow label="Order no." value={job.orderNo} mono /> : null}
          {job.requestNo ? <MetaRow label="Request no." value={job.requestNo} mono /> : null}
          <MetaRow
            label="Customer"
            value={job.customerName ?? '—'}
            onPress={job.customerExternalId
              ? () => router.push({ pathname: '/customer/[id]', params: { id: job.customerExternalId! } })
              : undefined}
          />
          <MetaRow
            label="Site"
            value={job.siteName}
            hint={job.siteId ? undefined : 'Not matched to a site on this phone yet'}
            onPress={job.siteId ? () => router.push({ pathname: '/site/[id]', params: { id: job.siteId! } }) : undefined}
          />
          {job.address ? (
            <MetaRow
              label="Address"
              value={job.address}
              onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(job.address!)}`)}
            />
          ) : null}
          {technicians ? <MetaRow label="Technicians" value={technicians} /> : null}
          {job.projectManager ? <MetaRow label="Project manager" value={job.projectManager} /> : null}
          {dates.map((d) => <MetaRow key={d.label} label={d.label} value={d.value} />)}
          {sell ? <MetaRow label="Sell" value={sell} /> : null}
          {full.customerContract?.name || full.customerContract?.contractNo ? (
            <MetaRow
              label="Contract"
              value={[full.customerContract.name, full.customerContract.contractNo].filter(Boolean).join(' · ')}
            />
          ) : null}
          {full.tags.length ? (
            <Rowed gap={1.5} wrap style={{ marginTop: t.space(2) }}>
              {full.tags.map((tag) => <Chip key={tag} label={tag} />)}
            </Rowed>
          ) : null}
        </Card>

        {contact ? (
          <Card>
            <Label>Site contact</Label>
            <Txt weight="700" style={{ marginTop: 4 }}>{contact.name || 'Unnamed contact'}</Txt>
            {contact.position ? <Txt size="sm" tone="muted">{contact.position}</Txt> : null}
            {contactWays.length ? (
              <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                {contactWays.map((w) => (
                  <Button
                    key={w.href}
                    title={w.label}
                    variant="secondary"
                    compact
                    icon={<MaterialCommunityIcons name={w.kind === 'email' ? 'email-outline' : w.kind === 'mobile' ? 'cellphone' : 'phone-outline'} size={18} color={t.color.text} />}
                    onPress={() => void Linking.openURL(w.href)}
                  />
                ))}
              </Rowed>
            ) : (
              <Txt size="sm" tone="faint" style={{ marginTop: 4 }}>The office has no number or email for them.</Txt>
            )}
          </Card>
        ) : null}

        {job.descriptionText ? (
          <>
            <H2>Description</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.descriptionText}</Txt></Card>
          </>
        ) : null}

        {job.notesText ? (
          <>
            <H2>Office notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.notesText}</Txt></Card>
          </>
        ) : null}

        {/* -- Sections, cost centres, lines ------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Sections</H2>
            {full.sections.length ? (
              full.sections.map((s) => <SectionCard key={s.id} section={s} />)
            ) : (
              <NotYet
                synced={full.detailSynced}
                what="lines"
                none="The office has no sections or lines on this job."
              />
            )}
          </>
        ) : null}

        {/* -- Attachments ------------------------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Attachments</H2>
            {full.attachments.length ? (
              full.attachments.map((a) => (
                <Card key={a.id} onPress={() => void open(a)}>
                  <Rowed gap={3}>
                    <MaterialCommunityIcons name={attachmentIcon(a.mimeType, a.filename)} size={26} color={t.color.accentText} />
                    <View style={{ flex: 1 }}>
                      <Txt weight="600" numberOfLines={2}>{a.filename}</Txt>
                      <Txt size="xs" tone="muted">
                        {[formatFileSize(a.sizeBytes), a.addedBy, a.dateAdded ? formatAuDate(a.dateAdded) : undefined, a.folder]
                          .filter(Boolean).join(' · ') || 'Details come with the file'}
                      </Txt>
                    </View>
                    {opening === a.id ? (
                      <Txt size="xs" tone="accent" weight="700">Fetching…</Txt>
                    ) : a.localUri ? (
                      <Chip label="On phone" tone="pass" />
                    ) : (
                      <MaterialCommunityIcons name="cloud-download-outline" size={20} color={t.color.textFaint} />
                    )}
                  </Rowed>
                </Card>
              ))
            ) : (
              <NotYet synced={full.detailSynced} what="files" none="Nothing is attached to this job." />
            )}
          </>
        ) : null}

        {/* -- Timeline ---------------------------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Activity</H2>
            {full.timeline.length ? (
              <Card>
                <View style={{ gap: t.space(3) }}>
                  {timeline.map((e, i) => (
                    <View key={`${e.at ?? ''}-${i}`} style={{ flexDirection: 'row', gap: t.space(3) }}>
                      <View style={{ width: 8, alignItems: 'center', paddingTop: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i === 0 ? t.color.accent : t.color.borderStrong }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt size="sm" style={{ lineHeight: 19 }}>{e.message}</Txt>
                        <Txt size="xs" tone="faint">
                          {[e.staffName, relativeQldTime(e.at, now), e.type].filter(Boolean).join(' · ')}
                        </Txt>
                      </View>
                    </View>
                  ))}
                </View>
                {full.timeline.length > timeline.length || showAllTimeline ? (
                  // Tall enough for a glove: a tap that lands on the last
                  // row instead of a line of text expands nothing, and reads
                  // as the rest of the activity never having synced.
                  <Pressable
                    onPress={() => { animateNextLayout(); setShowAllTimeline((v) => !v); }}
                    hitSlop={6}
                    accessibilityRole="button"
                    style={{ marginTop: t.space(2), minHeight: 44, justifyContent: 'center' }}
                  >
                    <Txt size="sm" tone="accent" weight="700">
                      {showAllTimeline ? 'Show less' : `Show all ${full.timeline.length}`}
                    </Txt>
                  </Pressable>
                ) : null}
              </Card>
            ) : (
              <NotYet synced={full.detailSynced} what="activity" none="No activity has been logged on this job." />
            )}
          </>
        ) : null}

        {/* -- Tasks ------------------------------------------------------- */}
        {isSimpro && (full.tasks.length || !full.detailSynced) ? (
          <>
            <H2>Tasks</H2>
            {full.tasks.length ? (
              full.tasks.map((task) => {
                const state = taskState(task, today);
                return (
                  <Card key={task.id}>
                    <Rowed align="flex-start">
                      <View style={{ flex: 1 }}>
                        <Txt weight="600">{task.subject}</Txt>
                        {task.assignedTo || task.assignees.length ? (
                          <Txt size="sm" tone="muted">{[task.assignedTo, ...task.assignees].filter(Boolean).join(', ')}</Txt>
                        ) : null}
                      </View>
                      <StatusPill label={state.label} tone={state.tone} />
                    </Rowed>
                  </Card>
                );
              })
            ) : (
              <NotYet synced={full.detailSynced} what="tasks" none="" />
            )}
          </>
        ) : null}

        {/* -- Invoices ---------------------------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Invoices</H2>
            {full.invoices.length ? (
              full.invoices.map((inv) => {
                const state = invoiceState(inv, today);
                return (
                  <Card key={inv.externalId} onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: inv.externalId } })}>
                    <Rowed align="flex-start">
                      <View style={{ flex: 1 }}>
                        <Txt weight="700">Invoice {inv.externalId}</Txt>
                        <Txt size="sm" tone="muted">
                          {[inv.dateIssued ? `Issued ${formatAuDate(inv.dateIssued)}` : undefined, inv.invoiceType].filter(Boolean).join(' · ')}
                        </Txt>
                        {inv.totalIncTaxCents !== undefined ? (
                          <Txt size="sm" weight="700" style={{ marginTop: 2 }}>{formatCents(inv.totalIncTaxCents)} inc GST</Txt>
                        ) : null}
                      </View>
                      <StatusPill label={state.label} tone={state.tone} />
                    </Rowed>
                  </Card>
                );
              })
            ) : (
              <NotYet synced={full.detailSynced} what="invoices" none="Nothing has been invoiced against this job yet." />
            )}
          </>
        ) : null}

        {/* -- The site briefing ------------------------------------------- */}
        <H2>Before you walk in</H2>
        <Rowed gap={2}>
          <StatTile label="Assets" value={assetCount} />
          <StatTile label="Open defects" value={defects.length} tone={critical.length ? 'fail' : 'default'} />
          <StatTile label="Critical" value={critical.length} tone={critical.length ? 'fail' : 'default'} />
        </Rowed>
        {!job.siteId ? (
          <Txt size="xs" tone="faint">
            This job is not matched to a site on this phone, so the counts above are empty rather than known.
          </Txt>
        ) : null}

        {knowledge.length ? (
          <Card>
            <Label>You should know about this site</Label>
            <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
              {knowledge.slice(0, 4).map((k) => (
                <View key={k.id}>
                  <Rowed gap={2}>
                    <MaterialCommunityIcons
                      name={k.status === 'verified' || k.status === 'manufacturer-confirmed' ? 'check-decagram' : 'information-outline'}
                      size={15}
                      color={k.status === 'unverified' ? t.color.warn : t.color.pass}
                    />
                    <Txt size="sm" weight="600" style={{ flex: 1 }}>{k.title}</Txt>
                  </Rowed>
                  {k.body ? <Txt size="sm" tone="muted" style={{ marginLeft: 23, lineHeight: 19 }}>{k.body}</Txt> : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {critical.length ? (
          <Banner
            tone="fail"
            title={`${critical.length} critical defect${critical.length === 1 ? '' : 's'} already open here`}
            body={critical.slice(0, 3).map((d) => `${d.location}: ${d.description.slice(0, 90)}`).join('\n')}
          />
        ) : null}

        {site?.notes ? (
          <Card>
            <Label>Site notes on this phone</Label>
            <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{site.notes}</Txt>
          </Card>
        ) : null}

        {/* -- What to do ---------------------------------------------------- */}
        <H2>Do</H2>
        {job.status !== 'in-progress' && job.status !== 'complete' ? (
          <Button title="Start job" onPress={() => void setStatus(job.id, 'in-progress')} />
        ) : null}
        {job.status === 'in-progress' ? (
          <Button
            title="Mark complete"
            onPress={() => {
              showAlert('Complete this job?', 'Check the test sheet, defects and photos are done first — anything missing is harder to add later.', [
                { text: 'Not yet', style: 'cancel' },
                { text: 'Complete', onPress: () => void setStatus(job.id, 'complete') },
              ]);
            }}
          />
        ) : null}
        {local ? (
          <Card>
            <Rowed gap={2} align="flex-start">
              <MaterialCommunityIcons
                name={job.status === 'complete' ? 'check-circle-outline' : job.status === 'blocked' ? 'alert-circle-outline' : 'progress-clock'}
                size={20}
                color={job.status === 'complete' ? t.color.pass : job.status === 'blocked' ? t.color.fail : t.color.warn}
              />
              <View style={{ flex: 1 }}>
                <Txt weight="700" size="sm">
                  {local.label}{localAt ? ` at ${qldMoment(localAt) ?? formatAuDate(localAt)}` : ''}
                </Txt>
                {isSimpro && job.status === 'complete' ? (
                  <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }}>
                    {noteQueued
                      ? 'Work-completed note queued for the office. It goes with the next send, and the office moves the job on from there.'
                      : "The office's record moves on when the scheduler reads the completion note and closes the job at their end."}
                  </Txt>
                ) : isSimpro ? (
                  <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }}>
                    The office's status above is theirs; this is what happened on this phone.
                  </Txt>
                ) : null}
              </View>
            </Rowed>
          </Card>
        ) : null}

        <Rowed gap={2}>
          <Button
            title="Raise defect"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/work/defect/new', params: { siteId: job.siteId ?? '' } })}
          />
          {job.siteId ? (
            <Button
              title="Open site"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/site/[id]', params: { id: job.siteId! } })}
            />
          ) : null}
        </Rowed>

        {job.notes ? (
          <>
            <H2>Your notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.notes}</Txt></Card>
          </>
        ) : null}

        {/* -- Provenance ------------------------------------------------- */}
        <View style={{ gap: 2 }}>
          {refresh.state === 'running' ? (
            <Txt size="xs" tone="accent">Refreshing from Simpro…</Txt>
          ) : null}
          {refresh.state === 'done' && refresh.partial.length ? (
            <Txt size="xs" tone="warn">
              Refreshed, but the office would not hand over: {refresh.partial.join('; ')}
            </Txt>
          ) : null}
          {refresh.state === 'failed' ? (
            <Txt size="xs" tone="faint">Showing what the phone holds. Could not refresh: {refresh.error}</Txt>
          ) : null}
          <Txt size="xs" tone="faint">
            {isSimpro
              ? job.detailSyncedAt
                ? `Office record as of ${qldMoment(job.detailSyncedAt) ?? job.detailSyncedAt}.`
                : 'The lines, files and activity under this job have not been read yet. They come the first time it is opened with signal.'
              : 'Added on this phone; the office does not have this job.'}
            {job.scheduledFor ? ` ${isSimpro ? 'Issued' : 'Scheduled'} ${formatAuDate(job.scheduledFor)}.` : ''}
          </Txt>
        </View>
      </Screen>
    </>
  );
}

/**
 * The office's status, in the office's colour.
 *
 * The colour is a dot and a border only. The label stays in the theme's own
 * text colour, because a status written in the office's pale yellow on a
 * dark card is unreadable in sun, and a dot the card would swallow gets a
 * ring — see statusSwatch.
 */
function OfficePill({ label, fill, outlined }: { label: string; fill: string; outlined: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: t.space(2.5), paddingVertical: t.space(1.5),
        borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt,
        borderWidth: 1, borderColor: outlined ? t.color.borderStrong : fill,
      }}
    >
      <View
        style={{
          width: 10, height: 10, borderRadius: 5, backgroundColor: fill,
          borderWidth: outlined ? StyleSheet.hairlineWidth : 0, borderColor: t.color.textMuted,
        }}
      />
      <Txt size="xs" weight="800">{label}</Txt>
    </View>
  );
}

function MetaRow({ label, value, hint, mono, onPress }: { label: string; value: string; hint?: string; mono?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space(3), minHeight: onPress ? 44 : undefined, paddingVertical: 4 }}>
      <Txt size="xs" tone="muted" weight="700" style={{ width: 96, textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 3 }}>{label}</Txt>
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight={onPress ? '700' : '500'} tone={onPress ? 'accent' : 'default'} mono={mono}>{value}</Txt>
        {hint ? <Txt size="xs" tone="faint">{hint}</Txt> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} style={{ paddingTop: 2 }} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={4}>{body}</Pressable> : body;
}

/**
 * Why a family is empty. "Not read yet" and "the office has none" look the
 * same on a card and mean opposite things to somebody deciding whether to
 * drive back for the site plan.
 */
function NotYet({ synced, what, none }: { synced: boolean; what: string; none: string }) {
  if (!synced) {
    return (
      <Txt size="sm" tone="faint" style={{ lineHeight: 19 }}>
        The {what} have not been read from the office yet — they come the first time this job is opened with signal.
      </Txt>
    );
  }
  return none ? <Txt size="sm" tone="faint">{none}</Txt> : null;
}

/** A section, collapsed to its name and a count until it is tapped. */
function SectionCard({ section }: { section: SimproSection }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const lines = sectionLineCount(section);
  const total = section.costCenters.reduce((n, c) => n + (c.totalExTaxCents ?? 0), 0);
  const anyTotal = section.costCenters.some((c) => c.totalExTaxCents !== undefined);
  return (
    <Card onPress={() => { animateNextLayout(); setOpen((v) => !v); }}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700">{section.name || 'Unnamed section'}</Txt>
          <Txt size="sm" tone="muted">
            {section.costCenters.length} cost centre{section.costCenters.length === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}
            {anyTotal ? ` · ${formatCents(total)} ex GST` : ''}
          </Txt>
          {section.description && open ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{section.description}</Txt>
          ) : null}
        </View>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={t.color.textFaint} />
      </Rowed>
      {open ? (
        <View style={{ marginTop: t.space(3), gap: t.space(3) }}>
          {section.costCenters.map((c) => <CostCenterBlock key={c.id} costCenter={c} />)}
        </View>
      ) : null}
    </Card>
  );
}

function CostCenterBlock({ costCenter: c }: { costCenter: SimproCostCenter }) {
  const t = useTheme();
  const total = sellTotalLine(c.totalExTaxCents, c.totalIncTaxCents);
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.color.border, paddingTop: t.space(3), gap: t.space(2) }}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700" size="sm">{c.name || c.setupCostCenterName || 'Cost centre'}</Txt>
          {total ? <Txt size="xs" tone="muted">{total}</Txt> : null}
        </View>
        {c.percentComplete !== undefined ? <Chip label={`${Math.round(c.percentComplete)}%`} tone={c.percentComplete >= 100 ? 'pass' : 'default'} /> : null}
      </Rowed>
      {c.items.length ? c.items.map((it) => <ItemRow key={`${it.kind}-${it.id}`} item={it} />) : (
        <Txt size="xs" tone="faint">No lines under this cost centre.</Txt>
      )}
    </View>
  );
}

function ItemRow({ item }: { item: SimproItem }) {
  const t = useTheme();
  const price = itemPrice(item);
  return (
    <View style={{ flexDirection: 'row', gap: t.space(2), alignItems: 'flex-start' }}>
      <Txt size="sm" weight="700" mono style={{ minWidth: 52, textAlign: 'right' }}>{formatQty(item)}</Txt>
      <View style={{ flex: 1 }}>
        <Txt size="sm">{itemHeading(item)}</Txt>
        <Txt size="xs" tone="faint">
          {[item.partNo && item.partNo !== item.description ? item.partNo : undefined, price.unit, item.billableStatus, discountLabel(item)]
            .filter(Boolean).join(' · ')}
        </Txt>
      </View>
      {price.line ? <Txt size="sm" weight="700">{price.line}</Txt> : null}
    </View>
  );
}
