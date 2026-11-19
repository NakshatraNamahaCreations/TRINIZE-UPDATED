import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, TextInput, View, type LayoutRectangle, type StyleProp, type ScrollViewInstance, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { unreadCount, useStore } from '@/store/store';
import { usePullRefresh } from '@/lib/refresh';
import { C, font, GRAD } from '@/theme';

import { Icon, IconTile, type IconName } from './Icon';
import { FadeIn, useEnter, usePressScale } from './Motion';
import { Meta, Txt } from './Txt';

export { Icon, IconTile, Meta, Txt, type IconName };
export { CountUp, FadeIn, stagger } from './Motion';

const APressable = Animated.createAnimatedComponent(Pressable);

/* ---------- containers ---------- */
/** Fades up on mount (pass `delay={stagger(i)}` in lists); tappable cards also squish while pressed. */
export function Card({ children, style, onPress, delay = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; delay?: number }) {
  // entrance lives on a wrapper so it can't override a caller's own opacity (e.g. hidden posts)
  const enter = useEnter(delay);
  const press = usePressScale(0.98);
  const [pressed, setPressed] = useState(false);
  if (!onPress) return <Animated.View style={enter}><View style={[s.card, style]}>{children}</View></Animated.View>;
  return (
    <Animated.View style={enter}>
      <APressable
        onPress={onPress}
        onPressIn={() => { setPressed(true); press.onPressIn(); }}
        onPressOut={() => { setPressed(false); press.onPressOut(); }}
        style={[s.card, style, pressed && { backgroundColor: '#FAFBFE' }, { transform: [{ scale: press.scale }] }]}
      >
        {children}
      </APressable>
    </Animated.View>
  );
}

export function Sect({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.sect}>
      <Txt w={800} style={s.sectText}>{title.toUpperCase()}</Txt>
      {action && <Pressable onPress={onAction} hitSlop={10}><Txt w={700} style={s.sectLink}>{action}</Txt></Pressable>}
    </View>
  );
}

export const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) =>
  <View style={[s.row, style]}>{children}</View>;

/* ---------- pills ---------- */
export type PillTone = 'acc' | 'good' | 'warn' | 'bad' | 'ai' | 'dim';
const PILL: Record<PillTone, [string, string]> = {
  acc: [C.acc, C.accBg], good: [C.good, C.goodBg], warn: [C.warn, C.warnBg],
  bad: [C.bad, C.badBg], ai: [C.ai, C.aiBg], dim: [C.ink2, C.dimBg],
};
export function Pill({ tone = 'acc', children }: { tone?: PillTone; children: ReactNode }) {
  const [fg, bg] = PILL[tone];
  return <View style={[s.pill, { backgroundColor: bg }]}><Txt w={800} style={[s.pillText, { color: fg }]}>{children}</Txt></View>;
}

/* ---------- buttons ---------- */
type BtnVariant = 'primary' | 'ghost' | 'soft' | 'danger' | 'gradient' | 'white';
export function Btn({ label, icon, onPress, variant = 'primary', full, disabled, style, textStyle }: {
  label: string; icon?: IconName; onPress?: () => void; variant?: BtnVariant; full?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>;
}) {
  const v = BTN[variant];
  const press = usePressScale(0.96);
  const [pressed, setPressed] = useState(false);
  const inner = (
    <>
      {icon && <Icon name={icon} size={16} color={v.fg} />}
      <Txt w={700} style={[s.btnText, { color: v.fg }, textStyle]}>{label}</Txt>
    </>
  );
  return (
    <APressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => { setPressed(true); press.onPressIn(); }}
      onPressOut={() => { setPressed(false); press.onPressOut(); }}
      style={[s.btn, { backgroundColor: v.bg, borderColor: v.border ?? v.bg }, full && s.full, (disabled || pressed) && { opacity: disabled ? 0.5 : 0.85 }, style, { transform: [{ scale: press.scale }] }]}
    >
      {variant === 'gradient'
        ? <LinearGradient colors={GRAD.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
        : null}
      {inner}
    </APressable>
  );
}
const BTN: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: C.acc, fg: '#fff' },
  gradient: { bg: C.acc, fg: '#fff' },
  ghost: { bg: '#fff', fg: C.acc, border: C.accBorder },
  soft: { bg: C.accBg, fg: C.acc },
  danger: { bg: C.badBg, fg: C.bad },
  white: { bg: '#fff', fg: '#6D28D9' },
};

/** Segmented pill tabs used by Discussions, Events and Notifications — the active pill slides between them. */
export function Segmented<K extends string>({ items, value, onChange }: { items: [K, string][]; value: K; onChange: (k: K) => void }) {
  const idx = Math.max(0, items.findIndex(([k]) => k === value));
  const [boxes, setBoxes] = useState<LayoutRectangle[]>([]);
  const [x] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  const box = boxes[idx];
  useEffect(() => {
    if (!box) return;
    // jump into place on first layout, glide on every change after
    if (!placed.current) { x.setValue(box.x); placed.current = true; return; }
    Animated.spring(x, { toValue: box.x, speed: 18, bounciness: 6, useNativeDriver: true }).start();
  }, [box, x]);

  return (
    <View style={s.tabs}>
      {items.map(([k, l], i) => (
        <Pressable
          key={k}
          onPress={() => onChange(k)}
          onLayout={e => { const r = e.nativeEvent.layout; setBoxes(b => { const n = [...b]; n[i] = r; return n; }); }}
          style={s.tab}
        >
          <Txt w={700} style={s.tabText}>{l}</Txt>
        </Pressable>
      ))}
      {box && (
        <Animated.View pointerEvents="none" style={[s.tabPill, { top: box.y, width: box.width, height: box.height, transform: [{ translateX: x }] }]}>
          <Txt w={700} style={[s.tabText, { color: '#fff' }]}>{items[idx][1]}</Txt>
        </Animated.View>
      )}
    </View>
  );
}

export function EmptyState({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <FadeIn style={s.empty}>
      <IconTile name={icon} size={56} radius={28} style={{ marginBottom: 12 }} />
      <Txt w={700} style={{ fontSize: 14, marginBottom: 4, textAlign: 'center' }}>{title}</Txt>
      {!!body && <Txt style={{ fontSize: 12.5, color: C.ink2, textAlign: 'center', marginBottom: 14 }}>{body}</Txt>}
      {action && <Btn label={action} onPress={onAction} />}
    </FadeIn>
  );
}

export function Input({ style, ...rest }: TextInputProps) {
  return <TextInput placeholderTextColor={C.ink3} {...rest} style={[s.input, style]} />;
}

/* ---------- header + screen ---------- */
export function Header({ title, back, bell }: { title: ReactNode; back?: Href; bell?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const { t } = useT();
  const unread = unreadCount(state);
  const ring = useBellRing(bell ? unread : 0);
  return (
    <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
      {back && (
        <Pressable
          hitSlop={12}
          accessibilityLabel={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.navigate(back))}
          style={s.back}
        >
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        {typeof title === 'string' ? <Txt w={800} style={s.hdrTitle} numberOfLines={1}>{title}</Txt> : title}
      </View>
      {bell && (
        <Pressable hitSlop={12} accessibilityLabel={t('header.notifications')} onPress={() => router.navigate('/notifications')}>
          <Animated.View style={ring.bell}>
            <Icon name="notifications-outline" size={23} color={C.ink} />
          </Animated.View>
          {unread > 0 && <Animated.View style={[s.bDot, ring.badge]}><Txt w={800} style={s.bDotText}>{unread}</Txt></Animated.View>}
        </Pressable>
      )}
    </View>
  );
}

/** Rings the bell (and pops the badge) on mount with unread items, and whenever the count goes up. */
function useBellRing(unread: number) {
  const [swing] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(1));
  const prev = useRef(0);
  useEffect(() => {
    const grew = unread > prev.current;
    prev.current = unread;
    if (!grew) return;
    pop.setValue(0.4);
    const a = Animated.parallel([
      Animated.sequence([16, -14, 10, -8, 4, 0].map(d => Animated.timing(swing, { toValue: d, duration: 80, easing: Easing.inOut(Easing.quad), useNativeDriver: true }))),
      Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 14, useNativeDriver: true }),
    ]);
    // after the screen settles, so it reads as a nudge rather than part of the transition
    const h = setTimeout(() => a.start(), 450);
    return () => { clearTimeout(h); a.stop(); };
  }, [unread, swing, pop]);
  return {
    // pivot near the top of the bell, like it hangs from its loop
    bell: { transform: [{ translateY: -8 }, { rotate: swing.interpolate({ inputRange: [-20, 20], outputRange: ['-20deg', '20deg'] }) }, { translateY: 8 }] },
    badge: { transform: [{ scale: pop }] },
  };
}

export function Screen({ header, children, scroll = true, scrollRef }: { header: ReactNode; children: ReactNode; scroll?: boolean; scrollRef?: Ref<ScrollViewInstance> }) {
  // pull down to read everything again; screens that scroll by themselves add the same control to their own list
  const refreshControl = usePullRefresh();
  return (
    <View style={s.screen}>
      {header}
      {scroll
        ? <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 18 }} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>{children}</ScrollView>
        : children}
    </View>
  );
}

/** Brand tile used in the home header ("P" for Prestige Lakeside). */
export function BrandTile({ letter, size = 26 }: { letter: string; size?: number }) {
  return (
    <LinearGradient colors={GRAD.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Txt w={800} style={{ color: '#fff', fontSize: 12 }}>{letter}</Txt>
    </LinearGradient>
  );
}

export const initials = (n: string) =>
  n.split(' ').filter(w => /^[A-Za-z]/.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, marginHorizontal: 14, marginVertical: 6, paddingVertical: 13, paddingHorizontal: 14 },
  sect: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectText: { fontSize: 12, letterSpacing: 1, color: C.ink3 },
  sectLink: { fontSize: 12.5, color: C.acc },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, letterSpacing: 0.2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, overflow: 'hidden', minHeight: 40 },
  btnText: { fontSize: 12.5 },
  full: { marginHorizontal: 14, marginVertical: 6, alignSelf: 'stretch' },
  tabs: { flexDirection: 'row', gap: 6, paddingTop: 10, paddingHorizontal: 14, paddingBottom: 2 },
  tab: { flex: 1, backgroundColor: C.dimBg, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  tabText: { fontSize: 12, color: C.ink2 },
  tabPill: { position: 'absolute', left: 0, backgroundColor: C.acc, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 30, paddingHorizontal: 24, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff', fontSize: 14, color: C.ink, ...font(400) },
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  back: { marginLeft: -6 },
  hdrTitle: { fontSize: 16 },
  bDot: { position: 'absolute', top: -4, right: -5, backgroundColor: C.red, borderRadius: 999, minWidth: 15, height: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bDotText: { color: '#fff', fontSize: 8.5 },
});
