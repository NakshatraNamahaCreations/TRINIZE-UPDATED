import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Card, Header, Icon, Meta, Screen, Sect, Txt } from '@/components/ui';
import { LANGS, useT, type Lang } from '@/i18n';
import { ME } from '@/store/data';
import { C } from '@/theme';

export default function Language() {
  const { t, lang, setLang } = useT();
  const { toast } = useUI();
  const picked = useRef(false);

  const pick = (code: Lang) => {
    if (code === lang) return;
    picked.current = true;
    setLang(code);
  };

  // confirm once the new dictionary is live, so the toast itself is in the chosen language
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    toast(t('lang.changed', { lang: LANGS.find(l => l.code === lang)!.native }), 'language');
  }, [lang, t, toast]);

  return (
    <Screen header={<Header title={t('profile.lang')} back="/profile" />}>
      <Meta style={s.intro}>{t('lang.intro')}</Meta>
      {LANGS.map((l, i) => {
        const on = l.code === lang;
        return (
          <Card key={l.code} delay={i * 60} onPress={() => pick(l.code)} style={[s.opt, on && s.optOn]}>
            <View style={[s.badge, on && { backgroundColor: C.acc }]}>
              <Txt w={800} style={{ fontSize: 15, color: on ? '#fff' : C.acc }}>{l.native.slice(0, 1)}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt w={700} style={{ fontSize: 15 }}>{l.native}</Txt>
              <Meta>{l.english}</Meta>
            </View>
            <View style={[s.radio, on && s.radioOn]}>{on && <Icon name="checkmark" size={14} color="#fff" />}</View>
          </Card>
        );
      })}

      <Sect title={t('lang.preview')} />
      <Card delay={200} style={s.preview}>
        <Txt w={800} style={{ fontSize: 15, color: '#fff' }}>{t('home.morning', { name: ME.first })}</Txt>
        <Txt style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', marginTop: 4 }}>{t('home.heroLine')}</Txt>
        <View style={s.previewBtn}>
          <Icon name="sparkles" size={14} color={C.acc} />
          <Txt w={700} style={{ fontSize: 12, color: C.acc }}>{t('home.ask')}</Txt>
        </View>
      </Card>

      <View style={s.note}>
        <Icon name="information-circle-outline" size={16} color={C.ink3} />
        <Meta style={{ flex: 1 }}>{t('lang.note')}</Meta>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  intro: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4, fontSize: 12, color: C.ink2 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 },
  optOn: { borderColor: C.acc, backgroundColor: '#FBF9FF' },
  badge: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.accBg, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: C.acc, borderColor: C.acc },
  preview: { backgroundColor: C.acc, borderColor: C.acc },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10 },
  note: { flexDirection: 'row', gap: 6, paddingHorizontal: 18, paddingTop: 10 },
});
