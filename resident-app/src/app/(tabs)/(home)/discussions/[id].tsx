import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { Reactions } from '@/components/Reactions';
import { Card, EmptyState, FadeIn, Header, Icon, initials, Meta, Pill, Row, Screen, Sect, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ME } from '@/store/data';
import { useStore } from '@/store/store';
import { C, font } from '@/theme';

export default function DiscussionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const { t } = useT();
  const [text, setText] = useState('');
  const [blocked, setBlocked] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const d = state.discussions.find(x => x.id === id);

  if (!d) return <Screen header={<Header title={t('post.title')} back="/discussions" />}><EmptyState icon="chatbubbles-outline" title={t('post.nf.t')} body={t('post.nf.b')} /></Screen>;

  const hideUnit = (by: string) => by === ME.name && !state.settings.privacy.showFlat;
  // other residents never see a held reply; its author does, flagged
  const thread = (d.thread ?? []).filter(r => !r.held || r.by === ME.name);
  const earlier = Math.max(0, d.comments - thread.filter(r => !r.held).length);
  const open = d.state === 'published';

  const send = () => {
    const v = text.trim();
    if (!v) return;
    const level = actions.reply(d.id, v);
    if (level === 'block') { setBlocked(true); return; }
    setText('');
    setBlocked(false);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header title={t('post.title')} back="/discussions" bell />
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <Card style={d.state === 'hidden' && { opacity: 0.6 }}>
          <Row>
            {d.pinned && <Pill tone="acc">{t('disc.pinned')}</Pill>}
            {d.state === 'held' && <Pill tone="warn">{t('disc.held')}</Pill>}
            {d.state === 'hidden' && <Pill tone="bad">{t('disc.removed')}</Pill>}
          </Row>
          <Txt w={800} style={{ fontSize: 16, marginTop: 4 }}>{d.title}</Txt>
          <Meta style={{ marginTop: 3 }}>{d.by}{hideUnit(d.by) ? '' : ' · ' + d.unit} · {d.when}</Meta>
          <Txt style={{ fontSize: 13.5, color: C.ink2, marginTop: 10, lineHeight: 21 }}>{d.body}</Txt>
          {open && <Reactions d={d} />}
        </Card>

        <Sect title={t('post.comments', { n: d.comments })} />
        {earlier > 0 && <Meta style={s.earlier}>{t('post.earlier', { n: earlier })}</Meta>}
        {!thread.length && <Meta style={s.earlier}>{t('post.noReplies')}</Meta>}
        {thread.map((r, i) => {
          const mine = r.by === ME.name;
          return (
            <FadeIn key={r.id} delay={Math.min(i, 6) * 50}>
              <View style={s.reply}>
                <View style={[s.av, mine && { backgroundColor: C.aiBg }]}>
                  <Txt w={800} style={{ fontSize: 11.5, color: mine ? C.ai : C.acc }}>{initials(r.by)}</Txt>
                </View>
                <View style={[s.bubble, r.held && s.bubbleHeld]}>
                  <Txt w={700} style={{ fontSize: 12 }}>
                    {mine ? t('common.you') : r.by}
                    <Txt style={{ fontSize: 11, color: C.ink3 }}>{hideUnit(r.by) ? '' : '  ' + r.unit} · {r.when}</Txt>
                  </Txt>
                  <Txt style={{ fontSize: 13, lineHeight: 19, marginTop: 3 }}>{r.text}</Txt>
                  {r.held && <Meta style={{ color: C.warn, marginTop: 4 }}>{t('post.heldReply')}</Meta>}
                </View>
              </View>
            </FadeIn>
          );
        })}
      </ScrollView>

      {open ? (
        <View style={s.bar}>
          {blocked && (
            <View style={s.blocked}>
              <Icon name="shield-half-outline" size={15} color={C.bad} />
              <Txt w={600} style={{ fontSize: 12, color: C.bad, flex: 1 }}>{t('post.blocked')}</Txt>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={s.in}
              value={text}
              onChangeText={v => { setText(v); if (blocked) setBlocked(false); }}
              placeholder={t('post.placeholder')}
              placeholderTextColor={C.ink3}
              multiline
              maxLength={1000}
            />
            <Pressable onPress={send} disabled={!text.trim()} accessibilityLabel={t('post.send')} style={[s.send, !text.trim() && { opacity: 0.45 }]}>
              <Icon name="send" size={17} color="#fff" style={{ marginLeft: 2 }} />
            </Pressable>
          </View>
        </View>
      ) : (
        <Meta style={s.closed}>{t(d.state === 'held' ? 'post.waiting' : 'post.closed')}</Meta>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  earlier: { paddingHorizontal: 18, paddingVertical: 4 },
  reply: { flexDirection: 'row', gap: 9, paddingHorizontal: 14, paddingVertical: 5 },
  av: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.accBg, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bubble: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, borderTopLeftRadius: 4, paddingVertical: 9, paddingHorizontal: 12 },
  bubbleHeld: { borderColor: '#F7D9A8', backgroundColor: '#FFFBF3' },
  bar: { paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#fff', gap: 8 },
  blocked: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: C.badBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  in: { flex: 1, maxHeight: 110, borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: C.ink, ...font(400) },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  closed: { textAlign: 'center', paddingVertical: 12, paddingHorizontal: 18, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
});
