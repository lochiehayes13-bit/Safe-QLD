import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createForm72, deleteForm72, listForm72, type StoredForm72 } from '@/db/form72Repo';
import { getSite } from '@/db/repo';
import { queryAssets } from '@/db/assetRepo';
import { validateForm72, emptyForm72 } from '@/domain/form72';
import { applyForm72Prefill, form72FromAssets } from '@/domain/formsFromAssets';
import {
  FORM_TITLE, OCCUPIER_COPY_BUSINESS_DAYS, occupierCopyDue,
} from '@/export/form72';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import type { Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, H2, Rowed, Screen, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

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

  const load = useCallback(async () => {
    if (!siteId) return;
    const [s, f] = await Promise.all([getSite(siteId), listForm72(siteId)]);
    setSite(s);
    setForms(f);
  }, [siteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onNew = useCallback(async () => {
    if (!site) return;
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
      const rec = await createForm72({
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
  }, [site]);

  const onDelete = useCallback((form: StoredForm72) => {
    showAlert(
      'Delete this draft?',
      'Nothing on it is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteForm72(form.id);
              await load();
            } catch (e) {
              showAlert('Not deleted', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [load]);

  const owing = forms.filter((f) => f.status === 'issued' && !f.copyGivenAt);

  if (!siteId) return <ContextGate kind="site" what="the Form 72s raised" title="Form 72" />;

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
          title={`${owing.length} issued form${owing.length === 1 ? '' : 's'} the occupier has not been given`}
          body={`The copy is due within ${OCCUPIER_COPY_BUSINESS_DAYS} business days of the work. `
            + 'Producing the PDF is not the same event as handing it over, so the app asks separately.'}
        />
      ) : null}

      <Button
        title="Start a Form 72"
        onPress={onNew}
        loading={creating}
        icon={<MaterialCommunityIcons name="plus" size={18} color={t.color.onAccent} />}
      />

      {!forms.length ? (
        <EmptyState
          title="No Form 72 for this site yet"
          body={'This is the department’s form for periodic testing and maintenance of a '
            + 'hydrant or sprinkler system. Start one and it fills in from the site, its asset '
            + 'register and your licence details.'}
        />
      ) : null}

      {forms.map((f) => {
        const blockers = f.status === 'draft'
          ? validateForm72(f).filter((i) => i.blocking).length
          : 0;
        const due = occupierCopyDue(f.testDate);
        return (
          <Card key={f.id} onPress={() => router.push({ pathname: '/form72/[id]', params: { id: f.id } })}>
            <Rowed>
              <View style={{ flex: 1 }}>
                <Txt weight="700">{f.systemLabel || 'System not named'}</Txt>
                <Txt size="sm" tone="muted">
                  {f.testDate ? formatAuDate(f.testDate) : 'No test date'}
                  {f.licenceNumber ? ` · ${f.licenceNumber}` : ''}
                </Txt>
              </View>
              <Chip
                label={f.status === 'issued' ? 'Issued' : 'Draft'}
                tone={f.status === 'issued' ? 'pass' : 'warn'}
              />
            </Rowed>

            <Rowed gap={2} wrap>
              {blockers ? (
                <Chip label={`${blockers} to do before issue`} tone="warn" />
              ) : null}
              {f.status === 'draft' && !blockers ? <Chip label="Ready to issue" tone="pass" /> : null}
              {f.status === 'issued' && f.copyGivenAt ? (
                <Chip label={`Occupier copy ${formatAuDate(f.copyGivenAt)}`} tone="pass" />
              ) : null}
              {f.status === 'issued' && !f.copyGivenAt ? (
                <Chip
                  // Never "no deadline". A date the app cannot work out — a
                  // test dated beyond the holidays Queensland has appointed, or
                  // no test date at all — is still ten business days somebody
                  // has to count by hand.
                  label={due.date ? `Copy due ${formatAuDate(due.date)}` : 'Copy due — count it by hand'}
                  tone="fail"
                />
              ) : null}
              {f.systemResult !== 'na' ? (
                <Chip
                  label={f.systemResult === 'pass' ? 'System passed' : 'System failed'}
                  tone={f.systemResult === 'pass' ? 'pass' : 'fail'}
                />
              ) : null}
              {f.criticalDefectsIdentified ? <Chip label="Critical defect" tone="fail" /> : null}
            </Rowed>

            {f.status === 'draft' ? (
              <Rowed>
                <View style={{ flex: 1 }} />
                <Button title="Delete draft" variant="ghost" compact onPress={() => onDelete(f)} />
              </Rowed>
            ) : null}
          </Card>
        );
      })}

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        An issued form cannot be deleted. MP 6.1 requires the person who carried out the
        maintenance to keep a record of it for at least five years.
      </Txt>
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}
