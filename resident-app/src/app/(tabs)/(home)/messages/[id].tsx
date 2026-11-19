import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useUI } from '@/components/Overlay';
import { EmptyState, Header, Icon, Input, Meta, Pill, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { reply, thread, when, type Thread } from '@/lib/messages';
import { C } from '@/theme';

/** One conversation with the society office. */
export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [c, setC] = useState<Thread | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);

  useFocusEffect(useCallback(() => {
    const load = () => { thread(id).then(setC).catch(() => setMissing(true)); };
    load();
    const h = setInterval(load, 10000); // the office may reply while this is open
    return () => clearInterval(h);
  }, [id]));

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    try { setC(await reply(id, v)); } catch (e) { setText(v); toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header back="/messages" title={c?.subject ?? t('msg.title')} />
      {missing ? <EmptyState icon="alert-circle-outline" title={t('msg.missing')} /> : (
        <>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, paddingBottom: 20 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
            {!!c && <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}><Pill tone="acc">{tx('topic', c.topic)}</Pill>{c.status === 'Closed' && <Pill tone="dim">{t('msg.closed')}</Pill>}</View>}
            {(c?.messages ?? []).map(m => {
              const mine = m.from === 'resident';
              return (
                <View key={m.id} style={[s.msg, mine ? s.mine : s.theirs]}>
                  {!mine && <Txt w={700} style={{ fontSize: 12, color: C.acc }}>{m.by}</Txt>}
                  <Txt style={{ fontSize: 13.5, lineHeight: 20, color: mine ? '#fff' : C.ink }}>{m.text}</Txt>
                  {!!m.attachmentUrl && (
                    <Pressable onPress={() => Linking.openURL(m.attachmentUrl!)} accessibilityRole="link" style={s.file}>
                      <Icon name="attach" size={15} color={mine ? '#fff' : C.acc} />
                      <Txt w={700} style={{ fontSize: 12.5, color: mine ? '#fff' : C.acc }}>{t('msg.attachment')}</Txt>
                    </Pressable>
                  )}
                  <Txt style={{ fontSize: 11, marginTop: 3, color: mine ? 'rgba(255,255,255,.8)' : C.ink3, alignSelf: 'flex-end' }}>{when(m.at)}{mine && m.readAt ? ' · ' + t('msg.seen') : ''}</Txt>
                </View>
              );
            })}
            {c?.status === 'Closed' && <Meta style={{ textAlign: 'center', marginTop: 12 }}>{t('msg.closedNote')}</Meta>}
          </ScrollView>
          <View style={s.bar}>
            <Input value={text} onChangeText={setText} placeholder={t('msg.replyPh')} maxLength={2000} style={{ flex: 1 }} onSubmitEditing={send} accessibilityLabel={t('msg.replyPh')} />
            <Pressable onPress={send} accessibilityRole="button" accessibilityLabel={t('msg.send')} style={[s.send, !text.trim() && { opacity: 0.45 }]}><Icon name="send" size={17} color="#fff" /></Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  msg: { maxWidth: '86%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, marginTop: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.acc, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 5 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  bar: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center' },
});
