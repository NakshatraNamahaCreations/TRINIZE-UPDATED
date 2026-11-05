import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { C } from '@/theme';
import { Icon, IconTile, type IconName } from './Icon';
import { Meta, Txt } from './Txt';

/** Row inside a settings card: icon tile, title + subtitle, trailing chevron (or a custom node). */
export function NavRow({ icon, title, sub, onPress, last, trailing, danger }: {
  icon: IconName; title: string; sub?: string; onPress?: () => void; last?: boolean; trailing?: ReactNode; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, last && s.last, pressed && { opacity: 0.7 }]}>
      <IconTile name={icon} size={34} radius={9} bg={danger ? C.badBg : C.accBg} fg={danger ? C.bad : C.acc} />
      <View style={{ flex: 1 }}>
        <Txt w={700} style={[{ fontSize: 12.5 }, danger && { color: C.bad }]}>{title}</Txt>
        {!!sub && <Meta>{sub}</Meta>}
      </View>
      {trailing ?? (onPress && <Icon name="chevron-forward" size={18} color={C.ink3} />)}
    </Pressable>
  );
}

/** The whole row toggles, not just the switch — a bigger target on small phones. */
export function ToggleRow({ icon, title, sub, value, onChange, last, note }: {
  icon: IconName; title: string; sub: string; value: boolean; onChange: () => void; last?: boolean; note?: string;
}) {
  return (
    <Pressable onPress={onChange} accessibilityRole="switch" accessibilityState={{ checked: value }} style={[s.row, last && s.last]}>
      <IconTile name={icon} size={34} radius={9} bg={value ? C.accBg : C.dimBg} fg={value ? C.acc : C.ink3} />
      <View style={{ flex: 1 }}>
        <Txt w={700} style={{ fontSize: 12.5 }}>{title}</Txt>
        <Meta>{sub}</Meta>
        {!!note && !value && <Meta style={{ color: C.warn, marginTop: 2 }}>{note}</Meta>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: C.line, true: C.acc }} thumbColor="#fff" accessibilityLabel={title} />
    </Pressable>
  );
}

/** Label/value line used on the account page. */
export function InfoRow({ label, value, ok, last }: { label: string; value: string; ok?: boolean; last?: boolean }) {
  return (
    <View style={[s.info, last && s.last]}>
      <Txt style={{ fontSize: 12, color: C.ink2, flex: 1 }}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
        {ok && <Icon name="checkmark-circle" size={15} color={C.good} />}
        <Txt w={700} style={{ fontSize: 12, textAlign: 'right', flexShrink: 1 }}>{value}</Txt>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  last: { borderBottomWidth: 0 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
});
