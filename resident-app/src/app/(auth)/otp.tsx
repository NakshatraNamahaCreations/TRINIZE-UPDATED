import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter, type NativeStackNavigationProp } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Icon, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { LIVE } from '@/lib/api';
import { DEMO } from '@/lib/flags';
import { DEMO_OTP, formatPhone, OTP_LENGTH, RESEND_SECONDS, useAuth } from '@/store/auth';
import { C, GRAD } from '@/theme';

type Phase = 'idle' | 'checking' | 'error' | 'success';

export default function Otp() {
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const insets = useSafeAreaInsets();
  const { phone, requestOtp, verifyOtp, completeSignIn } = useAuth();
  const { toast } = useUI();
  const { t, tr } = useT();
  const input = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [left, setLeft] = useState(RESEND_SECONDS);
  /** the server's own reason for a refusal (tries left, expired…); empty in demo mode */
  const [why, setWhy] = useState('');
  const [focused, setFocused] = useState(true);
  // arriving from login the keyboard is usually already up, and no show event fires for it
  const [kb, setKb] = useState(() => Keyboard.isVisible());

  const [shake] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const [caret] = useState(() => new Animated.Value(1));
  const [pop] = useState(() => new Animated.Value(0));

  // the store only holds a phone once an OTP was requested — deep links land back on login
  useEffect(() => { if (!phone) router.replace('/login'); }, [phone, router]);

  // the code entry opens with the keyboard up, so tighten the layout while it's showing
  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => setKb(true)),
      Keyboard.addListener('keyboardDidHide', () => setKb(false)),
    ];
    return () => subs.forEach(x => x.remove());
  }, []);

  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = phase === 'checking' || phase === 'success'; }, [phase]);
  /** Open the keyboard for the code input, even when the input already counts as focused.
      RN's focus() is a no-op for the input it believes is focused, so a focus request the keyboard
      ignored (Samsung Keyboard drops ones made mid-transition) could never be retried — blur first. */
  const openKeyboard = useCallback(() => {
    const el = input.current;
    if (!el || busyRef.current) return; // checking or signed in: nothing left to type
    if (!el.isFocused()) { el.focus(); return; }
    if (Keyboard.isVisible()) return;
    el.blur();
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  // no autoFocus: a focus made during the slide-in is the one Samsung Keyboard ignores. Ask once the
  // transition has ended, with timers as a fallback (and a second try if the first was dropped)
  useEffect(() => {
    const sub = navigation.addListener('transitionEnd', e => { if (!e.data?.closing) openKeyboard(); });
    const timers = [500, 1200].map(ms => setTimeout(openKeyboard, ms));
    return () => { sub(); timers.forEach(clearTimeout); };
  }, [navigation, openKeyboard]);

  useEffect(() => {
    if (left <= 0) return;
    const h = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(h);
  }, [left]);

  useEffect(() => {
    const loops = [
      Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true })),
      Animated.loop(Animated.sequence([
        Animated.timing(caret, { toValue: 0, duration: 450, useNativeDriver: true }),
        Animated.timing(caret, { toValue: 1, duration: 450, useNativeDriver: true }),
      ])),
    ];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [pulse, caret]);

  async function verify(c: string) {
    setPhase('checking');
    const r = await verifyOtp(c);
    if (!r.ok) {
      setWhy(r.message ?? '');
      setPhase('error');
      // clear after the shake so the user can retype straight away; the message stays until they do
      Animated.sequence([10, -10, 7, -7, 3, 0].map(x => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true })))
        .start(() => { setCode(''); openKeyboard(); }); // some Android keyboards close on the error re-render
      return;
    }
    setPhase('success');
    input.current?.blur();
    Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    setTimeout(completeSignIn, 900);
  }

  function onChange(t: string) {
    if (phase === 'checking' || phase === 'success') return;
    const next = t.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(next);
    if (phase === 'error') setPhase('idle');
    if (next.length === OTP_LENGTH) verify(next);
  }

  async function resend() {
    setCode('');
    setPhase('idle');
    setLeft(RESEND_SECONDS);
    const r = await requestOtp(phone);
    toast(r.ok ? t('otp.newCode') : r.message ?? t('login.failed'), r.ok ? 'refresh' : 'alert-circle');
    openKeyboard();
  }

  const tone = phase === 'error' ? C.bad : C.good;
  const active = Math.min(code.length, OTP_LENGTH - 1);
  const busy = phase === 'checking' || phase === 'success';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      {/* login sets light for its purple hero; this screen is on the pale background */}
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[s.wrap, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 18 }]} keyboardShouldPersistTaps="handled" bounces={false}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => router.back()} style={s.back}>
          <Icon name="chevron-back" size={22} color={C.ink} />
        </Pressable>

        <View style={[s.badgeWrap, kb && s.badgeWrapKb]}>
          <Animated.View style={[s.badgeRing, kb && s.badgeKb, {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
          }]} />
          <LinearGradient colors={phase === 'success' ? ['#12B76A', '#067647'] : GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.badge, kb && s.badgeKb]}>
            {phase === 'success'
              ? <Animated.View style={{ transform: [{ scale: pop }] }}><Icon name="checkmark" size={kb ? 28 : 38} color="#fff" /></Animated.View>
              : <Icon name="chatbubble-ellipses" size={kb ? 24 : 32} color="#fff" />}
          </LinearGradient>
        </View>

        <Txt w={800} style={[s.title, kb && { marginTop: 12, fontSize: 20 }]}>{t(phase === 'success' ? 'otp.verified' : 'otp.title')}</Txt>
        <Txt style={s.desc}>
          {t('otp.desc')}{'\n'}
          <Txt w={700} style={{ color: C.ink, fontSize: 13.5 }}>+91 {formatPhone(phone)}</Txt>
          {'  '}
          <Txt w={700} style={s.link} onPress={() => router.back()}>{t('otp.change')}</Txt>
        </Txt>

        {/* the real input lies over the boxes, so a tap lands on an EditText the keyboard can attach to;
            a 1×1 transparent one is ignored by some keyboards (Samsung) */}
        <View style={s.entry}>
          <Animated.View style={[s.boxes, kb && { marginTop: 20 }, { transform: [{ translateX: shake }] }]}>
            {Array.from({ length: OTP_LENGTH }, (_, i) => {
              const ch = code[i];
              const isActive = focused && !busy && i === active && phase !== 'error';
              const border = phase === 'error' || phase === 'success' ? tone : isActive ? C.acc : ch ? C.accBorder : C.line;
              const bg = !ch ? '#fff' : phase === 'error' ? C.badBg : phase === 'success' ? C.goodBg : C.accBg;
              return (
                <View key={i} style={[s.box, { borderColor: border, backgroundColor: bg }, isActive && { borderWidth: 2 }]}>
                  {ch
                    ? <Txt w={800} style={[s.digit, phase !== 'idle' && phase !== 'checking' && { color: tone }]}>{ch}</Txt>
                    : isActive && <Animated.View style={[s.caret, { opacity: caret }]} />}
                </View>
              );
            })}
          </Animated.View>
          <TextInput
          ref={input}
          value={code}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // a tap on an input that's focused but keyboard-less must still bring the keyboard up
          onPressIn={() => { if (!Keyboard.isVisible()) openKeyboard(); }}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          importantForAutofill="yes"
          maxLength={OTP_LENGTH}
          caretHidden
          contextMenuHidden
          editable={!busy}
          accessibilityLabel={t('otp.a11y')}
          style={s.overlay}
          />
        </View>

        <View style={s.status}>
          {phase === 'error' && <><Icon name="alert-circle" size={15} color={C.bad} /><Txt w={600} style={{ color: C.bad, fontSize: 12.5 }}>{why || t('otp.wrong')}</Txt></>}
          {phase === 'checking' && <><ActivityIndicator size="small" color={C.acc} /><Txt w={600} style={{ color: C.ink2, fontSize: 12.5 }}>{t('otp.checking')}</Txt></>}
          {phase === 'success' && <><Icon name="checkmark-circle" size={15} color={C.good} /><Txt w={600} style={{ color: C.good, fontSize: 12.5 }}>{t('otp.signingIn')}</Txt></>}
        </View>

        <View style={s.resend}>
          {left > 0
            ? <Txt style={s.resendText}>{tr('otp.resendIn', { time: <Txt w={800} style={{ color: C.ink, fontSize: 13 }}>00:{String(left).padStart(2, '0')}</Txt> })}</Txt>
            : <Txt style={s.resendText}>{tr('otp.didntGet', { resend: <Txt w={800} style={s.link} onPress={busy ? undefined : resend}>{t('otp.resend')}</Txt> })}</Txt>}
        </View>

        <Pressable
          onPress={() => verify(code)}
          disabled={code.length < OTP_LENGTH || busy}
          accessibilityRole="button"
          style={({ pressed }) => [s.cta, kb && { marginTop: 16 }, (code.length < OTP_LENGTH || busy) && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.985 }] }]}
        >
          <LinearGradient colors={GRAD.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Txt w={700} style={s.ctaText}>{t('otp.cta')}</Txt>
          <Icon name="shield-checkmark" size={17} color="#fff" />
        </Pressable>

        <View style={{ flex: 1 }} />
        {DEMO && !LIVE && <View style={s.demo}>
          <Icon name="information-circle" size={16} color={C.ai} />
          <Txt w={600} style={s.demoText}>{tr('otp.demo', { code: <Txt w={800} style={{ color: C.ai, fontSize: 12, letterSpacing: 1 }}>{DEMO_OTP}</Txt> })}</Txt>
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: 24 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  badgeWrap: { alignSelf: 'center', marginTop: 24, width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  badgeRing: { position: 'absolute', width: 84, height: 84, borderRadius: 42, backgroundColor: C.acc },
  badge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  badgeWrapKb: { marginTop: 4, width: 60, height: 60 },
  badgeKb: { width: 60, height: 60, borderRadius: 30 },
  title: { fontSize: 22, textAlign: 'center', marginTop: 22 },
  desc: { fontSize: 13, color: C.ink2, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  link: { color: C.acc, fontSize: 13 },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 30 },
  box: { flex: 1, maxWidth: 52, height: 58, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 24 },
  caret: { width: 2, height: 24, borderRadius: 1, backgroundColor: C.acc },
  entry: { position: 'relative' },
  // near-invisible but full-size: opacity 0 or a 1px box makes some IMEs refuse to open
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: 'transparent', backgroundColor: 'transparent', borderWidth: 0, fontSize: 1, padding: 0 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 22, marginTop: 14 },
  resend: { alignItems: 'center', marginTop: 8 },
  resendText: { fontSize: 13, color: C.ink2 },
  cta: { marginTop: 26, height: 54, borderRadius: 14, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.acc },
  ctaText: { color: '#fff', fontSize: 15.5 },
  demo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', backgroundColor: C.aiBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 24 },
  demoText: { fontSize: 12, color: C.ink2 },
});
