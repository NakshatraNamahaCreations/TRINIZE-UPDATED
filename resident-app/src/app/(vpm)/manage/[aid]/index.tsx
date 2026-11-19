import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Icon, Input, Meta, Pill, Row, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { publishNotice, tickets, when, type Ticket } from '@/lib/vpm';
import { C } from '@/theme';

type Tab = 'new' | 'active' | 'done' | 'notice';
const TONE = { Emergency: 'bad', High: 'bad', Medium: 'warn', Low: 'dim' } as const;

/** One society's request queue, and a quick way to send its residents a notice. */
export default function VpmQueue() {
  const { aid, name, tab: startTab } = useLocalSearchParams<{ aid: string; name?: string; tab?: Tab }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [tab, setTab] = useState<Tab>(startTab === 'notice' ? 'notice' : 'new');
  const [list, setList] = useState<Ticket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [important, setImportant] = useState<'Normal' | 'High'>('Normal');
  const [sending, setSending] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const load = useCallback(async () => {
    setLoading(true);
    try { setList(await tickets(aid)); } catch (e) { fail(e); } finally { setLoading(false); }
  }, [aid, fail]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = list ?? [];
  const shown = all.filter(i => (tab === 'new' ? i.status === 'Submitted' : tab === 'done' ? ['Resolved', 'Closed'].includes(i.status) : !['Submitted', 'Resolved', 'Closed'].includes(i.status)));
  // emergencies first, then whatever has been waiting longest
  const rank = (i: Ticket) => (i.priority === 'Emergency' ? 0 : i.slaState === 'over' ? 1 : 2);
  const sorted = [...shown].sort((a, b) => rank(a) - rank(b) || new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime());

  const send = async () => {
    if (title.trim().length < 3 || body.trim().length < 3) { toast(t('mgr.noticeReq'), 'alert-circle'); return; }
    setSending(true);
    try {
      await publishNotice(aid, { title: title.trim(), body: body.trim(), priority: important });
      setTitle(''); setBody(''); setImportant('Normal');
      toast(t('mgr.noticeSent'), 'megaphone');
    } catch (e) { fail(e); } finally { setSending(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <Txt w={800} style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{name ?? t('mgr.society')}</Txt>
        <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('ins.title')} onPress={() => router.push({ pathname: '/manage/[aid]/inspections', params: { aid } })} style={s.ins}>
          <Icon name="clipboard-outline" size={16} color={C.acc} /><Txt w={700} style={{ fontSize: 12.5, color: C.acc }}>{t('ins.title')}</Txt>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        <Segmented
          items={[['new', t('mgr.tabNew', { n: all.filter(i => i.status === 'Submitted').length })], ['active', t('mgr.tabActive')], ['done', t('mgr.tabDone')], ['notice', t('mgr.tabNotice')]]}
          value={tab} onChange={setTab} />
        {tab === 'notice' ? (
          <Card>
            <Txt w={700} style={s.label}>{t('mgr.noticeTitle')}</Txt>
            <Input value={title} onChangeText={setTitle} placeholder={t('mgr.noticeTitlePh')} maxLength={120} />
            <Txt w={700} style={s.label}>{t('mgr.noticeBody')}</Txt>
            <Input value={body} onChangeText={setBody} placeholder={t('mgr.noticeBodyPh')} multiline maxLength={2000} style={{ minHeight: 96, textAlignVertical: 'top' }} />
            <Meta style={{ marginTop: 4 }}>{t('mgr.noticeHint')}</Meta>
            <Txt w={700} style={s.label}>{t('mgr.noticePri')}</Txt>
            <Segmented items={[['Normal', t('mgr.priNormal')], ['High', t('mgr.priHigh')]]} value={important} onChange={setImportant} />
            <Btn full icon="megaphone-outline" label={t('mgr.noticeSend')} disabled={sending} onPress={send} style={{ marginTop: 12 }} />
          </Card>
        ) : (
          <>
            {list !== null && !sorted.length && <EmptyState icon="checkmark-done-outline" title={t(tab === 'new' ? 'mgr.noNew' : tab === 'active' ? 'mgr.noActive' : 'mgr.noDone')} />}
            {sorted.map((i, idx) => (
              <Card key={i.ref} delay={stagger(idx)} onPress={() => router.push({ pathname: '/manage/[aid]/[ref]', params: { aid, ref: i.ref } })}>
                <Row>
                  <Pill tone={i.status === 'Submitted' ? 'acc' : ['Resolved', 'Closed'].includes(i.status) ? 'good' : 'dim'}>{tx('status', i.status)}</Pill>
                  <Pill tone={TONE[i.priority]}>{tx('pri', i.priority)}</Pill>
                  {i.slaState === 'over' && <Pill tone="bad">{t('mgr.overdue')}</Pill>}
                  {i.approval === 'pending' && <Pill tone="warn">{t('mgr.needsApproval')}</Pill>}
                </Row>
                <Txt w={700} style={{ fontSize: 14, marginTop: 6 }}>{i.title}</Txt>
                <Meta style={{ marginTop: 3 }}>{i.ref} · {i.scope === 'common' ? t('mgr.common') : i.unit ?? ''} · {i.category}</Meta>
                <Meta style={{ marginTop: 2 }}>{i.vendor ? `${i.vendor}${i.scheduledAt ? ' · ' + when(i.scheduledAt) : ''}` : t('mgr.noVendor')}</Meta>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  label: { fontSize: 13, marginTop: 10, marginBottom: 6 },
  ins: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accBg, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
});
