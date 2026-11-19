import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Card, Meta, Pill, Row, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { COND_TONE, day, SEV_TONE, type Full } from '@/lib/inspections';
import { C } from '@/theme';

/**
 * A submitted inspection, as a report: the summary, what changed since move-in, the findings, then
 * every room with its ratings, notes and photos. Shared by the property manager's and the resident's screens;
 * `pick` lets the manager tick findings to turn into work orders.
 */
export function InspectionReport({ r, pick }: { r: Full; pick?: { picked: Record<string, boolean>; toggle: (id: string) => void } }) {
  const { t, tx } = useT();
  const findings = r.sections.flatMap(s => s.items.filter(i => i.finding && i.severity).map(i => ({ ...i, section: s.name })));
  const open = (url: string) => { void Linking.openURL(url); };
  return (
    <>
      <Card>
        <Row>
          <Pill tone={r.status === 'Submitted' ? 'good' : 'acc'}>{tx('ins.st', r.status)}</Pill>
          {r.ack && <Pill tone="good">{t('ins.acked')}</Pill>}
        </Row>
        <Txt w={800} style={{ fontSize: 16, marginTop: 8 }}>{r.ref} · {tx('ins.type', r.type)}</Txt>
        <Meta style={{ marginTop: 3 }}>{r.where} · {r.template}</Meta>
        <Meta style={{ marginTop: 2 }}>{t('ins.by', { name: r.inspector, date: day(r.submittedAt ?? r.startedAt) })}</Meta>
        {!!r.summary && <Txt style={{ fontSize: 13.5, lineHeight: 20, marginTop: 10 }}>{r.summary}</Txt>}
        {!!r.summary && <Meta style={{ marginTop: 4 }}>{t(r.summaryBy === 'ai' ? 'ins.byAi' : 'ins.byRules')}</Meta>}
        <View style={s.counts}>
          {(['Good', 'Fair', 'Poor', 'Damaged', 'Missing'] as const).map(c => (
            <View key={c} style={s.count}><Txt w={800} style={{ fontSize: 16, color: r.counts[c] && c !== 'Good' ? (c === 'Fair' ? C.warn : C.bad) : C.ink }}>{r.counts[c]}</Txt><Meta>{tx('ins.c', c)}</Meta></View>
          ))}
        </View>
        {r.ack && <Meta style={{ marginTop: 10 }}>{t('ins.ackBy', { name: r.ack.name, date: day(r.ack.at) })}{r.ack.note ? ` · “${r.ack.note}”` : ''}</Meta>}
      </Card>

      {r.comparison && (
        <>
          <Sect title={t('ins.compare', { ref: r.comparison.ref })} />
          <Card>
            <Meta>{t('ins.compareS', { worse: r.comparison.worse, better: r.comparison.better })}</Meta>
            {r.comparison.changes.map((c, i) => (
              <View key={i} style={s.line}>
                <View style={{ flex: 1 }}><Txt w={700} style={{ fontSize: 13.5 }}>{c.item}</Txt><Meta>{c.section}</Meta></View>
                <Pill tone={COND_TONE[c.before]}>{tx('ins.c', c.before)}</Pill><Txt style={{ color: C.ink3 }}>→</Txt><Pill tone={COND_TONE[c.after]}>{tx('ins.c', c.after)}</Pill>
              </View>
            ))}
          </Card>
        </>
      )}

      {findings.length > 0 && <Sect title={t('ins.findings', { n: findings.length })} />}
      {findings.map(f => {
        const on = !!pick?.picked[f.id];
        return (
          <Card key={f.id} onPress={pick && !f.workOrder ? () => pick.toggle(f.id) : undefined} style={on ? { borderColor: C.acc, borderWidth: 1.5 } : undefined}>
            <Row>
              <Pill tone={SEV_TONE[f.severity!]}>{tx('ins.sev', f.severity!)}</Pill>
              {!!f.recommendation && <Pill tone="dim">{tx('ins.rec', f.recommendation)}</Pill>}
              {f.workOrder ? <Pill tone="acc">{f.workOrder.ref} · {tx('status', f.workOrder.status)}</Pill> : pick ? <Pill tone={on ? 'acc' : 'dim'}>{t(on ? 'ins.picked' : 'ins.tapPick')}</Pill> : null}
            </Row>
            <Txt w={700} style={{ fontSize: 14, marginTop: 6 }}>{f.item} · {f.section}</Txt>
            <Txt style={{ fontSize: 13, lineHeight: 19, marginTop: 3, color: C.ink2 }}>{f.finding}</Txt>
          </Card>
        );
      })}

      {r.sections.map(sec => (
        <View key={sec.name}>
          <Sect title={sec.name} />
          <Card>
            {sec.items.map((it, n) => (
              <View key={it.id} style={[{ paddingVertical: 9 }, n > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt w={700} style={{ fontSize: 13.5, flex: 1 }}>{it.item}</Txt>
                  {it.condition ? <Pill tone={COND_TONE[it.condition]}>{tx('ins.c', it.condition)}</Pill> : <Pill tone="dim">{t('ins.notRated')}</Pill>}
                </View>
                {!!it.note && <Meta style={{ marginTop: 3 }}>{it.note}</Meta>}
                {it.photos.length > 0 && (
                  <View style={s.photos}>
                    {it.photos.map(p => <Pressable key={p} onPress={() => open(p)} accessibilityRole="imagebutton" accessibilityLabel={`${it.item}, ${sec.name}`}><Image source={{ uri: p }} style={s.photo} /></Pressable>)}
                  </View>
                )}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  counts: { flexDirection: 'row', marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  count: { flex: 1, alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: C.line },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  photo: { width: 62, height: 62, borderRadius: 8, backgroundColor: C.dimBg },
});
