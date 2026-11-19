import { Platform, Share, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { NavRow, ToggleRow } from '@/components/Settings';
import { Card, Header, IconTile, Meta, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { LIVE } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { exportLive } from '@/lib/live2';
import { Clipboard } from '@/lib/native';
import { useAuth } from '@/store/auth';
import { ME } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Privacy() {
  const { t } = useT();
  const { toast } = useUI();
  const { state, actions } = useStore();
  const p = state.settings.privacy;
  const { phone } = useAuth();

  // everything this build holds about the resident, as JSON, handed to the system share sheet
  const exportData = async () => {
    const mine = {
      exported: new Date().toISOString(),
      resident: { name: ME.name, unit: ME.unit, phone: '+91 ' + phone },
      issues: state.issues.filter(i => i.mine).map(({ internal: _internal, ...i }) => i),
      posts: state.discussions.filter(d => d.by === ME.name).map(({ thread: _thread, ...d }) => d),
      replies: state.discussions.flatMap(d => (d.thread ?? []).filter(r => r.by === ME.name).map(r => ({ post: d.id, ...r }))),
      votes: state.polls.filter(x => x.mine).map(x => ({ poll: x.q, choice: x.mine })),
      rsvps: state.events.filter(e => e.mine).map(e => ({ event: e.title, when: e.when, status: e.mine })),
      gratitudeSent: state.gratitudes.filter(g => g.by === ME.name),
      assistantQuestions: p.aiHistory ? state.chat.log.flatMap(m => (m.who === 'me' ? [m.text] : [])) : [],
      family: state.family,
      settings: state.settings,
      blocked: state.blocked,
    };
    try {
      // connected to the API, the export is what the server holds — the complete record, not this phone's copy
      const json = JSON.stringify(LIVE ? await exportLive() : mine, null, 2);
      if (Platform.OS === 'web') {
        await Clipboard?.setStringAsync(json);
        toast(t('pv.exportCopied'), 'download');
      } else {
        await Share.share({ title: t('pv.exportTitle'), message: json });
      }
    } catch {
      toast(t('pv.exportFail'), 'download');
    }
  };

  const clear = () => confirm(t('pv.clear.confirmT'), t('pv.clear.confirmB'), t('pv.clear.ok'), t('common.cancel'), actions.clearChat, { icon: 'trash' });

  return (
    <Screen header={<Header title={t('profile.privacy')} back="/profile" />}>
      <Card style={s.banner}>
        <IconTile name="shield-checkmark" size={40} radius={12} bg="#fff" fg={C.good} />
        <View style={{ flex: 1 }}>
          <Txt w={700} style={{ fontSize: 13, color: C.good }}>{t('pv.banner.t')}</Txt>
          <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 2, lineHeight: 17 }}>{t('pv.banner.b')}</Txt>
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
        <NavRow icon="download-outline" title={t('pv.download.t')} sub={t('pv.download.s')} onPress={exportData} />
        <NavRow icon="trash-outline" title={t('pv.clear.t')} sub={t('pv.clear.s')} onPress={clear} danger last />
      </Card>
      <Sect title={t('pv.blocked')} />
      <Card delay={240} style={{ paddingVertical: 4 }}>
        {state.blocked.length ? state.blocked.map((name, i) => (
          <NavRow key={name} icon="eye-off-outline" title={name} sub={t('menu.unblock')} onPress={() => actions.unblock(name)} last={i === state.blocked.length - 1} />
        )) : <Meta style={{ paddingVertical: 10 }}>{t('pv.blockedNone')}</Meta>}
      </Card>
      <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>{t('notif.note')}</Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.goodBg, borderColor: '#BBE7D2' },
});
