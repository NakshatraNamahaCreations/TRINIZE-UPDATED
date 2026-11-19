import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Easing, Pressable, StyleSheet, useWindowDimensions, View, type ViewInstance } from 'react-native';
import { useT, type Key } from '@/i18n';
import { useStore } from '@/store/store';
import { C } from '@/theme';
import { Btn, Txt } from './ui';

/**
 * First-run tutorial: the screen dims and a spotlight steps over the real controls — pinned notices,
 * the Assistant tab, the + button and My Issues — with a tip next to each. Screens mark a control with
 * `useTourTarget(id)`; steps whose control isn't on screen (no pinned notice, say) are skipped.
 * Shown once after the first sign-in; Profile → About → App tour plays it again.
 */

export type TourTarget = 'notices' | 'assistant' | 'create' | 'issues';
type StepDef = { id: TourTarget; title: Key; body: Key; round?: boolean };
const STEPS: StepDef[] = [
  { id: 'notices', title: 'welcome.1.t', body: 'welcome.1.b' },
  { id: 'assistant', title: 'welcome.2.t', body: 'welcome.2.b' },
  { id: 'create', title: 'welcome.3.t', body: 'welcome.3.b', round: true },
  { id: 'issues', title: 'welcome.4.t', body: 'welcome.4.b' },
];

type Rect = { x: number; y: number; w: number; h: number };
type Step = StepDef & { rect: Rect };
type Tour = { start: () => void; register: (id: TourTarget, el: ViewInstance | null) => void };

const TourCtx = createContext<Tour | null>(null);

export function useTour() {
  const tour = useContext(TourCtx);
  if (!tour) throw new Error('useTour must be used inside <TourProvider>');
  return tour;
}

/** Callback ref that marks a view as a tutorial target (none when `id` is unset). Give the view `collapsable={false}`. */
export function useTourTarget(id: TourTarget | undefined) {
  const { register } = useTour();
  return useCallback((el: ViewInstance | null) => { if (id) register(id, el); }, [register, id]);
}

const measure = (el: ViewInstance) =>
  new Promise<Rect | null>(resolve => el.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x, y, w, h } : null)));

export function TourProvider({ children }: { children: ReactNode }) {
  const { actions } = useStore();
  const [targets] = useState(() => new Map<TourTarget, ViewInstance>());
  const host = useRef<ViewInstance>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);

  const register = useCallback((id: TourTarget, el: ViewInstance | null) => {
    if (el) targets.set(id, el);
    else targets.delete(id);
  }, [targets]);

  const finish = useCallback(() => { setSteps(null); actions.setWelcomed(true); }, [actions]);

  const start = useCallback(async () => {
    // the overlay is drawn in this host's coordinates; targets report window coordinates
    const origin = host.current ? await measure(host.current) : null;
    const found: Step[] = [];
    for (const def of STEPS) {
      const el = targets.get(def.id);
      const r = el ? await measure(el) : null;
      if (r) found.push({ ...def, rect: { ...r, x: r.x - (origin?.x ?? 0), y: r.y - (origin?.y ?? 0) } });
    }
    if (found.length) setSteps(found);
    else finish();
  }, [targets, finish]);

  const value = useMemo(() => ({ start, register }), [start, register]);
  return (
    <TourCtx.Provider value={value}>
      {children}
      <View ref={host} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
      {steps && <Spotlight steps={steps} onDone={finish} />}
    </TourCtx.Provider>
  );
}

const PAD = 6;
const DIM = 'rgba(6,10,18,.66)';
const CARD_GAP = 14;

/** the cut-out around a target: padded, and a circle for round controls */
function holeFor(s: Step): Rect & { r: number } {
  const { x, y, w, h } = s.rect;
  if (s.round) {
    const d = Math.max(w, h) + PAD * 2;
    return { x: x + w / 2 - d / 2, y: y + h / 2 - d / 2, w: d, h: d, r: d / 2 };
  }
  return { x: x - PAD, y: y - PAD, w: w + PAD * 2, h: h + PAD * 2, r: 16 };
}

function Spotlight({ steps, onDone }: { steps: Step[]; onDone: () => void }) {
  const { t } = useT();
  const { width: W, height: H } = useWindowDimensions();
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  const hole = holeFor(step);
  // a thick border around the hole is the dimmed area, so the corners of the hole stay rounded
  const B = Math.max(W, H) * 2;

  const [anim] = useState(() => {
    const h0 = holeFor(steps[0]);
    return { x: new Animated.Value(h0.x), y: new Animated.Value(h0.y), w: new Animated.Value(h0.w), h: new Animated.Value(h0.h), r: new Animated.Value(h0.r) };
  });
  const [fade] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const move = (v: Animated.Value, to: number) => Animated.timing(v, { toValue: to, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    fade.setValue(0);
    Animated.parallel([
      move(anim.x, hole.x), move(anim.y, hole.y), move(anim.w, hole.w), move(anim.h, hole.h), move(anim.r, hole.r),
      Animated.timing(fade, { toValue: 1, duration: 260, delay: 160, useNativeDriver: true }),
    ]).start();
    AccessibilityInfo.announceForAccessibility(t(step.title) + '. ' + t(step.body));
  }, [i, anim, fade, hole.x, hole.y, hole.w, hole.h, hole.r, step.title, step.body, t]);

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Android back skips the tour rather than leaving it half-drawn over the screen
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onDone(); return true; });
    return () => sub.remove();
  }, [onDone]);

  // the tip goes on whichever side of the target has more room
  const below = H - (hole.y + hole.h) >= hole.y;
  const cardW = Math.min(W - 32, 420);
  const cardX = (W - cardW) / 2;
  const arrowX = Math.min(Math.max(hole.x + hole.w / 2 - cardX - 8, 20), cardW - 36);

  return (
    <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} accessibilityViewIsModal>
      <Animated.View pointerEvents="none" style={{
        position: 'absolute', borderColor: DIM, borderWidth: B,
        left: Animated.subtract(anim.x, B), top: Animated.subtract(anim.y, B),
        width: Animated.add(anim.w, B * 2), height: Animated.add(anim.h, B * 2), borderRadius: Animated.add(anim.r, B),
      }} />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: anim.x, top: anim.y, width: anim.w, height: anim.h, borderRadius: anim.r }}>
        <View style={[StyleSheet.absoluteFill, s.ring, { borderRadius: hole.r }]} />
        <Animated.View style={[StyleSheet.absoluteFill, s.ring, {
          borderRadius: hole.r,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
        }]} />
      </Animated.View>

      <Animated.View style={[s.card, { width: cardW, left: cardX, opacity: fade },
        below ? { top: hole.y + hole.h + CARD_GAP } : { bottom: H - hole.y + CARD_GAP },
        { transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [below ? 8 : -8, 0] }) }] },
      ]}>
        <View style={[s.arrow, { left: arrowX }, below ? { top: -7 } : { bottom: -7 }]} />
        <View style={s.top}>
          <Txt w={800} style={s.kicker}>{t('welcome.kicker', { n: i + 1, total: steps.length })}</Txt>
          {!last && (
            <Pressable onPress={onDone} hitSlop={10} accessibilityRole="button" style={s.skip}>
              <Txt w={700} style={{ fontSize: 13, color: C.ink2 }}>{t('welcome.skip')}</Txt>
            </Pressable>
          )}
        </View>
        <Txt w={800} style={s.title}>{t(step.title)}</Txt>
        <Txt style={s.body}>{t(step.body)}</Txt>
        <View style={s.foot}>
          <View style={s.dots}>
            {steps.map((_, k) => <View key={k} style={[s.dot, k === i && s.dotOn]} />)}
          </View>
          {i > 0 && <Btn variant="ghost" label={t('common.back')} onPress={() => setI(i - 1)} />}
          <Btn label={t(last ? 'welcome.start' : 'welcome.next')} onPress={() => (last ? onDone() : setI(i + 1))} />
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  ring: { borderWidth: 2, borderColor: '#fff' },
  card: { position: 'absolute', backgroundColor: '#fff', borderRadius: 18, padding: 16, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  arrow: { position: 'absolute', width: 16, height: 16, backgroundColor: '#fff', transform: [{ rotate: '45deg' }], borderRadius: 2 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  kicker: { fontSize: 12, letterSpacing: 1, color: C.acc },
  skip: { minHeight: 32, justifyContent: 'center', paddingLeft: 12 },
  title: { fontSize: 17, marginTop: 4 },
  body: { fontSize: 14, color: C.ink2, lineHeight: 21, marginTop: 4 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  dots: { flex: 1, flexDirection: 'row', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.line },
  dotOn: { width: 18, backgroundColor: C.acc },
});
