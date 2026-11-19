import { useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { Chips } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Icon, IconTile, Meta, Pill, Screen, Sect, Txt, type IconName } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { dashboard, me, nice, periodOf, rupees, statement, statementCsv, transactions, type Dashboard, type Property, type Statement, type Txn } from '@/lib/owner';
import { C } from '@/theme';

type PeriodKey = 'month' | 'last' | 'quarter' | 'year';
const TXN_ICON: Record<Txn['kind'], IconName> = { bill: 'receipt-outline', payment: 'arrow-down-circle-outline', repair: 'construct-outline', payout: 'arrow-up-circle-outline' };

/** The owner's view of their flats: this month at a glance, then the statement for any period. */
export default function OwnerHome() {
  const router = useRouter();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [props, setProps] = useState<Property[] | null>(null);
  const [blocked, setBlocked] = useState('');
  const [unitId, setUnitId] = useState<string>('all');
  const [d, setD] = useState<Dashboard | null>(null);
  const [pk, setPk] = useState<PeriodKey>('year');
  const [st, setSt] = useState<Statement | null>(null);
  const [rows, setRows] = useState<Txn[] | null>(null);

  const unit = unitId === 'all' ? undefined : unitId;
  useFocusEffect(useCallback(() => {
    me().then(m => setProps(m.properties)).catch(e => setBlocked(e instanceof ApiError ? e.message : t('live.failed')));
  }, [t]));
  useEffect(() => {
    if (!props) return;
    dashboard(unit).then(setD).catch(() => {});
  }, [props, unit]);
  useEffect(() => {
    if (!props) return;
    const p = periodOf(pk);
    // either report may be switched off by the office: show what is allowed
    statement({ unitId: unit, ...p }).then(setSt).catch(() => setSt(null));
    transactions({ unitId: unit, ...p }).then(r => setRows(r.rows)).catch(() => setRows(null));
  }, [props, unit, pk]);

  const exportIt = async () => {
    try { await Share.share({ message: await statementCsv({ unitId: unit, ...periodOf(pk) }), title: t('own.statement') }); }
    catch { toast(t('live.failed'), 'alert-circle'); }
  };

  if (blocked) return <Screen header={<Header back="/profile" title={t('own.title')} />}><EmptyState icon="business-outline" title={t('own.none')} body={blocked} /></Screen>;
  if (!props || !d) return <Screen header={<Header back="/profile" title={t('own.title')} />}><View /></Screen>;

  const stat = (icon: IconName, label: string, value: string, tone?: 'good' | 'bad' | 'warn') => (
    <View style={s.stat}>
      <Icon name={icon} size={17} color={tone === 'bad' ? C.bad : tone === 'warn' ? C.warn : tone === 'good' ? C.good : C.acc} />
      <Txt w={800} style={{ fontSize: 16, marginTop: 4, color: tone === 'bad' ? C.bad : C.ink }} numberOfLines={1}>{value}</Txt>
      <Meta numberOfLines={2}>{label}</Meta>
    </View>
  );
  const line = (label: string, value: number, bold = false) => (
    <View style={s.kv}><Txt style={{ fontSize: 13, color: bold ? C.ink : C.ink2 }} w={bold ? 700 : 400}>{label}</Txt><Txt w={bold ? 800 : 600} style={{ fontSize: bold ? 15 : 13 }}>{rupees(value)}</Txt></View>
  );
  const tot = st?.totals;

  return (
    <Screen header={<Header back="/profile" title={t('own.title')} />}>
      {props.length > 1 && (
        <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
          <Chips items={[['all', t('own.allFlats')] as const, ...props.map(p => [p.unitId, p.unit] as const)]} value={unitId} onChange={setUnitId} />
        </View>
      )}

      <Card style={{ marginTop: 12, backgroundColor: C.accBg, borderColor: C.accBorder }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="sparkles" size={16} color={C.acc} style={{ marginTop: 2 }} />
          <Txt style={{ fontSize: 13, lineHeight: 20, flex: 1 }}>{d.summary}</Txt>
        </View>
      </Card>

      <Sect title={t('own.thisMonth', { month: d.month })} />
      <View style={s.grid}>
        {stat('trending-up-outline', t('own.income'), rupees(d.income), 'good')}
        {stat('trending-down-outline', t('own.expenses'), rupees(d.expenses))}
        {stat('wallet-outline', t('own.net'), rupees(d.net))}
        {stat('time-outline', t('own.pendingRent'), rupees(d.pendingRent), d.pendingRent ? 'bad' : undefined)}
        {stat('cash-outline', t('own.payout'), rupees(d.upcomingPayout))}
        {stat('home-outline', t('own.occupancy'), d.occupancy.vacant ? t('own.vacantN', { n: d.occupancy.vacant }) : d.occupancy.rented ? t('own.rentedN', { n: d.occupancy.rented }) : t('own.selfN', { n: d.occupancy.ownerOccupied }), d.occupancy.vacant ? 'warn' : undefined)}
      </View>

      <Card onPress={() => router.push('/owner/requests')}>
        <View style={s.row}>
          <IconTile name="construct-outline" size={38} bg={d.approvalsWaiting ? C.warnBg : C.accBg} fg={d.approvalsWaiting ? C.warn : C.acc} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 14 }}>{t('own.repairs')}</Txt>
            <Meta>{d.approvalsWaiting ? t('own.approveN', { n: d.approvalsWaiting }) : t('own.openN', { n: d.openRequests })}</Meta>
          </View>
          {d.approvalsWaiting > 0 && <Pill tone="warn">{String(d.approvalsWaiting)}</Pill>}
          <Icon name="chevron-forward" size={18} color={C.ink3} />
        </View>
      </Card>
      <Card onPress={() => router.push('/owner/documents')}>
        <View style={s.row}>
          <IconTile name="document-text-outline" size={38} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 14 }}>{t('own.documents')}</Txt>
            <Meta numberOfLines={1}>{d.latestDocuments[0]?.title ?? t('own.noDocs')}</Meta>
          </View>
          <Icon name="chevron-forward" size={18} color={C.ink3} />
        </View>
      </Card>
      {d.leaseExpiring.map(l => (
        <View key={l.unit} style={s.alert}><Icon name="alert-circle" size={16} color={C.warn} /><Txt style={{ fontSize: 12.5, color: C.warn, flex: 1 }}>{t('own.leaseEnds', { unit: l.unit, date: nice(l.leaseEnd) })}</Txt></View>
      ))}

      <Sect title={t('own.statement')} />
      <View style={{ paddingHorizontal: 14 }}>
        <Chips items={[['month', t('own.p.month')], ['last', t('own.p.last')], ['quarter', t('own.p.quarter')], ['year', t('own.p.year')]] as const} value={pk} onChange={setPk} />
      </View>
      {tot ? (
        <Card>
          <Meta>{nice(st!.from)} – {nice(st!.to)}</Meta>
          {line(t('own.s.rentBilled'), tot.rentBilled ?? 0)}
          {line(t('own.s.rentCollected'), tot.rentCollected ?? 0)}
          {line(t('own.s.repairs'), -(tot.repairsDeducted ?? 0))}
          {line(t('own.s.net'), tot.net ?? 0, true)}
          {line(t('own.s.paidOut'), tot.paidOut ?? 0)}
          {line(t('own.s.held'), tot.heldForOwner ?? 0, true)}
          {(tot.rentPending ?? 0) > 0 && line(t('own.s.rentPending'), tot.rentPending ?? 0)}
          {(tot.chargesPending ?? 0) > 0 && line(t('own.s.charges'), tot.chargesPending ?? 0)}
          <Btn variant="ghost" icon="share-social-outline" label={t('own.export')} onPress={exportIt} style={{ marginTop: 12, alignSelf: 'flex-start' }} />
        </Card>
      ) : <Meta style={{ marginHorizontal: 16, marginTop: 8 }}>{t('own.notShared')}</Meta>}

      {rows && rows.length > 0 && (
        <>
          <Sect title={t('own.transactions')} />
          <Card>
            {rows.slice(0, 40).map((x, i) => (
              <View key={i} style={[s.txn, i > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
                <Icon name={TXN_ICON[x.kind]} size={18} color={x.kind === 'payment' ? C.good : x.kind === 'bill' ? C.ink3 : C.warn} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontSize: 13 }} numberOfLines={2}>{x.what}</Txt>
                  <Meta>{nice(x.date)} · {x.unit}{x.kind === 'bill' ? ' · ' + tx('bst', x.status) : ''}</Meta>
                </View>
                <Txt w={700} style={{ fontSize: 13, color: x.moneyIn ? C.good : C.ink }}>{x.moneyIn ? '+ ' + rupees(x.moneyIn) : x.moneyOut ? '− ' + rupees(x.moneyOut) : rupees(x.billed)}</Txt>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 14, marginTop: 6 },
  stat: { flexBasis: '31%', flexGrow: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alert: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: C.warnBg, borderRadius: 10, padding: 10, marginHorizontal: 14, marginTop: 8 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: C.line },
  txn: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9 },
});
