import { View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { QuickNav } from '@/components/QuickNav';
import { TabBar } from '@/components/TabBar';

/** The resident app's tabs, with the floating quick menu over every screen. */
export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs tabBar={props => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="(home)" />
        <Tabs.Screen name="assistant" />
        <Tabs.Screen name="issues" />
        <Tabs.Screen name="profile" />
      </Tabs>
      <QuickNav />
    </View>
  );
}
