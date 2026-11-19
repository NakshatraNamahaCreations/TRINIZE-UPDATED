import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Keyboard, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Header, Icon, Meta, Pill, Txt } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { ApiError, LIVE } from '@/lib/api';
import { askOffice, fetchAssistantHistory, type HistoryItem } from '@/lib/live';
import { ImagePicker } from '@/lib/native';
import type { IssueDraft } from '@/store/data';
import { CHIP_FORM, CHIP_PHOTO } from '@/store/logic';
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
      {!!d.photo && <Image source={{ uri: d.photo }} style={s.prevPhoto} resizeMode="cover" accessibilityLabel={t('ai.f.photo')} />}
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
  const { toast } = useUI();
  const c = state.chat;
  const [input, setInput] = useState('');
  const [passed, setPassed] = useState<Record<number, boolean>>({});
  const scroll = useRef<ScrollViewInstance>(null);

  // what the server holds from before this phone's log began, oldest first, fetched a page at a time
  const since = c.startedAt;
  const [hist, setHist] = useState<{ since: string; items: HistoryItem[]; cursor: string | null }>({ since: '', items: [], cursor: null });
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const view = useRef({ y: 0, height: 0, prepended: false });
  // a cleared chat starts a new log: pages fetched for the old one no longer apply
  const { items: earlier, cursor } = hist.since === since ? hist : { items: [], cursor: null };
  useEffect(() => {
    if (!LIVE) return;
    let live = true;
    // the first page arrives while the newest message is in view, so the list simply stays at the bottom
    fetchAssistantHistory({ before: since }).then(p => { if (live) setHist({ since, items: [...p.items].reverse(), cursor: p.nextCursor }); }).catch(() => {});
    return () => { live = false; };
  }, [since]);
  const loadEarlier = async () => {
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const p = await fetchAssistantHistory({ cursor });
      view.current.prepended = p.items.length > 0; // older messages go on top: hold the place being read
      setHist(h => (h.since === since ? { since, items: [...[...p.items].reverse(), ...h.items], cursor: p.nextCursor } : h));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle');
    } finally {
      setLoadingEarlier(false);
    }
  };

  // the keyboard shrinks the log from below, so keep the latest message in view
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => scroll.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, []);

  const pickPhoto = async () => {
    if (!ImagePicker) { toast(t('issue.photoUnavailable'), 'image'); return; }
    try {
      // the system photo picker needs no media permission on current Android / iOS
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!res.canceled) actions.attachChatPhoto(res.assets[0].uri);
    } catch {
      toast(t('issue.photoDenied'), 'image');
    }
  };

  const handle = (text: string) => {
    const low = text.trim().toLowerCase();
    if (low === 'open the directory') { router.navigate('/directory'); return; }
    if (low === 'open my issues') { router.navigate('/issues'); return; }
    if (text === CHIP_PHOTO) { pickPhoto(); return; }
    if (text === CHIP_FORM) { actions.sendChat('Start over'); router.navigate('/issues/new'); return; }
    actions.sendChat(text);
  };
  const call = (label: string, phone: string) =>
    Linking.openURL('tel:' + phone).catch(() => toast(t('dir.cantCall', { name: label }), 'call'));
  /** the question that an answer at `index` was for */
  const askedBefore = (index: number) => { for (let n = index - 1; n >= 0; n--) { const m = c.log[n]; if (m?.who === 'me') return m.text; } return ''; };
  const passOn = async (index: number) => {
    const question = askedBefore(index);
    if (!question || passed[index]) return;
    setPassed(p => ({ ...p, [index]: true }));
    try { await askOffice(question); toast(t('ai.askedOffice'), 'checkmark-circle'); }
    catch (e) { setPassed(p => ({ ...p, [index]: false })); toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
  };
  const send = () => {
    const v = input.trim();
    if (!v || c.busy) return;
    setInput('');
    handle(v);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header bell title={
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
        onScroll={e => { view.current.y = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
        onContentSizeChange={(_, h) => {
          const v = view.current;
          if (v.prepended) { v.prepended = false; scroll.current?.scrollTo({ y: v.y + h - v.height, animated: false }); }
          else scroll.current?.scrollToEnd({ animated: true });
          v.height = h;
        }}
      >
        {!!cursor && (
          <Pressable onPress={loadEarlier} disabled={loadingEarlier} accessibilityRole="button" style={({ pressed }) => [s.earlierBtn, (pressed || loadingEarlier) && { opacity: 0.6 }]}>
            <Icon name="time-outline" size={14} color={C.ai} />
            <Txt w={700} style={{ fontSize: 12, color: C.ai }}>{t(loadingEarlier ? 'ai.loadingEarlier' : 'ai.loadEarlier')}</Txt>
          </Pressable>
        )}
        {earlier.map(m => m.role === 'user'
          ? <View key={m.id} style={[s.msg, s.me]}><Txt style={{ color: '#fff', fontSize: 13, lineHeight: 19 }}>{m.text}</Txt></View>
          : (
            <View key={m.id} style={[s.msg, s.ai]}>
              <Txt style={{ fontSize: 13, lineHeight: 19 }}>{m.text}</Txt>
              {!!m.source && (
                <View style={s.src}>
                  <Icon name="document-text-outline" size={13} color={C.ink3} style={{ marginTop: 1 }} />
                  <Txt style={{ fontSize: 12, color: C.ink3, flex: 1 }}>{tr('ai.source', { src: <Txt w={700} style={{ fontSize: 12, color: C.ai }}>{m.source}</Txt> })}</Txt>
                </View>
              )}
            </View>
          ))}
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
                    <Txt style={{ fontSize: 12, color: C.ink3, flex: 1 }}>{tr('ai.source', { src: <Txt w={700} style={{ fontSize: 12, color: C.ai }}>{m.src}</Txt> })}</Txt>
                  </View>
                )}
              </View>
              {!!m.calls?.length && (
                <View style={s.calls}>
                  {m.calls.map(([label, phone]) => (
                    <Pressable key={phone} onPress={() => call(label, phone)} accessibilityRole="button" accessibilityLabel={t('dir.call', { name: label })}
                      style={({ pressed }) => [s.callBtn, pressed && { opacity: 0.8 }]}>
                      <Icon name="call" size={16} color="#fff" />
                      <Txt w={800} style={{ fontSize: 13, color: '#fff' }}>{label}</Txt>
                    </Pressable>
                  ))}
                </View>
              )}
              {!!m.link && (
                <Pressable onPress={() => router.navigate(m.link!.href as Href)} accessibilityRole="button" style={({ pressed }) => [s.linkBtn, pressed && { opacity: 0.8 }]}>
                  <Txt w={800} style={{ fontSize: 13, color: '#fff' }}>{m.link.label}</Txt>
                  <Icon name="arrow-forward" size={15} color="#fff" />
                </Pressable>
              )}
              {m.offer === 'ask_office' && (
                <Pressable onPress={() => passOn(i)} disabled={!!passed[i]} accessibilityRole="button" style={({ pressed }) => [s.offerBtn, (pressed || passed[i]) && { opacity: 0.6 }]}>
                  <Icon name={passed[i] ? 'checkmark-circle' : 'paper-plane-outline'} size={15} color={C.ai} />
                  <Txt w={800} style={{ fontSize: 13, color: C.ai }}>{t(passed[i] ? 'ai.askedOffice' : 'ai.askOffice')}</Txt>
                </Pressable>
              )}
              {last && m.chips && (
                <View style={s.chips}>
                  {m.chips.map(ch => (
                    <Pressable key={ch} onPress={() => handle(ch)} style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}>
                      <Txt w={700} style={{ fontSize: 12, color: C.ai }}>{ch}</Txt>
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
  earlierBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: C.aiBg, borderRadius: 999, paddingHorizontal: 14, minHeight: 36 },
  chip: { backgroundColor: C.aiBg, borderWidth: 1, borderColor: '#D8DCFB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  prev: { borderWidth: 1.5, borderColor: C.ai, borderRadius: 14, padding: 12, backgroundColor: C.aiBg, alignSelf: 'flex-start', maxWidth: '90%', minWidth: '80%' },
  prevH: { fontSize: 12, letterSpacing: 0.8, color: C.ai, marginBottom: 8 },
  prevRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 3 },
  prevPhoto: { width: '100%', height: 130, borderRadius: 10, marginTop: 8, backgroundColor: C.dimBg },
  calls: { gap: 6, alignSelf: 'stretch', maxWidth: '84%' },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bad, borderRadius: 12, paddingHorizontal: 14, minHeight: 48 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: C.ai, borderRadius: 12, paddingHorizontal: 14, minHeight: 44 },
  offerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.ai, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, maxWidth: '90%' },
  prevVal: { flexDirection: 'row', gap: 4, alignItems: 'center', flex: 1, justifyContent: 'flex-end' },
  inRow: { flexDirection: 'row', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#fff' },
  in: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: C.ink, ...font(400) },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.ai, alignItems: 'center', justifyContent: 'center' },
});
