import { StyleSheet, View } from 'react-native';
import { InfoRow } from '@/components/Settings';
import { Card, Header, IconTile, Meta, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { formatPhone, useAuth } from '@/store/auth';
import { ME } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Account() {
  const { t } = useT();
  const { phone } = useAuth();
  const { state } = useStore();
  const mine = state.discussions.filter(d => d.by === ME.name);
  const held = mine.filter(d => d.state === 'held').length;
  const removed = mine.filter(d => d.state === 'hidden').length;

  return (
    <Screen header={<Header title={t('profile.account')} back="/profile" />}>
      <Card style={s.status}>
        <IconTile name="checkmark-circle" size={46} radius={23} bg="#fff" fg={C.good} />
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 16, color: C.good }}>{t('acc.active')}</Txt>
          <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 2, lineHeight: 17 }}>{t('acc.activeB')}</Txt>
        </View>
      </Card>

      <Sect title={t('acc.verification')} />
      <Card delay={60} style={{ paddingVertical: 2 }}>
        <InfoRow label={t('acc.phone')} value={phone ? '+91 ' + formatPhone(phone) : '—'} />
        <InfoRow label={t('acc.phoneOk')} value="OTP" ok />
        <InfoRow label={t('acc.unit')} value={ME.unit} />
        <InfoRow label={t('acc.unitOk')} value={ME.flat} ok />
        <InfoRow label={t('acc.role')} value={t('role.Owner')} />
        <InfoRow label={t('acc.since')} value={t('acc.sinceVal')} last />
      </Card>

      <Sect title={t('acc.standing')} />
      <Card delay={120} style={{ paddingVertical: 2 }}>
        <InfoRow label={t('acc.held')} value={String(held)} />
        <InfoRow label={t('acc.warnings')} value="0" />
        <InfoRow label={t('acc.removed')} value={String(removed)} last />
      </Card>
      <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>{t('acc.standingNote')}</Meta>
      <Meta style={{ paddingHorizontal: 18, paddingTop: 4, textAlign: 'center' }}>{t('acc.help')}</Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  status: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.goodBg, borderColor: '#BBE7D2' },
});
