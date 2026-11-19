import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Card, Header, Icon, Meta, Screen, Txt } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ME, SOCIETY, type TryKey } from '@/store/data';
import { TRY_TOTAL, useStore } from '@/store/store';
import { C } from '@/theme';

/** title/sub live in the dictionaries as tour.<key>.t / tour.<key>.s */
const STEPS: TryKey[] = ['ask', 'issue', 'guard', 'tone', 'rsvp', 'vote', 'gratitude'];

/** The simulation's "Seven things to try" rail, as an in-app demo guide. */
export default function Tour() {
  const router = useRouter();
  const { state, actions } = useStore();
  const { toast, openSheet } = useUI();
  const { t } = useT();
  const done = Object.keys(state.tried).length;

  const go = (key: TryKey) => {
    switch (key) {
      case 'ask': router.navigate('/assistant'); break;
      case 'issue': router.navigate('/assistant'); actions.sendChat('Report an issue'); break;
      case 'guard': router.push('/compose'); toast(t('tour.guardToast'), 'shield-half'); break;
      case 'tone': router.push('/compose'); toast(t('tour.toneToast'), 'sparkles'); break;
      case 'rsvp': router.push('/events'); break;
      case 'vote': router.push('/polls'); break;
      case 'gratitude': router.dismissTo('/'); openSheet('gratitude'); break;
    }
  };

  return (
    <Screen header={<Header title={t('tour.title')} back="/profile" />}>
      <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={s.av}><Txt w={800} style={{ color: C.ai }}>AI</Txt></View>
        <View style={{ flex: 1 }}>
          <Txt w={700}>{t('tour.you', { name: ME.name })}</Txt>
          <Meta>{t('role.Owner')} · {ME.flat} · {SOCIETY.name}</Meta>
        </View>
      </Card>
      <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt style={{ fontSize: 12, color: C.ink2, flex: 1, lineHeight: 18 }}>{t('tour.intro')}</Txt>
          <View style={s.count}><Txt w={800} style={{ fontSize: 12, color: C.acc }}>{done} / {TRY_TOTAL}</Txt></View>
        </View>
        <View style={s.progress}><View style={[s.progressFill, { width: `${Math.round((done / TRY_TOTAL) * 100)}%` }]} /></View>
      </View>
      {STEPS.map(st => {
        const ok = !!state.tried[st];
        return (
          <Pressable key={st} onPress={() => go(st)} style={({ pressed }) => [s.step, pressed && { borderColor: C.acc }]}>
            <View style={[s.tick, ok && s.tickOn]}>{ok && <Icon name="checkmark" size={13} color="#fff" />}</View>
            <View style={{ flex: 1 }}>
              <Txt w={700} style={{ fontSize: 13 }}>{t(`tour.${st}.t` as Key)}</Txt>
              <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 2, lineHeight: 16 }}>{t(`tour.${st}.s` as Key)}</Txt>
            </View>
            <Icon name="chevron-forward" size={18} color={C.ink3} />
          </Pressable>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  av: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.aiBg, alignItems: 'center', justifyContent: 'center' },
  count: { backgroundColor: C.accBg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginLeft: 8 },
  progress: { height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 10, marginBottom: 6, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: C.acc },
  step: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, marginHorizontal: 14, marginVertical: 5, padding: 13 },
  tick: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.good, borderColor: C.good },
});
