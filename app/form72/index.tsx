import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listForm72ToFollowUp, type Form72ToFollowUp } from '@/db/form72Repo';
import { nowIso } from '@/db';
import { qldIsoDay } from '@/domain/qldTime';
import { copyState, followUpGroups, followUpMatches } from '@/domain/formFollowUp';
import { describeLoadFailure } from '@/domain/loadFailure';
import { OCCUPIER_COPY_BUSINESS_DAYS } from '@/export/form72';
import { useTheme } from '@/theme';
import { Form72Card } from '@/components/Form72Card';
import {
  Banner, Button, Card, EmptyState, Screen, SearchBox, SectionHeader, Txt,
} from '@/components/ui';

/**
 * Every Form 72 on the phone, across every site.
 *
 * The per-site list answers "what has this building got". This one answers
 * what is left to do: drafts not yet issued, then issued forms whose occupier
 * copy is still owed with the day it falls due, then everything settled. The
 * order comes from the query (listForm72ToFollowUp); the sections only split
 * it where the state changes.
 */
export default function Form72ListScreen() {
  const t = useTheme();
  const today = qldIsoDay(nowIso()) ?? '';
  const [forms, setForms] = useState<Form72ToFollowUp[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setForms(await listForm72ToFollowUp());
    } catch (e) {
      setForms((was) => was ?? []);
      setFailed(describeLoadFailure(e, 'the Form 72s on this phone'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The building as every site search finds it, not only as the form names it.
  const shown = useMemo(
    () => (forms ?? []).filter((f) => followUpMatches(f, query)),
    [forms, query],
  );

  const groups = useMemo(() => followUpGroups(shown), [shown]);
  const late = useMemo(
    () => (forms ?? []).filter((f) => copyState(f, today).kind === 'late').length,
    [forms, today],
  );
  const owedAll = useMemo(() => followUpGroups(forms ?? []).owed.length, [forms]);

  const card = (f: Form72ToFollowUp) => (
    <Form72Card key={f.id} form={f} today={today} showSite onDeleted={load} />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Form 72' }} />

      <Button
        title="New Form 72"
        onPress={() => router.push('/form72/new')}
        icon={<MaterialCommunityIcons name="plus" size={18} color={t.color.onAccent} />}
      />

      {failed ? <Banner tone="fail" title="Forms not loaded" body={failed} /> : null}

      {owedAll ? (
        <Banner
          tone={late ? 'fail' : 'warn'}
          title={late
            ? `${late} occupier cop${late === 1 ? 'y' : 'ies'} overdue`
            : `Occupier copy owed on ${owedAll} form${owedAll === 1 ? '' : 's'}`}
          body={`Copy due within ${OCCUPIER_COPY_BUSINESS_DAYS} business days of the test.`}
        />
      ) : null}

      {forms === null ? (
        <Card><Txt size="sm" tone="muted">Loading forms…</Txt></Card>
      ) : !forms.length ? (
        failed ? null : (
          <EmptyState
            icon="file-certificate-outline"
            title="No Form 72s yet"
            body="Start one from a job or a site."
          />
        )
      ) : (
        <>
          <SearchBox value={query} onChange={setQuery} placeholder="Site, suburb, client, system or job" />

          {!shown.length ? (
            <Txt size="sm" tone="muted">No form matches that.</Txt>
          ) : null}

          {groups.drafts.length ? (
            <>
              <SectionHeader title={`Drafts (${groups.drafts.length})`} />
              {groups.drafts.map(card)}
            </>
          ) : null}

          {groups.owed.length ? (
            <>
              <SectionHeader title={`Occupier copy owed (${groups.owed.length})`} />
              {groups.owed.map(card)}
            </>
          ) : null}

          {groups.settled.length ? (
            <>
              <SectionHeader title={`Issued (${groups.settled.length})`} />
              {groups.settled.map(card)}
            </>
          ) : null}

          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            Issued forms can&rsquo;t be deleted. Keep them five years (MP 6.1).
          </Txt>
        </>
      )}
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}
