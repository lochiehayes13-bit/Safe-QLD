import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createForm72, deleteForm72, listForm72, type StoredForm72 } from '@/db/form72Repo';
import { getSite } from '@/db/repo';
import { validateForm72 } from '@/domain/form72';
import {
  FORM_TITLE, OCCUPIER_COPY_BUSINESS_DAYS, occupierCopyDueBy,
} from '@/export/form72';
import { loadPrefs } from '@/app-prefs';
import type { Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, H2, Rowed, Screen, Txt,
} from '@/components/ui';

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
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
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
      const prefs = await loadPrefs();
      const rec = await createForm72({
        siteId: site.id,
        siteName: site.name,
        siteAddress: site.address ?? '',
        contractor: prefs.companyName,
        licenseeName: prefs.technicianName,
        licenceNumber: prefs.technicianLicence,
      });
      router.push({ pathname: '/form72/[id]', params: { id: rec.id } });
    } catch (e) {
      Alert.alert('Could not start the form', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [site]);

  const onDelete = useCallback((form: StoredForm72) => {
    Alert.alert(
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
              Alert.alert('Not deleted', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [load]);

  const owing = forms.filter((f) => f.status === 'issued' && !f.copyGivenAt);

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
        icon={<MaterialCommunityIcons name="plus" size={18} color="#fff" />}
      />

      {!forms.length ? (
        <EmptyState
          title="No Form 72 for this site yet"
          body={'This is the department’s form for periodic testing and maintenance of a '
            + 'hydrant or sprinkler system. Start one and it fills in from the site and your '
            + 'licence details.'}
        />
      ) : null}

      {forms.map((f) => {
        const blockers = f.status === 'draft'
          ? validateForm72(f).filter((i) => i.blocking).length
          : 0;
        const due = occupierCopyDueBy(f.testDate);
        return (
          <Card key={f.id} onPress={() => router.push({ pathname: '/form72/[id]', params: { id: f.id } })}>
            <Rowed>
              <View style={{ flex: 1 }}>
                <Txt weight="700">{f.systemLabel || 'System not named'}</Txt>
                <Txt size="sm" tone="muted">
                  {f.testDate ? auDate(f.testDate) : 'No test date'}
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
                <Chip label={`Occupier copy ${auDate(f.copyGivenAt)}`} tone="pass" />
              ) : null}
              {f.status === 'issued' && !f.copyGivenAt ? (
                <Chip label={due ? `Copy due ${auDate(due)}` : 'Copy outstanding'} tone="fail" />
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

const auDate = (iso?: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
