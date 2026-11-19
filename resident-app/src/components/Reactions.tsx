import { Pressable, StyleSheet, View } from 'react-native';
import type { Discussion } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

/** stored reaction key → [outline, filled] icon */
const REACTIONS: [string, IconName, IconName][] = [
  ['💜', 'heart-outline', 'heart'], ['👍', 'thumbs-up-outline', 'thumbs-up'], ['🎉', 'sparkles-outline', 'sparkles'],
];

function baseCount(d: Discussion, e: string) {
  return e === '👍' ? d.likes : e === '💜' ? Math.round(d.likes * 0.6) : Math.round(d.likes * 0.3);
}

/** Weightless reactions on a published post — shared by the feed and the post screen. */
export function Reactions({ d }: { d: Discussion }) {
  const { actions } = useStore();
  return (
    <View style={s.reacts}>
      {REACTIONS.map(([e, off, onIc]) => {
        const on = d.myReact === e;
        return (
          <Pressable key={e} onPress={() => actions.react(d.id, e)} hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.react, on && s.reactOn]}>
            <Icon name={on ? onIc : off} size={14} color={on ? C.acc : C.ink3} />
            <Txt w={700} style={{ fontSize: 12, color: on ? C.acc : C.ink2 }}>{d.reacts ? d.reacts[e] ?? 0 : baseCount(d, e) + (on ? 1 : 0)}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  reacts: { flexDirection: 'row', gap: 8, marginTop: 9 },
  react: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, minHeight: 34 },
  reactOn: { backgroundColor: C.accBg, borderColor: C.accBorder },
});
