import { Alert, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { NavRow, ToggleRow } from '@/components/Settings';
import { Card, Header, IconTile, Meta, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Privacy() {
  const { t } = useT();
  const { toast } = useUI();
  const { state, actions } = useStore();
  const p = state.settings.privacy;

  const clear = () => Alert.alert(t('pv.clear.confirmT'), t('pv.clear.confirmB'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('pv.clear.ok'), style: 'destructive', onPress: actions.clearChat },
  ]);

  return (
    <Screen header={<Header title={t('profile.privacy')} back="/profile" />}>
      <Card style={s.banner}>
        <IconTile name="shield-checkmark" size={40} radius={12} bg="#fff" fg={C.good} />
        <View style={{ flex: 1 }}>
          <Txt w={700} style={{ fontSize: 13, color: C.good }}>{t('pv.banner.t')}</Txt>
          <Txt style={{ fontSize: 11.5, color: C.ink2, marginTop: 2, lineHeight: 17 }}>{t('pv.banner.b')}</Txt>
        </View>
      </Card>

      <Sect title={t('pv.directory')} />
      <Card delay={60} style={{ paddingVertical: 4 }}>
        <ToggleRow icon="home-outline" title={t('pv.showFlat.t')} sub={t('pv.showFlat.s')} value={p.showFlat} onChange={() => actions.togglePrivacy('showFlat')} />
        <ToggleRow icon="call-outline" title={t('pv.showPhone.t')} sub={t('pv.showPhone.s')} value={p.showPhone} onChange={() => actions.togglePrivacy('showPhone')} last />
      </Card>

      <Sect title={t('pv.assistant')} />
      <Card delay={120} style={{ paddingVertical: 4 }}>
        <ToggleRow icon="sparkles-outline" title={t('pv.aiHistory.t')} sub={t('pv.aiHistory.s')} value={p.aiHistory} onChange={() => actions.togglePrivacy('aiHistory')} last />
      </Card>

      <Sect title={t('pv.data')} />
      <Card delay={180} style={{ paddingVertical: 4 }}>
        <NavRow icon="download-outline" title={t('pv.download.t')} sub={t('pv.download.s')} onPress={() => toast(t('pv.downloadToast'), 'download')} />
        <NavRow icon="trash-outline" title={t('pv.clear.t')} sub={t('pv.clear.s')} onPress={clear} danger last />
      </Card>
      <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>{t('notif.note')}</Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.goodBg, borderColor: '#BBE7D2' },
});
