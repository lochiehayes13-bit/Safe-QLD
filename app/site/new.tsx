import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { createSite } from '@/db/repo';
import { rememberPosition } from '@/geo/geocode';
import { Button, Field, H2, Screen, Txt } from '@/components/ui';

/**
 * Create a site by hand — no config file needed to start using the app.
 *
 * The map's place card arrives here with the place's name, address and
 * position filled in. The street field takes the whole address line as the
 * place gave it; the suburb is left for the person rather than guessed from
 * it, since a wrong suburb on a site is worse than a blank one.
 */
export default function NewSiteScreen() {
  const p = useLocalSearchParams<{ name?: string; address?: string; postcode?: string; client?: string; latitude?: string; longitude?: string }>();
  const [name, setName] = useState(p.name ?? '');
  const [address, setAddress] = useState(p.address ?? '');
  const [suburb, setSuburb] = useState('');
  const [postcode, setPostcode] = useState(p.postcode ?? '');
  const [client, setClient] = useState(p.client ?? '');
  const [siteRef, setSiteRef] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the site a name so you can find it later.');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        address: address.trim() || undefined,
        suburb: suburb.trim() || undefined,
        postcode: postcode.trim() || undefined,
      };
      const site = await createSite({
        name: name.trim(),
        ...fields,
        clientName: client.trim() || undefined,
        siteRef: siteRef.trim() || undefined,
      });
      // The pin lands where the place was found, not where the geocoder
      // re-reads the typed address to be — keyed on the fields as saved, so
      // the map finds it under the same key the site now carries.
      if (p.latitude && p.longitude) {
        await rememberPosition(fields, { latitude: Number(p.latitude), longitude: Number(p.longitude) });
      }
      router.replace({ pathname: '/site/[id]', params: { id: site.id } });
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New site' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Only the name is required. Everything else can be filled in later, and appears on exported reports.
        </Txt>

        <Field label="Site name" value={name} onChangeText={setName} placeholder="e.g. Brisbane Square Tower" autoCapitalize="words" />
        <Field label="Street address" value={address} onChangeText={setAddress} placeholder="266 George St" autoCapitalize="words" />
        <Field label="Suburb" value={suburb} onChangeText={setSuburb} autoCapitalize="words" />
        <Field label="Postcode" value={postcode} onChangeText={setPostcode} keyboardType="numeric" />

        <H2>Job details</H2>
        <Field label="Client" value={client} onChangeText={setClient} placeholder="Building owner or managing agent" autoCapitalize="words" />
        <Field label="Site reference" value={siteRef} onChangeText={setSiteRef} placeholder="Your job or asset number" autoCapitalize="characters" />

        <Button title="Create site" onPress={save} loading={saving} />
      </Screen>
    </>
  );
}
