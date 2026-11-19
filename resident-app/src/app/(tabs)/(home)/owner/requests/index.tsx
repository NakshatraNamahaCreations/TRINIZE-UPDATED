import { useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, Header, IconTile, Meta, Pill, Screen, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { requests, rupees, type Request } from '@/lib/owner';
import { C } from '@/theme';

/** Repairs on the flats I own — the ones waiting for my approval first. */
export default function OwnerRequests() {
  const router = useRouter();
  const { t, tx } = useT();
  const [list, setList] = useState<Request[] | null>(null);
  useFocusEffect(useCallback(() => { requests().then(setList).catch(() => setList([])); }, []));
  const sorted = [...(list ?? [])].sort((a, b) => Number(b.canApprove) - Number(a.canApprove));
  return (
    <Screen header={<Header back="/owner" title={t('own.repairs')} />}>
      {list !== null && !list.length && <EmptyState icon="construct-outline" title={t('own.noRepairs')} body={t('own.noRepairsB')} />}
      {sorted.map((r, i) => (
        <Card key={r.ref} delay={stagger(i)} onPress={() => router.push(`/owner/requests/${r.ref}`)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconTile name="construct-outline" size={38} bg={r.canApprove ? C.warnBg : C.accBg} fg={r.canApprove ? C.warn : C.acc} />
            <View style={{ flex: 1 }}>
              <Txt w={700} style={{ fontSize: 14 }} numberOfLines={1}>{r.title}</Txt>
              <Meta numberOfLines={1}>{r.ref} · {r.unit} · {tx('cat', r.category)}{r.costEstimate ? ' · ' + rupees(r.costEstimate) : ''}</Meta>
            </View>
            {r.canApprove ? <Pill tone="warn">{t('own.needsYou')}</Pill> : <Pill tone={['Resolved', 'Closed'].includes(r.status) ? 'good' : 'dim'}>{tx('status', r.status)}</Pill>}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
