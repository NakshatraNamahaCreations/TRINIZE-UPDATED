import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Btn, Icon, IconTile, Input, Meta, Pill, Txt, type IconName } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { clock, dayMonth, weekdayOf } from '@/lib/manager';
import { useFocusEffect } from '@/lib/refresh';
import {
  addMyNote, addVendor, askAssistant, broadcast, draftNotice, notes as loadNotes, opsStats, removeNote, setNote, siteBoard, tickets,
  type AiCard, type Note, type OpsStats, type SiteBoard, type Ticket,
} from '@/lib/vpm';
import { C } from '@/theme';

const OPEN = '#5B3FE0', PROGRESS = '#3B6EF0', VENDOR = '#C77B0B', DONE = '#12A36B';
const PRI = { Emergency: 'bad', High: 'bad', Medium: 'warn', Low: 'dim' } as const;
const STATUS = (s: Ticket['status']) => (s === 'Resolved' || s === 'Closed' ? 'good' : s === 'Submitted' ? 'acc' : s === 'Assigned' ? 'warn' : 'dim');
type Section = 'ops' | 'board' | 'tickets' | 'notes';
type Ai = { kind: 'answer'; text: string; cards: AiCard[] } | { kind: 'draft'; title: string; body: string };

/** One titled block of the dashboard; shows its own error instead of leaving the screen empty. */
function Panel({ title, icon, action, onAction, error, children }: { title: string; icon: IconName; action?: string; onAction?: () => void; error?: string; children: ReactNode }) {
  return (
    <View style={s.panel}>
      <View style={s.ph}>
        <IconTile name={icon} size={30} radius={9} />
        <Txt w={800} style={{ fontSize: 14.5, flex: 1 }}>{title}</Txt>
        {!!action && <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button"><Txt w={700} style={{ fontSize: 12.5, color: C.acc }}>{action}</Txt></Pressable>}
      </View>
      {error ? <Meta>{error}</Meta> : children}
    </View>
  );
}

/** A horizontal bar for one value against the largest. */
const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => (
  <View style={s.track}><View style={[s.fill, { width: `${max ? Math.max(4, (value / max) * 100) : 0}%`, backgroundColor: color }]} /></View>
);

/**
 * The property manager's dashboard for one society: the numbers, the assistant, quick actions, the
 * on-site plan, where requests stand, the week's trend, recent requests, categories, vendors, residents'
 * ratings and their own notes. Each part loads on its own.
 */
export default function VpmDashboard() {
  const { aid, name } = useLocalSearchParams<{ aid: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [ops, setOps] = useState<OpsStats | null>(null);
  const [board, setBoard] = useState<SiteBoard | null>(null);
  const [list, setList] = useState<Ticket[] | null>(null);
  const [mine, setMine] = useState<Note[] | null>(null);
  const [errs, setErrs] = useState<Partial<Record<Section, string>>>({});
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState<Ai | null>(null);
  const [aiErr, setAiErr] = useState('');
  const [thinking, setThinking] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState(false);
  // broadcast: a message to every resident on the channels chosen
  const [castForm, setCastForm] = useState(false);
  const [castTitle, setCastTitle] = useState('');
  const [castBody, setCastBody] = useState('');
  const [castOn, setCastOn] = useState<Record<'portal' | 'push' | 'email', boolean>>({ portal: true, push: true, email: false });
  const [castImportant, setCastImportant] = useState(false);
  const [vName, setVName] = useState('');
  const [vCat, setVCat] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [note, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const msg = useCallback((e: unknown) => (e instanceof ApiError ? e.message : t('live.failed')), [t]);
  const fail = useCallback((e: unknown) => toast(msg(e), 'alert-circle'), [toast, msg]);
  const load = useCallback(async () => {
    setLoading(true);
    const part = <T,>(key: Section, p: Promise<T>, set: (v: T) => void) =>
      p.then(v => { set(v); setErrs(e => ({ ...e, [key]: undefined })); }).catch(e => setErrs(x => ({ ...x, [key]: msg(e) })));
    await Promise.all([
      part('ops', opsStats(aid), setOps), part('board', siteBoard(aid), setBoard),
      part('tickets', tickets(aid), setList), part('notes', loadNotes(aid), setMine),
    ]);
    setLoading(false);
  }, [aid, msg]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /* ---------- the assistant ---------- */
  const ask = async (key: string, run: () => Promise<Ai>) => {
    setThinking(key); setAiErr('');
    try { setAi(await run()); } catch (e) { setAi(null); setAiErr(msg(e)); } finally { setThinking(null); }
  };
  const summarise = () => ask('sum', async () => { const r = await askAssistant(aid, 'Which complaints are pending?'); return { kind: 'answer', text: r.text, cards: r.cards }; });
  const priorities = () => ask('pri', async () => { const r = await askAssistant(aid, 'Which work order is overdue?'); return { kind: 'answer', text: r.text, cards: r.cards }; });
  const draft = () => ask('draft', async () => { const r = await draftNotice(aid, ''); return { kind: 'draft', ...r }; });
  const postDraft = (d: { title: string; body: string }) => router.push({ pathname: '/manage/[aid]/notice', params: { aid, name: name ?? '', title: d.title, body: d.body } });

  /* ---------- quick actions ---------- */
  const exportReport = async () => {
    if (!list) return;
    const q = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [['Ref', 'Title', 'Category', 'Priority', 'Status', 'Flat', 'Vendor', 'Raised'], ...list.map(i => [i.ref, i.title, i.category, i.priority, i.status, i.unit ?? (i.scope === 'common' ? 'Common area' : ''), i.vendor ?? '', i.createdAt.slice(0, 10)])]
      .map(r => r.map(q).join(',')).join('\n');
    await Share.share({ title: t('dash.reportTitle', { name: name ?? '' }), message: csv }).catch(() => {});
  };
  const saveVendor = async () => {
    if (vName.trim().length < 2 || vCat.trim().length < 2) { toast(t('dash.vendorReq'), 'alert-circle'); return; }
    setBusy(true);
    try {
      await addVendor(aid, { name: vName.trim(), category: vCat.trim(), phone: vPhone.trim() });
      setVendorForm(false); setVName(''); setVCat(''); setVPhone('');
      toast(t('dash.vendorAdded'), 'checkmark-circle');
      void load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const sendCast = () => {
    const channels = (['portal', 'push', 'email'] as const).filter(c => castOn[c]);
    if (castTitle.trim().length < 3 || castBody.trim().length < 3) { toast(t('mgr.noticeReq'), 'alert-circle'); return; }
    if (!channels.length) { toast(t('dash.castNoChannel'), 'alert-circle'); return; }
    // it goes to every resident at once, so it is confirmed first
    confirm(t('dash.castConfirmT'), t('dash.castConfirmB', { channels: channels.map(c => t(('dash.ch.' + c) as Key)).join(', ') }), t('dash.castSend'), t('common.cancel'), async () => {
      setBusy(true);
      try {
        const r = await broadcast(aid, { title: castTitle.trim(), body: castBody.trim(), channels, important: castImportant });
        setCastForm(false); setCastTitle(''); setCastBody(''); setCastImportant(false);
        // what actually happened, not a blanket "sent"
        toast(r.stats.failed ? t('dash.castDoneFailed', { ref: r.ref, n: r.stats.recipients, failed: r.stats.failed }) : t('dash.castDone', { ref: r.ref, n: r.stats.recipients }), r.stats.failed ? 'alert-circle' : 'checkmark-circle');
      } catch (e) { fail(e); } finally { setBusy(false); }
    }, { tone: 'primary', icon: 'radio-outline' });
  };

  /* ---------- notes ---------- */
  const addNote = async () => {
    if (!note.trim()) return;
    try { const n = await addMyNote(aid, note.trim()); setMine(m => [n, ...(m ?? [])]); setNoteText(''); } catch (e) { fail(e); }
  };
  const toggle = async (n: Note) => { try { const u = await setNote(aid, n.id, !n.done); setMine(m => (m ?? []).map(x => (x.id === u.id ? u : x))); } catch (e) { fail(e); } };
  const drop = async (n: Note) => { try { await removeNote(aid, n.id); setMine(m => (m ?? []).filter(x => x.id !== n.id)); } catch (e) { fail(e); } };

  const dur = (h: number) => (h >= 24 ? t('dash.days', { n: (h / 24).toFixed(1) }) : t('dash.hrs', { n: h.toFixed(1) }));
  const b = ops?.buckets;
  const overview = b ? [
    { label: t('dash.open'), n: b.open, color: OPEN }, { label: t('dash.inProgress'), n: b.inProgress, color: PROGRESS },
    { label: t('dash.pendingVendor'), n: b.pendingVendor, color: VENDOR }, { label: t('dash.resolved30'), n: b.resolved, color: DONE },
  ] : [];
  const overviewTotal = overview.reduce((a, o) => a + o.n, 0);
  const week = ops?.totals, change = week && week.prevWeek ? Math.round(((week.week - week.prevWeek) / week.prevWeek) * 100) : null;
  const faster = ops?.resolution.hours != null && ops.resolution.prevHours != null ? ops.resolution.prevHours - ops.resolution.hours : null;
  const next = board?.days.find(d => d.status === 'Planned' && d.date >= board.today);
  const recent = [...(list ?? [])].sort((a, c) => c.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const tMax = Math.max(1, ...(ops?.timeline ?? []).flatMap(d => [d.created, d.resolved]));
  const cMax = Math.max(1, ...(ops?.categories ?? []).map(c => c.n));
  const sat = ops?.satisfaction, sMax = Math.max(1, ...(sat?.dist ?? []).map(d => d.n));
  const stars = (n: number) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

  const kpis: { label: string; value: string; sub: string; icon: IconName; fg: string; bg: string; tone?: 'up' | 'down' }[] = ops ? [
    { label: t('dash.total'), value: String(ops.totals.all), sub: change === null ? t('dash.thisWeek', { n: ops.totals.week }) : t('dash.vsWeek', { n: ops.totals.week, pct: (change > 0 ? '+' : '') + change }), icon: 'file-tray-full', fg: OPEN, bg: C.accBg },
    { label: t('dash.open'), value: String(b!.open), sub: t('dash.openS'), icon: 'mail-unread', fg: '#B42318', bg: '#FDE9E7' },
    { label: t('dash.inProgress'), value: String(b!.inProgress), sub: t('dash.pendingVendorN', { n: b!.pendingVendor }), icon: 'construct', fg: PROGRESS, bg: '#E3ECFE' },
    { label: t('dash.resolved'), value: String(b!.resolved), sub: t('dash.last30'), icon: 'checkmark-done', fg: DONE, bg: C.goodBg },
    { label: t('dash.avgRes'), value: ops.resolution.hours != null ? dur(ops.resolution.hours) : '—', sub: faster === null ? t('dash.last30') : t(faster >= 0 ? 'dash.faster' : 'dash.slower', { d: dur(Math.abs(faster)) }), icon: 'time', fg: '#0369A1', bg: '#E3F3FC', tone: faster === null ? undefined : faster >= 0 ? 'up' : 'down' },
    { label: t('dash.sat'), value: sat?.avg != null ? `${sat.avg} / 5` : '—', sub: sat?.count ? t('dash.ratings', { n: sat.count }) : t('dash.noRatings'), icon: 'star', fg: '#B54708', bg: C.warnBg },
  ] : [];
  const quick: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: 'megaphone-outline', label: t('dash.qNotice'), onPress: () => router.push({ pathname: '/manage/[aid]/notice', params: { aid, name: name ?? '' } }) },
    { icon: 'radio-outline', label: t('dash.qBroadcast'), onPress: () => { setCastForm(v => !v); setVendorForm(false); } },
    { icon: 'download-outline', label: t('dash.qExport'), onPress: () => void exportReport() },
    { icon: 'person-add-outline', label: t('dash.qVendor'), onPress: () => { setVendorForm(v => !v); setCastForm(false); } },
    { icon: 'calendar-outline', label: t('dash.qVisit'), onPress: () => router.push({ pathname: '/manage/[aid]/visits', params: { aid, name: name ?? '' } }) },
    { icon: 'list-outline', label: t('dash.qRequests'), onPress: () => router.push({ pathname: '/manage/[aid]', params: { aid, name: name ?? '' } }) },
    { icon: 'chatbubbles-outline', label: t('dash.qMessages'), onPress: () => router.push({ pathname: '/manage/[aid]/messages', params: { aid, name: name ?? '' } }) },
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 16 }} numberOfLines={1}>{name ?? t('mgr.society')}</Txt>
          <Meta>{t('dash.title')}</Meta>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 + insets.bottom }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        {/* the numbers */}
        {errs.ops ? <View style={s.panel}><Meta>{errs.ops}</Meta></View> : (
          <View style={s.kpis}>
            {kpis.map(k => (
              <View key={k.label} style={s.kpi}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Txt w={700} style={{ fontSize: 12, color: C.ink2, flex: 1 }} numberOfLines={1}>{k.label}</Txt>
                  <View style={[s.kIc, { backgroundColor: k.bg }]}><Icon name={k.icon} size={15} color={k.fg} /></View>
                </View>
                <Txt w={800} style={{ fontSize: 22, marginTop: 4 }} numberOfLines={1}>{k.value}</Txt>
                {k.label === t('dash.sat') && sat?.avg != null && <Txt style={{ color: '#E3A008', fontSize: 13, letterSpacing: 1 }}>{stars(sat.avg)}</Txt>}
                <Txt style={{ fontSize: 11, marginTop: 2, color: k.tone === 'up' ? C.good : k.tone === 'down' ? C.bad : C.ink3 }} numberOfLines={2}>{k.sub}</Txt>
              </View>
            ))}
          </View>
        )}

        {/* the assistant */}
        <LinearGradient colors={['#F4EFFF', '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.panel, { borderColor: '#E4DAFB' }]}>
          <View style={s.ph}>
            <IconTile name="sparkles" size={30} radius={9} bg={C.aiBg} fg={C.ai} />
            <View style={{ flex: 1 }}>
              <Txt w={800} style={{ fontSize: 14.5 }}>{t('dash.ai')}</Txt>
              <Meta>{t('dash.aiS')}</Meta>
            </View>
          </View>
          <View style={s.chips}>
            {([['sum', 'dash.aiSum', summarise], ['draft', 'dash.aiDraft', draft], ['pri', 'dash.aiPri', priorities]] as const).map(([k, l, fn]) => (
              <Pressable key={k} onPress={fn} disabled={!!thinking} accessibilityRole="button" style={({ pressed }) => [s.chip, k === 'sum' && s.chipOn, (pressed || thinking === k) && { opacity: 0.7 }]}>
                <Txt w={700} style={{ fontSize: 12.5, color: k === 'sum' ? '#fff' : C.acc }}>{thinking === k ? t('dash.thinking') : t(l as Key)}</Txt>
              </Pressable>
            ))}
          </View>
          {!!aiErr && <Meta style={{ marginTop: 10, color: C.bad }}>{aiErr}</Meta>}
          {ai?.kind === 'answer' && (
            <View style={s.aiOut}>
              <Txt style={{ fontSize: 13, lineHeight: 19 }}>{ai.text}</Txt>
              {ai.cards.slice(0, 1).map(c => (
                <View key={c.key} style={{ marginTop: 8 }}>
                  <Txt w={700} style={{ fontSize: 12.5 }}>{c.title} · <Txt style={{ fontSize: 12.5, color: C.ink2 }}>{c.headline}</Txt></Txt>
                  {c.rows.slice(0, 5).map((r, i) => <Meta key={i} numberOfLines={1} style={{ marginTop: 3 }}>• {r.slice(0, 3).join(' · ')}</Meta>)}
                </View>
              ))}
              <Meta style={{ marginTop: 8, fontSize: 11 }}>{t('dash.aiNote')}</Meta>
            </View>
          )}
          {ai?.kind === 'draft' && (
            <View style={s.aiOut}>
              <Txt w={800} style={{ fontSize: 13.5 }}>{ai.title}</Txt>
              <Txt style={{ fontSize: 13, lineHeight: 19, marginTop: 4 }} numberOfLines={8}>{ai.body}</Txt>
              <Btn icon="megaphone-outline" label={t('dash.useDraft')} onPress={() => postDraft(ai)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
            </View>
          )}
        </LinearGradient>

        {/* quick actions */}
        <View style={s.panel}>
          <Txt w={800} style={{ fontSize: 14.5, marginBottom: 10 }}>{t('dash.quick')}</Txt>
          <View style={s.quick}>
            {quick.map(q => (
              <Pressable key={q.label} onPress={q.onPress} accessibilityRole="button" style={({ pressed }) => [s.q, pressed && { opacity: 0.8 }]}>
                <IconTile name={q.icon} size={34} radius={10} />
                <Txt w={700} style={{ fontSize: 11.5, color: C.ink2, textAlign: 'center' }} numberOfLines={2}>{q.label}</Txt>
              </Pressable>
            ))}
          </View>
          {castForm && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Txt w={800} style={{ fontSize: 13.5 }}>{t('dash.castT')}</Txt>
              <Meta>{t('dash.castS')}</Meta>
              <Input value={castTitle} onChangeText={setCastTitle} placeholder={t('dash.castTitle')} maxLength={120} accessibilityLabel={t('dash.castTitle')} />
              <Input value={castBody} onChangeText={setCastBody} placeholder={t('dash.castBody')} maxLength={4000} multiline style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }} accessibilityLabel={t('dash.castBody')} />
              <View style={s.chips}>
                {(['portal', 'push', 'email'] as const).map(c => (
                  <Pressable key={c} onPress={() => setCastOn(o => ({ ...o, [c]: !o[c] }))} accessibilityRole="checkbox" accessibilityState={{ checked: castOn[c] }} style={[s.chip, castOn[c] && s.chipOn]}>
                    <Txt w={700} style={{ fontSize: 12.5, color: castOn[c] ? '#fff' : C.acc }}>{t(('dash.ch.' + c) as Key)}</Txt>
                  </Pressable>
                ))}
                <Pressable onPress={() => setCastImportant(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: castImportant }} style={[s.chip, castImportant && { backgroundColor: C.warn, borderColor: C.warn }]}>
                  <Txt w={700} style={{ fontSize: 12.5, color: castImportant ? '#fff' : C.warn }}>{t('dash.castImportant')}</Txt>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn icon="send" label={t('dash.castSend')} disabled={busy} onPress={sendCast} style={{ flex: 1 }} />
                <Btn variant="ghost" label={t('common.cancel')} onPress={() => setCastForm(false)} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          {vendorForm && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Input value={vName} onChangeText={setVName} placeholder={t('dash.vName')} maxLength={80} accessibilityLabel={t('dash.vName')} />
              <Input value={vCat} onChangeText={setVCat} placeholder={t('dash.vCat')} maxLength={40} accessibilityLabel={t('dash.vCat')} />
              <Input value={vPhone} onChangeText={setVPhone} placeholder={t('dash.vPhone')} maxLength={20} keyboardType="phone-pad" accessibilityLabel={t('dash.vPhone')} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn icon="checkmark" label={t('dash.vSave')} disabled={busy} onPress={saveVendor} style={{ flex: 1 }} />
                <Btn variant="ghost" label={t('common.cancel')} onPress={() => setVendorForm(false)} style={{ flex: 1 }} />
              </View>
            </View>
          )}
        </View>

        {/* the on-site plan */}
        <Panel title={t('dash.plan')} icon="calendar" error={errs.board}
          action={t('dash.fullSchedule')} onAction={() => router.push({ pathname: '/manage/[aid]/visits', params: { aid, name: name ?? '' } })}>
          {next ? <>
            <Meta style={{ marginBottom: 6 }}>{t(('vpm.day.' + weekdayOf(next.date)) as Key)} {dayMonth(next.date)} · {clock(next.start)} – {clock(next.end)}</Meta>
            {!next.items.length && <Meta>{t('mgr.v.empty')}</Meta>}
            {next.items.map((i, idx) => (
              <View key={i.id} style={[s.row, idx > 0 && s.line]}>
                <Txt w={700} style={{ width: 64, fontSize: 12, color: C.ink2 }}>{i.time ? clock(i.time) : '—'}</Txt>
                <View style={{ flex: 1 }}>
                  <Txt w={700} style={{ fontSize: 13 }} numberOfLines={1}>{i.title}</Txt>
                  <Meta numberOfLines={1}>{[tx('vpm.kind', i.kind), i.location].filter(Boolean).join(' · ')}</Meta>
                </View>
                <Pill tone={i.status === 'Done' ? 'good' : 'acc'}>{tx('vpm.st', i.status)}</Pill>
              </View>
            ))}
          </> : board && <Meta>{board.plan ? t('dash.noVisitSoon') : t('mgr.v.planNone')}</Meta>}
          {!!board?.requests.length && <Meta style={{ marginTop: 8, color: C.warn }}>{t('mgr.visitReqN', { n: board.requests.length })}</Meta>}
        </Panel>

        {/* where requests stand */}
        {ops && <Panel title={t('dash.overview')} icon="pie-chart">
          <View style={s.stack}>
            {overviewTotal > 0 && overview.filter(o => o.n).map(o => <View key={o.label} style={{ flex: o.n, backgroundColor: o.color }} />)}
          </View>
          {overview.map(o => (
            <View key={o.label} style={s.legend}>
              <View style={[s.dot, { backgroundColor: o.color }]} />
              <Txt style={{ flex: 1, fontSize: 13, color: C.ink2 }}>{o.label}</Txt>
              <Txt w={800} style={{ fontSize: 13 }}>{o.n}</Txt>
              <Txt style={{ width: 44, textAlign: 'right', fontSize: 12, color: C.ink3 }}>{overviewTotal ? Math.round((o.n / overviewTotal) * 100) : 0}%</Txt>
            </View>
          ))}
        </Panel>}

        {/* the week */}
        {ops && <Panel title={t('dash.timeline')} icon="trending-up">
          <View style={s.chart}>
            {ops.timeline.map(d => (
              <View key={d.date} style={s.col} accessible accessibilityLabel={t('dash.dayA11y', { date: dayMonth(d.date), c: d.created, r: d.resolved })}>
                <View style={s.colBars}>
                  <View style={[s.vbar, { height: `${(d.created / tMax) * 100}%`, backgroundColor: OPEN }]} />
                  <View style={[s.vbar, { height: `${(d.resolved / tMax) * 100}%`, backgroundColor: DONE }]} />
                </View>
                <Txt style={{ fontSize: 10.5, color: C.ink3, marginTop: 4 }}>{Number(d.date.slice(8, 10))}</Txt>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
            <View style={s.legendI}><View style={[s.dot, { backgroundColor: OPEN }]} /><Meta>{t('dash.created')}</Meta></View>
            <View style={s.legendI}><View style={[s.dot, { backgroundColor: DONE }]} /><Meta>{t('dash.resolvedL')}</Meta></View>
          </View>
        </Panel>}

        {/* recent requests */}
        <Panel title={t('dash.recent')} icon="list" error={errs.tickets} action={t('dash.viewAll')} onAction={() => router.push({ pathname: '/manage/[aid]', params: { aid, name: name ?? '' } })}>
          {list && !recent.length && <Meta>{t('mgr.noActive')}</Meta>}
          {recent.map((i, idx) => (
            <Pressable key={i.ref} onPress={() => router.push({ pathname: '/manage/[aid]/[ref]', params: { aid, ref: i.ref } })} style={[s.row, idx > 0 && s.line]} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 13 }} numberOfLines={1}>{i.title}</Txt>
                <Meta numberOfLines={1}>{i.ref} · {tx('cat', i.category)} · {i.reporter ?? (i.scope === 'common' ? t('mgr.common') : '')}</Meta>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Pill tone={STATUS(i.status)}>{tx('status', i.status)}</Pill>
                <Txt w={700} style={{ fontSize: 11, color: PRI[i.priority] === 'bad' ? C.bad : PRI[i.priority] === 'warn' ? C.warn : C.ink3 }}>{tx('pri', i.priority)}</Txt>
              </View>
            </Pressable>
          ))}
        </Panel>

        {/* categories */}
        {ops && <Panel title={t('dash.categories')} icon="bar-chart">
          {!ops.categories.length && <Meta>{t('dash.none30')}</Meta>}
          {ops.categories.map(c => (
            <View key={c.category} style={s.barRow}>
              <Txt style={{ width: 92, fontSize: 12, color: C.ink2 }} numberOfLines={1}>{tx('cat', c.category)}</Txt>
              <Bar value={c.n} max={cMax} color={OPEN} />
              <Txt w={800} style={{ width: 26, textAlign: 'right', fontSize: 12.5 }}>{c.n}</Txt>
            </View>
          ))}
          <Meta style={{ marginTop: 4, fontSize: 11 }}>{t('dash.last30')}</Meta>
        </Panel>}

        {/* vendors */}
        {ops && <Panel title={t('dash.vendors')} icon="people">
          {!ops.vendors.length && <Meta>{t('dash.noVendors')}</Meta>}
          {!!ops.vendors.length && (
            <View style={[s.row, { paddingTop: 0 }]}>
              <Txt style={{ flex: 1, fontSize: 11, color: C.ink3 }}>{t('dash.vendor')}</Txt>
              {(['dash.vOpen', 'dash.vProgress', 'dash.vDone'] as const).map(k => <Txt key={k} style={s.num}>{t(k)}</Txt>)}
            </View>
          )}
          {ops.vendors.slice(0, 6).map(v => (
            <View key={v.id} style={[s.row, s.line]}>
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 13 }} numberOfLines={1}>{v.name}</Txt>
                <Meta numberOfLines={1}>{v.category}</Meta>
              </View>
              <Txt w={700} style={s.num}>{v.open}</Txt>
              <Txt w={700} style={s.num}>{v.inProgress}</Txt>
              <Txt w={700} style={[s.num, { color: C.good }]}>{v.completed}</Txt>
            </View>
          ))}
        </Panel>}

        {/* ratings */}
        {sat && <Panel title={t('dash.satTitle')} icon="star">
          {!sat.count ? <Meta>{t('dash.noRatingsB')}</Meta> : <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <Txt w={800} style={{ fontSize: 26 }}>{sat.avg}</Txt>
              <Meta>/ 5</Meta>
              <Txt style={{ color: '#E3A008', fontSize: 15 }}>{stars(sat.avg ?? 0)}</Txt>
              <Meta>{t('dash.ratings', { n: sat.count })}</Meta>
            </View>
            {sat.dist.map(d => (
              <View key={d.star} style={s.barRow}>
                <Txt style={{ width: 52, fontSize: 12, color: C.ink2 }}>{t('dash.stars', { n: d.star })}</Txt>
                <Bar value={d.n} max={sMax} color={d.star >= 4 ? DONE : d.star === 3 ? '#E3A008' : '#D9534F'} />
                <Txt w={700} style={{ width: 40, textAlign: 'right', fontSize: 12 }}>{Math.round((d.n / sat.count) * 100)}%</Txt>
              </View>
            ))}
          </>}
        </Panel>}

        {/* my notes */}
        <Panel title={t('dash.notes')} icon="create-outline" error={errs.notes}>
          {(mine ?? []).map(n => (
            <View key={n.id} style={s.note}>
              <Pressable onPress={() => toggle(n)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: n.done }}>
                <Icon name={n.done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={n.done ? C.good : C.ink3} />
              </Pressable>
              <Txt style={{ flex: 1, fontSize: 13, color: n.done ? C.ink3 : C.ink, textDecorationLine: n.done ? 'line-through' : 'none' }}>{n.text}</Txt>
              <Pressable onPress={() => drop(n)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('mgr.v.remove')}>
                <Icon name="close" size={16} color={C.ink3} />
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Input value={note} onChangeText={setNoteText} placeholder={t('dash.notePh')} maxLength={300} style={{ flex: 1 }} onSubmitEditing={addNote} accessibilityLabel={t('dash.notePh')} />
            <Btn icon="add" label={t('dash.addNote')} onPress={addNote} disabled={!note.trim()} />
          </View>
        </Panel>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingTop: 12 },
  kpi: { flexBasis: '46%', flexGrow: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12 },
  kIc: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  panel: { marginHorizontal: 14, marginTop: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14 },
  ph: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.accBorder, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' },
  chipOn: { backgroundColor: C.acc, borderColor: C.acc },
  aiOut: { marginTop: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  q: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: C.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  line: { borderTopWidth: 1, borderTopColor: C.line },
  stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: C.dimBg, marginBottom: 10 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  legendI: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 6 },
  col: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  colBars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 3, width: '100%', justifyContent: 'center' },
  vbar: { width: 9, minHeight: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 5 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: C.dimBg, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  num: { width: 52, textAlign: 'right', fontSize: 12.5 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
});
