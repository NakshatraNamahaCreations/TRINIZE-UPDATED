import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Dialog } from '@/components/Dialog';
import { iconFont } from '@/components/Icon';
import { UIProvider } from '@/components/Overlay';
import { Sheets } from '@/components/Sheets';
import { Splash } from '@/components/Splash';
import { TourProvider } from '@/components/Tutorial';
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
  const { signedIn, role } = useAuth();
  const vpm = signedIn && role === 'vpm';
  const guard = signedIn && role === 'guard';
  // signing in lands on "/", the residents' home; a property manager has no such screen, so take them to their societies
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (vpm && !path.startsWith('/manage') && !path.startsWith('/legal')) router.replace('/manage');
    // a guard always starts at the gate itself, never part-way into the entry form
    if (guard && !path.startsWith('/post') && !path.startsWith('/legal')) router.replace('/post');
  }, [vpm, guard, path, router]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      {/* "/" is the home tab, so a cold start needs an explicit target instead of "Unmatched Route" */}
      <Stack.Protected guard={signedIn && !vpm && !guard} redirectTo={vpm ? '/manage' : guard ? '/post' : '/login'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      {/* a property manager's number gets their societies instead of the resident tabs */}
      <Stack.Protected guard={vpm}>
        <Stack.Screen name="(vpm)" />
      </Stack.Protected>
      {/* a security guard's number gets the gate */}
      <Stack.Protected guard={guard}>
        <Stack.Screen name="(guard)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* readable signed in or out — linked from the sign-in screen and Profile */}
      <Stack.Screen name="legal/[doc]" options={{ animation: 'slide_from_right' }} />
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
              {/* the tutorial overlay is drawn after the tabs, so it can spotlight the tab bar */}
              <TourProvider>
                <RootStack />
                <Sheets />
              </TourProvider>
            </StoreProvider>
          </AuthProvider>
          {/* every confirm() in the app is drawn by this one dialog */}
          <Dialog />
          {splash && <Splash onDone={hideSplash} />}
        </UIProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
