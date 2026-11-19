import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { bindDialog, type DialogAsk } from '@/lib/confirm';
import { C } from '@/theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

/**
 * The app's confirm dialog, mounted once at the root. Anything that calls confirm() (lib/confirm.ts)
 * is shown here: a card in the app's own type and colours, a tinted icon, and two full-size buttons.
 * It sits in a transparent Modal only so that it is drawn above an open bottom sheet.
 */
export function Dialog() {
  const [ask, setAsk] = useState<DialogAsk | null>(null);
  const [open, setOpen] = useState(false);
  const [a] = useState(() => new Animated.Value(0));

  useEffect(() => {
    bindDialog(next => { setAsk(next); setOpen(true); });
    return () => bindDialog(null);
  }, []);
  useEffect(() => {
    if (open) { a.setValue(0); Animated.timing(a, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }
  }, [open, ask, a]);

  /** fade out, then run what was chosen — so the next screen never changes behind a dialog that is still up */
  const leave = useCallback((then?: () => void) => {
    Animated.timing(a, { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => { setOpen(false); then?.(); });
  }, [a]);

  if (!ask) return null;
  const danger = ask.tone === 'danger';
  const fg = danger ? C.bad : C.acc, bg = danger ? C.badBg : C.accBg;
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={() => leave()} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[s.veil, { opacity: a }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => leave()} accessibilityLabel={ask.cancel} />
        <Animated.View accessibilityRole="alert" accessibilityViewIsModal
          style={[s.card, { transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }, { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
          <View style={[s.tile, { backgroundColor: bg }]}><Icon name={ask.icon ?? (danger ? 'alert-circle' : 'help-circle')} size={26} color={fg} /></View>
          <Txt w={800} style={s.title}>{ask.title}</Txt>
          {!!ask.body && <Txt style={s.body}>{ask.body}</Txt>}
          <View style={s.row}>
            <Pressable onPress={() => leave()} accessibilityRole="button" style={({ pressed }) => [s.btn, s.cancel, pressed && { backgroundColor: C.bg }]}>
              <Txt w={700} style={[s.btnText, { color: C.ink2 }]} numberOfLines={1}>{ask.cancel}</Txt>
            </Pressable>
            <Pressable onPress={() => leave(ask.onOk)} accessibilityRole="button" style={({ pressed }) => [s.btn, { backgroundColor: danger ? C.bad : C.acc }, pressed && { opacity: 0.85 }]}>
              <Txt w={700} style={[s.btnText, { color: '#fff' }]} numberOfLines={2}>{ask.ok}</Txt>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  veil: { flex: 1, backgroundColor: 'rgba(23,19,49,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: C.card, borderRadius: 22, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, alignItems: 'center',
    borderWidth: 1, borderColor: C.line, elevation: 18, shadowColor: '#171331', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  tile: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 17, lineHeight: 23, textAlign: 'center', color: C.ink },
  body: { fontSize: 13.5, lineHeight: 20, textAlign: 'center', color: C.ink2, marginTop: 8 },
  row: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
  btn: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  cancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  btnText: { fontSize: 14, textAlign: 'center' },
});
