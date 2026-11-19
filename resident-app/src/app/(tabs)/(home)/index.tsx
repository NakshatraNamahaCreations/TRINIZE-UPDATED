import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Keyboard, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance, type StyleProp, type ViewStyle } from 'react-native';
import { AnnouncementCard } from '@/components/AnnouncementCard';
import { GateHome } from '@/components/GateHome';
import { useEnter, usePressScale } from '@/components/Motion';
import { useUI } from '@/components/Overlay';
import { useTour, useTourTarget } from '@/components/Tutorial';
import { BrandTile, Btn, CountUp, FadeIn, Header, Icon, IconTile, Meta, Screen, Sect, stagger, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { LIVE } from '@/lib/api';
import { useAlbums } from '@/lib/gallery';
import { greeting } from '@/lib/greeting';
import { ME, myStats, SOCIETY } from '@/store/data';
import type { ImpactFocus } from './impact';
import { useStore } from '@/store/store';
import { C, GRAD } from '@/theme';

const QUICKS: { ic: IconName; l: Key; to: '/discussions' | '/events' | '/polls' | '/directory'; bg: string; fg: string }[] = [
  { ic: 'chatbubbles-outline', l: 'home.q.discuss', to: '/discussions', bg: C.accBg, fg: C.acc },
  { ic: 'calendar-outline', l: 'home.q.events', to: '/events', bg: '#E4F7EE', fg: '#067647' },
  { ic: 'bar-chart-outline', l: 'home.q.polls', to: '/polls', bg: '#FEF0DC', fg: '#B54708' },
  { ic: 'people-outline', l: 'home.q.directory', to: '/directory', bg: '#E3F3FC', fg: '#0369A1' },
];

/** the four house rules, each with its own colour so the card reads at a glance */
const GUIDELINES: { l: Key; ic: IconName; bg: string; fg: string }[] = [
  { l: 'home.g.respect', ic: 'people-outline', bg: '#E3F3FC', fg: '#0369A1' },
  { l: 'home.g.kind', ic: 'heart-outline', bg: '#FCE7F3', fg: '#BE185D' },
  { l: 'home.g.positive', ic: 'sunny-outline', bg: '#FEF0DC', fg: '#B54708' },
  { l: 'home.g.noAbuse', ic: 'shield-checkmark-outline', bg: '#E4F7EE', fg: '#067647' },
];

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

export default function Home() {
  const router = useRouter();
  const { state, ready } = useStore();
  const tour = useTour();
  const noticesRef = useTourTarget('notices');
  // Home stays mounted under other screens; the tutorial points at Home's controls, so it waits until Home is showing
  const focused = useIsFocused();

  // first sign-in (or Profile → App tour): once this number's data has loaded and Home has settled
  // at the top, walk through the real controls
  useEffect(() => {
    if (!ready || state.welcomed || !focused) return;
    scroll.current?.scrollTo({ y: 0, animated: false });
    const h = setTimeout(tour.start, 1000);
    return () => clearTimeout(h);
  }, [ready, state.welcomed, focused, tour.start]);
  const { openSheet } = useUI();
  const { t, tx } = useT();
  const { albums } = useAlbums();
  const scroll = useRef<ScrollViewInstance>(null);

  // sign-in lands here while the code keyboard is still closing; as the window grows back the list
  // could be left part-way down with the greeting cut off — hold it at the top for the first moments
  useEffect(() => {
    Keyboard.dismiss();
    const top = () => scroll.current?.scrollTo({ y: 0, animated: false });
    const timers = [0, 250, 700].map(ms => setTimeout(top, ms));
    const sub = Keyboard.addListener('keyboardDidHide', top);
    const stop = setTimeout(() => sub.remove(), 1500);
    return () => { timers.forEach(clearTimeout); clearTimeout(stop); sub.remove(); };
  }, []);

  // important notices that still need an acknowledgement sit above the greeting until acknowledged
  const attention = state.announcements.filter(a => a.pri === 'High' && a.ack && !a.acked);
  const rest = state.announcements.filter(a => !attention.includes(a));
  const wall = state.gratitudes.filter(g => g.to === 'The whole community' || g.by === ME.name).slice(0, 2);
  const my = myStats(state);
  const impact: [ImpactFocus, IconName, number, Key, string, string][] = [
    ['gratitudes', 'heart', my.gratitudes, 'home.impact.gratitudes', '#F1ECFE', C.acc],
    ['chats', 'chatbubble-ellipses', my.chats, 'home.impact.chats', '#E3F3FC', '#0369A1'],
    ['days', 'flame', my.days, 'home.impact.days', '#FEF0DC', '#D97706'],
  ];

  return (
    <Screen scrollRef={scroll} header={<Header bell title={
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <BrandTile letter="P" />
        <Txt w={800} style={{ fontSize: 16 }}>{SOCIETY.short}</Txt>
      </View>
    } />}>
      {attention.length > 0 && (
        <View ref={noticesRef} collapsable={false}>
          <Sect title={t('home.attention')} />
          {attention.map((a, i) => <AnnouncementCard key={a.id} a={a} showAck delay={stagger(i)} />)}
        </View>
      )}
      {/* someone at the gate comes before everything else */}
      <GateHome />
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
            <Txt w={700} numberOfLines={2} style={{ fontSize: 12, color: C.ink2, textAlign: 'center' }}>{t(l)}</Txt>
          </Tile>
        ))}
      </View>

      <View style={s.quicks}>
        {QUICKS.map((q, i) => (
          <Tile key={q.l} delay={260 + stagger(i, 60)} style={s.quick} label={t(q.l)} onPress={() => router.push(q.to)}>
            <IconTile name={q.ic} size={36} bg={q.bg} fg={q.fg} />
            <Txt w={700} numberOfLines={1} style={{ fontSize: 12, color: C.ink2 }}>{t(q.l)}</Txt>
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
              {g.by === ME.name && g.to !== 'The whole community' && <Txt w={700} style={{ color: C.ai, fontSize: 12 }}>{t('home.private')}</Txt>}
            </Meta>
          </LinearGradient>
        </FadeIn>
      ))}
      <Btn full variant="gradient" icon="heart" label={t('home.sendGratitude')} onPress={() => openSheet('gratitude')} />

      <Sect title={t('home.announcements')} action={t('common.viewAll')} onAction={() => router.push('/announcements')} />
      {rest.slice(0, 2).map((a, i) => <AnnouncementCard key={a.id} a={a} showAck delay={stagger(i)} />)}

      <Pressable onPress={() => router.push('/profile/guidelines')} accessibilityRole="button" accessibilityLabel={t('home.guidelines')} style={({ pressed }) => [s.guide, pressed && { opacity: 0.92 }]}>
        <LinearGradient colors={['#F4EFFF', '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.guideIn}>
          <Icon name="shield-checkmark" size={96} color="#7C55F7" style={s.guideMark} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconTile name="shield-checkmark" size={38} radius={11} bg={C.acc} fg="#fff" />
            <View style={{ flex: 1 }}>
              <Txt w={800} style={{ fontSize: 14.5 }}>{t('home.guidelines')}</Txt>
              <Txt style={{ fontSize: 11.5, color: C.ink2, marginTop: 1 }}>{t('profile.guide.s')}</Txt>
            </View>
            <View style={s.guideGo}><Icon name="chevron-forward" size={15} color={C.acc} /></View>
          </View>
          <View style={s.guideGrid}>
            {GUIDELINES.map(g => (
              <View key={g.l} style={s.guideChip}>
                <IconTile name={g.ic} size={28} radius={8} bg={g.bg} fg={g.fg} />
                <Txt w={600} style={{ flex: 1, fontSize: 12, lineHeight: 15.5 }}>{t(g.l)}</Txt>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Pressable>

      {albums.length > 0 && <>
      <Sect title={t('home.moments')} action={t('common.viewAll')} onAction={() => router.push('/gallery')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 14, paddingVertical: 6 }}>
        {albums.slice(0, 8).map((m, i) => { const name = m.titleKey ? t(m.titleKey) : m.title; return (
          <FadeIn key={m.id} delay={stagger(i, 70)}>
            <Pressable onPress={() => router.push({ pathname: '/gallery', params: { album: m.id } })} accessibilityLabel={name} style={({ pressed }) => pressed && { opacity: 0.8 }}>
              <View style={s.moment}>
                {m.cover ? (
                  <View style={s.momentArt}>
                    <Image source={{ uri: m.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    <View />
                    <View style={s.momentCount}>
                      <Icon name="images-outline" size={11} color="#fff" />
                      <Txt w={700} style={{ fontSize: 10.5, color: '#fff' }}>{m.count}</Txt>
                    </View>
                  </View>
                ) : (
                  <LinearGradient colors={m.art?.g ?? ['#EDE9FE', '#F5F3FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.momentArt}>
                    <Icon name={m.art?.ic ?? 'images-outline'} size={84} color={m.art?.fg ?? C.acc} style={s.momentMark} />
                    <View style={s.momentIcon}><Icon name={m.art?.ic ?? 'images-outline'} size={20} color={m.art?.fg ?? C.acc} /></View>
                    <View style={s.momentCount}>
                      <Icon name="images-outline" size={11} color="#fff" />
                      <Txt w={700} style={{ fontSize: 10.5, color: '#fff' }}>{m.count}</Txt>
                    </View>
                  </LinearGradient>
                )}
                <View style={s.momentFoot}>
                  <Txt w={700} numberOfLines={2} style={{ fontSize: 12.5, lineHeight: 16 }}>{name}</Txt>
                  <Txt style={{ fontSize: 11, color: C.ink3, marginTop: 1 }}>{t(m.count === 1 ? 'gallery.photo1' : 'gallery.photos', { n: m.count })}</Txt>
                </View>
              </View>
            </Pressable>
          </FadeIn>
        ); })}
      </ScrollView>
      <Meta style={{ paddingHorizontal: 16, paddingTop: 4 }}>{t(LIVE ? 'home.momentsShared' : 'home.momentsNote')}</Meta>
      </>}
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
  guide: { marginHorizontal: 14, marginVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#E4DAFB', overflow: 'hidden', backgroundColor: '#fff' },
  guideIn: { padding: 14 },
  guideMark: { position: 'absolute', right: -18, bottom: -22, opacity: 0.06 },
  guideGo: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E4DAFB', alignItems: 'center', justifyContent: 'center' },
  guideGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  guideChip: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 9 },
  moment: { width: 148, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  momentArt: { height: 92, padding: 10, justifyContent: 'space-between', overflow: 'hidden', backgroundColor: C.dimBg },
  momentMark: { position: 'absolute', right: -16, bottom: -18, opacity: 0.16 },
  momentIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  momentCount: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(23,19,49,0.55)', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  momentFoot: { paddingVertical: 9, paddingHorizontal: 11 },
});
