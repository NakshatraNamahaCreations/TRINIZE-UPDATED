import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Header, Icon, IconTile, Input, Meta, Pill, Screen, Txt } from '@/components/ui';
import type { Tone } from '@/store/data';
import { LIVE } from '@/lib/api';
import { rewriteLive } from '@/lib/live2';
import { rewrite, TONE_META, type Safety } from '@/store/logic';
import { useT } from '@/i18n';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Compose() {
  const router = useRouter();
  const { toast } = useUI();
  const { state, actions } = useStore();
  const { t, tr } = useT();
  const [text, setText] = useState('');
  const [tone, setTone] = useState<Tone | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [guard, setGuard] = useState<Safety | null>(null);

  const tones = (Object.keys(state.ai.tones) as Tone[]).filter(tn => state.ai.tones[tn]);
  const toneOn = state.ai.toneRewrite && tones.length > 0;

  /** the instant on-phone rewrite shows first; the server's (GPT when connected) replaces it when it arrives */
  const suggest = (tn: Tone) => {
    const asked = text;
    const quick = rewrite(asked, tn);
    setSuggestion(quick);
    // only swap it in if the resident hasn't moved on to another tone or edited the draft meanwhile
    if (LIVE) rewriteLive(asked, tn).then(better => setSuggestion(cur => (cur === quick ? better : cur))).catch(() => {});
  };

  const pickTone = (tn: Tone) => {
    if (!text.trim()) { toast(t('compose.writeFirst'), 'create'); return; }
    setTone(tn);
    suggest(tn);
    actions.markTried('tone');
  };

  const publish = () => {
    if (!text.trim()) { toast(t('compose.nothing'), 'alert-circle'); return; }
    const safety = actions.checkPost(text);
    if (safety.level !== 'safe') { setGuard(safety); actions.markTried('guard'); return; }
    actions.publishPost(text);
    router.dismissTo('/discussions');
  };

  const guardRewrite = () => {
    const tn: Tone = tones.includes('Polite') ? 'Polite' : (tones[0] ?? 'Polite');
    setTone(tn);
    suggest(tn);
    setGuard(null);
  };

  const postHeld = () => {
    setGuard(null);
    actions.publishPost(text, true);
    router.dismissTo('/discussions');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen header={<Header title={t('compose.title')} back="/discussions" />}>
        <View style={{ padding: 14 }}>
          <Input
            multiline value={text} onChangeText={setText} style={{ minHeight: 110, textAlignVertical: 'top' }}
            placeholder={t('compose.placeholder')}
          />
          {toneOn ? (
            <>
              <View style={s.toneHead}>
                <Icon name="sparkles" size={14} color={C.ai} />
                <Txt w={700} style={{ fontSize: 12, color: C.ink2 }}>{t('compose.aiHead')}</Txt>
                <Pill tone="ai">{t('compose.suggestsOnly')}</Pill>
              </View>
              {tones.map(tn => (
                <Pressable key={tn} onPress={() => pickTone(tn)} style={[s.opt, tone === tn && s.optSel]}>
                  <Icon name={TONE_META[tn][0]} size={18} color={tone === tn ? C.acc : C.ink2} />
                  <Txt w={700} style={{ fontSize: 12.5, flex: 1 }}>{t(`tone.${tn}`)}
                    <Txt w={500} style={{ color: C.ink3, fontSize: 12.5 }}> — {t(`toneDesc.${tn}`)}</Txt>
                  </Txt>
                </Pressable>
              ))}
              {suggestion && (
                <View style={s.suggest}>
                  <Txt w={800} style={s.suggestLbl}>{t('compose.suggestion', { tone: tone ? t(`tone.${tone}`).toUpperCase() : '' })}</Txt>
                  <Txt style={{ fontSize: 12.5, lineHeight: 19 }}>{suggestion}</Txt>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
                    <Btn variant="soft" label={t('compose.use')} onPress={() => { setText(suggestion); setSuggestion(null); }} />
                    <Btn variant="ghost" label={t('compose.keep')} onPress={() => setSuggestion(null)} />
                  </View>
                </View>
              )}
            </>
          ) : <Meta style={{ marginVertical: 10 }}>{t('compose.off')}</Meta>}
          <Btn icon="paper-plane-outline" label={t('compose.publish')} onPress={publish} style={{ marginTop: 14 }} />
          <Meta style={{ marginTop: 10, textAlign: 'center' }}>{t('compose.note')}</Meta>
        </View>
      </Screen>

      <Modal visible={guard !== null} transparent animationType="fade" onRequestClose={() => setGuard(null)} statusBarTranslucent>
        <View style={s.veil}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setGuard(null)} />
          {guard && (
            <View style={s.guard}>
              <IconTile name="shield-half-outline" size={56} radius={28} style={{ alignSelf: 'center', marginBottom: 10 }}
                bg={guard.level === 'block' ? C.badBg : C.warnBg} fg={guard.level === 'block' ? C.bad : C.warn} />
              <Txt w={800} style={{ fontSize: 15, marginBottom: 6, textAlign: 'center' }}>{t('guard.title')}</Txt>
              <Txt style={{ fontSize: 12.5, color: C.ink2, marginBottom: 14, textAlign: 'center', lineHeight: 19 }}>
                {tr(guard.words.length > 1 ? 'guard.many' : 'guard.one', {
                  words: guard.words.slice(0, 3).map((w, i) => <Txt key={w} w={800} style={{ fontSize: 12.5 }}>{i ? ', ' : ''}“{w}”</Txt>),
                })}
                {guard.level === 'block' ? t('guard.block') : ''}
              </Txt>
              {state.ai.toneRewrite && <Btn icon="sparkles" label={t('guard.rewrite')} onPress={guardRewrite} style={{ backgroundColor: C.ai, borderColor: C.ai, marginBottom: 8 }} />}
              <Btn variant="ghost" label={t('guard.edit')} onPress={() => setGuard(null)} />
              {guard.level !== 'block' && (
                <Pressable onPress={postHeld} style={{ marginTop: 12, alignSelf: 'center' }}>
                  <Txt w={600} style={{ fontSize: 12, color: C.ink3, textDecorationLine: 'underline' }}>{t('guard.anyway')}</Txt>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  toneHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 4 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 4, backgroundColor: '#fff' },
  optSel: { borderColor: C.acc, backgroundColor: C.accBg },
  suggest: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#C7CCF8', backgroundColor: C.aiBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 8 },
  suggestLbl: { fontSize: 12, letterSpacing: 0.6, color: C.ai, marginBottom: 4 },
  veil: { flex: 1, backgroundColor: 'rgba(6,10,18,.45)', justifyContent: 'center', paddingHorizontal: 18 },
  guard: { backgroundColor: '#fff', borderRadius: 20, paddingTop: 22, paddingHorizontal: 18, paddingBottom: 18, elevation: 14, shadowColor: '#171331', shadowOpacity: 0.28, shadowRadius: 30, shadowOffset: { width: 0, height: 26 } },
});
