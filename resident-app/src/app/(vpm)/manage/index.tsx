import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Card, EmptyState, Icon, Meta, Pill, Row, Sect, stagger, Txt, type IconName } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { greeting } from '@/lib/greeting';
import { vpmMe, type Attention, type Society } from '@/lib/vpm';
import { useAuth } from '@/store/auth';
import { C, GRAD } from '@/theme';

const PRI = { Emergency: 'bad', High: 'bad', Medium: 'warn', Low: 'dim' } as const;
const sum = (list: Society[], k: 'fresh' | 'open' | 'overdue' | 'emergencies' | 'approvals' | 'resolvedWeek' | 'homes' | 'residents') => list.reduce((n, s) => n + s[k], 0);

/** One figure on the day's summary; red or amber only when there is something behind it. */
function Tile({ icon, n, label, tone, onPress }: { icon: IconName; n: number; label: string; tone: 'acc' | 'bad' | 'warn' | 'good'; onPress: () => void }) {
  const live = n > 0 || tone === 'acc' || tone === 'good';
  const fg = !live ? C.ink3 : tone === 'bad' ? C.bad : tone === 'warn' ? C.warn : tone === 'good' ? C.good : C.acc;
  const bg = !live ? C.dimBg : tone === 'bad' ? C.badBg : tone === 'warn' ? C.warnBg : tone === 'good' ? C.goodBg : C.accBg;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${n}`} style={({ pressed }) => [s.stat, pressed && { borderColor: C.acc, opacity: 0.85 }]}>
      <View style={[s.statIc, { backgroundColor: bg }]}><Icon name={icon} size={17} color={fg} /></View>
      <Txt w={800} style={{ fontSize: 20, color: live && tone !== 'acc' && tone !== 'good' ? fg : C.ink }}>{n}</Txt>
      <Meta numberOfLines={1}>{label}</Meta>
    </Pressable>
  );
}

/** The property manager's home: the day at a glance, what needs them first, and each society they look after. */
export default function VpmSocieties() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const { signOut } = useAuth();
  const [name, setName] = useState('');
  const [list, setList] = useState<Society[] | null>(null);
  const [urgent, setUrgent] = useState<Attention[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const me = await vpmMe(); setName(me.user.name); setList(me.societies); setUrgent(me.attention ?? []); }
    catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
    finally { setLoading(false); }
  }, [toast, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // each figure opens its requests from every society
  const show = (filter: string) => router.push({ pathname: '/manage/list', params: { filter } });
  const askSignOut = () => confirm(t('signout.title'), t('mgr.signoutB'), t('profile.signout'), t('common.cancel'), signOut, { icon: 'log-out-outline' });
  // a society opens on its dashboard; Requests goes straight to the queue
  const open = (so: Society) => router.push({ pathname: '/manage/[aid]/dashboard', params: { aid: so.id, name: so.short } });

  const all = list ?? [];
  const waiting = sum(all, 'fresh') + sum(all, 'overdue') + sum(all, 'emergencies');
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 18 }}>{t('mgr.title')}</Txt>
          {!!name && <Meta numberOfLines={1}>{t('mgr.role', { name })}</Meta>}
        </View>
        <Pressable onPress={askSignOut} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('profile.signout')} style={s.out}>
          <Icon name="log-out-outline" size={21} color={C.ink2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 + insets.bottom }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        {list !== null && !all.length && <EmptyState icon="business-outline" title={t('mgr.none')} body={t('mgr.noneB')} />}

        {all.length > 0 && <>
          <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
            <Txt w={600} style={{ color: '#E4DAFF', fontSize: 12.5 }}>{t(greeting(), { name: name.split(' ')[0] ?? '' })}</Txt>
            <Txt w={800} style={{ color: '#fff', fontSize: 19, lineHeight: 26, marginTop: 4 }}>{waiting ? t('mgr.heroBusy', { n: waiting }) : t('mgr.heroClear')}</Txt>
            <Txt style={{ color: '#E4DAFF', fontSize: 12.5, marginTop: 6 }}>{t('mgr.heroSub', { societies: all.length, homes: sum(all, 'homes'), residents: sum(all, 'residents') })}</Txt>
          </LinearGradient>

          <View style={s.stats}>
            <Tile icon="mail-unread" n={sum(all, 'fresh')} label={t('mgr.sNew')} onPress={() => show('new')} tone="acc" />
            <Tile icon="construct" n={sum(all, 'open')} label={t('mgr.sOpen')} onPress={() => show('open')} tone="acc" />
            <Tile icon="time" n={sum(all, 'overdue')} label={t('mgr.sOverdue')} onPress={() => show('overdue')} tone="warn" />
            <Tile icon="warning" n={sum(all, 'emergencies')} label={t('mgr.sEmerg')} onPress={() => show('emergencies')} tone="bad" />
            <Tile icon="cash" n={sum(all, 'approvals')} label={t('mgr.sApprovals')} onPress={() => show('approvals')} tone="warn" />
            <Tile icon="checkmark-done" n={sum(all, 'resolvedWeek')} label={t('mgr.sResolved')} onPress={() => show('resolved')} tone="good" />
          </View>

          <Sect title={t('mgr.attention')} />
          {!urgent.length && (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[s.statIc, { backgroundColor: C.goodBg }]}><Icon name="checkmark-circle" size={18} color={C.good} /></View>
                <View style={{ flex: 1 }}><Txt w={700} style={{ fontSize: 14 }}>{t('mgr.allClear')}</Txt><Meta>{t('mgr.allClearB')}</Meta></View>
              </View>
            </Card>
          )}
          {urgent.map((i, idx) => (
            <Card key={i.aid + i.ref} delay={stagger(idx)} onPress={() => router.push({ pathname: '/manage/[aid]/[ref]', params: { aid: i.aid, ref: i.ref } })}>
              <Row>
                <Pill tone={PRI[i.priority]}>{tx('pri', i.priority)}</Pill>
                {i.overdue && <Pill tone="bad">{t('mgr.overdue')}</Pill>}
                {i.status === 'Submitted' && <Pill tone="acc">{tx('status', i.status)}</Pill>}
              </Row>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <View style={{ flex: 1 }}>
                  <Txt w={700} style={{ fontSize: 14 }} numberOfLines={2}>{i.title}</Txt>
                  <Meta style={{ marginTop: 3 }} numberOfLines={1}>{i.ref} · {i.society} · {i.category}</Meta>
                </View>
                <Icon name="chevron-forward" size={18} color={C.ink3} />
              </View>
            </Card>
          ))}

          <Sect title={t('mgr.societies', { n: all.length })} />
        </>}

        {all.map((so, i) => (
          <Card key={so.id} delay={stagger(i)} onPress={() => open(so)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={s.tile}><Icon name="business" size={20} color={C.acc} /></View>
              <View style={{ flex: 1 }}>
                <Txt w={800} style={{ fontSize: 15 }}>{so.name}</Txt>
                <Meta numberOfLines={1}>{so.city} · {t('mgr.homesN', { homes: so.homes, residents: so.residents })}</Meta>
              </View>
              <Icon name="chevron-forward" size={18} color={C.ink3} />
            </View>
            <Row style={{ marginTop: 10 }}>
              <Pill tone={so.fresh ? 'acc' : 'dim'}>{t('mgr.fresh', { n: so.fresh })}</Pill>
              <Pill tone="dim">{t('mgr.openN', { n: so.open })}</Pill>
              {so.emergencies > 0 && <Pill tone="bad">{t('mgr.emergN', { n: so.emergencies })}</Pill>}
              {so.overdue > 0 && <Pill tone="warn">{t('mgr.overdueN', { n: so.overdue })}</Pill>}
              {so.approvals > 0 && <Pill tone="warn">{t('mgr.approvalsN', { n: so.approvals })}</Pill>}
              {so.resolvedWeek > 0 && <Pill tone="good">{t('mgr.resolvedN', { n: so.resolvedWeek })}</Pill>}
              {!!so.unread && <Pill tone="acc">{t('mgr.unreadN', { n: so.unread })}</Pill>}
              {!!so.visitRequests && <Pill tone="warn">{t('mgr.visitReqN', { n: so.visitRequests })}</Pill>}
            </Row>
            <View style={s.acts}>
              <Pressable style={s.act} onPress={() => router.push({ pathname: '/manage/[aid]', params: { aid: so.id, name: so.short } })} accessibilityRole="button">
                <Icon name="list" size={15} color={C.acc} /><Txt w={700} style={s.actT}>{t('mgr.aRequests')}</Txt>
              </Pressable>
              <Pressable style={s.act} onPress={() => router.push({ pathname: '/manage/[aid]/inspections', params: { aid: so.id } })} accessibilityRole="button">
                <Icon name="clipboard-outline" size={15} color={C.acc} /><Txt w={700} style={s.actT}>{t('ins.title')}</Txt>
              </Pressable>
              <Pressable style={s.act} onPress={() => router.push({ pathname: '/manage/[aid]', params: { aid: so.id, name: so.short, tab: 'notice' } })} accessibilityRole="button">
                <Icon name="megaphone-outline" size={15} color={C.acc} /><Txt w={700} style={s.actT}>{t('mgr.aNotice')}</Txt>
              </Pressable>
              <Pressable style={s.act} onPress={() => router.push({ pathname: '/manage/[aid]/visits', params: { aid: so.id, name: so.short } })} accessibilityRole="button">
                <Icon name="calendar-outline" size={15} color={C.acc} /><Txt w={700} style={s.actT}>{t('mgr.aVisits')}</Txt>
              </Pressable>
              <Pressable style={s.act} onPress={() => router.push({ pathname: '/manage/[aid]/messages', params: { aid: so.id, name: so.short } })} accessibilityRole="button">
                <Icon name="chatbubbles-outline" size={15} color={C.acc} /><Txt w={700} style={s.actT}>{t('mgr.aMessages')}</Txt>
              </Pressable>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  out: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.accBg, alignItems: 'center', justifyContent: 'center' },
  hero: { marginHorizontal: 16, marginTop: 14, borderRadius: 18, padding: 18 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginTop: 12 },
  stat: { flexBasis: '30%', flexGrow: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, gap: 2 },
  statIc: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  act: { flexBasis: '30%', flexGrow: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: C.accBg, borderRadius: 10, paddingHorizontal: 6 },
  actT: { fontSize: 12, color: C.acc },
});
