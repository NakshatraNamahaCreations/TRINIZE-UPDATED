import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { Btn, Card, EmptyState, Header, Icon, IconTile, Meta, Pill, Row, Screen, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { LIVE } from '@/lib/api';
import { seenLive } from '@/lib/live';
import { TODAY } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function AnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const { t } = useT();
  const a = state.announcements.find(x => x.id === id);
  const found = !!a;
  // opening a notice is what the office sees as "read"
  useEffect(() => { if (LIVE && found) void seenLive(id); }, [id, found]);

  if (!a) return <Screen header={<Header title={t('ann.title')} back="/announcements" />}><EmptyState icon="megaphone-outline" title={t('ann.nf.t')} body={t('ann.nf.b')} /></Screen>;

  return (
    <Screen header={<Header title={t('ann.title')} back="/" />}>
      <Card>
        <Row style={{ marginBottom: 6 }}>
          {a.pri === 'High' ? <Pill tone="bad">{t('ann.important')}</Pill> : <Pill tone="dim">{t('ann.notice')}</Pill>}
          <Pill tone="acc">{a.aud}</Pill>
          {a.pinned && <Pill tone="warn">{t('ann.pinned')}</Pill>}
          {a.acked && <Pill tone="good">{t('ann.acknowledged')}</Pill>}
        </Row>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <IconTile name={a.icon} size={40} bg={a.pri === 'High' ? C.badBg : C.accBg} fg={a.pri === 'High' ? C.bad : C.acc} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 15 }}>{a.title}</Txt>
            <Meta style={{ marginTop: 2 }}>{a.by} · {a.when}</Meta>
          </View>
        </View>
        <Txt style={{ fontSize: 13, color: C.ink2, marginTop: 10, lineHeight: 21 }}>{a.body}</Txt>
        {!!a.attach && <Btn variant="soft" icon="attach" label={a.attach.name || t('ann.attachment')} onPress={() => Linking.openURL(a.attach!.url)} style={{ marginTop: 12, alignSelf: 'flex-start' }} />}
        {!!a.until && <Meta style={{ marginTop: 10 }}>{t('ann.until', { date: a.until })}</Meta>}
      </Card>

      {a.ack ? (a.acked ? (
        <Card style={{ backgroundColor: C.goodBg, borderColor: '#BBE7D2', flexDirection: 'row', gap: 9, alignItems: 'center' }}>
          <Icon name="checkmark-circle" size={22} color={C.good} />
          <View>
            <Txt w={700} style={{ fontSize: 12.5, color: C.good }}>{t('ann.youAcked')}</Txt>
            <Meta>{t('ann.recorded', { date: a.ackedOn ?? TODAY })}</Meta>
          </View>
        </Card>
      ) : (
        <>
          <Btn full icon="checkmark-done" label={t('ann.iveRead')} onPress={() => actions.ackAnnouncement(a.id)} />
          <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>{t('ann.highNote')}</Meta>
        </>
      )) : (
        <Meta style={{ paddingHorizontal: 18, paddingTop: 8, textAlign: 'center' }}>{t('ann.noAck')}</Meta>
      )}
    </Screen>
  );
}
