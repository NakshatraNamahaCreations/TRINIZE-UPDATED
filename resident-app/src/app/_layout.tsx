import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { iconFont } from '@/components/Icon';
import { UIProvider } from '@/components/Overlay';
import { Sheets } from '@/components/Sheets';
import { Splash } from '@/components/Splash';
import { LangProvider } from '@/i18n';
import { SplashScreen } from '@/lib/native';
import { setupNotifications } from '@/lib/notify';
import { loadBoot, type Boot } from '@/lib/persist';
import { AuthProvider, useAuth } from '@/store/auth';
import { StoreProvider } from '@/store/store';
import { C } from '@/theme';

// keep the native launch screen (same purple) up until fonts and saved state are in
SplashScreen?.preventAutoHideAsync().catch(() => {});
setupNotifications();

/** Signed-out users only reach (auth); signing in swaps the whole stack for the tabs. */
function RootStack() {
  const { signedIn } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      {/* "/" is the home tab, so a cold start needs an explicit target instead of "Unmatched Route" */}
      <Stack.Protected guard={signedIn} redirectTo="/login">
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
    ...iconFont,
  });
  const [boot, setBoot] = useState<Boot | null>(null);
  const [splash, setSplash] = useState(true);
  const hideSplash = useCallback(() => setSplash(false), []);
  useEffect(() => { loadBoot().then(setBoot); }, []);
  const ready = loaded && boot !== null;
  // the animated splash takes over from the native one on the same purple, so the hand-off is seamless
  useEffect(() => { if (ready) SplashScreen?.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.acc }} />;

  return (
    <SafeAreaProvider>
      <LangProvider initial={boot.lang}>
        <UIProvider>
          <AuthProvider initial={boot.auth}>
            <StoreProvider initial={boot.store}>
              <StatusBar style="dark" />
              <RootStack />
              <Sheets />
            </StoreProvider>
          </AuthProvider>
          {splash && <Splash onDone={hideSplash} />}
        </UIProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
