import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/components/Overlay';
import { Chip } from '@/components/Sheets';
import { Btn, Card, Icon, IconTile, Input, Meta, Pill, Segmented, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { sendNotice, towers as loadTowers } from '@/lib/vpm';
import { C } from '@/theme';

/**
 * A notice to residents, from the property manager's phone (N-11): what it says, how important it is, who gets it
 * (everyone, or some towers), then a preview of exactly what residents will see before it is published.
 */
export default function VpmNotice() {
  const { aid, name, title: draftTitle, body: draftBody } = useLocalSearchParams<{ aid: string; name?: string; title?: string; body?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const { toast } = useUI();
  const [title, setTitle] = useState(draftTitle ?? '');
  const [body, setBody] = useState(draftBody ?? '');
  const [important, setImportant] = useState<'Normal' | 'High'>('Normal');
  const [who, setWho] = useState<'all' | 'towers'>('all');
  const [all, setAll] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [step, setStep] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadTowers(aid).then(setAll).catch(() => {}); }, [aid]);
  const toggle = (tw: string) => setPicked(p => (p.includes(tw) ? p.filter(x => x !== tw) : [...p, tw]));
  const audience = who === 'all' ? t('notice.everyone') : picked.join(', ');

  const preview = () => {
    if (title.trim().length < 3 || body.trim().length < 3) { toast(t('mgr.noticeReq'), 'alert-circle'); return; }
    if (who === 'towers' && !picked.length) { toast(t('notice.pickTower'), 'alert-circle'); return; }
    setStep('preview');
  };
  const publish = async () => {
    setBusy(true);
    try {
      const r = await sendNotice(aid, { title: title.trim(), body: body.trim(), important: important === 'High', towers: who === 'towers' ? picked : null });
      toast(t('notice.sent', { ref: r.ref, n: r.stats.recipients }), 'megaphone');
      router.back();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={[s.hdr, { paddingTop: insets.top + 10 }]}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (step === 'preview' ? setStep('write') : router.canGoBack() ? router.back() : router.navigate('/manage'))}>
          <Icon name="chevron-back" size={24} color={C.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={800} style={{ fontSize: 16 }}>{step === 'preview' ? t('notice.previewTitle') : t('notice.title')}</Txt>
          {!!name && <Meta numberOfLines={1}>{name}</Meta>}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {step === 'write' ? (
          <Card>
            <Txt w={700} style={s.label}>{t('mgr.noticeTitle')}</Txt>
            <Input value={title} onChangeText={setTitle} placeholder={t('mgr.noticeTitlePh')} maxLength={120} accessibilityLabel={t('mgr.noticeTitle')} />
            <Txt w={700} style={s.label}>{t('mgr.noticeBody')}</Txt>
            <Input value={body} onChangeText={setBody} placeholder={t('mgr.noticeBodyPh')} multiline maxLength={2000} style={{ minHeight: 110, textAlignVertical: 'top' }} accessibilityLabel={t('mgr.noticeBody')} />
            <Meta style={{ marginTop: 4 }}>{t('mgr.noticeHint')}</Meta>
            <Txt w={700} style={s.label}>{t('mgr.noticePri')}</Txt>
            <Segmented items={[['Normal', t('mgr.priNormal')], ['High', t('mgr.priHigh')]]} value={important} onChange={setImportant} />
            <Txt w={700} style={s.label}>{t('notice.who')}</Txt>
            <Segmented items={[['all', t('notice.everyone')], ['towers', t('notice.someTowers')]]} value={who} onChange={setWho} />
            {who === 'towers' && (
              <View style={s.chips}>
                {all.map(tw => <Chip key={tw} label={tw} on={picked.includes(tw)} onPress={() => toggle(tw)} />)}
                {!all.length && <Meta>{t('notice.noTowers')}</Meta>}
              </View>
            )}
            <Btn full icon="eye-outline" label={t('notice.preview')} onPress={preview} style={{ marginTop: 16 }} />
          </Card>
        ) : (
          <>
            <Meta style={{ marginHorizontal: 16, marginTop: 12 }}>{t('notice.previewNote')}</Meta>
            {/* as residents will see it on their notice board */}
            <Card>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <IconTile name="megaphone-outline" size={40} radius={12} bg={important === 'High' ? C.badBg : C.accBg} fg={important === 'High' ? C.bad : C.acc} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Txt w={800} style={{ fontSize: 14.5 }}>{title.trim()}</Txt>
                    {important === 'High' && <Pill tone="bad">{t('notice.importantPill')}</Pill>}
                  </View>
                  <Txt style={{ fontSize: 13.5, lineHeight: 20, color: C.ink2, marginTop: 4 }}>{body.trim()}</Txt>
                  <Meta style={{ marginTop: 6 }}>{audience}{important === 'High' ? ' · ' + t('notice.ackNeeded') : ''}</Meta>
                </View>
              </View>
            </Card>
            <Card>
              <Txt w={700} style={{ fontSize: 13 }}>{t('notice.goesTo', { who: audience })}</Txt>
              <Meta style={{ marginTop: 2 }}>{t('notice.channels')}</Meta>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Btn icon="megaphone-outline" label={t('mgr.noticeSend')} disabled={busy} onPress={publish} style={{ flex: 1 }} />
                <Btn variant="ghost" label={t('notice.edit')} onPress={() => setStep('write')} style={{ flex: 1 }} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  label: { fontSize: 13, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
});
