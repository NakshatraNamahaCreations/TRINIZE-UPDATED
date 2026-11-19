import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { FadeIn, Header, Icon, Meta, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { useAlbums, type GalleryAlbum } from '@/lib/gallery';
import { usePullRefresh } from '@/lib/refresh';
import { C } from '@/theme';

const COLS = 3;
const GAP = 6;
/** varied gradient angles so the demo's illustrated photos don't look identical */
const ANGLES = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0.5, y: 0 }];
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Photo({ album, i, size, onPress, label }: { album: GalleryAlbum; i: number; size: number; onPress: () => void; label: string }) {
  const p = album.photos[i], a = ANGLES[i % ANGLES.length];
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={label} style={({ pressed }) => [{ width: size, height: size }, pressed && { opacity: 0.8 }]}>
      {p.uri ? <Image source={{ uri: p.uri }} style={s.photo} resizeMode="cover" />
        : album.art && (
          <LinearGradient colors={album.art.g} start={a} end={{ x: 1 - a.x, y: 1 - a.y }} style={[s.photo, s.center]}>
            <Icon name={album.art.ic} size={size * 0.32} color={album.art.fg} style={{ opacity: 0.35 + (i % 3) * 0.2 }} />
          </LinearGradient>
        )}
    </Pressable>
  );
}

export default function Gallery() {
  const { album: focus } = useLocalSearchParams<{ album?: string }>();
  const { t } = useT();
  const { width, height } = useWindowDimensions();
  const { albums, ready } = useAlbums();
  const refreshControl = usePullRefresh();
  const scroll = useRef<ScrollViewInstance>(null);
  const [ys, setYs] = useState<Record<string, number>>({});
  const [view, setView] = useState<{ id: string; i: number } | null>(null);
  const size = (width - 28 - GAP * (COLS - 1)) / COLS;
  const name = (a: GalleryAlbum) => (a.titleKey ? t(a.titleKey) : a.title);

  // opening from a Home tile jumps to that album
  const target = focus ? ys[focus] : undefined;
  useEffect(() => {
    if (target !== undefined) scroll.current?.scrollTo({ y: Math.max(0, target - 6), animated: true });
  }, [target]);

  // the album being viewed is looked up each time, so one the office has since removed simply closes
  const shown = view ? albums.find(a => a.id === view.id) : undefined;
  const photo = shown && view ? shown.photos[Math.min(view.i, shown.photos.length - 1)] : undefined;
  const step = (d: number) => setView(v => (v && shown ? { ...v, i: (v.i + d + shown.photos.length) % shown.photos.length } : v));
  const big = Math.min(width - 32, height * 0.6);

  return (
    <Screen scroll={false} header={<Header title={t('home.moments')} back="/" bell />}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 18, flexGrow: 1 }} refreshControl={refreshControl}>
        {albums.length === 0 ? (ready && (
          <View style={s.empty}>
            <View style={s.emptyIc}><Icon name="images-outline" size={30} color={C.acc} /></View>
            <Txt w={800} style={{ fontSize: 15, marginTop: 14, textAlign: 'center' }}>{t('gallery.empty.t')}</Txt>
            <Meta style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>{t('gallery.empty.s')}</Meta>
          </View>
        )) : <Meta style={{ paddingHorizontal: 16, paddingTop: 10 }}>{t('gallery.note')}</Meta>}
        {albums.map((m, ai) => (
          <View key={m.id} onLayout={e => { const y = e.nativeEvent.layout.y; setYs(p => (p[m.id] === y ? p : { ...p, [m.id]: y })); }}>
            <Sect title={name(m) + ' · ' + t(m.count === 1 ? 'gallery.photo1' : 'gallery.photos', { n: m.count })} />
            {(m.eventDate || m.description) ? <Meta style={{ paddingHorizontal: 16, marginTop: -2, marginBottom: 6 }}>{[m.eventDate && day(m.eventDate), m.description].filter(Boolean).join(' · ')}</Meta> : null}
            <FadeIn delay={Math.min(ai, 4) * 70} style={s.grid}>
              {m.photos.map((p, i) => <Photo key={p.id} album={m} i={i} size={size} label={p.caption || name(m)} onPress={() => setView({ id: m.id, i })} />)}
            </FadeIn>
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!shown && !!photo} transparent animationType="fade" onRequestClose={() => setView(null)} statusBarTranslucent>
        {shown && photo && view && (
          <View style={s.viewer}>
            <Pressable onPress={() => setView(null)} accessibilityLabel={t('common.close')} hitSlop={12} style={s.close}>
              <Icon name="close" size={26} color="#fff" />
            </Pressable>
            {photo.uri ? <Image source={{ uri: photo.uri }} style={{ width: width - 32, height: big, borderRadius: 14 }} resizeMode="contain" />
              : shown.art && (
                <LinearGradient colors={shown.art.g} start={ANGLES[view.i % 4]} end={{ x: 1 - ANGLES[view.i % 4].x, y: 1 - ANGLES[view.i % 4].y }} style={[s.big, { width: width - 32, height: width - 32 }]}>
                  <Icon name={shown.art.ic} size={96} color={shown.art.fg} />
                </LinearGradient>
              )}
            <Txt w={700} style={{ color: '#fff', fontSize: 15, marginTop: 16, textAlign: 'center', paddingHorizontal: 24 }}>{photo.caption || name(shown)}</Txt>
            <Meta style={{ color: 'rgba(255,255,255,.7)', marginTop: 2 }}>{photo.caption ? name(shown) + ' · ' : ''}{t('gallery.of', { i: Math.min(view.i, shown.photos.length - 1) + 1, n: shown.photos.length })}</Meta>
            {shown.photos.length > 1 && (
              <View style={s.nav}>
                <Pressable onPress={() => step(-1)} accessibilityLabel={t('gallery.prev')} style={s.navBtn}><Icon name="chevron-back" size={24} color="#fff" /></Pressable>
                <Pressable onPress={() => step(1)} accessibilityLabel={t('gallery.next')} style={s.navBtn}><Icon name="chevron-forward" size={24} color="#fff" /></Pressable>
              </View>
            )}
          </View>
        )}
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: 14, paddingTop: 4 },
  photo: { flex: 1, width: '100%', height: '100%', borderRadius: 10, backgroundColor: C.dimBg },
  center: { alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 60 },
  emptyIc: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.accBg, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(8,6,20,.94)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 48, right: 20, zIndex: 2 },
  big: { borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  nav: { flexDirection: 'row', gap: 24, marginTop: 22 },
  navBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,.14)', alignItems: 'center', justifyContent: 'center' },
});
