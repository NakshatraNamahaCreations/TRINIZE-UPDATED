import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Txt, type IconName } from './ui';
import { useT, type Key } from '@/i18n';
import { LIVE } from '@/lib/api';
import { loadQuickNav, saveQuickNav } from '@/lib/persist';
import { C } from '@/theme';

type Item = { ic: IconName; l: Key; to: Href; bg: string; fg: string };
const ITEMS: Item[] = [
  { ic: 'sparkles', l: 'tab.assistant', to: '/assistant', bg: C.aiBg, fg: C.ai },
  { ic: 'add-circle', l: 'fab.raise', to: '/issues/new', bg: '#FDE9E7', fg: '#B42318' },
  { ic: 'ticket', l: 'tab.issues', to: '/issues', bg: C.accBg, fg: C.acc },
  { ic: 'shield-checkmark', l: 'fab.visitors', to: '/gate', bg: '#E3F3FC', fg: '#0369A1' },
  { ic: 'wallet', l: 'dues.title', to: '/dues', bg: '#E4F7EE', fg: '#067647' },
  { ic: 'chatbubbles', l: 'fab.messages', to: '/messages', bg: '#FCE7F3', fg: '#BE185D' },
  { ic: 'calendar', l: 'fab.visits', to: '/visits', bg: '#EFEAFE', fg: '#6D28D9' },
  // emergency help needs the server; the demo build offers events in its place
  LIVE ? { ic: 'alert-circle', l: 'sos.title', to: '/emergency', bg: '#FDE9E7', fg: C.bad } : { ic: 'calendar-number', l: 'fab.events', to: '/events', bg: '#FEF0DC', fg: '#B54708' },
];
const SIZE = 54, EDGE = 10, MOVED = 6;

/**
 * A floating quick-menu button for the resident app. It sits at the right edge, can be dragged anywhere
 * (it settles on the nearer side), and a tap opens a circle of the app's main places to jump straight to.
 */
export function QuickNav() {
  const router = useRouter();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);

  // where the button rests and the area it may move in; the gesture handler is made once and reads them from here
  const [geo] = useState(() => ({ W, H, minY: 0, maxY: H, x: W - SIZE - EDGE, y: Math.round(H * 0.58) }));
  const [pos] = useState(() => new Animated.ValueXY({ x: geo.x, y: geo.y }));
  const [menu] = useState(() => new Animated.Value(0));

  // on start and after a rotation: keep the button on its side and on screen
  useEffect(() => {
    const minY = insets.top + 64, maxY = H - insets.bottom - 150;
    const x = geo.x + SIZE / 2 < W / 2 ? EDGE : W - SIZE - EDGE, y = Math.min(Math.max(geo.y, minY), maxY);
    Object.assign(geo, { W, H, minY, maxY, x, y });
    pos.setValue({ x, y });
  }, [W, H, insets.top, insets.bottom, geo, pos]);

  // out of the way while the keyboard is up
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    Animated.spring(menu, { toValue: open ? 1 : 0, useNativeDriver: true, friction: 7, tension: 70 }).start();
  }, [open, menu]);

  // put it back where the resident left it last time, clamped to this screen
  useEffect(() => {
    let live = true;
    loadQuickNav().then(spot => {
      if (!live || !spot || (spot.side !== 'left' && spot.side !== 'right') || typeof spot.down !== 'number') return;
      const down = Math.min(Math.max(spot.down, 0), 1);
      const x = spot.side === 'left' ? EDGE : geo.W - SIZE - EDGE, y = Math.round(geo.minY + down * (geo.maxY - geo.minY));
      Object.assign(geo, { x, y });
      pos.setValue({ x, y });
    }).catch(() => {});
    return () => { live = false; };
  }, [geo, pos]);

  const [drag] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > MOVED,
    onPanResponderGrant: () => { pos.setOffset({ x: geo.x, y: geo.y }); pos.setValue({ x: 0, y: 0 }); },
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      pos.flattenOffset();
      // barely moved: that was a tap
      if (Math.abs(g.dx) < MOVED && Math.abs(g.dy) < MOVED) { pos.setValue({ x: geo.x, y: geo.y }); setOpen(true); return; }
      // settle on the nearer side, inside the screen
      geo.x = geo.x + g.dx + SIZE / 2 < geo.W / 2 ? EDGE : geo.W - SIZE - EDGE;
      geo.y = Math.min(Math.max(geo.y + g.dy, geo.minY), geo.maxY);
      Animated.spring(pos, { toValue: { x: geo.x, y: geo.y }, useNativeDriver: false, friction: 7 }).start();
      saveQuickNav({ side: geo.x === EDGE ? 'left' : 'right', down: geo.maxY > geo.minY ? (geo.y - geo.minY) / (geo.maxY - geo.minY) : 0.5 });
    },
    onPanResponderTerminate: () => { pos.flattenOffset(); Animated.spring(pos, { toValue: { x: geo.x, y: geo.y }, useNativeDriver: false }).start(); },
  }));

  const go = (to: Href) => { setOpen(false); router.navigate(to); };

  // the circle: items evenly round the rim, the close button in the middle
  const D = Math.min(W - 36, 330), R = D / 2 - 50, ITEM_W = 76;
  return (
    <>
      {open && (
        <View style={[StyleSheet.absoluteFill, s.layer]}>
          <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={() => setOpen(false)} accessibilityLabel={t('fab.close')} />
          <Animated.View style={[s.disc, { width: D, height: D, borderRadius: D / 2, left: (W - D) / 2, top: (H - D) / 2, opacity: menu, transform: [{ scale: menu.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
            {ITEMS.map((it, i) => {
              const a = (-90 + (i * 360) / ITEMS.length) * (Math.PI / 180);
              return (
                <Pressable key={it.l} onPress={() => go(it.to)} accessibilityRole="button" accessibilityLabel={t(it.l)}
                  style={({ pressed }) => [s.item, { width: ITEM_W, left: D / 2 + R * Math.cos(a) - ITEM_W / 2, top: D / 2 + R * Math.sin(a) - 32 }, pressed && { transform: [{ scale: 0.92 }] }]}>
                  <View style={[s.itemIc, { backgroundColor: it.bg }]}><Icon name={it.ic} size={21} color={it.fg} /></View>
                  <Txt w={700} style={s.itemL} numberOfLines={2}>{t(it.l)}</Txt>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('fab.close')} style={[s.close, { left: D / 2 - 28, top: D / 2 - 28 }]}>
              <Icon name="close" size={26} color="#fff" />
            </Pressable>
          </Animated.View>
        </View>
      )}
      {!open && !typing && (
        <Animated.View
          {...drag.panHandlers}
          accessible accessibilityRole="button" accessibilityLabel={t('fab.menu')} accessibilityHint={t('fab.hint')} onAccessibilityTap={() => setOpen(true)}
          style={[s.fab, { transform: pos.getTranslateTransform() }]}
        >
          <View style={s.fabRing}><Icon name="apps" size={22} color="#fff" /></View>
        </Animated.View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  layer: { zIndex: 50, elevation: 50 },
  backdrop: { backgroundColor: 'rgba(23,19,49,0.45)' },
  disc: { position: 'absolute', backgroundColor: '#fff', shadowColor: '#171331', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 24 },
  item: { position: 'absolute', alignItems: 'center', gap: 4 },
  itemIc: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  itemL: { fontSize: 10.5, color: C.ink2, textAlign: 'center', lineHeight: 13 },
  close: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: 'rgba(124,85,247,0.25)', padding: 5, zIndex: 40, elevation: 40 },
  fabRing: { flex: 1, borderRadius: SIZE / 2, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center', shadowColor: '#7C55F7', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
