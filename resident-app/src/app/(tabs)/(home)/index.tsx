import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AnnouncementCard } from '@/components/AnnouncementCard';
import { MOMENTS } from '@/components/moments';
import { useEnter, usePressScale } from '@/components/Motion';
import { useUI } from '@/components/Overlay';
import { BrandTile, Btn, Card, CountUp, FadeIn, Header, Icon, IconTile, Meta, Screen, Sect, stagger, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ME, SOCIETY } from '@/store/data';
import type { ImpactFocus } from './impact';
import { useStore } from '@/store/store';
import { C, GRAD } from '@/theme';

const QUICKS: { ic: IconName; l: Key; to: '/discussions' | '/events' | '/polls' | '/directory'; bg: string; fg: string }[] = [
  { ic: 'chatbubbles-outline', l: 'home.q.discuss', to: '/discussions', bg: C.accBg, fg: C.acc },
  { ic: 'calendar-outline', l: 'home.q.events', to: '/events', bg: '#E4F7EE', fg: '#067647' },
  { ic: 'bar-chart-outline', l: 'home.q.polls', to: '/polls', bg: '#FEF0DC', fg: '#B54708' },
  { ic: 'people-outline', l: 'home.q.directory', to: '/directory', bg: '#E3F3FC', fg: '#0369A1' },
];

const GUIDELINES: Key[] = ['home.g.respect', 'home.g.kind', 'home.g.positive', 'home.g.noAbuse'];

const APressable = Animated.createAnimatedComponent(Pressable);

/** Double-thump heartbeat on the hero's watermark heart, resting between beats. */
function Heartbeat() {
  const [b] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const beat = (to: number, ms: number) => Animated.timing(b, { toValue: to, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([beat(1, 140), beat(0, 160), beat(0.6, 120), beat(0, 220), Animated.delay(1300)]));
    loop.start();
    return () => loop.stop();
  }, [b]);
  return (
    <Animated.View style={[s.heroHeart, { transform: [{ scale: b.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }]}>
      <Icon name="heart" size={96} color="rgba(255,255,255,.13)" />
    </Animated.View>
  );
}

/** Home grid tile — fades in on its stagger and squishes while pressed. */
function Tile({ delay, onPress, style, label, children }: { delay: number; onPress: () => void; style: StyleProp<ViewStyle>; label: string; children: ReactNode }) {
  const enter = useEnter(delay, 10);
  const press = usePressScale(0.93);
  const [pressed, setPressed] = useState(false);
  return (
    <Animated.View style={[{ flex: 1 }, enter]}>
      <APressable
        onPress={onPress}
        onPressIn={() => { setPressed(true); press.onPressIn(); }}
        onPressOut={() => { setPressed(false); press.onPressOut(); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[style, pressed && { borderColor: C.acc }, { transform: [{ scale: press.scale }] }]}
      >
        {children}
      </APressable>
    </Animated.View>
  );
}

function greeting(): Key {
  const h = new Date().getHours();
  return h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening';
}

export default function Home() {
  const router = useRouter();
  const { state } = useStore();
  const { openSheet } = useUI();
  const { t, tx } = useT();
  const wall = state.gratitudes.filter(g => g.to === 'The whole community' || g.by === ME.name).slice(0, 2);
  const impact: [ImpactFocus, IconName, number, Key, string, string][] = [
    ['gratitudes', 'heart', state.me.gratitudes, 'home.impact.gratitudes', '#F1ECFE', C.acc],
    ['chats', 'chatbubble-ellipses', state.me.chats, 'home.impact.chats', '#E3F3FC', '#0369A1'],
    ['days', 'flame', state.me.days, 'home.impact.days', '#FEF0DC', '#D97706'],
  ];

  return (
    <Screen header={<Header bell title={
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <BrandTile letter="P" />
        <Txt w={800} style={{ fontSize: 16 }}>{SOCIETY.short}</Txt>
      </View>
    } />}>
      <FadeIn>
        <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <Heartbeat />
          <Txt w={800} style={{ fontSize: 17, color: '#fff' }}>{t(greeting(), { name: ME.first })}</Txt>
          <Txt style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', marginTop: 2, lineHeight: 18 }}>
            {t('home.heroLine')}{'\n'}{t('home.motto')}
          </Txt>
          <Btn variant="white" icon="sparkles" label={t('home.ask')} onPress={() => router.navigate('/assistant')} style={{ marginTop: 12, alignSelf: 'flex-start' }} />
        </LinearGradient>
      </FadeIn>

      <Sect title={t('home.impact')} />
      <View style={s.impact}>
        {impact.map(([focus, ic, n, l, bg, fg], i) => (
          <Tile key={l} delay={120 + stagger(i, 70)} style={s.im} label={t(l)} onPress={() => router.push({ pathname: '/impact', params: { focus } })}>
            <IconTile name={ic} size={30} radius={15} bg={bg} fg={fg} />
            <CountUp value={n} style={{ fontSize: 16, marginTop: 4 }} />
            <Txt w={700} style={{ fontSize: 9.5, color: C.ink3 }}>{t(l)}</Txt>
          </Tile>
        ))}
      </View>

      <View style={s.quicks}>
        {QUICKS.map((q, i) => (
          <Tile key={q.l} delay={260 + stagger(i, 60)} style={s.quick} label={t(q.l)} onPress={() => router.push(q.to)}>
            <IconTile name={q.ic} size={36} bg={q.bg} fg={q.fg} />
            <Txt w={700} style={{ fontSize: 10.5, color: C.ink2 }}>{t(q.l)}</Txt>
          </Tile>
        ))}
      </View>

      <Sect title={t('home.wall')} />
      {wall.map((g, i) => (
        <FadeIn key={i} delay={stagger(i, 80)}>
          <LinearGradient colors={GRAD.gratitude} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gcard}>
            <Icon name="chatbox-ellipses-outline" size={16} color={C.acc} style={{ marginBottom: 4 }} />
            <Txt style={{ fontSize: 12.5, lineHeight: 19 }}>“{g.text}”</Txt>
            <Meta style={{ marginTop: 6 }}>
              {g.by === ME.name ? t('common.you') : g.by} → {tx('to', g.to)} · {tx('gcat', g.cat)} · {g.when}
              {g.by === ME.name && g.to !== 'The whole community' && <Txt w={700} style={{ color: C.ai, fontSize: 11 }}>{t('home.private')}</Txt>}
            </Meta>
          </LinearGradient>
        </FadeIn>
      ))}
      <Btn full variant="gradient" icon="heart" label={t('home.sendGratitude')} onPress={() => openSheet('gratitude')} />

      <Sect title={t('home.announcements')} action={t('common.viewAll')} onAction={() => router.push('/announcements')} />
      {state.announcements.slice(0, 2).map((a, i) => <AnnouncementCard key={a.id} a={a} showAck delay={stagger(i)} />)}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconTile name="shield-checkmark-outline" size={30} radius={8} />
          <Txt w={700} style={{ fontSize: 13 }}>{t('home.guidelines')}</Txt>
        </View>
        <View style={{ marginTop: 8, gap: 5 }}>
          {GUIDELINES.map(g => (
            <View key={g} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Icon name="checkmark-circle" size={15} color={C.good} />
              <Txt style={{ fontSize: 12, color: C.ink2 }}>{t(g)}</Txt>
            </View>
          ))}
        </View>
      </Card>

      <Sect title={t('home.moments')} action={t('common.viewAll')} onAction={() => router.push('/gallery')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingVertical: 6 }}>
        {MOMENTS.map((m, i) => (
          <FadeIn key={m.l} delay={stagger(i, 70)}>
            <Pressable onPress={() => router.push({ pathname: '/gallery', params: { album: m.id } })} accessibilityLabel={t(m.l)} style={({ pressed }) => pressed && { opacity: 0.8 }}>
              <LinearGradient colors={m.g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.moment}>
                <Icon name={m.ic} size={26} color={m.fg} />
                <Txt w={700} style={{ fontSize: 10, color: m.fg, marginTop: 6 }}>{t(m.l)}</Txt>
              </LinearGradient>
            </Pressable>
          </FadeIn>
        ))}
      </ScrollView>
      <Meta style={{ paddingHorizontal: 16, paddingTop: 4 }}>{t('home.momentsNote')}</Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { marginTop: 12, marginHorizontal: 14, borderRadius: 16, padding: 16, overflow: 'hidden' },
  heroHeart: { position: 'absolute', right: -14, top: -18 },
  impact: { flexDirection: 'row', gap: 8, marginTop: 6, marginHorizontal: 14 },
  im: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  quicks: { flexDirection: 'row', gap: 8, paddingTop: 10, paddingHorizontal: 14 },
  quick: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 11, alignItems: 'center', gap: 6 },
  gcard: { borderWidth: 1, borderColor: '#E4DAFB', borderRadius: 14, marginHorizontal: 14, marginVertical: 6, paddingVertical: 13, paddingHorizontal: 14 },
  moment: { width: 112, height: 84, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
