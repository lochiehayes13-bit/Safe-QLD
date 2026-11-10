import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SWMS_TEMPLATES } from '@/seed/swms';
import { RISK_LABEL, worstRisk, type SwmsTemplate } from '@/domain/swms';
import {
  builderDraft, builderNotReady, matchSummary, matchesFor, swmsStartFromRoute, withJobRow, worksFromJob,
  initialSelection, type BuilderJob,
} from '@/domain/swmsBuilder';
import { type TemplateMatch } from '@/domain/swmsMatch';
import { createSwms } from '@/db/swmsRepo';
import { jobsByExternalIds, openJobPicks, type JobPick } from '@/db/opsRepo';
import { assetCountsBySystem } from '@/db/assetRepo';
import { listSitePicks, type SitePick } from '@/db/repo';
import { SitePicker } from '@/components/SitePicker';
import { dueAtSite } from '@/db/routineRunRepo';
import { loadPrefs } from '@/app-prefs';
import { qldIsoDay } from '@/domain/qldTime';
import { nowIso } from '@/db';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { JobPicker } from '@/components/JobPicker';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * Starting today's statement: the job, the works, the statements.
 *
 * Three questions down one page, in the order a technician thinks in.
 *
 * **Which job.** It used to ask which site, and then guess the job — the first
 * open one at that site, silently. A technician always knows the job number;
 * it is written on everything they were sent. And picking it answers the site
 * for free, which is the field a statement cannot be signed without.
 *
 * **What the work is.** A box, pre-filled with what the office already wrote
 * on the job. Confirming a line that is nearly right at seven in the morning is
 * a different act from facing an empty box, and it is the difference between
 * this being used and not. What is typed here is kept: it goes in `notes`,
 * carries forward to tomorrow's statement, and prints on the page.
 *
 * **Which statements.** They come up as the words are typed, ticked where the
 * app is confident and offered where it is not, each saying why it is there.
 * The rest of the library is underneath, because the app being wrong about a
 * hazard must never be the reason a crew cannot reach the statement for it.
 *
 * What this screen deliberately does NOT do is any of the work of the record
 * itself — reading the steps, the permits, the site questions, the signatures.
 * That is app/swms/[id].tsx, it is already the whole working document, and
 * this hands straight over to it.
 */
export default function SwmsBuilderScreen() {
  const t = useTheme();
  const today = qldIsoDay(nowIso()) ?? '';
  // Opened from a job: its number and site come in on the route.
  const params = useLocalSearchParams<{ job?: string; siteId?: string; site?: string }>();
  const [fromRoute] = useState(() => swmsStartFromRoute(params));

  const [job, setJob] = useState<BuilderJob | null>(fromRoute.job);
  const [picking, setPicking] = useState(!fromRoute.job);
  const [suggested, setSuggested] = useState<JobPick[]>([]);
  /*
   * The site, where the work is at one the office has not raised a job for.
   *
   * This module had no site surface at all: no SitePicker, no site lister,
   * nothing — and the gate refused to enable Start without a job, so a crew at
   * a site with no job could not have a safe work method statement. That is
   * the one document that should never wait on the office's paperwork.
   */
  const [site, setSite] = useState<SitePick | null>(
    fromRoute.site ? { id: fromRoute.site.id, name: fromRoute.site.name } as SitePick : null,
  );
  const [sites, setSites] = useState<SitePick[]>([]);
  const [pickingSite, setPickingSite] = useState(false);
  const [works, setWorks] = useState('');
  const [touchedWorks, setTouchedWorks] = useState(false);
  /**
   * Null until somebody touches a box, and then it is theirs.
   *
   * Derived rather than written from an effect: the ticks follow the words
   * while nobody has disagreed with them, and the moment somebody does, the
   * words stop moving them. Holding it as "no opinion yet" rather than as a
   * list plus a flag is what makes that one expression instead of two states
   * that can disagree.
   */
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [systems, setSystems] = useState<string[]>([]);
  const [routineIds, setRoutineIds] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let live = true;
    void openJobPicks(40)
      .then((rows) => { if (live) setSuggested(rows.filter((r) => r.externalId)); })
      .catch((e) => { if (live) setFailed(describeLoadFailure(e, 'the jobs on this phone')); });
    return () => { live = false; };
  }, []);

  /**
   * Everything the app can learn from a picked job without asking again: the
   * office's own description of the work, the register at that site, and what
   * is due there. A failure in any of it costs a better suggestion, never the
   * statement — so each falls back to nothing rather than to an error.
   */
  const openSitePicker = useCallback(async () => {
    setPickingSite(true);
    if (sites.length) return;
    try {
      setSites(await listSitePicks());
    } catch (e) {
      showAlert('Couldn’t load sites', describeActionFailure(e, 'read the site list'));
    }
  }, [sites.length]);

  const takeJob = useCallback(async (pick: JobPick) => {
    setPicking(false);
    const picked: BuilderJob = {
      externalId: pick.externalId ?? '',
      siteName: pick.siteName,
      siteId: pick.siteId,
      customerName: pick.customerName,
      title: pick.title,
    };
    setJob(picked);

    const rows = await jobsByExternalIds([picked.externalId]).catch(() => []);
    // The site off the row where the route or the picker did not carry one.
    const siteId = picked.siteId || rows[0]?.siteId;
    const [counts, due] = await Promise.all([
      siteId ? assetCountsBySystem(siteId).catch(() => []) : Promise.resolve([]),
      siteId ? dueAtSite(siteId, today).catch(() => []) : Promise.resolve([]),
    ]);

    const withDescription = withJobRow(picked, rows[0]);
    setJob(withDescription);
    setSystems(counts.map((c) => c.system));
    setRoutineIds(due.map((d) => d.routineId));

    // Only where they have not started writing: a box somebody is typing into
    // is theirs, and a job picked afterwards must not wipe it.
    if (!touchedWorks) setWorks(worksFromJob(withDescription));
  }, [today, touchedWorks]);

  // A job handed over on the route is read once, the same as a picked one.
  const routeRead = useRef(false);
  useEffect(() => {
    if (routeRead.current || !fromRoute.job) return;
    routeRead.current = true;
    void takeJob({ ...fromRoute.job, siteName: fromRoute.job.siteName ?? '', status: 'scheduled' });
  }, [fromRoute.job, takeJob]);

  // A site handed over on the route: its register and what is due there.
  useEffect(() => {
    const siteId = fromRoute.site?.id;
    if (!siteId) return;
    let live = true;
    void Promise.all([
      assetCountsBySystem(siteId).catch(() => []),
      dueAtSite(siteId, today).catch(() => []),
    ]).then(([counts, due]) => {
      if (!live) return;
      setSystems(counts.map((c) => c.system));
      setRoutineIds(due.map((d) => d.routineId));
    });
    return () => { live = false; };
  }, [fromRoute.site?.id, today]);

  const matches = useMemo(
    (): TemplateMatch[] => matchesFor(SWMS_TEMPLATES, { job, works, systems, routineIds }),
    [job, works, systems, routineIds],
  );

  const selected = useMemo(() => chosen ?? initialSelection(matches), [chosen, matches]);

  const byId = useMemo(() => new Map(SWMS_TEMPLATES.map((x) => [x.id, x])), []);
  const matchedIds = useMemo(() => new Set(matches.map((m) => m.templateId)), [matches]);
  const rest = useMemo(
    () => SWMS_TEMPLATES.filter((x) => !matchedIds.has(x.id)),
    [matchedIds],
  );

  const toggle = (id: string) => {
    setChosen((prev) => {
      const from = prev ?? initialSelection(matches);
      return from.includes(id) ? from.filter((x) => x !== id) : [...from, id];
    });
  };

  const blocked = builderNotReady({ job, siteId: site?.id, templateIds: selected });
  // Nothing matched what was typed, so the whole library is the list.
  const autoAll = !!works.trim() && !matches.length;
  const listAll = showAll || autoAll;

  const start = async () => {
    if (blocked) return;
    setStarting(true);
    try {
      const prefs = await loadPrefs();
      const draft = builderDraft({
        job,
        siteId: site?.id,
        siteName: site?.name,
        works,
        templateIds: selected,
        templates: SWMS_TEMPLATES,
        date: today,
        technicianName: prefs.technicianName,
        technicianLicence: prefs.technicianLicence,
      });
      const record = await createSwms(draft);
      router.replace({ pathname: '/swms/[id]', params: { id: record.id } });
    } catch (e) {
      showAlert('Couldn’t start it', describeActionFailure(e, 'starting the statement'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'New statement' }} />

      {failed ? (
        <Banner tone="warn" title="Couldn’t load jobs" body={`${failed}\n\nSearch still works.`} />
      ) : null}

      <H2>Job</H2>
      {job && !picking ? (
        <Card onPress={() => setPicking(true)}>
          <Rowed gap={2}>
            <MaterialCommunityIcons name="briefcase-outline" size={20} color={t.color.accentText} />
            <View style={{ flex: 1 }}>
              <Txt weight="700">Job {job.externalId}{job.siteName ? ` · ${job.siteName}` : ''}</Txt>
              <Txt size="sm" tone="muted" numberOfLines={1}>
                {[job.customerName, job.title].filter(Boolean).join(' · ') || 'No description on the job'}
              </Txt>
            </View>
            <Txt size="sm" tone="faint">Change</Txt>
          </Rowed>
        </Card>
      ) : site ? (
        <Card onPress={() => { setSite(null); setPickingSite(false); }}>
          <Rowed>
            <View style={{ flex: 1 }}>
              <Txt weight="700">{site.name}</Txt>
              <Txt size="sm" tone="muted">
                {[site.suburb, site.clientName].filter(Boolean).join(' · ') || 'No job'}
              </Txt>
            </View>
            <Txt size="sm" tone="faint">Change</Txt>
          </Rowed>
        </Card>
      ) : pickingSite ? (
        <Card>
          <Txt weight="700">Which site?</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>You can link a job later.</Txt>
          <SitePicker
            sites={sites}
            onChange={(id: string) => {
              // The site replaces any job still held (from the route, or picked
              // before "No job?"), and that job's register with it.
              setSite(sites.find((x) => x.id === id) ?? null);
              setJob(null);
              setSystems([]);
              setRoutineIds([]);
              setPickingSite(false);
            }}
          />
          <Button title="Back to jobs" variant="ghost" onPress={() => setPickingSite(false)} />
        </Card>
      ) : (
        <>
          <JobPicker
            heading="Which job?"
            suggested={suggested}
            suggestedLabel="Open jobs"
            emptyWhenNoneSuggested="No open jobs. Search by number or pick the site."
            /* It used to say "you can still pick statements below and add the
               job later" while the Start button stayed disabled without one —
               the message promised what the button refused. */
            emptyWhenNothingOnDevice="No jobs yet. Sync in Settings or pick the site."
            busy={starting}
            onPick={(pick) => { void takeJob(pick); }}
            onClose={() => setPicking(false)}
          />
          {/*
            * Plenty of this work happens before the office books anything, and
            * a statement is read to a crew on the day rather than filed after.
            */}
          <Button
            title="No job? Pick the site"
            variant="secondary"
            onPress={() => { void openSitePicker(); }}
          />
        </>
      )}

      <H2>The work</H2>
      <Card>
        <Field
          label="Today’s work"
          value={works}
          onChangeText={(v) => { setTouchedWorks(true); setWorks(v); }}
          placeholder="Core drilling the slab to run pipe, occupied building"
          multiline
        />
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
          {job?.descriptionText?.trim()
            ? 'From the job. Change it to suit today.'
            : 'Describe today’s work, not the job type.'}
        </Txt>
      </Card>

      <H2>Statements</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{matchSummary(matches, works)}</Txt>

      {matches.map((m) => {
        const template = byId.get(m.templateId);
        return template ? (
          <TemplateRow
            key={m.templateId}
            template={template}
            match={m}
            checked={selected.includes(m.templateId)}
            onToggle={() => toggle(m.templateId)}
          />
        ) : null;
      })}

      {rest.length ? (
        <>
          {autoAll ? null : (
            <Card onPress={() => setShowAll((x) => !x)}>
              <Rowed gap={2} align="center">
                <MaterialCommunityIcons
                  name={showAll ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={t.color.textFaint}
                />
                <Txt weight="600" style={{ flex: 1 }}>
                  {showAll ? 'Hide' : 'Show'} {matches.length ? 'the other' : 'all'} {rest.length} statements
                </Txt>
              </Rowed>
            </Card>
          )}
          {listAll
            ? rest.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                match={null}
                checked={selected.includes(template.id)}
                onToggle={() => toggle(template.id)}
              />
            ))
            : null}
        </>
      ) : null}

      <View style={{ height: t.space(3) }} />
      <Button
        title={selected.length > 1 ? `Start with ${selected.length} statements` : 'Start'}
        onPress={() => { void start(); }}
        loading={starting}
        disabled={!!blocked}
      />
      {blocked ? (
        <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>{blocked}</Txt>
      ) : null}
    </Screen>
  );
}

/**
 * One statement, as a checkbox with its reasoning under it.
 *
 * The reason line matters more than it looks. A list of statements that
 * appeared from nowhere is a list a crew scrolls past; one that says "asbestos,
 * coring, shopping centre" is one they read, and one they can disagree with.
 */
function TemplateRow({
  template, match, checked, onToggle,
}: {
  template: SwmsTemplate;
  match: TemplateMatch | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const worst = worstRisk(template.steps.map((s) => s.residualRisk));

  return (
    <Card onPress={onToggle} style={checked ? { borderWidth: 1, borderColor: t.color.accent } : undefined}>
      <Rowed gap={3} align="flex-start">
        <MaterialCommunityIcons
          name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={checked ? t.color.accent : t.color.textFaint}
          style={{ marginTop: 1 }}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="700" size="sm">{template.title}</Txt>
          <Txt size="sm" tone="muted" numberOfLines={3} style={{ marginTop: 2, lineHeight: 18 }}>
            {template.activity}
          </Txt>
          {match?.because.length ? (
            <Txt size="xs" weight="600" style={{ color: t.color.accentText, marginTop: t.space(1.5), lineHeight: 16 }}>
              {match.because.join(' · ')}
            </Txt>
          ) : null}
          <Rowed gap={2} style={{ marginTop: t.space(2), flexWrap: 'wrap' }}>
            <Chip label={`${template.steps.length} steps`} />
            {template.permits.length ? (
              <Chip label={`${template.permits.length} permit${template.permits.length === 1 ? '' : 's'}`} tone="warn" />
            ) : null}
            {template.hrcw.length ? <Chip label="High-risk construction work" tone="fail" /> : null}
            {worst ? <Chip label={`After controls: ${RISK_LABEL[worst]}`} /> : null}
          </Rowed>
        </View>
      </Rowed>
    </Card>
  );
}
