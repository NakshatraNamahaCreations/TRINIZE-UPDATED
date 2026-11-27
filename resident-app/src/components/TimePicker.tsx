import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, type ScrollViewInstance } from 'react-native';
import { Txt } from './ui';
import { C } from '@/theme';

const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return h * 60 + m; };
const label = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${pad(min % 60)} ${min < 720 ? 'AM' : 'PM'}`;

/**
 * A row of times to tap instead of typing "HH:MM": every `step` minutes from `from` to `to`.
 * `value` is 'HH:MM' (or '' for none, when `optional`). Scrolls to the chosen time when it opens.
 */
export function TimePicker({ value, onChange, from = '06:00', to = '22:00', step = 30, optional, noneLabel }: {
  value: string; onChange: (v: string) => void; from?: string; to?: string; step?: number; optional?: boolean; noneLabel?: string;
}) {
  const times: number[] = [];
  for (let m = toMin(from); m <= toMin(to); m += step) times.push(m);
  const ref = useRef<ScrollViewInstance>(null);
  const at = value ? times.indexOf(toMin(value)) : -1;
  useEffect(() => { if (at > 2) ref.current?.scrollTo({ x: (at - 2) * 84, animated: false }); }, [at]);
  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} accessibilityRole="radiogroup">
      {optional && (
        <Pressable onPress={() => onChange('')} accessibilityRole="radio" accessibilityState={{ selected: !value }} style={[s.chip, !value && s.on]}>
          <Txt w={700} style={{ fontSize: 12.5, color: !value ? '#fff' : C.ink2 }}>{noneLabel ?? '—'}</Txt>
        </Pressable>
      )}
      {times.map(m => {
        const hhmm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`, on = value === hhmm;
        return (
          <Pressable key={m} onPress={() => onChange(hhmm)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[s.chip, on && s.on]}>
            <Txt w={700} style={{ fontSize: 12.5, color: on ? '#fff' : C.ink2 }}>{label(m)}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { gap: 6, paddingVertical: 2 },
  chip: { minWidth: 78, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  on: { backgroundColor: C.acc, borderColor: C.acc },
});
