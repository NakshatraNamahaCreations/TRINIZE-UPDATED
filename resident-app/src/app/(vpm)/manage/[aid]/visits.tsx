import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, Label } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Card, Icon, Input, Meta, Pill, Row, Sect, stagger, Txt } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ApiError } from '@/lib/api';
import { addDays, clock, dayMonth, hours, weekdayOf } from '@/lib/manager';
import { useFocusEffect } from '@/lib/refresh';
import { addSiteItem, removeSiteItem, savePlan, setDay, siteBoard, updateSiteItem, type SiteBoard, type SiteDay, type SiteItem } from '@/lib/vpm';
import { C } from '@/theme';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['Inspection', 'Meeting', 'Follow-up'] as const;
type Kind = (typeof KINDS)[number];

/** The property manager's on-site visits for one society: the regular slot, residents' requests, and each day's agenda. */
export default function VpmVisits() {
  const { aid, name } = useLocalSearchParams<{ aid: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [board, setBoard] = useState<SiteBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // the regular slot, as edited
  const [wd, setWd] = useState<string | null>(null);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  // answering a request
  const [answering, setAnswering] = useState<string | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [reply, setReply] = useState('');
  // adding to a day
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState('');
  const [kind, setKind] = useState<Kind>('Inspection');

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await siteBoard(aid);
      setBoard(b);
      if (b.plan) { setWd(String(b.plan.weekday)); setStart(b.plan.start); setEnd(b.plan.end); }
    } catch (e) { fail(e); } finally { setLoading(false); }
  }, [aid, fail]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) toast(done, 'checkmark-circle'); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const label = (d: string) => `${t(('vpm.dy.' + weekdayOf(d)) as Key)} ${dayMonth(d)}`;
  const timeOk = (v: string) => { if (v && !HHMM.test(v)) { toast(t('mgr.v.badTime'), 'alert-circle'); return false; } return true; };

  const plan = () => {
    if (wd === null || !timeOk(start) || !timeOk(end)) return;
    void run(() => savePlan(aid, { weekday: Number(wd), start, end }), t('mgr.v.planSaved'));
  };
  // only a day the form offers is prefilled — never a visit that has since been cancelled
  const answer = (r: SiteItem) => { setAnswering(r.id); setWhen(r.date && offered(r).includes(r.date) ? r.date : null); setTime(r.time ?? ''); setReply(''); };
  const schedule = (r: SiteItem) => {
    if (!timeOk(time.trim())) return;
    void run(async () => { await updateSiteItem(aid, r.id, { status: 'Scheduled', ...(when ? { date: when } : {}), ...(time.trim() ? { time: time.trim() } : {}), ...(reply.trim() ? { reply: reply.trim() } : {}) }); setAnswering(null); }, t('mgr.v.added'));
  };
  const decline = (r: SiteItem) => void run(async () => { await updateSiteItem(aid, r.id, { status: 'Declined', ...(reply.trim() ? { reply: reply.trim() } : {}) }); setAnswering(null); }, t('mgr.v.declined'));
  const add = (d: SiteDay) => {
    if (title.trim().length < 3) { toast(t('mgr.v.titleReq'), 'alert-circle'); return; }
    if (!timeOk(time.trim())) return;
    void run(async () => {
      await addSiteItem(aid, { date: d.date, title: title.trim(), location: where.trim(), kind, ...(time.trim() ? { time: time.trim() } : {}) });
      setAdding(null); setTitle(''); setWhere(''); setTime('');
    }, t('mgr.v.added'));
  };

  const today = board?.today ?? '';
  const planned = (board?.days ?? []).filter(d => d.status === 'Planned');
  // a request for a visit outside the schedule can go on any of the next two weeks' days
  const anyDay = today ? Array.from({ length: 14 }, (_, i) => addDays(today, i)) : [];
  const offered = (r: SiteItem) => (r.extra ? anyDay : planned.filter(d => d.date >= today).map(d => d.date));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 16 }} numberOfLines={1}>{t('mgr.v.title')}</Txt>
          {!!name && <Meta numberOfLines={1}>{name}</Meta>}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 + insets.bottom }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        <Sect title={t('mgr.v.plan')} />
        <Card>
          {!board?.plan && <Meta style={{ marginBottom: 6 }}>{t('mgr.v.planNone')}</Meta>}
          <Chips items={[0, 1, 2, 3, 4, 5, 6].map(d => [String(d), t(('vpm.dy.' + d) as Key)] as const)} value={wd} onChange={setWd} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Label>{t('mgr.v.from')}</Label><Input value={start} onChangeText={setStart} placeholder="09:00" maxLength={5} keyboardType="numbers-and-punctuation" /></View>
            <View style={{ flex: 1 }}><Label>{t('mgr.v.to')}</Label><Input value={end} onChangeText={setEnd} placeholder="12:00" maxLength={5} keyboardType="numbers-and-punctuation" /></View>
          </View>
          <Btn full icon="save-outline" label={t('mgr.v.savePlan')} disabled={busy || wd === null} onPress={plan} style={{ marginTop: 12 }} />
        </Card>

        {!!board?.requests.length && <Sect title={t('mgr.v.requests', { n: board.requests.length })} />}
        {(board?.requests ?? []).map((r, i) => (
          <Card key={r.id} delay={stagger(i)}>
            <Row>
              <Pill tone="warn">{tx('vpm.st', r.status)}</Pill>
              {r.extra && <Pill tone="acc">{t('mgr.v.outside')}</Pill>}
              {!!r.ref && <Txt w={700} style={{ fontSize: 12, color: C.ink3 }}>{r.ref}</Txt>}
            </Row>
            <Txt w={700} style={{ fontSize: 14, marginTop: 6 }}>{r.title}</Txt>
            <Meta style={{ marginTop: 2 }}>{[r.resident?.name, r.resident?.unit, r.date ? label(r.date) : null].filter(Boolean).join(' · ')}</Meta>
            {!!r.note && r.note !== r.title && <Meta style={{ marginTop: 4, color: C.ink2 }}>“{r.note}”</Meta>}
            {answering === r.id ? (
              <>
                <Label>{t('mgr.v.pickDay')}</Label>
                <Chips items={offered(r).map(d => [d, label(d)] as const)} value={when} onChange={setWhen} />
                <Label>{t('mgr.v.time')}</Label>
                <Input value={time} onChangeText={setTime} placeholder="10:15" maxLength={5} keyboardType="numbers-and-punctuation" />
                <Label>{t('mgr.v.reply')}</Label>
                <Input value={reply} onChangeText={setReply} maxLength={300} placeholder="" />
                <View style={s.two}>
                  <Btn icon="checkmark" label={t('mgr.v.schedule')} disabled={busy || !when} onPress={() => schedule(r)} style={{ flex: 1 }} />
                  <Btn variant="danger" label={t('mgr.v.decline')} disabled={busy} onPress={() => decline(r)} style={{ flex: 1 }} />
                </View>
                <Btn full variant="ghost" label={t('common.cancel')} onPress={() => setAnswering(null)} style={{ marginTop: 8 }} />
              </>
            ) : <Btn variant="soft" icon="calendar-outline" label={t('mgr.v.schedule')} onPress={() => answer(r)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
          </Card>
        ))}

        {board && !board.days.length && <Card><Meta>{t('mgr.v.noDays')}</Meta></Card>}
        {(board?.days ?? []).map(d => (
          <View key={d.date}>
            <Sect title={`${t(('vpm.day.' + weekdayOf(d.date)) as Key)} ${dayMonth(d.date)}${d.date === today ? ' · ' + t('vpm.today') : ''}`} />
            <Card>
              <Row>
                <Pill tone={d.status === 'Cancelled' ? 'bad' : d.status === 'Done' ? 'good' : 'acc'}>{d.status === 'Cancelled' ? t('vpm.cancelled') : d.status === 'Done' ? t('vpm.done') : hours(d.start, d.end)}</Pill>
              </Row>
              {!d.items.length && <Meta style={{ marginTop: 8 }}>{t('mgr.v.empty')}</Meta>}
              {d.items.map((i, idx) => (
                <View key={i.id} style={[s.item, idx > 0 && s.line]}>
                  <Txt w={700} style={s.time}>{i.time ? clock(i.time) : '—'}</Txt>
                  <View style={{ flex: 1 }}>
                    <Txt w={700} style={{ fontSize: 13.5, textDecorationLine: i.status === 'Done' ? 'line-through' : 'none' }}>{i.title}</Txt>
                    <Meta numberOfLines={2}>{[tx('vpm.kind', i.kind), i.ref, i.resident ? `${i.resident.name}${i.resident.unit ? ' (' + i.resident.unit + ')' : ''}` : null, i.location].filter(Boolean).join(' · ')}</Meta>
                    <View style={s.mini}>
                      <Pressable onPress={() => void run(() => updateSiteItem(aid, i.id, { status: i.status === 'Done' ? 'Scheduled' : 'Done' }))} hitSlop={6} accessibilityRole="button" style={s.miniBtn}>
                        <Icon name={i.status === 'Done' ? 'arrow-undo' : 'checkmark-done'} size={13} color={C.acc} /><Txt w={700} style={s.miniT}>{i.status === 'Done' ? t('mgr.v.undo') : t('mgr.v.markDone')}</Txt>
                      </Pressable>
                      <Pressable onPress={() => void run(() => removeSiteItem(aid, i.id))} hitSlop={6} accessibilityRole="button" style={s.miniBtn}>
                        <Icon name="trash-outline" size={13} color={C.bad} /><Txt w={700} style={[s.miniT, { color: C.bad }]}>{t('mgr.v.remove')}</Txt>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
              {adding === d.date ? (
                <>
                  <Label>{t('mgr.v.itemTitle')}</Label>
                  <Input value={title} onChangeText={setTitle} placeholder={t('mgr.v.itemTitlePh')} maxLength={120} />
                  <Label>{t('mgr.v.where')}</Label>
                  <Input value={where} onChangeText={setWhere} maxLength={120} placeholder="Tower 1" />
                  <Label>{t('mgr.v.kind')}</Label>
                  <Chips items={KINDS.map(k => [k, tx('vpm.kind', k)] as const)} value={kind} onChange={setKind} />
                  <Label>{t('mgr.v.time')}</Label>
                  <Input value={time} onChangeText={setTime} placeholder="09:30" maxLength={5} keyboardType="numbers-and-punctuation" />
                  <Btn full icon="add" label={t('mgr.v.add')} disabled={busy} onPress={() => add(d)} style={{ marginTop: 12 }} />
                  <Btn full variant="ghost" label={t('common.cancel')} onPress={() => setAdding(null)} style={{ marginTop: 8 }} />
                </>
              ) : (
                <View style={s.dayActs}>
                  {d.status === 'Planned' && <Btn variant="soft" icon="add" label={t('mgr.v.add')} onPress={() => { setAdding(d.date); setTitle(''); setWhere(''); setTime(''); }} />}
                  {d.status === 'Planned' && d.date <= today && <Btn variant="ghost" icon="checkmark-done" label={t('mgr.v.dayDone')} disabled={busy} onPress={() => void run(() => setDay(aid, d.date, { status: 'Done' }))} />}
                  {d.status === 'Planned'
                    ? <Btn variant="danger" label={t('mgr.v.cancelDay')} disabled={busy} onPress={() => void run(() => setDay(aid, d.date, { status: 'Cancelled' }), t('mgr.v.cancelled'))} />
                    : <Btn variant="ghost" label={t('mgr.v.restoreDay')} disabled={busy} onPress={() => void run(() => setDay(aid, d.date, { status: 'Planned', note: '' }))} />}
                </View>
              )}
            </Card>
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  two: { flexDirection: 'row', gap: 8, marginTop: 14 },
  item: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  line: { borderTopWidth: 1, borderTopColor: C.line },
  time: { width: 62, fontSize: 12, color: C.ink2, marginTop: 1 },
  mini: { flexDirection: 'row', gap: 14, marginTop: 6 },
  miniBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  miniT: { fontSize: 12, color: C.acc },
  dayActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
});
