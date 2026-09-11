import React, { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getContact, type ContactRecord } from '@/db/moreRepo';
import { getCustomer } from '@/db/mirrorRepo';
import { getSiteByExternalId } from '@/db/searchRepo';
import { mailHref, telHref } from '@/domain/jobPresentation';
import { describeLoadFailure } from '@/domain/loadFailure';
import { smsHref } from '@/domain/search';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, Chip, H2, Label, Rowed, Screen, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * One person the office has a number for.
 *
 * Ring, text or email in one tap, then the sites and customers they belong
 * to. Each of those opens the record on this phone where the sync has
 * matched it — a contact carries the office's site number, the site screen
 * opens by the phone's, and the lookup between them is what decides
 * whether the row is a link or a name.
 */

interface Place {
  id: string;
  name: string;
  /** The phone's own id for the record, where it holds it. */
  localId?: string;
}

export default function ContactScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [contact, setContact] = useState<ContactRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [sites, setSites] = useState<Place[]>([]);
  const [customers, setCustomers] = useState<Place[]>([]);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (!id) return;
      setFailed(null);
      try {
        const c = await getContact(id);
        if (cancelled) return;
        setContact(c);
        setMissing(!c);
        if (!c) return;
        const [s, cu] = await Promise.all([
          Promise.all(c.sites.map(async (ref): Promise<Place> => ({ id: ref.id, name: ref.name, localId: (await getSiteByExternalId(ref.id))?.id }))),
          Promise.all(c.customers.map(async (ref): Promise<Place> => ({ id: ref.id, name: ref.name, localId: (await getCustomer(ref.id))?.externalId }))),
        ]);
        if (cancelled) return;
        setSites(s);
        setCustomers(cu);
      } catch (e) {
        if (!cancelled) setFailed(describeLoadFailure(e, 'this contact'));
      }
    })();
    return () => { cancelled = true; };
  }, [id, reloads]));

  if (!contact) {
    return (
      <RecordGate
        missing={missing}
        what="contact"
        why="Contacts come down with a sync once Simpro is connected. This one is not on the phone yet, or the office has removed them."
        failed={failed}
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  }

  const c = contact;
  const mobile = telHref(c.cellPhone);
  const text = smsHref(c.cellPhone);
  const work = telHref(c.workPhone);
  const alt = telHref(c.altPhone);
  const email = mailHref(c.email);
  const anyWay = mobile || work || alt || email;

  return (
    <>
      <Stack.Screen options={{ title: c.name || 'Contact' }} />
      <Screen>
        <Txt size="xl" weight="700">{[c.title, c.name].filter(Boolean).join(' ') || 'Unnamed contact'}</Txt>
        <Rowed gap={1.5} wrap>
          {c.position ? <Chip label={c.position} /> : null}
          {c.department ? <Chip label={c.department} /> : null}
          <Chip label={`#${c.id}`} />
        </Rowed>

        <Card>
          <Label>Reach them</Label>
          <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
            {mobile && c.cellPhone ? (
              <Rowed gap={2}>
                <Button
                  title={`Ring ${c.cellPhone}`}
                  onPress={() => void Linking.openURL(mobile)}
                  style={{ flex: 1 }}
                  icon={<MaterialCommunityIcons name="cellphone" size={18} color={t.color.onAccent} />}
                />
                {text ? (
                  <Button
                    title="Text"
                    variant="secondary"
                    onPress={() => void Linking.openURL(text)}
                    icon={<MaterialCommunityIcons name="message-text-outline" size={18} color={t.color.text} />}
                  />
                ) : null}
              </Rowed>
            ) : null}
            {work && c.workPhone ? (
              <Button
                title={`Ring ${c.workPhone}`}
                variant={mobile ? 'secondary' : 'primary'}
                onPress={() => void Linking.openURL(work)}
                icon={<MaterialCommunityIcons name="phone-outline" size={18} color={mobile ? t.color.text : t.color.onAccent} />}
              />
            ) : null}
            {alt && c.altPhone ? (
              <Button
                title={`Ring ${c.altPhone}`}
                variant="secondary"
                onPress={() => void Linking.openURL(alt)}
                icon={<MaterialCommunityIcons name="phone-outline" size={18} color={t.color.text} />}
              />
            ) : null}
            {email && c.email ? (
              <Button
                title={c.email}
                variant="secondary"
                onPress={() => void Linking.openURL(email)}
                icon={<MaterialCommunityIcons name="email-outline" size={18} color={t.color.text} />}
              />
            ) : null}
            {!anyWay ? <Txt size="sm" tone="faint">The office has no number or email for them, only the name.</Txt> : null}
          </View>
        </Card>

        {c.notes ? (
          <Card>
            <Label>Office notes</Label>
            <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{c.notes}</Txt>
          </Card>
        ) : null}

        <H2>Sites</H2>
        {sites.length ? (
          sites.map((s) => (
            <Card key={s.id} onPress={s.localId ? () => router.push({ pathname: '/site/[id]', params: { id: s.localId! } }) : undefined}>
              <Rowed gap={3}>
                <MaterialCommunityIcons name="office-building-outline" size={22} color={s.localId ? t.color.accentText : t.color.textFaint} />
                <View style={{ flex: 1 }}>
                  <Txt weight="600">{s.name || `Site ${s.id}`}</Txt>
                  {!s.localId ? <Txt size="xs" tone="faint">Not on this phone yet — it comes with the next site sync.</Txt> : null}
                </View>
                {s.localId ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
              </Rowed>
            </Card>
          ))
        ) : (
          <Txt size="sm" tone="faint">The office lists no site for them.</Txt>
        )}

        <H2>Customers</H2>
        {customers.length ? (
          customers.map((x) => (
            <Card key={x.id} onPress={x.localId ? () => router.push({ pathname: '/customer/[id]', params: { id: x.localId! } }) : undefined}>
              <Rowed gap={3}>
                <MaterialCommunityIcons name="domain" size={22} color={x.localId ? t.color.accentText : t.color.textFaint} />
                <View style={{ flex: 1 }}>
                  <Txt weight="600">{x.name || `Customer ${x.id}`}</Txt>
                  {!x.localId ? <Txt size="xs" tone="faint">Not on this phone yet — it comes with the next customer sync.</Txt> : null}
                </View>
                {x.localId ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
              </Rowed>
            </Card>
          ))
        ) : (
          <Txt size="sm" tone="faint">The office lists no customer for them.</Txt>
        )}

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
          Simpro contact {c.id}.{c.dateModified ? ` Last changed at the office ${formatAuDate(c.dateModified)}.` : ''}
        </Txt>
      </Screen>
    </>
  );
}
