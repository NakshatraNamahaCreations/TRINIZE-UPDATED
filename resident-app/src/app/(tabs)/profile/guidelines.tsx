import { StyleSheet, View } from 'react-native';
import { Card, Header, IconTile, Meta, Screen, Sect, stagger, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { C } from '@/theme';

/** [icon, dictionary prefix, tile bg, tile fg] — text lives under gl.<prefix>.t / .b */
const RULES: [IconName, string, string, string][] = [
  ['heart-outline', 'kind', '#FCE7F3', '#BE185D'],
  ['hand-left-outline', 'respect', C.accBg, C.acc],
  ['people-outline', 'belong', '#E3F3FC', '#0369A1'],
  ['ban-outline', 'noAbuse', C.badBg, C.bad],
  ['eye-off-outline', 'privacy', C.goodBg, C.good],
  ['chatbox-ellipses-outline', 'relevant', C.warnBg, C.warn],
];

const STEPS: Key[] = ['gl.step1', 'gl.step2', 'gl.step3'];

export default function Guidelines() {
  const { t } = useT();
  return (
    <Screen header={<Header title={t('profile.guide')} back="/profile" />}>
      <Card style={s.hero}>
        <IconTile name="shield-checkmark" size={46} radius={14} bg="rgba(255,255,255,.2)" fg="#fff" />
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 15, color: '#fff' }}>{t('gl.hero.t')}</Txt>
          <Txt style={{ fontSize: 11.5, color: 'rgba(255,255,255,.88)', marginTop: 3, lineHeight: 17 }}>{t('gl.hero.b')}</Txt>
        </View>
      </Card>

      {RULES.map(([ic, k, bg, fg], i) => (
        <Card key={k} delay={stagger(i, 50)} style={s.rule}>
          <IconTile name={ic} size={38} radius={11} bg={bg} fg={fg} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 13 }}>{t(`gl.${k}.t` as Key)}</Txt>
            <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 2, lineHeight: 17 }}>{t(`gl.${k}.b` as Key)}</Txt>
          </View>
        </Card>
      ))}

      <Sect title={t('gl.how')} />
      <Card delay={300}>
        {STEPS.map((k, i) => (
          <View key={k} style={[s.step, i === STEPS.length - 1 && { paddingBottom: 0 }]}>
            <View style={s.num}><Txt w={800} style={{ fontSize: 11, color: C.acc }}>{i + 1}</Txt></View>
            <Txt style={{ fontSize: 12.5, flex: 1, lineHeight: 18 }}>{t(k)}</Txt>
          </View>
        ))}
      </Card>
      <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>{t('gl.footer')}</Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.acc, borderColor: C.acc },
  rule: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingBottom: 10 },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accBg, alignItems: 'center', justifyContent: 'center' },
});
