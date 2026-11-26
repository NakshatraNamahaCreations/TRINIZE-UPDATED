import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { EmptyState, Icon, Input, Meta, Pill, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { when } from '@/lib/messages';
import { useFocusEffect } from '@/lib/refresh';
import { convo, replyConvo, setConvoStatus, type Convo, type ConvoMsg } from '@/lib/vpm';
import { C } from '@/theme';

/** One resident's conversation with the office, answered by the property manager. */
export default function VpmConversation() {
  const { aid, id } = useLocalSearchParams<{ aid: string; id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [c, setC] = useState<(Convo & { messages: ConvoMsg[] }) | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle');

  useFocusEffect(useCallback(() => {
    const load = () => { convo(aid, id).then(setC).catch(() => setMissing(true)); };
    load();
    const h = setInterval(load, 10000); // the resident may write while this is open
    return () => clearInterval(h);
  }, [aid, id]));

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    try { setC(await replyConvo(aid, id, v)); } catch (e) { setText(v); fail(e); }
  };
  const toggle = async () => {
    if (!c) return;
    try { setC(await setConvoStatus(aid, id, c.status === 'Open' ? 'Closed' : 'Open')); } catch (e) { fail(e); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 15 }} numberOfLines={1}>{c?.subject ?? t('mgr.m.title')}</Txt>
          {!!c && <Meta numberOfLines={1}>{c.resident}{c.unit ? ` · ${c.unit}` : ''}</Meta>}
        </View>
        {!!c && (
          <Pressable onPress={toggle} hitSlop={8} accessibilityRole="button" style={s.status}>
            <Txt w={700} style={{ fontSize: 12, color: C.acc }}>{c.status === 'Open' ? t('mgr.m.close') : t('mgr.m.reopen')}</Txt>
          </Pressable>
        )}
      </View>
      {missing ? <EmptyState icon="alert-circle-outline" title={t('msg.missing')} /> : (
        <>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, paddingBottom: 20 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
            {!!c && <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}><Pill tone="acc">{tx('topic', c.topic)}</Pill>{c.status === 'Closed' && <Pill tone="dim">{t('msg.closed')}</Pill>}</View>}
            {(c?.messages ?? []).map(m => {
              const mine = m.from === 'staff';
              return (
                <View key={m.id} style={[s.msg, mine ? s.mine : s.theirs]}>
                  <Txt w={700} style={{ fontSize: 12, color: mine ? 'rgba(255,255,255,.85)' : C.acc }}>{m.by}</Txt>
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
          </ScrollView>
          <View style={[s.bar, { paddingBottom: 10 + insets.bottom }]}>
            <Input value={text} onChangeText={setText} placeholder={t('msg.replyPh')} maxLength={4000} style={{ flex: 1 }} onSubmitEditing={send} accessibilityLabel={t('msg.replyPh')} />
            <Pressable onPress={send} accessibilityRole="button" accessibilityLabel={t('msg.send')} style={[s.send, !text.trim() && { opacity: 0.45 }]}><Icon name="send" size={17} color="#fff" /></Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  status: { backgroundColor: C.accBg, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  msg: { maxWidth: '86%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, marginTop: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.acc, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 5 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  bar: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center' },
});
