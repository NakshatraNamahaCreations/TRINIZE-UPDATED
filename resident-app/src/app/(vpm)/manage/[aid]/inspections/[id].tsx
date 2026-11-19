import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips } from '@/components/Chips';
import { InspectionReport } from '@/components/InspectionReport';
import { useUI } from '@/components/Overlay';
import { Btn, Card, Icon, Input, Meta, Pill, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { addPhoto, analyse, CONDITIONS, one, raise, rate, SEV_TONE, share, submit, type Condition, type Full, type Item } from '@/lib/inspections';
import { ImagePicker } from '@/lib/native';
import { C } from '@/theme';

/**
 * One inspection on the phone. While it is in progress: one area at a time — rate each item with a tap,
 * add a note, take photos — and the app says what is still missing. Once submitted: the report, with
 * findings to turn into work orders and the switch that shares it with the flat.
 */
export default function Inspection() {
  const { aid, id } = useLocalSearchParams<{ aid: string; id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [r, setR] = useState<Full | null>(null);
  const [area, setArea] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  /** notes as typed, saved when the field is left (onBlur works on phones and in the browser alike) */
  const typed = useRef<Record<string, string>>({});

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  // open on the first area that still has something to rate — and then stay put: finishing an area's
  // last rating must not whisk the inspector away before they add its note or photo
  useEffect(() => { one(aid, id).then(f => { setR(f); setArea(a => a || (f.sections.find(x => x.items.some(i => !i.condition)) ?? f.sections[0])?.name || ''); }).catch(fail); }, [aid, id, fail]);

  const act = async (work: Promise<Full>, done?: string) => {
    setBusy(true);
    try { setR(await work); if (done) toast(done, 'checkmark-circle'); } catch (e) { fail(e); }
    setBusy(false);
  };
  const snap = async (it: Item) => {
    if (!ImagePicker) { toast(t('issue.photoUnavailable'), 'image'); return; }
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      const res = cam.granted ? await ImagePicker.launchCameraAsync({ quality: 0.5 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
      if (!res.canceled) await act(addPhoto(aid, id, it, res.assets[0].uri));
    } catch { toast(t('issue.photoDenied'), 'image'); }
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/manage/[aid]/inspections', params: { aid } }));

  const header = (
    <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
      <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={back}><Icon name="chevron-back" size={24} color={C.ink2} /></Pressable>
      <Txt w={800} style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{r ? `${r.ref} · ${tx('ins.type', r.type)}` : t('ins.title')}</Txt>
    </View>
  );
  if (!r) return <View style={{ flex: 1, backgroundColor: C.bg }}>{header}</View>;

  /* ---------- submitted: the report ---------- */
  if (r.status === 'Submitted') {
    const ids = Object.keys(picked).filter(k => picked[k]);
    const doRaise = async () => {
      setBusy(true);
      try { const out = await raise(aid, id, ids); setR(out.inspection); setPicked({}); toast(t('ins.raised', { n: out.created.length }), 'construct'); } catch (e) { fail(e); }
      setBusy(false);
    };
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
          <InspectionReport r={r} pick={{ picked, toggle: k => setPicked(p => ({ ...p, [k]: !p[k] })) }} />
          {r.scope === 'unit' && (
            <Card>
              <Txt w={700} style={{ fontSize: 14 }}>{t('ins.share')}</Txt>
              <Meta style={{ marginTop: 3 }}>{t('ins.shareS')}</Meta>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Btn variant={r.shareOwner ? 'primary' : 'ghost'} icon={r.shareOwner ? 'checkmark' : undefined} label={t('ins.shareOwner')} disabled={busy} onPress={() => act(share(aid, id, !r.shareOwner, r.shareTenant))} style={{ flex: 1 }} />
                <Btn variant={r.shareTenant ? 'primary' : 'ghost'} icon={r.shareTenant ? 'checkmark' : undefined} label={t('ins.shareTenant')} disabled={busy} onPress={() => act(share(aid, id, r.shareOwner, !r.shareTenant))} style={{ flex: 1 }} />
              </View>
            </Card>
          )}
        </ScrollView>
        {ids.length > 0 && (
          <View style={[s.foot, { paddingBottom: insets.bottom + 10 }]}>
            <Btn full icon="construct-outline" label={t('ins.raise', { n: ids.length })} disabled={busy} onPress={doRaise} />
          </View>
        )}
      </View>
    );
  }

  /* ---------- in progress: the walkthrough ---------- */
  const missing = r.missing ?? [];
  const sec = r.sections.find(x => x.name === area) ?? r.sections[0]!;
  const at = r.sections.indexOf(sec), next = r.sections[at + 1];
  const left = (name: string) => missing.filter(m => m.startsWith(name + ' · ')).length;
  const finish = () => confirm(t('ins.submitT'), t('ins.submitB'), t('ins.submit'), t('common.cancel'), () => { void act(submit(aid, id), t('ins.submitted')); }, { tone: 'primary', icon: 'checkmark-circle' });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <Meta style={{ marginBottom: 8 }}>{r.where} · {t('ins.progress', { done: r.counts.rated, total: r.counts.total })}</Meta>
          <Chips items={r.sections.map(x => [x.name, left(x.name) ? `${x.name} (${left(x.name)})` : `✓ ${x.name}`] as [string, string])} value={sec.name} onChange={setArea} />
        </View>
        {sec.items.map(it => (
          <Card key={it.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt w={700} style={{ fontSize: 14.5, flex: 1 }}>{it.item}</Txt>
              {it.photoRequired && !it.photos.length && it.condition !== 'Missing' && <Pill tone="warn">{t('ins.photoNeeded')}</Pill>}
            </View>
            <View style={s.conds}>
              {CONDITIONS.map(c => {
                const on = it.condition === c;
                return (
                  <Pressable key={c} disabled={busy} onPress={() => act(rate(aid, id, it.id, { condition: c as Condition }))} accessibilityRole="radio" accessibilityState={{ selected: on }}
                    style={[s.cond, on && { backgroundColor: c === 'Good' ? C.good : c === 'Fair' ? C.warn : C.bad, borderColor: 'transparent' }]}>
                    <Txt w={700} style={{ fontSize: 12, color: on ? '#fff' : C.ink2 }}>{tx('ins.c', c)}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <Input key={it.id + it.note} defaultValue={it.note} placeholder={t('ins.notePh')} maxLength={1000} accessibilityLabel={`${t('ins.notePh')} ${it.item}`}
              onChangeText={v => { typed.current[it.id] = v; }}
              onBlur={() => { const v = typed.current[it.id]?.trim(); if (v !== undefined && v !== it.note) void act(rate(aid, id, it.id, { note: v })); }} style={{ marginTop: 8 }} />
            <View style={s.photos}>
              {it.photos.map(p => (
                <View key={p}>
                  <Image source={{ uri: p }} style={s.photo} accessibilityLabel={it.item} />
                  <Pressable hitSlop={8} accessibilityLabel={t('ins.removePhoto')} onPress={() => act(rate(aid, id, it.id, { photos: it.photos.filter(x => x !== p) }))} style={s.x}><Icon name="close" size={12} color={C.ink2} /></Pressable>
                </View>
              ))}
              {it.photos.length < 8 && (
                <Pressable onPress={() => snap(it)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${t('ins.addPhoto')} ${it.item}`} style={[s.photo, s.add]}>
                  <Icon name="camera-outline" size={20} color={C.acc} /><Txt w={700} style={{ fontSize: 10.5, color: C.acc }}>{t('ins.addPhoto')}</Txt>
                </Pressable>
              )}
            </View>
            {!!it.finding && !!it.severity && <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' }}><Pill tone={SEV_TONE[it.severity]}>{tx('ins.sev', it.severity)}</Pill><Meta style={{ flex: 1 }}>{it.finding}</Meta></View>}
          </Card>
        ))}
        <View style={{ paddingHorizontal: 14, marginTop: 4 }}>
          <Btn variant="soft" full icon="sparkles-outline" label={t('ins.analyse')} disabled={busy} onPress={() => act(analyse(aid, id), t('ins.analysed'))} />
        </View>
        {missing.length > 0 && !next && (
          <Card style={{ borderColor: C.warn }}>
            <Txt w={700} style={{ fontSize: 13.5 }}>{t('ins.missingN', { n: missing.length })}</Txt>
            {missing.slice(0, 6).map(m => <Meta key={m} style={{ marginTop: 3 }}>• {m}</Meta>)}
          </Card>
        )}
      </ScrollView>
      <View style={[s.foot, { paddingBottom: insets.bottom + 10 }]}>
        {next ? <Btn full icon="arrow-forward" label={t('ins.next', { name: next.name })} onPress={() => setArea(next.name)} />
          : <Btn full icon="checkmark-done" label={missing.length ? t('ins.missingN', { n: missing.length }) : t('ins.submit')} disabled={busy || missing.length > 0} onPress={finish} />}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  conds: { flexDirection: 'row', gap: 5, marginTop: 10 },
  cond: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photo: { width: 64, height: 64, borderRadius: 10, backgroundColor: C.dimBg },
  add: { alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: C.accBg, borderWidth: 1, borderColor: C.accBorder, borderStyle: 'dashed' },
  x: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
});
