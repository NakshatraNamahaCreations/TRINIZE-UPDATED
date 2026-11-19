import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Card, Header, Icon, Meta, Pill, Row, Screen, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { useFocusJump } from '@/lib/useFocusJump';
import { pollClosed } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

function PollBar({ label, pct, mine }: { label: string; pct: number; mine: boolean }) {
  const [w] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(w, { toValue: pct, duration: 750, useNativeDriver: false }).start();
  }, [pct, w]);
  return (
    <View style={s.bar}>
      <Animated.View style={[s.fill, { width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
      <View style={s.lab}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Txt w={600} style={{ fontSize: 12, flexShrink: 1 }}>{label}</Txt>
          {mine && <Icon name="checkmark-circle" size={14} color={C.acc} />}
        </View>
        <Txt w={700} style={{ fontSize: 12 }}>{pct}%</Txt>
      </View>
    </View>
  );
}

export default function Polls() {
  const { state, actions } = useStore();
  const { t } = useT();
  // a poll notification opens this list on its poll (?focus=P-20)
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { scrollRef, place } = useFocusJump(focus);
  return (
    <Screen scrollRef={scrollRef} header={<Header title={t('polls.title')} back="/" bell />}>
      {state.polls.map((p, idx) => {
        const total = p.opts.reduce((a, o) => a + o.v, 0);
        const voted = !!p.mine;
        // closes on its end date, not only when someone remembers to close it
        const closed = pollClosed(p);
        return (
          <View key={p.id} onLayout={place(p.id)}>
            <Card delay={stagger(idx, 80)} style={focus === p.id && s.focused}>
              <Row>
                {closed ? <Pill tone="dim">{t('polls.closed')}</Pill> : <Pill tone="good">{t('polls.active')}</Pill>}
                <Meta>{p.closes}</Meta>
              </Row>
              <Txt w={700} style={{ fontSize: 13.5, marginTop: 6, marginBottom: 2 }}>{p.q}</Txt>
              <Meta>{p.elig}</Meta>
              <View style={{ marginTop: 8 }}>
                {voted || closed ? (
                  <>
                    {p.opts.map(o => <PollBar key={o.t} label={o.t} mine={p.mine === o.t} pct={total ? Math.round((o.v / total) * 100) : 0} />)}
                    <Meta style={{ marginTop: 6 }}>{t('polls.votes', { n: total })}{voted && !closed ? t('polls.youVoted') : ''}</Meta>
                  </>
                ) : (
                  <>
                    {p.opts.map((o, i) => (
                      <Pressable key={o.t} onPress={() => actions.vote(p.id, i)} style={({ pressed }) => [s.opt, pressed && { borderColor: C.acc, backgroundColor: C.accBg }]}>
                        <Txt w={600} style={{ fontSize: 12.5 }}>{o.t}</Txt>
                      </Pressable>
                    ))}
                    <Meta style={{ marginTop: 4 }}>{t('polls.after')}</Meta>
                  </>
                )}
              </View>
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  focused: { borderColor: C.acc, borderWidth: 1.5 },
  bar: { borderRadius: 10, marginVertical: 4, backgroundColor: C.dimBg, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: C.accBg, borderRightWidth: 2, borderRightColor: C.acc },
  lab: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 9 },
  opt: { borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginVertical: 4, backgroundColor: '#fff' },
});
