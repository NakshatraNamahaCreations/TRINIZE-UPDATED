import { Stack } from 'expo-router';
import { C } from '@/theme';

export const unstable_settings = { initialRouteName: 'index' };

export default function StackLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />;
}
