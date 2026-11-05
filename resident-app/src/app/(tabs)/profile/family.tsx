import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Chip } from '@/components/Sheets';
import { Btn, Card, FadeIn, Header, Icon, IconTile, initials, Input, Meta, Pill, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { formatPhone, useAuth } from '@/store/auth';
import { ME, RELATIONS, SOCIETY, type Member, type Relation } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

function AddMember({ onDone }: { onDone: () => void }) {
  const { t, tx } = useT();
  const { actions } = useStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [rel, setRel] = useState<Relation>('Spouse');
  const [tried, setTried] = useState(false);
  const nameOk = name.trim().length >= 2;
  const phoneOk = /^[6-9]\d{9}$/.test(phone);

  const save = () => {
    setTried(true);
    if (!nameOk || !phoneOk) return;
    actions.addMember({ name: name.trim(), rel, phone: formatPhone(phone) });
    onDone();
  };

  return (
    <FadeIn>
      <Card style={{ gap: 4 }}>
        <Txt w={700} style={{ fontSize: 13, marginBottom: 4 }}>{t('fam.add')}</Txt>
        <Meta style={s.label}>{t('fam.name')}</Meta>
        <Input value={name} onChangeText={setName} autoCapitalize="words" style={tried && !nameOk && s.bad} />
        {tried && !nameOk && <Meta style={s.err}>{t('fam.err.name')}</Meta>}
        <Meta style={s.label}>{t('fam.phone')}</Meta>
        <Input value={formatPhone(phone)} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" maxLength={11} placeholder="98765 43210" style={tried && !phoneOk && s.bad} />
        {tried && !phoneOk && <Meta style={s.err}>{t('fam.err.phone')}</Meta>}
        <Meta style={s.label}>{t('fam.relation')}</Meta>
        <View style={s.chips}>
          {RELATIONS.map(r => <Chip key={r} label={tx('rel', r)} on={rel === r} onPress={() => setRel(r)} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Btn icon="person-add-outline" label={t('fam.save')} onPress={save} style={{ flex: 1 }} />
          <Btn variant="ghost" label={t('common.cancel')} onPress={onDone} />
        </View>
      </Card>
    </FadeIn>
  );
}

export default function Family() {
  const { t, tx } = useT();
  const { phone } = useAuth();
  const { state, actions } = useStore();
  const [adding, setAdding] = useState(false);

  const remove = (m: Member) => Alert.alert(t('fam.removeT'), t('fam.removeB', { name: m.name, unit: ME.unit }), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('fam.removeOk'), style: 'destructive', onPress: () => actions.removeMember(m.id) },
  ]);

  return (
    <Screen header={<Header title={t('profile.family')} back="/profile" />}>
      <Card style={s.unit}>
        <IconTile name="business" size={46} radius={14} bg="rgba(255,255,255,.2)" fg="#fff" />
        <View style={{ flex: 1 }}>
          <Meta style={{ color: 'rgba(255,255,255,.8)' }}>{t('fam.unit')}</Meta>
          <Txt w={800} style={{ fontSize: 16, color: '#fff' }}>{ME.flat}</Txt>
          <Txt style={{ fontSize: 11.5, color: 'rgba(255,255,255,.85)' }}>{ME.unit} · {SOCIETY.name}</Txt>
        </View>
      </Card>

      <Sect title={t('fam.members', { n: state.family.length })} />
      <Card delay={60} style={{ paddingVertical: 4 }}>
        {state.family.map((m, i) => (
          <View key={m.id} style={[s.row, i === state.family.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={s.av}><Txt w={800} style={{ color: C.acc, fontSize: 13 }}>{initials(m.name)}</Txt></View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Txt w={700} style={{ fontSize: 12.5 }}>{m.name}</Txt>
                {m.you && <Pill tone="acc">{t('common.you')}</Pill>}
              </View>
              <Meta>{tx('rel', m.rel)} · {m.you ? (phone ? '+91 ' + formatPhone(phone) : '—') : '+91 ' + m.phone}</Meta>
              {m.pending && <Pill tone="warn">{t('fam.pending')}</Pill>}
            </View>
            {!m.you && (
              <Pressable onPress={() => remove(m)} hitSlop={8} accessibilityLabel={t('fam.remove', { name: m.name })} style={s.del}>
                <Icon name="trash-outline" size={16} color={C.bad} />
              </Pressable>
            )}
          </View>
        ))}
      </Card>

      {adding
        ? <AddMember onDone={() => setAdding(false)} />
        : <Btn full variant="ghost" icon="person-add-outline" label={t('fam.add')} onPress={() => setAdding(true)} />}
      <Meta style={{ paddingHorizontal: 18, paddingTop: 6, textAlign: 'center' }}>{t('fam.note')}</Meta>
    </Screen>
  );
}

const s = StyleSheet.create({
  unit: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.acc, borderColor: C.acc },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  av: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.accBg, alignItems: 'center', justifyContent: 'center' },
  del: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.badBg, alignItems: 'center', justifyContent: 'center' },
  label: { color: C.ink2, marginTop: 6 },
  err: { color: C.bad },
  bad: { borderColor: C.bad },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
});
