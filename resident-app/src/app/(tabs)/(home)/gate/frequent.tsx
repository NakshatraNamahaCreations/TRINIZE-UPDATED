import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, Switch, View } from 'react-native';
import { Chips, Label } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Icon, IconTile, Input, Meta, Pill, Screen, Sect, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { frequentList, ICON, removeFrequent, saveFrequent, type Frequent, type VisitorType } from '@/lib/gate';
import { formatPhone } from '@/store/auth';
import { C } from '@/theme';

const TYPES: Exclude<VisitorType, 'Emergency'>[] = ['Staff', 'Guest', 'Cab', 'Vendor', 'Delivery'];

/** People my flat sees often — the maid, the driver, a tutor. The guard finds them by phone number. */
export default function FrequentVisitors() {
  const { t, tx } = useT();
  const { toast } = useUI();
  const [list, setList] = useState<Frequent[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('Staff');
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const load = useCallback(() => { frequentList().then(setList).catch(fail); }, [fail]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (name.trim().length < 2) { toast(t('gate.new.needName'), 'alert-circle'); return; }
    if (!/^[6-9]\d{9}$/.test(phone)) { toast(t('gate.new.badPhone'), 'alert-circle'); return; }
    setBusy(true);
    try {
      await saveFrequent({ name: name.trim(), phone, visitorType: type, autoApprove: auto });
      setName(''); setPhone(''); setAdding(false);
      toast(t('gate.savedFrequent'), 'checkmark-circle');
      load();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const remove = (f: Frequent) => confirm(t('gate.fr.removeT', { name: f.name }), t('gate.fr.removeB'), t('gate.fr.remove'), t('common.cancel'),
    () => { removeFrequent(f.id).then(load).catch(fail); });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen header={<Header back="/gate" title={t('gate.frequent')} />}>
        <Meta style={{ marginHorizontal: 14, marginTop: 12 }}>{t('gate.fr.intro')}</Meta>
        {list !== null && !list.length && !adding && <EmptyState icon="people-outline" title={t('gate.fr.none')} body={t('gate.fr.noneB')} />}
        {(list ?? []).map((f, i) => (
          <Card key={f.id} delay={stagger(i)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <IconTile name={ICON[f.visitorType]} size={38} />
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 14 }}>{f.name}</Txt>
                <Meta>{tx('vtype', f.visitorType)} · {formatPhone(f.phone)}</Meta>
              </View>
              <Pressable onPress={() => remove(f)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('gate.fr.removeT', { name: f.name })}>
                <Icon name="trash-outline" size={19} color={C.ink3} />
              </Pressable>
            </View>
            <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
              <Pill tone={f.autoApprove ? 'good' : 'dim'}>{t(f.autoApprove ? 'gate.fr.auto' : 'gate.fr.ask')}</Pill>
            </View>
          </Card>
        ))}

        {adding ? (
          <View style={{ paddingHorizontal: 14 }}>
            <Sect title={t('gate.fr.add')} />
            <Label>{t('gate.new.name')}</Label>
            <Input value={name} onChangeText={setName} placeholder={t('gate.new.namePh')} maxLength={80} accessibilityLabel={t('gate.new.name')} />
            <Label>{t('gate.fr.phone')}</Label>
            <Input value={phone} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder={t('gate.new.phonePh')} accessibilityLabel={t('gate.fr.phone')} />
            <Label>{t('gate.new.who')}</Label>
            <Chips items={TYPES.map(k => [k, tx('vtype', k)] as const)} value={type} onChange={setType} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 13 }}>{t('gate.fr.autoT')}</Txt>
                <Meta>{t('gate.fr.autoB')}</Meta>
              </View>
              <Switch value={auto} onValueChange={setAuto} trackColor={{ true: C.acc, false: C.line }} accessibilityLabel={t('gate.fr.autoT')} />
            </View>
            <Btn full label={t('gate.fr.save')} onPress={add} disabled={busy} style={{ marginTop: 16 }} />
            <Btn full variant="ghost" label={t('common.cancel')} onPress={() => setAdding(false)} style={{ marginTop: 8 }} />
          </View>
        ) : <Btn icon="add" label={t('gate.fr.add')} onPress={() => setAdding(true)} style={{ marginHorizontal: 14, marginTop: 12 }} />}
      </Screen>
    </KeyboardAvoidingView>
  );
}
