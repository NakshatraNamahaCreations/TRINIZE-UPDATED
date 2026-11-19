import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, Label } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Icon, Input, Meta, Pill, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { arrive, DELIVERY_TYPES, findFlats, lookup, PARTNERS, VISITOR_TYPES, when, type DeliveryType, type Flat, type Lookup, type VisitorType } from '@/lib/gate';
import { ImagePicker } from '@/lib/native';
import { C } from '@/theme';

/** Someone is at the gate: who, for which flat, and — for a delivery — from whom. */
export default function NewArrival() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  // opened straight from a link there is nothing to go back to — then the gate itself is the way out
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/post'));
  const [type, setType] = useState<VisitorType>('Guest');
  /** once the guard has chosen a type themselves, a lookup no longer changes it */
  const [typed, setTyped] = useState(false);
  const [phone, setPhone] = useState('');
  /* what the gate knows about a number, and the flats matching a search — each kept with what it answers */
  const [seen, setSeen] = useState<{ phone: string; data: Lookup } | null>(null);
  const known = seen?.phone === phone ? seen.data : null;
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ q: string; rows: Flat[] }>({ q: '', rows: [] });
  const [flat, setFlat] = useState<Flat | null>(null);
  const flats = !flat && hits.q === q.trim() ? hits.rows : [];
  const [purpose, setPurpose] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [people, setPeople] = useState(1);
  const [partner, setPartner] = useState<string | null>(null);
  const [dtype, setDtype] = useState<DeliveryType>('Parcel');
  const [photo, setPhoto] = useState<string | undefined>();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const delivery = type === 'Delivery';
  const societyLevel = type === 'Emergency' || type === 'Staff';

  // a full number: have they been here before, are they someone's regular, are they on the watch list
  useEffect(() => {
    if (!/^[6-9]\d{9}$/.test(phone)) return;
    let on = true;
    lookup(phone).then(k => {
      if (!on) return;
      setSeen({ phone, data: k });
      const lead = k.regular[0] ?? k.last;
      if (lead) { setName(n => n || lead.name); setVehicle(v => v || lead.vehicle || ''); }
      // someone who has been here before: the rest of the form is what it was last time
      if (k.last) {
        const was = k.last;
        if (!typed) setType(was.visitorType);
        setPartner(p => p ?? was.partner);
        if (was.deliveryType) setDtype(was.deliveryType);
        setPurpose(p => p || was.purpose);
      }
    }).catch(() => {});
    return () => { on = false; };
    // only a new number asks again; choosing a type by hand must not
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // flats as the guard types a number or a resident's name
  useEffect(() => {
    const term = q.trim();
    if (flat || term.length < 2) return;
    let on = true;
    const h = setTimeout(() => { findFlats(term).then(rows => { if (on) setHits({ q: term, rows }); }).catch(() => {}); }, 250);
    return () => { on = false; clearTimeout(h); };
  }, [q, flat]);

  const snap = async () => {
    if (!ImagePicker) { toast(t('issue.photoUnavailable'), 'image'); return; }
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      const res = cam.granted ? await ImagePicker.launchCameraAsync({ quality: 0.5 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
      if (!res.canceled) setPhoto(res.assets[0].uri);
    } catch { toast(t('issue.photoDenied'), 'image'); }
  };

  const who = delivery ? (name.trim() || partner || '') : name.trim();
  const phoneBad = phone.length > 0 && !/^[6-9]\d{9}$/.test(phone);
  const ok = who.length >= 2 && !phoneBad && (!!flat || societyLevel);

  const submit = async () => {
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    try {
      const v = await arrive({ visitorType: type, name: who, phone: phone || undefined, unitId: flat?.id, purpose: purpose.trim(), vehicle: vehicle.trim() || undefined, people,
        partner: delivery ? partner ?? undefined : undefined, deliveryType: delivery ? dtype : undefined, photo });
      toast(v.blocked ? t('guard.blocked', { reason: v.blocked }) : v.status === 'Approved' ? t('guard.autoOk') : t('guard.asked', { unit: v.unit ?? '' }), v.blocked ? 'close-circle' : 'checkmark-circle');
      leave();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle');
      setBusy(false);
    }
  };

  const regularHere = known?.regular.map(r => r.unit).join(', ');
  // the gate already has their picture: it is kept on the new entry unless the guard takes a fresh one
  const onFile = known?.last?.photoUrl ?? null;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={leave}><Icon name="chevron-back" size={24} color={C.ink2} /></Pressable>
        <Txt w={800} style={{ fontSize: 16, flex: 1 }}>{t('guard.new')}</Txt>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <Chips items={VISITOR_TYPES.map(k => [k, tx('vtype', k)] as const)} value={type} onChange={k => { setTyped(true); setType(k); }} />

        <Label>{t('guard.f.phone')}</Label>
        <Input value={phone} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder={t('gate.new.phonePh')} accessibilityLabel={t('guard.f.phone')} />
        {tried && phoneBad && <Txt style={s.err}>{t('gate.new.badPhone')}</Txt>}
        {known?.watch && (
          <View style={[s.note, { backgroundColor: C.badBg }]}>
            <Icon name="warning" size={16} color={C.bad} />
            <Txt style={{ fontSize: 12.5, color: C.bad, flex: 1 }}>{t(known.watch.level === 'block' ? 'guard.isBlocked' : 'guard.isWatched', { reason: known.watch.reason })}</Txt>
          </View>
        )}
        {!!known?.last && (
          <View style={s.known}>
            {known.last.photoUrl
              ? <Image source={{ uri: known.last.photoUrl }} style={s.face} accessibilityLabel={known.last.name} />
              : <View style={[s.face, s.noFace]}><Icon name="person" size={26} color={C.acc} /></View>}
            <View style={{ flex: 1 }}>
              <Txt w={800} style={{ fontSize: 15 }} numberOfLines={1}>{known.last.name}</Txt>
              <Meta numberOfLines={1}>{t('guard.known', { n: known.visits })} · {t('guard.lastSeen', { when: when(known.last.at) })}</Meta>
              {!!regularHere && <Meta numberOfLines={1} style={{ color: C.good }}>{t('guard.regular', { units: regularHere })}</Meta>}
              <Txt style={{ fontSize: 12, color: C.good, marginTop: 3 }}>{t('guard.filled')}</Txt>
            </View>
          </View>
        )}
        {!!known && !known.last && !known.watch && known.regular.length > 0 && (
          <View style={[s.note, { backgroundColor: C.goodBg }]}>
            <Icon name="repeat" size={16} color={C.good} />
            <Txt style={{ fontSize: 12.5, color: C.good, flex: 1 }}>{t('guard.regular', { units: regularHere ?? '' })}</Txt>
          </View>
        )}

        {delivery && <>
          <Label>{t('gate.new.partner')}</Label>
          <Chips items={PARTNERS.map(p => [p, p] as const)} value={partner} onChange={setPartner} />
          <Label>{t('guard.f.dtype')}</Label>
          <Chips items={DELIVERY_TYPES.map(k => [k, tx('dtype', k)] as const)} value={dtype} onChange={setDtype} />
        </>}

        <Label>{delivery ? t('guard.f.rider') : t('guard.f.name')}</Label>
        <Input value={name} onChangeText={setName} placeholder={t('guard.f.namePh')} maxLength={80} accessibilityLabel={t('guard.f.name')} />
        {tried && who.length < 2 && <Txt style={s.err}>{t(delivery ? 'gate.new.needPartner' : 'gate.new.needName')}</Txt>}

        <Label>{societyLevel ? t('guard.f.flatOpt') : t('guard.f.flat')}</Label>
        {flat ? (
          <View style={s.flat}>
            <View style={{ flex: 1 }}>
              <Txt w={800} style={{ fontSize: 14 }}>{flat.code}</Txt>
              <Meta numberOfLines={1}>{flat.residents.join(', ') || t('guard.noResidents')}</Meta>
            </View>
            <Pressable onPress={() => { setFlat(null); setQ(''); }} hitSlop={10} accessibilityLabel={t('guard.changeFlat')}><Icon name="close-circle" size={22} color={C.ink3} /></Pressable>
          </View>
        ) : <>
          {!!known?.flats.length && <>
            <Meta style={{ marginBottom: 6 }}>{t('guard.wentTo')}</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {known.flats.map(f => (
                <Pressable key={f.id} onPress={() => setFlat(f)} style={s.went} accessibilityRole="button" accessibilityLabel={f.code}>
                  <Icon name="home" size={15} color={C.acc} />
                  <Txt w={700} style={{ fontSize: 13.5, color: C.acc }}>{f.code}</Txt>
                </Pressable>
              ))}
            </View>
          </>}
          <Input value={q} onChangeText={setQ} placeholder={t('guard.f.flatPh')} autoCapitalize="characters" accessibilityLabel={t('guard.f.flat')} />
          {flats.map(f => (
            <Pressable key={f.id} onPress={() => setFlat(f)} style={s.opt} accessibilityRole="button">
              <Txt w={700} style={{ fontSize: 13.5 }}>{f.code}</Txt>
              <Meta numberOfLines={1} style={{ flex: 1 }}>{f.residents.join(', ')}</Meta>
            </Pressable>
          ))}
          {q.trim().length >= 2 && hits.q === q.trim() && !flats.length && <Meta style={{ marginTop: 6 }}>{t('guard.noFlat')}</Meta>}
        </>}
        {tried && !flat && !societyLevel && <Txt style={s.err}>{t('guard.needFlat')}</Txt>}
        {!!flat && !flat.residents.length && <Meta style={{ marginTop: 4 }}>{t('guard.nobodyOnApp')}</Meta>}

        {!delivery && <>
          <Label>{t('guard.f.purpose')}</Label>
          <Input value={purpose} onChangeText={setPurpose} placeholder={t('guard.f.purposePh')} maxLength={120} accessibilityLabel={t('guard.f.purpose')} />
          <Label>{t('gate.new.vehicle')}</Label>
          <Input value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" placeholder="KA 01 AB 1234" maxLength={16} accessibilityLabel={t('gate.new.vehicle')} />
          <Label>{t('gate.new.people')}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => setPeople(n => Math.max(1, n - 1))} accessibilityLabel={t('gate.new.fewer')} hitSlop={8} style={s.step}><Icon name="remove" size={18} color={C.acc} /></Pressable>
            <Txt w={800} style={{ fontSize: 17, minWidth: 24, textAlign: 'center' }}>{people}</Txt>
            <Pressable onPress={() => setPeople(n => Math.min(20, n + 1))} accessibilityLabel={t('gate.new.more')} hitSlop={8} style={s.step}><Icon name="add" size={18} color={C.acc} /></Pressable>
          </View>
        </>}

        <Label>{t('guard.f.photo')}</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {(photo || onFile) && <Image source={{ uri: photo ?? onFile! }} style={{ width: 56, height: 56, borderRadius: 12 }} />}
          <Btn variant="ghost" icon="camera-outline" label={photo ? t('guard.retake') : onFile ? t('guard.newPhoto') : t('guard.takePhoto')} onPress={snap} />
          {type === 'Emergency' && <Pill tone="bad">{t('guard.emergency')}</Pill>}
        </View>
        {!photo && !!onFile && <Meta style={{ marginTop: 6 }}>{t('guard.onFile')}</Meta>}

        <Btn full label={busy ? t('guard.sending') : type === 'Emergency' ? t('guard.logEmergency') : societyLevel && !flat ? t('guard.logEntry') : t('guard.ask')} onPress={submit} disabled={busy} style={{ marginTop: 22, paddingVertical: 14 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  err: { fontSize: 12, color: C.bad, marginTop: 4 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginTop: 8 },
  flat: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.accBg, borderWidth: 1, borderColor: C.accBorder, borderRadius: 12, padding: 12 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12, marginTop: 6 },
  known: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.accBorder, borderRadius: 14, padding: 12, marginTop: 10 },
  face: { width: 60, height: 60, borderRadius: 16, backgroundColor: C.accBg },
  noFace: { alignItems: 'center', justifyContent: 'center' },
  went: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accBg, borderWidth: 1, borderColor: C.accBorder, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, minHeight: 40 },
  step: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.accBorder, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
