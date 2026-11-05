import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { Btn, Header, Icon, Meta, Pill, Txt } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import type { IssueDraft } from '@/store/data';
import { useStore } from '@/store/store';
import { C, font } from '@/theme';

function TypingDots() {
  const { t } = useT();
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));
  useEffect(() => {
    const loops = dots.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 150),
      Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: true }),
      Animated.delay(300 - i * 150),
    ])));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [dots]);
  return (
    <View style={[s.msg, s.ai, { flexDirection: 'row', gap: 4, paddingVertical: 14 }]} accessibilityLabel={t('ai.typingA11y')}>
      {dots.map((v, i) => <Animated.View key={i} style={[s.dot, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0.3, 1], outputRange: [0, -3] }) }] }]} />)}
    </View>
  );
}

function IssuePreview({ d, creating, onConfirm, onCancel }: { d: IssueDraft; creating: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t, tx } = useT();
  // values are the draft's own words; only the field labels and urgency level are translated
  const rows: [Key, string][] = [['ai.f.title', d.title], ['ai.f.cat', d.cat], ['ai.f.loc', d.loc], ['ai.f.urg', tx('pri', d.pri)]];
  return (
    <View style={s.prev}>
      <Txt w={800} style={s.prevH}>{t('ai.preview')}</Txt>
      {rows.map(([k, v]) => (
        <View key={k} style={s.prevRow}>
          <Txt style={{ fontSize: 12, color: C.ink2 }}>{t(k)}</Txt>
          <View style={s.prevVal}>
            <Txt w={700} style={{ fontSize: 12, textAlign: 'right', flexShrink: 1 }}>{v}</Txt>
            {k === 'ai.f.cat' && <Pill tone="ai">{t('ai.suggested')}</Pill>}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Btn label={t(creating ? 'ai.creating' : 'ai.create')} onPress={onConfirm} disabled={creating} />
        <Btn variant="ghost" label={t('common.cancel')} onPress={onCancel} disabled={creating} />
      </View>
      <Meta style={{ marginTop: 8 }}>{t('ai.previewNote')}</Meta>
    </View>
  );
}

export default function Assistant() {
  const router = useRouter();
  const { state, actions } = useStore();
  const { t, tr } = useT();
  const c = state.chat;
  const [input, setInput] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);

  // the keyboard shrinks the log from below, so keep the latest message in view
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => scroll.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, []);

  const handle = (text: string) => {
    const t = text.trim().toLowerCase();
    if (t === 'open the directory') { router.navigate('/directory'); return; }
    if (t === 'open my issues') { router.navigate('/issues'); return; }
    actions.sendChat(text);
  };
  const send = () => {
    const v = input.trim();
    if (!v || c.busy) return;
    setInput('');
    handle(v);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header back="/" bell title={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={s.avatar}><Icon name="sparkles" size={15} color={C.ai} /></View>
          <Txt w={800} style={{ fontSize: 15 }} numberOfLines={1}>{t('ai.title')}</Txt>
          <Pill tone={c.busy ? 'ai' : 'good'}>{t(c.busy ? 'ai.typing' : 'ai.online')}</Pill>
        </View>
      } />
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={s.log}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {c.log.map((m, i) => {
          if (m.who === 'me') return <View key={i} style={[s.msg, s.me]}><Txt style={{ color: '#fff', fontSize: 13, lineHeight: 19 }}>{m.text}</Txt></View>;
          if (m.who === 'preview') return <IssuePreview key={i} d={m.draft} creating={c.creating} onConfirm={actions.confirmIssue} onCancel={actions.cancelIssue} />;
          const last = i === c.log.length - 1 && !c.busy;
          return (
            <View key={i} style={{ gap: 8 }}>
              <View style={[s.msg, s.ai]}>
                <Txt style={{ fontSize: 13, lineHeight: 19 }}>{m.text}</Txt>
                {m.src && (
                  <View style={s.src}>
                    <Icon name="document-text-outline" size={13} color={C.ink3} style={{ marginTop: 1 }} />
                    <Txt style={{ fontSize: 10.5, color: C.ink3, flex: 1 }}>{tr('ai.source', { src: <Txt w={700} style={{ fontSize: 10.5, color: C.ai }}>{m.src}</Txt> })}</Txt>
                  </View>
                )}
              </View>
              {last && m.chips && (
                <View style={s.chips}>
                  {m.chips.map(ch => (
                    <Pressable key={ch} onPress={() => handle(ch)} style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}>
                      <Txt w={700} style={{ fontSize: 11.5, color: C.ai }}>{ch}</Txt>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
        {c.busy && <TypingDots />}
      </ScrollView>
      <View style={s.inRow}>
        <TextInput
          style={[s.in, c.busy && { backgroundColor: '#F4F6FA' }]}
          value={input} onChangeText={setInput} onSubmitEditing={send}
          placeholder={t('ai.placeholder')} placeholderTextColor={C.ink3}
          editable={!c.busy} maxLength={2000} returnKeyType="send" submitBehavior="submit"
        />
        <Pressable onPress={send} disabled={c.busy} accessibilityLabel={t('ai.send')} style={[s.sendBtn, c.busy && { opacity: 0.5 }]}>
          <Icon name="send" size={17} color="#fff" style={{ marginLeft: 2 }} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.aiBg, alignItems: 'center', justifyContent: 'center' },
  log: { paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  msg: { maxWidth: '84%', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16 },
  ai: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 6, alignSelf: 'flex-start' },
  me: { backgroundColor: C.ai, borderBottomRightRadius: 6, alignSelf: 'flex-end' },
  src: { flexDirection: 'row', gap: 5, marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: C.line },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.ink3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: C.aiBg, borderWidth: 1, borderColor: '#D8DCFB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  prev: { borderWidth: 1.5, borderColor: C.ai, borderRadius: 14, padding: 12, backgroundColor: C.aiBg, alignSelf: 'flex-start', maxWidth: '90%', minWidth: '80%' },
  prevH: { fontSize: 11, letterSpacing: 0.8, color: C.ai, marginBottom: 8 },
  prevRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 3 },
  prevVal: { flexDirection: 'row', gap: 4, alignItems: 'center', flex: 1, justifyContent: 'flex-end' },
  inRow: { flexDirection: 'row', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#fff' },
  in: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: C.ink, ...font(400) },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.ai, alignItems: 'center', justifyContent: 'center' },
});
