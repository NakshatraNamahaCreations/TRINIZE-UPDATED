import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Reactions } from '@/components/Reactions';
import { Btn, Card, EmptyState, Header, Icon, Meta, Pill, Row, Screen, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ME } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Discussions() {
  const router = useRouter();
  const { state } = useStore();
  const { t } = useT();
  const [tab, setTab] = useState<'all' | 'my'>('all');
  // posts from people this resident blocked never show in the feed
  const list = state.discussions.filter(d => (tab === 'all' ? d.state !== 'hidden' && !state.blocked.includes(d.by) : d.by === ME.name));
  const compose = () => router.push('/compose');
  // Privacy → "Show my flat number" applies to my own byline everywhere
  const unit = (by: string, u: string) => (by === ME.name && !state.settings.privacy.showFlat ? '' : ' · ' + u);

  return (
    <Screen header={<Header title={t('disc.title')} back="/" bell />}>
      <Segmented items={[['all', t('disc.all')], ['my', t('disc.my')]]} value={tab} onChange={setTab} />
      {list.length ? list.map((d, i) => (
        <Card key={d.id} delay={stagger(i)} style={d.state === 'hidden' && { opacity: 0.55 }} onPress={() => router.push(`/discussions/${d.id}`)}>
          <Row>
            {d.pinned && <Pill tone="acc">{t('disc.pinned')}</Pill>}
            {d.state === 'held' && <Pill tone="warn">{t('disc.held')}</Pill>}
            {d.state === 'hidden' && <Pill tone="bad">{t('disc.removed')}</Pill>}
          </Row>
          <Txt w={700} style={{ fontSize: 13.5, marginTop: 2 }}>{d.title}</Txt>
          <Txt numberOfLines={2} style={{ fontSize: 12, color: C.ink2, marginTop: 3, lineHeight: 17 }}>{d.body}</Txt>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Meta style={{ flex: 1 }}>{d.by}{unit(d.by, d.unit)} · {d.when}</Meta>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="chatbubble-outline" size={13} color={C.ink3} />
              <Meta>{d.comments}</Meta>
            </View>
          </View>
          {d.state === 'published' && <Reactions d={d} />}
          {d.state === 'held' && <Meta style={{ marginTop: 6, color: C.warn }}>{t('disc.heldNote')}</Meta>}
        </Card>
      )) : tab === 'my'
        ? <EmptyState icon="chatbubbles-outline" title={t('disc.myEmpty.t')} body={t('disc.myEmpty.b')} action={t('disc.myEmpty.a')} onAction={compose} />
        : <EmptyState icon="chatbubbles-outline" title={t('disc.empty.t')} body={t('disc.empty.b')} action={t('disc.empty.a')} onAction={compose} />}
      <Btn full icon="create-outline" label={t('compose.title')} onPress={compose} />
    </Screen>
  );
}
