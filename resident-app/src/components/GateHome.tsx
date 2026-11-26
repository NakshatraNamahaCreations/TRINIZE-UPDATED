import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Icon, IconTile, Meta, Pill, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError, LIVE } from '@/lib/api';
import { decide, ICON, myVisits, titleOf, type Decision, type MyVisits, type Visit } from '@/lib/gate';
import { C } from '@/theme';

/**
 * Home's gate strip. Someone waiting at the gate is the most urgent thing in the app, so the request
 * sits at the top with its answers on it; otherwise it is one row leading to visitors and deliveries.
 */
export function GateHome() {
  const router = useRouter();
  const focused = useIsFocused();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [mine, setMine] = useState<MyVisits | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => { myVisits().then(setMine).catch(() => {}); }, []);
  // no push service is connected yet, so while Home is showing it asks the gate every few seconds
  useEffect(() => {
    if (!focused) return;
    load();
    const h = setInterval(load, 8000);
    return () => clearInterval(h);
  }, [focused, load]);

  const answer = async (v: Visit, d: Decision) => {
    setBusy(v.id);
    try {
      await decide(v.id, d);
      toast(t(d === 'approve' ? 'gate.done.approve' : d === 'reject' ? 'gate.done.reject' : 'gate.done.gate'), d === 'reject' ? 'close-circle' : 'checkmark-circle');
    } catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
    setBusy(null);
    load();
  };

  const pending = mine?.pending ?? [], parcels = mine?.parcels.length ?? 0, expected = mine?.expected.length ?? 0;
  return (
    <View style={{ marginHorizontal: 14, marginTop: 10, gap: 8 }}>
      {pending.map(v => (
        <View key={v.id} style={s.ask}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconTile name={ICON[v.visitorType]} size={38} bg={C.warnBg} fg={C.warn} />
            <Pressable style={{ flex: 1 }} onPress={() => router.push(`/gate/${v.id}`)}>
              <Txt w={800} style={{ fontSize: 14.5 }}>{t(v.kind === 'delivery' ? 'gate.askDelivery' : 'gate.askVisitor', { name: titleOf(v) })}</Txt>
              <Meta numberOfLines={2}>{[tx('vtype', v.visitorType), v.deliveryType && tx('dtype', v.deliveryType), v.purpose, v.people > 1 && t('gate.people', { n: v.people }), v.vehicle].filter(Boolean).join(' · ')}</Meta>
            </Pressable>
          </View>
          {!!v.flagged && <View style={s.flag}><Icon name="warning" size={14} color={C.bad} /><Txt style={{ fontSize: 12, color: C.bad, flex: 1 }}>{t('gate.flag', { reason: v.flagged })}</Txt></View>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Btn label={t('gate.approve')} icon="checkmark" onPress={() => answer(v, 'approve')} disabled={busy === v.id} style={{ flex: 1 }} />
            {v.kind === 'delivery' && <Btn variant="soft" label={t('gate.leave')} onPress={() => answer(v, 'gate')} disabled={busy === v.id} style={{ flex: 1 }} />}
            <Btn variant="danger" label={t('gate.reject')} onPress={() => answer(v, 'reject')} disabled={busy === v.id} style={{ flex: v.kind === 'delivery' ? 0.8 : 1 }} />
          </View>
        </View>
      ))}
      <Pressable onPress={() => router.push('/gate')} accessibilityRole="button" accessibilityLabel={t('gate.title')} style={({ pressed }) => [s.row, pressed && { borderColor: C.acc }]}>
        <IconTile name="shield-checkmark-outline" size={36} bg="#E3F3FC" fg="#0369A1" />
        <View style={{ flex: 1 }}>
          <Txt w={700} style={{ fontSize: 13.5 }}>{t('gate.title')}</Txt>
          <Meta numberOfLines={1}>{parcels ? t('gate.home.parcels', { n: parcels }) : expected ? t('gate.home.expected', { n: expected }) : t('gate.home.idle')}</Meta>
        </View>
        {parcels > 0 && <Pill tone="warn">{String(parcels)}</Pill>}
        <Icon name="chevron-forward" size={18} color={C.ink3} />
      </Pressable>
      {LIVE && (
        <Pressable onPress={() => router.push('/emergency')} accessibilityRole="button" accessibilityLabel={t('sos.title')} style={({ pressed }) => [s.row, pressed && { borderColor: C.bad }]}>
          <IconTile name="alert-circle-outline" size={36} bg={C.badBg} fg={C.bad} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 13.5 }}>{t('sos.title')}</Txt>
            <Meta numberOfLines={1}>{t('sos.home.s')}</Meta>
          </View>
          <Icon name="chevron-forward" size={18} color={C.ink3} />
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  ask: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#F2D9AC', borderRadius: 14, padding: 12 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.badBg, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
});
