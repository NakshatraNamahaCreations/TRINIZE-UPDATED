import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { Image, Share, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Qr } from '@/components/Qr';
import { Btn, Card, EmptyState, Header, Icon, IconTile, Meta, Pill, Row, Screen, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { cancelPass, decide, ICON, saveFrequent, titleOf, TONE, visit, when, type Decision, type Visit } from '@/lib/gate';
import { SOCIETY } from '@/store/data';
import { C } from '@/theme';

/** One visitor or delivery: answer it, show its pass, or see what happened at the gate. */
export default function GateVisit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [v, setV] = useState<Visit | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  useFocusEffect(useCallback(() => {
    const load = () => { visit(id).then(setV).catch(() => setMissing(true)); };
    load();
    const h = setInterval(load, 8000);
    return () => clearInterval(h);
  }, [id]));

  const act = async (run: () => Promise<Visit>, done: string) => {
    setBusy(true);
    try { setV(await run()); toast(done, 'checkmark-circle'); } catch (e) { fail(e); }
    setBusy(false);
  };
  const answer = (d: Decision) => act(() => decide(id, d), t(d === 'approve' ? 'gate.done.approve' : d === 'reject' ? 'gate.done.reject' : 'gate.done.gate'));

  if (missing) return <Screen header={<Header back="/gate" title={t('gate.title')} />}><EmptyState icon="alert-circle-outline" title={t('gate.missing')} /></Screen>;
  if (!v) return <Screen header={<Header back="/gate" title={t('gate.title')} />}><View /></Screen>;

  const share = () => Share.share({ message: t('gate.shareText', { name: v.name, society: SOCIETY.name, unit: v.unit ?? '', code: v.passCode ?? '', until: when(v.validUntil) }) }).catch(() => {});
  const steps: [string, string | null][] = [
    [v.status === 'Expected' || v.decidedVia === 'pass' ? t('gate.step.pass') : t('gate.step.arrived', { gate: v.gate ?? '' }), v.createdAt],
    [v.decidedVia ? t('gate.step.decided', { how: tx('via', v.decidedVia), who: v.decidedByName ?? '' }) : '', v.decidedAt],
    [t('gate.step.in', { guard: v.guardName ?? '' }), v.enteredAt],
    [t('gate.step.kept', { gate: v.gate ?? '' }), v.keptAt],
    [t('gate.step.out'), v.exitedAt],
    [t('gate.step.collected', { who: v.collectedBy ?? '' }), v.collectedAt],
  ];

  return (
    <Screen header={<Header back="/gate" title={titleOf(v)} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {v.photoUrl ? <Image source={{ uri: v.photoUrl }} style={s.photo} accessibilityLabel={t('gate.photo')} />
            : <IconTile name={ICON[v.visitorType]} size={52} radius={14} bg={v.kind === 'delivery' ? C.warnBg : C.accBg} fg={v.kind === 'delivery' ? C.warn : C.acc} />}
          <View style={{ flex: 1 }}>
            <Txt w={800} style={{ fontSize: 17 }}>{titleOf(v)}</Txt>
            <Meta>{[tx('vtype', v.visitorType), v.deliveryType && tx('dtype', v.deliveryType), v.people > 1 && t('gate.people', { n: v.people })].filter(Boolean).join(' · ')}</Meta>
          </View>
          <Pill tone={TONE[v.status]}>{tx('vst', v.status)}</Pill>
        </View>
        {[[t('gate.f.purpose'), v.purpose], [t('gate.f.phone'), v.phone], [t('gate.f.vehicle'), v.vehicle], [t('gate.f.rider'), v.kind === 'delivery' && v.partner && v.name !== v.partner ? v.name : '']].filter(r => r[1]).map(([l, val]) => (
          <View key={l} style={s.kv}><Meta>{l}</Meta><Txt w={600} style={{ fontSize: 13 }}>{val}</Txt></View>
        ))}
        {!!v.selfCheckIn && <View style={[s.flag, { backgroundColor: C.accBg }]}><Icon name="qr-code-outline" size={15} color={C.acc} /><Txt style={{ fontSize: 12.5, color: C.acc, flex: 1 }}>{t('gate.self')}</Txt></View>}
        {!!v.flagged && <View style={s.flag}><Icon name="warning" size={15} color={C.bad} /><Txt style={{ fontSize: 12.5, color: C.bad, flex: 1 }}>{t('gate.flag', { reason: v.flagged })}</Txt></View>}
      </Card>

      {v.status === 'Pending' && (
        <Card>
          <Txt w={700} style={{ fontSize: 14 }}>{t(v.kind === 'delivery' ? 'gate.q.delivery' : 'gate.q.visitor')}</Txt>
          <Meta style={{ marginTop: 2 }}>{t('gate.q.sub')}</Meta>
          <Btn full icon="checkmark" label={t('gate.approve')} onPress={() => answer('approve')} disabled={busy} style={{ marginTop: 12 }} />
          {v.kind === 'delivery' && <Btn full variant="soft" icon="cube-outline" label={t('gate.leave')} onPress={() => answer('gate')} disabled={busy} style={{ marginTop: 8 }} />}
          <Btn full variant="danger" icon="close" label={t('gate.reject')} onPress={() => answer('reject')} disabled={busy} style={{ marginTop: 8 }} />
        </Card>
      )}

      {v.status === 'Expected' && !!v.passCode && (
        <Card style={{ alignItems: 'center' }}>
          <Txt w={700} style={{ fontSize: 13, color: C.ink2 }}>{t('gate.pass.title')}</Txt>
          <Txt w={800} style={s.code} accessibilityLabel={v.passCode.split('').join(' ')}>{v.passCode.slice(0, 3)} {v.passCode.slice(3)}</Txt>
          <Qr value={'TRZ:' + v.passCode} />
          <Meta style={{ textAlign: 'center', marginTop: 10 }}>{t('gate.pass.valid', { from: when(v.validFrom), until: when(v.validUntil) })}</Meta>
          <Row style={{ marginTop: 12, gap: 8 }}>
            <Btn icon="share-social-outline" label={t('gate.pass.share')} onPress={share} style={{ flex: 1 }} />
            <Btn variant="danger" label={t('gate.pass.cancel')} disabled={busy} style={{ flex: 1 }}
              onPress={() => confirm(t('gate.pass.cancelT'), t('gate.pass.cancelB'), t('gate.pass.cancel'), t('common.cancel'), () => act(() => cancelPass(id), t('gate.pass.cancelled')))} />
          </Row>
        </Card>
      )}

      {v.status === 'AtGate' && (
        <Card style={{ alignItems: 'center' }}>
          <Txt w={700} style={{ fontSize: 13, color: C.ink2 }}>{t('gate.collect.title')}</Txt>
          <Txt w={800} style={s.code}>{v.collectCode ?? '····'}</Txt>
          <Meta style={{ textAlign: 'center' }}>{v.keptAt ? t('gate.collect.ready', { gate: v.gate ?? '', when: when(v.keptAt) }) : t('gate.collect.waiting')}</Meta>
        </Card>
      )}

      {!!v.proofUrl && (
        <Card>
          <Txt w={700} style={{ fontSize: 13, marginBottom: 8 }}>{t('gate.proof')}</Txt>
          <Image source={{ uri: v.proofUrl }} style={s.proof} accessibilityLabel={t('gate.proof')} />
        </Card>
      )}

      <Card>
        <Txt w={700} style={{ fontSize: 13, marginBottom: 6 }}>{t('gate.log')}</Txt>
        {steps.filter(([label, at]) => at && label).map(([label, at]) => (
          <View key={label} style={{ flexDirection: 'row', gap: 8, paddingVertical: 5 }}>
            <Icon name="ellipse" size={8} color={C.acc} style={{ marginTop: 5 }} />
            <Txt style={{ fontSize: 12.5, flex: 1 }}>{label}</Txt>
            <Meta>{when(at)}</Meta>
          </View>
        ))}
        {v.status === 'Rejected' && <Meta style={{ marginTop: 4 }}>{v.note || t('gate.rejectedNote')}</Meta>}
      </Card>

      {v.kind === 'visitor' && !!v.phone && ['Left', 'Inside', 'Approved'].includes(v.status) && (
        <Btn variant="ghost" icon="person-add-outline" label={t('gate.saveFrequent')} style={{ marginHorizontal: 14, marginTop: 4 }}
          onPress={() => saveFrequent({ name: v.name, phone: v.phone!, visitorType: v.visitorType, autoApprove: false }).then(() => { toast(t('gate.savedFrequent'), 'checkmark-circle'); router.push('/gate/frequent'); }).catch(fail)} />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  photo: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.dimBg },
  proof: { width: '100%', height: 180, borderRadius: 10, backgroundColor: C.dimBg },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: C.line },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.badBg, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 9, marginTop: 10 },
  code: { fontSize: 34, letterSpacing: 4, color: C.ink, marginVertical: 8 },
});
