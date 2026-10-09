import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { holdAutoSync, runAutoSync, useAutoSync } from '@/simpro/autoSync';
import { INCREMENTAL_EVERY_MS, describeAutoSync } from '@/simpro/autoSyncPolicy';
import { registerAutoSyncTask, unregisterAutoSyncTask } from '@/simpro/autoSyncTask';
import { clearPlacesKey, hasPlacesKey, storePlacesKey } from '@/geo/placesKey';
import { WEBSITE_PHOTOS_INBOX, endpointProblem } from '@/domain/photoSend';
import { SUGGESTION_TAG } from '@/domain/suggestions';
import { officeSetupStartsOpen, pastedSummary, storageWords } from '@/domain/settingsWords';
import { loadPrefs, patchPrefs, DEFAULT_PREFS, type Prefs } from '@/app-prefs';
import { clearExports, exportsSize } from '@/export/files';
import { listPhotoFiles } from '@/export/photoFiles';
import { photoStorageReport } from '@/db/photoRepo';
import { clearAllDrafts, listDrafts } from '@/hooks/useDraft';
import type { StorageReport } from '@/domain/photoStore';
import { attachmentQueueSummary, failedSync, pendingSyncCount, type AttachmentQueueSummary } from '@/db/opsRepo';
import { bundledCatalogueSize, startCatalogueSeed } from '@/seed/catalogueSeed';
import { flushQueue, pullFromSimpro, type SyncProgress } from '@/simpro/sync';
import { describeStaleness, type SyncState } from '@/simpro/incremental';
import { readAllSyncState } from '@/simpro/watermark';
import { SimproResources } from '@/simpro/resources';
import { readPastedConnection } from '@/simpro/oauthDetails';
import { clearRateCard, loadRateCard, saveRateCard } from '@/db/rateCardRepo';
import { effectiveRateCard, formatCents, parseCents, type LabourRate, type ServiceFee } from '@/domain/rates';
import type { RateCardImport } from '@/simpro/rateCard';
import { formatBytes } from '@/share/pack';
import { signOut } from '@/simpro/auth';
import { forgetSignInSkipped } from '@/simpro/signInFlow';
import { OFFICE_APPLICATION } from '@/simpro/office';
import { readSignedOutReason, readUserSession, type UserSession } from '@/simpro/userSession';
import { describeBuild, describeUpdateCheck } from '@/domain/updateCheck';
import { buildInfo } from '@/update/buildInfo';
import {
  checkForUpdate, clearToken as clearGhToken, hasToken as hasGhToken, storeToken as storeGhToken, useUpdateCheck,
} from '@/update/check';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { THEME_CHOICE_LABEL, useThemeChoice } from '@/theme/choice';


export default function SettingsScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [secret, setSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  /**
   * Where the secret a token request carries comes from: pasted, shipped with
   * the build, the proxy, or nowhere. Null until it has been asked.
   */
  const [secretSource, setSecretSource] = useState<'proxy' | 'keystore' | 'built-in' | 'none' | null>(null);
  /** The whole oAuth2 details block off Simpro, pasted rather than picked apart by hand. */
  const [pastedDetails, setPastedDetails] = useState('');
  /** The optional Google Places key for the map's place search. Keystore only; see geo/placesKey. */
  const [placesKey, setPlacesKey] = useState('');
  const [hasPlaces, setHasPlaces] = useState(false);
  const [ghToken, setGhToken] = useState('');
  /** The person signed in to Simpro on this phone, and why they are not if the app ended it. */
  const [session, setSession] = useState<UserSession | null>(null);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  const [hasGh, setHasGh] = useState(false);
  /**
   * Office setup, open or shut once someone has tapped it. Null until then,
   * and it follows `officeSetupStartsOpen`: shut unless this phone has no
   * way to reach Simpro yet.
   */
  const [officeChoice, setOfficeChoice] = useState<boolean | null>(null);
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
  /** Photographs bound for Simpro job attachments, by where they stand in the queue. */
  const [attachments, setAttachments] = useState<AttachmentQueueSummary>({ pending: 0, unknown: 0, failed: 0, sent: 0 });
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
  /** Whether a newer build has been published, and when that was last asked. */
  const updateCheck = useUpdateCheck();
  const build = useMemo(() => buildInfo(), []);
  /** The web build keeps keys and records in the browser, not a keystore or a database file. */
  const words = useMemo(() => storageWords(Platform.OS === 'web', Math.round(INCREMENTAL_EVERY_MS / 60_000)), []);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void loadRateCard().then(setCard);
    void SimproClient.hasSecret().then(setHasSecret);
    void hasPlacesKey().then(setHasPlaces);
    void hasGhToken().then(setHasGh);
    void readUserSession().then(setSession);
    void readSignedOutReason().then(setSignedOutReason);
    void readAllSyncState().then(setSyncState);
    void pendingSyncCount().then(setPending);
    void attachmentQueueSummary().then(setAttachments);
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

  useEffect(() => {
    void SimproClient.secretSource(simproConfigFromPrefs(prefs)).then(setSecretSource);
  }, [prefs.simproClientId, prefs.simproDomain, prefs.simproProxyUrl, hasSecret]);

  // Sign-in and the staff picker push over this screen and pop back; what
  // they changed has to show without a remount.
  useFocusEffect(useCallback(() => {
    void loadPrefs().then(setPrefs);
    void readUserSession().then(setSession);
    void readSignedOutReason().then(setSignedOutReason);
  }, []));

  // An automatic run changes what "how current" and "waiting to sync" say, and
  // this screen may well be open while one finishes.
  useEffect(() => {
    void readAllSyncState().then(setSyncState);
    void pendingSyncCount().then(setPending);
    void attachmentQueueSummary().then(setAttachments);
  }, [auto.record.lastRunAt]);

  /*
   * The change goes on screen at once and is merged onto what is on disk.
   *
   * This used to write the whole blob back from this screen's own copy of it,
   * which is a clobber the moment anything else writes a preference — and the
   * theme lock is exactly that: chosen here, persisted on its own, and undone
   * by the next edit on this screen writing a snapshot taken before it.
   */
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    void patchPrefs(patch).catch(() => {
      /*
       * The field keeps what was typed and the next visit shows what is
       * stored, which is the same shape every other write on this screen has.
       */
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
    showAlert('Saved', `Client secret saved ${words.keyPlace}.`);
  };

  /**
   * Take the connection out of the block Simpro hands out with an API key.
   *
   * The four fields below are the four things in that block, and copying it
   * across by eye is where a setup goes wrong — always on the secret, which
   * is the longest and whose failure only ever says "the office rejected
   * this device". Pasting it whole is one action and cannot mistype.
   *
   * A field the paste does not carry is left exactly as it is: a rotated
   * secret arrives on its own, and blanking the client ID beside it would
   * take a working phone off the air.
   */
  const applyPastedDetails = async () => {
    const read = readPastedConnection(pastedDetails);
    if (read.problem) {
      showAlert('Nothing read', read.problem);
      return;
    }
    try {
      if (read.found.clientSecret) await SimproClient.storeSecret(read.found.clientSecret);
      const next: Partial<Prefs> = {};
      if (read.found.domain) next.simproDomain = read.found.domain;
      if (read.found.clientId) next.simproClientId = read.found.clientId;
      if (Object.keys(next).length) update(next);
      if (read.found.clientSecret) setHasSecret(true);
      setPastedDetails('');
      showAlert('Connection updated', pastedSummary(read.fields));
    } catch (e) {
      showAlert('Couldn’t save', e instanceof Error ? e.message : String(e));
    }
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
        showAlert(
          'Nothing came back',
          report.unreadable.length
            ? report.unreadable.map((u) => `${u.what}: ${u.error}`).join('\n\n')
            : 'Simpro has no rates or fees. The rates typed here are used.',
        );
        return;
      }
      await saveRateCard(report.rates, report.fees);
      setCard(await loadRateCard());
    } catch (e) {
      showAlert('Couldn’t read the rates', e instanceof Error ? e.message : String(e));
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
        message: report.problem ?? `Connected to ${report.company?.name ?? 'Simpro'}.`,
      });
    } catch (e) {
      setVerdict({ ok: false, company: null, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const configFor = () => simproConfigFromPrefs(prefs);

  /**
   * Fetches from the office: what changed, or the whole lot.
   *
   * Two buttons rather than one, because they answer different questions and
   * one of them is expensive. "Sync now" is the everyday press and asks only
   * for what changed, which is seconds. "Fetch everything" is for the moment
   * somebody has reason to doubt what is on the phone, and says in its own
   * confirmation what it will cost before it starts.
   */
  const runPull = async (everything = false) => {
    // Held so an automatic run cannot start alongside this one. Two pulls at
    // once each read the site list before the other has written to it, and a
    // site new to both is created twice.
    const release = holdAutoSync();
    setSyncing(true);
    setProgress(null);
    try {
      const r = await pullFromSimpro(configFor(), setProgress, { incremental: !everything });
      setSyncState(await readAllSyncState());
      setCard(await loadRateCard());
      const incremental = Object.entries(r.modes)
        .filter(([, mode]) => mode === 'incremental')
        .map(([resource]) => resource);
      const lines = [
        `${r.sitesAdded} sites added, ${r.sitesUpdated} updated.`,
        `${r.jobsAdded + r.jobsUpdated} jobs synced.`,
        r.ratesRead || r.feesRead
          ? `${r.ratesRead} labour rate${r.ratesRead === 1 ? '' : 's'} and ${r.feesRead} service fee${r.feesRead === 1 ? '' : 's'} read.`
          : 'No rate card came back.',
        incremental.length
          ? `Only changes fetched for ${incremental.join(' and ')}.`
          : 'Full sync.',
      ];
      // A server that ignores the filter returns everything and looks like a
      // busy day. Saying so is the difference between a slow sync and a sync
      // that is quietly not doing what it claims.
      if (r.notes.length) lines.push('', ...r.notes);
      if (r.errors.length) lines.push('', ...r.errors.slice(0, 5));
      showAlert(everything ? 'Everything fetched' : 'Sync complete', lines.join('\n'));
    } catch (e) {
      showAlert('Sync failed', e instanceof Error ? e.message : String(e));
    } finally {
      release();
      setSyncing(false);
      setProgress(null);
    }
  };

  /**
   * Asks before a full re-read, because the cost is the whole point of asking.
   *
   * Not a warning about damage — a full pull is safe, it just takes minutes,
   * and a technician who pressed it expecting the quick one is a technician
   * standing in a car park watching a progress bar. So the confirmation says
   * how long and what the quick button does instead.
   */
  const confirmFetchEverything = () => {
    showAlert(
      'Fetch everything?',
      'Re-reads every site, job and asset. Takes a few minutes on good signal.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Fetch everything', onPress: () => { void runPull(true); } },
      ],
    );
  };

  const runFlush = async () => {
    const release = holdAutoSync();
    setSyncing(true);
    try {
      const r = await flushQueue(configFor());
      setPending(await pendingSyncCount());
      setAttachments(await attachmentQueueSummary());
      /*
       * "Failed" covers two things the person needs to tell apart: a send
       * the queue will try again on its own, and one it has given up on,
       * which only the outbound screen can move. The result does not say
       * which, so the given-up rows are counted from the queue afterwards.
       * A run that stopped before the queue was through is neither — the
       * rows it never reached are untouched, and the reason is the news.
       */
      const gaveUp = (await failedSync()).length;
      const retrying = Math.max(0, r.failed - gaveUp);
      const lines = [
        `${r.sent} sent.`,
        retrying ? `${retrying} will retry.` : null,
        gaveUp ? `${gaveUp} couldn't be sent. See Waiting to send.` : null,
        r.stopped ? `Could not send: ${r.stopped.reason}` : null,
        `${r.remaining} still waiting.`,
      ].filter((line): line is string => !!line);
      showAlert(r.stopped ? 'Sending stopped' : 'Queue sent', lines.join('\n'));
    } catch (e) {
      showAlert('Could not send', e instanceof Error ? e.message : String(e));
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
    setPrefs((prev) => ({ ...prev, autoSync: on }));
    // Awaited, and merged onto disk: the task registration below reads the
    // stored value back, and the comment above is about exactly that race.
    await patchPrefs({ autoSync: on });
    if (on) {
      void registerAutoSyncTask();
      void runAutoSync('foreground');
    } else {
      await unregisterAutoSyncTask();
    }
  };

  const themeChoice = useThemeChoice();

  // Every "Connect to Simpro" button lands here; open the fields that fix it.
  const officeOpen = officeChoice ?? officeSetupStartsOpen(secretSource);

  /** Photos bound for Simpro, in one line. */
  const photoQueueLine = [
    attachments.pending
      ? `${attachments.pending} photo${attachments.pending === 1 ? '' : 's'} waiting to upload`
      : 'No photos waiting to upload',
    attachments.unknown ? `${attachments.unknown} sent with no reply` : null,
    attachments.failed ? `${attachments.failed} couldn't be sent. See Waiting to send.` : null,
  ].filter(Boolean).join(' · ') + (attachments.sent ? ` · ${attachments.sent} uploaded` : '');

  const synced = syncState.filter((st) => st.lastSyncedAt || st.lastRecordCount > 0);

  return (
    <Screen>

      <H2>You</H2>
      <Card>
        {prefs.simproEmployeeId ? (
          <Rowed gap={3}>
            <MaterialCommunityIcons name="account-check-outline" size={22} color={t.color.pass} />
            <View style={{ flex: 1 }}>
              <Txt weight="700">{prefs.technicianName || `Employee ${prefs.simproEmployeeId}`}</Txt>
              <Txt size="sm" tone="muted">
                Employee {prefs.simproEmployeeId}{prefs.simproEmployeeEmail ? ` · ${prefs.simproEmployeeEmail}` : ''}
              </Txt>
            </View>
          </Rowed>
        ) : (
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            Pick your name from the staff list.
          </Txt>
        )}
        <View style={{ height: t.space(2.5) }} />
        <Button
          title={prefs.simproEmployeeId ? 'Change who I am' : 'Pick who I am'}
          variant="secondary"
          onPress={() => router.push('/whoami')}
        />
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
          My day uses the name picked here.
        </Txt>
        {session ? (
          <>
            <View style={{ height: t.space(2.5) }} />
            <Rowed gap={2}>
              <Txt size="sm" tone="pass" style={{ flex: 1 }}>
                Signed in{session.label ? ` as ${session.label}` : ''}.
              </Txt>
              <Button
                title="Sign out"
                variant="ghost"
                compact
                onPress={() => {
                  void Promise.all([signOut(), forgetSignInSkipped()]).then(() => { setSession(null); setSignedOutReason(null); });
                }}
              />
            </Rowed>
          </>
        ) : signedOutReason ? (
          <>
            <View style={{ height: t.space(2.5) }} />
            <Banner tone="warn" title="Signed out" body={signedOutReason} />
          </>
        ) : null}
        <Divider />
        <Field label="Name" value={prefs.technicianName} onChangeText={(v) => update({ technicianName: v })} autoCapitalize="words" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Licence number" value={prefs.technicianLicence} onChangeText={(v) => update({ technicianLicence: v })} autoCapitalize="characters" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Vehicle rego" value={prefs.vehicleRego} onChangeText={(v) => update({ vehicleRego: v })} autoCapitalize="characters" />
        <View style={{ height: t.space(2.5) }} />
        <Field label="Company" value={prefs.companyName} onChangeText={(v) => update({ companyName: v })} />
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
          Used on reports and timesheets.
        </Txt>
        <Divider />
        <Label>New timesheet weeks</Label>
        <View style={{ height: t.space(2) }} />
        <Segmented<'' | 'schedule' | 'manual'>
          options={[
            { value: 'schedule', label: 'From my schedule' },
            { value: 'manual', label: 'I type mine' },
          ]}
          value={prefs.timesheetFill}
          onChange={(v) => update({ timesheetFill: v })}
        />
      </Card>

      {/*
        * Locking the colours.
        *
        * The app is built dark-first — the rooms it is used in are switch
        * rooms, risers and basement carparks — and it followed the phone. On a
        * handset that switches to light at sunrise that means the app turns
        * white at exactly the hour somebody walks into the first plant room of
        * the day, and back to dark on the drive home when it does not matter.
        */}
      <Card>
        <Label>Colours</Label>
        <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
          {(['system', 'dark', 'light'] as const).map((c) => (
            <Chip
              key={c}
              label={THEME_CHOICE_LABEL[c]}
              selected={themeChoice.choice === c}
              onPress={() => themeChoice.setChoice(c)}
            />
          ))}
        </Rowed>
      </Card>

      <H2>Where things go</H2>
      <Card>
        <Field
          label="Supervisor"
          value={prefs.supervisorEmail}
          onChangeText={(v) => update({ supervisorEmail: v })}
          keyboardType="email-address"
          autoCapitalize="none"
          hint="Ask the office and Things I need go here."
        />
        <View style={{ height: t.space(2.5) }} />
        <Field
          label="App suggestions"
          value={prefs.suggestionsEmail}
          onChangeText={(v) => update({ suggestionsEmail: v })}
          keyboardType="email-address"
          autoCapitalize="none"
          hint={`Subject starts with ${SUGGESTION_TAG}.`}
        />
      </Card>

      <H2>The map</H2>
      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          Optional. Adds business names to map search.
        </Txt>
        <View style={{ height: t.space(3) }} />
        {hasPlaces ? (
          <>
            <Txt size="sm" tone="pass">Places key saved {words.keyPlace}.</Txt>
            <View style={{ height: t.space(2.5) }} />
            <Button
              title="Remove key"
              variant="ghost"
              compact
              onPress={() => { void clearPlacesKey().then(() => setHasPlaces(false)); }}
            />
          </>
        ) : (
          <>
            <Field
              label="Google Places key"
              value={placesKey}
              onChangeText={setPlacesKey}
              placeholder="AIza…"
              autoCapitalize="none"
              hint={`Kept ${words.keyPlace}.`}
            />
            <View style={{ height: t.space(2.5) }} />
            <Button
              title="Save key"
              variant="secondary"
              disabled={!placesKey.trim()}
              onPress={() => {
                if (!placesKey.trim()) return;
                void storePlacesKey(placesKey).then(() => { setPlacesKey(''); setHasPlaces(true); });
              }}
            />
          </>
        )}
      </Card>

      <H2>Sync</H2>
      <Card>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <Txt size="sm" weight="700">Sync automatically</Txt>
            <Txt
              size="sm"
              tone={!prefs.autoSync ? 'faint' : auto.record.lastError ? 'warn' : 'muted'}
              style={{ lineHeight: 19 }}
            >
              {!prefs.autoSync
                ? 'Off. Sync now still works.'
                : auto.inFlight
                  ? 'Syncing now.'
                  : describeAutoSync(auto.record, new Date())}
            </Txt>
          </View>
          <Switch
            value={prefs.autoSync}
            onValueChange={(on) => { void setAutoSync(on); }}
            trackColor={{ true: t.color.accent, false: t.color.border }}
          />
        </Rowed>
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
          {words.autoSync}
        </Txt>
        {prefs.simproSendPhotos ? (
          <Txt
            size="sm"
            tone={attachments.failed || attachments.unknown ? 'warn' : attachments.pending ? 'muted' : 'faint'}
            style={{ marginTop: t.space(2), lineHeight: 19 }}
          >
            {photoQueueLine}
          </Txt>
        ) : null}
        <View style={{ height: t.space(3) }} />
        <Rowed gap={2}>
          <Button
            title="Sync now"
            style={{ flex: 1 }}
            onPress={() => runPull()}
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
        <View style={{ height: t.space(2) }} />
        <Button
          title="Fetch everything"
          variant="secondary"
          onPress={confirmFetchEverything}
          loading={syncing}
          disabled={auto.inFlight && !syncing}
        />
        {progress ? (
          <Txt size="xs" tone="muted" style={{ marginTop: t.space(2) }}>
            {progress.stage} {progress.total ? `${progress.done} of ${progress.total}` : ''}
          </Txt>
        ) : null}
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
          A sync never overwrites what you typed on site.
        </Txt>
      </Card>

      <H2>Last synced</H2>
      <Card>
        {synced.length === 0 ? (
          <Txt size="sm" tone="muted">Nothing synced yet.</Txt>
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
                  <Txt size="xs" tone="faint">Always fetched in full.</Txt>
                ) : null}
              </View>
            );
          })
        )}
      </Card>

      <H2>Storage</H2>
      <Card>
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{words.dataKept}</Txt>
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Exports</Txt>
          <Txt size="sm" tone="muted">{formatBytes(storage)}</Txt>
        </Rowed>
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Waiting to sync</Txt>
          <Txt size="sm" tone={pending ? 'warn' : 'muted'}>{pending} record{pending === 1 ? '' : 's'}</Txt>
        </Rowed>
        <Divider />
        <Rowed style={{ justifyContent: 'space-between' }}>
          <Txt size="sm">Photos</Txt>
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
            Reopen the form to pick up where you left off.
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
          title="Clear exports"
          variant="secondary"
          onPress={() => {
            showAlert('Clear exports?', 'Deletes generated spreadsheets and PDFs. Sites, reports and defects stay.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                  const n = clearExports();
                  setStorage(0);
                  showAlert('Cleared', `${n} file${n === 1 ? '' : 's'} removed.`);
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
              showAlert(
                'Throw away unfinished forms?',
                `${drafts.length} unsaved form${drafts.length === 1 ? '' : 's'}. This can't be undone.`,
                [
                  { text: 'Keep them', style: 'cancel' },
                  {
                    text: 'Throw away',
                    style: 'destructive',
                    onPress: () => {
                      void clearAllDrafts().then((n) => {
                        setDrafts([]);
                        showAlert('Cleared', `${n} draft${n === 1 ? '' : 's'} removed.`);
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
          Safe QLD field app. Syncs with Simpro.
        </Txt>
        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
          Reference only. Check the current standard and the panel maker’s manual.
        </Txt>
        <Divider />
        <Label>This build</Label>
        <Txt size="sm" style={{ marginTop: 4 }}>{describeBuild(build)}</Txt>
        {build.version ? <Txt size="xs" tone="faint">Version {build.version}</Txt> : null}
        <Txt
          size="xs"
          tone={updateCheck.record.result?.verdict === 'newer' ? 'accent' : updateCheck.record.lastError ? 'warn' : 'faint'}
          style={{ marginTop: t.space(1.5), lineHeight: 17 }}
        >
          {updateCheck.inFlight ? 'Checking for a newer build…' : describeUpdateCheck(updateCheck.record, new Date(), build)}
        </Txt>
        <View style={{ height: t.space(2) }} />
        <Button
          title="Check now"
          variant="secondary"
          compact
          loading={updateCheck.inFlight}
          onPress={() => { void checkForUpdate({ force: true }); }}
        />
        <View style={{ height: t.space(2) }} />
        <Button title="Safe QLD website" variant="ghost" compact onPress={() => void Linking.openURL('https://www.safeqldfire.com.au')} />
      </Card>

      {/*
        * Everything a technician never touches, behind one tap: the Simpro
        * connection, write-back switches, charge-out rates and the update
        * token. A stray edit in here takes a phone off Simpro.
        */}
      <Card
        style={{ marginTop: t.space(4) }}
        onPress={() => setOfficeChoice(!officeOpen)}
      >
        <Rowed gap={3}>
          <MaterialCommunityIcons name="office-building-cog-outline" size={22} color={t.color.textMuted} />
          <View style={{ flex: 1 }}>
            <Txt weight="700">Office setup</Txt>
            <Txt size="xs" tone="faint">Simpro connection, rates and keys.</Txt>
          </View>
          <MaterialCommunityIcons name={officeOpen ? 'chevron-up' : 'chevron-down'} size={20} color={t.color.textFaint} />
        </Rowed>
      </Card>

      {officeOpen ? (
        <>
          {secretSource ? (
            <Banner
              tone={secretSource === 'none' ? 'warn' : 'info'}
              title={secretSource === 'none' ? 'Secret needed' : 'Simpro connection'}
              body={secretSource === 'built-in'
                ? `Uses the built-in “${OFFICE_APPLICATION.name}” application. If its secret is regenerated, paste the new one below.`
                : secretSource === 'keystore'
                  ? 'Using the pasted secret. Remove it to go back to the built-in one.'
                  : secretSource === 'proxy'
                    ? 'Requests go through the proxy, which holds the secret.'
                    : 'Paste the secret for this client ID below before syncing.'}
            />
          ) : null}

          <Card>
            <Label>Paste oAuth2 details</Label>
            <Txt size="xs" tone="faint" style={{ marginTop: 4, marginBottom: t.space(2), lineHeight: 17 }}>
              Paste the whole block from System Setup, API keys.
            </Txt>
            <Field
              label=""
              value={pastedDetails}
              onChangeText={setPastedDetails}
              autoCapitalize="none"
              multiline
              placeholder={'Token URL: https://…/oauth2/token\nclient_id: …\nclient_secret: …'}
            />
            <View style={{ height: t.space(2) }} />
            <Button title="Save details" onPress={applyPastedDetails} disabled={!pastedDetails.trim()} />
            <Divider />
            <Field label="Build domain" value={prefs.simproDomain} onChangeText={(v) => update({ simproDomain: v })} autoCapitalize="none" />
            <View style={{ height: t.space(2.5) }} />
            <Field label="Company ID" value={prefs.simproCompanyId} onChangeText={(v) => update({ simproCompanyId: v })} keyboardType="numeric" hint="Clear it and connect to look it up." />
            <View style={{ height: t.space(2.5) }} />
            <Field label="Client ID" value={prefs.simproClientId} onChangeText={(v) => update({ simproClientId: v })} autoCapitalize="none" />
            <View style={{ height: t.space(2.5) }} />
            <Field
              label="Proxy URL"
              value={prefs.simproProxyUrl}
              onChangeText={(v) => update({ simproProxyUrl: v })}
              autoCapitalize="none"
              placeholder="https://api.safeqld.com.au/simpro"
              hint="Optional. The proxy holds the secret instead."
            />

            {!prefs.simproProxyUrl ? (
              <>
                <Divider />
                <Label>Client secret</Label>
                <View style={{ height: t.space(1.5) }} />
                {hasSecret ? (
                  <Rowed gap={2}>
                    <MaterialCommunityIcons name="lock-check" size={18} color={t.color.pass} />
                    <Txt size="sm" tone="pass" style={{ flex: 1 }}>
                      Pasted secret saved {words.keyPlace}.
                      {secretSource === 'keystore' && OFFICE_APPLICATION.clientId === prefs.simproClientId.trim() ? ' Used instead of the built-in one.' : ''}
                    </Txt>
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
                    {secretSource === 'built-in' ? (
                      <Rowed gap={2} style={{ marginBottom: t.space(2) }}>
                        <MaterialCommunityIcons name="lock-check" size={18} color={t.color.pass} />
                        <Txt size="sm" tone="pass" style={{ flex: 1 }}>Using the built-in secret.</Txt>
                      </Rowed>
                    ) : null}
                    <Field
                      label=""
                      value={secret}
                      onChangeText={setSecret}
                      autoCapitalize="none"
                      placeholder={secretSource === 'built-in' ? 'Paste a regenerated client secret' : 'Paste the client secret'}
                    />
                    <View style={{ height: t.space(2) }} />
                    <Button title="Save secret" onPress={saveSecret} disabled={!secret.trim()} variant={secretSource === 'built-in' ? 'secondary' : 'primary'} />
                  </>
                )}
              </>
            ) : null}

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
          </Card>

          {result ? (
            <Card>
              <Label>Endpoint access</Label>
              <View style={{ height: t.space(1.5) }} />
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

          <Card>
            <Label>Write test results back</Label>
            <Txt size="xs" tone="faint" style={{ marginTop: 4, marginBottom: t.space(2), lineHeight: 17 }}>
              Writes pass or fail onto the Simpro asset. Try one first.
            </Txt>
            <Rowed gap={2}>
              <MaterialCommunityIcons
                name={prefs.simproWriteAssetTests ? 'database-edit' : 'database-lock'}
                size={18}
                color={prefs.simproWriteAssetTests ? t.color.warn : t.color.textFaint}
              />
              <Txt size="sm" tone={prefs.simproWriteAssetTests ? 'warn' : 'faint'} style={{ flex: 1 }}>
                {prefs.simproWriteAssetTests
                  ? 'On. Results go onto Simpro assets.'
                  : 'Off. Results go in the job note.'}
              </Txt>
              <Button
                title={prefs.simproWriteAssetTests ? 'Turn off' : 'Turn on'}
                variant={prefs.simproWriteAssetTests ? 'danger' : 'secondary'}
                compact
                onPress={() => update({ simproWriteAssetTests: !prefs.simproWriteAssetTests })}
              />
            </Rowed>

            <Divider />
            <Label>Photos to Simpro</Label>
            <View style={{ height: t.space(2) }} />
            <Rowed gap={2}>
              <MaterialCommunityIcons
                name={prefs.simproSendPhotos ? 'image-multiple' : 'image-off-outline'}
                size={18}
                color={prefs.simproSendPhotos ? t.color.accent : t.color.textFaint}
              />
              <Txt size="sm" tone={prefs.simproSendPhotos ? 'muted' : 'faint'} style={{ flex: 1, lineHeight: 19 }}>
                {prefs.simproSendPhotos
                  ? 'Defect photos go onto the job as attachments.'
                  : 'Off. Photos stay with the report.'}
              </Txt>
              <Switch
                value={prefs.simproSendPhotos}
                onValueChange={(on) => update({ simproSendPhotos: on })}
                trackColor={{ true: t.color.accent, false: t.color.border }}
              />
            </Rowed>

            <Divider />
            {/*
              * The one setting that takes the mail app out of the photo button.
              * Empty is the normal state and costs nothing: the photos go to the
              * phone's share sheet already attached, which is one tap. Filled in,
              * they are posted straight to the office and no mail app opens at
              * all — which is what was actually asked for. server/photo-relay in
              * this repository is the forty lines that answer it.
              */}
            <Field
              label="Website photo address"
              value={prefs.websitePhotoUrl}
              onChangeText={(v) => update({ websitePhotoUrl: v })}
              autoCapitalize="none"
              placeholder="https://…"
              hint={`Leave empty to share them to ${WEBSITE_PHOTOS_INBOX}.`}
            />
            {endpointProblem(prefs.websitePhotoUrl) ? (
              <Txt size="xs" tone="fail" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
                {endpointProblem(prefs.websitePhotoUrl)}
              </Txt>
            ) : null}
          </Card>

          <Card>
            <Label>Charge-out rates</Label>
            <Txt size="xs" tone="faint" style={{ marginTop: 4, lineHeight: 17 }}>
              Used to price quotes offline.
            </Txt>
            <View style={{ height: t.space(3) }} />
            <Label>Labour, ex GST</Label>
            <Money label="Normal hours" cents={prefs.normalHoursSellCents} onCents={(c) => update({ normalHoursSellCents: c })} suffix="per hour" />
            <View style={{ height: t.space(2.5) }} />
            <Money label="After hours" cents={prefs.afterHoursSellCents} onCents={(c) => update({ afterHoursSellCents: c })} suffix="per hour" />
            <Divider />
            <Label>Site attendance, ex GST</Label>
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Time past the covered minutes is charged hourly.
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

            <Divider />
            <Label>Rates from Simpro</Label>
            <View style={{ height: t.space(2) }} />
            <Button title="Pull rates from Simpro" variant="secondary" onPress={pullRates} loading={pulling} />

            {card.rates.length || card.fees.length ? (
              <>
                <Divider />
                <Rowed style={{ justifyContent: 'space-between' }}>
                  <Txt size="sm">From Simpro</Txt>
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
                <Button title="Clear pulled rates" variant="ghost" compact onPress={forgetRates} />
              </>
            ) : null}

            {pullReport ? (
              <>
                <Divider />
                {pullReport.suspect.length ? (
                  <Banner
                    tone="warn"
                    title={`${pullReport.suspect.length} rate name${pullReport.suspect.length === 1 ? '' : 's'} won't match a customer`}
                    body={pullReport.suspect.join('\n\n')}
                  />
                ) : null}
                {pullReport.unreadable.length ? (
                  <Banner
                    tone="warn"
                    title="Some rates couldn’t be read"
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
              </>
            ) : null}
          </Card>

          <Card>
            <Label>Update checks</Label>
            <View style={{ height: t.space(2) }} />
            {hasGh ? (
              <>
                <Txt size="sm" tone="pass">GitHub token saved {words.keyPlace}.</Txt>
                <View style={{ height: t.space(2.5) }} />
                <Button
                  title="Remove token"
                  variant="ghost"
                  compact
                  onPress={() => { void clearGhToken().then(() => setHasGh(false)); }}
                />
              </>
            ) : (
              <>
                <Field
                  label="GitHub token (optional)"
                  value={ghToken}
                  onChangeText={setGhToken}
                  placeholder="github_pat_…"
                  autoCapitalize="none"
                  hint={`Read-only, for private releases. Kept ${words.keyPlace}.`}
                />
                <View style={{ height: t.space(2.5) }} />
                <Button
                  title="Save token"
                  variant="secondary"
                  compact
                  disabled={!ghToken.trim()}
                  onPress={() => {
                    if (!ghToken.trim()) return;
                    void storeGhToken(ghToken).then(() => {
                      setGhToken('');
                      setHasGh(true);
                      // The token was pasted because the last check could not
                      // see the release; ask again with it straight away.
                      void checkForUpdate({ force: true });
                    });
                  }}
                />
              </>
            )}
          </Card>
        </>
      ) : null}
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
      hint={bad ? 'Not an amount. Write it like 136.88' : undefined}
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
