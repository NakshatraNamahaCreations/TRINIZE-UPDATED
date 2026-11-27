import { Stack } from 'expo-router';
import { C } from '@/theme';

/** signing in opens the manager's home — without this the router picks the group's first screen it finds (e.g. a figure's list) */
export const unstable_settings = { anchor: 'manage/index' };

/** The Virtual Property Manager's app: a VPM's number signs in here instead of the resident tabs. */
export default function VpmLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }} />;
}
