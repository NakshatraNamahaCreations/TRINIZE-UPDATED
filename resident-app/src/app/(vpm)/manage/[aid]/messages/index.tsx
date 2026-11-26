import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Card, EmptyState, Icon, IconTile, Meta, Pill, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { when } from '@/lib/messages';
import { useFocusEffect } from '@/lib/refresh';
import { inbox, type Convo } from '@/lib/vpm';
import { C } from '@/theme';

/** Residents' messages to one society's office — the property manager answers them from here. */
export default function VpmInbox() {
  const { aid, name } = useLocalSearchParams<{ aid: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [list, setList] = useState<Convo[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setList(await inbox(aid)); } catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); } finally { setLoading(false); }
  }, [aid, toast, t]);
  useFocusEffect(useCallback(() => {
    void load();
    const h = setInterval(() => { inbox(aid).then(setList).catch(() => {}); }, 15000);
    return () => clearInterval(h);
  }, [aid, load]));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 16 }} numberOfLines={1}>{t('mgr.m.title')}</Txt>
          {!!name && <Meta numberOfLines={1}>{name}</Meta>}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 + insets.bottom }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        {list !== null && !list.length && <EmptyState icon="chatbubbles-outline" title={t('mgr.m.none')} body={t('mgr.m.noneB')} />}
        {(list ?? []).map((c, i) => (
          <Card key={c.id} delay={stagger(i)} onPress={() => router.push({ pathname: '/manage/[aid]/messages/[id]', params: { aid, id: c.id } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <IconTile name="person-outline" size={38} />
              <View style={{ flex: 1 }}>
                <Txt w={c.unread ? 800 : 700} style={{ fontSize: 14 }} numberOfLines={1}>{c.subject}</Txt>
                <Meta numberOfLines={1}>{c.resident}{c.unit ? ` · ${c.unit}` : ''}</Meta>
                <Meta numberOfLines={1} style={{ color: C.ink2 }}>{c.lastFrom === 'staff' ? t('common.you') + ': ' : ''}{c.preview}</Meta>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Meta>{when(c.lastMessageAt)}</Meta>
                {c.unread > 0 ? <Pill tone="acc">{String(c.unread)}</Pill> : c.status === 'Closed' ? <Pill tone="dim">{t('msg.closed')}</Pill> : null}
              </View>
            </View>
            <Meta style={{ marginTop: 6, color: C.ink3 }}>{tx('topic', c.topic)}</Meta>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
});
