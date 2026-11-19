import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { ApiError, LIVE } from '@/lib/api';
import { fetchIssueMessages, sendIssueMessage, type IssueMessage } from '@/lib/live';
import { C } from '@/theme';
import { Icon } from './Icon';
import { useUI } from './Overlay';
import { Card, Input, Sect } from './ui';
import { Meta, Txt } from './Txt';

/** The resident ↔ society office conversation inside one issue. Connected to the API only. */
export function IssueChat({ issueId }: { issueId: string }) {
  const { t } = useT();
  const { toast } = useUI();
  const [list, setList] = useState<IssueMessage[]>([]);
  const [text, setText] = useState('');

  const load = useCallback(() => { fetchIssueMessages(issueId).then(setList).catch(() => {}); }, [issueId]);
  useEffect(() => {
    if (!LIVE) return;
    load();
    const h = setInterval(load, 20_000); // the office may reply while the ticket is open
    return () => clearInterval(h);
  }, [load]);
  if (!LIVE) return null;

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    try { setList(await sendIssueMessage(issueId, v)); } catch (e) { setText(v); toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
  };

  return (
    <>
      <Sect title={t('issue.chat')} />
      <Card>
        {!list.length && <Meta>{t('issue.chatEmpty')}</Meta>}
        {list.map(m => {
          const mine = m.from === 'resident';
          return (
            <View key={m.id} style={[s.msg, mine ? s.mine : s.theirs]}>
              {!mine && <Txt w={700} style={{ fontSize: 12, color: C.acc }}>{t('issue.office')}</Txt>}
              <Txt style={{ fontSize: 13, lineHeight: 19, color: mine ? '#fff' : C.ink }}>{m.text}</Txt>
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Input value={text} onChangeText={setText} placeholder={t('issue.chatPh')} maxLength={1000} style={{ flex: 1 }} onSubmitEditing={send} />
          <Pressable onPress={send} accessibilityLabel={t('ai.send')} style={[s.send, !text.trim() && { opacity: 0.45 }]}><Icon name="send" size={17} color="#fff" /></Pressable>
        </View>
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  msg: { maxWidth: '86%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, marginTop: 6 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.acc, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.dimBg, borderBottomLeftRadius: 5 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center' },
});
