import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listMatchCustomers, loadMapData, type MapData, type MapSiteRow } from '@/db/mapRepo';
import { customerStats, siteStats, type CustomerStats } from '@/db/mirrorRepo';
import { locateSites, type LocateProgress, type LocateResult } from '@/geo/geocode';
import { GEOCODE_PROVIDER, geocodeNote } from '@/geo/platformGeocode';
import { searchPlaces, type Place } from '@/geo/places';
import { readPlacesKey } from '@/geo/placesKey';
import {
  distanceM, formatDistance, matchPlace, parseStreet, type MatchCustomer, type MatchSite, type MatchVerdict,
} from '@/domain/customerMatch';
import {
  DEFAULT_KINDS, PIN_COLOUR, PIN_KINDS, PIN_LABEL, PIN_SHORT, buildPins, centreScript, filterPins, filterScript,
  formatCount, googleMapsUrl, hereScript, mapHtml, mapUserAgent, parseMapMessage, placesScript, selectScript,
  siteAddressLine, wazeUrl,
  type LatLng, type MapPin, type MapSelection, type MapView, type PinKind,
} from '@/domain/mapPins';
import { describeLoadFailure } from '@/domain/loadFailure';
import { telHref } from '@/domain/jobPresentation';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { company } from '@/theme/brand';
import { useTheme } from '@/theme';
import { Button, Rowed, Screen, StatusPill, Txt } from '@/components/ui';
import { MapCanvas, type MapCanvasHandle, type MapCanvasMessage } from '@/components/MapCanvas';

/**
 * The map tab.
 *
 * Every site with a known position, coloured by the most pressing thing
 * happening there — a job on now, one coming up, one just invoiced, an open
 * quote — with the search box, the legend and the place card floating over
 * it. One search box does two jobs: typing it narrows our own pins by site,
 * client, address or job number; submitting it also asks the world, so a
 * shop name or an address a caller read out lands as a hollow pin whether
 * or not the office has ever heard of it. The card then answers the question
 * that comes next: is this a customer of ours, what have we done for them,
 * who do we ring, and how do we get there.
 *
 * The map itself is a Leaflet page inside a MapCanvas — a WebView on a
 * phone, an iframe in a browser — built once per data load. Toggling a
 * legend chip, typing, a search result or a selection does not rebuild it —
 * that would throw away wherever the technician had panned and zoomed to —
 * it pushes a small script into the page instead. The page is only rebuilt
 * when the data changes: on focus, and once more after the background
 * geocoder has found some new sites. The page reports every pan
 * and zoom back, and a rebuilt page opens on the last one, so the rebuild
 * after the geocoder's run does not snap a technician planning tomorrow on
 * the Sunshine Coast back to the whole of the south-east.
 *
 * Positions come from the geocode cache, filled a couple of hundred
 * addresses at a time while this tab is open and stopped the moment it is
 * left. The status line says how far that has got, because a map showing
 * 800 of 3,000 sites must not be read as a map of 800 sites — and when the
 * geocoder could not run at all, it says why, because "0 of 3,059 located"
 * with no reason is a map that looks broken rather than one asking for a
 * permission.
 */

/** Brisbane, for a map with nothing on it yet. */
const BRISBANE: LatLng = { latitude: -27.47, longitude: 153.02 };
const DEFAULT_ZOOM = 9;
/** The floating tab bar's height plus the gap the card keeps above it. See components/TabBar. */
const TAB_BAR_CLEARANCE = 80;
/**
 * How old a remembered fix can be and still be drawn as "you are here". The
 * last known position is whatever the phone last worked out for any app,
 * and one from yesterday drawn as a blue dot is a lie with a location.
 */
const FIX_MAX_AGE_MS = 60 * 60 * 1000;

type Card = { type: 'site'; siteId: string } | { type: 'place'; index: number };

/** Why the phone's location is not available, and what the technician can do about it. */
interface LocationNote {
  text: string;
  /** Re-ask; send them to the phone's settings when the OS will not ask again; or nothing, when nothing here can fix it. */
  action: 'ask' | 'settings' | 'none';
}

interface CardModel {
  title: string;
  address: string;
  position: LatLng;
  /** For one of our sites: its pin, for the colour, the label and the lines. */
  pin?: MapPin;
  site?: MapSiteRow;
  verdict: MatchVerdict;
  /** Why the verdict is what it is, one line each. */
  evidence: string[];
  customerExternalId?: string;
  customerName?: string;
  /**
   * For a search result matched to one of our sites: the office's address
   * for that site and how far the pin is from it. Printed so that "same
   * name" can be checked against where the site actually is.
   */
  matched?: { address: string; distanceM?: number };
  /** Which search result this is, for the arrows. */
  pager?: { index: number; total: number };
}

export default function MapScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<MapCanvasHandle>(null);
  const stopRef = useRef(false);

  const [data, setData] = useState<MapData | null>(null);
  const [kinds, setKinds] = useState<Set<PinKind>>(() => new Set(DEFAULT_KINDS));
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [progress, setProgress] = useState<LocateProgress | null>(null);
  const [finding, setFinding] = useState(false);
  const [me, setMe] = useState<LatLng | null>(null);
  /** Whether `me` is fresh enough to draw. A stale fix still prints a distance; it does not get a dot. */
  const [meFresh, setMeFresh] = useState(false);
  const [locationNote, setLocationNote] = useState<LocationNote | null>(null);
  /** Why the geocoder could not run this time, if it could not. */
  const [locateFault, setLocateFault] = useState<Pick<LocateResult, 'fault' | 'faultKind'> | null>(null);
  /** Where the technician has the map, as the page last reported it. Read when the page is rebuilt. */
  const viewRef = useRef<MapView | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  /** Every current customer, read the first time a place is searched for and kept for the session. */
  const [customers, setCustomers] = useState<MatchCustomer[] | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [stats, setStats] = useState<CustomerStats | null>(null);

  const load = useCallback(async (): Promise<MapData> => {
    const next = await loadMapData();
    setData(next);
    return next;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      stopRef.current = false;
      void (async () => {
        try {
          const loaded = await load();
          if (!active || !loaded.sites.length) return;
          setLocating(true);
          setProgress(null);
          setLocateFault(null);
          // No budget: how many addresses one opening may look up is the
          // platform's to say — two hundred on a phone, ten in a browser, and
          // for reasons that belong next to each geocoder rather than here.
          const result = await locateSites(loaded.sites, {
            located: new Set(loaded.positions.keys()),
            shouldStop: () => stopRef.current,
            onProgress: (p) => { if (active) setProgress(p); },
          });
          if (!active) return;
          if (result.fault) setLocateFault({ fault: result.fault, faultKind: result.faultKind });
          // One rebuild for the whole run rather than one per hit, so the page
          // reloads once at the end instead of two hundred times.
          if (result.hits > 0) await load();
        } catch (error) {
          // A geocoder that throws used to leave "Locating…" on the pill for
          // the rest of the session, which reads as an app still working on
          // it. The map itself is fine — the sites it already knows are
          // drawn — so this says what failed and stops claiming to be busy.
          if (active) setLocateFault({ fault: describeLoadFailure(error, 'the sites to place on the map'), faultKind: undefined });
        } finally {
          // Whatever happened, nothing is being looked up any more.
          if (active) setLocating(false);
        }
      })();
      // Where the phone last was, if it is already allowed to say. The
      // geocoder above asks for the permission on Android, once; this does
      // not ask again. The card wants a distance from it and the page a dot,
      // and the dot only when the fix is recent enough to be where they are.
      void (async () => {
        try {
          const permission = await Location.getForegroundPermissionsAsync();
          if (!permission.granted) return;
          const last = await Location.getLastKnownPositionAsync();
          if (!last || !active) return;
          setMe({ latitude: last.coords.latitude, longitude: last.coords.longitude });
          setMeFresh(Date.now() - last.timestamp <= FIX_MAX_AGE_MS);
        } catch {
          // The card just does not say how far.
        }
      })();
      return () => {
        active = false;
        stopRef.current = true;
        setLocating(false);
      };
    }, [load]),
  );

  const built = useMemo(
    () => (data ? buildPins({ sites: data.sites, jobs: data.jobs, quotes: data.quotes, positions: data.positions, now: data.loadedAt }) : null),
    [data],
  );
  const pins = built?.pins ?? [];
  const shown = useMemo(() => filterPins(pins, { kinds, query }), [pins, kinds, query]);
  const sitesById = useMemo(() => new Map((data?.sites ?? []).map((s) => [s.id, s])), [data]);
  const pinsById = useMemo(() => new Map(pins.map((p) => [p.siteId, p])), [pins]);
  /** The sites as the matcher wants them: the office's fields plus wherever the map has put them. */
  const matchSites = useMemo<MatchSite[]>(
    () => (data?.sites ?? []).map((s) => {
      const at = data?.positions.get(s.id);
      return {
        id: s.id, name: s.name, address: s.address, suburb: s.suburb, postcode: s.postcode, clientName: s.clientName,
        latitude: at?.latitude, longitude: at?.longitude,
      };
    }),
    [data],
  );
  // The tab bar floats over the bottom of the map; the attribution has to
  // sit above it, and on a phone with a home indicator the bar sits higher.
  const bottomClearance = Math.max(insets.bottom, t.space(2)) + TAB_BAR_CLEARANCE;
  // The saved view is read here, at rebuild time, rather than listed as a
  // dependency: every pan would otherwise rebuild the page, which is the one
  // thing the saved view exists to avoid.
  const html = useMemo(
    () => (built ? mapHtml(built.pins, {
      centre: BRISBANE, zoom: DEFAULT_ZOOM, dark: t.mode === 'dark', kinds: DEFAULT_KINDS,
      view: viewRef.current, bottomClearancePx: bottomClearance,
    }) : ''),
    [built, t.mode, bottomClearance],
  );

  const selection = useMemo<MapSelection>(() => {
    if (!card) return null;
    if (card.type === 'site') return { siteId: card.siteId };
    const place = places[card.index];
    return place ? { placeId: place.id } : null;
  }, [card, places]);

  const inject = (script: string) => { webRef.current?.inject(script); };

  // Each piece of state the page mirrors is pushed as it changes, and all of
  // it again when the page reloads, since a rebuilt page starts from nothing.
  useEffect(() => { inject(filterScript(kinds, query)); }, [kinds, query]);
  useEffect(() => { inject(placesScript(places)); }, [places]);
  useEffect(() => { inject(selectScript(selection)); }, [selection]);
  // The dot, never the view: a fix arriving after the page loaded draws
  // where the technician is and leaves the map where they put it.
  useEffect(() => { if (me && meFresh) inject(hereScript(me.latitude, me.longitude)); }, [me, meFresh]);
  const pushState = () => {
    inject(filterScript(kinds, query));
    inject(placesScript(places));
    inject(selectScript(selection));
    if (me && meFresh) inject(hereScript(me.latitude, me.longitude));
  };

  const model = useMemo<CardModel | null>(() => {
    if (!card || !data) return null;
    if (card.type === 'site') {
      const pin = pinsById.get(card.siteId);
      const site = sitesById.get(card.siteId);
      if (!pin || !site) return null;
      return {
        title: pin.title,
        address: pin.subtitle,
        position: { latitude: pin.latitude, longitude: pin.longitude },
        pin,
        site,
        verdict: 'our site',
        evidence: [],
        customerExternalId: site.customerExternalId ?? undefined,
        customerName: site.customerName ?? site.clientName ?? undefined,
      };
    }
    const place = places[card.index];
    if (!place) return null;
    const match = matchPlace(place, matchSites, customers ?? []);
    const site = match.site ? sitesById.get(match.site.id) : undefined;
    return {
      title: place.name,
      address: place.address,
      position: { latitude: place.latitude, longitude: place.longitude },
      pin: site ? pinsById.get(site.id) : undefined,
      site,
      verdict: match.verdict,
      evidence: match.evidence.map((e) => e.detail),
      customerExternalId: match.customer?.externalId ?? site?.customerExternalId ?? undefined,
      customerName: match.customer?.name ?? match.customerName ?? site?.customerName ?? site?.clientName ?? undefined,
      matched: site ? { address: siteAddressLine(site), distanceM: match.distanceM } : undefined,
      pager: { index: card.index, total: places.length },
    };
  }, [card, data, places, customers, matchSites, pinsById, sitesById]);

  // The figures for the card, read when it opens on something the office knows.
  const statsFor = model?.site ? `site:${model.site.id}`
    : model?.verdict === 'our customer, different site' && model.customerExternalId ? `customer:${model.customerExternalId}`
      : null;
  useEffect(() => {
    let active = true;
    setStats(null);
    if (!statsFor) return undefined;
    const colon = statsFor.indexOf(':');
    const what = statsFor.slice(0, colon);
    const id = statsFor.slice(colon + 1);
    void (what === 'site' ? siteStats(id) : customerStats(id))
      .then((s) => { if (active) setStats(s); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [statsFor]);

  const toggleKind = (kind: PinKind) => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const onMessage = (event: MapCanvasMessage) => {
    const msg = parseMapMessage(event.nativeEvent.data);
    if (!msg) return;
    if (msg.type === 'select') {
      void Haptics.selectionAsync();
      setCard({ type: 'site', siteId: msg.siteId });
    } else if (msg.type === 'place') {
      const index = places.findIndex((p) => p.id === msg.placeId);
      if (index >= 0) {
        void Haptics.selectionAsync();
        setCard({ type: 'place', index });
      }
    } else if (msg.type === 'link') {
      // The attribution. The phone's browser opens it; the map stays put.
      void Linking.openURL(msg.url).catch(() => undefined);
    } else if (msg.type === 'view') {
      viewRef.current = msg.view;
    } else {
      setCard(null);
    }
  };

  /**
   * Navigations out of the page go to the phone's browser — a new tab, on
   * the web — and never into the map, which has no back button and would
   * otherwise show the OpenStreetMap copyright page under the search box
   * with no way home. The page itself loads as about:blank; the stylesheet,
   * the script and the tiles are sub-resources and never come through here.
   */
  const onShouldStartLoad = ({ url }: { url: string }): boolean => {
    if (url.startsWith('about:')) return true;
    void Linking.openURL(url).catch(() => undefined);
    return false;
  };

  const submitSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    // Our own pins first, and the map goes to them. The world's answer
    // follows when it arrives.
    inject(filterScript(kinds, q, true));
    setSearching(true);
    setPlaceError(null);
    try {
      let known = customers;
      if (!known) {
        known = await listMatchCustomers();
        setCustomers(known);
      }
      const key = await readPlacesKey();
      const results = await searchPlaces(q, {
        fetch: (url, init) => fetch(url, init),
        key,
        near: me ?? undefined,
      });
      setPlaces(results);
      if (results.length) setCard({ type: 'place', index: 0 });
      else if (!shown.length) setPlaceError(`Nothing found for “${q}”`);
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : 'The place search did not answer');
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setPlaces([]);
    setPlaceError(null);
    setCard((current) => (current?.type === 'place' ? null : current));
  };

  const findMe = async () => {
    if (finding) return;
    setFinding(true);
    setLocationNote(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        // Once the OS has stopped asking, the only way back on is Settings,
        // and a button that spins and does nothing does not say so.
        setLocationNote(permission.canAskAgain
          ? { text: 'Location was declined, so the map cannot show where you are or place the sites.', action: 'ask' }
          : { text: 'Location is off for Safe QLD. Turn it on in the phone’s settings to see where you are and to place the sites.', action: 'settings' });
        return;
      }
      // Balanced accuracy: this centres a map, and a high-accuracy fix costs
      // seconds and battery for a difference no map tile can show.
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setMeFresh(true);
      inject(centreScript(pos.coords.latitude, pos.coords.longitude));
    } catch (e) {
      setLocationNote({ text: `Could not get a position (${e instanceof Error ? e.message : String(e)}).`, action: 'ask' });
    } finally {
      setFinding(false);
    }
  };

  /** Where the card's "add as a site" goes: the new-site form, with the place's name and address carried across. */
  const addSite = (m: CardModel) => {
    router.push({
      pathname: '/site/new',
      params: {
        name: m.title,
        address: m.address,
        postcode: parseStreet(m.address).postcode ?? '',
        client: m.verdict === 'our customer, different site' ? (m.customerName ?? '') : '',
        latitude: String(m.position.latitude),
        longitude: String(m.position.longitude),
      },
    });
  };

  const navigate = (app: 'waze' | 'google', at: LatLng) => {
    const url = app === 'waze' ? wazeUrl(at.latitude, at.longitude) : googleMapsUrl(at.latitude, at.longitude);
    // Both are https links, so a phone without the app lands on the web page
    // rather than on an error about an unknown scheme.
    void Linking.openURL(url).catch(() => undefined);
  };

  const status = (() => {
    if (!data || !built) return 'Reading sites…';
    if (!data.sites.length) return 'Nothing to map yet — sync from the office first';
    let line = `${formatCount(built.pins.length)} of ${formatCount(data.sites.length)} sites located`;
    if (locating) {
      line += progress ? ` · locating ${progress.done} of ${progress.total}…` : ' · locating…';
    } else if (locateFault) {
      line += ' · not locating';
    }
    // Where the coordinates come from and how fast, where the platform has
    // anything to say about it. In a browser that is most of the story.
    const pace = geocodeNote(data.sites.length - built.pins.length);
    if (pace) line += ` · ${pace}`;
    if (shown.length !== built.pins.length) line += ` · ${formatCount(shown.length)} shown`;
    if (searching) line += ' · searching…';
    return line;
  })();

  // The note under the status: why the phone's location is off, or why the
  // geocoder stopped. The count stays beside it — "800 of 3,000 located" is
  // exactly the figure that matters when the reason is a missing permission.
  const note: LocationNote | null = locationNote
    ?? (locateFault?.faultKind === 'permission'
      ? { text: 'Location is off for Safe QLD, so the sites cannot be placed on the map. Allow it to place them.', action: 'ask' }
      : locateFault?.fault
        ? { text: `${GEOCODE_PROVIDER} stopped: ${locateFault.fault}`, action: 'none' }
        : null);
  const onNoteAction = () => {
    if (note?.action === 'settings') void Linking.openSettings().catch(() => undefined);
    else void findMe();
  };

  const floating = {
    backgroundColor: t.color.bgElevated,
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    ...t.shadow.float,
  } as const;

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ flex: 1, backgroundColor: t.color.bg }}>
        {data && html ? (
          <MapCanvas
            ref={webRef}
            style={{ flex: 1, backgroundColor: t.color.bg }}
            source={{ html }}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            // OpenStreetMap's tile policy: every request names the app and
            // somebody to write to. Appended to the browser's own string on
            // both phone platforms; see mapUserAgent for why it is not
            // replaced, and MapCanvas.web.tsx for what a browser can do
            // instead, which is not this.
            applicationNameForUserAgent={mapUserAgent(company.email)}
            onShouldStartLoadWithRequest={onShouldStartLoad}
            onMessage={onMessage}
            // A rebuilt page starts with nothing selected and the default
            // layers; the current state is pushed back in once it has loaded.
            onLoadEnd={pushState}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: t.color.bg }} />
        )}

        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: t.space(3), gap: t.space(2) }}
        >
          <Rowed gap={2}>
            <View
              style={{
                ...floating,
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space(2),
                paddingHorizontal: t.space(3),
                minHeight: t.touch,
              }}
            >
              <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => { void submitSearch(); }}
                placeholder="Site, client, job number or any place"
                placeholderTextColor={t.color.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md, paddingVertical: 0 }}
              />
              {searching ? <ActivityIndicator color={t.color.accentText} /> : null}
              {query ? (
                <Pressable onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear search">
                  <MaterialCommunityIcons name="close-circle" size={20} color={t.color.textFaint} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void findMe(); }}
              accessibilityRole="button"
              accessibilityLabel="My location"
              style={({ pressed }) => ({
                ...floating,
                width: t.touch,
                height: t.touch,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {finding ? (
                <ActivityIndicator color={t.color.accentText} />
              ) : (
                <MaterialCommunityIcons name="crosshairs-gps" size={24} color={t.color.accentText} />
              )}
            </Pressable>
          </Rowed>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(3) }}
          >
            {PIN_KINDS.map((kind) => (
              <KindChip
                key={kind}
                kind={kind}
                count={built?.counts[kind] ?? 0}
                selected={kinds.has(kind)}
                onPress={() => toggleKind(kind)}
              />
            ))}
          </ScrollView>

          <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <View style={{ ...floating, borderRadius: t.radius.pill, paddingHorizontal: t.space(2.5), paddingVertical: t.space(1) }}>
              {/* Two lines: in a browser the status carries the geocoder's pace as well as the count. */}
              <Txt size="xs" tone={placeError ? 'warn' : 'muted'} numberOfLines={2}>{placeError ?? status}</Txt>
            </View>
          </View>

          {note ? (
            <View
              style={{
                ...floating,
                borderLeftWidth: 3,
                borderLeftColor: t.color.warn,
                padding: t.space(2.5),
                gap: t.space(2),
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Txt size="xs" tone="warn" weight="700" style={{ flex: 1, lineHeight: 17 }}>{note.text}</Txt>
              {note.action !== 'none' ? (
                <Button
                  title={note.action === 'settings' ? 'Settings' : 'Allow location'}
                  variant="secondary"
                  compact
                  onPress={onNoteAction}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {model ? (
          <View
            style={{
              position: 'absolute',
              left: t.space(3),
              right: t.space(3),
              bottom: Math.max(insets.bottom, t.space(2)) + TAB_BAR_CLEARANCE,
            }}
          >
            <PlaceCard
              model={model}
              stats={stats}
              me={me}
              onClose={() => setCard(null)}
              onStep={model.pager ? (step) => {
                const total = model.pager!.total;
                setCard({ type: 'place', index: (model.pager!.index + step + total) % total });
              } : undefined}
              onOpenSite={model.site ? () => router.push({ pathname: '/site/[id]', params: { id: model.site!.id } }) : undefined}
              onOpenCustomer={model.customerExternalId
                ? () => router.push({ pathname: '/customer/[id]', params: { id: model.customerExternalId! } })
                : undefined}
              onAddSite={() => addSite(model)}
              onNavigate={(app) => navigate(app, model.position)}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/**
 * The card for whatever was tapped or found.
 *
 * The same card for one of our pins and for a search result, because the
 * question is the same either way and the answer should look the same: who
 * this is, whether they are ours, what we have done for them, and the way
 * there. For a search result the verdict is the matcher's and its evidence
 * is printed beside it — "same name" is something a person can check against
 * the sign on the building; a bare "Our site" is something they either trust
 * or ignore.
 */
function PlaceCard({
  model, stats, me, onClose, onStep, onOpenSite, onOpenCustomer, onAddSite, onNavigate,
}: {
  model: CardModel;
  stats: CustomerStats | null;
  me: LatLng | null;
  onClose: () => void;
  onStep?: (step: -1 | 1) => void;
  onOpenSite?: () => void;
  onOpenCustomer?: () => void;
  onAddSite: () => void;
  onNavigate: (app: 'waze' | 'google') => void;
}) {
  const t = useTheme();
  const ours = model.verdict === 'our site';
  const theirs = model.verdict === 'our customer, different site';
  const distance = me ? distanceM(me, model.position) : undefined;
  const site = model.site;
  const phone = site?.contactMobile?.trim() || site?.contactWorkPhone?.trim() || undefined;
  const dial = telHref(phone);
  const kindLabel = model.pin ? PIN_LABEL[model.pin.kind] : model.pager ? 'Search result' : undefined;
  const kindColour = model.pin ? PIN_COLOUR[model.pin.kind] : t.color.accent;

  return (
    <View
      style={{
        backgroundColor: t.color.bgElevated,
        borderRadius: t.radius.xl,
        borderWidth: 1,
        borderColor: t.color.border,
        maxHeight: 420,
        overflow: 'hidden',
        ...t.shadow.float,
      }}
    >
      <ScrollView contentContainerStyle={{ padding: t.space(4), gap: t.space(2.5) }} keyboardShouldPersistTaps="handled">
        <Rowed gap={2}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: kindColour }} />
          <Txt size="xs" weight="800" tone="muted" style={{ flex: 1, letterSpacing: 0.6, textTransform: 'uppercase' }} numberOfLines={1}>
            {kindLabel ?? 'Site'}
          </Txt>
          {model.pager && model.pager.total > 1 && onStep ? (
            <Rowed gap={0}>
              <Pressable onPress={() => onStep(-1)} hitSlop={8} accessibilityLabel="Previous result" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="chevron-left" size={26} color={t.color.text} />
              </Pressable>
              <Txt size="xs" tone="muted" weight="700">{model.pager.index + 1} of {model.pager.total}</Txt>
              <Pressable onPress={() => onStep(1)} hitSlop={8} accessibilityLabel="Next result" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="chevron-right" size={26} color={t.color.text} />
              </Pressable>
            </Rowed>
          ) : null}
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="close" size={24} color={t.color.textMuted} />
          </Pressable>
        </Rowed>

        <View style={{ gap: 3 }}>
          <Txt size="lg" weight="800" numberOfLines={2} style={{ letterSpacing: -0.2 }}>{model.title}</Txt>
          {model.address ? <Txt size="sm" tone="muted" numberOfLines={2}>{model.address}</Txt> : null}
          {distance !== undefined ? <Txt size="xs" tone="faint">{formatDistance(distance)} from you</Txt> : null}
        </View>

        <Rowed gap={2} wrap>
          <StatusPill
            label={ours ? 'Our site' : theirs ? 'Our customer' : 'Not a customer of ours'}
            tone={ours ? 'pass' : theirs ? 'info' : 'muted'}
          />
          {model.evidence.length ? (
            <Txt size="xs" tone="faint" style={{ flex: 1 }} numberOfLines={2}>{model.evidence.join(' · ')}</Txt>
          ) : null}
        </Rowed>

        {ours && site && site.name !== model.title ? (
          <Txt size="sm" tone="muted" numberOfLines={1}>Known to us as {site.name}</Txt>
        ) : null}
        {ours && model.matched ? (
          // The site the office holds, beside the place that was searched
          // for, so "same name" can be checked against where the site is.
          <Txt size="sm" tone="muted" numberOfLines={2}>
            Our record: {model.matched.address || 'no address on file'}
            {model.matched.distanceM !== undefined ? ` · ${formatDistance(model.matched.distanceM)} from this pin` : ''}
          </Txt>
        ) : null}
        {model.customerName ? (
          <Txt size="sm" tone="muted" numberOfLines={1}>Customer: {model.customerName}</Txt>
        ) : null}

        {(ours || theirs) && stats ? (
          <Rowed gap={2} wrap>
            <Stat label="Jobs done" value={formatCount(stats.jobsTotal)} />
            <Stat label="Open" value={formatCount(stats.jobsOpen)} tone={stats.jobsOpen ? 'accent' : 'default'} />
            <Stat label="Last job" value={stats.lastJobAt ? formatAuDate(stats.lastJobAt) : '—'} />
            <Stat label="Open quotes" value={formatCount(stats.quotesOpen)} />
            <Stat label="Unpaid" value={stats.invoicesUnpaidCents ? formatCents(stats.invoicesUnpaidCents) : '—'} tone={stats.invoicesUnpaidCents ? 'warn' : 'default'} />
          </Rowed>
        ) : null}

        {model.pin?.lines.length ? (
          <View style={{ gap: 2 }}>
            {model.pin.lines.map((line, i) => (
              <Txt key={i} size="sm" numberOfLines={1}>• {line}</Txt>
            ))}
          </View>
        ) : null}

        {site && (site.contactName || phone) ? (
          <Pressable
            onPress={dial ? () => { void Linking.openURL(dial).catch(() => undefined); } : undefined}
            accessibilityRole={dial ? 'button' : undefined}
            accessibilityLabel={dial ? `Call ${site.contactName ?? phone}` : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2), minHeight: 44 }}
          >
            <MaterialCommunityIcons name={dial ? 'phone' : 'account-outline'} size={18} color={dial ? t.color.accentText : t.color.textFaint} />
            <Txt size="sm" tone={dial ? 'accent' : 'muted'} weight="700" numberOfLines={1} style={{ flex: 1 }}>
              {[site.contactName, phone].filter(Boolean).join(' · ')}
            </Txt>
          </Pressable>
        ) : null}

        {ours ? (
          <Rowed gap={2}>
            {onOpenSite ? <Button title="Open site" onPress={onOpenSite} style={{ flex: 1 }} /> : null}
            {onOpenCustomer ? <Button title="Customer" variant="secondary" onPress={onOpenCustomer} style={{ flex: 1 }} /> : null}
          </Rowed>
        ) : (
          <Rowed gap={2}>
            {theirs && onOpenCustomer ? <Button title="Open customer" onPress={onOpenCustomer} style={{ flex: 1 }} /> : null}
            <Button title="Add as a site" variant={theirs && onOpenCustomer ? 'secondary' : 'primary'} onPress={onAddSite} style={{ flex: 1 }} />
          </Rowed>
        )}
        <Rowed gap={2}>
          <Button
            title="Waze"
            variant="secondary"
            onPress={() => onNavigate('waze')}
            style={{ flex: 1 }}
            icon={<MaterialCommunityIcons name="navigation-variant-outline" size={20} color={t.color.text} />}
          />
          <Button
            title="Google Maps"
            variant="secondary"
            onPress={() => onNavigate('google')}
            style={{ flex: 1 }}
            icon={<MaterialCommunityIcons name="google-maps" size={20} color={t.color.text} />}
          />
        </Rowed>
      </ScrollView>
    </View>
  );
}

/** One figure on the card, small enough that five fit in a row on a phone. */
function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'accent' | 'warn' }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: 88, paddingVertical: t.space(1.5), paddingHorizontal: t.space(2.5), borderRadius: t.radius.sm, backgroundColor: t.color.surfaceAlt, gap: 1 }}>
      <Txt size="xs" tone="faint" weight="700" numberOfLines={1}>{label}</Txt>
      <Txt size="md" weight="800" tone={tone} numberOfLines={1}>{value}</Txt>
    </View>
  );
}

/**
 * A legend entry that is also the toggle for it. A plain chip turns flame
 * orange when selected, which would hide the one thing this chip is for —
 * showing which colour the kind is on the map — so the colour stays on the
 * dot and selection is shown by the border and by dimming the rest.
 */
function KindChip({
  kind,
  count,
  selected,
  onPress,
}: {
  kind: PinKind;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const colour = PIN_COLOUR[kind];
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${PIN_SHORT[kind]}, ${count}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space(1.5),
        paddingHorizontal: t.space(2.5),
        minHeight: 40,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: selected ? colour : t.color.border,
        backgroundColor: t.color.bgElevated,
        opacity: selected ? 1 : 0.55,
        ...t.shadow.card,
      }}
    >
      <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colour }} />
      <Txt size="xs" weight="700">{PIN_SHORT[kind]}</Txt>
      <Txt size="xs" tone="muted" weight="700">{formatCount(count)}</Txt>
    </Pressable>
  );
}
