import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { MOMENTS } from '@/components/moments';
import { FadeIn, Header, Icon, Meta, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';

type Album = (typeof MOMENTS)[number];
const COLS = 3;
const GAP = 6;
/** varied gradient angles so placeholder photos in an album don't look identical */
const ANGLES = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0.5, y: 0 }];

function Photo({ album, i, size, onPress }: { album: Album; i: number; size: number; onPress: () => void }) {
  const a = ANGLES[i % ANGLES.length];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width: size, height: size }, pressed && { opacity: 0.8 }]}>
      <LinearGradient colors={album.g} start={a} end={{ x: 1 - a.x, y: 1 - a.y }} style={s.photo}>
        <Icon name={album.ic} size={size * 0.32} color={album.fg} style={{ opacity: 0.35 + (i % 3) * 0.2 }} />
      </LinearGradient>
    </Pressable>
  );
}

export default function Gallery() {
  const { album: focus } = useLocalSearchParams<{ album?: string }>();
  const { t } = useT();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);
  const [ys, setYs] = useState<Record<string, number>>({});
  const [view, setView] = useState<{ album: Album; i: number } | null>(null);
  const size = (width - 28 - GAP * (COLS - 1)) / COLS;

  // opening from a Home tile jumps to that album
  const target = focus ? ys[focus] : undefined;
  useEffect(() => {
    if (target !== undefined) scroll.current?.scrollTo({ y: Math.max(0, target - 6), animated: true });
  }, [target]);

  const step = (d: number) => setView(v => (v ? { ...v, i: (v.i + d + v.album.count) % v.album.count } : v));

  return (
    <Screen scroll={false} header={<Header title={t('home.moments')} back="/" bell />}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 18 }}>
        <Meta style={{ paddingHorizontal: 16, paddingTop: 10 }}>{t('gallery.note')}</Meta>
        {MOMENTS.map((m, ai) => (
          <View key={m.id} onLayout={e => { const y = e.nativeEvent.layout.y; setYs(p => (p[m.id] === y ? p : { ...p, [m.id]: y })); }}>
            <Sect title={t(m.l) + ' · ' + t('gallery.photos', { n: m.count })} />
            <FadeIn delay={ai * 70} style={s.grid}>
              {Array.from({ length: m.count }, (_, i) => <Photo key={i} album={m} i={i} size={size} onPress={() => setView({ album: m, i })} />)}
            </FadeIn>
          </View>
        ))}
      </ScrollView>

      <Modal visible={view !== null} transparent animationType="fade" onRequestClose={() => setView(null)} statusBarTranslucent>
        {view && (
          <View style={s.viewer}>
            <Pressable onPress={() => setView(null)} accessibilityLabel={t('common.close')} hitSlop={12} style={s.close}>
              <Icon name="close" size={26} color="#fff" />
            </Pressable>
            <LinearGradient colors={view.album.g} start={ANGLES[view.i % 4]} end={{ x: 1 - ANGLES[view.i % 4].x, y: 1 - ANGLES[view.i % 4].y }} style={[s.big, { width: width - 32, height: width - 32 }]}>
              <Icon name={view.album.ic} size={96} color={view.album.fg} />
            </LinearGradient>
            <Txt w={700} style={{ color: '#fff', fontSize: 15, marginTop: 16 }}>{t(view.album.l)}</Txt>
            <Meta style={{ color: 'rgba(255,255,255,.7)', marginTop: 2 }}>{t('gallery.of', { i: view.i + 1, n: view.album.count })}</Meta>
            <View style={s.nav}>
              <Pressable onPress={() => step(-1)} accessibilityLabel={t('gallery.prev')} style={s.navBtn}><Icon name="chevron-back" size={24} color="#fff" /></Pressable>
              <Pressable onPress={() => step(1)} accessibilityLabel={t('gallery.next')} style={s.navBtn}><Icon name="chevron-forward" size={24} color="#fff" /></Pressable>
            </View>
          </View>
        )}
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: 14, paddingTop: 4 },
  photo: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(8,6,20,.94)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 48, right: 20 },
  big: { borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  nav: { flexDirection: 'row', gap: 24, marginTop: 22 },
  navBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,.14)', alignItems: 'center', justifyContent: 'center' },
});
