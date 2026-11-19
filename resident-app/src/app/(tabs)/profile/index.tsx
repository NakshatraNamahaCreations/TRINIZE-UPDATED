import { useRouter } from 'expo-router';
import { LIVE } from '@/lib/api';
import { StyleSheet, View } from 'react-native';
import { NavRow } from '@/components/Settings';
import { Btn, Card, Header, Meta, Screen, Sect, Txt } from '@/components/ui';
import { LANGS, useT } from '@/i18n';
import { confirm } from '@/lib/confirm';
import { DEMO } from '@/lib/flags';
import { formatPhone, useAuth } from '@/store/auth';
import { ME, SOCIETY } from '@/store/data';
import { TRY_TOTAL, useStore } from '@/store/store';
import { C } from '@/theme';

export default function Profile() {
  const router = useRouter();
  const { state, actions } = useStore();
  const { t, lang } = useT();
  const { phone, signOut } = useAuth();
  const notif = Object.values(state.settings.notif);
  // a mis-tap shouldn't sign anyone out; their data stays saved for this number either way
  const askSignOut = () => confirm(t('signout.title'), t('signout.body', { phone: formatPhone(phone) }), t('profile.signout'), t('common.cancel'), () => { actions.reset(); signOut(); }, { icon: 'log-out-outline' });

  return (
    <Screen header={<Header title={t('profile.title')} />}>
      <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={s.av}><Txt w={800} style={{ color: C.ai, fontSize: 18 }}>AI</Txt></View>
        <View style={{ flex: 1 }}>
          <Txt w={700} style={{ fontSize: 15 }}>{ME.name}</Txt>
          <Meta>{t('role.Owner')} · {ME.flat}{'\n'}{SOCIETY.name}, {SOCIETY.city}{phone ? '\n+91 ' + formatPhone(phone) : ''}</Meta>
        </View>
      </Card>

      {DEMO && !LIVE && <>
        <Sect title={t('profile.demo')} />
        <Card delay={60} style={{ paddingVertical: 4 }}>
          <NavRow icon="compass-outline" title={t('tour.title')} sub={t('profile.tour.s', { done: Object.keys(state.tried).length, total: TRY_TOTAL })} onPress={() => router.push('/tour')} last />
        </Card>
      </>}

      <Sect title={t('profile.prefs')} />
      <Card delay={120} style={{ paddingVertical: 4 }}>
        {LIVE && <NavRow icon="business-outline" title={t('own.title')} sub={t('own.entry.s')} onPress={() => router.push('/owner')} />}
        {LIVE && <NavRow icon="clipboard-outline" title={t('ins.mine')} sub={t('ins.mine.s')} onPress={() => router.push('/inspections')} />}
        <NavRow icon="chatbubbles-outline" title={t('profile.messages')} sub={t('profile.messages.s')} onPress={() => router.push('/messages')} />
        <NavRow icon="globe-outline" title={t('profile.lang')} sub={LANGS.find(l => l.code === lang)?.native} onPress={() => router.push('/profile/language')} />
        <NavRow icon="notifications-outline" title={t('profile.notif')} sub={t('profile.notif.s', { n: notif.filter(Boolean).length, total: notif.length })} onPress={() => router.push('/profile/notifications')} />
        <NavRow icon="lock-closed-outline" title={t('profile.privacy')} sub={t('profile.privacy.s')} onPress={() => router.push('/profile/privacy')} />
        <NavRow icon="home-outline" title={t('profile.family')} sub={t('profile.family.s', { n: state.family.length, unit: ME.unit })} onPress={() => router.push('/profile/family')} last />
      </Card>

      <Sect title={t('profile.about')} />
      <Card delay={180} style={{ paddingVertical: 4 }}>
        <NavRow icon="compass-outline" title={t('welcome.replay')} sub={t('welcome.replayS')} onPress={() => { actions.setWelcomed(false); router.navigate('/'); }} />
        <NavRow icon="document-text-outline" title={t('profile.guide')} sub={t('profile.guide.s')} onPress={() => router.push('/profile/guidelines')} />
        <NavRow icon="shield-checkmark-outline" title={t('profile.account')} sub={t('profile.account.s')} onPress={() => router.push('/profile/account')} />
        <NavRow icon="lock-open-outline" title={t('legal.privacy')} onPress={() => router.push('/legal/privacy')} />
        <NavRow icon="reader-outline" title={t('legal.terms')} onPress={() => router.push('/legal/terms')} last />
      </Card>
      <Btn full variant="danger" icon="log-out-outline" label={t('profile.signout')} onPress={askSignOut} />
    </Screen>
  );
}

const s = StyleSheet.create({
  av: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.aiBg, alignItems: 'center', justifyContent: 'center' },
});
