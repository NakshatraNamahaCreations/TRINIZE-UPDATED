import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, EmptyState, Header, IconTile, Meta, Screen, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import type { NotifTarget } from '@/store/data';
import { unreadCount, useStore } from '@/store/store';
import { C } from '@/theme';

type Tab = 'all' | 'unread' | 'issues' | 'community';
const TARGET: Record<NotifTarget, Href> = { home: '/', issues: '/issues', polls: '/polls', events: '/events' };

export default function Notifications() {
  const router = useRouter();
  const { state, actions } = useStore();
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('all');
  // filter on goTo — the field every notification sets — not on the emoji
  const list = state.notifs.filter(n => (tab === 'all' ? true : tab === 'unread' ? n.unread : tab === 'issues' ? n.goTo === 'issues' : n.goTo !== 'issues'));

  return (
    <Screen header={<Header title={t('notif.title')} back="/" />}>
      <Segmented items={[['all', t('notif.all')], ['unread', t('notif.unread')], ['issues', t('notif.issues')], ['community', t('notif.community')]]} value={tab} onChange={setTab} />
      <View style={s.bar}>
        <Meta>{t('notif.count', { n: unreadCount(state) })}</Meta>
        <Pressable onPress={actions.markAllRead} hitSlop={8}><Txt w={700} style={{ fontSize: 12, color: C.acc }}>{t('notif.markAll')}</Txt></Pressable>
      </View>
      {!list.length && <EmptyState icon="notifications-off-outline" title={t('notif.empty.t')} body={t('notif.empty.b')} />}
      {list.map((n, i) => (
        <Card key={n.id} delay={stagger(i)} style={[s.notif, n.unread && s.unread]} onPress={() => { actions.readNotif(n.id); router.navigate((n.href as Href | undefined) ?? TARGET[n.goTo]); }}>
          <IconTile name={n.icon} size={36} bg={n.c} fg={n.tc} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 12.5 }}>{n.t}</Txt>
            <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>{n.s}</Txt>
            <Meta style={{ marginTop: 3 }}>{n.when}</Meta>
          </View>
          {n.unread && <View style={s.dot} />}
        </Card>
      ))}
      <Meta style={{ paddingHorizontal: 18, paddingTop: 8, textAlign: 'center' }}>
        {t('notif.note')}
      </Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  bar: { paddingTop: 8, paddingHorizontal: 14, paddingBottom: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notif: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  unread: { borderColor: '#DCD2FD', backgroundColor: '#FAF8FF' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.acc, marginTop: 5 },
});
