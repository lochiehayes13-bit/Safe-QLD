import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getDb } from '@/db';
import { useTheme } from '@/theme';
import { Banner, Txt } from '@/components/ui';

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
      .then(() => {
        if (!cancelled) setReady(true);
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
          <Stack.Screen name="site/[id]" options={{ title: 'Site' }} />
          <Stack.Screen name="site/new" options={{ title: 'New site', presentation: 'modal' }} />
          <Stack.Screen name="site/points" options={{ title: 'Points' }} />
          <Stack.Screen name="site/zones" options={{ title: 'Zones' }} />
          <Stack.Screen name="site/cause-effect" options={{ title: 'Cause & effect' }} />
          <Stack.Screen name="site/defects" options={{ title: 'Defects' }} />
          <Stack.Screen name="report/[id]" options={{ title: 'Test sheet' }} />
          <Stack.Screen name="import" options={{ title: 'Import', presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
