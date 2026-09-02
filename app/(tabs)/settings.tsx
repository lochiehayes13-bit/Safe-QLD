import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { holdAutoSync, runAutoSync, useAutoSync } from '@/simpro/autoSync';
import { describeAutoSync } from '@/simpro/autoSyncPolicy';
import { registerAutoSyncTask, unregisterAutoSyncTask } from '@/simpro/autoSyncTask';
import { clearKey as clearAiKey, hasKey as hasAiKey, storeKey as storeAiKey } from '@/ai/client';
import { PRIVACY_NOTE } from '@/ai/grounding';
import { loadPrefs, savePrefs, DEFAULT_PREFS, type Prefs } from '@/app-prefs';
import { clearExports, exportsSize } from '@/export/files';
import { listPhotoFiles } from '@/export/photoFiles';
import { photoStorageReport } from '@/db/photoRepo';
import { clearAllDrafts, listDrafts } from '@/hooks/useDraft';
import type { StorageReport } from '@/domain/photoStore';
import { pendingSyncCount } from '@/db/opsRepo';
import { bundledCatalogueSize, startCatalogueSeed } from '@/seed/catalogueSeed';
import { flushQueue, pullFromSimpro, type SyncProgress } from '@/simpro/sync';
import { describeStaleness, type SyncState } from '@/simpro/incremental';
import { readAllSyncState } from '@/simpro/watermark';
import { SimproResources } from '@/simpro/resources';
import { clearRateCard, loadRateCard, saveRateCard } from '@/db/rateCardRepo';
import { effectiveRateCard, formatCents, parseCents, type LabourRate, type ServiceFee } from '@/domain/rates';
import type { RateCardImport } from '@/simpro/rateCard';
import { formatBytes } from '@/share/pack';
import { MODE_BLURB, MODE_LABEL, readMode } from '@/domain/appMode';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';


export default function SettingsScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [secret, setSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [aiKey, setAiKey] = useState('');
  const [hasAi, setHasAi] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ name: string; readable: boolean; total: number | null; error?: string }[] | null>(null);
  /** What the last connection attempt actually established, kept beside the endpoint list. */
  const [verdict, setVerdict] = useState<{ ok: boolean; company: string | null; message: string } | null>(null);
  const [storage, setStorage] = useState(0);
  const [photos, setPhotos] = useState<StorageReport | null>(null);
  /*
   * Half-finished forms held in storage.
   *
   * useDraft keeps every form's unsaved state as it is typed, so a half-written
   * defect survives a lock screen, a call or a flat battery. It restores when
   * you come back to the same form — and if you never do, it is invisible.
   * listDrafts and clearAllDrafts were written for this and nothing called
   * them, so a technician had no way to know they had work sitting unfinished,
   * nor to clear it off a phone being handed on.
   */
  const [drafts, setDrafts] = useState<{ key: string; bytes: number }[]>([]);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState<SyncState[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  // Null until seeding settles, so a first launch shows "loading" rather than
  // an alarming zero against the bundled figure.
  const [catalogue, setCatalogue] = useState<number | null>(null);
  const [card, setCard] = useState<{ rates: LabourRate[]; fees: ServiceFee[]; pulledAt?: string }>({ rates: [], fees: [] });
  const [pulling, setPulling] = useState(false);
  const [pullReport, setPullReport] = useState<RateCardImport & { unreadable: { what: string; error: string }[] } | null>(null);
  const bundled = bundledCatalogueSize();
  /** What the automatic sync last did, and whether one is running now. */
  const auto = useAutoSync();

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void loadRateCard().then(setCard);
    void SimproClient.hasSecret().then(setHasSecret);
    void hasAiKey().then(setHasAi);
    void readAllSyncState().then(setSyncState);
    void pendingSyncCount().then(setPending);
    void startCatalogueSeed()
      .then(({ count }) => setCatalogue(count))
      .catch(() => setCatalogue(0));
    try {
      setStorage(exportsSize());
      void photoStorageReport(listPhotoFiles()).then(setPhotos);
      void listDrafts().then(setDrafts);
    } catch {
      setStorage(0);
    }
  }, []);

  // An automatic run changes what "how current" and "waiting to sync" say, and
  // this screen may well be open while one finishes.
  useEffect(() => {
    void readAllSyncState().then(setSyncState);
    void pendingSyncCount().then(setPending);
  }, [auto.record.lastRunAt]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void savePrefs(next);
      return next;
    });
  }, []);

  /**
   * A plain sentence back, so a mistyped rate is visible before it prices a job.
   *
   * Reads the card the same way the rest of the app does rather than the
   * preference fields directly: if a rate is dropped for being zero, this says
   * so instead of showing a figure nothing will use.
   */
  const effective = useMemo(() => effectiveRateCard(card, prefs), [card, prefs]);

  const saveSecret = async () => {
    if (!secret.trim()) return;
    await SimproClient.storeSecret(secret.trim());
    setSecret('');
    setHasSecret(true);
    Alert.alert('Saved', 'The client secret is held in this device’s secure keystore. It is never written to ordinary app storage and never leaves the device except to Simpro.');
  };

  /**
   * Reads the rate card straight out of the office system.
   *
   * Wholesale rather than merged: a rate deleted in Simpro has to disappear
   * here too, because a stale rate still selects and a missing one is reported.
   * Everything the pull inferred rather than read comes back with it and is
   * shown, so no figure on a quote is traceable to a guess nobody saw.
   */
  const pullRates = async () => {
    setPulling(true);
    setPullReport(null);
    try {
      const client = new SimproClient(simproConfigFromPrefs(prefs));
      const report = await new SimproResources(client).rateCard();
      setPullReport(report);
      if (!report.rates.length && !report.fees.length) {
        Alert.alert(
          'Nothing came back',
          report.unreadable.length
            ? report.unreadable.map((u) => `${u.what}: ${u.error}`).join('\n\n')
            : 'Simpro answered but had no rates or fees to give. The figures in Settings are still used.',
        );
        return;
      }
      await saveRateCard(report.rates, report.fees);
      setCard(await loadRateCard());
    } catch (e) {
      Alert.alert('Could not read the rate card', e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const forgetRates = async () => {
    await clearRateCard();
    setCard(await loadRateCard());
    setPullReport(null);
  };

  /**
   * One tap: authenticate, find the company, check what the key may read.
   *
   * This used to need two taps — the first only discovered the company ID and
   * asked you to start again — and it reported one boolean for three quite
   * different failures. `connect()` does the whole sequence against a client
   * built with the ID it finds, and hands back which stage stopped it.
   */
  const test = async () => {
    setTesting(true);
    setResult(null);
    setVerdict(null);
    try {
      const config = simproConfigFromPrefs(prefs);
      const report = await new SimproClient(config).connect();
      setResult(report.endpoints.length ? report.endpoints : null);

      // Write back a company the app discovered, so the next launch skips the
      // lookup — but never overwrite one that is already set and matching.
      if (report.company && report.company.id !== prefs.simproCompanyId) {
        update({ simproCompanyId: report.company.id });
      }

      setVerdict({
        ok: report.ready,
        company: report.company?.name ?? null,
        message: report.problem
          ?? `Connected to ${report.company?.name ?? 'Simpro'}. Everything this app needs is readable.`,
      });
    } catch (e) {
      setVerdict({ ok: false, company: null, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const configFor = () => simproConfigFromPrefs(prefs);

  const runPull = async () => {
    // Held so an automatic run cannot start alongside this one. Two pulls at
    // once each read the site list before the other has written to it, and a
    // site new to both is created twice.
    const release = holdAutoSync();
    setSyncing(true);
    setProgress(null);
    try {
      const r = await pullFromSimpro(configFor(), setProgress);
      setSyncState(await readAllSyncState());
      setCard(await loadRateCard());
      const incremental = Object.entries(r.modes)
        .filter(([, mode]) => mode === 'incremental')
        .map(([resource]) => resource);
      const lines = [
        `${r.sitesAdded} sites added, ${r.sitesUpdated} updated`,
        `${r.jobsAdded + r.jobsUpdated} jobs synced`,
        r.ratesRead || r.feesRead
          ? `${r.ratesRead} labour rate${r.ratesRead === 1 ? '' : 's'} and ${r.feesRead} service fee${r.feesRead === 1 ? '' : 's'} read`
          : 'No rate card came back — the figures in Settings are still used.',
        incremental.length
          ? `Only changes were fetched for ${incremental.join(' and ')}.`
          : 'Everything was fetched — this was a full sync.',
      ];
      // A server that ignores the filter returns everything and looks like a
      // busy day. Saying so is the difference between a slow sync and a sync
      // that is quietly not doing what it claims.
      if (r.notes.length) lines.push('', ...r.notes);
      if (r.errors.length) lines.push('', ...r.errors.slice(0, 5));
      Alert.alert('Sync complete', lines.join('\n'));
    } catch (e) {
      Alert.alert('Sync failed', e instanceof Error ? e.message : String(e));
    } finally {
      release();
      setSyncing(false);
      setProgress(null);
    }
  };

  const runFlush = async () => {
    const release = holdAutoSync();
    setSyncing(true);
    try {
      const r = await flushQueue(configFor());
      setPending(await pendingSyncCount());
      Alert.alert(
        'Queue sent',
        `${r.sent} sent${r.failed ? `, ${r.failed} failed and will retry` : ''}. ${r.remaining} still waiting.`,
      );
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : String(e));
    } finally {
      release();
      setSyncing(false);
    }
  };

  /**
   * Turning the automatic sync on or off.
   *
   * Saved before anything runs: the run reads the preference back from
   * storage, and `update` queues its write rather than finishing it, so a run
   * kicked off in the same breath would read the old value and report the
   * sync as switched off.
   */
  const setAutoSync = async (on: boolean) => {
    const next = { ...prefs, autoSync: on };
    setPrefs(next);
    await savePrefs(next);
    if (on) {
      void registerAutoSyncTask();
      void runAutoSync('foreground');
    } else {
      await unregisterAutoSyncTask();
    }
  };

  const mode = readMode(prefs.appMode);

  return (
    <Screen>
      <H2>What this device shows</H2>
      <Card onPress={() => router.push('/settings/mode')}>
        <Rowed gap={3}>
          <MaterialCommunityIcons name="account-switch-outline" size={22} color={t.color.accentText} />
          <View style={{ flex: 1 }}>
            <Txt weight="600">{MODE_LABEL[mode.mode]}</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{MODE_BLURB[mode.mode]}</Txt>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
        </Rowed>
        {mode.assumed ? (
          <Banner tone="warn" title="Mode not recognised" body={mode.assumed} />
        ) : null}
      </Card>

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

      <H2>Where things go</H2>
      <Card>
        <Field label="Supervisor" value={prefs.supervisorEmail} onChangeText={(v) => update({ supervisorEmail: v })} keyboardType="email-address" autoCapitalize="none" hint="Questions from Ask the office and leave requests go here. Leave requests copy accounts as well." />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Suggestions about the app" value={prefs.suggestionsEmail} onChangeText={(v) => update({ suggestionsEmail: v })} keyboardType="email-address" autoCapitalize="none" hint="Every suggestion goes out with the subject tag [Safe QLD app], so an inbox rule can file them." />
      </Card>

      <H2>Reading the standards for you</H2>
      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          The search works offline and always will. With a key set, it can also read the passages it
          found and tell you which one answers your question — and nothing else. Every claim it
          makes is numbered to a passage; anything it cannot source, it does not say.
        </Txt>
        <View style={{ height: t.space(2.5) }} />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{PRIVACY_NOTE}</Txt>
        <View style={{ height: t.space(3) }} />
        {hasAi ? (
          <>
            <Txt size="sm" tone="pass">A key is held in this device's keystore.</Txt>
            <View style={{ height: t.space(2.5) }} />
            <Button
              title="Remove the key"
              variant="ghost"
              compact
              onPress={() => { void clearAiKey().then(() => setHasAi(false)); }}
            />
          </>
        ) : (
          <>
            <Field
              label="Anthropic API key"
              value={aiKey}
              onChangeText={setAiKey}
              placeholder="sk-ant-…"
              autoCapitalize="none"
              hint="Held in the hardware keystore, never in ordinary app storage"
            />
            <View style={{ height: t.space(2.5) }} />
            <Button
              title="Save the key"
              variant="secondary"
              onPress={() => {
                if (!aiKey.trim()) return;
                void storeAiKey(aiKey).then(() => { setAiKey(''); setHasAi(true); });
              }}
            />
          </>
        )}
      </Card>

      <H2>Charge-out rates</H2>
      <Card>
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          The office system is the record. These are a copy so the app can put a figure on labour
          out of signal, and they stay on this device. Leave one blank and nothing is priced from
          it — hours are shown on their own rather than a total that might be wrong.
        </Txt>
        <View style={{ height: t.space(3) }} />
        <Label>Labour, excluding GST</Label>
        <Money label="Normal hours" cents={prefs.normalHoursSellCents} onCents={(c) => update({ normalHoursSellCents: c })} suffix="per hour" />
        <View style={{ height: t.space(2.5) }} />
        <Money label="After hours" cents={prefs.afterHoursSellCents} onCents={(c) => update({ afterHoursSellCents: c })} suffix="per hour" />
        <Divider />
        <Label>Site attendance, excluding GST</Label>
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          An attendance fee covers a set number of minutes on site. Only the time past that is
          charged again at the labour rate — charging the fee and then every hour double-bills the
          start of every job.
        </Txt>
        <View style={{ height: t.space(2.5) }} />
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 2 }}>
            <Money label="Normal hours" cents={prefs.attendanceNormalCents} onCents={(c) => update({ attendanceNormalCents: c })} />
          </View>
          <View style={{ flex: 1 }}>
            <Minutes label="Covers" minutes={prefs.attendanceNormalMinutes} onMinutes={(m) => update({ attendanceNormalMinutes: m })} />
          </View>
        </Rowed>
        <View style={{ height: t.space(2.5) }} />
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 2 }}>
            <Money label="After hours" cents={prefs.attendanceAfterHoursCents} onCents={(c) => update({ attendanceAfterHoursCents: c })} />
          </View>
          <View style={{ flex: 1 }}>
            <Minutes label="Covers" minutes={prefs.attendanceAfterHoursMinutes} onMinutes={(m) => update({ attendanceAfterHoursMinutes: m })} />
          </View>
        </Rowed>
        <Txt
          size="xs"
          tone={effective.rateSource === 'none' && effective.feeSource === 'none' ? 'warn' : 'muted'}
          style={{ marginTop: t.space(3), lineHeight: 17 }}
        >
          {effective.note}
        </Txt>
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 16 }}>
          Cost rates are not asked for and not held here. Only what a client is charged, so nothing
          on this device reveals a margin.
        </Txt>
      </Card>

      <Card>
        <Txt size="sm" weight="700">Follow the office system instead</Txt>
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
          Rates change in Simpro day to day, so they can be read from there rather than retyped
          here. A pull replaces the whole card — a rate deleted in Simpro disappears here too,
          because a stale rate still gets used where a missing one is reported.
        </Txt>
        <View style={{ height: t.space(3) }} />
        <Button title="Pull the rate card from Simpro" variant="secondary" onPress={pullRates} loading={pulling} />

        {card.rates.length || card.fees.length ? (
          <>
            <Divider />
            <Rowed style={{ justifyContent: 'space-between' }}>
              <Txt size="sm">Held from Simpro</Txt>
              <Txt size="sm" tone="muted">
                {card.rates.length} rate{card.rates.length === 1 ? '' : 's'}, {card.fees.length} fee{card.fees.length === 1 ? '' : 's'}
              </Txt>
            </Rowed>
            {card.rates.map((r) => (
              <Rowed key={r.id} style={{ justifyContent: 'space-between' }} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt size="sm">{r.name}</Txt>
                  <Txt size="xs" tone="faint">
                    {r.hours === 'normal' ? 'Normal hours' : 'After hours'} · {r.kind === 'callout' ? 'call-out' : 'hourly'}
                    {r.customerName ? ` · ${r.customerName}` : ''}
                  </Txt>
                </View>
                <Txt size="sm">{formatCents(r.sellCentsPerHour)}</Txt>
              </Rowed>
            ))}
            {card.fees.map((f) => (
              <Rowed key={f.id} style={{ justifyContent: 'space-between' }} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt size="sm">{f.name}</Txt>
                  <Txt size="xs" tone="faint">covers {f.includedLabourMinutes} minutes</Txt>
                </View>
                <Txt size="sm">{formatCents(f.chargeCents)}</Txt>
              </Rowed>
            ))}
            <View style={{ height: t.space(3) }} />
            <Button title="Forget the pulled card" variant="ghost" compact onPress={forgetRates} />
          </>
        ) : null}

        {pullReport ? (
          <>
            <Divider />
            {pullReport.suspect.length ? (
              <Banner
                tone="warn"
                title={`${pullReport.suspect.length} rate name${pullReport.suspect.length === 1 ? '' : 's'} will not match a customer`}
                body={pullReport.suspect.join('\n\n')}
              />
            ) : null}
            {pullReport.unreadable.length ? (
              <Banner
                tone="warn"
                title="Part of the card could not be read"
                body={pullReport.unreadable.map((u) => `${u.what}: ${u.error}`).join('\n')}
              />
            ) : null}
            {pullReport.skipped.length ? (
              <Txt size="xs" tone="warn" style={{ lineHeight: 17 }}>
                Left out: {pullReport.skipped.map((sk) => `${sk.name} (${sk.reason})`).join('; ')}.
              </Txt>
            ) : null}
            {pullReport.notes.length ? (
              <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                {pullReport.notes.join(' ')}
              </Txt>
            ) : null}
            {pullReport.margins.length ? (
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                Margin at the moment of the pull, for a sanity check only —{' '}
                {pullReport.margins.map((m) => `${m.name} ${m.percent}%`).join(', ')}. Not saved:
                the cost rates it was worked out from are dropped on the way in.
              </Txt>
            ) : null}
          </>
        ) : null}
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
        <Field label="Company ID" value={prefs.simproCompanyId} onChangeText={(v) => update({ simproCompanyId: v })} keyboardType="numeric" hint="Already set for this build. Clear it and connect to look it up again." />
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

        <Divider />
        <Label>Write test results back</Label>
        <Txt size="xs" tone="faint" style={{ marginTop: 4, marginBottom: t.space(2), lineHeight: 17 }}>
          Off by default. Everything else this app sends is appended — a note, an order — and can be
          deleted if it is wrong. This changes the last test result on the asset itself, which is what
          the office schedules from. Turn it on and check one asset in Simpro before trusting it with a
          full site. A result that is not a plain pass or fail stays in the job note, in words.
        </Txt>
        <Rowed gap={2}>
          <MaterialCommunityIcons
            name={prefs.simproWriteAssetTests ? 'database-edit' : 'database-lock'}
            size={18}
            color={prefs.simproWriteAssetTests ? t.color.warn : t.color.textFaint}
          />
          <Txt size="sm" tone={prefs.simproWriteAssetTests ? 'warn' : 'faint'} style={{ flex: 1 }}>
            {prefs.simproWriteAssetTests
              ? 'Completed tests are written onto the asset in Simpro.'
              : 'Results stay on this device and in the job note.'}
          </Txt>
          <Button
            title={prefs.simproWriteAssetTests ? 'Turn off' : 'Turn on'}
            variant={prefs.simproWriteAssetTests ? 'danger' : 'secondary'}
            compact
            onPress={() => update({ simproWriteAssetTests: !prefs.simproWriteAssetTests })}
          />
        </Rowed>

        <Divider />
        <Label>Sync automatically</Label>
        <Txt size="xs" tone="faint" style={{ marginTop: 4, marginBottom: t.space(2), lineHeight: 17 }}>
          Changes come down every half hour and everything is re-read once a day, whenever there is
          signal. Anything queued for the office goes the moment it can. No popups: this line says
          what happened last.
        </Txt>
        <Rowed gap={2}>
          <Txt
            size="sm"
            tone={!prefs.autoSync ? 'faint' : auto.record.lastError ? 'warn' : 'muted'}
            style={{ flex: 1, lineHeight: 19 }}
          >
            {!prefs.autoSync
              ? 'Off. Sync now still works.'
              : auto.inFlight
                ? 'Syncing now.'
                : describeAutoSync(auto.record, new Date())}
          </Txt>
          <Switch
            value={prefs.autoSync}
            onValueChange={(on) => { void setAutoSync(on); }}
            trackColor={{ true: t.color.accent, false: t.color.border }}
          />
        </Rowed>

        <View style={{ height: t.space(3) }} />
        <Button title="Connect to Simpro" onPress={test} loading={testing} />
        {verdict ? (
          <Rowed gap={2} style={{ marginTop: t.space(2), alignItems: 'flex-start' }}>
            <MaterialCommunityIcons
              name={verdict.ok ? 'check-circle' : 'alert-circle'}
              size={18}
              color={verdict.ok ? t.color.pass : t.color.fail}
              style={{ marginTop: 1 }}
            />
            <Txt size="sm" tone={verdict.ok ? 'pass' : 'fail'} style={{ flex: 1, lineHeight: 19 }}>
              {verdict.message}
            </Txt>
          </Rowed>
        ) : null}
        <View style={{ height: t.space(2) }} />
        <Rowed gap={2}>
          <Button
            title="Sync now"
            style={{ flex: 1 }}
            onPress={runPull}
            loading={syncing}
            disabled={auto.inFlight && !syncing}
          />
          <Button
            title={pending ? `Send ${pending}` : 'Send queue'}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={runFlush}
            loading={syncing}
            disabled={!pending || (auto.inFlight && !syncing)}
          />
        </Rowed>
        {progress ? (
          <Txt size="xs" tone="muted" style={{ marginTop: t.space(2) }}>
            {progress.stage} {progress.total ? `${progress.done} of ${progress.total}` : ''}
          </Txt>
        ) : null}
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
          Sync now re-reads everything, which takes a few minutes; the automatic sync fetches only what
          changed. Either way a pull fills in blanks and adds records. It never overwrites something you
          typed on site — the person standing in the building knows better than the office record.
        </Txt>
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

      <H2>How current this device is</H2>
      <Card>
        {syncState.filter((st) => st.lastSyncedAt || st.lastRecordCount > 0).length === 0 ? (
          <Txt size="sm" tone="muted">
            Nothing has been synced from the office yet. Everything held here was entered on this
            device or imported from a file.
          </Txt>
        ) : (
          syncState.map((st, i) => {
            const age = describeStaleness(st, new Date());
            return (
              <View key={st.resource}>
                {i > 0 ? <Divider /> : null}
                <Rowed style={{ justifyContent: 'space-between' }}>
                  <Txt size="sm" style={{ textTransform: 'capitalize' }}>{st.resource}</Txt>
                  <Txt
                    size="sm"
                    tone={age.state === 'stale' ? 'fail' : age.state === 'ageing' ? 'warn' : 'muted'}
                  >
                    {age.label}
                  </Txt>
                </Rowed>
                {st.mode === 'full' && st.lastSyncedAt ? (
                  <Txt size="xs" tone="faint">
                    Fetched in full — this endpoint does not filter by change date.
                  </Txt>
                ) : null}
              </View>
            );
          })
        )}
        <View style={{ height: t.space(2) }} />
        <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
          Safe QLD works offline, so what you are looking at is a copy taken when there was last a
          signal — not a live view of the office system. That is why this says how old it is.
        </Txt>
      </Card>

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
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Photographs</Txt>
          <Txt size="sm" tone={photos?.missing.length ? 'fail' : 'muted'}>
            {photos ? `${photos.count} kept, ${formatBytes(photos.totalBytes)}` : 'checking…'}
          </Txt>
        </Rowed>
        {photos?.warnings.length ? (
          <Txt size="xs" tone={photos.missing.length ? 'fail' : 'warn'} style={{ lineHeight: 16 }}>
            {photos.warnings.join(' ')}
          </Txt>
        ) : null}
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Unfinished forms</Txt>
          <Txt size="sm" tone={drafts.length ? 'warn' : 'muted'}>
            {drafts.length
              ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'}, ${formatBytes(
                drafts.reduce((n, d) => n + d.bytes, 0))}`
              : 'none'}
          </Txt>
        </Rowed>
        {drafts.length ? (
          <Txt size="xs" tone="muted" style={{ lineHeight: 16 }}>
            Forms typed into and not saved. They come back when you reopen the same form, so
            clearing them throws that work away.
          </Txt>
        ) : null}
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Parts catalogue</Txt>
          <Txt size="sm" tone={catalogue === null ? 'muted' : catalogue < bundled ? 'warn' : 'muted'}>
            {catalogue === null ? 'loading…' : `${catalogue.toLocaleString()} of ${bundled.toLocaleString()}`}
          </Txt>
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
        {drafts.length ? (
          <Button
            title={`Clear ${drafts.length} unfinished form${drafts.length === 1 ? '' : 's'}`}
            variant="ghost"
            onPress={() => {
              /*
               * Named as throwing work away, because that is what it is. The
               * whole reason drafts exist is that losing half-written work is
               * the loudest complaint about the systems technicians are made
               * to use, and a button that quietly did it would be the same
               * fault wearing this app's colours.
               */
              Alert.alert(
                'Throw away unfinished forms?',
                `${drafts.length} form${drafts.length === 1 ? ' has' : 's have'} been typed into and `
                + 'not saved. They come back when you reopen the same form. Clearing them cannot be '
                + 'undone.',
                [
                  { text: 'Keep them', style: 'cancel' },
                  {
                    text: 'Throw away',
                    style: 'destructive',
                    onPress: () => {
                      void clearAllDrafts().then((n) => {
                        setDrafts([]);
                        Alert.alert('Cleared', `${n} draft${n === 1 ? '' : 's'} removed.`);
                      });
                    },
                  },
                ],
              );
            }}
          />
        ) : null}
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

/**
 * A dollars field over a whole-cents preference.
 *
 * The stored figure is cents but nobody types cents, so the draft is the
 * technician's own text and only a reading that parses cleanly is committed.
 * An unset rate shows blank rather than $0.00: a zero reads as a price, and
 * every screen that uses these treats zero as "not set".
 */
function Money({
  label, cents, onCents, suffix,
}: {
  label: string;
  cents: number;
  onCents: (cents: number) => void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (cents > 0 ? (cents / 100).toFixed(2) : '');
  const typed = draft?.trim() ?? '';
  const bad = typed !== '' && parseCents(typed) === undefined;
  return (
    <Field
      label={label}
      value={shown}
      keyboardType="decimal-pad"
      placeholder="0.00"
      suffix={suffix}
      hint={bad ? 'Not an amount — write it like 136.88' : undefined}
      onChangeText={(v) => {
        setDraft(v);
        if (v.trim() === '') { onCents(0); return; }
        const c = parseCents(v);
        if (c !== undefined && c >= 0) onCents(c);
      }}
    />
  );
}

/** Whole minutes, kept as a draft for the same reason as Money. */
function Minutes({
  label, minutes, onMinutes,
}: {
  label: string;
  minutes: number;
  onMinutes: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field
      label={label}
      value={draft ?? String(minutes)}
      keyboardType="numeric"
      suffix="min"
      onChangeText={(v) => {
        setDraft(v);
        const digits = v.replace(/[^\d]/g, '');
        onMinutes(digits === '' ? 0 : Math.min(24 * 60, parseInt(digits, 10)));
      }}
    />
  );
}
