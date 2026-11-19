import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Icon, Input, Meta, Pill, Row, Sect, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { begin, day, list, options, type Head, type Options } from '@/lib/inspections';
import { C } from '@/theme';

/** A society's inspections, and starting a new one: which checklist, what kind, where. */
export default function Inspections() {
  const { aid } = useLocalSearchParams<{ aid: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [rows, setRows] = useState<Head[] | null>(null);
  const [opt, setOpt] = useState<Options | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [template, setTemplate] = useState('flat');
  const [type, setType] = useState('Monthly');
  const [unitId, setUnitId] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'), [toast, t]);
  const load = useCallback(async () => {
    setLoading(true);
    try { const [l, o] = await Promise.all([list(aid), options(aid)]); setRows(l); setOpt(o); } catch (e) { fail(e); } finally { setLoading(false); }
  }, [aid, fail]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const tpl = opt?.templates.find(x => x.key === template);
  const types = (opt?.types ?? []).filter(x => tpl?.scope === 'unit' || !/^Move/.test(x));
  const go = async () => {
    if (tpl?.scope === 'unit' && !unitId) { toast(t('ins.pickFlat'), 'alert-circle'); return; }
    setBusy(true);
    try {
      const made = await begin(aid, { type: types.includes(type) ? type : 'Monthly', template, ...(tpl?.scope === 'unit' ? { unitId } : { place: place.trim() }) });
      setStarting(false);
      router.push({ pathname: '/manage/[aid]/inspections/[id]', params: { aid, id: made.id } });
    } catch (e) { fail(e); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}><Icon name="chevron-back" size={24} color={C.ink2} /></Pressable>
        <Txt w={800} style={{ fontSize: 16, flex: 1 }}>{t('ins.title')}</Txt>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.acc} />}>
        {!starting ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 12 }}><Btn full icon="add-circle-outline" label={t('ins.start')} onPress={() => setStarting(true)} /></View>
        ) : opt && (
          <Card>
            <Txt w={700} style={s.label}>{t('ins.checklist')}</Txt>
            <Chips items={opt.templates.map(x => [x.key, x.name] as [string, string])} value={template} onChange={setTemplate} />
            {!!tpl && <Meta style={{ marginTop: 6 }}>{t('ins.tplS', { areas: tpl.sections.length, items: tpl.sections.reduce((n, x) => n + x.items.length, 0) })}</Meta>}
            <Txt w={700} style={s.label}>{t('ins.kind')}</Txt>
            <Chips items={types.map(x => [x, tx('ins.type', x)] as [string, string])} value={types.includes(type) ? type : 'Monthly'} onChange={setType} />
            {tpl?.scope === 'unit' ? (
              <>
                <Txt w={700} style={s.label}>{t('ins.flat')}</Txt>
                <Chips items={opt.units.map(u => [u.id, u.code] as [string, string])} value={unitId} onChange={setUnitId} />
              </>
            ) : (
              <>
                <Txt w={700} style={s.label}>{t('ins.where')}</Txt>
                <Input value={place} onChangeText={setPlace} placeholder={t('ins.wherePh')} maxLength={80} />
              </>
            )}
            <Meta style={{ marginTop: 8 }}>{t(opt.aiConnected ? 'ins.aiOn' : 'ins.aiOff')}</Meta>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Btn label={t('ins.begin')} icon="play" disabled={busy} onPress={go} style={{ flex: 1 }} />
              <Btn variant="ghost" label={t('common.cancel')} onPress={() => setStarting(false)} />
            </View>
          </Card>
        )}

        {rows !== null && !rows.length && <EmptyState icon="clipboard-outline" title={t('ins.none')} body={t('ins.noneS')} />}
        {!!rows?.length && <Sect title={t('ins.recent')} />}
        {(rows ?? []).map((r, i) => (
          <Card key={r.id} delay={stagger(i)} onPress={() => router.push({ pathname: '/manage/[aid]/inspections/[id]', params: { aid, id: r.id } })}>
            <Row>
              <Pill tone={r.status === 'Submitted' ? 'good' : 'acc'}>{tx('ins.st', r.status)}</Pill>
              {r.counts.findings > 0 && <Pill tone={r.counts.critical + r.counts.high ? 'bad' : 'warn'}>{t('ins.nFindings', { n: r.counts.findings })}</Pill>}
              {r.ack && <Pill tone="good">{t('ins.acked')}</Pill>}
            </Row>
            <Txt w={700} style={{ fontSize: 14, marginTop: 6 }}>{r.ref} · {tx('ins.type', r.type)}</Txt>
            <Meta style={{ marginTop: 3 }}>{r.where} · {day(r.startedAt)}</Meta>
            <Meta style={{ marginTop: 2 }}>{r.status === 'Submitted' ? t('ins.orders', { n: r.counts.workOrders }) : t('ins.progress', { done: r.counts.rated, total: r.counts.total })}</Meta>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  label: { fontSize: 13, marginTop: 12, marginBottom: 6 },
});
