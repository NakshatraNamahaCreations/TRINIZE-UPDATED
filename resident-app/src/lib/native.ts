/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Native modules added after the development build on the test phone was made. A module whose
 * native half is missing throws at import, so each loader returns null instead — screens then fall
 * back (in-memory state, a "needs the latest build" toast) until `npx expo run:android` rebuilds it.
 */
function optional<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

export const AsyncStorage = optional<typeof import('@react-native-async-storage/async-storage').default>(
  () => require('@react-native-async-storage/async-storage').default,
);
export const ImagePicker = optional<typeof import('expo-image-picker')>(() => require('expo-image-picker'));
/** legacy API on purpose: its system "new event" form needs no calendar permission on Android */
export const CalendarForm = optional<typeof import('expo-calendar/legacy')>(() => require('expo-calendar/legacy'));
export const Notifications = optional<typeof import('expo-notifications')>(() => require('expo-notifications'));
export const Localization = optional<typeof import('expo-localization')>(() => require('expo-localization'));
export const SplashScreen = optional<typeof import('expo-splash-screen')>(() => require('expo-splash-screen'));
