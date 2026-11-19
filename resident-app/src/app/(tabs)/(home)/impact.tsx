import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Card, CountUp, FadeIn, Header, Icon, IconTile, Meta, Screen, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ME, myStats, SOCIETY } from '@/store/data';
import { useStore } from '@/store/store';
import { usePullRefresh } from '@/lib/refresh';
import { C, GRAD } from '@/theme';

export type ImpactFocus = 'gratitudes' | 'chats' | 'days';


function SectionHead({ icon, bg, fg, title, body }: { icon: IconName; bg: string; fg: string; title: string; body: string }) {
  return (
    <View style={s.head}>
      <IconTile name={icon} size={36} radius={18} bg={bg} fg={fg} />
      <View style={{ flex: 1 }}>
        <Txt w={800} style={{ fontSize: 14 }}>{title}</Txt>
        <Meta>{body}</Meta>
      </View>
    </View>
  );
}

export default function Impact() {
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: ImpactFocus }>();
  const { state } = useStore();
  const { openSheet } = useUI();
  const { t, tx } = useT();
  const scroll = useRef<ScrollViewInstance>(null);
  const refreshControl = usePullRefresh();
  const [ys, setYs] = useState<Partial<Record<ImpactFocus, number>>>({});
  const jumped = useRef(false);

  const sent = state.gratitudes.filter(g => g.by === ME.name);
  // newest first: today's chat, then earlier sessions — the same records the count is made from
  // connected, the server keeps the questions and hands back the newest few
  const asked = state.me.chats !== null ? state.me.pastChats.slice(0, 4)
    : [...state.me.pastChats, ...state.chat.log.flatMap(m => (m.who === 'me' ? [m.text] : []))].slice(-4).reverse();
  const last14 = state.me.last14;
  const daysN = (n: number) => (n === 1 ? t('impact.day1') : t('impact.daysN', { n }));
  const my = myStats(state);
  const stats: [ImpactFocus, IconName, number, Key][] = [
    ['gratitudes', 'heart', my.gratitudes, 'home.impact.gratitudes'],
    ['chats', 'chatbubble-ellipses', my.chats, 'home.impact.chats'],
    ['days', 'flame', my.days, 'home.impact.days'],
  ];

  // jump once to the card that was tapped on Home, as soon as its section has been laid out
  const target = focus ? ys[focus] : undefined;
  useEffect(() => {
    if (jumped.current || target === undefined) return;
    jumped.current = true;
    const h = setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, target - 10), animated: true }), 250);
    return () => clearTimeout(h);
  }, [target]);

  const place = (k: ImpactFocus) => (e: { nativeEvent: { layout: { y: number } } }) => {
    const y = e.nativeEvent.layout.y;
    setYs(prev => (prev[k] === y ? prev : { ...prev, [k]: y }));
  };

  return (
    <Screen scroll={false} header={<Header title={t('home.impact')} back="/" bell />}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 18 }} refreshControl={refreshControl}>
        <FadeIn>
          <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
            <Txt w={700} style={{ color: '#fff', fontSize: 13.5, lineHeight: 20 }}>{t('impact.hero', { society: SOCIETY.short })}</Txt>
            <View style={s.heroStats}>
              {stats.map(([k, ic, n, label]) => (
                <View key={k} style={[s.heroStat, focus === k && s.heroStatOn]}>
                  <Icon name={ic} size={16} color="#fff" />
                  <CountUp value={n} style={{ fontSize: 18, color: '#fff' }} />
                  <Txt w={600} style={{ fontSize: 11, color: 'rgba(255,255,255,.92)', textAlign: 'center' }}>{t(label)}</Txt>
                </View>
              ))}
            </View>
          </LinearGradient>
        </FadeIn>

        {/* gratitudes */}
        <View onLayout={place('gratitudes')}>
          <Card delay={80} style={focus === 'gratitudes' && s.focused}>
            <SectionHead icon="heart" bg="#F1ECFE" fg={C.acc} title={t('home.impact.gratitudes')} body={t('impact.grat.b')} />
            {sent.length ? sent.map((g, i) => (
              <View key={i} style={[s.item, i === sent.length - 1 && { borderBottomWidth: 0 }]}>
                <Txt style={{ fontSize: 12.5, lineHeight: 18 }}>“{g.text}”</Txt>
                <Meta style={{ marginTop: 4 }}>→ {tx('to', g.to)} · {tx('gcat', g.cat)} · {g.when}</Meta>
              </View>
            )) : <Meta style={{ paddingVertical: 8 }}>{t('impact.grat.empty')}</Meta>}
            <Btn variant="soft" icon="heart" label={t('home.sendGratitude')} onPress={() => openSheet('gratitude')} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
          </Card>
        </View>

        {/* helpful chats */}
        <View onLayout={place('chats')}>
          <Card delay={140} style={focus === 'chats' && s.focused}>
            <SectionHead icon="chatbubble-ellipses" bg="#E3F3FC" fg="#0369A1" title={t('home.impact.chats')} body={t('impact.chats.b')} />
            {asked.length ? (
              <>
                <Txt w={800} style={s.small}>{t('impact.chats.recent').toUpperCase()}</Txt>
                {asked.map((q, i) => (
                  <View key={i} style={s.q}>
                    <Icon name="chatbubble-outline" size={14} color={C.ink3} style={{ marginTop: 2 }} />
                    <Txt style={{ fontSize: 12.5, flex: 1 }}>{q}</Txt>
                  </View>
                ))}
              </>
            ) : <Meta style={{ paddingVertical: 8 }}>{t('impact.chats.empty')}</Meta>}
            <Btn variant="soft" icon="sparkles" label={t('impact.chats.open')} onPress={() => router.navigate('/assistant')} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
          </Card>
        </View>

        {/* days active */}
        <View onLayout={place('days')}>
          <Card delay={200} style={focus === 'days' && s.focused}>
            <SectionHead icon="flame" bg="#FEF0DC" fg="#D97706" title={t('home.impact.days')} body={t('impact.days.b')} />
            <View style={s.streaks}>
              <View style={s.streakBox}>
                <Meta>{t('impact.streak')}</Meta>
                <Txt w={800} style={{ fontSize: 16, color: '#D97706' }}>{daysN(state.me.streak)}</Txt>
              </View>
              <View style={s.streakBox}>
                <Meta>{t('impact.best')}</Meta>
                <Txt w={800} style={{ fontSize: 16 }}>{daysN(state.me.best)}</Txt>
              </View>
            </View>
            <Txt w={800} style={s.small}>{t('impact.last14').toUpperCase()}</Txt>
            <View style={s.grid}>
              {last14.map((on, i) => (
                <View key={i} style={[s.day, on ? s.dayOn : null, i === last14.length - 1 && s.today]}>
                  {!!on && <Icon name="flame" size={12} color="#fff" />}
                </View>
              ))}
            </View>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { marginTop: 12, marginHorizontal: 14, borderRadius: 16, padding: 16 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  heroStat: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,.14)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4, borderWidth: 1, borderColor: 'transparent' },
  heroStatOn: { borderColor: 'rgba(255,255,255,.7)', backgroundColor: 'rgba(255,255,255,.22)' },
  focused: { borderColor: C.accBorder },
  head: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 },
  item: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  small: { fontSize: 12, letterSpacing: 0.6, color: C.ink3, marginTop: 6, marginBottom: 4 },
  q: { flexDirection: 'row', gap: 8, paddingVertical: 5 },
  streaks: { flexDirection: 'row', gap: 8 },
  streakBox: { flex: 1, backgroundColor: C.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.dimBg, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: '#F59E0B' },
  today: { borderWidth: 2, borderColor: '#B45309' },
});
