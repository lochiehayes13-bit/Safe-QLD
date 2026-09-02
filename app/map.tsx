import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listSites } from '@/db/repo';
import { listJobs, type JobRecord } from '@/db/opsRepo';
import type { Site } from '@/domain/types';
import { cachedPositions, locateSites, type LocateProgress } from '@/geo/geocode';
import {
  PIN_COLOUR, PIN_KINDS, PIN_SHORT, buildPins, centreScript, filterPins, filterScript, formatCount,
  googleMapsUrl, jobPositions, mapHtml, parseMapMessage, wazeUrl, type LatLng, type PinKind,
} from '@/domain/mapPins';
import { useTheme } from '@/theme';
import { Rowed, Screen, Txt } from '@/components/ui';

/**
 * The service map.
 *
 * Every site with a known position, coloured by the most pressing thing
 * happening there, with a click through to Waze or Google Maps and to the
 * site's own screen.
 *
 * The map itself is a Leaflet page inside a WebView, built once per data load.
 * Toggling a legend chip or typing a search does not rebuild it — that would
 * throw away wherever the technician had panned and zoomed to — it pushes a
 * small script into the page instead. The page is only rebuilt when the data
 * changes: on focus, and once more after the background geocoder has found
 * some new sites.
 *
 * Positions come from the geocode cache, filled a couple of hundred addresses
 * at a time while this screen is open and stopped the moment it is left. The
 * status line says how far that has got, because a map showing 800 of 3,000
 * sites must not be read as a map of 800 sites.
 */

/** Brisbane, for a map with nothing on it yet. */
const BRISBANE: LatLng = { latitude: -27.47, longitude: 153.02 };
const DEFAULT_ZOOM = 9;
/** Addresses geocoded per opening. See geo/geocode.ts for why it is a drip. */
const GEOCODE_BUDGET = 200;

interface MapData {
  sites: Site[];
  jobs: JobRecord[];
  positions: Map<string, LatLng>;
}

const EMPTY: MapData = { sites: [], jobs: [], positions: new Map() };

export default function MapScreen() {
  const t = useTheme();
  const webRef = useRef<WebView>(null);
  const stopRef = useRef(false);

  const [data, setData] = useState<MapData | null>(null);
  const [kinds, setKinds] = useState<Set<PinKind>>(() => new Set(PIN_KINDS));
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [progress, setProgress] = useState<LocateProgress | null>(null);
  const [finding, setFinding] = useState(false);

  const load = useCallback(async (): Promise<MapData> => {
    const [sites, jobs] = await Promise.all([listSites(), listJobs({ limit: 10000 })]);
    // A geocoded address beats a job's own coordinates where both exist: the
    // address is the site, the coordinates are wherever the job was raised
    // from. The job's position is the fallback for a site the cache has not
    // reached yet, and it counts as located so the geocoder skips it.
    const positions = jobPositions(jobs);
    for (const [siteId, position] of await cachedPositions(sites)) positions.set(siteId, position);
    const next = { sites, jobs, positions };
    setData(next);
    return next;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      stopRef.current = false;
      void (async () => {
        const loaded = await load();
        if (!active || !loaded.sites.length) return;
        setLocating(true);
        setProgress(null);
        const result = await locateSites(loaded.sites, {
          budget: GEOCODE_BUDGET,
          located: new Set(loaded.positions.keys()),
          shouldStop: () => stopRef.current,
          onProgress: (p) => { if (active) setProgress(p); },
        });
        if (!active) return;
        setLocating(false);
        // One rebuild for the whole run rather than one per hit, so the page
        // reloads once at the end instead of two hundred times.
        if (result.hits > 0) await load();
      })();
      return () => {
        active = false;
        stopRef.current = true;
        setLocating(false);
      };
    }, [load]),
  );

  const { sites, jobs, positions } = data ?? EMPTY;
  const built = useMemo(() => buildPins({ sites, jobs, positions }), [sites, jobs, positions]);
  const shown = useMemo(() => filterPins(built.pins, { kinds, query }), [built, kinds, query]);
  const html = useMemo(
    () => mapHtml(built.pins, { centre: BRISBANE, zoom: DEFAULT_ZOOM, dark: t.mode === 'dark' }),
    [built, t.mode],
  );

  const pushFilter = useCallback(() => {
    webRef.current?.injectJavaScript(filterScript(kinds, query));
  }, [kinds, query]);

  useEffect(() => { pushFilter(); }, [pushFilter]);

  const toggleKind = (kind: PinKind) => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = parseMapMessage(event.nativeEvent.data);
    if (!msg) return;
    if (msg.type === 'open') {
      router.push({ pathname: '/site/[id]', params: { id: msg.siteId } });
      return;
    }
    const url = msg.app === 'waze' ? wazeUrl(msg.latitude, msg.longitude) : googleMapsUrl(msg.latitude, msg.longitude);
    // Both are https links, so a phone without the app lands on the web page
    // rather than on an error about an unknown scheme.
    void Linking.openURL(url).catch(() => undefined);
  };

  const findMe = async () => {
    if (finding) return;
    setFinding(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      // Balanced accuracy: this centres a map, and a high-accuracy fix costs
      // seconds and battery for a difference no map tile can show.
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      webRef.current?.injectJavaScript(centreScript(pos.coords.latitude, pos.coords.longitude));
    } catch {
      // Quietly: the map is still there, it just is not centred on the technician.
    } finally {
      setFinding(false);
    }
  };

  const status = (() => {
    if (!data) return 'Reading sites…';
    if (!sites.length) return 'Nothing to map yet — sync from the office first';
    let line = `${formatCount(built.pins.length)} of ${formatCount(sites.length)} sites located`;
    if (locating) {
      line += progress ? ` · locating ${progress.done} of ${progress.total}…` : ' · locating…';
    }
    if (shown.length !== built.pins.length) line += ` · ${formatCount(shown.length)} shown`;
    return line;
  })();

  return (
    <>
      <Stack.Screen options={{ title: 'Service map' }} />
      <Screen scroll={false} padded={false}>
        <View
          style={{
            paddingHorizontal: t.space(3),
            paddingTop: t.space(2),
            paddingBottom: t.space(2.5),
            gap: t.space(2),
            backgroundColor: t.color.bgElevated,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: t.color.border,
          }}
        >
          <Rowed gap={2} wrap>
            {PIN_KINDS.map((kind) => (
              <KindChip
                key={kind}
                kind={kind}
                count={built.counts[kind]}
                selected={kinds.has(kind)}
                onPress={() => toggleKind(kind)}
              />
            ))}
          </Rowed>

          <Rowed gap={2}>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space(2),
                backgroundColor: t.color.surfaceAlt,
                borderRadius: t.radius.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: t.color.border,
                paddingHorizontal: t.space(3),
                minHeight: t.touch,
              }}
            >
              <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Site or client"
                placeholderTextColor={t.color.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md, paddingVertical: 0 }}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                  <MaterialCommunityIcons name="close-circle" size={20} color={t.color.textFaint} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void findMe(); }}
              accessibilityRole="button"
              accessibilityLabel="My location"
              style={({ pressed }) => ({
                width: t.touch,
                height: t.touch,
                borderRadius: t.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? t.color.surface : t.color.surfaceAlt,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: t.color.border,
              })}
            >
              {finding ? (
                <ActivityIndicator color={t.color.accentText} />
              ) : (
                <MaterialCommunityIcons name="crosshairs-gps" size={24} color={t.color.accentText} />
              )}
            </Pressable>
          </Rowed>

          <Txt size="xs" tone="muted" numberOfLines={1}>{status}</Txt>
        </View>

        {data ? (
          <WebView
            ref={webRef}
            style={{ flex: 1, backgroundColor: t.color.bg }}
            originWhitelist={['*']}
            source={{ html }}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            onMessage={onMessage}
            // A rebuilt page starts with every pin showing; the current filter
            // is pushed back in as soon as it has loaded.
            onLoadEnd={pushFilter}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: t.color.bg }} />
        )}
      </Screen>
    </>
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
        minHeight: 38,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: selected ? colour : t.color.border,
        backgroundColor: selected ? t.color.surfaceAlt : 'transparent',
        opacity: selected ? 1 : 0.5,
      }}
    >
      <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colour }} />
      <Txt size="xs" weight="700">{PIN_SHORT[kind]}</Txt>
      <Txt size="xs" tone="muted" weight="700">{formatCount(count)}</Txt>
    </Pressable>
  );
}
