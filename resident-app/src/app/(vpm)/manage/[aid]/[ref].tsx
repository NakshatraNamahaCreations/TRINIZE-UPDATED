import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Chip } from '@/components/Sheets';
import { Btn, Card, EmptyState, Icon, Input, Meta, Pill, Row, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import {
  addInvoice, addNote, decideEstimate, invoicesFor, messages, move, rupees, sendMessage, setEstimate, setInvoice, ticket, tickets, vendorProgress, vendors, when,
  type Invoice, type Message, type Ticket, type Vendor,
} from '@/lib/vpm';
import { nextDays } from '@/store/dates';
import { C } from '@/theme';

const TIMES: [string, number, number][] = [['9:00 AM', 9, 0], ['11:00 AM', 11, 0], ['2:00 PM', 14, 0], ['4:00 PM', 16, 0], ['6:00 PM', 18, 0]];
const INV_TONE = { Pending: 'warn', Approved: 'acc', Paid: 'good', Rejected: 'bad' } as const;

/** One request, as the property manager works it: the next step, the vendor, the money, the resident. */
export default function VpmTicket() {
  const { aid, ref } = useLocalSearchParams<{ aid: string; ref: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [it, setIt] = useState<Ticket | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vlist, setVlist] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [access, setAccess] = useState('');
  const [note, setNote] = useState('');
  const [days] = useState(() => ['Today', ...nextDays(6)]);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(1);
  const [estimate, setEst] = useState('');
  const [bill, setBill] = useState('');
  const [billNote, setBillNote] = useState('');
  const [invs, setInvs] = useState<Invoice[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [msg, setMsg] = useState('');
  const [internal, setInternal] = useState('');
  // closing it without a vendor: resolved by the manager, or a duplicate of another open request
  const [closeMode, setCloseMode] = useState<null | 'resolve' | 'duplicate'>(null);
  const [closeNote, setCloseNote] = useState('');
  const [others, setOthers] = useState<Ticket[]>([]);
  const [dupOf, setDupOf] = useState('');

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const side = useCallback(() => {
    invoicesFor(aid, ref).then(setInvs).catch(() => {});
    messages(aid, ref).then(setMsgs).catch(() => {});
  }, [aid, ref]);
  useEffect(() => {
    ticket(aid, ref).then(x => { setIt(x); setEst(x.costEstimate ? String(x.costEstimate) : ''); }).catch(e => { if (e instanceof ApiError && e.status === 404) setMissing(true); else fail(e); });
    vendors(aid).then(setVlist).catch(() => {});
    side();
  }, [aid, ref, fail, side]);

  /** run one action on the ticket and show what the server now holds */
  const act = async (work: () => Promise<Ticket>, done: string) => {
    if (busy) return;
    setBusy(true);
    try { setIt(await work()); setNote(''); toast(done, 'checkmark-circle'); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const n = note.trim() || undefined;

  /** Resolved without a vendor — moving through Acknowledged first when it hasn't been picked up yet. The note is on the resident's timeline. */
  const closeYourself = (resolution: string, done: string) => act(async () => {
    if (it?.status === 'Submitted') await move(aid, ref, 'Acknowledged');
    return move(aid, ref, 'Resolved', { note: resolution });
  }, done);
  const openDuplicate = () => {
    setCloseMode('duplicate'); setDupOf('');
    tickets(aid).then(l => setOthers(l.filter(x => x.ref !== ref && x.status !== 'Resolved' && x.status !== 'Closed'))).catch(fail);
  };

  const schedule = () => {
    const d = new Date();
    d.setDate(d.getDate() + day);
    d.setHours(TIMES[slot]![1], TIMES[slot]![2], 0, 0);
    if (d.getTime() < Date.now()) { toast(t('mgr.pastTime'), 'alert-circle'); return; }
    void act(() => vendorProgress(aid, ref, 'Scheduled', { scheduledAt: d.toISOString(), note: n }), t('mgr.scheduled'));
  };
  const saveEstimate = () => {
    if (!estimate) { toast(t('mgr.amountReq'), 'alert-circle'); return; }
    void act(() => setEstimate(aid, ref, Number(estimate)), t('mgr.estimateSaved'));
  };
  const recordBill = async () => {
    const amount = Number(bill);
    if (!amount) { toast(t('mgr.amountReq'), 'alert-circle'); return; }
    setBusy(true);
    try { await addInvoice(aid, ref, amount, billNote.trim()); setBill(''); setBillNote(''); side(); toast(t('mgr.billSaved'), 'receipt'); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const decideBill = async (id: string, status: 'Approved' | 'Paid' | 'Rejected') => {
    try { await setInvoice(aid, id, status); side(); setIt(await ticket(aid, ref)); } catch (e) { fail(e); }
  };
  const send = async () => {
    const v = msg.trim();
    if (!v) return;
    setMsg('');
    try { setMsgs(await sendMessage(aid, ref, v)); } catch (e) { setMsg(v); fail(e); }
  };
  const saveInternal = () => {
    const v = internal.trim();
    if (!v) return;
    setInternal('');
    void act(() => addNote(aid, ref, v), t('mgr.noteSaved'));
  };

  const header = (
    <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
      <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
        <Icon name="chevron-back" size={24} color={C.ink2} />
      </Pressable>
      <Txt w={800} style={{ fontSize: 16, flex: 1 }}>{ref}</Txt>
    </View>
  );
  if (missing) return <View style={s.page}>{header}<EmptyState icon="ticket-outline" title={t('issue.nf.t')} /></View>;
  if (!it) return <View style={s.page}>{header}</View>;

  const closed = it.status === 'Resolved' || it.status === 'Closed';
  const vs = it.vendorState ?? 'Assigned';
  const withVendor = !!it.vendor && (it.status === 'Assigned' || it.status === 'In Progress');
  const vendorPhone = vlist.find(v => v.name === it.vendor)?.phone;

  return (
    <KeyboardAvoidingView style={s.page} behavior="padding">
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Row>
            <Pill tone={closed ? 'good' : 'acc'}>{tx('status', it.status)}</Pill>
            <Pill tone={it.priority === 'Low' ? 'dim' : it.priority === 'Medium' ? 'warn' : 'bad'}>{tx('pri', it.priority)}</Pill>
            <Pill tone="dim">{it.category}</Pill>
            {it.slaState === 'over' && <Pill tone="bad">{t('mgr.overdue')}</Pill>}
          </Row>
          <Txt w={800} style={{ fontSize: 16, marginTop: 8 }}>{it.title}</Txt>
          {it.updates.filter(u => u.text).map((u, i) => <Txt key={i} style={s.body}>{u.text}</Txt>)}
          {it.updates.filter(u => u.photoUrl).map((u, i) => <Image key={i} source={{ uri: u.photoUrl! }} style={s.photo} resizeMode="cover" />)}
          <View style={s.facts}>
            <Fact icon="person-outline" label={t('mgr.raisedBy')} value={`${it.reporter ?? '—'}${it.unit ? ' · ' + it.unit : ''}`} />
            <Fact icon="location-outline" label={t('mgr.where')} value={it.scope === 'common' ? `${t('mgr.common')}${it.asset ? ' · ' + it.asset : ''} · ${it.location}` : it.location} />
            <Fact icon="time-outline" label={t('mgr.respondBy')} value={when(it.slaDueAt)} />
            {!!it.vendor && <Fact icon="construct-outline" label={t('mgr.vendor')} value={`${it.vendor} · ${tx('vstate', vs)}${it.scheduledAt ? ' · ' + when(it.scheduledAt) : ''}`} />}
            {!!it.accessNote && <Fact icon="key-outline" label={t('mgr.access')} value={it.accessNote} />}
            {it.rating !== null && <Fact icon="star-outline" label={t('mgr.rating')} value={`${it.rating} / 5`} />}
          </View>
          {!!vendorPhone && withVendor && (
            <Btn variant="ghost" icon="call-outline" label={t('mgr.callVendor', { name: it.vendor! })} onPress={() => Linking.openURL('tel:' + vendorPhone.replace(/\s/g, '')).catch(() => {})} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
          )}
        </Card>

        {!closed && (
          <>
            <Sect title={t('mgr.next')} />
            <Card>
              {it.approval === 'pending' && (
                <View style={s.banner}>
                  <Icon name="hourglass-outline" size={16} color={C.warn} />
                  <Txt w={600} style={s.bannerText}>{t('mgr.approvalNeeded', { amount: rupees(it.costEstimate ?? 0) })}</Txt>
                </View>
              )}
              {it.approval === 'pending' && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  <Btn icon="checkmark" label={t('mgr.approve')} disabled={busy} onPress={() => act(() => decideEstimate(aid, ref, 'approved'), t('mgr.approved'))} style={{ flex: 1 }} />
                  <Btn variant="ghost" label={t('mgr.reject')} disabled={busy} onPress={() => act(() => decideEstimate(aid, ref, 'rejected'), t('mgr.rejected'))} style={{ flex: 1 }} />
                </View>
              )}

              {it.status === 'Submitted' && <Btn full icon="checkmark" label={t('mgr.acknowledge')} disabled={busy} onPress={() => act(() => move(aid, ref, 'Acknowledged', { note: n }), t('mgr.acknowledged'))} />}

              {it.status === 'Acknowledged' && (
                <>
                  <Txt w={700} style={s.label}>{t('mgr.pickVendor')}</Txt>
                  <View style={s.chips}>{vlist.map(v => <Chip key={v.id} label={`${v.name} · ${v.category}`} on={vendorId === v.id} onPress={() => setVendorId(v.id)} />)}</View>
                  <Input value={access} onChangeText={setAccess} placeholder={t('mgr.accessPh')} maxLength={300} style={{ marginTop: 10 }} />
                  <Btn full icon="construct-outline" label={t('mgr.assign')} disabled={busy || !vendorId} onPress={() => act(() => move(aid, ref, 'Assigned', { vendorId, accessNote: access.trim() || undefined }), t('mgr.assigned'))} style={{ marginTop: 10 }} />
                </>
              )}

              {withVendor && (
                <>
                  {vs === 'Accepted' && (
                    <>
                      <Txt w={700} style={s.label}>{t('mgr.pickDay')}</Txt>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {days.map((d, i) => <Chip key={d} label={i === 0 ? t('mgr.today') : d} on={day === i} onPress={() => setDay(i)} />)}
                      </ScrollView>
                      <Txt w={700} style={s.label}>{t('mgr.pickTime')}</Txt>
                      <View style={s.chips}>{TIMES.map(([l], i) => <Chip key={l} label={l} on={slot === i} onPress={() => setSlot(i)} />)}</View>
                    </>
                  )}
                  <Input value={note} onChangeText={setNote} placeholder={t(vs === 'Visited' ? 'mgr.notePhDone' : 'mgr.notePh')} maxLength={500} multiline style={{ marginTop: 10, minHeight: 52, textAlignVertical: 'top' }} />
                  {vs === 'Assigned' && <Btn full icon="checkmark" label={t('mgr.vendorConfirmed')} disabled={busy} onPress={() => act(() => vendorProgress(aid, ref, 'Accepted', { note: n }), t('mgr.saved'))} style={{ marginTop: 10 }} />}
                  {vs === 'Accepted' && <Btn full icon="calendar-outline" label={t('mgr.schedule')} disabled={busy || it.approval === 'pending'} onPress={schedule} style={{ marginTop: 10 }} />}
                  {vs === 'Scheduled' && <Btn full icon="walk-outline" label={t('mgr.visited')} disabled={busy} onPress={() => act(() => vendorProgress(aid, ref, 'Visited', { note: n }), t('mgr.saved'))} style={{ marginTop: 10 }} />}
                  {vs === 'Visited' && <Btn full icon="checkmark-done" label={t('mgr.complete')} disabled={busy} onPress={() => act(() => vendorProgress(aid, ref, 'Completed', { note: n }), t('mgr.completed'))} style={{ marginTop: 10 }} />}
                </>
              )}

              {it.status === 'On Hold'
                ? <Btn full icon="play-outline" label={t('mgr.resume')} disabled={busy} onPress={() => act(() => move(aid, ref, it.vendor ? 'Assigned' : 'In Progress', { note: t('mgr.resumedNote') }), t('mgr.saved'))} />
                : it.status !== 'Submitted' && <Btn full variant="ghost" icon="pause-outline" label={t('mgr.hold')} disabled={busy} onPress={() => act(() => move(aid, ref, 'On Hold', { note: n ?? t('mgr.holdNote') }), t('mgr.saved'))} style={{ marginTop: 8 }} />}

              {/* closing it without a vendor (N-06): sorted on the spot, or the same as another request */}
              <View style={s.closeBox}>
                <Txt w={700} style={s.label0}>{t('mgr.closeSelf')}</Txt>
                {!closeMode && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Btn variant="soft" icon="checkmark-done-outline" label={t('mgr.resolveSelf')} disabled={busy} onPress={() => { setCloseMode('resolve'); setCloseNote(''); }} style={{ flex: 1 }} />
                    <Btn variant="soft" icon="copy-outline" label={t('mgr.dup')} disabled={busy} onPress={openDuplicate} style={{ flex: 1 }} />
                  </View>
                )}
                {closeMode === 'resolve' && (
                  <>
                    <Input value={closeNote} onChangeText={setCloseNote} placeholder={t('mgr.resolveNotePh')} maxLength={500} multiline style={{ minHeight: 60, textAlignVertical: 'top' }} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <Btn icon="checkmark-done" label={t('mgr.resolveBtn')} disabled={busy || closeNote.trim().length < 3} onPress={() => { void closeYourself(closeNote.trim(), t('mgr.resolvedSelf')); setCloseMode(null); }} style={{ flex: 1 }} />
                      <Btn variant="ghost" label={t('common.cancel')} onPress={() => setCloseMode(null)} style={{ flex: 1 }} />
                    </View>
                  </>
                )}
                {closeMode === 'duplicate' && (
                  <>
                    <Meta style={{ marginBottom: 6 }}>{t('mgr.dupOf')}</Meta>
                    {!others.length && <Meta>{t('mgr.dupNone')}</Meta>}
                    <View style={s.chips}>{others.slice(0, 12).map(o => <Chip key={o.ref} label={`${o.ref} · ${o.title}`} on={dupOf === o.ref} onPress={() => setDupOf(o.ref)} />)}</View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <Btn icon="copy" label={t('mgr.dupBtn')} disabled={busy || !dupOf} onPress={() => { void closeYourself(t('mgr.dupNote', { ref: dupOf }), t('mgr.dupDone')); setCloseMode(null); }} style={{ flex: 1 }} />
                      <Btn variant="ghost" label={t('common.cancel')} onPress={() => setCloseMode(null)} style={{ flex: 1 }} />
                    </View>
                  </>
                )}
              </View>
            </Card>
          </>
        )}

        <Sect title={t('mgr.money')} />
        <Card>
          <Txt w={700} style={s.label0}>{t('mgr.estimate')}</Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Input value={estimate} onChangeText={v => setEst(v.replace(/[^\d]/g, ''))} placeholder="0" keyboardType="number-pad" maxLength={9} style={{ flex: 1 }} editable={!closed} />
            {!closed && <Btn variant="ghost" label={t('mgr.save')} disabled={busy} onPress={saveEstimate} />}
          </View>
          {it.approval === 'approved' && <Meta style={{ color: C.good, marginTop: 4 }}>{t('mgr.estApproved')}</Meta>}
          {it.approval === 'rejected' && <Meta style={{ color: C.bad, marginTop: 4 }}>{t('mgr.estRejected')}</Meta>}
          {it.costActual !== null && <Meta style={{ marginTop: 4 }}>{t('mgr.actual', { amount: rupees(it.costActual) })}</Meta>}

          {invs.map(inv => (
            <View key={inv.id} style={s.inv}>
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 14 }}>{rupees(inv.amount)}</Txt>
                {!!inv.note && <Meta>{inv.note}</Meta>}
              </View>
              <Pill tone={INV_TONE[inv.status]}>{tx('inv', inv.status)}</Pill>
              {inv.status === 'Pending' && <Btn variant="ghost" label={t('mgr.approve')} onPress={() => decideBill(inv.id, 'Approved')} />}
              {inv.status === 'Approved' && <Btn variant="ghost" label={t('mgr.markPaid')} onPress={() => decideBill(inv.id, 'Paid')} />}
            </View>
          ))}
          {!!it.vendor && (
            <>
              <Txt w={700} style={s.label}>{t('mgr.bill')}</Txt>
              <Input value={bill} onChangeText={v => setBill(v.replace(/[^\d]/g, ''))} placeholder={t('mgr.billPh')} keyboardType="number-pad" maxLength={9} />
              <Input value={billNote} onChangeText={setBillNote} placeholder={t('mgr.billNotePh')} maxLength={200} style={{ marginTop: 8 }} />
              <Btn full variant="ghost" icon="receipt-outline" label={t('mgr.recordBill')} disabled={busy} onPress={recordBill} style={{ marginTop: 8 }} />
            </>
          )}
        </Card>

        <Sect title={t('mgr.resident')} />
        <Card>
          {!msgs.length && <Meta>{t('mgr.noMsgs')}</Meta>}
          {msgs.map(m => (
            <View key={m.id} style={[s.msg, m.from === 'staff' ? s.mine : s.theirs]}>
              {m.from !== 'staff' && <Txt w={700} style={{ fontSize: 12, color: C.acc }}>{m.by ?? it.reporter ?? ''}</Txt>}
              <Txt style={{ fontSize: 13, lineHeight: 19, color: m.from === 'staff' ? '#fff' : C.ink }}>{m.text}</Txt>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Input value={msg} onChangeText={setMsg} placeholder={t('mgr.msgPh')} maxLength={1000} style={{ flex: 1 }} onSubmitEditing={send} />
            <Pressable onPress={send} accessibilityLabel={t('ai.send')} style={[s.send, !msg.trim() && { opacity: 0.45 }]}><Icon name="send" size={17} color="#fff" /></Pressable>
          </View>
        </Card>

        <Sect title={t('mgr.history')} />
        <Card>
          {it.timeline.map((e, i) => (
            <View key={i} style={s.tl}>
              <Txt w={700} style={{ fontSize: 12.5 }}>{tx('status', e.status)} <Txt style={{ fontSize: 12, color: C.ink3 }}>· {when(e.at)}</Txt></Txt>
              {!!e.note && <Txt style={{ fontSize: 12.5, color: C.ink2 }}>{e.note}</Txt>}
            </View>
          ))}
          {it.internalNotes.map((x, i) => (
            <View key={'n' + i} style={[s.tl, s.internal]}>
              <Txt w={700} style={{ fontSize: 12, color: C.warn }}>{t('mgr.internal')} · {x.by ?? ''} · {when(x.at)}</Txt>
              <Txt style={{ fontSize: 12.5, color: C.ink2 }}>{x.text}</Txt>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Input value={internal} onChangeText={setInternal} placeholder={t('mgr.internalPh')} maxLength={1000} style={{ flex: 1 }} />
            <Btn variant="ghost" label={t('mgr.save')} onPress={saveInternal} />
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ icon, label, value }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Icon name={icon} size={16} color={C.ink3} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Meta>{label}</Meta>
        <Txt w={600} style={{ fontSize: 13.5 }}>{value}</Txt>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  closeBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  page: { flex: 1, backgroundColor: C.bg },
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  body: { fontSize: 13.5, color: C.ink2, lineHeight: 20, marginTop: 6 },
  photo: { width: '100%', height: 170, borderRadius: 12, marginTop: 8, backgroundColor: C.dimBg },
  facts: { marginTop: 10, gap: 8 },
  fact: { flexDirection: 'row', gap: 8 },
  banner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEF7E6', borderRadius: 10, padding: 10, marginBottom: 10 },
  bannerText: { flex: 1, fontSize: 12.5, color: C.warn },
  label: { fontSize: 13, marginTop: 10, marginBottom: 6 },
  label0: { fontSize: 13, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  inv: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line, marginTop: 8 },
  msg: { maxWidth: '86%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, marginTop: 6 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.acc, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.dimBg, borderBottomLeftRadius: 5 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center' },
  tl: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  internal: { backgroundColor: '#FFFBEF', paddingHorizontal: 8, borderRadius: 8 },
});
