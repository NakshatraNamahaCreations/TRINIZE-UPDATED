import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Card, EmptyState, Icon, Meta, Pill, Row, stagger, Txt } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useFocusEffect } from '@/lib/refresh';
import { tickets, vpmMe, when, type Ticket } from '@/lib/vpm';
import { C } from '@/theme';

/** the home screen's figures, each with the rule it counts by — the same rules as /v1/vpm/me */
type Filter = 'new' | 'open' | 'overdue' | 'emergencies' | 'approvals' | 'resolved';
const DONE = ['Resolved', 'Closed'];
const WEEK = 7 * 86_400_000;
const RULES: Record<Filter, { title: Key; keep: (i: Ticket) => boolean }> = {
  new: { title: 'mgr.sNew', keep: i => i.status === 'Submitted' },
  open: { title: 'mgr.sOpen', keep: i => !DONE.includes(i.status) },
  overdue: { title: 'mgr.sOverdue', keep: i => !DONE.includes(i.status) && i.status !== 'On Hold' && new Date(i.slaDueAt).getTime() < Date.now() },
  emergencies: { title: 'mgr.sEmerg', keep: i => i.priority === 'Emergency' && !DONE.includes(i.status) },
  approvals: { title: 'mgr.sApprovals', keep: i => i.approval === 'pending' && !DONE.includes(i.status) },
  resolved: { title: 'mgr.sResolved', keep: i => i.timeline.some(e => e.status === 'Resolved' && Date.now() - new Date(e.at).getTime() < WEEK) },
};
const PRI = { Emergency: 'bad', High: 'bad', Medium: 'warn', Low: 'dim' } as const;
type Item = Ticket & { aid: string; society: string };

/** One of the home screen's figures, opened: the matching requests from every society the manager looks after. */
export default function VpmList() {
  const { filter: raw } = useLocalSearchParams<{ filter?: string }>();
  const filter: Filter = raw && raw in RULES ? (raw as Filter) : 'open';
  const rule = RULES[filter];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [societies, setSocieties] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await vpmMe();
      setSocieties(me.societies.length);
      const all = await Promise.all(me.societies.map(async so => (await tickets(so.id)).map(i => ({ ...i, aid: so.id, society: so.short }))));
      // emergencies first, then whatever is most past its response time
      const rank = (i: Item) => (i.priority === 'Emergency' ? 0 : i.slaState === 'over' ? 1 : 2);
      setRows(all.flat().filter(rule.keep).sort((a, b) => rank(a) - rank(b) || new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime()));
    } catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); } finally { setLoading(false); }
  }, [rule, toast, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 16 }} numberOfLines={1}>{t(rule.title)}{rows ? ` · ${rows.length}` : ''}</Txt>
          {societies > 0 && <Meta numberOfLines={1}>{t('mgr.listAcross', { n: societies })}</Meta>}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 + insets.bottom }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        {rows !== null && !rows.length && <EmptyState icon="checkmark-done-outline" title={t('mgr.listEmpty')} />}
        {(rows ?? []).map((i, idx) => (
          <Card key={i.aid + i.ref} delay={stagger(idx)} onPress={() => router.push({ pathname: '/manage/[aid]/[ref]', params: { aid: i.aid, ref: i.ref } })}>
            <Row>
              <Pill tone={PRI[i.priority]}>{tx('pri', i.priority)}</Pill>
              <Pill tone={i.status === 'Submitted' ? 'acc' : DONE.includes(i.status) ? 'good' : 'dim'}>{tx('status', i.status)}</Pill>
              {i.slaState === 'over' && <Pill tone="bad">{t('mgr.overdue')}</Pill>}
              {i.approval === 'pending' && <Pill tone="warn">{t('mgr.needsApproval')}</Pill>}
            </Row>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 14 }} numberOfLines={2}>{i.title}</Txt>
                <Meta style={{ marginTop: 3 }} numberOfLines={1}>{i.ref} · {i.society} · {tx('cat', i.category)}</Meta>
                <Meta style={{ marginTop: 2 }} numberOfLines={1}>{i.vendor ? `${i.vendor}${i.scheduledAt ? ' · ' + when(i.scheduledAt) : ''}` : t('mgr.noVendor')}</Meta>
              </View>
              <Icon name="chevron-forward" size={18} color={C.ink3} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
});
