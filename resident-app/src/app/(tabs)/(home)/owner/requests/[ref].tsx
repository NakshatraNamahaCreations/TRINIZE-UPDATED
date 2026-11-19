import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Input, Meta, Pill, Row, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { comment, decide, request, rupees, type RequestDetail } from '@/lib/owner';
import { C } from '@/theme';

/** One repair on my flat: where it stands, what it costs, and — when asked — my yes or no. */
export default function OwnerRequest() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [r, setR] = useState<RequestDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { request(ref).then(setR).catch(() => setMissing(true)); }, [ref]);
  useEffect(load, [load]);
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle');

  const answer = (d: 'approved' | 'rejected') => confirm(t(d === 'approved' ? 'own.approveT' : 'own.rejectT'), t('own.decideB', { amount: rupees(r?.costEstimate ?? 0) }), t(d === 'approved' ? 'own.approve' : 'own.reject'), t('common.cancel'), async () => {
    setBusy(true);
    try { await decide(ref, d, note.trim() || undefined); setNote(''); toast(t(d === 'approved' ? 'own.approved' : 'own.rejected'), 'checkmark-circle'); load(); } catch (e) { fail(e); }
    setBusy(false);
  }, { tone: d === 'approved' ? 'primary' : 'danger' });
  const send = async () => {
    if (note.trim().length < 2) return;
    try { await comment(ref, note.trim()); setNote(''); toast(t('own.noteSent'), 'checkmark-circle'); } catch (e) { fail(e); }
  };

  if (missing) return <Screen header={<Header back="/owner/requests" title={t('own.repairs')} />}><EmptyState icon="alert-circle-outline" title={t('own.noRequest')} /></Screen>;
  if (!r) return <Screen header={<Header back="/owner/requests" title={t('own.repairs')} />}><View /></Screen>;

  const kv = (label: string, value: string) => <View style={s.kv}><Meta>{label}</Meta><Txt w={600} style={{ fontSize: 13, flexShrink: 1, textAlign: 'right' }}>{value}</Txt></View>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen header={<Header back="/owner/requests" title={r.ref} />}>
        <Card style={{ marginTop: 12 }}>
          <Row style={{ marginBottom: 6 }}>
            <Pill tone="acc">{r.unit}</Pill>
            <Pill tone={['Resolved', 'Closed'].includes(r.status) ? 'good' : 'dim'}>{tx('status', r.status)}</Pill>
            {r.ownerApproval === 'approved' && <Pill tone="good">{t('own.youApproved')}</Pill>}
            {r.ownerApproval === 'rejected' && <Pill tone="bad">{t('own.youRejected')}</Pill>}
          </Row>
          <Txt w={800} style={{ fontSize: 16 }}>{r.title}</Txt>
          {kv(t('own.r.category'), tx('cat', r.category))}
          {kv(t('own.r.where'), r.location)}
          {!!r.vendor && kv(t('own.r.vendor'), r.vendor)}
          {r.costEstimate != null && kv(t('own.r.estimate'), rupees(r.costEstimate))}
          {r.costActual != null && kv(t('own.r.actual'), rupees(r.costActual))}
        </Card>

        {r.canApprove && (
          <Card style={{ borderColor: '#F2D9AC', borderWidth: 1.5 }}>
            <Txt w={700} style={{ fontSize: 14 }}>{t('own.askT', { amount: rupees(r.costEstimate ?? 0) })}</Txt>
            <Meta style={{ marginTop: 2 }}>{t('own.askB')}</Meta>
            <Input value={note} onChangeText={setNote} placeholder={t('own.notePh')} maxLength={300} accessibilityLabel={t('own.notePh')} style={{ marginTop: 10 }} />
            <Row style={{ marginTop: 10, gap: 8 }}>
              <Btn icon="checkmark" label={t('own.approve')} onPress={() => answer('approved')} disabled={busy} style={{ flex: 1 }} />
              <Btn variant="danger" icon="close" label={t('own.reject')} onPress={() => answer('rejected')} disabled={busy} style={{ flex: 1 }} />
            </Row>
          </Card>
        )}

        {r.invoices.length > 0 && <Sect title={t('own.bills')} />}
        {r.invoices.map((inv, i) => (
          <Card key={i}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}><Txt w={700} style={{ fontSize: 14 }}>{rupees(inv.amount)}</Txt><Meta>{inv.note || tx('inv', inv.status)}</Meta></View>
              <Pill tone={inv.status === 'Paid' ? 'good' : inv.status === 'Rejected' ? 'bad' : 'dim'}>{tx('inv', inv.status)}</Pill>
            </View>
            {!!inv.fileUrl && <Btn variant="soft" icon="attach" label={t('own.viewBill')} onPress={() => Linking.openURL(inv.fileUrl!)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
          </Card>
        ))}

        {r.messages && r.messages.length > 0 && (
          <>
            <Sect title={t('own.thread')} />
            <Card>
              {r.messages.map((m, i) => (
                <View key={i} style={[{ paddingVertical: 7 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
                  <Txt w={700} style={{ fontSize: 12, color: C.acc }}>{m.from === 'resident' ? t('own.m.resident') : t('own.m.office')}</Txt>
                  <Txt style={{ fontSize: 13, lineHeight: 19 }}>{m.text}</Txt>
                </View>
              ))}
            </Card>
          </>
        )}

        {!r.canApprove && (
          <View style={{ paddingHorizontal: 14, marginTop: 8 }}>
            <Input value={note} onChangeText={setNote} placeholder={t('own.commentPh')} maxLength={1000} accessibilityLabel={t('own.commentPh')} />
            <Btn variant="ghost" icon="send" label={t('own.sendNote')} onPress={send} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
          </View>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: C.line },
});
