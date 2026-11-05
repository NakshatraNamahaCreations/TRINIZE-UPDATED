import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { Weight } from '@/theme';
import { Txt } from './Txt';

/** Delay for the i-th item of a list — capped so long lists don't keep the tail waiting. */
export const stagger = (i: number, step = 55) => Math.min(i, 8) * step;

/** Opacity + rise on mount; `delay` staggers siblings. Native-driven, so it never blocks the JS thread. */
export function useEnter(delay = 0, distance = 12) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(v, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [v, delay]);
  return { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] };
}

export function FadeIn({ delay, distance, style, children }: { delay?: number; distance?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const enter = useEnter(delay, distance);
  return <Animated.View style={[style, enter]}>{children}</Animated.View>;
}

/**
 * Springy shrink while a finger is down. Transform only — toggling elevation/shadow on press
 * makes Android drop text-input focus, so press feedback never touches those props.
 */
export function usePressScale(to = 0.97) {
  const [scale] = useState(() => new Animated.Value(1));
  const spring = useCallback((toValue: number) => Animated.spring(scale, { toValue, speed: 40, bounciness: toValue === 1 ? 8 : 0, useNativeDriver: true }).start(), [scale]);
  return {
    scale,
    onPressIn: useCallback(() => spring(to), [spring, to]),
    onPressOut: useCallback(() => spring(1), [spring]),
  };
}

/** Counts from 0 to `value` on mount, then eases between later values. */
export function CountUp({ value, w = 800, style, duration = 900 }: { value: number; w?: Weight; style?: StyleProp<TextStyle>; duration?: number }) {
  const [v] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = v.addListener(({ value: x }) => setShown(Math.round(x)));
    const a = Animated.timing(v, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => { a.stop(); v.removeListener(id); };
  }, [v, value, duration]);
  return <Txt w={w} style={style}>{shown}</Txt>;
}
