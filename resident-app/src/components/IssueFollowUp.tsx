import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useT } from '@/i18n';
import { ImagePicker } from '@/lib/native';
import type { Issue } from '@/store/data';
import { useStore } from '@/store/store';
import { C, font } from '@/theme';
import { Icon } from './Icon';
import { useUI } from './Overlay';
import { Btn, Card, Sect } from './ui';
import { Meta, Txt } from './Txt';

/** Resident comments/photos already sent on this ticket. */
export function IssueUpdates({ issue }: { issue: Issue }) {
  const { t } = useT();
  if (!issue.updates?.length) return null;
  return (
    <>
      <Sect title={t('issue.updates')} />
      {issue.updates.map((u, i) => (
        <Card key={i} delay={i * 40}>
          {!!u.text && <Txt style={{ fontSize: 13, lineHeight: 19 }}>{u.text}</Txt>}
          {!!u.photo && <Image source={{ uri: u.photo }} style={[s.photo, !!u.text && { marginTop: 8 }]} resizeMode="cover" />}
          <Meta style={{ marginTop: 6 }}>{u.when}</Meta>
        </Card>
      ))}
    </>
  );
}

/** Comment box with an optional photo — the photo picker needs the rebuilt app (see lib/native). */
export function UpdateComposer({ issueId }: { issueId: string }) {
  const { t } = useT();
  const { toast } = useUI();
  const { actions } = useStore();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();

  const pick = async () => {
    if (!ImagePicker) { toast(t('issue.photoUnavailable'), 'image'); return; }
    try {
      // the system photo picker needs no media permission on current Android / iOS
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!res.canceled) setPhoto(res.assets[0].uri);
    } catch {
      toast(t('issue.photoDenied'), 'image');
    }
  };

  const send = () => {
    const v = text.trim();
    if (!v && !photo) { toast(t('issue.updateEmpty'), 'create'); return; }
    actions.addIssueUpdate(issueId, v, photo);
    setText('');
    setPhoto(undefined);
  };

  return (
    <Card>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t('issue.updatePh')}
        placeholderTextColor={C.ink3}
        multiline
        maxLength={1000}
        style={s.input}
      />
      {!!photo && (
        <View style={{ marginTop: 8 }}>
          <Image source={{ uri: photo }} style={s.photo} resizeMode="cover" />
          <Pressable onPress={() => setPhoto(undefined)} accessibilityLabel={t('issue.removePhoto')} hitSlop={8} style={s.remove}>
            <Icon name="close" size={16} color="#fff" />
          </Pressable>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Btn variant="ghost" icon="image-outline" label={t('issue.addPhoto')} onPress={pick} />
        <Btn icon="send" label={t('issue.send')} onPress={send} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

/** Asks why before reopening — the reason goes onto the public timeline and the admin queue. */
export function ReopenModal({ issueId, visible, onClose }: { issueId: string; visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const { actions } = useStore();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  const close = () => { setReason(''); setTried(false); onClose(); };
  const submit = () => {
    setTried(true);
    if (!reason.trim()) return;
    actions.reopenIssue(issueId, reason.trim());
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={s.veil}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.close')} />
        <View style={s.sheet}>
          <View style={s.badge}><Icon name="refresh" size={24} color={C.warn} /></View>
          <Txt w={800} style={{ fontSize: 15, textAlign: 'center' }}>{t('issue.reopenT')}</Txt>
          <Meta style={{ textAlign: 'center', marginTop: 4, marginBottom: 12, fontSize: 12 }}>{t('issue.reopenWhy')}</Meta>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t('issue.reopenPh')}
            placeholderTextColor={C.ink3}
            multiline
            autoFocus
            maxLength={500}
            style={[s.input, tried && !reason.trim() && { borderColor: C.bad }]}
          />
          {tried && !reason.trim() && <Meta style={{ color: C.bad, marginTop: 4 }}>{t('issue.reasonReq')}</Meta>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Btn variant="ghost" label={t('common.cancel')} onPress={close} />
            <Btn icon="refresh" label={t('issue.reopen')} onPress={submit} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 70, maxHeight: 140, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, textAlignVertical: 'top', backgroundColor: '#fff', ...font(400) },
  photo: { width: '100%', height: 180, borderRadius: 10, backgroundColor: C.dimBg },
  remove: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,.55)', alignItems: 'center', justifyContent: 'center' },
  veil: { flex: 1, backgroundColor: 'rgba(6,10,18,.45)', justifyContent: 'center', paddingHorizontal: 18 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 18 },
  badge: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.warnBg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 10 },
});
