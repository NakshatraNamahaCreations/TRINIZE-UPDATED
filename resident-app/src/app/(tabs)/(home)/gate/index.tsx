import { useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, EmptyState, Header, IconTile, Meta, Pill, Row, Screen, Sect, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ICON, myVisits, titleOf, TONE, when, type MyVisits, type Visit } from '@/lib/gate';
import { C } from '@/theme';

/** One visitor or delivery, as a row leading to its detail. */
function VisitRow({ v, i }: { v: Visit; i: number }) {
  const router = useRouter();
  const { t, tx } = useT();
  const sub = v.status === 'Expected' ? t('gate.validUntil', { when: when(v.validUntil) })
    : v.status === 'AtGate' ? (v.keptAt ? t('gate.atDesk', { gate: v.gate ?? '' }) : t('gate.toDesk'))
    : when(v.enteredAt ?? v.createdAt);
  return (
    <Card delay={stagger(i)} onPress={() => router.push(`/gate/${v.id}`)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconTile name={ICON[v.visitorType]} size={38} bg={v.kind === 'delivery' ? C.warnBg : C.accBg} fg={v.kind === 'delivery' ? C.warn : C.acc} />
        <View style={{ flex: 1 }}>
          <Txt w={700} style={{ fontSize: 14 }} numberOfLines={1}>{titleOf(v)}</Txt>
          <Meta numberOfLines={1}>{[v.deliveryType ? tx('dtype', v.deliveryType) : tx('vtype', v.visitorType), sub].filter(Boolean).join(' · ')}</Meta>
        </View>
        <Pill tone={TONE[v.status]}>{tx('vst', v.status)}</Pill>
      </View>
    </Card>
  );
}

/** Visitors and deliveries for my flat: who is expected, what is at the gate, and what has been. */
export default function Gate() {
  const router = useRouter();
  const { t } = useT();
  const [tab, setTab] = useState<'now' | 'history'>('now');
  const [mine, setMine] = useState<MyVisits | null>(null);

  useFocusEffect(useCallback(() => {
    const load = () => { myVisits().then(setMine).catch(() => {}); };
    load();
    const h = setInterval(load, 8000); // the gate changes while this is open
    return () => clearInterval(h);
  }, []));

  const now = mine ? [...mine.pending, ...mine.parcels, ...mine.inside, ...mine.expected] : [];
  return (
    <Screen header={<Header back="/" title={t('gate.title')} />}>
      <Row style={{ marginHorizontal: 14, marginTop: 12, gap: 8 }}>
        <Btn icon="add" label={t('gate.preapprove')} onPress={() => router.push('/gate/new')} style={{ flex: 1 }} />
        <Btn variant="ghost" icon="people-outline" label={t('gate.frequent')} onPress={() => router.push('/gate/frequent')} style={{ flex: 1 }} />
      </Row>
      <View style={{ marginHorizontal: 14, marginTop: 12 }}>
        <Segmented items={[['now', t('gate.tab.now')], ['history', t('gate.tab.history')]]} value={tab} onChange={setTab} />
      </View>
      {tab === 'now' && mine && (now.length
        ? <>
          {mine.pending.length > 0 && <Sect title={t('gate.sec.waiting')} />}
          {mine.pending.map((v, i) => <VisitRow key={v.id} v={v} i={i} />)}
          {mine.parcels.length > 0 && <Sect title={t('gate.sec.parcels')} />}
          {mine.parcels.map((v, i) => <VisitRow key={v.id} v={v} i={i} />)}
          {mine.inside.length > 0 && <Sect title={t('gate.sec.inside')} />}
          {mine.inside.map((v, i) => <VisitRow key={v.id} v={v} i={i} />)}
          {mine.expected.length > 0 && <Sect title={t('gate.sec.expected')} />}
          {mine.expected.map((v, i) => <VisitRow key={v.id} v={v} i={i} />)}
        </>
        : <EmptyState icon="shield-checkmark-outline" title={t('gate.empty.t')} body={t('gate.empty.b')} />)}
      {tab === 'history' && mine && (mine.history.length
        ? mine.history.map((v, i) => <VisitRow key={v.id} v={v} i={i} />)
        : <EmptyState icon="time-outline" title={t('gate.noHistory')} />)}
    </Screen>
  );
}
