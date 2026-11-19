import { Stack } from 'expo-router';
import { C } from '@/theme';

// the gate is where a guard starts; without this the stack opens on its first file, the entry form
export const unstable_settings = { initialRouteName: 'post/index' };

/** The security guard's app: a guard's number (added by the society office) signs in here instead of the resident tabs. */
export default function GuardLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }} />;
}
