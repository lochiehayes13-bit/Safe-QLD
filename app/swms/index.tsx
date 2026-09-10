import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createSwms, listSwms, swmsForDay, templatesFor } from '@/db/swmsRepo';
import { SWMS_TEMPLATES } from '@/seed/swms';
import { listSites } from '@/db/repo';
import { assetCountsBySystem } from '@/db/assetRepo';
import { dueAtSite } from '@/db/routineRunRepo';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
import {
  carryForwardSwms, mergeSwms, suggestTemplates, swmsProgressLine, swmsTitleFor,
  type SwmsRecord, type SwmsTemplate,
} from '@/domain/swms';
import { qldIsoDay } from '@/domain/qldTime';
import { nowIso } from '@/db';
import { loadPrefs } from '@/app-prefs';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, H2, Label, Rowed, Screen, SearchBox, StatusPill, Txt,
} from '@/components/ui';

/**
 * Safe work method statements, and the day's job safety analysis.
 *
 * The old way of doing this is a folder of PDFs: the technician knows the
 * folder exists, opens none of them, and the signed copy the principal
 * contractor asks for was never made. So this screen is built the other way
 * round — it opens on the statement for today's work, already chosen.
 *
 * Choosing it is the part worth automating. A site with hydrants and a
 * detection annual due needs the live testing statement, the height statement
 * and the traffic statement, and the one a crew forgets is the third. The
 * register and the routines due already know which work is happening, so the
 * app proposes the set and the technician takes off what does not apply,
 * rather than starting from an empty list and remembering.
 *
 * Yesterday's can be carried forward, because the same crew at the same site
 * doing the same work should not retype eleven answers. What does not carry is
 * the signatures and the ticks: a signature says this person read this today,
 * and copying one forward is forging it.
 */
export default function SwmsLibraryScreen() {
  const t = useTheme();
  const today = qldIsoDay(nowIso()) ?? '';
  const [recent, setRecent] = useState<SwmsRecord[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [starting, setStarting] = useState(false);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [rows, siteRows] = await Promise.all([listSwms({ limit: 30 }), listSites()]);
      setRecent(rows);
      setSites(siteRows.map((s) => ({ id: s.id, name: s.name })));
    } catch (e) {
      setRecent([]);
      setFailed(describeLoadFailure(e, 'your statements'));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * Starts today's analysis for a site, with the statements the work implies.
   *
   * The suggestion is deliberately generous: an extra statement costs a
   * technician twenty seconds to take off, and a missing one costs whatever
   * the hazard was.
   */
  const startForSite = async (site: { id: string; name: string }) => {
    setPicking(false);
    setStarting(true);
    try {
      const existing = await swmsForDay(today, site.id);
      if (existing) {
        router.push({ pathname: '/swms/[id]', params: { id: existing.id } });
        return;
      }

      const [counts, due, prefs, jobs] = await Promise.all([
        assetCountsBySystem(site.id),
        dueAtSite(site.id, today),
        loadPrefs(),
        listJobPage({ filter: 'all', today, siteId: site.id, limit: 10 })
          .then((page) => page.rows)
          .catch(() => [] as JobSummary[]),
      ]);
      const openJob = jobs.find((j) => j.status !== 'complete' && j.externalId);
      const dueNow = due.filter((d) => d.state === 'overdue' || d.state === 'due').map((d) => d.routineId);
      const ids = suggestTemplates(SWMS_TEMPLATES, {
        systems: counts.map((c) => c.system),
        routineIds: dueNow,
        text: openJob?.title,
      });
      const chosen = ids.length ? ids : ['live-testing'];

      const record = await createSwms({
        templateIds: chosen,
        date: today,
        title: swmsTitleFor(chosen.map((id) => SWMS_TEMPLATES.find((x) => x.id === id)).filter((x): x is SwmsTemplate => Boolean(x))),
        siteId: site.id,
        siteName: site.name,
        jobExternalId: openJob?.externalId,
        jobTitle: openJob?.title,
        workers: prefs.technicianName ? [{ name: prefs.technicianName, licence: prefs.technicianLicence || undefined }] : [],
      });
      router.push({ pathname: '/swms/[id]', params: { id: record.id } });
    } catch (e) {
      showAlert('Could not start it', describeActionFailure(e, 'starting the statement'));
    } finally {
      setStarting(false);
    }
  };

  /** One statement on its own, for work that is not at a site on the register. */
  const startTemplate = async (template: SwmsTemplate) => {
    setStarting(true);
    try {
      const prefs = await loadPrefs();
      const record = await createSwms({
        templateIds: [template.id],
        date: today,
        title: template.title,
        workers: prefs.technicianName ? [{ name: prefs.technicianName, licence: prefs.technicianLicence || undefined }] : [],
      });
      router.push({ pathname: '/swms/[id]', params: { id: record.id } });
    } catch (e) {
      showAlert('Could not start it', describeActionFailure(e, 'starting the statement'));
    } finally {
      setStarting(false);
    }
  };

  const carry = async (previous: SwmsRecord) => {
    setStarting(true);
    try {
      const { record: next, cleared } = carryForwardSwms(previous, today);
      const made = await createSwms({ ...next, templateIds: [...next.templateIds] });
      showAlert('Copied to today', `Everything carried across except:\n\n${cleared.map((c) => `• ${c}`).join('\n')}`);
      router.push({ pathname: '/swms/[id]', params: { id: made.id } });
    } catch (e) {
      showAlert('Could not copy it', describeActionFailure(e, 'copying the statement'));
    } finally {
      setStarting(false);
    }
  };

  const term = query.trim().toLowerCase();
  const templates = term
    ? SWMS_TEMPLATES.filter((x) => `${x.title} ${x.activity} ${x.steps.map((s) => s.step).join(' ')}`.toLowerCase().includes(term))
    : SWMS_TEMPLATES;
  const siteMatches = term ? sites.filter((s) => s.name.toLowerCase().includes(term)).slice(0, 8) : sites.slice(0, 8);

  return (
    <>
      <Stack.Screen options={{ title: 'Safe work method statements' }} />
      <Screen>
        {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}

        <Card>
          <Rowed align="flex-start">
            <MaterialCommunityIcons name="clipboard-check-outline" size={26} color={t.color.accent} />
            <View style={{ flex: 1, marginLeft: t.space(3) }}>
              <Txt weight="700">Start today’s statement</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                Pick the site and the app chooses the statements the work needs — what is due there, what is on the
                register, and the ones that come with them. Take off anything that does not apply.
              </Txt>
            </View>
          </Rowed>
          <Button
            title={picking ? 'Pick a site below' : 'Start today’s statement'}
            onPress={() => setPicking((p) => !p)}
            loading={starting}
            style={{ marginTop: t.space(3) }}
          />
        </Card>

        {picking ? (
          <Card>
            <Label>Which site</Label>
            <SearchBox value={query} onChange={setQuery} placeholder="Search sites" />
            {siteMatches.length === 0 ? (
              <Txt size="sm" tone="muted" style={{ marginTop: t.space(2) }}>
                No site by that name on this phone. Sync, or start from a statement below.
              </Txt>
            ) : null}
            {siteMatches.map((s) => (
              <Card key={s.id} onPress={() => void startForSite(s)}>
                <Txt weight="600">{s.name}</Txt>
              </Card>
            ))}
          </Card>
        ) : null}

        {recent.length ? (
          <>
            <H2>Yours</H2>
            {recent.map((r) => {
              const merged = mergeSwms(templatesFor(r));
              const isToday = r.date === today;
              return (
                <Card key={r.id} onPress={() => router.push({ pathname: '/swms/[id]', params: { id: r.id } })}>
                  <Rowed align="flex-start">
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">{r.title}</Txt>
                      <Txt size="sm" tone="muted">
                        {r.siteName ?? 'No site'} · {formatAuDate(r.date)}{isToday ? ' · today' : ''}
                      </Txt>
                      <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
                        {swmsProgressLine(r, merged)}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: t.space(1) }}>
                      <StatusPill
                        label={r.status === 'signed' ? 'Signed' : 'Draft'}
                        tone={r.status === 'signed' ? 'pass' : 'warn'}
                      />
                      {merged.highRisk ? <Chip label="High risk" tone="fail" /> : null}
                      {r.attachedAt ? <Chip label="On the job" tone="pass" /> : null}
                    </View>
                  </Rowed>
                  {r.status === 'signed' && !isToday ? (
                    <Button
                      title="Same again today"
                      variant="ghost"
                      onPress={() => void carry(r)}
                      style={{ marginTop: t.space(2) }}
                    />
                  ) : null}
                </Card>
              );
            })}
          </>
        ) : null}

        <H2>The statements</H2>
        <SearchBox value={query} onChange={setQuery} placeholder="Search the statements" />
        {templates.length === 0 ? (
          <EmptyState
          icon="magnify-close" title="Nothing by that name" body="Try the work rather than the hazard: hot work, heights, confined space." />
        ) : null}
        {templates.map((x) => (
          <Card key={x.id} onPress={() => void startTemplate(x)}>
            <Rowed align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt weight="700">{x.title}</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{x.activity}</Txt>
                <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
                  <Chip label={`${x.steps.length} steps`} />
                  {x.permits?.length ? <Chip label={`${x.permits.length} permit${x.permits.length === 1 ? '' : 's'}`} tone="warn" /> : null}
                  {x.hrcw.length ? <Chip label="High-risk construction work" tone="fail" /> : null}
                </Rowed>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
            </Rowed>
          </Card>
        ))}

        <Card>
          <Label>Why this is not a folder of PDFs</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            A statement has to be on site while the work is going on, and everybody doing the work has to have been
            taken through it. A PDF on a laptop in the ute is neither. Here the crew ticks the steps as they are read,
            signs on the phone, and the signed copy goes onto the Simpro job by itself.
          </Txt>
        </Card>
      </Screen>
    </>
  );
}
