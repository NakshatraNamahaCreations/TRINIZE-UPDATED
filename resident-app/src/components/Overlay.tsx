import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, font } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export type SheetKind = 'create' | 'gratitude' | 'suggest' | null;

type UI = {
  toast: (msg: string, icon?: IconName) => void;
  confetti: () => void;
  sheet: SheetKind;
  openSheet: (k: Exclude<SheetKind, null>) => void;
  closeSheet: () => void;
};

const UICtx = createContext<UI | null>(null);

export function useUI() {
  const ui = useContext(UICtx);
  if (!ui) throw new Error('useUI must be used inside <UIProvider>');
  return ui;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState<{ msg: string; icon: IconName; key: number } | null>(null);
  const [bursts, setBursts] = useState<number[]>([]);
  const [sheet, setSheet] = useState<SheetKind>(null);

  const toast = useCallback((msg: string, icon: IconName = 'information-circle') => setToastMsg({ msg, icon, key: Date.now() }), []);
  const confetti = useCallback(() => {
    const id = Date.now() + Math.random();
    setBursts(b => [...b, id]);
    setTimeout(() => setBursts(b => b.filter(x => x !== id)), 2000);
  }, []);

  const value = useMemo<UI>(() => ({
    toast, confetti, sheet,
    openSheet: k => setSheet(k),
    closeSheet: () => setSheet(null),
  }), [toast, confetti, sheet]);

  return (
    <UICtx.Provider value={value}>
      {children}
      {bursts.map(id => <Confetti key={id} />)}
      {toastMsg && <Toast key={toastMsg.key} msg={toastMsg.msg} icon={toastMsg.icon} onDone={() => setToastMsg(null)} />}
    </UICtx.Provider>
  );
}

/** Renders **bold** segments; everything else plain. */
function RichText({ text }: { text: string }) {
  const parts = text.split('**');
  return (
    <Txt w={600} style={s.toastText}>
      {parts.map((p, i) => (i % 2 ? <Txt key={i} w={800} style={s.toastText}>{p}</Txt> : p))}
    </Txt>
  );
}

function Toast({ msg, icon, onDone }: { msg: string; icon: IconName; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [a] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(a, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => finished && onDone());
  }, [a, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.toast, { bottom: 88 + insets.bottom, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
    >
      <Icon name={icon} size={18} color="#C4B5FD" />
      <View style={{ flex: 1 }}><RichText text={msg} /></View>
    </Animated.View>
  );
}

const COLORS = ['#7C55F7', '#F59E0B', '#34D399', '#F472B6', '#38BDF8'];

function Confetti() {
  const { width, height } = Dimensions.get('window');
  const [pieces] = useState(() => Array.from({ length: 26 }, (_, i) => ({
    left: width * (0.06 + Math.random() * 0.88),
    color: COLORS[i % COLORS.length],
    delay: Math.random() * 300,
    spin: Math.random() * 360,
    drift: (Math.random() - 0.5) * 80,
    v: new Animated.Value(0),
  })));

  useEffect(() => {
    Animated.parallel(pieces.map(p => Animated.timing(p.v, {
      toValue: 1, duration: 1500, delay: p.delay, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }))).start();
  }, [pieces]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={[s.piece, {
            left: p.left, backgroundColor: p.color,
            opacity: p.v.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [-20, height * 0.75] }) },
              { translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: [p.spin + 'deg', p.spin + 540 + 'deg'] }) },
            ],
          }]}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  toast: {
    position: 'absolute', left: 16, right: 16, backgroundColor: C.toast, borderRadius: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    paddingVertical: 11, paddingHorizontal: 14, zIndex: 40, elevation: 12,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 13, shadowOffset: { width: 0, height: 10 },
  },
  toastText: { color: '#fff', fontSize: 12.5, lineHeight: 18, ...font(600) },
  piece: { position: 'absolute', top: 0, width: 8, height: 12, borderRadius: 2 },
});
