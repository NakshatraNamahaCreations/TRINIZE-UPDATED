import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { C, GRAD } from '@/theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** White app tile — house with a heart badge. Shared by the splash and the login hero. */
export function BrandMark({ size = 84 }: { size?: number }) {
  const badge = Math.round(size * 0.36);
  return (
    <View style={[s.mark, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Icon name="home" size={Math.round(size * 0.48)} color={C.acc} />
      <View style={[s.badge, { width: badge, height: badge, borderRadius: badge / 2, top: -badge * 0.22, right: -badge * 0.22 }]}>
        <Icon name="heart" size={Math.round(badge * 0.55)} color="#fff" />
      </View>
    </View>
  );
}

const HOLD_MS = 2000;
const FADE_MS = 380;

/** Branded launch overlay — plays once above the app, then fades out and unmounts. */
export function Splash({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const [v] = useState(() => ({
    mark: new Animated.Value(0),
    words: new Animated.Value(0),
    ring: new Animated.Value(0),
    dots: new Animated.Value(0),
    out: new Animated.Value(1),
  }));

  useEffect(() => {
    const ring = Animated.loop(Animated.timing(v.ring, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    const dots = Animated.loop(Animated.timing(v.dots, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    const intro = Animated.sequence([
      Animated.spring(v.mark, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
      Animated.timing(v.words, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    [ring, dots, intro].forEach(a => a.start());
    // timers, not animation callbacks, drive the exit — a native-driver callback that never reports
    // `finished` on device left the transparent overlay mounted on top of the login screen
    const fade = setTimeout(() => Animated.timing(v.out, { toValue: 0, duration: FADE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(), HOLD_MS);
    const done = setTimeout(onDone, HOLD_MS + FADE_MS + 20);
    return () => {
      [ring, dots, intro].forEach(a => a.stop());
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [v, onDone]);

  const rise = (a: Animated.Value, d = 14) => ({ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [d, 0] }) }] });

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.root, { opacity: v.out }]}>
      <StatusBar style="light" />
      <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[s.blob, { top: -90, right: -70, width: 260, height: 260 }]} />
      <View style={[s.blob, { bottom: -120, left: -90, width: 320, height: 320, opacity: 0.6 }]} />

      <View style={s.center}>
        <Animated.View style={{ opacity: v.mark, transform: [{ scale: v.mark.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
          {[0, 0.5].map(off => {
            // two staggered rings so a pulse is always on screen
            const p = Animated.modulo(Animated.add(v.ring, off), 1);
            return (
              <Animated.View
                key={off}
                style={[s.ring, {
                  opacity: p.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.45, 0] }),
                  transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2] }) }],
                }]}
              />
            );
          })}
          <BrandMark size={92} />
        </Animated.View>

        <Animated.View style={[{ alignItems: 'center', marginTop: 28 }, rise(v.words)]}>
          <Txt w={800} style={s.word}>Trinize</Txt>
          <View style={s.tag}><Txt w={800} style={s.tagText}>{t('splash.tag')}</Txt></View>
          <Txt w={500} style={s.motto}>{t('splash.motto')}</Txt>
        </Animated.View>
      </View>

      <Animated.View style={[s.foot, { paddingBottom: insets.bottom + 28 }, rise(v.words, 8)]}>
        <View style={s.dots}>
          {[0, 1, 2].map(i => (
            <Animated.View
              key={i}
              style={[s.dot, {
                opacity: v.dots.interpolate({ inputRange: [0, i * 0.2, i * 0.2 + 0.2, i * 0.2 + 0.4, 1], outputRange: [0.35, 0.35, 1, 0.35, 0.35] }),
                transform: [{ translateY: v.dots.interpolate({ inputRange: [0, i * 0.2, i * 0.2 + 0.2, i * 0.2 + 0.4, 1], outputRange: [0, 0, -5, 0, 0] }) }],
              }]}
            />
          ))}
        </View>
        <Txt w={600} style={s.footText}>{t('splash.foot')}</Txt>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { zIndex: 100, elevation: 100, backgroundColor: C.acc },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,.08)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', top: -14, left: -14, width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: '#fff' },
  mark: {
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1E0B5C', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 14,
  },
  badge: { position: 'absolute', backgroundColor: '#F472B6', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  word: { color: '#fff', fontSize: 34, letterSpacing: 0.5 },
  tag: { marginTop: 6, backgroundColor: 'rgba(255,255,255,.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { color: '#fff', fontSize: 10, letterSpacing: 2.4 },
  motto: { color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 16 },
  foot: { alignItems: 'center', gap: 12 },
  dots: { flexDirection: 'row', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  footText: { color: 'rgba(255,255,255,.7)', fontSize: 11.5, letterSpacing: 0.3 },
});
