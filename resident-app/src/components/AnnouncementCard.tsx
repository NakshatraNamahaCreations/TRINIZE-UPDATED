import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useT } from '@/i18n';
import type { Announcement } from '@/store/data';
import { C } from '@/theme';
import { Card, IconTile, Meta, Pill, Row, Txt } from './ui';

export function AnnouncementCard({ a, showAck, delay }: { a: Announcement; showAck?: boolean; delay?: number }) {
  const router = useRouter();
  const { t } = useT();
  return (
    <Card delay={delay} onPress={() => router.push(`/announcements/${a.id}`)}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <IconTile name={a.icon} size={36} bg={a.pri === 'High' ? C.badBg : C.accBg} fg={a.pri === 'High' ? C.bad : C.acc} />
        <View style={{ flex: 1 }}>
          <Row>
            <Txt w={700} style={{ fontSize: 13 }}>{a.title}</Txt>
            {a.pri === 'High' && <Pill tone="bad">{t('ann.important')}</Pill>}
            {a.acked && <Pill tone="good">{t('ann.read')}</Pill>}
          </Row>
          <Txt numberOfLines={2} style={{ fontSize: 12, color: C.ink2, marginTop: 3, lineHeight: 17 }}>{a.body}</Txt>
          <Meta style={{ marginTop: 6 }}>
            {a.by} · {a.when} · {a.aud}
            {showAck && a.ack && !a.acked && <Txt w={700} style={{ color: C.warn, fontSize: 11 }}>{t('ann.ackRequired')}</Txt>}
            {showAck && <Txt w={700} style={{ color: C.acc, fontSize: 11 }}>{t('ann.readMore')}</Txt>}
          </Meta>
        </View>
      </View>
    </Card>
  );
}
