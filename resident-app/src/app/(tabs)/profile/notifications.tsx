import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { ToggleRow } from '@/components/Settings';
import { Btn, Card, Header, Icon, IconTile, Meta, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { askPermission, permissionState, sendNow, type PermState } from '@/lib/notify';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function NotificationSettings() {
  const { t } = useT();
  const { toast } = useUI();
  const { state, actions } = useStore();
  const n = state.settings.notif;
  const [perm, setPerm] = useState<PermState>('granted');

  // re-check on focus: the resident may come back from the phone's settings screen
  useFocusEffect(useCallback(() => { permissionState().then(setPerm); }, []));

  const allow = async () => {
    if (perm === 'denied') { Linking.openSettings(); return; }
    setPerm(await askPermission());
  };
  const test = async () => {
    if (perm === 'unavailable') { toast(t('ns.unavailable'), 'notifications'); return; }
    const ok = await sendNow({ title: 'Trinize', body: t('push.body') });
    setPerm(await permissionState());
    if (ok) toast(t('ns.testSent'), 'notifications');
  };

  return (
    <Screen header={<Header title={t('profile.notif')} back="/profile" />}>
      {perm !== 'granted' && (
        <Card style={s.banner}>
          <IconTile name="notifications-off-outline" size={40} radius={12} bg="#fff" fg={C.warn} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 13 }}>{perm === 'unavailable' ? t('ns.unavailable') : t('ns.permOff.t')}</Txt>
            {perm !== 'unavailable' && <Txt style={{ fontSize: 11.5, color: C.ink2, marginTop: 2, lineHeight: 17 }}>{t(perm === 'denied' ? 'ns.denied' : 'ns.permOff.b')}</Txt>}
            {perm !== 'unavailable' && <Btn label={t(perm === 'denied' ? 'ns.openSettings' : 'ns.allow')} onPress={allow} style={{ alignSelf: 'flex-start', marginTop: 8 }} />}
          </View>
        </Card>
      )}

      <Sect title={t('ns.community')} />
      <Card style={{ paddingVertical: 4 }}>
        <ToggleRow icon="megaphone-outline" title={t('ns.announcements.t')} sub={t('ns.announcements.s')} value={n.announcements} onChange={() => actions.toggleNotif('announcements')} note={t('ns.locked')} />
        <ToggleRow icon="calendar-outline" title={t('ns.events.t')} sub={t('ns.events.s')} value={n.events} onChange={() => actions.toggleNotif('events')} />
        <ToggleRow icon="bar-chart-outline" title={t('ns.polls.t')} sub={t('ns.polls.s')} value={n.polls} onChange={() => actions.toggleNotif('polls')} />
        <ToggleRow icon="chatbubbles-outline" title={t('ns.discussions.t')} sub={t('ns.discussions.s')} value={n.discussions} onChange={() => actions.toggleNotif('discussions')} />
        <ToggleRow icon="heart-outline" title={t('ns.gratitude.t')} sub={t('ns.gratitude.s')} value={n.gratitude} onChange={() => actions.toggleNotif('gratitude')} last />
      </Card>

      <Sect title={t('ns.mine')} />
      <Card delay={60} style={{ paddingVertical: 4 }}>
        <ToggleRow icon="ticket-outline" title={t('ns.issues.t')} sub={t('ns.issues.s')} value={n.issues} onChange={() => actions.toggleNotif('issues')} last />
      </Card>

      <Sect title={t('ns.quietHead')} />
      <Card delay={120} style={{ paddingVertical: 4 }}>
        <ToggleRow icon="moon-outline" title={t('ns.quiet.t')} sub={t('ns.quiet.s')} value={n.quiet} onChange={() => actions.toggleNotif('quiet')} last />
      </Card>

      <Btn full variant="ghost" icon="notifications-outline" label={t('ns.test')} onPress={test} />
      <View style={s.note}>
        <Icon name="alarm-outline" size={15} color={C.ink3} />
        <Meta style={{ flex: 1 }}>{t('ns.reminderNote')}</Meta>
      </View>
      <View style={s.note}>
        <Icon name="lock-closed-outline" size={15} color={C.ink3} />
        <Meta style={{ flex: 1 }}>{t('notif.note')}</Meta>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.warnBg, borderColor: '#F7D9A8' },
  note: { flexDirection: 'row', gap: 6, paddingHorizontal: 18, paddingTop: 8 },
});
