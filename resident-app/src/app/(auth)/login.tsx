import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { BrandMark } from '@/components/Splash';
import { FadeIn, Icon, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { formatPhone, useAuth } from '@/store/auth';
import { C, font, GRAD } from '@/theme';

/** Feature chips floating in the hero — [icon, label, left %, top px, float phase] */
const FLOATS: [IconName, Key, `${number}%`, number, number][] = [
  ['megaphone', 'login.chip.notices', '6%', 18, 0],
  ['calendar', 'login.chip.events', '64%', 6, 0.33],
  ['sparkles', 'login.chip.ai', '70%', 118, 0.66],
  ['ticket', 'login.chip.issues', '2%', 128, 0.5],
];

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requestOtp } = useAuth();
  const { toast } = useUI();
  const { t, tr } = useT();
  const [phone, setPhone] = useState('');
  /** why the server refused this number (not registered, awaiting verification…) — stays under the field until the number changes */
  const [refused, setRefused] = useState<{ phone: string; why: string } | null>(null);
  const why = refused?.phone === phone ? refused.why : '';
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const [kb, setKb] = useState(() => Keyboard.isVisible());
  const valid = /^[6-9]\d{9}$/.test(phone);
  const showError = phone.length === 10 && !valid;

  const [float] = useState(() => new Animated.Value(0));
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.timing(float, { toValue: 1, duration: 3600, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [enter, float]);

  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => setKb(true)),
      Keyboard.addListener('keyboardDidHide', () => { setKb(false); scroll.current?.scrollTo({ y: 0, animated: true }); }),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  async function submit() {
    if (!valid || sending) return;
    setSending(true);
    const r = await requestOtp(phone);
    setSending(false);
    // the server says why (not registered, too many codes, offline) — stay here and show it
    if (!r.ok) { const msg = r.message ?? t('login.failed'); setRefused({ phone, why: msg }); toast(msg, 'alert-circle'); return; }
    toast(t('login.sent', { phone: formatPhone(phone) }), 'chatbubble-ellipses');
    router.push('/otp');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <StatusBar style="light" />
      <ScrollView ref={scroll} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        {/* typing needs the room, so the hero folds into a slim brand bar; the form keeps its slot and its focus */}
        {kb ? (
          <FadeIn distance={-8}>
            <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.bar, { paddingTop: insets.top + 12 }]}>
              <View style={[s.blob, { top: -70, right: -40, width: 160, height: 160 }]} />
              <BrandMark size={34} />
              <View style={{ flex: 1 }}>
                <Txt w={800} style={{ color: '#fff', fontSize: 17 }}>Trinize</Txt>
                <Txt style={{ color: 'rgba(255,255,255,.82)', fontSize: 12 }} numberOfLines={1}>{t('splash.foot')}</Txt>
              </View>
            </LinearGradient>
          </FadeIn>
        ) : (
          <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, { paddingTop: insets.top + 22 }]}>
            <View style={[s.blob, { top: -60, right: -50, width: 200, height: 200 }]} />
            <View style={[s.blob, { bottom: -80, left: -60, width: 220, height: 220 }]} />
  
            <View style={s.brandRow}>
              <BrandMark size={40} />
              <Txt w={800} style={s.brand}>Trinize</Txt>
            </View>
  
            <View style={s.stage}>
              {FLOATS.map(([ic, l, left, top, phase]) => {
                const p = Animated.modulo(Animated.add(float, phase), 1);
                return (
                  <Animated.View
                    key={l}
                    style={[s.chip, { left, top, transform: [{ translateY: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -7, 0] }) }] }]}
                  >
                    <Icon name={ic} size={14} color="#fff" />
                    <Txt w={700} style={s.chipText}>{t(l)}</Txt>
                  </Animated.View>
                );
              })}
              <View style={s.house}>
                <Icon name="business" size={64} color="rgba(255,255,255,.95)" />
              </View>
            </View>
  
            <Txt w={800} style={s.headline}>{t('login.headline')}</Txt>
            <Txt style={s.sub}>{t('login.sub')}</Txt>
          </LinearGradient>
        )}

        <Animated.View
          style={[s.body, kb && { paddingTop: 22 }, { paddingBottom: insets.bottom + 18, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>
          <Txt w={800} style={s.title}>{t('login.title')}</Txt>
          <Txt style={s.desc}>{t('login.desc')}</Txt>

          <Txt w={700} style={s.label}>{t('login.label')}</Txt>
          <View style={[s.field, focused && s.fieldFocus, showError && s.fieldError]}>
            <View style={s.cc}>
              <Txt style={{ fontSize: 16 }}>🇮🇳</Txt>
              <Txt w={700} style={{ fontSize: 15 }}>+91</Txt>
            </View>
            <TextInput
              value={formatPhone(phone)}
              onChangeText={t => setPhone(t.replace(/\D/g, '').slice(0, 10))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmitEditing={submit}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              maxLength={11}
              returnKeyType="done"
              accessibilityLabel={t('login.label')}
              style={s.input}
            />
            {valid && <Icon name="checkmark-circle" size={20} color={C.good} />}
          </View>
          {showError
            ? <Txt w={600} style={s.error}>{t('login.error')}</Txt>
            : why
              ? <View style={s.refused} accessibilityRole="alert"><Icon name="alert-circle" size={18} color={C.bad} /><Txt w={600} style={s.refusedText}>{why}</Txt></View>
              : <Txt style={s.hint}>{t('login.hint')}</Txt>}

          <Pressable
            onPress={submit}
            disabled={!valid || sending}
            accessibilityRole="button"
            style={({ pressed }) => [s.cta, (!valid || sending) && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.985 }] }]}
          >
            <LinearGradient colors={GRAD.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            {sending
              ? <><ActivityIndicator color="#fff" /><Txt w={700} style={s.ctaText}>{t('login.sending')}</Txt></>
              : <><Txt w={700} style={s.ctaText}>{t('login.cta')}</Txt><Icon name="arrow-forward" size={18} color="#fff" /></>}
          </Pressable>

          <View style={s.secure}>
            <Icon name="lock-closed" size={13} color={C.ink3} />
            <Txt style={s.secureText}>{t('login.secure')}</Txt>
          </View>

          {/* pin the terms to the bottom only when there's a full screen to fill */}
          {!kb && <View style={{ flex: 1 }} />}
          <Txt style={[s.terms, kb && { marginTop: 16 }]}>
            {tr('login.terms', {
              terms: <Txt w={700} style={s.link} accessibilityRole="link" onPress={() => router.push('/legal/terms')}>{t('login.termsLink')}</Txt>,
              privacy: <Txt w={700} style={s.link} accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>{t('login.privacyLink')}</Txt>,
            })}
          </Txt>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hero: { paddingHorizontal: 24, paddingBottom: 30, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,.08)' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { color: '#fff', fontSize: 20 },
  stage: { height: 168, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  house: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,.25)', alignItems: 'center', justifyContent: 'center' },
  chip: {
    position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 5, zIndex: 2,
    backgroundColor: 'rgba(255,255,255,.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,.28)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  chipText: { color: '#fff', fontSize: 12 },
  headline: { color: '#fff', fontSize: 26, lineHeight: 32, marginTop: 8 },
  sub: { color: 'rgba(255,255,255,.85)', fontSize: 13, lineHeight: 19, marginTop: 8 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 26 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingBottom: 16, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },
  title: { fontSize: 20 },
  desc: { fontSize: 13, color: C.ink2, marginTop: 4, lineHeight: 19 },
  label: { fontSize: 12, color: C.ink2, marginTop: 22, marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.line, borderRadius: 14, paddingRight: 14, minHeight: 56 },
  // border only: toggling elevation/shadow here on Android dropped the input's focus as the keyboard opened
  fieldFocus: { borderColor: C.acc, backgroundColor: '#FDFCFF' },
  fieldError: { borderColor: C.bad },
  cc: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, alignSelf: 'stretch', borderRightWidth: 1, borderRightColor: C.line },
  input: { flex: 1, fontSize: 17, letterSpacing: 1, color: C.ink, paddingHorizontal: 14, paddingVertical: 14, ...font(700) },
  hint: { fontSize: 12, color: C.ink3, marginTop: 8 },
  error: { fontSize: 12, color: C.bad, marginTop: 8 },
  refused: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: C.badBg, borderRadius: 12, padding: 12, marginTop: 10 },
  refusedText: { flex: 1, fontSize: 13, lineHeight: 19, color: C.bad },
  cta: { marginTop: 22, height: 54, borderRadius: 14, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.acc },
  ctaText: { color: '#fff', fontSize: 15.5 },
  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  secureText: { fontSize: 12, color: C.ink3 },
  terms: { fontSize: 12, color: C.ink3, textAlign: 'center', lineHeight: 17, marginTop: 24 },
  link: { fontSize: 12, color: C.acc },
});
