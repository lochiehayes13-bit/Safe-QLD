import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import {
  Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold, useFonts,
} from '@expo-google-fonts/manrope';
import { getDb } from '@/db';
import { seedReferenceData } from '@/db/assetRepo';
import { startCatalogueSeed } from '@/seed/catalogueSeed';
import { setFontsReady, useTheme } from '@/theme';
import { STARTUP_PATIENCE_MS, startupStalled } from '@/domain/startup';
import { Banner, Txt } from '@/components/ui';

// Held until the faces and the database are ready, so the first frame is the
// app in its own type rather than a flash of the system font.
void SplashScreen.preventAutoHideAsync().catch(() => {});
import { AutoSyncDriver } from '@/components/AutoSyncDriver';

/**
 * Root layout.
 *
 * The database is opened and migrated before any screen renders, so screens can
 * assume a ready schema instead of each guarding for it.
 */
export default function RootLayout() {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * How long the open has been going, once it has gone on too long.
   *
   * A rejection is handled below; a promise that never settles was not. On the
   * browser build — the one that reaches an iPhone — a page refused its own
   * storage gets exactly that from `getDb()`, and the app sat on a bare spinner
   * with no text on the page at all. See `src/domain/startup.ts` for why this
   * keeps waiting rather than giving up or retrying.
   */
  const [waitedMs, setWaitedMs] = useState(0);
  const [fontsLoaded, fontError] = useFonts({
    Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  // A face that fails to load is not a reason to hold the app: text falls
  // back to the system font and everything still works.
  const fontsSettled = fontsLoaded || !!fontError;
  // Set during render, not in an effect: the effect would run after the first
  // frame with the faces available, and nothing below re-renders for it.
  // Idempotent, and no React state is touched.
  setFontsReady(!!fontsLoaded);
  useEffect(() => {
    if ((ready || error) && fontsSettled) void SplashScreen.hideAsync().catch(() => {});
  }, [ready, error, fontsSettled]);

  useEffect(() => {
    if (ready || error) return undefined;
    const started = Date.now();
    const h = setInterval(() => setWaitedMs(Date.now() - started), 1000);
    return () => clearInterval(h);
  }, [ready, error]);

  useEffect(() => {
    let cancelled = false;
    getDb()
      .then(seedReferenceData)
      .then(() => {
        if (!cancelled) setReady(true);
        // The catalogue is thousands of rows and nothing on the first screen
        // needs a part number, so it loads alongside the app rather than in
        // front of it. Screens that do need it await the same promise.
        void startCatalogueSeed().catch(() => {});
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: t.color.bg, justifyContent: 'center', padding: 24, gap: 12 }}>
          <Banner tone="fail" title="Safe QLD could not open its database" body={error} />
          <Txt tone="muted" size="sm">
            Restart the app. If this keeps happening, clearing the app's storage will reset it — note that this deletes
            sites and reports held on the device.
          </Txt>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready || !fontsSettled) {
    const stalled = waitedMs >= STARTUP_PATIENCE_MS ? startupStalled(waitedMs / 1000) : null;
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: t.color.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          <ActivityIndicator color={t.color.accent} size="large" />
          {stalled ? <Banner tone="warn" title={stalled.title} body={stalled.body} /> : null}
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
        {/* Only once the database is open: the first thing it does is read sync state. */}
        <AutoSyncDriver />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.color.bgElevated },
            headerTintColor: t.color.text,
            headerTitleStyle: { fontWeight: '700', fontFamily: t.font.family('700') },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: t.color.bg },
            headerShadowVisible: false,
            // One direction for going deeper, one for a sheet. Short, because a
            // transition is a promise about where you are, not a show.
            animation: 'slide_from_right',
            animationDuration: 220,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="site/new" options={{ title: 'New site', presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="import" options={{ title: 'Import', presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="impairment/new" options={{ title: 'Declare impairment', presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="work/defect/new" options={{ title: 'Raise defect', presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
