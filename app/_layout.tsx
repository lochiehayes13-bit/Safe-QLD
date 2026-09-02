import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getDb } from '@/db';
import { seedReferenceData } from '@/db/assetRepo';
import { startCatalogueSeed } from '@/seed/catalogueSeed';
import { useTheme } from '@/theme';
import { Banner, Txt } from '@/components/ui';
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

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: t.color.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.color.accent} size="large" />
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
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: t.color.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="site/new" options={{ title: 'New site', presentation: 'modal' }} />
          <Stack.Screen name="import" options={{ title: 'Import', presentation: 'modal' }} />
          <Stack.Screen name="impairment/new" options={{ title: 'Declare impairment', presentation: 'modal' }} />
          <Stack.Screen name="work/defect/new" options={{ title: 'Raise defect', presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
