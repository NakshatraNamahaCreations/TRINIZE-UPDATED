import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, View } from 'react-native';
import { Chips, Label } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Header, Icon, Input, Meta, Screen, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createPass, PARTNERS, type VisitorType } from '@/lib/gate';
import { C } from '@/theme';

type PassType = Exclude<VisitorType, 'Emergency'>;
const TYPES: PassType[] = ['Guest', 'Cab', 'Delivery', 'Vendor', 'Staff'];
type Window = 'today' | 'tomorrow' | 'week';

/** from now (or tomorrow morning) to the end of that day, or seven days out */
function windowOf(w: Window): [Date, Date] {
  const now = new Date(), end = new Date(now);
  end.setHours(23, 59, 0, 0);
  if (w === 'today') return [now, end];
  if (w === 'tomorrow') {
    const from = new Date(now); from.setDate(from.getDate() + 1); from.setHours(0, 0, 0, 0);
    const until = new Date(from); until.setHours(23, 59, 0, 0);
    return [from, until];
  }
  end.setDate(end.getDate() + 6);
  return [now, end];
}

/** Pre-approve someone: they get a pass that opens the gate without the guard having to ask. */
export default function NewPass() {
  const router = useRouter();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [type, setType] = useState<PassType>('Guest');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [people, setPeople] = useState(1);
  const [partner, setPartner] = useState<string | null>(null);
  const [win, setWin] = useState<Window>('today');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const delivery = type === 'Delivery';
  const who = delivery ? (name.trim() || partner || '') : name.trim();
  const phoneBad = phone.length > 0 && !/^[6-9]\d{9}$/.test(phone);
  const ok = who.length >= 2 && !phoneBad;

  const submit = async () => {
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    const [from, until] = windowOf(win);
    try {
      const v = await createPass({ visitorType: type, name: who, phone: phone || undefined, vehicle: vehicle.trim() || undefined, people, partner: delivery ? partner ?? undefined : undefined,
        validFrom: from.toISOString(), validUntil: until.toISOString() });
      router.replace(`/gate/${v.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen header={<Header back="/gate" title={t('gate.preapprove')} />}>
        <View style={{ paddingHorizontal: 14 }}>
          <Meta style={{ marginTop: 12 }}>{t('gate.new.intro')}</Meta>
          <Label>{t('gate.new.who')}</Label>
          <Chips items={TYPES.map(k => [k, tx('vtype', k)] as const)} value={type} onChange={setType} />

          {delivery && <>
            <Label>{t('gate.new.partner')}</Label>
            <Chips items={PARTNERS.map(p => [p, p] as const)} value={partner} onChange={setPartner} />
          </>}

          <Label>{delivery ? t('gate.new.nameOpt') : t('gate.new.name')}</Label>
          <Input value={name} onChangeText={setName} placeholder={delivery ? t('gate.new.namePhDelivery') : t('gate.new.namePh')} maxLength={80} accessibilityLabel={t('gate.new.name')} />
          {tried && who.length < 2 && <Txt style={{ fontSize: 12, color: C.bad, marginTop: 4 }}>{t(delivery ? 'gate.new.needPartner' : 'gate.new.needName')}</Txt>}

          <Label>{t('gate.new.phone')}</Label>
          <Input value={phone} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder={t('gate.new.phonePh')} accessibilityLabel={t('gate.new.phone')} />
          {tried && phoneBad && <Txt style={{ fontSize: 12, color: C.bad, marginTop: 4 }}>{t('gate.new.badPhone')}</Txt>}

          {!delivery && <>
            <Label>{t('gate.new.people')}</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable onPress={() => setPeople(n => Math.max(1, n - 1))} accessibilityLabel={t('gate.new.fewer')} hitSlop={8} style={stepBtn}><Icon name="remove" size={18} color={C.acc} /></Pressable>
              <Txt w={800} style={{ fontSize: 17, minWidth: 24, textAlign: 'center' }}>{people}</Txt>
              <Pressable onPress={() => setPeople(n => Math.min(20, n + 1))} accessibilityLabel={t('gate.new.more')} hitSlop={8} style={stepBtn}><Icon name="add" size={18} color={C.acc} /></Pressable>
            </View>
            <Label>{t('gate.new.vehicle')}</Label>
            <Input value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" placeholder="KA 01 AB 1234" maxLength={16} accessibilityLabel={t('gate.new.vehicle')} />
          </>}

          <Label>{t('gate.new.when')}</Label>
          <Chips items={[['today', t('gate.new.today')], ['tomorrow', t('gate.new.tomorrow')], ['week', t('gate.new.week')]] as const} value={win} onChange={setWin} />

          <Btn full icon="qr-code-outline" label={busy ? t('gate.new.making') : t('gate.new.make')} onPress={submit} disabled={busy} style={{ marginTop: 20 }} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const stepBtn = { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.accBorder, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' } as const;
