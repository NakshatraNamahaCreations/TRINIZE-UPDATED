import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Chips, Label } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Icon, IconTile, Input, Meta, Pill, Row, Screen, Sect, stagger, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ApiError } from '@/lib/api';
import { clock, dayMonth, hours, managerInfo, requestVisit, todayIst, weekdayOf, withdrawRequest, type ItemKind, type ManagerInfo, type MyRequest } from '@/lib/manager';
import { useFocusEffect } from '@/lib/refresh';
import { useStore } from '@/store/store';
import { C, GRAD } from '@/theme';

const KIND_ICON: Record<ItemKind, IconName> = { Inspection: 'search', Meeting: 'people', 'Follow-up': 'repeat', Request: 'home' };
const ST_TONE = { Requested: 'warn', Scheduled: 'acc', Done: 'good', Declined: 'dim' } as const;
const OPEN = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'On Hold'];

/** The property manager's weekly on-site visits: what is planned for each, and asking for something to be looked at. */
export default function Visits() {
  const { t, tx } = useT();
  const { toast } = useUI();
  const { state } = useStore();
  const [info, setInfo] = useState<ManagerInfo | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState<'visit' | 'extra' | null>(null);
  const [issue, setIssue] = useState<string>('none');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const load = useCallback(() => managerInfo().then(setInfo).catch(fail), [fail]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const dayName = (d: string) => t(('vpm.day.' + weekdayOf(d)) as Key);
  const visits = info?.visits ?? [];
  const day = visits.find(v => v.date === picked) ?? visits.find(v => v.status === 'Planned') ?? visits[0];
  // only my open requests that aren't on a visit already can be added
  const onVisit = new Set((info?.requests ?? []).filter(r => r.status === 'Requested' || r.status === 'Scheduled').map(r => r.ref));
  const mine = state.issues.filter(i => i.mine && OPEN.includes(i.status) && !onVisit.has(i.id)).slice(0, 6);

  const open = (kind: 'visit' | 'extra') => { setForm(kind); setIssue('none'); setNote(''); };
  const send = async () => {
    const chosen = mine.find(i => i.id === issue);
    if (!chosen && note.trim().length < 3) { toast(t('vpm.needNote'), 'alert-circle'); return; }
    setBusy(true);
    try {
      await requestVisit({ issueRef: chosen?.id, title: chosen?.title, note: note.trim(), extra: form === 'extra', date: form === 'visit' ? day?.date : undefined });
      setForm(null);
      toast(t('vpm.sent'), 'checkmark-circle');
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const withdraw = async (r: MyRequest) => {
    try { await withdrawRequest(r.id); toast(t('vpm.withdrawn'), 'checkmark'); await load(); } catch (e) { fail(e); }
  };

  if (info && !info.manager) {
    return <Screen header={<Header back="/" title={t('vpm.title')} />}><EmptyState icon="person-outline" title={t('vpm.none')} body={t('vpm.noneB')} /></Screen>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen header={<Header back="/" title={t('vpm.title')} />}>
        {info && (
          <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.plan}>
            <Txt w={700} style={{ color: '#E4DAFF', fontSize: 12.5 }}>{t('vpm.weekly')}</Txt>
            {info.plan ? (
              <>
                <Txt w={800} style={{ color: '#fff', fontSize: 18, marginTop: 4 }}>{t('vpm.every', { day: t(('vpm.day.' + info.plan.weekday) as Key) })}</Txt>
                <Txt w={600} style={{ color: '#fff', fontSize: 14, marginTop: 2 }}>{hours(info.plan.start, info.plan.end)}</Txt>
              </>
            ) : <Txt w={600} style={{ color: '#fff', fontSize: 14, marginTop: 4 }}>{t('vpm.noPlan')}</Txt>}
            {info.manager && <Txt style={{ color: '#E4DAFF', fontSize: 12.5, marginTop: 8 }}>{info.manager.name} · {info.manager.title}</Txt>}
          </LinearGradient>
        )}

        {visits.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
            {visits.map(v => {
              const on = v.date === day?.date, off = v.status === 'Cancelled';
              return (
                <Pressable key={v.date} onPress={() => { setPicked(v.date); setForm(null); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${dayName(v.date)} ${dayMonth(v.date)}`} style={[s.day, on && s.dayOn]}>
                  <Txt w={700} style={{ fontSize: 11.5, color: on ? '#E4DAFF' : C.ink3 }}>{t(('vpm.dy.' + weekdayOf(v.date)) as Key)}</Txt>
                  <Txt w={800} style={{ fontSize: 18, color: on ? '#fff' : off ? C.ink3 : C.ink, textDecorationLine: off ? 'line-through' : 'none' }}>{Number(v.date.slice(8, 10))}</Txt>
                  <Txt w={600} style={{ fontSize: 11, color: on ? '#E4DAFF' : C.ink3 }}>{dayMonth(v.date).split(' ')[1]}</Txt>
                  {v.date === todayIst() && <View style={[s.dot, on && { backgroundColor: '#fff' }]} />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {day && (
          <>
            <Sect title={t('vpm.agenda', { date: `${dayName(day.date)} ${dayMonth(day.date)}` })} />
            <Card>
              <Row>
                <Pill tone={day.status === 'Cancelled' ? 'bad' : day.status === 'Done' ? 'good' : 'acc'}>
                  {day.status === 'Cancelled' ? t('vpm.cancelled') : day.status === 'Done' ? t('vpm.done') : hours(day.start, day.end)}
                </Pill>
              </Row>
              {!!day.note && <Meta style={{ marginTop: 8 }}>{day.note}</Meta>}
              {!day.items.length && !day.others && <Meta style={{ marginTop: 10 }}>{t('vpm.nothing')}</Meta>}
              {day.items.map((i, idx) => (
                <View key={i.id} style={[s.item, idx > 0 && s.itemLine]}>
                  <Txt w={700} style={s.time}>{i.time ? clock(i.time) : '—'}</Txt>
                  <IconTile name={KIND_ICON[i.kind]} size={32} radius={10} bg={i.mine ? C.accBg : C.dimBg} fg={i.mine ? C.acc : C.ink2} />
                  <View style={{ flex: 1 }}>
                    <Txt w={700} style={{ fontSize: 13.5, textDecorationLine: i.status === 'Done' ? 'line-through' : 'none' }}>{i.title}</Txt>
                    <Meta numberOfLines={1}>{[i.mine ? t('vpm.yourItem') : tx('vpm.kind', i.kind), i.ref, i.location].filter(Boolean).join(' · ')}</Meta>
                  </View>
                  {i.status === 'Done' && <Icon name="checkmark-circle" size={18} color={C.good} />}
                </View>
              ))}
              {day.others > 0 && <Meta style={{ marginTop: 10 }}>{t('vpm.others', { n: day.others })}</Meta>}
              {day.status === 'Planned' && form !== 'visit' && (
                <Btn full icon="add-circle-outline" label={t('vpm.add')} onPress={() => open('visit')} style={{ marginTop: 12 }} />
              )}
            </Card>
          </>
        )}

        {form && (
          <Card>
            <Txt w={800} style={{ fontSize: 14.5 }}>{form === 'extra' ? t('vpm.formExtra') : t('vpm.formAdd', { date: day ? `${dayName(day.date)} ${dayMonth(day.date)}` : '' })}</Txt>
            {mine.length > 0 && <>
              <Label>{t('vpm.pick')}</Label>
              <Chips items={[['none', t('vpm.pickNone')] as const, ...mine.map(i => [i.id, `${i.id} · ${i.title}`] as const)]} value={issue} onChange={setIssue} />
            </>}
            <Label>{t('vpm.note')}</Label>
            <Input value={note} onChangeText={setNote} placeholder={t('vpm.notePh')} multiline maxLength={500} accessibilityLabel={t('vpm.note')} style={{ minHeight: 84, textAlignVertical: 'top', paddingTop: 12 }} />
            <Btn full icon="send" label={t('vpm.send')} disabled={busy} onPress={send} style={{ marginTop: 14 }} />
            <Btn full variant="ghost" label={t('common.cancel')} onPress={() => setForm(null)} style={{ marginTop: 8 }} />
          </Card>
        )}

        {info && form !== 'extra' && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <IconTile name="time-outline" size={38} radius={11} bg={C.warnBg} fg={C.warn} />
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 14 }}>{t('vpm.extraT')}</Txt>
                <Meta>{t('vpm.extraB')}</Meta>
              </View>
            </View>
            <Btn full variant="ghost" icon="calendar-outline" label={t('vpm.extraBtn')} onPress={() => open('extra')} style={{ marginTop: 12 }} />
          </Card>
        )}

        {!!info?.requests.length && <Sect title={t('vpm.mine')} />}
        {(info?.requests ?? []).map((r, i) => (
          <Card key={r.id} delay={stagger(i)}>
            <Row>
              <Pill tone={ST_TONE[r.status]}>{tx('vpm.st', r.status)}</Pill>
              {r.extra && <Pill tone="dim">{t('vpm.outside')}</Pill>}
              {!!r.ref && <Txt w={700} style={{ fontSize: 12, color: C.ink3 }}>{r.ref}</Txt>}
            </Row>
            <Txt w={700} style={{ fontSize: 13.5, marginTop: 6 }}>{r.title}</Txt>
            {!!r.date && r.status !== 'Declined' && <Meta style={{ marginTop: 3 }}>{r.time ? t('vpm.onAt', { date: `${dayName(r.date)} ${dayMonth(r.date)}`, time: clock(r.time) }) : t('vpm.on', { date: `${dayName(r.date)} ${dayMonth(r.date)}` })}</Meta>}
            {!!r.reply && <Meta style={{ marginTop: 3 }}>{t('vpm.reply', { name: info?.manager?.name ?? '', reply: r.reply })}</Meta>}
            {r.status === 'Requested' && <Btn variant="soft" label={t('vpm.withdraw')} onPress={() => withdraw(r)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
          </Card>
        ))}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  plan: { marginHorizontal: 14, marginTop: 12, borderRadius: 18, padding: 16 },
  strip: { gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  day: { width: 58, paddingVertical: 9, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, alignItems: 'center', gap: 1 },
  dayOn: { backgroundColor: C.acc, borderColor: C.acc },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.acc, marginTop: 3 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  itemLine: { borderTopWidth: 1, borderTopColor: C.line },
  time: { width: 62, fontSize: 12, color: C.ink2 },
});
