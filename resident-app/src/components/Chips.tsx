import { Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '@/components/ui';
import { C } from '@/theme';

/** One-of-many choice as wrapping chips. `value` may be null when nothing is chosen yet. */
export function Chips<K extends string>({ items, value, onChange }: { items: readonly (readonly [K, string])[]; value: K | null; onChange: (k: K) => void }) {
  return (
    <View style={s.wrap} accessibilityRole="radiogroup">
      {items.map(([k, label]) => {
        const on = k === value;
        return (
          <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[s.chip, on && s.on]}>
            <Txt w={700} style={{ fontSize: 12.5, color: on ? '#fff' : C.ink2 }}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small caption above a form field. */
export const Label = ({ children }: { children: string }) => <Txt w={700} style={{ fontSize: 12.5, color: C.ink2, marginTop: 14, marginBottom: 6 }}>{children}</Txt>;

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, minHeight: 36, justifyContent: 'center' },
  on: { backgroundColor: C.acc, borderColor: C.acc },
});
