import { useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { Card, EmptyState, Header, Meta, Pill, Row, Screen, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { LIVE } from '@/lib/api';
import { day, myReports, type Head } from '@/lib/inspections';

/** Inspection reports the society office has shared for my flat. */
export default function InspectionReports() {
  const router = useRouter();
  const { t, tx } = useT();
  const [rows, setRows] = useState<Head[] | null>(LIVE ? null : []);
  useFocusEffect(useCallback(() => { if (LIVE) myReports().then(setRows).catch(() => setRows([])); }, []));
  return (
    <Screen header={<Header back="/profile" title={t('ins.mine')} />}>
      {rows !== null && !rows.length && <EmptyState icon="clipboard-outline" title={t('ins.mineNone')} body={t(LIVE ? 'ins.mineNoneS' : 'ins.demo')} />}
      {(rows ?? []).map((r, i) => (
        <Card key={r.id} delay={stagger(i)} onPress={() => router.push({ pathname: '/inspections/[id]', params: { id: r.id } })}>
          <Row>
            {r.ack ? <Pill tone="good">{t('ins.acked')}</Pill> : <Pill tone="warn">{t('ins.toAck')}</Pill>}
            {r.counts.findings > 0 && <Pill tone="dim">{t('ins.nFindings', { n: r.counts.findings })}</Pill>}
          </Row>
          <Txt w={700} style={{ fontSize: 14, marginTop: 6 }}>{tx('ins.type', r.type)} · {r.unit}</Txt>
          <Meta style={{ marginTop: 3 }}>{r.ref} · {day(r.submittedAt)} · {r.inspector}</Meta>
        </Card>
      ))}
    </Screen>
  );
}
