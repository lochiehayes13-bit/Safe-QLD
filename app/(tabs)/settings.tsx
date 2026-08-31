import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SimproClient, type SimproConfig } from '@/simpro/client';
import { clearExports, exportsSize } from '@/export/files';
import { pendingSyncCount } from '@/db/opsRepo';
import { formatBytes } from '@/share/pack';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';

const PREFS_KEY = 'safeqld.prefs';

interface Prefs {
  technicianName: string;
  technicianLicence: string;
  vehicleRego: string;
  companyName: string;
  simproDomain: string;
  simproCompanyId: string;
  simproClientId: string;
  simproProxyUrl: string;
}

const DEFAULTS: Prefs = {
  technicianName: '',
  technicianLicence: '',
  vehicleRego: '',
  companyName: 'Safe QLD Pty Ltd',
  simproDomain: 'safeqld.simprosuite.com',
  simproCompanyId: '',
  simproClientId: '',
  simproProxyUrl: '',
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export default function SettingsScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [secret, setSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ name: string; readable: boolean; total: number | null; error?: string }[] | null>(null);
  const [storage, setStorage] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void SimproClient.hasSecret().then(setHasSecret);
    void pendingSyncCount().then(setPending);
    try {
      setStorage(exportsSize());
    } catch {
      setStorage(0);
    }
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const saveSecret = async () => {
    if (!secret.trim()) return;
    await SimproClient.storeSecret(secret.trim());
    setSecret('');
    setHasSecret(true);
    Alert.alert('Saved', 'The client secret is held in this device’s secure keystore. It is never written to ordinary app storage and never leaves the device except to Simpro.');
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const config: SimproConfig = {
        buildDomain: prefs.simproDomain,
        companyId: prefs.simproCompanyId,
        clientId: prefs.simproClientId,
        proxyUrl: prefs.simproProxyUrl || undefined,
      };
      const client = new SimproClient(config);

      if (!prefs.simproCompanyId) {
        const companies = await client.listCompanies();
        if (companies.length) {
          update({ simproCompanyId: String(companies[0]!.ID) });
          Alert.alert('Company found', `Using "${companies[0]!.Name}" (ID ${companies[0]!.ID}). Run the test again to check endpoint access.`);
          return;
        }
        Alert.alert('No companies returned', 'The credentials authenticated but no company was visible to them.');
        return;
      }

      const report = await client.testConnection();
      setResult(report.endpoints);
    } catch (e) {
      Alert.alert('Connection failed', e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Screen>
      <H2>You</H2>
      <Card>
        <Field label="Name" value={prefs.technicianName} onChangeText={(v) => update({ technicianName: v })} autoCapitalize="words" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Licence number" value={prefs.technicianLicence} onChangeText={(v) => update({ technicianLicence: v })} autoCapitalize="characters" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Vehicle rego" value={prefs.vehicleRego} onChangeText={(v) => update({ vehicleRego: v })} autoCapitalize="characters" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Company" value={prefs.companyName} onChangeText={(v) => update({ companyName: v })} />
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
          These prefill reports, baseline data and timesheets so you are not retyping them on every job.
        </Txt>
      </Card>

      <H2>Simpro</H2>
      <Banner
        tone="warn"
        title="About storing the client secret here"
        body="A secret on every technician's phone is a genuine risk — anyone with the device and a way past the lock screen has your API access. It is kept in the hardware keystore, but the safer arrangement is a Safe QLD server holding the secret and this app talking to that. Set a proxy URL below and no secret is stored on the device at all."
      />
      <Card>
        <Field label="Build domain" value={prefs.simproDomain} onChangeText={(v) => update({ simproDomain: v })} autoCapitalize="none" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Company ID" value={prefs.simproCompanyId} onChangeText={(v) => update({ simproCompanyId: v })} keyboardType="numeric" hint="Leave blank and run the test — it will find it" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Client ID" value={prefs.simproClientId} onChangeText={(v) => update({ simproClientId: v })} autoCapitalize="none" />
        <View style={{ height: t.space(2.5) }} />
        <Field
          label="Proxy URL (recommended)"
          value={prefs.simproProxyUrl}
          onChangeText={(v) => update({ simproProxyUrl: v })}
          autoCapitalize="none"
          placeholder="https://api.safeqld.com.au/simpro"
          hint="When set, the device holds no secret at all"
        />

        {!prefs.simproProxyUrl ? (
          <>
            <Divider />
            <Label>Client secret</Label>
            <View style={{ height: t.space(1.5) }} />
            {hasSecret ? (
              <Rowed gap={2}>
                <MaterialCommunityIcons name="lock-check" size={18} color={t.color.pass} />
                <Txt size="sm" tone="pass" style={{ flex: 1 }}>A secret is stored in the keystore.</Txt>
                <Button
                  title="Remove"
                  variant="danger"
                  compact
                  onPress={async () => {
                    await SimproClient.clearSecret();
                    setHasSecret(false);
                  }}
                />
              </Rowed>
            ) : (
              <>
                <Field label="" value={secret} onChangeText={setSecret} autoCapitalize="none" placeholder="Paste the client secret" />
                <View style={{ height: t.space(2) }} />
                <Button title="Save to keystore" onPress={saveSecret} disabled={!secret.trim()} />
              </>
            )}
          </>
        ) : null}

        <View style={{ height: t.space(3) }} />
        <Button title="Test connection" variant="secondary" onPress={test} loading={testing} />
      </Card>

      {result ? (
        <Card>
          <Label>Endpoint access</Label>
          <Txt size="xs" tone="faint" style={{ marginTop: 4, marginBottom: t.space(2), lineHeight: 17 }}>
            Simpro permissions are per endpoint, so a key that reads jobs can still be blocked from timesheets.
          </Txt>
          {result.map((e) => (
            <Rowed key={e.name} gap={2} style={{ paddingVertical: t.space(1.5) }}>
              <MaterialCommunityIcons
                name={e.readable ? 'check-circle' : 'close-circle'}
                size={16}
                color={e.readable ? t.color.pass : t.color.fail}
              />
              <Txt size="sm" style={{ flex: 1 }}>{e.name}</Txt>
              <Txt size="sm" tone="muted">{e.readable ? (e.total !== null ? `${e.total.toLocaleString()} records` : 'readable') : 'no access'}</Txt>
            </Rowed>
          ))}
        </Card>
      ) : null}

      <H2>Storage</H2>
      <Card>
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Generated exports</Txt>
          <Txt size="sm" tone="muted">{formatBytes(storage)}</Txt>
        </Rowed>
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Waiting to sync</Txt>
          <Txt size="sm" tone={pending ? 'warn' : 'muted'}>{pending} record{pending === 1 ? '' : 's'}</Txt>
        </Rowed>
        <View style={{ height: t.space(3) }} />
        <Button
          title="Clear generated exports"
          variant="secondary"
          onPress={() => {
            Alert.alert('Clear exports?', 'This removes generated spreadsheets and PDFs from this device. Anything already sent is unaffected, and sites, reports and defects are not touched.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                  const n = clearExports();
                  setStorage(0);
                  Alert.alert('Cleared', `${n} file${n === 1 ? '' : 's'} removed.`);
                },
              },
            ]);
          }}
        />
      </Card>

      <H2>About</H2>
      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          Safe QLD field application. Everything is stored on this device — there is no account and no cloud copy unless you
          share or sync it deliberately.
        </Txt>
        <View style={{ height: t.space(2) }} />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Calculations and reference data follow Australian practice and cite their sources where they have one. They do not
          replace the current standard, the panel manufacturer's documentation, or your own judgement on site.
        </Txt>
        <View style={{ height: t.space(2) }} />
        <Button title="Safe QLD website" variant="ghost" compact onPress={() => void Linking.openURL('https://www.safeqldfire.com.au')} />
      </Card>
    </Screen>
  );
}
