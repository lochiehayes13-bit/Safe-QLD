import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createForm72, listForm72, type StoredForm72 } from '@/db/form72Repo';
import { listJobPage } from '@/db/opsRepo';
import { nowIso } from '@/db';
import { qldIsoDay } from '@/domain/qldTime';
import { autoLinkJob } from '@/domain/form72Link';
import { getSite } from '@/db/repo';
import { queryAssets } from '@/db/assetRepo';
import { emptyForm72 } from '@/domain/form72';
import { applyForm72Prefill, form72FromAssets } from '@/domain/formsFromAssets';
import { FORM_TITLE, OCCUPIER_COPY_BUSINESS_DAYS } from '@/export/form72';
import { loadPrefs } from '@/app-prefs';
import type { Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Button, EmptyState, H2, Screen, Txt,
} from '@/components/ui';
import { Form72Card } from '@/components/Form72Card';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';
import { describeLoadFailure } from '@/domain/loadFailure';

/**
 * The Form 72s raised for one site.
 *
 * A site commonly needs more than one — a towns main system and a boosted
 * system are separate forms, and each annual and each five-yearly test is its
 * own document. So this is a list rather than a single record hanging off the
 * site, and the system descriptor is what tells two of them apart.
 *
 * The one thing this screen exists to surface is the outstanding occupier copy.
 * The form being issued and the occupier having it are different events, and
 * only the second one satisfies MP 6.1 — a stack of issued forms nobody handed
 * over looks, from the office, exactly like a stack of completed work.
 */
export default function SiteForm72ListScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [forms, setForms] = useState<StoredForm72[]>([]);
  const [creating, setCreating] = useState(false);
  /** Why the site could not be read, so the screen says so instead of "no forms yet". */
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    setFailed(null);
    try {
      const [s, f] = await Promise.all([getSite(siteId), listForm72(siteId)]);
      setSite(s);
      setForms(f);
    } catch (e) {
      // The rejection used to go nowhere: the screen drew its empty state
      // about a read that had not happened, and the Start button did nothing.
      setFailed(describeLoadFailure(e, 'this site'));
    } finally {
      setLoaded(true);
    }
  }, [siteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onNew = useCallback(async () => {
    if (!site) {
      showAlert('Site not loaded', failed ?? 'Go back and open the site again.');
      return;
    }
    setCreating(true);
    try {
      const [prefs, assets] = await Promise.all([
        loadPrefs(),
        queryAssets({ siteId: site.id, limit: 5000 }),
      ]);
      /*
       * The register's hydrants, boosters, pumps, tanks and valve sets go on
       * the form before anybody types. The office's sites keep their
       * equipment in the register and nowhere else, and a form that opened
       * with every list blank on those sites was a form filled from memory.
       * Nothing the register does not hold is invented: the blank stays
       * blank, and Part A says what was and was not found.
       */
      const blank = emptyForm72({ id: '', siteId: site.id, siteName: site.name, now: '' });
      const parts = applyForm72Prefill(blank, form72FromAssets(assets));
      /*
       * The job the test is under, where the site has exactly one open
       * one. Two open jobs is a question the form screen asks; a guess here
       * would file a statutory document against the wrong work. A read
       * failure leaves the form unlinked rather than unmade.
       */
      let linked: { externalId: string; title: string } | undefined;
      try {
        const today = qldIsoDay(nowIso()) ?? '';
        const page = await listJobPage({ filter: 'all', today, siteId: site.id, limit: 50 });
        const pick = autoLinkJob(page.rows
          .filter((j) => j.externalId)
          .map((j) => ({ externalId: j.externalId!, title: j.title, status: j.status, scheduledFor: j.scheduledFor, completedAt: j.completedAt })));
        if (pick) linked = { externalId: pick.externalId, title: pick.title };
      } catch {
        linked = undefined;
      }
      const rec = await createForm72({
        jobExternalId: linked?.externalId,
        jobTitle: linked?.title,
        siteId: site.id,
        siteName: site.name,
        // The whole address, as the form prints it. The street alone left
        // the suburb off a statutory document.
        siteAddress: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' '),
        contractor: prefs.companyName,
        licenseeName: prefs.technicianName,
        licenceNumber: prefs.technicianLicence,
        parts,
      });
      router.push({ pathname: '/form72/[id]', params: { id: rec.id } });
    } catch (e) {
      showAlert('Could not start the form', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [site, failed]);

  const owing = forms.filter((f) => f.status === 'issued' && !f.copyGivenAt);
  const today = qldIsoDay(nowIso()) ?? '';

  /*
   * Opened with no site, from the home screen or a pinned tile: the list of
   * every Form 72 on the phone, which starts a new one from a job or a site.
   * The route stays the same so an old pinned tile keeps working.
   */
  if (!siteId) return <Redirect href="/form72" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Form 72' }} />

      <View>
        <H2>{FORM_TITLE}</H2>
        <Txt size="sm" tone="muted">
          {site?.name ?? ''} · Queensland Development Code MP 6.1
        </Txt>
      </View>

      {owing.length ? (
        <Banner
          tone="warn"
          title={`Occupier copy owed on ${owing.length} form${owing.length === 1 ? '' : 's'}`}
          body={`Copy due within ${OCCUPIER_COPY_BUSINESS_DAYS} business days of the test.`}
        />
      ) : null}

      <Button
        title="Start a Form 72"
        onPress={onNew}
        loading={creating}
        icon={<MaterialCommunityIcons name="plus" size={18} color={t.color.onAccent} />}
      />

      {failed ? <Banner tone="fail" title="Site not loaded" body={failed} /> : null}

      {loaded && !failed && !forms.length ? (
        <EmptyState
          icon="file-certificate-outline"
          title="No Form 72 for this site yet"
          body="Start one. It fills from the site and register."
        />
      ) : null}

      {forms.map((f) => (
        <Form72Card key={f.id} form={f} today={today} onDeleted={load} />
      ))}

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Issued forms can&rsquo;t be deleted. Keep them five years (MP 6.1).
      </Txt>
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}
