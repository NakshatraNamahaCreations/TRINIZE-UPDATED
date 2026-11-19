import { useRouter } from 'expo-router';
import { Card, EmptyState, Header, Meta, Pill, Row, Screen, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function MyIssues() {
  const router = useRouter();
  const { state, actions } = useStore();
  const { t, tx } = useT();
  const mine = state.issues.filter(i => i.mine);

  return (
    <Screen header={<Header title={t('issues.title')} back="/" bell />}>
      {!mine.length && (
        <EmptyState icon="ticket-outline" title={t('issues.empty.t')} body={t('issues.empty.b')}
          action={t('issues.empty.a')} onAction={() => { router.navigate('/assistant'); actions.sendChat('Report an issue'); }} />
      )}
      {mine.map((i, idx) => (
        <Card key={i.id} delay={stagger(idx)} onPress={() => router.push(`/issues/${i.id}`)}>
          <Row>
            <Txt w={700} style={{ fontSize: 12, color: C.ink3 }}>{i.id}</Txt>
            <Pill tone={i.status === 'Resolved' ? 'good' : i.status === 'Submitted' ? 'dim' : 'acc'}>{tx('status', i.status)}</Pill>
            {i.slaState === 'over' && <Pill tone="bad">{t('issues.breached')}</Pill>}
          </Row>
          <Txt w={700} style={{ fontSize: 13.5, marginTop: 4 }}>{i.title}</Txt>
          <Meta style={{ marginTop: 5 }}>{i.cat} · {i.loc} · {t('issues.raised', { when: i.when })}</Meta>
          <Meta style={{ marginTop: 2 }}>{i.vendor !== '—' ? t('issues.assigned', { vendor: i.vendor }) + ' · ' : ''}{i.sla}</Meta>
        </Card>
      ))}
      <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>
        {t('issues.note')}
      </Meta>
    </Screen>
  );
}
