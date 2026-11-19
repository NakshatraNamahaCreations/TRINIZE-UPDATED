import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { Btn, Card, EmptyState, Header, Icon, Meta, Screen, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { nice, receipt, rupees, type Receipt } from '@/lib/dues';
import { C } from '@/theme';

/** A payment receipt: what was paid, how, and which bills it settled. */
export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tx } = useT();
  const [r, setR] = useState<Receipt | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { receipt(id).then(setR).catch(() => setMissing(true)); }, [id]);

  if (missing) return <Screen header={<Header back="/dues" title={t('dues.receipt')} />}><EmptyState icon="alert-circle-outline" title={t('dues.noReceipt')} /></Screen>;
  if (!r) return <Screen header={<Header back="/dues" title={t('dues.receipt')} />}><View /></Screen>;

  const share = () => Share.share({ message: t('dues.shareText', { society: r.society, number: r.number, amount: rupees(r.amount), unit: r.unit, date: nice(r.receivedOn), mode: r.mode }) }).catch(() => {});
  const row = (label: string, value: string, bold = false) => (
    <View style={s.kv}><Meta>{label}</Meta><Txt w={bold ? 800 : 600} style={{ fontSize: bold ? 15 : 13, flexShrink: 1, textAlign: 'right' }}>{value}</Txt></View>
  );
  return (
    <Screen header={<Header back="/dues" title={t('dues.receipt')} />}>
      <Card style={{ marginTop: 12 }}>
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Icon name={r.reversed ? 'close-circle' : 'checkmark-circle'} size={46} color={r.reversed ? C.bad : C.good} />
          <Txt w={800} style={{ fontSize: 26, marginTop: 6 }}>{rupees(r.amount)}</Txt>
          <Txt style={{ fontSize: 13, color: r.reversed ? C.bad : C.ink2 }}>{r.reversed ? t('dues.reversedNote', { reason: r.reverseReason ?? '' }) : t('dues.received')}</Txt>
        </View>
        {row(t('dues.r.number'), r.number)}
        {row(t('dues.r.date'), nice(r.receivedOn))}
        {row(t('dues.r.flat'), r.unitLabel)}
        {row(t('dues.r.mode'), tx('pmode', r.mode) + (r.reference ? ' · ' + r.reference : ''))}
        {r.settled.map(x => <View key={x.number}>{row(`${tx('charge', x.chargeType)} · ${nice(x.period)}`, rupees(x.amount))}</View>)}
        {r.advance > 0 && row(t('dues.r.advance'), rupees(r.advance))}
        {row(t('dues.r.society'), r.society)}
      </Card>
      {!r.reversed && <Btn full variant="ghost" icon="share-social-outline" label={t('dues.share')} onPress={share} style={{ marginHorizontal: 14 }} />}
    </Screen>
  );
}

const s = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: C.line },
});
