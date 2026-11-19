import { StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { InfoRow } from '@/components/Settings';
import { Btn, Card, Header, IconTile, Meta, Screen, Sect, Txt } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { useT } from '@/i18n';
import { formatPhone, useAuth } from '@/store/auth';
import { ME } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Account() {
  const { t } = useT();
  const { phone, signOut } = useAuth();
  const { state, actions } = useStore();
  const { toast } = useUI();
  const mine = state.discussions.filter(d => d.by === ME.name);
  // held posts plus held replies — a reply can be held on someone else's thread
  const heldReplies = state.discussions.reduce((n, d) => n + (d.thread ?? []).filter(r => r.by === ME.name && r.held).length, 0);
  const held = mine.filter(d => d.state === 'held').length + heldReplies;
  const removed = mine.filter(d => d.state === 'hidden').length;

  // store rules: deletion must be possible inside the app. Everything this build keeps is on the phone,
  // so this erases it all for this number and signs out.
  const del = () => confirm(t('acc.delete.t'), t('acc.delete.b'), t('acc.delete.ok'), t('common.cancel'), () => {
    // if the server refused, nothing was deleted: stay signed in, the reason is already on screen
    void actions.deleteAccount().then(done => {
      if (!done) return;
      signOut();
      toast(t('acc.delete.done'), 'trash');
    });
  });

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

      <Sect title={t('acc.delete.sect')} />
      <Meta style={{ paddingHorizontal: 18, paddingBottom: 4 }}>{t('acc.delete.s')}</Meta>
      <Btn full variant="danger" icon="trash-outline" label={t('acc.delete.ok')} onPress={del} />
    </Screen>
  );
}

const s = StyleSheet.create({
  status: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.goodBg, borderColor: '#BBE7D2' },
});
