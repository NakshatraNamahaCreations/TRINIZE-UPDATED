import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Icon, IconTile, Input, Meta, Pill, Row, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { checkPass, gateList, guardDecide, handOver, ICON, keepParcel, letIn, markExit, post, titleOf, TONE, watchGate, when, type Decision, type GateTab, type Post, type Visit } from '@/lib/gate';
import { emergency } from '@/lib/emergency';
import { ImagePicker } from '@/lib/native';
import { useAuth } from '@/store/auth';
import { C } from '@/theme';

/** A photo from the camera where there is one, otherwise from the gallery; undefined if the guard backs out. */
async function snap(): Promise<string | undefined> {
  if (!ImagePicker) return undefined;
  try {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    const res = cam.granted ? await ImagePicker.launchCameraAsync({ quality: 0.5 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    return res.canceled ? undefined : res.assets[0].uri;
  } catch { return undefined; }
}

/** The gate: who is waiting, who is inside, which parcels are on the desk — and a box for pass codes. */
export default function GuardPost() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const { signOut } = useAuth();
  const [me, setMe] = useState<Post | null>(null);
  const [tab, setTab] = useState<GateTab>('waiting');
  const [list, setList] = useState<Visit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Visit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [alerts, setAlerts] = useState(0);
  /** the parcel being handed over, with what the guard has typed */
  const [handing, setHanding] = useState<{ id: string; code: string; name: string } | null>(null);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const load = useCallback(async (which: GateTab, quiet = false) => {
    if (!quiet) setLoading(true);
    try { const [p, rows] = await Promise.all([post(), gateList(which)]); setMe(p); setList(rows); emergency().then(e => setAlerts(e.open.filter(i => i.status === 'Open').length)).catch(() => {}); }
    catch (e) { if (!quiet) fail(e); }
    finally { setLoading(false); }
  }, [fail]);
  // residents answer from their phones, so the lists are re-read while the screen is open
  useFocusEffect(useCallback(() => {
    void load(tab);
    const h = setInterval(() => { void load(tab, true); }, 6000);
    // and at once when the server says something changed — a QR check-in, a flat's answer
    const stop = watchGate(() => { void load(tab, true); });
    return () => { clearInterval(h); stop(); };
  }, [load, tab]));

  const run = async (id: string, job: () => Promise<Visit>, done: string) => {
    setBusy(id);
    try { await job(); toast(done, 'checkmark-circle'); setFound(null); setHanding(null); await load(tab, true); } catch (e) { fail(e); }
    setBusy(null);
  };
  const byPhone = (v: Visit, d: Decision) => confirm(t('guard.phoneT'), t('guard.phoneB', { unit: v.unit ?? '' }), t(d === 'approve' ? 'guard.saidYes' : d === 'gate' ? 'guard.saidKeep' : 'guard.saidNo'), t('common.cancel'),
    () => { void run(v.id, () => guardDecide(v.id, d), t('guard.recorded')); }, { tone: d === 'reject' ? 'danger' : 'primary', icon: 'call' });

  const tryPass = async () => {
    if (code.length !== 6) { toast(t('guard.pass6'), 'alert-circle'); return; }
    try { setFound(await checkPass(code)); setCode(''); } catch (e) { fail(e); }
  };

  const actions = (v: Visit) => {
    const b = busy === v.id;
    if (v.status === 'Pending') return (
      <>
        <View style={s.wait}><Icon name="time-outline" size={15} color={C.warn} /><Txt style={{ fontSize: 12.5, color: C.warn, flex: 1 }}>{t('guard.waiting', { unit: v.unit ?? '' })}</Txt></View>
        <Meta style={{ marginTop: 8 }}>{t('guard.noAnswer')}</Meta>
        <Row style={{ marginTop: 6, gap: 6 }}>
          <Btn variant="soft" label={t('guard.saidYes')} onPress={() => byPhone(v, 'approve')} disabled={b} style={{ flex: 1 }} />
          {v.kind === 'delivery' && <Btn variant="soft" label={t('guard.saidKeep')} onPress={() => byPhone(v, 'gate')} disabled={b} style={{ flex: 1 }} />}
          <Btn variant="danger" label={t('guard.saidNo')} onPress={() => byPhone(v, 'reject')} disabled={b} style={{ flex: 1 }} />
        </Row>
      </>
    );
    if (v.status === 'Approved' || v.status === 'Expected') return <Btn full icon="enter-outline" label={t('guard.letIn')} onPress={() => run(v.id, () => letIn(v.id), t('guard.inDone'))} disabled={b} style={{ marginTop: 10 }} />;
    if (v.status === 'Inside') return v.kind === 'delivery'
      ? <Row style={{ marginTop: 10, gap: 6 }}>
        <Btn icon="camera-outline" variant="soft" label={t('guard.outPhoto')} disabled={b} style={{ flex: 1 }} onPress={async () => { const p = await snap(); if (p) void run(v.id, () => markExit(v.id, p), t('guard.outDone')); }} />
        <Btn icon="exit-outline" label={t('guard.out')} onPress={() => run(v.id, () => markExit(v.id), t('guard.outDone'))} disabled={b} style={{ flex: 1 }} />
      </Row>
      : <Btn full icon="exit-outline" label={t('guard.out')} onPress={() => run(v.id, () => markExit(v.id), t('guard.outDone'))} disabled={b} style={{ marginTop: 10 }} />;
    if (v.status === 'AtGate' && !v.keptAt) return (
      <Row style={{ marginTop: 10, gap: 6 }}>
        <Btn icon="camera-outline" variant="soft" label={t('guard.keepPhoto')} disabled={b} style={{ flex: 1 }} onPress={async () => { const p = await snap(); if (p) void run(v.id, () => keepParcel(v.id, p), t('guard.keptDone')); }} />
        <Btn icon="cube-outline" label={t('guard.keep')} onPress={() => run(v.id, () => keepParcel(v.id), t('guard.keptDone'))} disabled={b} style={{ flex: 1 }} />
      </Row>
    );
    if (v.status === 'AtGate') return handing?.id === v.id
      ? <View style={{ marginTop: 10, gap: 8 }}>
        <Input value={handing.code} onChangeText={x => setHanding({ ...handing, code: x.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" placeholder={t('guard.codePh')} accessibilityLabel={t('guard.codePh')} />
        <Input value={handing.name} onChangeText={x => setHanding({ ...handing, name: x })} placeholder={t('guard.namePh')} accessibilityLabel={t('guard.namePh')} maxLength={80} />
        <Row style={{ gap: 6 }}>
          <Btn label={t('guard.handDone')} disabled={b || (handing.code.length !== 4 && handing.name.trim().length < 2)} style={{ flex: 1 }}
            onPress={() => run(v.id, () => handOver(v.id, handing.code.length === 4 ? { code: handing.code } : { collectedBy: handing.name.trim() }), t('guard.handed'))} />
          <Btn variant="ghost" label={t('common.cancel')} onPress={() => setHanding(null)} style={{ flex: 1 }} />
        </Row>
      </View>
      : <Btn full icon="hand-left-outline" label={t('guard.hand')} onPress={() => setHanding({ id: v.id, code: '', name: '' })} style={{ marginTop: 10 }} />;
    return null;
  };

  const card = (v: Visit, i: number) => (
    <Card key={v.id} delay={stagger(i)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {v.photoUrl ? <Image source={{ uri: v.photoUrl }} style={s.photo} /> : <IconTile name={ICON[v.visitorType]} size={44} radius={12} bg={v.kind === 'delivery' ? C.warnBg : C.accBg} fg={v.kind === 'delivery' ? C.warn : C.acc} />}
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 15 }} numberOfLines={1}>{titleOf(v)}</Txt>
          <Meta numberOfLines={2}>{[v.unit ?? t('guard.society'), tx('vtype', v.visitorType), v.kind !== 'delivery' && v.partner, v.deliveryType && tx('dtype', v.deliveryType), v.people > 1 && t('gate.people', { n: v.people }), v.vehicle].filter(Boolean).join(' · ')}</Meta>
        </View>
        <Pill tone={TONE[v.status]}>{tx('vst', v.status)}</Pill>
      </View>
      {!!v.selfCheckIn && <View style={s.self}><Icon name="qr-code-outline" size={15} color={C.acc} /><Txt style={{ fontSize: 12.5, color: C.acc, flex: 1 }}>{t('guard.self', { ref: v.ref ?? '' })}</Txt></View>}
      {!!v.flagged && <View style={s.flag}><Icon name="warning" size={15} color={C.bad} /><Txt style={{ fontSize: 12.5, color: C.bad, flex: 1 }}>{t('guard.watch', { reason: v.flagged })}</Txt></View>}
      {tab === 'today' && <Meta style={{ marginTop: 6 }}>{[v.enteredAt && t('guard.inAt', { when: when(v.enteredAt) }), v.exitedAt && t('guard.outAt', { when: when(v.exitedAt) }), v.decidedByName && tx('via', v.decidedVia ?? '') + ' · ' + v.decidedByName, v.note].filter(Boolean).join(' · ')}</Meta>}
      {tab !== 'today' && actions(v)}
    </Card>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <IconTile name="shield-checkmark" size={40} radius={12} />
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 17 }} numberOfLines={1}>{me?.gate ?? t('guard.post')}</Txt>
          {!!me && <Meta numberOfLines={1}>{me.society} · {me.user.name}</Meta>}
        </View>
        <Pressable onPress={() => router.push('/post/emergency')} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('sos.title')} style={[s.out, { borderColor: C.bad, backgroundColor: C.badBg }]}>
          <Icon name="alert-circle" size={21} color={C.bad} />
        </Pressable>
        <Pressable onPress={() => confirm(t('signout.title'), t('mgr.signoutB'), t('profile.signout'), t('common.cancel'), signOut, { icon: 'log-out-outline' })} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('profile.signout')} style={s.out}>
          <Icon name="log-out-outline" size={21} color={C.ink2} />
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 96, paddingTop: 10 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(tab)} tintColor={C.acc} />}>
        {alerts > 0 && (
          <Pressable onPress={() => router.push('/post/emergency')} accessibilityRole="button" style={s.alarm}>
            <Icon name="alert-circle" size={20} color="#fff" />
            <Txt w={800} style={{ color: '#fff', fontSize: 14, flex: 1 }}>{t('sos.openN', { n: alerts })}</Txt>
            <Icon name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        )}
        <View style={s.pass}>
          <Txt w={700} style={{ fontSize: 13 }}>{t('guard.passT')}</Txt>
          <Row style={{ marginTop: 8, gap: 8 }}>
            <Input value={code} onChangeText={x => setCode(x.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder={t('guard.passPh')} accessibilityLabel={t('guard.passT')} onSubmitEditing={tryPass} style={{ flex: 1, fontSize: 18, letterSpacing: 3 }} />
            <Btn label={t('guard.check')} onPress={tryPass} />
          </Row>
          {found && (
            <View style={s.found}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="checkmark-circle" size={20} color={C.good} />
                <View style={{ flex: 1 }}>
                  <Txt w={800} style={{ fontSize: 14.5 }}>{titleOf(found)} → {found.unit}</Txt>
                  <Meta>{[tx('vtype', found.visitorType), found.people > 1 && t('gate.people', { n: found.people }), found.vehicle, t('guard.passBy', { who: found.decidedByName ?? '' })].filter(Boolean).join(' · ')}</Meta>
                </View>
              </View>
              <Row style={{ marginTop: 10, gap: 6 }}>
                <Btn icon="enter-outline" label={t('guard.letIn')} disabled={busy === found.id} style={{ flex: 1 }} onPress={() => run(found.id, () => letIn(found.id), t('guard.inDone'))} />
                <Btn variant="ghost" label={t('common.cancel')} onPress={() => setFound(null)} style={{ flex: 0.6 }} />
              </Row>
            </View>
          )}
        </View>

        <View style={{ marginHorizontal: 14, marginTop: 12 }}>
          <Segmented value={tab} onChange={k => { setList(null); setTab(k); }} items={[
            ['waiting', t('guard.tab.waiting') + (me?.waiting ? ` ${me.waiting}` : '')], ['inside', t('guard.tab.inside') + (me?.inside ? ` ${me.inside}` : '')],
            ['parcels', t('guard.tab.parcels') + (me?.parcels ? ` ${me.parcels}` : '')], ['today', t('guard.tab.today')],
          ]} />
        </View>
        {list !== null && !list.length && <EmptyState icon={tab === 'parcels' ? 'cube-outline' : 'shield-checkmark-outline'} title={t(`guard.empty.${tab}`)} />}
        {(list ?? []).map(card)}
      </ScrollView>

      <View style={[s.fab, { bottom: insets.bottom + 16 }]}>
        <Btn full variant="gradient" icon="add" label={t('guard.new')} onPress={() => router.push('/post/new')} style={{ paddingVertical: 15 }} textStyle={{ fontSize: 15 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  out: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  pass: { marginHorizontal: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12 },
  found: { marginTop: 10, backgroundColor: C.goodBg, borderRadius: 12, padding: 10 },
  photo: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.dimBg },
  wait: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.warnBg, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 9, marginTop: 10 },
  self: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accBg, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 9, marginTop: 10 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.badBg, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 9, marginTop: 10 },
  fab: { position: 'absolute', left: 16, right: 16 },
  alarm: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bad, borderRadius: 14, padding: 14, marginHorizontal: 14, marginBottom: 10 },
});
