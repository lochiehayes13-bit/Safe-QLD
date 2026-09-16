import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { searchContacts, type ContactRecord } from '@/db/moreRepo';
import { getCustomer } from '@/db/mirrorRepo';
import { getSiteByExternalId } from '@/db/searchRepo';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { telHref } from '@/domain/jobPresentation';
import { describeLoadFailure } from '@/domain/loadFailure';
import { contextId } from '@/domain/screenContext';
import { smsHref } from '@/domain/search';
import { everSynced } from '@/simpro/watermark';
import { useTheme } from '@/theme';
import { Bounce, Reveal } from '@/components/motion';
import { Banner, Card, EmptyState, Rowed, Screen, SearchBox, Txt } from '@/components/ui';

/**
 * Everyone the office has a number for.
 *
 * Two and a half thousand people, searched in the database by name, email,
 * phone, position or department. Opened from a site or a customer it shows
 * only theirs — the site's people are the ones a technician on the doorstep
 * wants, and that scoping is a query on the id inside the record rather
 * than a filter over the whole list.
 *
 * Each row carries the number itself as a button: ringing somebody is the
 * whole reason to open this list, and a row that has to be opened first to
 * be rung is a row with one tap too many.
 */

const PAGE = 100;

export default function ContactsScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteExternalId?: string; customerExternalId?: string; q?: string }>();
  const siteExternalId = contextId(params.siteExternalId);
  const customerExternalId = contextId(params.customerExternalId);
  const [typed, setTyped] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [rows, setRows] = useState<ContactRecord[] | null>(null);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [empty, setEmpty] = useState<EmptyStateWords | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const found = await searchContacts(query, { siteExternalId, customerExternalId, limit: PAGE });
      setRows(found);
      // The heading says whose people these are, by the name the phone
      // holds for the site or the customer rather than by their number.
      if (siteExternalId) {
        const site = await getSiteByExternalId(siteExternalId);
        setScope(site ? `at ${site.name}` : 'at this site');
      } else if (customerExternalId) {
        const customer = await getCustomer(customerExternalId);
        setScope(customer ? `for ${customer.name}` : 'for this customer');
      } else {
        setScope(undefined);
      }
      if (!found.length && !query.trim() && !siteExternalId && !customerExternalId) {
        const prefs = await loadPrefs();
        setEmpty(officeEmptyState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'contacts',
        ));
      } else {
        setEmpty(null);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the contacts'));
    }
  }, [query, siteExternalId, customerExternalId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <>
      <Stack.Screen options={{ title: scope ? `People ${scope}` : 'Contacts' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <SearchBox value={typed} onChange={setTyped} placeholder="Name, number, email, role or department" />
          {rows ? (
            <Txt size="xs" tone="faint">
              {rows.length >= PAGE ? `First ${PAGE} shown. Search to narrow.` : `${rows.length} ${rows.length === 1 ? 'person' : 'people'}${scope ? ` ${scope}` : ''}`}
            </Txt>
          ) : null}
        </View>
        <FlatList
          data={rows ?? []}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={failed ? <Banner tone="fail" title="The contacts could not be read" body={failed} /> : null}
          ListEmptyComponent={rows === null && !failed ? null : (
            empty ? (
              <EmptyState icon="account-group-outline" title={empty.title} body={empty.body} />
            ) : (
              <EmptyState
                icon="account-search-outline"
                title={query.trim() ? 'Nobody matched' : scope ? `Nobody listed ${scope}` : 'No contacts'}
                body={query.trim()
                  ? 'Try a first name on its own, or part of the number.'
                  : 'The office lists no contact here. The site or customer record may still carry a name.'}
              />
            )
          )}
          renderItem={({ item, index }) => {
            const row = <ContactRow contact={item} />;
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

function ContactRow({ contact: c }: { contact: ContactRecord }) {
  const t = useTheme();
  const number = c.cellPhone ?? c.workPhone ?? c.altPhone;
  const call = telHref(number);
  const sms = smsHref(c.cellPhone);
  const where = [...c.sites.map((s) => s.name), ...c.customers.map((x) => x.name)].filter(Boolean);
  return (
    <Card onPress={() => router.push({ pathname: '/contacts/[id]', params: { id: c.id } })}>
      <Rowed gap={3} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700" numberOfLines={1}>{c.name || 'Unnamed contact'}</Txt>
          {c.position || c.department ? (
            <Txt size="sm" tone="muted" numberOfLines={1}>{[c.position, c.department].filter(Boolean).join(' · ')}</Txt>
          ) : null}
          {where.length ? (
            <Txt size="xs" tone="faint" numberOfLines={1}>
              {where.length > 2 ? `${where.slice(0, 2).join(', ')} and ${where.length - 2} more` : where.join(', ')}
            </Txt>
          ) : null}
          {number ? <Txt size="xs" tone="faint" mono numberOfLines={1}>{number}</Txt> : null}
        </View>
        {call ? (
          <Bounce onPress={() => void Linking.openURL(call)} haptic="light" scaleTo={0.9} accessibilityLabel={`Ring ${c.name}`}>
            <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="phone-outline" size={22} color={t.color.accentText} />
            </View>
          </Bounce>
        ) : null}
        {sms ? (
          <Bounce onPress={() => void Linking.openURL(sms)} haptic="light" scaleTo={0.9} accessibilityLabel={`Text ${c.name}`}>
            <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="message-text-outline" size={22} color={t.color.accentText} />
            </View>
          </Bounce>
        ) : null}
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} style={{ marginTop: 12 }} />
      </Rowed>
    </Card>
  );
}
