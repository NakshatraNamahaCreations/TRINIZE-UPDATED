import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { Chips, Label } from '@/components/Chips';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, IconTile, Input, Meta, Pill, Screen, Sect, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { conversations, startConversation, TOPICS, when, type Conversation, type Topic } from '@/lib/messages';
import { C } from '@/theme';

/** My conversations with the society office, and starting a new one. */
export default function Messages() {
  const router = useRouter();
  const { t, tx } = useT();
  const { toast } = useUI();
  const [list, setList] = useState<Conversation[] | null>(null);
  // Home's "Chat now" with the property manager opens a new message with the subject filled in
  const { compose, subject: given } = useLocalSearchParams<{ compose?: string; subject?: string }>();
  const [writing, setWriting] = useState(compose === '1');
  const [subject, setSubject] = useState(compose === '1' ? given ?? '' : '');
  const [topic, setTopic] = useState<Topic>('General');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    const load = () => { conversations().then(setList).catch(() => {}); };
    load();
    const h = setInterval(load, 15000);
    return () => clearInterval(h);
  }, []));

  const send = async () => {
    if (subject.trim().length < 3) { toast(t('msg.needSubject'), 'alert-circle'); return; }
    if (!text.trim()) { toast(t('msg.needText'), 'alert-circle'); return; }
    setBusy(true);
    try {
      const c = await startConversation({ subject: subject.trim(), topic, text: text.trim() });
      setSubject(''); setText(''); setWriting(false);
      router.push(`/messages/${c.id}`);
    } catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen header={<Header back="/profile" title={t('msg.title')} />}>
        {writing ? (
          <View style={{ paddingHorizontal: 14 }}>
            <Sect title={t('msg.new')} />
            <Label>{t('msg.topic')}</Label>
            <Chips items={TOPICS.map(k => [k, tx('topic', k)] as const)} value={topic} onChange={setTopic} />
            <Label>{t('msg.subject')}</Label>
            <Input value={subject} onChangeText={setSubject} placeholder={t('msg.subjectPh')} maxLength={120} accessibilityLabel={t('msg.subject')} />
            <Label>{t('msg.text')}</Label>
            <Input value={text} onChangeText={setText} placeholder={t('msg.textPh')} multiline maxLength={2000} accessibilityLabel={t('msg.text')} style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }} />
            <Btn full icon="send" label={busy ? t('msg.sending') : t('msg.send')} onPress={send} disabled={busy} style={{ marginTop: 16 }} />
            <Btn full variant="ghost" label={t('common.cancel')} onPress={() => setWriting(false)} style={{ marginTop: 8 }} />
          </View>
        ) : (
          <>
            <Meta style={{ marginHorizontal: 14, marginTop: 12 }}>{t('msg.intro')}</Meta>
            <Btn icon="create-outline" label={t('msg.new')} onPress={() => setWriting(true)} style={{ marginHorizontal: 14, marginTop: 10 }} />
            {list !== null && !list.length && <EmptyState icon="chatbubbles-outline" title={t('msg.none')} body={t('msg.noneB')} />}
            {(list ?? []).map((c, i) => (
              <Card key={c.id} delay={stagger(i)} onPress={() => router.push(`/messages/${c.id}`)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <IconTile name="chatbubble-ellipses-outline" size={38} />
                  <View style={{ flex: 1 }}>
                    <Txt w={c.unread ? 800 : 700} style={{ fontSize: 14 }} numberOfLines={1}>{c.subject}</Txt>
                    <Meta numberOfLines={1}>{c.lastFrom === 'staff' ? t('msg.office') + ': ' : ''}{c.preview}</Meta>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Meta>{when(c.lastMessageAt)}</Meta>
                    {c.unread > 0 ? <Pill tone="acc">{String(c.unread)}</Pill> : c.status === 'Closed' ? <Pill tone="dim">{t('msg.closed')}</Pill> : null}
                  </View>
                </View>
                <Meta style={{ marginTop: 6, color: C.ink3 }}>{tx('topic', c.topic)}</Meta>
              </Card>
            ))}
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
