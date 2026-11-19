import { useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Icon, IconTile, Input, Meta, Pill, Screen, Sect, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { dues, nice, payNow, rupees, type Bill, type Dues } from '@/lib/dues';
import { Clipboard } from '@/lib/native';
import { C } from '@/theme';

const TONE = { Unpaid: 'acc', 'Part paid': 'warn', Overdue: 'bad', Paid: 'good', Waived: 'dim', Cancelled: 'dim' } as const;

/** What my flat owes, what has been paid, and the full account. */
export default function MyDues() {
  const router = useRouter();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [d, setD] = useState<Dues | null>(null);
  const [tab, setTab] = useState<'bills' | 'payments' | 'ledger'>('bills');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { dues().then(x => { setD(x); setAmount(a => a || (x.due ? String(x.due) : '')); }).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pay = () => {
    const n = Number(amount.replace(/\D/g, ''));
    if (!d || !n) { toast(t('dues.enterAmount'), 'alert-circle'); return; }
    if (!d.pay.allowPartial && n < d.due) { toast(t('dues.fullOnly', { amount: rupees(d.due) }), 'alert-circle'); return; }
    confirm(t('dues.payT', { amount: rupees(n) }), t('dues.payB'), t('dues.payNow'), t('common.cancel'), async () => {
      setBusy(true);
      try { const r = await payNow(n); setAmount(''); router.push(`/dues/receipt/${r.id}`); }
      catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
      setBusy(false);
    }, { tone: 'primary', icon: 'card' });
  };
  const copy = async (text: string) => { await Clipboard?.setStringAsync(text); toast(t('dues.copied'), 'copy'); };

  const bill = (b: Bill, i: number) => (
    <Card key={b.id} delay={stagger(i)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconTile name="receipt-outline" size={38} bg={b.status === 'Overdue' ? C.badBg : C.accBg} fg={b.status === 'Overdue' ? C.bad : C.acc} />
        <View style={{ flex: 1 }}>
          <Txt w={700} style={{ fontSize: 14 }}>{tx('charge', b.chargeType)}</Txt>
          <Meta>{nice(b.period)} · {t('dues.dueOn', { date: nice(b.dueDate) })}</Meta>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt w={800} style={{ fontSize: 14.5 }}>{rupees(b.due || b.amount)}</Txt>
          <Pill tone={TONE[b.status]}>{tx('bst', b.status)}</Pill>
        </View>
      </View>
      {b.paid > 0 && b.due > 0 && <Meta style={{ marginTop: 6 }}>{t('dues.partPaid', { paid: rupees(b.paid), total: rupees(b.amount) })}</Meta>}
    </Card>
  );

  return (
    <Screen header={<Header back="/" title={t('dues.title')} />}>
      {d && (
        <>
          <Card style={[s.top, d.due ? null : { backgroundColor: C.goodBg, borderColor: '#BBE7D2' }]}>
            <Meta>{d.unit}</Meta>
            <Txt w={800} style={{ fontSize: 30, color: d.due ? C.ink : C.good, marginTop: 2 }}>{rupees(d.due)}</Txt>
            <Txt style={{ fontSize: 13, color: C.ink2 }}>{d.due ? t('dues.toPay') : d.advance ? t('dues.advance', { amount: rupees(d.advance) }) : t('dues.allClear')}</Txt>
            {d.due > 0 && (d.pay.online ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Input value={amount} onChangeText={v => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" accessibilityLabel={t('dues.amount')} style={{ flex: 1, fontSize: 16 }} />
                <Btn icon="card-outline" label={busy ? t('dues.paying') : t('dues.payNow')} onPress={pay} disabled={busy} />
              </View>
            ) : (
              <View style={s.how}>
                <Icon name="information-circle-outline" size={16} color={C.ink2} />
                <Txt style={{ fontSize: 12.5, color: C.ink2, flex: 1 }}>{t('dues.offline')}</Txt>
              </View>
            ))}
            {d.due > 0 && !!d.pay.upiId && <Btn variant="ghost" icon="copy-outline" label={t('dues.upi', { id: d.pay.upiId })} onPress={() => copy(d.pay.upiId)} style={{ marginTop: 8, alignSelf: 'flex-start' }} />}
            {d.due > 0 && !!d.pay.bankDetails && <Meta style={{ marginTop: 8 }}>{d.pay.bankDetails}</Meta>}
          </Card>

          <View style={{ marginHorizontal: 14, marginTop: 12 }}>
            <Segmented value={tab} onChange={setTab} items={[['bills', t('dues.tab.bills')], ['payments', t('dues.tab.payments')], ['ledger', t('dues.tab.ledger')]]} />
          </View>

          {tab === 'bills' && (d.open.length + d.paid.length ? (
            <>
              {d.open.length > 0 && <Sect title={t('dues.open')} />}
              {d.open.map(bill)}
              {d.paid.length > 0 && <Sect title={t('dues.settled')} />}
              {d.paid.map(bill)}
            </>
          ) : <EmptyState icon="receipt-outline" title={t('dues.noBills')} body={t('dues.noBillsB')} />)}

          {tab === 'payments' && (d.payments.length ? d.payments.map((p, i) => (
            <Card key={p.id} delay={stagger(i)} onPress={() => router.push(`/dues/receipt/${p.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconTile name="checkmark-done-outline" size={38} bg={p.reversed ? C.dimBg : C.goodBg} fg={p.reversed ? C.ink3 : C.good} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} style={{ fontSize: 14 }}>{rupees(p.amount)}</Txt>
                  <Meta>{p.number} · {tx('pmode', p.mode)} · {nice(p.receivedOn)}</Meta>
                </View>
                {p.reversed ? <Pill tone="bad">{t('dues.reversed')}</Pill> : <Icon name="chevron-forward" size={18} color={C.ink3} />}
              </View>
            </Card>
          )) : <EmptyState icon="card-outline" title={t('dues.noPayments')} />)}

          {tab === 'ledger' && (d.ledger.length ? (
            <Card>
              {d.ledger.map((l, i) => (
                <View key={i} style={[s.line, i > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontSize: 13 }} numberOfLines={2}>{l.what}</Txt>
                    <Meta>{nice(l.date)}</Meta>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt w={700} style={{ fontSize: 13, color: l.payment ? C.good : C.ink }}>{l.payment ? '− ' + rupees(l.payment) : '+ ' + rupees(l.charge)}</Txt>
                    <Meta>{t('dues.balance', { amount: (l.balance < 0 ? '− ' : '') + rupees(l.balance) })}</Meta>
                  </View>
                </View>
              ))}
            </Card>
          ) : <EmptyState icon="list-outline" title={t('dues.noLedger')} />)}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { marginTop: 12 },
  how: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: C.dimBg, borderRadius: 10, padding: 10, marginTop: 12 },
  line: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9 },
});
