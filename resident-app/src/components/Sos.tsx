import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Card, Icon, Input, Meta, Pill, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { emergency, KIND_ICON, KINDS, raiseSos, respond, type Emergency, type Kind } from '@/lib/emergency';
import { C } from '@/theme';

/**
 * The emergency panel, shared by the resident's Emergency screen and the guard's gate:
 * open alerts (a guard can say "on it"), the SOS buttons, and the numbers to call.
 */
export function Sos({ guard = false }: { guard?: boolean }) {
  const focused = useIsFocused();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [e, setE] = useState<Emergency | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { emergency().then(setE).catch(() => {}); }, []);
  // an alert must show quickly: re-read while the screen is up
  useEffect(() => {
    if (!focused) return;
    load();
    const h = setInterval(load, guard ? 6000 : 10000);
    return () => clearInterval(h);
  }, [focused, load, guard]);

  const fail = (err: unknown) => toast(err instanceof ApiError ? err.message : t('live.failed'), 'alert-circle');
  const raise = (kind: Kind) => confirm(t('sos.confirmT', { kind: tx('sos.k', kind) }), t('sos.confirmB'), t('sos.send'), t('common.cancel'), async () => {
    setBusy(true);
    try { await raiseSos(kind, note.trim()); setNote(''); toast(t('sos.sent'), 'checkmark-circle'); load(); } catch (err) { fail(err); }
    setBusy(false);
  });
  const onIt = async (id: string) => { try { await respond(id); toast(t('sos.onItDone'), 'checkmark-circle'); load(); } catch (err) { fail(err); } };

  const open = e?.open ?? [];
  return (
    <>
      {open.map(i => (
        <Card key={i.id} style={{ borderColor: C.bad, borderWidth: 1.5, backgroundColor: C.badBg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name={KIND_ICON[i.kind]} size={22} color={C.bad} />
            <View style={{ flex: 1 }}>
              <Txt w={800} style={{ fontSize: 14.5, color: C.bad }}>{tx('sos.k', i.kind)} · {i.place}</Txt>
              <Meta>{i.by}{i.note ? ' · ' + i.note : ''}</Meta>
            </View>
            <Pill tone={i.status === 'Open' ? 'bad' : 'warn'}>{t(i.status === 'Open' ? 'sos.waiting' : 'sos.responding')}</Pill>
          </View>
          {i.status !== 'Open' && !!i.ackByName && <Meta style={{ marginTop: 6 }}>{t('sos.ackBy', { name: i.ackByName })}</Meta>}
          {guard && i.status === 'Open' && <Btn full icon="walk-outline" label={t('sos.onIt')} onPress={() => onIt(i.id)} style={{ marginTop: 10 }} />}
        </Card>
      ))}

      <Sect title={t('sos.raise')} />
      <View style={{ paddingHorizontal: 14 }}>
        <Input value={note} onChangeText={setNote} placeholder={t('sos.notePh')} maxLength={300} accessibilityLabel={t('sos.notePh')} />
        <View style={s.grid}>
          {KINDS.map(k => (
            <Pressable key={k} onPress={() => raise(k)} disabled={busy} accessibilityRole="button" accessibilityLabel={tx('sos.k', k)} style={({ pressed }) => [s.kind, pressed && { opacity: 0.8 }]}>
              <Icon name={KIND_ICON[k]} size={24} color="#fff" />
              <Txt w={800} style={{ color: '#fff', fontSize: 13, marginTop: 4 }}>{tx('sos.k', k)}</Txt>
            </Pressable>
          ))}
        </View>
        <Meta style={{ marginTop: 8 }}>{t('sos.who')}</Meta>
      </View>

      {!!e?.contacts.length && <Sect title={t('sos.numbers')} />}
      {(e?.contacts ?? []).map(c => (
        <Card key={c.name + c.phone} onPress={() => Linking.openURL('tel:' + c.phone.replace(/[^\d+]/g, ''))}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="call" size={18} color={C.good} />
            <View style={{ flex: 1 }}><Txt w={700} style={{ fontSize: 14 }}>{c.name}</Txt><Meta>{c.role}</Meta></View>
            <Txt w={700} style={{ fontSize: 13.5, color: C.acc }}>{c.phone}</Txt>
          </View>
        </Card>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  kind: { flexBasis: '30%', flexGrow: 1, backgroundColor: C.bad, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
});
