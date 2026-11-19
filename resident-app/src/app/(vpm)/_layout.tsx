import { Stack } from 'expo-router';
import { C } from '@/theme';

/** The Virtual Property Manager's app: a VPM's number signs in here instead of the resident tabs. */
export default function VpmLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }} />;
}
