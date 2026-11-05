import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT, type Key } from '@/i18n';
import { isOpen } from '@/store/logic';
import { useStore } from '@/store/store';
import { C, GRAD } from '@/theme';
import { Icon, MaterialCommunityIcons, type IconName, type MciName } from './Icon';
import { useUI } from './Overlay';
import { Txt } from './Txt';

/** [inactive, active] — outline at rest, filled when selected */
type TabMeta = { ic: [IconName, IconName]; label: Key; mci?: MciName };
const ITEMS: Record<string, TabMeta> = {
  // house + heart echoes the brand mark; it has no outline cut, so focus is shown by colour and the hop
  '(home)': { ic: ['home-outline', 'home'], mci: 'home-heart', label: 'tab.home' },
  assistant: { ic: ['sparkles-outline', 'sparkles'], label: 'tab.assistant' },
  issues: { ic: ['ticket-outline', 'ticket'], label: 'tab.issues' },
  profile: { ic: ['person-circle-outline', 'person-circle'], label: 'tab.profile' },
};

/** Home · Assistant · (+) · My Issues · Profile — the "+" opens the Create sheet instead of a route. */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const { sheet, openSheet } = useUI();
  const { state: store } = useStore();
  const openMine = store.issues.filter(i => i.mine && isOpen(i)).length;
  const keyboard = useKeyboardVisible();

  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(spin, { toValue: sheet ? 1 : 0, useNativeDriver: true }).start();
  }, [sheet, spin]);

  if (keyboard) return null;

  const tab = (index: number) => {
    const route = state.routes[index];
    const meta = ITEMS[route.name];
    if (!meta) return null;
    const focused = state.index === index;
    const onPress = () => {
      const e = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !e.defaultPrevented) navigateToTab(route.key);
    };
    return <TabItem key={route.key} meta={meta} label={t(meta.label)} focused={focused} dot={route.name === 'issues' && openMine > 0} onPress={onPress} />;
  };

  const half = Math.ceil(state.routes.length / 2);
  return (
    <View style={[s.nav, { paddingBottom: 10 + insets.bottom }]}>
      {state.routes.slice(0, half).map((_, i) => tab(i))}
      <View style={s.plusWrap}>
        <Pressable onPress={() => openSheet('create')} accessibilityLabel={t('tab.create')} style={s.plusShadow}>
          <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] }) }] }}>
            <LinearGradient colors={GRAD.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.plus}>
              {/* drawn, not a "+" glyph — Android font padding pushes text off-centre */}
              <View style={s.plusH} />
              <View style={s.plusV} />
            </LinearGradient>
          </Animated.View>
        </Pressable>
      </View>
      {state.routes.slice(half).map((_, i) => tab(half + i))}
    </View>
  );
}

/** The selected icon hops and its top bar grows out from the centre. */
function TabItem({ meta, label, focused, dot, onPress }: { meta: TabMeta; label: string; focused: boolean; dot: boolean; onPress: () => void }) {
  const [on] = useState(() => new Animated.Value(focused ? 1 : 0));
  useEffect(() => {
    Animated.spring(on, { toValue: focused ? 1 : 0, speed: 16, bounciness: 12, useNativeDriver: true }).start();
  }, [focused, on]);
  return (
    <Pressable onPress={onPress} style={s.item} accessibilityRole="tab" accessibilityState={{ selected: focused }}>
      <Animated.View style={[s.bar, { opacity: on, transform: [{ scaleX: on }] }]} />
      {dot && <View style={s.dot} />}
      <Animated.View style={{ transform: [{ translateY: on.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }, { scale: on.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }}>
        {meta.mci
          ? <MaterialCommunityIcons name={meta.mci} size={25} color={focused ? C.acc : C.ink3} />
          : <Icon name={meta.ic[focused ? 1 : 0]} size={23} color={focused ? C.acc : C.ink3} />}
      </Animated.View>
      <Txt w={600} style={[s.label, { color: focused ? C.acc : C.ink3 }]}>{label}</Txt>
    </Pressable>
  );
}

/** Android resizes the window for the keyboard, which would float the bar above it. */
function useKeyboardVisible() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const a = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return shown;
}

const s = StyleSheet.create({
  nav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#fff', paddingTop: 6, paddingHorizontal: 6 },
  item: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 5 },
  bar: { position: 'absolute', top: -6, width: 22, height: 3, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: C.acc },
  dot: { position: 'absolute', top: 3, right: '28%', width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, borderWidth: 1.5, borderColor: '#fff', zIndex: 1 },
  label: { fontSize: 10 },
  // centred on the icon + label stacks either side, so all five sit on one line
  plusWrap: { flexBasis: 62, alignItems: 'center', justifyContent: 'center' },
  plusShadow: { borderRadius: 23, shadowColor: '#7C55F7', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 5, backgroundColor: '#7C55F7' },
  plus: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  plusH: { position: 'absolute', width: 18, height: 2.5, borderRadius: 2, backgroundColor: '#fff' },
  plusV: { position: 'absolute', width: 2.5, height: 18, borderRadius: 2, backgroundColor: '#fff' },
});
