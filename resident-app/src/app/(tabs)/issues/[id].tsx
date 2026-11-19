import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native';
import { IssueUpdates, ReopenModal, UpdateComposer } from '@/components/IssueFollowUp';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Icon, Meta, Pill, Row, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import type { IssueStatus } from '@/store/data';
import { LIVE } from '@/lib/api';
import { rateIssueLive } from '@/lib/live';
import { IssueChat } from '@/components/IssueChat';
import { useStore } from '@/store/store';
import { C } from '@/theme';

const STEPS: IssueStatus[] = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'Resolved'];

export default function IssueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const { toast } = useUI();
  const { t, tr, tx } = useT();
  const [stars, setStars] = useState(0);
  const [reopening, setReopening] = useState(false);
  const i = state.issues.find(x => x.id === id && x.mine);

  if (!i) return <Screen header={<Header title={t('issue.title')} back="/issues" />}><EmptyState icon="ticket-outline" title={t('issue.nf.t')} body={t('issue.nf.b')} /></Screen>;

  const resolved = i.status === 'Resolved';
  const next = STEPS[STEPS.indexOf(i.status) + 1] ?? 'Closed';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <Screen header={<Header title={i.id} back="/issues" />}>
      <Card>
        <Row>
          <Pill tone={resolved ? 'good' : 'acc'}>{tx('status', i.status)}</Pill>
          <Pill tone="dim">{i.cat}</Pill>
          <Pill tone={i.pri === 'High' || i.pri === 'Emergency' ? 'bad' : i.pri === 'Low' ? 'dim' : 'warn'}>{tx('pri', i.pri)}</Pill>
        </Row>
        <Txt w={700} style={{ fontSize: 14, marginTop: 6 }}>{i.title}</Txt>
        <Meta style={{ marginTop: 4 }}>{i.loc} · {t('issues.raised', { when: i.when })} · {i.sla}</Meta>
        {i.vendor !== '—' && <Meta style={{ marginTop: 2 }}>{tr('issue.assignedTo', { vendor: <Txt w={700} style={{ fontSize: 12 }}>{i.vendor}</Txt> })}</Meta>}
      </Card>

      <Sect title={t('issue.timeline')} />
      <Card>
        <View style={s.tl}>
          {i.tl.map((step, idx) => {
            const done = idx < i.tl.length - 1 || resolved;
            return (
              <View key={idx} style={s.step}>
                <View style={[s.node, { backgroundColor: done ? C.good : C.acc }, !done && s.nodeCur]} />
                <Txt w={700} style={{ fontSize: 12 }}>{tx('status', step.s)}</Txt>
                <Txt style={{ fontSize: 12, color: C.ink3 }}>{step.w}</Txt>
                {step.n && <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>{step.n}</Txt>}
              </View>
            );
          })}
          {!resolved && (
            <View style={s.step}>
              <View style={[s.node, { backgroundColor: '#D6DDE8' }]} />
              <Txt w={700} style={{ fontSize: 12, color: C.ink3 }}>{tx('status', next)}</Txt>
              <Txt style={{ fontSize: 12, color: C.ink3 }}>{t('issue.pending')}</Txt>
            </View>
          )}
        </View>
        <View style={s.foot}>
          {resolved ? (
            <>
              <Txt w={700} style={{ fontSize: 12.5 }}>{t('issue.how')}</Txt>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Pressable key={n} hitSlop={4} accessibilityLabel={t('issue.stars', { n })}
                    onPress={() => { setStars(n); if (LIVE) rateIssueLive(i.id, n).catch(() => {}); toast(t('issue.thanks'), 'star'); }}>
                    <Icon name={n <= stars ? 'star' : 'star-outline'} size={26} color={n <= stars ? '#F59E0B' : C.ink3} />
                  </Pressable>
                ))}
              </View>
              <Meta style={{ marginTop: 4 }}>{t('issue.private')}</Meta>
            </>
          ) : <Meta>{t('issue.internal')}</Meta>}
        </View>
      </Card>
      <IssueUpdates issue={i} />
      <IssueChat issueId={i.id} />
      {resolved
        ? <>
          <Btn full icon="checkmark-done" label={t('issue.confirm')} onPress={() => actions.confirmFixed(i.id)} />
          <Btn full variant="ghost" icon="refresh" label={t('issue.reopen')} onPress={() => setReopening(true)} />
        </>
        : i.status === 'Closed' ? null
        : <><Sect title={t('issue.comment')} /><UpdateComposer issueId={i.id} /></>}
    </Screen>
    <ReopenModal issueId={i.id} visible={reopening} onClose={() => setReopening(false)} />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  tl: { marginTop: 4, marginLeft: 6, paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: C.line },
  step: { paddingBottom: 14, paddingLeft: 4 },
  node: { position: 'absolute', left: -25, top: 3, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  nodeCur: { shadowColor: C.acc, shadowOpacity: 0.5, shadowRadius: 3, elevation: 2 },
  foot: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, marginTop: 2 },
});
