import { Stack } from 'expo-router';
import { C } from '@/theme';

export const unstable_settings = { anchor: 'index' };

export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />;
}
